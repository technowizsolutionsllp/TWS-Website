// A malformed or missing secret must be named in the logs and answered with 503, never a silent
// 400 or a crash. These tests cover the format checks, the fail-fast guard, the health route and
// the reason logged for a refused envelope. No test may leak a secret value.

import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seal } from './client';
import { configStatus, secretProblem, type TrialEnv } from '../lib/trial/config';
import { handleDocsHealth } from '../lib/trial/docs';
import { resetRejectLog } from '../lib/trial/envelope';
import { handleRegister } from '../lib/trial/handlers';
import { resetConfigLog, runWithEnv } from '../lib/trial/runtime';

const good = env as unknown as TrialEnv;
const withOverrides = (overrides: Record<string, string | undefined>): TrialEnv => {
  const copy: Record<string, unknown> = {};
  for (const name of Object.keys(env)) copy[name] = (env as unknown as Record<string, unknown>)[name];
  return { ...copy, ...overrides } as unknown as TrialEnv;
};

// What the mistakes in this project looked like.
const HEX_32 = 'd9d529058e545e7e3c3a43640b2afb052b6fa400c1768ce7f6749d45a199e239'; // 64 hex characters
const STD_BASE64 = 'LxiL5723W/5NgNAmJIHtYTeSsi472befmqAyPZoKvCg='; // "/" and "=" padding
const GOOD_32 = '29bXg5TdDBgVIkhElB7X4OZNHoFhu72SgYEONqz1fyA'; // 43 characters base64url

beforeEach(() => {
  resetConfigLog();
  resetRejectLog();
});
afterEach(() => vi.restoreAllMocks());

describe('secretProblem', () => {
  it('accepts a 32-byte base64url value', () => {
    expect(secretProblem(GOOD_32, { exactBytes: 32 })).toBeNull();
  });

  it('says a 64-character hex value is hex and how to make a proper one', () => {
    const problem = secretProblem(HEX_32, { exactBytes: 32 })!;
    expect(problem).toContain('48 bytes');
    expect(problem).toContain('HEX');
    expect(problem).toContain('base64url');
  });

  it('names the offending characters of standard base64, quotes and whitespace', () => {
    expect(secretProblem(STD_BASE64, { exactBytes: 32 })).toMatch(/"="/);
    expect(secretProblem(STD_BASE64, { exactBytes: 32 })).toMatch(/"\/"/);
    expect(secretProblem(`"${GOOD_32}"`, { exactBytes: 32 })).toMatch(/quotes/);
    expect(secretProblem(`${GOOD_32}\n`, { exactBytes: 32 })).toMatch(/spaces or line breaks/);
  });

  it('reports a wrong length', () => {
    expect(secretProblem(GOOD_32.slice(0, 40), { exactBytes: 32 })).toMatch(/decodes to \d+ bytes, expected exactly 32/);
    expect(secretProblem('AAAA', { minBytes: 16 })).toMatch(/at least 16/);
  });

  it('keeps accepting a hex value for the HMAC secrets, which only need 16 bytes or more', () => {
    // Existing deployments store PEPPER, PEPPER_EMAIL and CHALLENGE_KEY this way; rejecting them
    // would take the service down, and re-keying them would change every stored hash.
    expect(secretProblem(HEX_32, { minBytes: 16 })).toBeNull();
  });

  it('never repeats the value', () => {
    for (const value of [HEX_32, STD_BASE64, `"${GOOD_32}"`, GOOD_32.slice(0, 40)]) {
      expect(secretProblem(value, { exactBytes: 32 })!).not.toContain(value.slice(0, 12));
    }
  });
});

describe('configStatus', () => {
  it('is clean for the test configuration', () => {
    const status = configStatus(good);
    expect(status.missing).toEqual([]);
    expect(status.invalid).toEqual([]);
  });

  it('lists only the secrets that are wrong, by name', () => {
    const status = configStatus(withOverrides({ PII_KEY: HEX_32, TRIAL_KEY_k1: STD_BASE64 }));
    expect(status.invalid.map((item) => item.name)).toEqual(['PII_KEY', 'TRIAL_KEY_k1']);
    expect(JSON.stringify(status)).not.toContain(HEX_32);
    expect(JSON.stringify(status)).not.toContain(STD_BASE64);
  });

  it('flags a key id list with no usable entry', () => {
    const status = configStatus(withOverrides({ ACCEPTED_KIDS: 'k 1,!' }));
    expect(status.invalid.some((item) => item.name === 'ACCEPTED_KIDS')).toBe(true);
  });
});

describe('runWithEnv', () => {
  const ok = async () => new Response('ran');

  it('runs the handler when the configuration is sound', async () => {
    expect(await (await runWithEnv(good, ok)).text()).toBe('ran');
  });

  it('answers 503 without running the handler, and logs the names and reasons but no values', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn(ok);
    const response = await runWithEnv(withOverrides({ PII_KEY: HEX_32 }), handler);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expect(handler).not.toHaveBeenCalled();
    const line = String(error.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ svc: 'trial', result: 'config_invalid', invalid: [{ name: 'PII_KEY' }] });
    expect(line).not.toContain(HEX_32);
  });

  it('answers 503 and names a missing secret', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await runWithEnv(withOverrides({ PEPPER: undefined }), ok);
    expect(response.status).toBe(503);
    expect(JSON.parse(String(error.mock.calls[0][0])).missing).toEqual(['PEPPER']);
  });

  it('logs at most once a minute, but keeps answering 503', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = withOverrides({ PII_KEY: HEX_32 });
    await runWithEnv(broken, ok, 1_000_000);
    await runWithEnv(broken, ok, 1_010_000);
    expect(error).toHaveBeenCalledTimes(1);
    expect((await runWithEnv(broken, ok, 1_010_000)).status).toBe(503);
    await runWithEnv(broken, ok, 1_070_000);
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe('health route', () => {
  const docs = { DOCS_USER: 'docs-user', DOCS_PASSWORD: 'a-long-enough-password-123' };
  const get = (authorization?: string) =>
    new Request('https://technowizsolutions.com/api/pinchpdf/trial/docs/health', { headers: authorization ? { authorization } : {} });
  const auth = `Basic ${btoa(`${docs.DOCS_USER}:${docs.DOCS_PASSWORD}`)}`;

  it('needs the docs password', async () => {
    expect((await handleDocsHealth(get(), { ...withOverrides({}), ...docs })).status).toBe(401);
  });

  it('is 404 when the docs are switched off, so it reveals nothing', async () => {
    expect((await handleDocsHealth(get(auth), withOverrides({}))).status).toBe(404);
  });

  it('reports ok when everything is in place', async () => {
    const response = await handleDocsHealth(get(auth), { ...withOverrides({}), ...docs });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, missing: [], invalid: [] });
  });

  it('reports 503 with the problem by name, never the value', async () => {
    const response = await handleDocsHealth(get(auth), { ...withOverrides({ TRIAL_KEY_k1: HEX_32 }), ...docs });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ ok: false, checks: { secrets_well_formed: false }, invalid: [{ name: 'TRIAL_KEY_k1' }] });
    expect(text).not.toContain(HEX_32);
  });
});

describe('refused envelopes', () => {
  it('logs decrypt_failed when the app used a public key that is not the pair of this server key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sealed = await seal(good, 'register', { proto: 1 }); // sealed to the correct public key
    const request = new Request('https://technowizsolutions.com/api/pinchpdf/trial/v1/register', { method: 'POST', body: JSON.stringify(sealed.envelope) });
    // The server now holds a different private key for k1 (the situation behind the original outage).
    const response = await handleRegister(request, withOverrides({ TRIAL_KEY_k1: GOOD_32 }));
    expect(response.status).toBe(400); // the answer stays opaque
    expect(await response.json()).toEqual({ error: 'bad_request' });
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ svc: 'trial', endpoint: 'register', result: 'envelope_rejected', reason: 'decrypt_failed', kid: 'k1' });
  });

  it('logs kid_not_accepted for an unknown key id and caps how much it logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sealed = await seal(good, 'register', { proto: 1 });
    sealed.envelope.kid = 'zz';
    for (let i = 0; i < 12; i += 1) {
      const request = new Request('https://technowizsolutions.com/api/pinchpdf/trial/v1/register', { method: 'POST', body: JSON.stringify(sealed.envelope) });
      expect((await handleRegister(request, good)).status).toBe(421);
    }
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ reason: 'kid_not_accepted', kid: 'zz' });
    expect(warn.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
