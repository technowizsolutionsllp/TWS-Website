// NoDupe's trial service: the same flow as PinchPDF's (challenge, proof of work, sealed register, signed usage,
// one trial per computer), in NoDupe's own database, with one counter per scan mode (basic 5, similar 3, deep 1).

import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { NOW, call, fetchChallenge, newDevice, newInstall, lookup, register, reportModeUsage, reportUsage, seal, solve } from './client';
import { handleRegister } from '../lib/trial/handlers';
import type { TrialEnv } from '../lib/trial/config';
import { runWithEnv } from '../lib/trial/runtime';
import { NODUPE, PINCHPDF } from '../lib/trial/product';

const e = env as unknown as TrialEnv;
const nodupe = (q: string, ...args: unknown[]) => e.NODUPE_DB!.prepare(q).bind(...args).all<Record<string, unknown>>().then((r) => r.results);
const pinch = (q: string, ...args: unknown[]) => e.TRIAL_DB.prepare(q).bind(...args).all<Record<string, unknown>>().then((r) => r.results);
const reg = (options: Parameters<typeof register>[1] = {}) => register(e, { product: NODUPE, ...options });
const none = { basic: 0, similar: 0, deep: 0 };
const limits = { basic: 5, similar: 3, deep: 1 };

describe('NoDupe /register', () => {
  it('registers a trial with the free allowance per mode (5 basic, 3 similar, 1 deep)', async () => {
    const { reply } = await reg();
    expect(reply.status).toBe(200);
    expect(reply.result).toMatchObject({ result: 'registered', state: 'active', used: none, limit: limits });
    expect(String(reply.result!.support_ref)).toMatch(/^[A-Za-z0-9]{8}$/);
    const [row] = await nodupe('SELECT product, used, limit_total, limit_basic, limit_similar, limit_deep, terms_version, privacy_version FROM trials');
    expect(row).toMatchObject({ product: 'nodupe', used: 0, limit_total: 9, limit_basic: 5, limit_similar: 3, limit_deep: 1, terms_version: '2026-11-28', privacy_version: '2026-11-28' });
  });

  it('keeps everything in the NoDupe database and nothing in PinchPDF\'s', async () => {
    await reg();
    expect(await nodupe('SELECT 1 FROM trials')).toHaveLength(1);
    expect(await pinch('SELECT 1 FROM trials')).toHaveLength(0);
  });

  it('stores the name and email encrypted, never in clear', async () => {
    await reg({ name: 'Zed Zebra', email: 'zed@example.org' });
    const dump = JSON.stringify(await nodupe('SELECT * FROM trials'));
    expect(dump).not.toContain('Zed Zebra');
    expect(dump).not.toContain('zed@example.org');
  });

  it('is idempotent for the same install key (replay returns the same trial and counts)', async () => {
    const first = await reg();
    const again = await reg({ install: first.install, device: first.device });
    expect(again.reply.result).toMatchObject({ result: 'registered', trial_id: first.reply.result!.trial_id, used: none });
    expect(await nodupe('SELECT 1 FROM trials')).toHaveLength(1);
  });

  it('allows one trial per computer: a second install on the same computer is already_used', async () => {
    const first = await reg();
    const second = await reg({ device: first.device });
    expect(second.reply.result).toEqual({
      result: 'already_used',
      support_ref: first.reply.result!.support_ref,
      registered_at: NOW / 1000,
      name_hint: 'J••• D•••',
    });
    expect(await nodupe('SELECT 1 FROM trials')).toHaveLength(1);
  });

  it('does not let a PinchPDF trial block a NoDupe trial on the same computer, nor the reverse', async () => {
    const device = newDevice();
    const pinchFirst = await register(e, { device });
    expect(pinchFirst.reply.result).toMatchObject({ result: 'registered' });
    const nodupeFirst = await reg({ device });
    expect(nodupeFirst.reply.result).toMatchObject({ result: 'registered' });
    expect(await pinch('SELECT 1 FROM trials')).toHaveLength(1);
    expect(await nodupe('SELECT 1 FROM trials')).toHaveLength(1);
    // and each product still blocks a repeat on its own side
    expect((await reg({ device })).reply.result).toMatchObject({ result: 'already_used' });
    expect((await register(e, { device })).reply.result).toMatchObject({ result: 'already_used' });
  });

  it('registers an existing install with the scans it already used, never giving it a fresh trial', async () => {
    const { reply } = await reg({ used: { basic: 3, similar: 3, deep: 0 } });
    expect(reply.result).toMatchObject({ result: 'registered', state: 'active', used: { basic: 3, similar: 3, deep: 0 }, limit: limits });
    const [row] = await nodupe('SELECT used, used_basic, used_similar, used_deep FROM trials');
    expect(row).toEqual({ used: 6, used_basic: 3, used_similar: 3, used_deep: 0 });
  });

  it('clamps initial counts to the limits, and is exhausted only when every mode is', async () => {
    const some = await reg({ used: { basic: 99, similar: 99, deep: 0 } });
    expect(some.reply.result).toMatchObject({ state: 'active', used: { basic: 5, similar: 3, deep: 0 } });
    const all = await reg({ used: { basic: 50, similar: 50, deep: 50 } });
    expect(all.reply.result).toMatchObject({ state: 'exhausted', used: limits });
  });

  it('rejects malformed initial counts', async () => {
    for (const used of [[], { basic: 1, similar: 1 }, { basic: 1, similar: 1, deep: 1, x: 1 }, { basic: -1, similar: 0, deep: 0 }, { basic: 1.5, similar: 0, deep: 0 }, { basic: '1', similar: 0, deep: 0 }, 7]) {
      const { reply } = await reg({ overrides: { used } });
      expect(reply.status, JSON.stringify(used)).toBe(400);
    }
    expect(await nodupe('SELECT 1 FROM trials')).toHaveLength(0);
  });

  it('answers terms_outdated for another version, and checks NoDupe\'s own versions, not PinchPDF\'s', async () => {
    // NoDupe's superseded 2026-11-24 text, and PinchPDF's superseded 2026-11-20 text, are both refused
    const stale = await reg({ consent: { terms_version: '2026-11-24', privacy_version: '2026-11-24', accepted_at: 1 } });
    expect(stale.reply.result).toEqual({ result: 'terms_outdated', terms_version: '2026-11-28', privacy_version: '2026-11-28' });
    const other = await reg({ consent: { terms_version: '2026-11-20', privacy_version: '2026-11-20', accepted_at: 1 } });
    expect(other.reply.result).toMatchObject({ result: 'terms_outdated' });
    // and each product reads its own setting: changing NoDupe's leaves PinchPDF's alone
    const split = { ...e, NODUPE_TRIAL_TERMS_VERSION: '2099-01-01' } as TrialEnv;
    const pinchStill = await register(split, { consent: { terms_version: '2026-11-28', privacy_version: '2026-11-28', accepted_at: 1 } });
    expect(pinchStill.reply.result).toMatchObject({ result: 'registered' });
    const nodupeMoved = await register(split, { product: NODUPE, consent: { terms_version: '2026-11-28', privacy_version: '2026-11-28', accepted_at: 1 } });
    expect(nodupeMoved.reply.result).toEqual({ result: 'terms_outdated', terms_version: '2099-01-01', privacy_version: '2026-11-28' });
  });

  it('refuses a challenge issued for PinchPDF (the challenge is domain-separated per product)', async () => {
    const install = await newInstall();
    const { json } = await fetchChallenge(e, install.publicB64, NOW, PINCHPDF);
    const solution = await solve(json.challenge!, Number(e.TRIAL_DIFFICULTY));
    const { reply } = await reg({ install, overrides: { challenge: json.challenge, solution } });
    expect(reply.status).toBe(400);
    expect(await nodupe('SELECT 1 FROM trials')).toHaveLength(0);
  });

  it('refuses a request sealed for the PinchPDF path (the envelope binds the product path)', async () => {
    const { body } = await register(e, {});
    const sealed = await seal(e, 'register', body, 'k1', PINCHPDF);
    const request = new Request('https://technowizsolutions.com/api/nodupe/trial/v1/register', { method: 'POST', body: JSON.stringify(sealed.envelope) });
    expect((await handleRegister(request, e, () => NOW, NODUPE)).status).toBe(400);
  });

  it('answers 503 when the NoDupe database is not bound, and PinchPDF keeps working', async () => {
    const unbound = { ...e, NODUPE_DB: undefined } as unknown as TrialEnv;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = await register(unbound, { product: NODUPE });
    expect(down.reply.status).toBe(503);
    error.mockRestore();
    expect((await register(unbound, {})).reply.result).toMatchObject({ result: 'registered' });
  });

  it('is reported as unconfigured when NoDupe\'s version settings are missing', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await runWithEnv({ ...e, NODUPE_TRIAL_TERMS_VERSION: undefined } as unknown as TrialEnv, async () => new Response('ran'), NOW, NODUPE);
    expect(response.status).toBe(503);
    const pinchResponse = await runWithEnv({ ...e, NODUPE_TRIAL_TERMS_VERSION: undefined } as unknown as TrialEnv, async () => new Response('ran'), NOW, PINCHPDF);
    expect(await pinchResponse.text()).toBe('ran');
    warn.mockRestore();
  });
});

describe('NoDupe /usage', () => {
  async function trial(used = none) {
    const r = await reg({ used });
    return { install: r.install, id: String(r.reply.result!.trial_id) };
  }

  it('raises each mode independently and never lowers one (highest value wins)', async () => {
    const { install, id } = await trial();
    const a = await reportModeUsage(e, NODUPE, install, id, { basic: 2, similar: 1, deep: 0 });
    expect(a.result).toMatchObject({ result: 'ok', state: 'active', used: { basic: 2, similar: 1, deep: 0 }, limit: limits });
    const b = await reportModeUsage(e, NODUPE, install, id, { basic: 1, similar: 3, deep: 0 });
    expect(b.result).toMatchObject({ used: { basic: 2, similar: 3, deep: 0 } }); // basic stays at 2, similar rises
    const [row] = await nodupe('SELECT used, used_basic, used_similar, used_deep FROM trials');
    expect(row).toEqual({ used: 5, used_basic: 2, used_similar: 3, used_deep: 0 });
  });

  it('caps each mode at its limit, and is exhausted only when all three are', async () => {
    const { install, id } = await trial();
    const partial = await reportModeUsage(e, NODUPE, install, id, { basic: 99, similar: 99, deep: 0 });
    expect(partial.result).toMatchObject({ state: 'active', used: { basic: 5, similar: 3, deep: 0 } });
    const full = await reportModeUsage(e, NODUPE, install, id, { basic: 5, similar: 3, deep: 1 });
    expect(full.result).toMatchObject({ state: 'exhausted', used: limits });
  });

  it('verifies the install-key signature over the three counts before writing', async () => {
    const { install, id } = await trial();
    const forged = await reportModeUsage(e, NODUPE, install, id, { basic: 5, similar: 3, deep: 1 }, NOW, none);
    expect(forged.status).toBe(400);
    const intruder = await newInstall();
    expect((await reportModeUsage(e, NODUPE, intruder, id, { basic: 1, similar: 0, deep: 0 })).status).toBe(400);
    expect((await nodupe('SELECT used FROM trials'))[0].used).toBe(0);
  });

  it('refuses a PinchPDF-signed usage report (the signing prefix differs)', async () => {
    const { install, id } = await trial();
    const sig = await install.sign(`pinchpdf-trial-usage-v1|${id}|1|0|0`);
    const reply = await call(e, 'usage', { proto: 1, trial_id: id, used: { basic: 1, similar: 0, deep: 0 }, sig }, { product: NODUPE });
    expect(reply.status).toBe(400);
  });

  it('rejects malformed reports and answers unknown_trial for an unknown id', async () => {
    const { install, id } = await trial();
    for (const used of [5, null, [], { basic: 1, similar: 1 }, { basic: 1, similar: 1, deep: 1, x: 1 }, { basic: -1, similar: 0, deep: 0 }, { basic: 1_000_001, similar: 0, deep: 0 }]) {
      const reply = await call(e, 'usage', { proto: 1, trial_id: id, used, sig: await install.sign('x') }, { product: NODUPE });
      expect(reply.status, JSON.stringify(used)).toBe(400);
    }
    expect((await reportModeUsage(e, NODUPE, install, 'nope', none)).result).toEqual({ result: 'unknown_trial' });
  });

  it('does not accept a single-number report (that is PinchPDF\'s format) for NoDupe, nor the reverse', async () => {
    const { install, id } = await trial();
    expect((await reportUsage(e, install, id, 1)).result).toEqual({ result: 'unknown_trial' }); // PinchPDF's DB has no such trial
    const reply = await call(e, 'usage', { proto: 1, trial_id: id, used: 1, sig: await install.sign(`nodupe-trial-usage-v1|${id}|1`) }, { product: NODUPE });
    expect(reply.status).toBe(400);
  });

  it('counts requests in the NoDupe database under product nodupe', async () => {
    await reg();
    expect(await nodupe('SELECT DISTINCT product FROM metrics_daily')).toEqual([{ product: 'nodupe' }]);
    expect(await pinch('SELECT 1 FROM metrics_daily')).toHaveLength(0);
  });
});

// Protocol revision 5, NoDupe's copy: the same rules, with one count per scan mode.
describe('NoDupe /lookup and Continue (revision 5)', () => {
  const DOTS = '•••';

  it('describes a recognised computer\'s trial per mode, with the email masked', async () => {
    const first = await reg({ email: 'sam@example.org', used: { basic: 2, similar: 1, deep: 0 } });
    const found = await lookup(e, first.device, { product: NODUPE });
    expect(found.result).toEqual({
      result: 'found',
      state: 'active',
      used: { basic: 2, similar: 1, deep: 0 },
      limit: limits,
      registered_at: NOW / 1000,
      email_hint: `s${DOTS}@example.org`,
      support_ref: first.reply.result!.support_ref,
    });
    expect((await lookup(e, newDevice(), { product: NODUPE })).result).toEqual({ result: 'none' });
  });

  it('continues the trial with resume and merges the counts the install reports, per mode, never lowering one', async () => {
    const first = await reg({ email: 'sam@example.org', used: { basic: 2, similar: 1, deep: 0 } });
    const { trial_id: id, support_ref: ref } = first.reply.result!;
    const again = await reg({
      device: first.device,
      used: { basic: 1, similar: 9, deep: 0 },
      overrides: { resume: ref, name: undefined, email: undefined },
    });
    expect(again.reply.result).toEqual({
      result: 'registered',
      trial_id: id,
      state: 'active',
      used: { basic: 2, similar: 3, deep: 0 },
      limit: limits,
      registered_at: NOW / 1000,
      support_ref: ref,
      restored: true,
    });
    const [row] = await nodupe(`SELECT used, used_basic, used_similar, used_deep, pubkey, pubkey_retired FROM trials WHERE id = '${id}'`);
    expect(row).toMatchObject({ used: 5, used_basic: 2, used_similar: 3, used_deep: 0, pubkey: again.install.publicB64, pubkey_retired: first.install.publicB64 });
    const audit = await nodupe(`SELECT action, reason, operator, details FROM trial_audit WHERE trial_id = '${id}'`);
    expect(audit).toEqual([{ action: 'restore', reason: 'resume', operator: 'service', details: JSON.stringify({ used: { basic: 2, similar: 1, deep: 0 }, previous_key: first.install.publicB64 }) }]);
  });

  it('continues by the same email and refuses another email with the date and the masked name', async () => {
    const first = await reg({ name: 'Sam Lee', email: 'sam@example.org' });
    const refused = await reg({ device: first.device, email: 'someone@example.org' });
    expect(refused.reply.result).toEqual({
      result: 'already_used',
      support_ref: first.reply.result!.support_ref,
      registered_at: NOW / 1000,
      name_hint: `S${DOTS} L${DOTS}`,
    });
    const again = await reg({ device: first.device, email: 'SAM@example.org' });
    expect(again.reply.result).toMatchObject({ result: 'registered', trial_id: first.reply.result!.trial_id, restored: true });
  });

  it('keeps the two products apart: a PinchPDF trial is not found by a NoDupe lookup', async () => {
    const device = newDevice();
    await register(e, { device });
    expect((await lookup(e, device, { product: NODUPE })).result).toEqual({ result: 'none' });
    expect((await lookup(e, device, { product: PINCHPDF })).result).toMatchObject({ result: 'found' });
  });
});
