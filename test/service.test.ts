// Worker tests: register, usage, challenge and operator-state behaviour against a local D1.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { NOW, call, fetchChallenge, newDevice, newInstall, register, reportUsage, seal, hashDevice, solve } from './client';
import { b64urlDecode, b64urlEncode } from '../lib/trial/bytes';
import { handleChallenge, handleRegister, handleUsage } from '../lib/trial/handlers';
import { clientSignalHash } from '../lib/trial/signals';
import { decryptField } from '../lib/trial/pii';
import { insertTrial } from '../lib/trial/db';
import type { TrialEnv } from '../lib/trial/config';

const e = env as unknown as TrialEnv;
const sql = (q: string, ...args: unknown[]) => e.TRIAL_DB.prepare(q).bind(...args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowFor = (id: string) => sql('SELECT * FROM trials WHERE id = ?', id).first<Record<string, any>>();
const SECOND = 1000;

// Mimics the operator's reset-device (scripts/trial-admin.mjs) for state-machine tests.
async function operatorReset(id: string) {
  await sql(
    `UPDATE trials SET status = 'reset', pubkey_retired = pubkey, pubkey = NULL,
       h_guid = NULL, h_smbios = NULL, h_board = NULL, used_at_reset = used WHERE id = ?`,
    id,
  ).run();
}

describe('/challenge', () => {
  it('returns a 57-byte challenge bound to the key, plain JSON', async () => {
    const install = await newInstall();
    const { response, json } = await fetchChallenge(e, install.publicB64);
    expect(response.status).toBe(200);
    expect(b64urlDecode(json.challenge)!.length).toBe(57);
    expect(json.expires_at).toBe(NOW / SECOND + 600);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects bad input without touching anything else', async () => {
    const post = (body: string) => handleChallenge(new Request('https://x/c', { method: 'POST', body }), e, () => NOW);
    expect((await post('not json')).status).toBe(400);
    expect((await post(JSON.stringify({ proto: 2, pubkey: b64urlEncode(new Uint8Array(32)) }))).status).toBe(400);
    expect((await post(JSON.stringify({ proto: 1, pubkey: 'short' }))).status).toBe(400);
    expect((await post('x'.repeat(2000))).status).toBe(400);
  });
});

describe('/register', () => {
  it('registers a first trial (scenario 1) with count 0 and the configured limit', async () => {
    const { reply } = await register(e);
    expect(reply.status).toBe(200);
    expect(reply.result).toMatchObject({ result: 'registered', state: 'active', used: 0, limit: 5, registered_at: NOW / SECOND });
    expect(reply.result!.support_ref).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(b64urlDecode(reply.result!.trial_id)!.length).toBe(16);
  });

  it('stores contact data encrypted, signals only as keyed hashes, and the server clock', async () => {
    const device = newDevice();
    const { reply } = await register(e, { device, name: 'Jane Doe', email: 'Jane@Example.com' });
    const row = (await rowFor(reply.result!.trial_id))!;
    expect(row.name_enc).toMatch(/^v1\./);
    expect(row.email_enc).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain('Jane');
    expect(JSON.stringify(row)).not.toContain('example.com');
    expect(await decryptField(e, row.id, 'email', row.email_enc)).toBe('Jane@Example.com');
    expect(await decryptField(e, row.id, 'name', row.name_enc)).toBe('Jane Doe');
    // the raw client hash is never stored, only the peppered one
    expect(JSON.stringify(row)).not.toContain(await clientSignalHash('guid', device.guid!));
    expect(row.received_at).toBe(NOW / SECOND);
    expect(row.accepted_at).toBe(NOW / SECOND - 5);
    // a field encrypted for one trial does not open under another id
    expect(await decryptField(e, 'another-id', 'email', row.email_enc)).toBeNull();
  });

  it('is idempotent per install key and returns the CURRENT used and state (scenario 3)', async () => {
    const first = await register(e);
    const id = first.reply.result!.trial_id;
    await reportUsage(e, first.install, id, 2);
    const { install, device } = first;
    const replay = await register(e, { install, device });
    expect(replay.reply.result).toMatchObject({ result: 'registered', trial_id: id, used: 2, state: 'active' });
    const { results } = await sql('SELECT id FROM trials').all();
    expect(results.length).toBe(1);
  });

  it('lets a second machine register (scenario 5 contrast) and blocks the same machine under a new key', async () => {
    const device = newDevice();
    const one = await register(e, { device });
    const sameMachine = await register(e, { device, name: 'Someone Else', email: 'else@example.com' });
    expect(sameMachine.reply.result).toEqual({ result: 'already_used', support_ref: one.reply.result!.support_ref });
    const other = await register(e);
    expect(other.reply.result!.result).toBe('registered');
  });

  it('applies the matching policy: reinstall blocked, one change blocked, two or three changes allowed (scenarios 6 to 8)', async () => {
    const device = newDevice();
    await register(e, { device });
    const guidChanged = await register(e, { device: { ...device, guid: 'new-guid' } });
    expect(guidChanged.reply.result!.result).toBe('already_used'); // smbios + board still match
    const boardChanged = await register(e, { device: { ...device, board: 'new-board' } });
    expect(boardChanged.reply.result!.result).toBe('already_used');
    const twoChanged = await register(e, { device: { guid: 'g2', smbios: 'sm2', board: device.board } });
    expect(twoChanged.reply.result!.result).toBe('registered');
    const threeChanged = await register(e, { device: newDevice() });
    expect(threeChanged.reply.result!.result).toBe('registered');
  });

  it('handles fewer usable signals (scenarios 9 and 10)', async () => {
    const onlyGuid = { guid: 'solo-guid', smbios: null, board: null };
    expect((await register(e, { device: onlyGuid })).reply.result!.result).toBe('registered');
    expect((await register(e, { device: onlyGuid })).reply.result!.result).toBe('already_used');
    // a full row blocks a request with one equal usable signal (the only one the request has)
    const full = newDevice();
    await register(e, { device: full });
    expect((await register(e, { device: { guid: full.guid, smbios: null, board: null } })).reply.result!.result).toBe('already_used');
    // a row with only one usable signal blocks when that signal matches, even if the request has three
    const solo = { guid: null, smbios: 'solo-smbios', board: null };
    await register(e, { device: solo });
    expect((await register(e, { device: { guid: 'x1', smbios: 'solo-smbios', board: 'x3' } })).reply.result!.result).toBe('already_used');
    // no usable signal at all
    const none = await register(e, { device: { guid: null, smbios: null, board: null } });
    expect(none.reply.result).toEqual({ result: 'unsupported_device' });
    const { results } = await sql('SELECT id FROM trials').all();
    expect(results.length).toBe(3); // the unsupported request stored nothing
  });

  it('never lets placeholder signals block, or count as usable', async () => {
    const placeholder = { guid: 'default string', smbios: '00000000-0000-0000-0000-000000000000', board: 'to be filled by o.e.m.' };
    const first = await register(e, { device: placeholder });
    expect(first.reply.result).toEqual({ result: 'unsupported_device' });
    // placeholder mixed with a real value: the real one is the only usable signal
    const mixed = { guid: 'real-guid', smbios: '00000000-0000-0000-0000-000000000000', board: 'n/a' };
    expect((await register(e, { device: mixed })).reply.result!.result).toBe('registered');
    expect((await register(e, { device: { ...mixed, board: 'default string' } })).reply.result!.result).toBe('already_used');
  });

  it('keeps signal types separate', async () => {
    const value = 'same-value-everywhere';
    await register(e, { device: { guid: value, smbios: null, board: null } });
    // identical text, but as the smbios column: client hash and server input both differ
    expect((await register(e, { device: { guid: null, smbios: value, board: null } })).reply.result!.result).toBe('registered');
  });

  it('validates fields and returns the field name', async () => {
    expect((await register(e, { email: 'not-an-email' })).reply.result).toEqual({ result: 'invalid', field: 'email' });
    expect((await register(e, { email: `${'a'.repeat(250)}@example.com` })).reply.result).toEqual({ result: 'invalid', field: 'email' });
    expect((await register(e, { name: '   ' })).reply.result).toEqual({ result: 'invalid', field: 'name' });
    expect((await register(e, { name: 'x'.repeat(101) })).reply.result).toEqual({ result: 'invalid', field: 'name' });
    expect((await register(e, { name: 'Bad\u0000Name' })).reply.result).toEqual({ result: 'invalid', field: 'name' });
    expect((await register(e, { consent: { terms_version: e.TRIAL_TERMS_VERSION, privacy_version: e.TRIAL_PRIVACY_VERSION } })).reply.result).toEqual({ result: 'invalid', field: 'consent' });
    const { results } = await sql('SELECT id FROM trials').all();
    expect(results.length).toBe(0);
  });

  it('rejects outdated terms and never accepts an older version (scenario 23)', async () => {
    const consent = { terms_version: '2025-01-01', privacy_version: e.TRIAL_PRIVACY_VERSION, accepted_at: 1 };
    const { reply } = await register(e, { consent });
    expect(reply.result).toEqual({ result: 'terms_outdated', terms_version: e.TRIAL_TERMS_VERSION, privacy_version: e.TRIAL_PRIVACY_VERSION });
  });

  it('applies the challenge age rules at the server (599, 600, 601 seconds)', async () => {
    const at = (age: number) => register(e, { challengeNow: NOW - age * SECOND });
    expect((await at(599)).reply.result!.result).toBe('registered');
    expect((await at(600)).reply.result!.result).toBe('registered');
    expect((await at(601)).reply.result).toEqual({ result: 'challenge_expired' });
    // a challenge from the future beyond 30 s is invalid, within 30 s is fine
    expect((await register(e, { challengeNow: NOW + 30 * SECOND })).reply.result!.result).toBe('registered');
    expect((await register(e, { challengeNow: NOW + 31 * SECOND })).reply.status).toBe(400);
  });

  it('rejects a challenge made for another key, a bad solution and a stale difficulty', async () => {
    const install = await newInstall();
    const other = await newInstall();
    const { json } = await fetchChallenge(e, other.publicB64);
    const device = newDevice();
    const signals = await hashDevice(device);
    const base = {
      proto: 1,
      pubkey: install.publicB64,
      name: 'A',
      email: 'a@example.com',
      consent: { terms_version: e.TRIAL_TERMS_VERSION, privacy_version: e.TRIAL_PRIVACY_VERSION, accepted_at: 1 },
      signals,
    };
    const solution = await solve(json.challenge!, 8);
    expect((await call(e, 'register', { ...base, challenge: json.challenge, solution })).status).toBe(400);

    const mine = (await fetchChallenge(e, install.publicB64)).json;
    expect((await call(e, 'register', { ...base, challenge: mine.challenge, solution: b64urlEncode(new Uint8Array(8).fill(1)) })).status).toBe(400);

    const raised = { ...e, TRIAL_DIFFICULTY: '12' } as TrialEnv;
    const staleRequest = await seal(raised, 'register', { ...base, challenge: mine.challenge, solution: await solve(mine.challenge!, 12) });
    const reply = await handleRegister(new Request('https://x', { method: 'POST', body: JSON.stringify(staleRequest.envelope) }), raised, () => NOW);
    expect(reply.status).toBe(200); // sealed challenge_expired, not an error: the app refetches once
  });

  it('refuses a challenge from an earlier difficulty after the operator raises it', async () => {
    const lower = { ...e, TRIAL_DIFFICULTY: '8' } as TrialEnv;
    const higher = { ...e, TRIAL_DIFFICULTY: '10' } as TrialEnv;
    const install = await newInstall();
    const device = newDevice();
    const { json } = await fetchChallenge(lower, install.publicB64);
    const body = {
      proto: 1, challenge: json.challenge, solution: await solve(json.challenge!, 8), pubkey: install.publicB64,
      name: 'A', email: 'a@example.com',
      consent: { terms_version: e.TRIAL_TERMS_VERSION, privacy_version: e.TRIAL_PRIVACY_VERSION, accepted_at: 1 },
      signals: await hashDevice(device),
    };
    expect((await call(higher, 'register', body)).result).toEqual({ result: 'challenge_expired' });
  });

  it('rejects malformed envelopes, unknown kids and oversize bodies without D1 work', async () => {
    const install = await newInstall();
    const body = { proto: 1 };
    expect((await call(e, 'register', body, { mutate: (v) => { v.v = 2; } })).status).toBe(400);
    expect((await call(e, 'register', body, { mutate: (v) => { v.n = 'AAAA'; } })).status).toBe(400);
    expect((await call(e, 'register', body, { mutate: (v) => { v.epk = b64urlEncode(new Uint8Array(31)); } })).status).toBe(400);
    expect((await call(e, 'register', body, { mutate: (v) => { v.ct = 'AAAA'; } })).status).toBe(400);
    expect((await call(e, 'register', body, { mutate: (v) => { v.epk = b64urlEncode(new Uint8Array(32)); } })).status).toBe(400); // low-order point
    expect((await call(e, 'register', body, { mutate: (v) => { v.kid = 'zz'; } })).plain).toEqual({ error: 'kid_unsupported' });
    const retired = { ...e, ACCEPTED_KIDS: 'k1' } as TrialEnv; // k0 has a secret but is no longer accepted
    const reply = await call(retired, 'register', body, { kid: 'k0', now: NOW });
    expect(reply).toMatchObject({ status: 421, plain: { error: 'kid_unsupported' } });
    const huge = await handleRegister(new Request('https://x', { method: 'POST', body: 'x'.repeat(9000) }), e, () => NOW);
    expect(huge.status).toBe(400);
    expect(install).toBeTruthy();
  });

  it('accepts either configured kid (scenario 24)', async () => {
    const withK0 = await call(e, 'register', { proto: 1, pubkey: 'x' }, { kid: 'k0' });
    expect(withK0.status).toBe(400); // opened fine; the body is simply not a valid registration
    expect(withK0.plain).toEqual({ error: 'bad_request' });
  });

  it('resolves a concurrent pair of registrations from one machine to a single trial', async () => {
    const device = newDevice();
    const [a, b] = await Promise.all([register(e, { device }), register(e, { device })]);
    const results = [a.reply.result!.result, b.reply.result!.result].sort();
    expect(results).toEqual(['already_used', 'registered']);
    const { results: rows } = await sql('SELECT id FROM trials').all();
    expect(rows.length).toBe(1);
  });

  it('returns 503 when D1 fails and never a trial decision', async () => {
    const broken = { ...e, TRIAL_DB: { prepare: () => { throw new Error('D1_ERROR: quota'); } } } as unknown as TrialEnv;
    const install = await newInstall();
    const { json } = await fetchChallenge(broken, install.publicB64);
    const body = {
      proto: 1, challenge: json.challenge, solution: await solve(json.challenge!, 8), pubkey: install.publicB64,
      name: 'A', email: 'a@example.com',
      consent: { terms_version: e.TRIAL_TERMS_VERSION, privacy_version: e.TRIAL_PRIVACY_VERSION, accepted_at: 1 },
      signals: await hashDevice(newDevice()),
    };
    expect(await call(broken, 'register', body)).toMatchObject({ status: 503, plain: { error: 'unavailable' } });
  });

  it('applies the rate limiter binding when present (429 with Retry-After)', async () => {
    const limiter = { limit: async () => ({ success: false }) };
    const limited = { ...e, TRIAL_REGISTER_LIMITER: limiter, TRIAL_CHALLENGE_LIMITER: limiter, TRIAL_USAGE_LIMITER: limiter } as TrialEnv;
    const register429 = await handleRegister(new Request('https://x', { method: 'POST', body: '{}' }), limited, () => NOW);
    expect(register429.status).toBe(429);
    expect(register429.headers.get('retry-after')).toBe('60');
    const challenge429 = await handleChallenge(new Request('https://x', { method: 'POST', body: '{}' }), limited, () => NOW);
    expect(challenge429.status).toBe(429);
  });

  it('writes few D1 rows per registration (website plan target: about 11 including indexes)', async () => {
    const written = await insertTrial(e.TRIAL_DB, {
      id: 'rows-written-probe', pubkey: 'probe-key', supportRef: 'ABCDEFGH',
      signals: { guid: 'g', smbios: 's', board: 'b' }, nameEnc: 'v1.a.b', emailEnc: 'v1.a.b', emailBidx: 'idx',
      limit: 5, termsVersion: 't', privacyVersion: 'p', acceptedAt: 1, now: 2, appVersion: null, osBuild: null,
    });
    console.info(`rows_written for one registration insert (local D1): ${written}`);
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThanOrEqual(8); // row + pk index + pubkey + 3 signals + email; +5 usage updates stays near 13
  });
});

describe('/usage', () => {
  async function registered() {
    const r = await register(e);
    return { install: r.install, id: r.reply.result!.trial_id as string };
  }

  it('raises the high-water mark with a signed cumulative count (scenarios 11, 13)', async () => {
    const { install, id } = await registered();
    expect((await reportUsage(e, install, id, 1)).result).toEqual({ result: 'ok', state: 'active', used: 1, limit: 5 });
    // reports for 2 and 3 were lost; the next carries the cumulative 4
    expect((await reportUsage(e, install, id, 4)).result).toEqual({ result: 'ok', state: 'active', used: 4, limit: 5 });
    expect((await rowFor(id))!.used).toBe(4);
  });

  it('ignores duplicates and delayed lower counts (scenarios 18, 19, 21)', async () => {
    const { install, id } = await registered();
    await reportUsage(e, install, id, 3);
    expect((await reportUsage(e, install, id, 3)).result!.used).toBe(3);
    expect((await reportUsage(e, install, id, 1)).result).toEqual({ result: 'ok', state: 'active', used: 3, limit: 5 });
    expect((await rowFor(id))!.used).toBe(3);
  });

  it('clamps to the limit and derives exhausted; a lower report never revives it', async () => {
    const { install, id } = await registered();
    expect((await reportUsage(e, install, id, 99)).result).toEqual({ result: 'ok', state: 'exhausted', used: 5, limit: 5 });
    expect((await reportUsage(e, install, id, 2)).result).toMatchObject({ state: 'exhausted', used: 5 });
    expect((await rowFor(id))!.status).toBe('active'); // exhausted is derived, never stored
  });

  it('counts at the boundary T - 1, T, T + 1', async () => {
    const { install, id } = await registered();
    expect((await reportUsage(e, install, id, 4)).result).toMatchObject({ state: 'active', used: 4 });
    expect((await reportUsage(e, install, id, 5)).result).toMatchObject({ state: 'exhausted', used: 5 });
    expect((await reportUsage(e, install, id, 6)).result).toMatchObject({ state: 'exhausted', used: 5 });
  });

  it('refuses a bad signature before writing anything', async () => {
    const { install, id } = await registered();
    const attacker = await newInstall();
    const before = (await rowFor(id))!;
    expect((await reportUsage(e, attacker, id, 5, NOW + 7200 * SECOND)).status).toBe(400);
    expect((await reportUsage(e, install, id, 5, NOW + 7200 * SECOND, 4)).status).toBe(400); // signed a different count
    expect(await rowFor(id)).toEqual(before);
  });

  it('answers unknown_trial for an unknown id (and does not write)', async () => {
    const install = await newInstall();
    expect((await reportUsage(e, install, 'does-not-exist', 1)).result).toEqual({ result: 'unknown_trial' });
  });

  it('suppresses contact-time writes within the hour, writes after (website plan: write suppression)', async () => {
    const { install, id } = await registered();
    await reportUsage(e, install, id, 1, NOW + 10 * SECOND);
    const afterFirst = (await rowFor(id))!.last_server_contact_at;
    expect(afterFirst).toBe(NOW / SECOND + 10);
    await reportUsage(e, install, id, 1, NOW + 600 * SECOND); // same count, 10 minutes later: no write
    expect((await rowFor(id))!.last_server_contact_at).toBe(afterFirst);
    await reportUsage(e, install, id, 1, NOW + 3700 * SECOND); // more than an hour: refresh
    expect((await rowFor(id))!.last_server_contact_at).toBe(NOW / SECOND + 3700);
  });

  it('reports revoked state once an operator revokes, and unrevoke restores the derived state (scenario 22)', async () => {
    const { install, id } = await registered();
    await sql(`UPDATE trials SET status = 'revoked' WHERE id = ?`, id).run();
    expect((await reportUsage(e, install, id, 1)).result).toEqual({ result: 'ok', state: 'revoked', used: 1, limit: 5 });
    await sql(`UPDATE trials SET status = 'active' WHERE id = ?`, id).run();
    expect((await reportUsage(e, install, id, 1)).result).toMatchObject({ state: 'active' });
    // the replayed registration also shows revoked
    await sql(`UPDATE trials SET status = 'revoked' WHERE id = ?`, id).run();
    const replay = await register(e, { install });
    expect(replay.reply.result).toMatchObject({ result: 'registered', state: 'revoked' });
  });

  it('rejects malformed reports', async () => {
    const { install, id } = await registered();
    for (const used of [-1, 1.5, '3', null]) {
      const reply = await call(e, 'usage', { proto: 1, trial_id: id, used, sig: await install.sign('x') });
      expect(reply.status, String(used)).toBe(400);
    }
    expect((await call(e, 'usage', { proto: 1, trial_id: id, used: 1 })).status).toBe(400);
    expect((await call(e, 'usage', { proto: 2, trial_id: id, used: 1, sig: 'AAAA' })).status).toBe(400);
  });

  it('is not reachable through handleUsage with a register envelope (AAD binds the endpoint)', async () => {
    const sealed = await seal(e, 'register', { proto: 1 });
    const reply = await handleUsage(new Request('https://x', { method: 'POST', body: JSON.stringify(sealed.envelope) }), e, () => NOW);
    expect(reply.status).toBe(400);
  });
});

describe('operator state transitions', () => {
  it('reset keeps history, detaches the key, and the same install key registers a new epoch (scenario 28)', async () => {
    const device = newDevice();
    const first = await register(e, { device });
    const oldId = first.reply.result!.trial_id;
    await reportUsage(e, first.install, oldId, 3);
    await operatorReset(oldId);

    const old = (await rowFor(oldId))!;
    expect(old).toMatchObject({ status: 'reset', pubkey: null, pubkey_retired: first.install.publicB64, h_guid: null, used_at_reset: 3 });

    // usage for the old epoch is now unknown_trial
    expect((await reportUsage(e, first.install, oldId, 4)).result).toEqual({ result: 'unknown_trial' });

    // the same install key AND the same device register again, as a new trial
    const again = await register(e, { install: first.install, device });
    expect(again.reply.result).toMatchObject({ result: 'registered', used: 0, state: 'active' });
    expect(again.reply.result!.trial_id).not.toBe(oldId);
    expect((await rowFor(oldId))!.status).toBe('reset'); // old row untouched
  });

  it('erase-contact leaves the device hashes in force; delete-all frees the machine (scenarios 30, 31)', async () => {
    const device = newDevice();
    const first = await register(e, { device });
    const id = first.reply.result!.trial_id;
    await sql(`UPDATE trials SET name_enc = NULL, email_enc = NULL, email_bidx = NULL WHERE id = ?`, id).run();
    const erased = (await rowFor(id))!;
    expect([erased.name_enc, erased.email_enc, erased.email_bidx]).toEqual([null, null, null]);
    expect((await register(e, { device })).reply.result!.result).toBe('already_used');

    await sql('DELETE FROM trials WHERE id = ?', id).run();
    expect((await register(e, { device })).reply.result!.result).toBe('registered');
  });

  it('a reset trial never blocks another registration', async () => {
    const device = newDevice();
    const first = await register(e, { device });
    await operatorReset(first.reply.result!.trial_id);
    expect((await register(e, { device })).reply.result!.result).toBe('registered');
  });
});

describe('response integrity', () => {
  it('answers only under the key derived with the server private key (scenario: fake server)', async () => {
    const wrong = new Uint8Array(32).fill(7);
    const { install, id } = await (async () => {
      const r = await register(e);
      return { install: r.install, id: r.reply.result!.trial_id as string };
    })();
    const good = await seal(e, 'usage', { proto: 1, trial_id: id, used: 1, sig: await install.sign(`pinchpdf-trial-usage-v1|${id}|1`) });
    const ok = await handleUsage(new Request('https://x', { method: 'POST', body: JSON.stringify(good.envelope) }), e, () => NOW);
    const sealedJson = (await ok.json()) as { n: string; ct: string };
    const { aesGcmOpen } = await import('../lib/trial/crypto');
    const { utf8 } = await import('../lib/trial/bytes');
    const aad = utf8(`${good.nB64}|usage`);
    expect(await aesGcmOpen(good.kResp, b64urlDecode(sealedJson.n)!, aad, b64urlDecode(sealedJson.ct)!)).not.toBeNull();
    expect(await aesGcmOpen(wrong, b64urlDecode(sealedJson.n)!, aad, b64urlDecode(sealedJson.ct)!)).toBeNull();
    expect(await aesGcmOpen(good.kResp, b64urlDecode(sealedJson.n)!, utf8('other|usage'), b64urlDecode(sealedJson.ct)!)).toBeNull();
  });
});
