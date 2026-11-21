// The admin health page knows about telemetry: its tables, limiters and endpoints, and the checks
// never write telemetry data.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { products } from '../app/products/data';
import { legalVersions } from '../app/pinchpdf/legal/versions';
import { runServerChecks, type HealthEnv } from '../lib/admin/health-checks';
import { buildProbes } from '../lib/admin/health-targets';

const limiter = { limit: async () => ({ success: true }) };
const copyOf = (overrides: Record<string, unknown> = {}) => {
  const copy: Record<string, unknown> = {};
  for (const name of Object.keys(env)) copy[name] = (env as unknown as Record<string, unknown>)[name];
  return { ...copy, ...overrides } as unknown as HealthEnv;
};
const healthy = (overrides: Record<string, unknown> = {}) =>
  copyOf({
    ADMIN_USER: 'ops',
    ADMIN_PASSWORD: 'correct horse battery',
    DOCS_USER: 'docs',
    DOCS_PASSWORD: 'a-long-enough-password',
    RESEND_API_KEY: 'resend-test',
    CONTACT_FROM_EMAIL: 'contact@example.com',
    TRIAL_DOCS_LIMITER: limiter,
    TRIAL_ADMIN_LIMITER: limiter,
    CONTACT_RATE_LIMITER: limiter,
    TRIAL_CHALLENGE_LIMITER: limiter,
    TRIAL_REGISTER_LIMITER: limiter,
    TRIAL_USAGE_LIMITER: limiter,
    TRIAL_USAGE_IP_LIMITER: limiter,
    TELEMETRY_IP_LIMITER: limiter,
    TELEMETRY_CUSTOMER_LIMITER: limiter,
    ...overrides,
  });
const byId = <T extends { id: string }>(checks: T[]) => Object.fromEntries(checks.map((c) => [c.id, c])) as Record<string, T>;

describe('health probes for telemetry', () => {
  const probes = buildProbes({ products: products.map((p) => ({ name: p.name, path: p.path })), legal: { terms: Object.keys(legalVersions.terms), privacy: Object.keys(legalVersions.privacy) } });

  it('probe the telemetry endpoint with a harmless GET that must answer 405', () => {
    expect(probes.find((p) => p.id === 'api-telemetry')).toMatchObject({ path: '/api/pinchpdf/trial/v1/telemetry', method: 'GET', ok: [405] });
  });

  it('probe the Insights JSON API without credentials, which must answer 401', () => {
    expect(probes.find((p) => p.id === 'admin-insights-api')).toMatchObject({ path: '/api/pinchpdf/insights/v1/buying', method: 'GET', ok: [401] });
  });

  it('still send no probe with side effects (only the stateless challenge is a POST)', () => {
    expect(probes.filter((p) => p.method === 'POST').map((p) => p.id)).toEqual(['api-challenge']);
  });
});

describe('server checks for telemetry', () => {
  it('are healthy with the telemetry tables and limiters in place', async () => {
    const checks = byId(await runServerChecks(healthy()));
    expect(checks.schema.status, checks.schema.detail).toBe('ok');
    expect(checks.schema.detail).toContain('telemetry_events');
    expect(checks.limiters.status, checks.limiters.detail).toBe('ok');
  });

  it('fail, naming the telemetry tables and the command, when migration 0003 is missing', async () => {
    const partial = { prepare: () => ({ first: async () => ({}), all: async () => ({ results: [{ name: 'trials' }, { name: 'trial_audit' }, { name: 'metrics_daily' }] }) }) };
    const check = byId(await runServerChecks(healthy({ TRIAL_DB: partial }))).schema;
    expect(check.status).toBe('fail');
    for (const table of ['telemetry_customers', 'telemetry_devices', 'telemetry_events']) expect(check.detail).toContain(table);
    expect(check.detail).toMatch(/wrangler d1 migrations apply/);
  });

  it('warn, not fail, when the telemetry rate limiters are missing', async () => {
    const check = byId(await runServerChecks(healthy({ TELEMETRY_IP_LIMITER: undefined, TELEMETRY_CUSTOMER_LIMITER: undefined }))).limiters;
    expect(check.status).toBe('warn');
    expect(check.detail).toContain('TELEMETRY_IP_LIMITER');
    expect(check.detail).toContain('TELEMETRY_CUSTOMER_LIMITER');
  });

  it('write nothing to the telemetry tables', async () => {
    const count = async () =>
      (await env.TRIAL_DB.prepare('SELECT (SELECT COUNT(*) FROM telemetry_events) + (SELECT COUNT(*) FROM telemetry_customers) + (SELECT COUNT(*) FROM telemetry_devices) AS n').first<{ n: number }>())!.n;
    const before = await count();
    await runServerChecks(healthy());
    expect(await count()).toBe(before);
  });
});
