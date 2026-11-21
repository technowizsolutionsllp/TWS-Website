// Retention: events older than the period are deleted with whatever only they referred to,
// newer data is untouched, one customer can be erased on request, and the Health check
// notices when the purge is overdue.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RETENTION_DAYS, eraseStatements, purgeStatements } from '../scripts/telemetry-purge-sql.mjs';
import { runServerChecks, type HealthEnv } from '../lib/admin/health-checks';
import { RETENTION_GRACE_DAYS, TELEMETRY_RETENTION_DAYS, retentionStatus } from '../lib/telemetry/retention';

const DAY = 86400;
const NOW = 1_800_000_000;
const A = '11111111-1111-4111-8111-111111111111'; // all old
const B = '22222222-2222-4222-8222-222222222222'; // old and recent
const C = '33333333-3333-4333-8333-333333333333'; // recent only

async function run(statements: string[]) {
  for (const sql of statements) await env.TRIAL_DB.prepare(sql).run();
}
async function count(table: string, where = '1=1') {
  return (await env.TRIAL_DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>())!.n;
}
async function seed() {
  const old = NOW - (DEFAULT_RETENTION_DAYS + 10) * DAY;
  const recent = NOW - 10 * DAY;
  for (const [uuid, seen] of [[A, old], [B, old], [C, recent]] as const) {
    await env.TRIAL_DB.prepare('INSERT INTO telemetry_customers (customer_uuid, pubkey, first_seen_at) VALUES (?, ?, ?)').bind(uuid, `pk-${uuid}`, seen).run();
  }
  for (const [id, seen] of [['dev-a', old], ['dev-b', old], ['dev-c', recent]] as const) {
    await env.TRIAL_DB.prepare('INSERT INTO telemetry_devices (device_id, h_guid, first_seen_at) VALUES (?, ?, ?)').bind(id, `h-${id}`, seen).run();
  }
  const event = (id: string, customer: string, device: string, at: number) =>
    env.TRIAL_DB.prepare("INSERT INTO telemetry_events (event_id, customer_uuid, type, plan, device_id, occurred_at, received_at) VALUES (?, ?, 'license_activated', 'individual', ?, ?, ?)").bind(id, customer, device, at, at).run();
  await event('e1', A, 'dev-a', old);
  await event('e2', B, 'dev-b', old);
  await event('e3', B, 'dev-b', recent);
  await event('e4', C, 'dev-c', recent);
}

describe('telemetry purge', () => {
  it('uses the same period in the script and in the code the Health check reads', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(TELEMETRY_RETENTION_DAYS);
  });

  it('deletes old events and the customers and devices only they used, and keeps everything else', async () => {
    await seed();
    await run(purgeStatements(NOW));
    expect(await count('telemetry_events', "event_id IN ('e1','e2')")).toBe(0);
    expect(await count('telemetry_events', "event_id IN ('e3','e4')")).toBe(2);
    expect(await count('telemetry_customers', `customer_uuid = '${A}'`)).toBe(0); // only old events
    expect(await count('telemetry_customers', `customer_uuid = '${B}'`)).toBe(1); // still has a recent event
    expect(await count('telemetry_customers', `customer_uuid = '${C}'`)).toBe(1);
    expect(await count('telemetry_devices', "device_id = 'dev-a'")).toBe(0);
    expect(await count('telemetry_devices', "device_id IN ('dev-b','dev-c')")).toBe(2);
  });

  it('is safe to run twice, and does nothing on an empty database', async () => {
    await run(purgeStatements(NOW));
    await seed();
    await run(purgeStatements(NOW));
    const before = await count('telemetry_events');
    await run(purgeStatements(NOW));
    expect(await count('telemetry_events')).toBe(before);
  });

  it('keeps an old customer that has no old events but a recent one (age of the customer row alone never deletes it)', async () => {
    await seed();
    await run(purgeStatements(NOW, 30));
    expect(await count('telemetry_customers', `customer_uuid = '${C}'`)).toBe(1);
  });

  it('refuses a retention period that is not a whole number of at least 30 days, and a bad clock', () => {
    expect(() => purgeStatements(NOW, 10)).toThrow(/at least 30/);
    expect(() => purgeStatements(NOW, 100.5)).toThrow();
    expect(() => purgeStatements(0)).toThrow();
  });
});

describe('telemetry erasure on request', () => {
  it('removes one customer, their events and the devices nothing else uses, and nobody else', async () => {
    await seed();
    await run(eraseStatements(B));
    expect(await count('telemetry_events', `customer_uuid = '${B}'`)).toBe(0);
    expect(await count('telemetry_customers', `customer_uuid = '${B}'`)).toBe(0);
    expect(await count('telemetry_devices', "device_id = 'dev-b'")).toBe(0);
    expect(await count('telemetry_events', `customer_uuid IN ('${A}','${C}')`)).toBe(2);
    expect(await count('telemetry_devices', "device_id IN ('dev-a','dev-c')")).toBe(2);
  });

  it('accepts only a real UUID, so nothing can be injected', () => {
    for (const bad of ["x' OR '1'='1", '', "1111; DROP TABLE telemetry_events", 'not-a-uuid', undefined as unknown as string]) {
      expect(() => eraseStatements(bad), String(bad)).toThrow();
    }
    expect(eraseStatements(A.toUpperCase())[0]).toContain(A);
  });
});

describe('retention health check', () => {
  const limiter = { limit: async () => ({ success: true }) };
  const healthEnv = () => ({ ...(env as unknown as Record<string, unknown>), ADMIN_USER: 'ops', ADMIN_PASSWORD: 'correct horse battery', DOCS_USER: 'd', DOCS_PASSWORD: 'long-enough-pass', RESEND_API_KEY: 'k', CONTACT_FROM_EMAIL: 'c@example.com', TRIAL_DOCS_LIMITER: limiter }) as unknown as HealthEnv;

  it('is ok with no events, ok within the period plus grace, and warns beyond it naming the command', () => {
    expect(retentionStatus({ oldest: null, events: 0 }, NOW).status).toBe('ok');
    expect(retentionStatus({ oldest: NOW - TELEMETRY_RETENTION_DAYS * DAY, events: 5 }, NOW).status).toBe('ok');
    expect(retentionStatus({ oldest: NOW - (TELEMETRY_RETENTION_DAYS + RETENTION_GRACE_DAYS) * DAY, events: 5 }, NOW).status).toBe('ok');
    const late = retentionStatus({ oldest: NOW - (TELEMETRY_RETENTION_DAYS + RETENTION_GRACE_DAYS + 1) * DAY, events: 5 }, NOW);
    expect(late.status).toBe('warn');
    expect(late.detail).toContain('telemetry-purge.mjs');
  });

  it('shows up in the server checks and warns when an old event is stored', async () => {
    const now = Math.floor(Date.now() / 1000);
    await env.TRIAL_DB.prepare("INSERT INTO telemetry_events (event_id, customer_uuid, type, occurred_at, received_at) VALUES ('old', ?, 'buy_clicked', ?, ?)").bind(A, now - 900 * DAY, now - 900 * DAY).run();
    const checks = await runServerChecks(healthEnv());
    expect(checks.find((c) => c.id === 'telemetry-retention')).toMatchObject({ status: 'warn' });
  });

  it('is ok on an empty table', async () => {
    const checks = await runServerChecks(healthEnv());
    expect(checks.find((c) => c.id === 'telemetry-retention')).toMatchObject({ status: 'ok' });
  });
});
