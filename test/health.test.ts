// The admin health check: the probe list, the in-process API self-test, the server-side checks,
// the page and its JSON refresh, and the guarantee that probes do not touch the Insights counters
// or leak secrets.

import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { products } from '../app/products/data';
import { legalVersions } from '../app/pinchpdf/legal/versions';
import { resetAdminGuard } from '../lib/admin/auth';
import { handleAdminHealth, handleAdminHome } from '../lib/admin/handlers';
import { runServerChecks, type Check, type HealthEnv } from '../lib/admin/health-checks';
import { buildProbes, classifyProbe } from '../lib/admin/health-targets';
import { runTrialSelfTest, serverPublicKey } from '../lib/admin/selftest';
import type { TrialEnv } from '../lib/trial/config';
import { handleChallenge } from '../lib/trial/handlers';
import { HEALTH_HEADER, resetMetrics } from '../lib/trial/metrics';
import { b64urlEncode } from '../lib/trial/bytes';

const HEX_32 = 'd9d529058e545e7e3c3a43640b2afb052b6fa400c1768ce7f6749d45a199e239';
const creds = { ADMIN_USER: 'ops', ADMIN_PASSWORD: 'correct horse battery' };
const auth = `Basic ${btoa(`${creds.ADMIN_USER}:${creds.ADMIN_PASSWORD}`)}`;
const limiter = { limit: async () => ({ success: true }) };

function copyOf(overrides: Record<string, unknown> = {}): HealthEnv {
  const copy: Record<string, unknown> = {};
  for (const name of Object.keys(env)) copy[name] = (env as unknown as Record<string, unknown>)[name];
  return { ...copy, ...overrides } as unknown as HealthEnv;
}
/** A deployment with everything in place. */
const healthy = (overrides: Record<string, unknown> = {}) =>
  copyOf({
    ...creds,
    DOCS_USER: 'docs',
    DOCS_PASSWORD: 'a-long-enough-password',
    RESEND_API_KEY: 'resend-test',
    CONTACT_FROM_EMAIL: 'contact@example.com',
    TRIAL_DOCS_LIMITER: limiter,
    TRIAL_ADMIN_LIMITER: limiter,
    TELEMETRY_IP_LIMITER: limiter,
    TELEMETRY_CUSTOMER_LIMITER: limiter,
    CONTACT_RATE_LIMITER: limiter,
    TRIAL_CHALLENGE_LIMITER: limiter,
    TRIAL_REGISTER_LIMITER: limiter,
    TRIAL_USAGE_LIMITER: limiter,
    TRIAL_USAGE_IP_LIMITER: limiter,
    ...overrides,
  });
const byId = (checks: Check[]) => Object.fromEntries(checks.map((check) => [check.id, check]));
const get = (path: string, authorization?: string) => new Request(`https://technowizsolutions.com${path}`, { headers: authorization ? { authorization } : {} });

beforeEach(() => {
  resetAdminGuard();
  resetMetrics();
});
afterEach(() => vi.restoreAllMocks());

describe('probe list', () => {
  const probes = buildProbes({
    products: products.map((product) => ({ name: product.name, path: product.path })),
    legal: { terms: Object.keys(legalVersions.terms), privacy: Object.keys(legalVersions.privacy) },
  });
  const ids = probes.map((probe) => probe.id);

  it('covers every trial endpoint, the forms, admin, docs, the pages and the site files', () => {
    const paths = probes.map((probe) => probe.path);
    for (const path of ['/api/pinchpdf/trial/v1/challenge', '/api/pinchpdf/trial/v1/register', '/api/pinchpdf/trial/v1/usage', '/api/contact', '/api/get-support', '/admin', '/admin/insights', '/admin/health', '/api/pinchpdf/trial/docs', '/api/pinchpdf/trial/docs/spec', '/api/pinchpdf/trial/docs/health', '/', '/about', '/get-support', '/terms', '/privacy', '/robots.txt', '/sitemap.xml']) {
      expect(paths, path).toContain(path);
    }
  });

  it('is built from the real product and legal data, so new pages are included automatically', () => {
    for (const product of products) expect(probes.map((p) => p.path)).toContain(product.path);
    expect(probes.map((p) => p.path)).toEqual(expect.arrayContaining(['/pinchpdf/legal/trial-terms', '/pinchpdf/legal/privacy']));
    for (const version of Object.keys(legalVersions.terms)) expect(probes.map((p) => p.path)).toContain(`/pinchpdf/legal/trial-terms/${version}`);
    for (const version of Object.keys(legalVersions.privacy)) expect(probes.map((p) => p.path)).toContain(`/pinchpdf/legal/privacy/${version}`);
  });

  it('has unique ids', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never sends anything with side effects: only the stateless challenge is a POST', () => {
    expect(probes.filter((probe) => probe.method === 'POST').map((probe) => probe.id)).toEqual(['api-challenge']);
  });

  it('classifies answers', () => {
    const page = { ok: [200] };
    const docs = { ok: [401], warn: [404] };
    expect(classifyProbe(page, 200)).toBe('ok');
    expect(classifyProbe(page, 404)).toBe('fail');
    expect(classifyProbe(page, 500)).toBe('fail');
    expect(classifyProbe(page, 0)).toBe('fail'); // no answer
    expect(classifyProbe(page, 429)).toBe('warn'); // reachable but throttled
    expect(classifyProbe(docs, 401)).toBe('ok');
    expect(classifyProbe(docs, 404)).toBe('warn'); // docs switched off
    expect(classifyProbe({ ok: [405] }, 405)).toBe('ok');
  });
});

describe('trial API self-test', () => {
  it('passes against a correctly configured server, for every step', async () => {
    const steps = await runTrialSelfTest(healthy() as unknown as TrialEnv);
    // The test configuration accepts two key ids (k1 and k0): each is exercised end to end.
    expect(steps.map((step) => step.id)).toEqual(['selftest-challenge', 'selftest-register-k1', 'selftest-usage-k1', 'selftest-register-k0', 'selftest-usage-k0']);
    for (const step of steps) expect(step, `${step.id}: ${step.detail}`).toMatchObject({ status: 'ok' });
  });

  it('writes nothing to the database', async () => {
    const count = async () => (await env.TRIAL_DB.prepare('SELECT COUNT(*) AS n FROM trials').first<{ n: number }>())!.n;
    const before = await count();
    await runTrialSelfTest(healthy() as unknown as TrialEnv);
    expect(await count()).toBe(before);
  });

  it('is skipped, with a reason, when a secret is malformed', async () => {
    const steps = await runTrialSelfTest(healthy({ TRIAL_KEY_k1: HEX_32 }) as unknown as TrialEnv);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 'fail' });
    expect(steps[0].detail).toMatch(/configuration problems/);
  });

  it('derives the public key of a key id and refuses an unusable secret', async () => {
    const key = await serverPublicKey(healthy(), 'k1');
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await serverPublicKey(healthy({ TRIAL_KEY_k1: HEX_32 }), 'k1')).toBeNull();
    expect(await serverPublicKey(healthy(), 'nope')).toBeNull();
  });
});

describe('health probes are not counted in Insights', () => {
  const challenge = (headers: Record<string, string>) =>
    new Request('https://technowizsolutions.com/api/pinchpdf/trial/v1/challenge', { method: 'POST', headers, body: JSON.stringify({ proto: 1, pubkey: b64urlEncode(new Uint8Array(32)) }) });
  const rows = async () => (await env.TRIAL_DB.prepare('SELECT COUNT(*) AS n FROM metrics_daily').first<{ n: number }>())!.n;

  beforeEach(async () => {
    await env.TRIAL_DB.prepare('DELETE FROM metrics_daily').run();
  });

  it('counts a normal request (so the check below is meaningful)', async () => {
    await handleChallenge(challenge({}), env as unknown as TrialEnv);
    expect(await rows()).toBeGreaterThan(0);
  });

  it('skips a request that carries the health header', async () => {
    await handleChallenge(challenge({ [HEALTH_HEADER]: '1' }), env as unknown as TrialEnv);
    expect(await rows()).toBe(0);
  });

  it('still counts a request whose header has any other value', async () => {
    await handleChallenge(challenge({ [HEALTH_HEADER]: 'yes' }), env as unknown as TrialEnv);
    expect(await rows()).toBeGreaterThan(0);
  });

  it('is not triggered by running the whole self-test', async () => {
    await runTrialSelfTest(healthy() as unknown as TrialEnv);
    expect(await rows()).toBe(0);
  });
});

describe('server checks', () => {
  it('are all OK for a healthy deployment', async () => {
    const checks = await runServerChecks(healthy());
    for (const check of checks) expect(check, `${check.id}: ${check.detail}`).toMatchObject({ status: 'ok' });
    expect(Object.keys(byId(checks))).toEqual(expect.arrayContaining(['db', 'schema', 'secrets', 'limiters', 'email', 'docs-login', 'pubkey-k1']));
  });

  it('fail on a missing database binding', async () => {
    const checks = byId(await runServerChecks(healthy({ TRIAL_DB: undefined })));
    expect(checks.db).toMatchObject({ status: 'fail' });
    expect(checks.db.detail).toMatch(/TRIAL_DB/);
  });

  it('report a database that throws', async () => {
    const broken = { prepare: () => { throw new Error('D1_ERROR: no such table: trials'); } };
    const checks = byId(await runServerChecks(healthy({ TRIAL_DB: broken })));
    expect(checks.db).toMatchObject({ status: 'fail' });
    expect(checks.db.detail).toMatch(/no such table/);
  });

  it('name the missing tables and the command to fix them', async () => {
    const partial = { prepare: () => ({ first: async () => ({}), all: async () => ({ results: [{ name: 'trials' }] }) }) };
    const check = byId(await runServerChecks(healthy({ TRIAL_DB: partial }))).schema;
    expect(check).toMatchObject({ status: 'fail' });
    expect(check.detail).toMatch(/trial_audit/);
    expect(check.detail).toMatch(/metrics_daily/);
    expect(check.detail).toMatch(/wrangler d1 migrations apply/);
  });

  it('name a malformed secret and say it is hex, without printing it', async () => {
    const checks = byId(await runServerChecks(healthy({ PII_KEY: HEX_32 })));
    expect(checks.secrets).toMatchObject({ status: 'fail' });
    expect(checks.secrets.detail).toMatch(/PII_KEY/);
    expect(checks.secrets.detail).toMatch(/HEX/);
    expect(JSON.stringify(checks)).not.toContain(HEX_32);
  });

  it('name a missing secret', async () => {
    const check = byId(await runServerChecks(healthy({ PEPPER: undefined }))).secrets;
    expect(check).toMatchObject({ status: 'fail' });
    expect(check.detail).toMatch(/PEPPER: missing/);
  });

  it('warn, not fail, when rate limiters are missing', async () => {
    const check = byId(await runServerChecks(healthy({ TRIAL_REGISTER_LIMITER: undefined, CONTACT_RATE_LIMITER: undefined }))).limiters;
    expect(check).toMatchObject({ status: 'warn' });
    expect(check.detail).toMatch(/TRIAL_REGISTER_LIMITER/);
    expect(check.detail).toMatch(/CONTACT_RATE_LIMITER/);
  });

  it('fail when the email settings are missing and warn when the docs login is off', async () => {
    const checks = byId(await runServerChecks(healthy({ RESEND_API_KEY: undefined, DOCS_USER: undefined })));
    expect(checks.email).toMatchObject({ status: 'fail' });
    expect(checks.email.detail).toMatch(/RESEND_API_KEY/);
    expect(checks['docs-login']).toMatchObject({ status: 'warn' });
  });

  it('show the server public key for each key id, and never the private key', async () => {
    const checks = await runServerChecks(healthy());
    const detail = byId(checks)['pubkey-k1'].detail;
    expect(detail).toContain((await serverPublicKey(healthy(), 'k1'))!);
    expect(JSON.stringify(checks)).not.toContain((env as unknown as Record<string, string>).TRIAL_KEY_k1);
  });
});

describe('/admin/health', () => {
  it('is off (404) when the admin login is not configured', async () => {
    expect((await handleAdminHealth(get('/admin/health', auth), copyOf())).status).toBe(404);
  });

  it('asks for the login, and reveals nothing without it', async () => {
    const response = await handleAdminHealth(get('/admin/health'), healthy());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toMatch(/PEPPER|TRIAL_KEY|<li/);
    const json = await handleAdminHealth(get('/admin/health?format=json'), healthy());
    expect(json.status).toBe(401);
  });

  it('renders every category with a row for every check and probe', async () => {
    const response = await handleAdminHealth(get('/admin/health', auth), healthy());
    expect(response.status).toBe(200);
    const html = await response.text();
    for (const title of ['Configuration and services', 'Trial API', 'Trial API self-test', 'Website APIs', 'Admin and API docs', 'Website pages', 'Site files']) {
      expect(html, title).toContain(`<h2>${title}</h2>`);
    }
    for (const id of ['row-db', 'row-schema', 'row-secrets', 'row-selftest-challenge', 'row-api-challenge', 'row-api-register', 'row-api-usage', 'row-api-contact', 'row-admin-home', 'row-page-home', 'row-file-robots']) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain('Run health check');
    expect(html).toContain('Auto-refresh');
    expect(html).toContain('/admin/health'); // nav link
  });

  it('allows scripts only through a per-response nonce', async () => {
    const one = await handleAdminHealth(get('/admin/health', auth), healthy());
    const two = await handleAdminHealth(get('/admin/health', auth), healthy());
    const csp = one.headers.get('content-security-policy')!;
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)![1];
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("default-src 'none'");
    const html = await one.text();
    expect(html.match(/<script(?![^>]*nonce=)/g)).toBeNull(); // every script element has a nonce
    expect(html).toContain(`nonce="${nonce}"`);
    expect(two.headers.get('content-security-policy')).not.toBe(csp); // fresh nonce each time
  });

  it('shows what is wrong, but never a secret value', async () => {
    const response = await handleAdminHealth(get('/admin/health', auth), healthy({ PII_KEY: HEX_32, TRIAL_KEY_k1: HEX_32 }));
    const html = await response.text();
    expect(html).toContain('PII_KEY');
    expect(html).toContain('TRIAL_KEY_k1');
    expect(html).toMatch(/data-state="fail"/);
    expect(html).not.toContain(HEX_32);
  });

  it('serves the same checks as JSON for the page to refresh', async () => {
    const response = await handleAdminHealth(get('/admin/health?format=json', auth), healthy());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { generatedAt: string; checks: Check[] };
    expect(body.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(body.checks.find((check) => check.id === 'db')).toMatchObject({ status: 'ok' });
  });

  it('never lets embedded probe data close the script element', async () => {
    const html = await (await handleAdminHealth(get('/admin/health', auth), healthy())).text();
    const data = html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/)![1];
    expect(data).not.toContain('<');
    expect(JSON.parse(data).probes.length).toBeGreaterThan(10);
  });
});

describe('admin navigation', () => {
  it('puts a Health check call to action on the admin home page and in the menu', async () => {
    const html = await (await handleAdminHome(get('/admin', auth), healthy())).text();
    expect(html).toMatch(/<a class="cta" href="\/admin\/health"><b>Health check<\/b>/);
    expect(html).toMatch(/<a href="\/admin\/health">Health check<\/a>/);
  });
});
