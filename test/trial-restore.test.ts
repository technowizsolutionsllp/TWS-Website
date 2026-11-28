// Protocol revision 5 (continuing a trial on a recognised computer): the edge cases around the happy paths in
// service.test.ts and nodupe-trial.test.ts. Races between the read and the write, a repeated restore, the request
// counters, the rate limiter, the real route files and what the admin Records page shows.

import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { NOW, lookup, newDevice, newInstall, register, reportUsage, seal } from './client';
import { POST as pinchLookupRoute } from '../app/api/pinchpdf/trial/v1/lookup/route';
import { POST as nodupeLookupRoute } from '../app/api/nodupe/trial/v1/lookup/route';
import { searchRecords } from '../lib/admin/records';
import { renderRecords } from '../lib/admin/records-page';
import { b64urlDecode, utf8 } from '../lib/trial/bytes';
import type { TrialEnv } from '../lib/trial/config';
import { aesGcmOpen } from '../lib/trial/crypto';
import { handleLookup } from '../lib/trial/handlers';
import { HEALTH_HEADER } from '../lib/trial/metrics';
import { NODUPE, PINCHPDF, type ProductSpec } from '../lib/trial/product';

const e = env as unknown as TrialEnv;
const SECOND = 1000;
const sql = (q: string, ...args: unknown[]) => e.TRIAL_DB.prepare(q).bind(...args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowFor = (id: string) => sql('SELECT * FROM trials WHERE id = ?', id).first<Record<string, any>>();
const auditFor = (id: string) => sql(`SELECT reason, details FROM trial_audit WHERE trial_id = ? AND action = 'restore' ORDER BY id`, id).all<{ reason: string; details: string }>();
const resumeOnly = (ref: string) => ({ resume: ref, name: undefined, email: undefined });

/**
 * The PinchPDF database, but `before` runs once just before the first batch, which is the restore's UPDATE and audit
 * INSERT. That puts another actor's change exactly between the handler's read and its write.
 */
function envWithChangeBeforeWrite(before: () => Promise<unknown>): TrialEnv {
  let done = false;
  const real = e.TRIAL_DB;
  const db = new Proxy(real, {
    get(target, prop) {
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          if (!done) {
            done = true;
            await before();
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...e, TRIAL_DB: db } as TrialEnv;
}

describe('continuing a trial: something changes between the read and the write', () => {
  it('refuses with the support reference only when the trial was revoked meanwhile', async () => {
    const device = newDevice();
    const first = await register(e, { device });
    const { trial_id: id, support_ref: ref } = first.reply.result!;
    const racing = envWithChangeBeforeWrite(() => sql(`UPDATE trials SET status = 'revoked' WHERE id = ?`, id).run());
    const again = await register(racing, { device, overrides: resumeOnly(ref) });
    expect(again.reply.result).toEqual({ result: 'already_used', support_ref: ref });
    expect((await rowFor(id))!.pubkey).toBe(first.install.publicB64);
    expect((await auditFor(id)).results).toHaveLength(0);
  });

  it('registers a new trial when the trial was reset meanwhile (a reset trial never blocks)', async () => {
    const device = newDevice();
    const first = await register(e, { device, email: 'jane@example.com' });
    const id = first.reply.result!.trial_id;
    const racing = envWithChangeBeforeWrite(() =>
      sql(`UPDATE trials SET status = 'reset', pubkey_retired = pubkey, pubkey = NULL, h_guid = NULL, h_smbios = NULL, h_board = NULL WHERE id = ?`, id).run(),
    );
    const again = await register(racing, { device, email: 'jane@example.com' });
    expect(again.reply.result).toMatchObject({ result: 'registered', used: 0 });
    expect(again.reply.result!.trial_id).not.toBe(id);
    expect(again.reply.result!.restored).toBeUndefined();
    expect((await rowFor(id))!.status).toBe('reset');
  });

  it('registers a new trial when the trial was deleted meanwhile, if a name and email were sent', async () => {
    const device = newDevice();
    const first = await register(e, { device, email: 'jane@example.com' });
    const id = first.reply.result!.trial_id;
    const racing = envWithChangeBeforeWrite(() => sql('DELETE FROM trials WHERE id = ?', id).run());
    const again = await register(racing, { device, email: 'jane@example.com' });
    expect(again.reply.result).toMatchObject({ result: 'registered', used: 0 });
    expect(again.reply.result!.trial_id).not.toBe(id);
  });

  it('answers an identical request that already moved the trial as a replay, and keeps the OLD key as retired', async () => {
    const device = newDevice();
    const first = await register(e, { device });
    const { trial_id: id, support_ref: ref } = first.reply.result!;
    await reportUsage(e, first.install, id, 2);
    const install = await newInstall();
    // the "winner" moves the trial to the same new key first
    const racing = envWithChangeBeforeWrite(() => sql('UPDATE trials SET pubkey_retired = pubkey, pubkey = ? WHERE id = ?', install.publicB64, id).run());
    const again = await register(racing, { device, install, overrides: resumeOnly(ref) });
    expect(again.reply.result).toMatchObject({ result: 'registered', trial_id: id, used: 2 });
    expect(again.reply.result!.restored).toBeUndefined();
    expect(await rowFor(id)).toMatchObject({ pubkey: install.publicB64, pubkey_retired: first.install.publicB64 });
    expect((await auditFor(id)).results).toHaveLength(0); // the loser writes no second audit row
  });
});

describe('continuing a trial more than once', () => {
  it('keeps the latest earlier key in the row and every earlier key in the audit', async () => {
    const device = newDevice();
    const first = await register(e, { device });
    const { trial_id: id, support_ref: ref } = first.reply.result!;
    await reportUsage(e, first.install, id, 1);
    const second = await register(e, { device, overrides: resumeOnly(ref) });
    await reportUsage(e, second.install, id, 2);
    const third = await register(e, { device, email: 'new@example.com', overrides: { resume: ref } });
    expect(third.reply.result).toMatchObject({ result: 'registered', trial_id: id, used: 2, restored: true });

    expect(await rowFor(id)).toMatchObject({ pubkey: third.install.publicB64, pubkey_retired: second.install.publicB64 });
    expect((await auditFor(id)).results).toEqual([
      { reason: 'resume', details: JSON.stringify({ used: 1, previous_key: first.install.publicB64 }) },
      { reason: 'resume', details: JSON.stringify({ used: 2, previous_key: second.install.publicB64 }) },
    ]);
    // only the newest key reports
    expect((await reportUsage(e, second.install, id, 3)).status).toBe(400);
    expect((await reportUsage(e, third.install, id, 3)).result).toMatchObject({ result: 'ok', used: 3 });
  });

  it('describes a used-up trial as exhausted on lookup', async () => {
    const device = newDevice();
    const first = await register(e, { device });
    await reportUsage(e, first.install, first.reply.result!.trial_id, 5);
    expect((await lookup(e, device)).result).toMatchObject({ result: 'found', state: 'exhausted', used: 5, limit: 5 });
  });
});

describe('request counters for lookup and continue', () => {
  const metrics = async (db: D1Database) =>
    (await db.prepare('SELECT product, endpoint, outcome, count FROM metrics_daily ORDER BY endpoint, outcome').all<Record<string, unknown>>()).results;

  it('counts lookup as its own endpoint and a continue as the register outcome "restored", per product', async () => {
    let clock = 10_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 20_000)); // every count is written at once
    const device = newDevice();
    await lookup(e, device);
    const first = await register(e, { device });
    await lookup(e, device);
    await register(e, { device, overrides: resumeOnly(first.reply.result!.support_ref) });
    await register(e, { device, email: 'someone-else@example.com' });
    const pinch = (await metrics(e.TRIAL_DB)).filter((r) => r.endpoint !== 'challenge');
    expect(pinch).toEqual([
      { product: 'pinchpdf', endpoint: 'lookup', outcome: 'found', count: 1 },
      { product: 'pinchpdf', endpoint: 'lookup', outcome: 'none', count: 1 },
      { product: 'pinchpdf', endpoint: 'register', outcome: 'already_used', count: 1 },
      { product: 'pinchpdf', endpoint: 'register', outcome: 'registered', count: 1 },
      { product: 'pinchpdf', endpoint: 'register', outcome: 'restored', count: 1 },
    ]);

    const nd = await register(e, { device, product: NODUPE });
    await lookup(e, device, { product: NODUPE });
    await register(e, { device, product: NODUPE, overrides: resumeOnly(nd.reply.result!.support_ref) });
    const nodupe = (await metrics(e.NODUPE_DB!)).filter((r) => r.endpoint !== 'challenge');
    expect(nodupe).toEqual([
      { product: 'nodupe', endpoint: 'lookup', outcome: 'found', count: 1 },
      { product: 'nodupe', endpoint: 'register', outcome: 'registered', count: 1 },
      { product: 'nodupe', endpoint: 'register', outcome: 'restored', count: 1 },
    ]);
  });

  it('leaves health-check lookups out of the counters', async () => {
    let clock = 20_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 20_000));
    const { envelope } = await seal(e, 'lookup', { proto: 1, signals: { guid: null, smbios: null, board: null } });
    const request = new Request('https://x/api/pinchpdf/trial/v1/lookup', { method: 'POST', headers: { [HEALTH_HEADER]: '1' }, body: JSON.stringify(envelope) });
    expect((await handleLookup(request, e, () => NOW)).status).toBe(200);
    expect(await metrics(e.TRIAL_DB)).toEqual([]);
  });
});

describe('lookup rate limit', () => {
  it('uses the register limiter with its own key per product, and answers 429 when refused', async () => {
    const keys: string[] = [];
    const spy = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) };
    const withSpy = { ...e, TRIAL_REGISTER_LIMITER: spy } as TrialEnv;
    const post = () => new Request('https://x', { method: 'POST', body: '{}', headers: { 'cf-connecting-ip': '198.51.100.7' } });
    await handleLookup(post(), withSpy, () => NOW);
    await handleLookup(post(), withSpy, () => NOW, NODUPE);
    expect(keys).toEqual(['lookup|198.51.100.7', 'nodupe|lookup|198.51.100.7']);

    const refused = { ...e, TRIAL_REGISTER_LIMITER: { limit: async () => ({ success: false }) } } as TrialEnv;
    const response = await handleLookup(post(), refused, () => NOW);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });
});

describe('the lookup route files', () => {
  async function viaRoute(route: (request: Request) => Promise<Response>, product: ProductSpec) {
    const sealed = await seal(e, 'lookup', { proto: 1, signals: { guid: null, smbios: null, board: null } }, 'k1', product);
    const response = await route(new Request(`https://technowizsolutions.com${product.basePath}lookup`, { method: 'POST', body: JSON.stringify(sealed.envelope) }));
    const json = (await response.json()) as { n: string; ct: string };
    const plain = await aesGcmOpen(sealed.kResp, b64urlDecode(json.n)!, utf8(`${sealed.nB64}|lookup`), b64urlDecode(json.ct)!);
    return { status: response.status, result: JSON.parse(new TextDecoder().decode(plain!)) };
  }

  it('serve each product with its own paths and keys (a PinchPDF envelope is refused by the NoDupe route)', async () => {
    expect(await viaRoute(pinchLookupRoute, PINCHPDF)).toEqual({ status: 200, result: { result: 'unsupported_device' } });
    expect(await viaRoute(nodupeLookupRoute, NODUPE)).toEqual({ status: 200, result: { result: 'unsupported_device' } });
    const sealed = await seal(e, 'lookup', { proto: 1, signals: { guid: null, smbios: null, board: null } }, 'k1', PINCHPDF);
    const crossed = await nodupeLookupRoute(new Request('https://technowizsolutions.com/api/nodupe/trial/v1/lookup', { method: 'POST', body: JSON.stringify(sealed.envelope) }));
    expect(crossed.status).toBe(400);
  });
});

describe('admin Records page', () => {
  it('shows when and how a trial was continued, in the page and the JSON', async () => {
    const device = newDevice();
    const first = await register(e, { device, name: 'Jane Restore', email: 'jane.restore@example.com' });
    const { trial_id: id, support_ref: ref } = first.reply.result!;
    const later = NOW + 86_400 * SECOND;
    await register(e, { device, now: later, overrides: resumeOnly(ref) });

    const found = await searchRecords(e, e.TRIAL_DB, PINCHPDF, 'jane.restore@example.com', Math.floor(later / SECOND), 'ops');
    expect(found.results).toHaveLength(1);
    expect(found.results[0]).toMatchObject({ id, restores: [{ at: later / SECOND, matched_by: 'resume' }] });

    const html = renderRecords({ product: 'pinchpdf', query: 'jane.restore@example.com', results: found.results, truncated: false, capped: false, notice: null, error: null, missing: [] } as never);
    expect(html).toContain('Continued once, last ');
    expect(html).toContain('(support reference)');

    const other = await register(e, { name: 'Never Restored', email: 'never@example.com' });
    const plain = await searchRecords(e, e.TRIAL_DB, PINCHPDF, 'never@example.com', Math.floor(NOW / SECOND), 'ops');
    expect(plain.results[0]).toMatchObject({ id: other.reply.result!.trial_id, restores: [] });
    expect(renderRecords({ product: 'pinchpdf', query: 'x', results: plain.results, truncated: false, capped: false, notice: null, error: null, missing: [] } as never)).not.toContain('Continued');
  });
});
