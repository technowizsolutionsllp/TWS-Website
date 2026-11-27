// Finding and deleting trial records: /admin/records and POST /api/<product>/records/v1/{search|delete}.

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAdminGuard } from '../lib/admin/auth';
import { cleanQuery, cleanReason, searchRecords } from '../lib/admin/records';
import { handleAdminRecords, handleRecordsDeleteApi, handleRecordsSearchApi, type RecordsRuntimeEnv } from '../lib/admin/records-handlers';
import { b64urlEncode, randomBytes } from '../lib/trial/bytes';
import type { TrialEnv } from '../lib/trial/config';
import { emailBlindIndex, encryptField } from '../lib/trial/pii';
import { NODUPE, PINCHPDF, type ProductSpec } from '../lib/trial/product';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const creds = { ADMIN_USER: 'ops', ADMIN_PASSWORD: 'correct horse battery' };
const good = `Basic ${btoa(`${creds.ADMIN_USER}:${creds.ADMIN_PASSWORD}`)}`;
const full = (): RecordsRuntimeEnv => ({ ...creds, TRIAL_DB: env.TRIAL_DB, NODUPE_DB: env.NODUPE_DB, PII_KEY: env.PII_KEY, PEPPER_EMAIL: env.PEPPER_EMAIL });
const pii = env as unknown as TrialEnv;
const dbOf = (p: ProductSpec) => (p === NODUPE ? env.NODUPE_DB : env.TRIAL_DB);

beforeEach(() => resetAdminGuard());

let seq = 0;
/** Inserts a trial the way the register handler stores one (encrypted name and email, email index). */
async function addTrial(product: ProductSpec, name: string | null, email: string | null, fields: { used?: number; created?: number } = {}) {
  seq += 1;
  const id = b64urlEncode(randomBytes(16));
  const ref = `R${String(seq).padStart(7, '0')}`.replace(/[ILOU]/g, 'X');
  const created = fields.created ?? Math.floor(NOW / 1000) - seq * 60;
  const extra = product.perMode ? ', used_basic, used_similar, used_deep' : '';
  const extraValues = product.perMode ? ', 2, 1, 0' : '';
  await dbOf(product)
    .prepare(
      `INSERT INTO trials (id, pubkey, support_ref, name_enc, email_enc, email_bidx, used, limit_total, status, terms_version, privacy_version,
         accepted_at, received_at, created_at, last_server_contact_at, product${extra})
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 9, 'active', 'v', 'v', ?8, ?8, ?8, ?8, ?9${extraValues})`,
    )
    .bind(
      id,
      `pk${seq}`,
      ref,
      name === null ? null : await encryptField(pii, id, 'name', name),
      email === null ? null : await encryptField(pii, id, 'email', email),
      email === null ? null : await emailBlindIndex(pii, email),
      fields.used ?? 3,
      created,
      product.id,
    )
    .run();
  return { id, ref };
}

type Init = { auth?: string | null; type?: string | null; origin?: string | null; site?: string; method?: string };
const request = (path: string, body: string | undefined, init: Init = {}) => {
  const headers: Record<string, string> = {};
  if (init.auth !== null) headers.authorization = init.auth ?? good;
  if (init.type !== null) headers['content-type'] = init.type ?? 'application/json';
  if (init.origin) headers.origin = init.origin;
  if (init.site) headers['sec-fetch-site'] = init.site;
  return new Request(`https://technowizsolutions.com${path}`, { method: init.method ?? 'POST', headers, body });
};
const api = (path: string, body: unknown, init: Init = {}) => request(path, JSON.stringify(body), init);
const form = (fields: Record<string, string>, init: Init = {}) => request('/admin/records', new URLSearchParams(fields).toString(), { type: 'application/x-www-form-urlencoded', ...init });

const search = (q: unknown, product: ProductSpec = PINCHPDF, init: Init = {}) =>
  handleRecordsSearchApi(api(`/api/${product.id}/records/v1/search`, { q }, init), full(), NOW, product);
const remove = (body: unknown, product: ProductSpec = PINCHPDF, init: Init = {}) =>
  handleRecordsDeleteApi(api(`/api/${product.id}/records/v1/delete`, body, init), full(), NOW, product);

type SearchBody = { product: string; count: number; truncated: boolean; capped: boolean; results: { id: string; name: string | null; email: string | null; support_ref: string; used: number; modes: unknown }[] };

describe('search API', () => {
  it('finds a record by exact email (any case), by part of a name or email, by support reference and by trial id', async () => {
    const jane = await addTrial(PINCHPDF, 'Jane Q. Public', 'Jane.Public@Example.com');
    await addTrial(PINCHPDF, 'Someone Else', 'other@example.org');

    for (const q of ['jane.public@example.com', 'JANE.PUBLIC@EXAMPLE.COM', 'q. pub', 'public@exam', jane.ref, jane.ref.toLowerCase(), jane.id]) {
      const response = await search(q);
      expect(response.status, q).toBe(200);
      const body = (await response.json()) as SearchBody;
      expect(body.results.map((r) => r.id), q).toEqual([jane.id]);
      expect(body.results[0]).toMatchObject({ name: 'Jane Q. Public', email: 'Jane.Public@Example.com', support_ref: jane.ref, used: 3, modes: null });
    }
    const none = (await (await search('nobody at all')).json()) as SearchBody;
    expect(none).toMatchObject({ count: 0, results: [], truncated: false });
  });

  it('keeps the two products apart, and returns per-mode counts for NoDupe', async () => {
    const a = await addTrial(PINCHPDF, 'Pat Shared', 'pat@example.com');
    const b = await addTrial(NODUPE, 'Pat Shared', 'pat@example.com');
    const pinch = (await (await search('pat@example.com', PINCHPDF)).json()) as SearchBody;
    const nodupe = (await (await search('pat@example.com', NODUPE)).json()) as SearchBody;
    expect(pinch.results.map((r) => r.id)).toEqual([a.id]);
    expect(nodupe.results.map((r) => r.id)).toEqual([b.id]);
    expect(nodupe.product).toBe('nodupe');
    expect(nodupe.results[0].modes).toMatchObject({ used: { basic: 2, similar: 1, deep: 0 } });
  });

  it('caps the answer at 25 and says so', async () => {
    for (let i = 0; i < 27; i += 1) await addTrial(PINCHPDF, `Sam Smith ${i}`, `sam${i}@example.com`);
    const body = (await (await search('sam smith')).json()) as SearchBody;
    expect(body.count).toBe(25);
    expect(body.truncated).toBe(true);
  });

  it('does not find an erased record by name or email, only by its reference', async () => {
    const gone = await addTrial(PINCHPDF, null, null);
    expect(((await (await search('example')).json()) as SearchBody).count).toBe(0);
    const byRef = (await (await search(gone.ref)).json()) as SearchBody;
    expect(byRef.results[0]).toMatchObject({ id: gone.id, name: null, email: null });
  });

  it('writes an audit row for every record it returns, with no personal data in it', async () => {
    const jane = await addTrial(PINCHPDF, 'Jane Public', 'jane@example.com');
    await addTrial(PINCHPDF, 'Not Matching', 'x@example.com');
    await search('jane');
    const { results } = await env.TRIAL_DB.prepare('SELECT * FROM trial_audit').all<Record<string, unknown>>();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ trial_id: jane.id, action: 'view-contact', operator: 'admin-api' });
    expect(JSON.stringify(results)).not.toMatch(/jane@|Jane Public/);
  });

  it('returns nothing when the view cannot be recorded', async () => {
    await addTrial(PINCHPDF, 'Jane Public', 'jane@example.com');
    const broken = { prepare: (sql: string) => env.TRIAL_DB.prepare(sql), batch: async () => { throw new Error('audit write failed'); } } as unknown as D1Database;
    await expect(searchRecords(full(), broken, PINCHPDF, 'jane', 1, 'test')).rejects.toThrow('audit write failed');
  });

  it('rejects a query that is too short, too long or not text', async () => {
    for (const q of ['', 'ab', '  a ', 'x'.repeat(101), 5, null, 'bad\u0000char']) expect((await search(q)).status, String(q)).toBe(400);
  });
});

describe('delete API', () => {
  it('erases the name and email but keeps the row and its counts', async () => {
    const jane = await addTrial(PINCHPDF, 'Jane Public', 'jane@example.com', { used: 4 });
    const response = await remove({ id: jane.id, action: 'erase_contact', reason: 'Deletion request by email' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, product: 'pinchpdf', id: jane.id, action: 'erase_contact', support_ref: jane.ref });

    const row = await env.TRIAL_DB.prepare('SELECT name_enc, email_enc, email_bidx, used, pubkey FROM trials WHERE id = ?').bind(jane.id).first<Record<string, unknown>>();
    expect(row).toEqual({ name_enc: null, email_enc: null, email_bidx: null, used: 4, pubkey: 'pk' + (seq) });
    const audit = await env.TRIAL_DB.prepare("SELECT action, reason, operator, at, details FROM trial_audit WHERE trial_id = ?").bind(jane.id).first<Record<string, unknown>>();
    expect(audit).toMatchObject({ action: 'erase-contact', reason: 'Deletion request by email', operator: 'admin-api', at: NOW / 1000 });
    expect(String(audit!.details)).toContain(`"support_ref":"${jane.ref}"`);
    expect(JSON.stringify(audit)).not.toMatch(/jane|Public/i);
    expect(((await (await search('jane@example.com')).json()) as SearchBody).count).toBe(0);
  });

  it('deletes the whole record and audits it', async () => {
    const jane = await addTrial(NODUPE, 'Jane Public', 'jane@example.com');
    const keep = await addTrial(NODUPE, 'Keep Me', 'keep@example.com');
    const response = await remove({ id: jane.id, action: 'delete', reason: 'Right to erasure' }, NODUPE);
    expect(response.status).toBe(200);
    expect(await env.NODUPE_DB.prepare('SELECT id FROM trials WHERE id = ?').bind(jane.id).first()).toBeNull();
    expect(await env.NODUPE_DB.prepare('SELECT id FROM trials WHERE id = ?').bind(keep.id).first()).not.toBeNull();
    expect(await env.NODUPE_DB.prepare('SELECT action, reason FROM trial_audit WHERE trial_id = ?').bind(jane.id).first()).toEqual({ action: 'delete-all', reason: 'Right to erasure' });
    // a second delete finds nothing
    expect((await remove({ id: jane.id, action: 'delete', reason: 'Right to erasure' }, NODUPE)).status).toBe(404);
  });

  it("does not touch the other product's database", async () => {
    const jane = await addTrial(NODUPE, 'Jane Public', 'jane@example.com');
    expect((await remove({ id: jane.id, action: 'delete', reason: 'Wrong product' }, PINCHPDF)).status).toBe(404);
    expect(await env.NODUPE_DB.prepare('SELECT id FROM trials WHERE id = ?').bind(jane.id).first()).not.toBeNull();
  });

  it('refuses a missing or invalid id, action or reason, and changes nothing', async () => {
    const jane = await addTrial(PINCHPDF, 'Jane Public', 'jane@example.com');
    const bad = [
      {},
      { id: jane.id, action: 'delete' },
      { id: jane.id, action: 'delete', reason: 'ab' },
      { id: jane.id, action: 'delete', reason: 'x'.repeat(501) },
      { id: jane.id, action: 'purge', reason: 'valid reason' },
      { id: "a' OR '1'='1", action: 'delete', reason: 'valid reason' },
      { id: 42, action: 'delete', reason: 'valid reason' },
      { id: jane.id, action: 'delete', reason: 'line\nbreak' },
    ];
    for (const body of bad) expect((await remove(body)).status, JSON.stringify(body)).toBe(400);
    expect(await env.TRIAL_DB.prepare('SELECT id FROM trials WHERE id = ?').bind(jane.id).first()).not.toBeNull();
    expect((await env.TRIAL_DB.prepare('SELECT COUNT(*) AS n FROM trial_audit').first<{ n: number }>())!.n).toBe(0);
  });
});

describe('access control', () => {
  it('is off without admin credentials, and asks for them otherwise', async () => {
    const body = { q: 'jane' };
    const off = await handleRecordsSearchApi(api('/api/pinchpdf/records/v1/search', body), { TRIAL_DB: env.TRIAL_DB, PII_KEY: env.PII_KEY, PEPPER_EMAIL: env.PEPPER_EMAIL }, NOW, PINCHPDF);
    expect(off.status).toBe(404);
    expect((await search('jane', PINCHPDF, { auth: null })).status).toBe(401);
    expect((await search('jane', PINCHPDF, { auth: `Basic ${btoa('ops:wrong password')}` })).status).toBe(401);
    expect((await remove({ id: 'x', action: 'delete', reason: 'valid reason' }, PINCHPDF, { auth: null })).status).toBe(401);
    expect((await handleAdminRecords(request('/admin/records', undefined, { method: 'GET', auth: null, type: null }), full(), NOW)).status).toBe(401);
  });

  it('refuses requests from another site, other methods and bodies that are not JSON', async () => {
    const jane = await addTrial(PINCHPDF, 'Jane Public', 'jane@example.com');
    const evil = { origin: 'https://evil.example' };
    expect((await remove({ id: jane.id, action: 'delete', reason: 'valid reason' }, PINCHPDF, evil)).status).toBe(403);
    expect((await search('jane', PINCHPDF, evil)).status).toBe(403);
    expect((await search('jane', PINCHPDF, { origin: 'https://technowizsolutions.com' })).status).toBe(200);
    expect((await search('jane', PINCHPDF, { type: 'text/plain' })).status).toBe(415);
    expect((await handleRecordsSearchApi(request('/api/pinchpdf/records/v1/search', undefined, { method: 'GET', type: null }), full(), NOW, PINCHPDF)).status).toBe(405);
    expect((await handleRecordsDeleteApi(request('/api/pinchpdf/records/v1/delete', '{not json', {}), full(), NOW, PINCHPDF)).status).toBe(400);
    expect(await env.TRIAL_DB.prepare('SELECT id FROM trials WHERE id = ?').bind(jane.id).first()).not.toBeNull();
  });

  it('answers 503 when the secrets or the database are missing', async () => {
    const noSecrets = await handleRecordsSearchApi(api('/api/pinchpdf/records/v1/search', { q: 'jane' }), { ...creds, TRIAL_DB: env.TRIAL_DB }, NOW, PINCHPDF);
    expect(noSecrets.status).toBe(503);
    const noDb = await handleRecordsSearchApi(api('/api/nodupe/records/v1/search', { q: 'jane' }), { ...full(), NODUPE_DB: undefined }, NOW, NODUPE);
    expect(noDb.status).toBe(503);
  });
});

describe('/admin/records page', () => {
  it('shows the search form without scripts, and keeps names and emails out of URLs', async () => {
    const response = await handleAdminRecords(request('/admin/records', undefined, { method: 'GET', type: null }), full(), NOW);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).not.toContain('script-src');
    const html = await response.text();
    expect(html).not.toContain('<script');
    expect(html).toContain('method="post" action="/admin/records"');
    expect(html).not.toContain('method="get"');
    expect(html).toContain('href="/admin/records"');
  });

  it('searches both products and shows the contact data, escaped', async () => {
    await addTrial(PINCHPDF, '<img src=x onerror=alert(1)>', 'xss@example.com');
    await addTrial(NODUPE, 'Nora Nodupe', 'nora@example.com');
    const xss = await (await handleAdminRecords(form({ intent: 'search', product: 'all', q: 'example.com' }), full(), NOW)).text();
    expect(xss).not.toContain('<img src=x');
    expect(xss).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(xss).toContain('Nora Nodupe');
    expect(xss).toContain('Basic 2/5, Similar 1/3, Deep 0/1');
    const pinchOnly = await (await handleAdminRecords(form({ intent: 'search', product: 'pinchpdf', q: 'example.com' }), full(), NOW)).text();
    expect(pinchOnly).not.toContain('Nora Nodupe');
  });

  it('asks for a longer query, and for the support reference before deleting', async () => {
    const jane = await addTrial(PINCHPDF, 'Jane Public', 'jane@example.com');
    expect((await handleAdminRecords(form({ intent: 'search', product: 'all', q: 'ab' }), full(), NOW)).status).toBe(400);

    const base = { product: 'pinchpdf', view: 'all', id: jane.id, action: 'delete', reason: 'Deletion request' };
    const wrong = await handleAdminRecords(form({ ...base, confirm: 'WRONG' }), full(), NOW);
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toContain('does not match');
    expect(await env.TRIAL_DB.prepare('SELECT id FROM trials WHERE id = ?').bind(jane.id).first()).not.toBeNull();

    const noReason = await handleAdminRecords(form({ ...base, reason: ' ', confirm: jane.ref }), full(), NOW);
    expect(noReason.status).toBe(400);

    const done = await handleAdminRecords(form({ ...base, confirm: jane.ref.toLowerCase() }), full(), NOW);
    expect(done.status).toBe(200);
    const html = await done.text();
    expect(html).toContain(`Deleted record ${jane.ref}`);
    expect(html).not.toContain('Jane Public');
    expect(await env.TRIAL_DB.prepare('SELECT id FROM trials WHERE id = ?').bind(jane.id).first()).toBeNull();
    expect(await env.TRIAL_DB.prepare('SELECT operator FROM trial_audit WHERE action = ?').bind('delete-all').first()).toEqual({ operator: 'admin-ui' });
  });

  it('erases only the contact data from the page', async () => {
    const jane = await addTrial(NODUPE, 'Jane Public', 'jane@example.com');
    const response = await handleAdminRecords(form({ product: 'nodupe', view: 'nodupe', id: jane.id, action: 'erase_contact', reason: 'Please remove me', confirm: jane.ref }), full(), NOW);
    expect(await response.text()).toContain('Erased the name and email');
    expect(await env.NODUPE_DB.prepare('SELECT name_enc, used FROM trials WHERE id = ?').bind(jane.id).first()).toEqual({ name_enc: null, used: 3 });
  });

  it('accepts the form as a browser sends it from the page itself (Origin: null under no-referrer)', async () => {
    await addTrial(PINCHPDF, 'Jane Public', 'jane@example.com');
    const response = await handleAdminRecords(form({ intent: 'search', product: 'all', q: 'jane' }, { origin: 'null', site: 'same-origin' }), full(), NOW);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Jane Public');
  });

  it('refuses Origin: null unless Sec-Fetch-Site says same-origin', async () => {
    const jane = await addTrial(PINCHPDF, 'Jane Public', 'jane@example.com');
    const fields = { product: 'pinchpdf', view: 'all', id: jane.id, action: 'delete', reason: 'Forged', confirm: jane.ref };
    expect((await handleAdminRecords(form(fields, { origin: 'null', site: 'cross-site' }), full(), NOW)).status).toBe(403);
    expect((await handleAdminRecords(form(fields, { origin: 'null' }), full(), NOW)).status).toBe(403);
    expect(await env.TRIAL_DB.prepare('SELECT id FROM trials WHERE id = ?').bind(jane.id).first()).not.toBeNull();
  });

  it('refuses a form that comes from another site', async () => {
    const jane = await addTrial(PINCHPDF, 'Jane Public', 'jane@example.com');
    const response = await handleAdminRecords(form({ product: 'pinchpdf', view: 'all', id: jane.id, action: 'delete', reason: 'Forged', confirm: jane.ref }, { origin: 'https://evil.example' }), full(), NOW);
    expect(response.status).toBe(403);
    expect(await env.TRIAL_DB.prepare('SELECT id FROM trials WHERE id = ?').bind(jane.id).first()).not.toBeNull();
  });

  it('says so when the secrets are missing instead of showing a blank page', async () => {
    const response = await handleAdminRecords(form({ intent: 'search', product: 'all', q: 'jane' }), { ...creds, TRIAL_DB: env.TRIAL_DB }, NOW);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('PII_KEY');
  });
});

describe('input cleaning', () => {
  it('trims and collapses a query, and refuses control characters', () => {
    expect(cleanQuery('  Jane   Q  ')).toBe('Jane Q');
    expect(cleanQuery('ab')).toBeNull();
    expect(cleanQuery('a\u0007bc')).toBeNull();
    expect(cleanReason('  needs a reason  ')).toBe('needs a reason');
    expect(cleanReason('no')).toBeNull();
  });
});
