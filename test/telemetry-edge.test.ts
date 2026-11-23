// Telemetry endpoint under awkward conditions: races, retries, a failing database, oversized or
// foreign input, leaked fields, and logs. These are the cases a real fleet of apps produces.

import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOW, call, newDevice, newInstall, seal, sendTelemetry } from './client';
import { handleTelemetry } from '../lib/telemetry/handler';
import { MAX_REQUEST_BYTES, type TrialEnv } from '../lib/trial/config';
import { HEALTH_HEADER } from '../lib/trial/metrics';

const e = env as unknown as TrialEnv;
const rows = (q: string, ...a: unknown[]) => e.TRIAL_DB.prepare(q).bind(...a).all<Record<string, unknown>>().then((r) => r.results);
const app = async () => ({ install: await newInstall(), customer: crypto.randomUUID(), device: newDevice() });

afterEach(() => vi.restoreAllMocks());

describe('retries and races', () => {
  it('stores one row when the same event is delivered many times at once', async () => {
    const a = await app();
    const eventId = crypto.randomUUID();
    const replies = await Promise.all(Array.from({ length: 10 }, () => sendTelemetry(e, { ...a, type: 'buy_clicked', eventId })));
    for (const r of replies) expect(r.reply.result).toEqual({ result: 'ok' });
    expect(await rows('SELECT 1 FROM telemetry_events')).toHaveLength(1);
    expect(await rows('SELECT 1 FROM telemetry_customers')).toHaveLength(1);
  });

  it('lets exactly one install key win when two race to claim the same customer_uuid', async () => {
    const customer = crypto.randomUUID();
    const first = { install: await newInstall(), customer, device: newDevice() };
    const second = { install: await newInstall(), customer, device: newDevice() };
    const replies = await Promise.all([sendTelemetry(e, { ...first, type: 'buy_clicked' }), sendTelemetry(e, { ...second, type: 'buy_clicked' })]);
    const statuses = replies.map((r) => r.reply.status).sort();
    expect(statuses).toEqual([200, 400]);
    expect(await rows('SELECT 1 FROM telemetry_events')).toHaveLength(1);
    const winner = (await rows('SELECT pubkey FROM telemetry_customers'))[0].pubkey;
    expect([first.install.publicB64, second.install.publicB64]).toContain(winner);
  });

  it('keeps the order of events the app reports even when they arrive out of order', async () => {
    const a = await app();
    const base = NOW / 1000;
    await sendTelemetry(e, { ...a, type: 'license_deactivated', license: 'K', occurredAt: base - 100 }); // arrives first, happened later
    await sendTelemetry(e, { ...a, type: 'license_activated', plan: 'individual', license: 'K', occurredAt: base - 500 });
    const stored = await rows('SELECT type, occurred_at FROM telemetry_events ORDER BY occurred_at');
    expect(stored.map((r) => r.type)).toEqual(['license_activated', 'license_deactivated']);
  });

  it('accepts the same machine reporting for many customers (a shared PC) without merging them', async () => {
    const device = newDevice();
    const a = { install: await newInstall(), customer: crypto.randomUUID(), device };
    const b = { install: await newInstall(), customer: crypto.randomUUID(), device };
    await sendTelemetry(e, { ...a, type: 'license_activated', plan: 'individual', license: 'A' });
    await sendTelemetry(e, { ...b, type: 'license_activated', plan: 'individual', license: 'B' });
    expect(await rows('SELECT 1 FROM telemetry_devices')).toHaveLength(1);
    expect(await rows('SELECT 1 FROM telemetry_customers')).toHaveLength(2);
    const ids = (await rows('SELECT device_id FROM telemetry_events')).map((r) => r.device_id);
    expect(ids[0]).toBe(ids[1]);
  });
});

describe('what is and is not stored', () => {
  it('ignores a name, email or any unknown field a buggy app sends, and stores none of it', async () => {
    const a = await app();
    const { reply } = await sendTelemetry(e, {
      ...a,
      type: 'license_activated',
      plan: 'individual',
      license: 'SECRET-LICENSE-KEY',
      overrides: { name: 'Jane Doe', email: 'jane@example.com', license_key: 'SECRET-LICENSE-KEY', hostname: 'JANES-PC', username: 'jane' },
    });
    expect(reply.result).toEqual({ result: 'ok' });
    const dump = JSON.stringify([await rows('SELECT * FROM telemetry_events'), await rows('SELECT * FROM telemetry_devices'), await rows('SELECT * FROM telemetry_customers')]);
    for (const secret of ['Jane', 'jane@example.com', 'SECRET-LICENSE-KEY', 'JANES-PC', 'username', a.device.guid!, a.device.smbios!, a.device.board!]) {
      expect(dump, secret).not.toContain(secret);
    }
  });

  it('writes nothing identifying to the logs', async () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const a = await app();
    const sent = await sendTelemetry(e, { ...a, type: 'license_activated', plan: 'business', license: 'LICENSE-IN-LOGS-CHECK', trialId: 'trial-in-logs-check' });
    await sendTelemetry(e, { ...a, type: 'buy_clicked', overrides: { sig: 'A'.repeat(86) } }); // a rejected one
    const text = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls].map((c) => String(c[0])).join('\n');
    expect(text).toContain('"svc":"telemetry"');
    for (const secret of [a.customer, sent.eventId, 'LICENSE-IN-LOGS-CHECK', 'trial-in-logs-check', a.install.publicB64, a.device.guid!]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('does not accept an event replayed under another customer (the signature covers the customer)', async () => {
    const a = await app();
    const sent = await sendTelemetry(e, { ...a, type: 'buy_clicked' });
    const other = crypto.randomUUID();
    const replay = await call(e, 'telemetry', { ...sent.body, event_id: crypto.randomUUID(), customer_uuid: other }, { now: NOW });
    expect(replay.status).toBe(400);
    expect(await rows('SELECT 1 FROM telemetry_customers WHERE customer_uuid = ?', other)).toHaveLength(0);
  });
});

describe('hostile or broken transport', () => {
  const post = async (text: string, headers: Record<string, string> = {}) =>
    handleTelemetry(new Request('https://technowizsolutions.com/api/pinchpdf/trial/v1/telemetry', { method: 'POST', body: text, headers }), e, () => NOW);

  it('refuses an oversized body, junk and an empty body with a plain 400', async () => {
    expect((await post('x'.repeat(MAX_REQUEST_BYTES + 1))).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post('')).status).toBe(400);
    expect((await post('[]')).status).toBe(400);
    expect((await post(JSON.stringify({ v: 1, kid: 'k1', epk: 'AA', n: 'AA', ct: 'AA' }))).status).toBe(400);
  });

  it('answers 421 for an unknown or retired key id, never a decision about the event', async () => {
    const a = await app();
    const { reply } = await sendTelemetry(e, { ...a, type: 'buy_clicked' });
    expect(reply.status).toBe(200);
    const sealed = await seal(e, 'telemetry', { proto: 1 });
    const response = await post(JSON.stringify({ ...sealed.envelope, kid: 'nope' }));
    expect(response.status).toBe(421);
  });

  it('answers 503 and keeps working afterwards when the database fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await app();
    const broken = { ...e, TRIAL_DB: { prepare: () => { throw new Error('d1 is down'); } } as unknown as D1Database } as TrialEnv;
    const down = await sendTelemetry(broken, { ...a, type: 'buy_clicked' });
    expect(down.reply.status).toBe(503);
    expect(JSON.stringify(down.reply.plain)).not.toContain('d1 is down');
    const up = await sendTelemetry(e, { ...a, type: 'buy_clicked' }); // the app retries and succeeds
    expect(up.reply.result).toEqual({ result: 'ok' });
    expect(error).toHaveBeenCalled();
  });

  it('does not count the health page probes in the request counters', async () => {
    const sealed = await seal(e, 'telemetry', { proto: 1 });
    await post(JSON.stringify(sealed.envelope), { [HEALTH_HEADER]: '1' });
    expect(await rows("SELECT 1 FROM metrics_daily WHERE endpoint = 'telemetry'")).toHaveLength(0);
    await post(JSON.stringify(sealed.envelope));
    expect((await rows("SELECT outcome FROM metrics_daily WHERE endpoint = 'telemetry'")).map((r) => r.outcome)).toEqual(['bad_request']);
  });
});

describe('clamping of untrusted clocks and sizes', () => {
  it('truncates long app and OS strings and drops control characters', async () => {
    const a = await app();
    await sendTelemetry(e, { ...a, type: 'buy_clicked', overrides: { app_version: 'v'.repeat(500), os_build: 'bad\u0000build' } });
    const [row] = await rows('SELECT app_version, os_build FROM telemetry_events');
    expect(String(row.app_version).length).toBeLessThanOrEqual(32);
    expect(row.os_build).toBeNull();
  });

  it('stores nothing for a customer whose first event is invalid', async () => {
    const a = await app();
    await sendTelemetry(e, { ...a, type: 'license_activated', license: 'K' }); // plan missing
    expect(await rows('SELECT 1 FROM telemetry_customers')).toHaveLength(0);
    expect(await rows('SELECT 1 FROM telemetry_devices')).toHaveLength(0);
  });
});
