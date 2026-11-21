// App telemetry endpoint: validation, signatures, idempotency, device resolution and privacy.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { NOW, newDevice, newInstall, sendTelemetry } from './client';
import type { TrialEnv } from '../lib/trial/config';

const e = env as unknown as TrialEnv;
const rows = (q: string, ...args: unknown[]) => e.TRIAL_DB.prepare(q).bind(...args).all<Record<string, unknown>>().then((r) => r.results);
const SECOND = 1000;

async function app() {
  return { install: await newInstall(), customer: crypto.randomUUID(), device: newDevice() };
}

describe('/telemetry', () => {
  it('records a buy click with no license data', async () => {
    const a = await app();
    const { reply } = await sendTelemetry(e, { ...a, type: 'buy_clicked' });
    expect(reply.result).toEqual({ result: 'ok' });
    const [event] = await rows('SELECT * FROM telemetry_events');
    expect(event).toMatchObject({ type: 'buy_clicked', plan: null, license_fp: null, customer_uuid: a.customer });
    expect(event.received_at).toBe(NOW / SECOND);
  });

  it('records activation with plan, and stores only keyed hashes (no key, no raw device values)', async () => {
    const a = await app();
    const { reply } = await sendTelemetry(e, { ...a, type: 'license_activated', plan: 'business', license: 'ABCD-EFGH-SECRET-KEY' });
    expect(reply.result).toEqual({ result: 'ok' });
    const dump = JSON.stringify([
      await rows('SELECT * FROM telemetry_events'),
      await rows('SELECT * FROM telemetry_devices'),
      await rows('SELECT * FROM telemetry_customers'),
    ]);
    expect(dump).not.toContain('SECRET-KEY');
    expect(dump).not.toContain(a.device.guid!);
    const [event] = await rows('SELECT * FROM telemetry_events');
    expect(event).toMatchObject({ type: 'license_activated', plan: 'business' });
    expect(String(event.license_fp)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(event.device_id).toBeTruthy();
  });

  it('is idempotent on event_id (an app retry adds nothing)', async () => {
    const a = await app();
    const eventId = crypto.randomUUID();
    await sendTelemetry(e, { ...a, type: 'buy_clicked', eventId });
    const again = await sendTelemetry(e, { ...a, type: 'buy_clicked', eventId });
    expect(again.reply.result).toEqual({ result: 'ok' });
    expect(await rows('SELECT 1 FROM telemetry_events')).toHaveLength(1);
  });

  it('gives the same device id to the same machine and a new one to another', async () => {
    const a = await app();
    const other = newDevice();
    await sendTelemetry(e, { ...a, type: 'license_activated', plan: 'individual', license: 'K1' });
    await sendTelemetry(e, { ...a, type: 'license_deactivated', license: 'K1' });
    await sendTelemetry(e, { ...a, device: other, type: 'license_activated', plan: 'individual', license: 'K1' });
    const ids = (await rows('SELECT device_id FROM telemetry_events ORDER BY seq')).map((r) => r.device_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect(await rows('SELECT 1 FROM telemetry_devices')).toHaveLength(2);
  });

  it('matches a machine when one signal is unavailable but the rest agree (trial matching policy)', async () => {
    const a = await app();
    await sendTelemetry(e, { ...a, type: 'buy_clicked' });
    await sendTelemetry(e, { ...a, type: 'license_activated', plan: 'individual', license: 'K', device: a.device });
    await sendTelemetry(e, { ...a, type: 'license_deactivated', license: 'K', device: { ...a.device, board: null } });
    const ids = (await rows("SELECT device_id FROM telemetry_events WHERE type != 'buy_clicked' ORDER BY seq")).map((r) => r.device_id);
    expect(ids[1]).toBe(ids[0]);
  });

  it('accepts an event with no usable device signal (device_id stays empty)', async () => {
    const a = await app();
    const { reply } = await sendTelemetry(e, { ...a, device: { guid: null, smbios: null, board: null }, type: 'buy_clicked' });
    expect(reply.result).toEqual({ result: 'ok' });
    expect((await rows('SELECT device_id FROM telemetry_events'))[0].device_id).toBeNull();
  });

  it('records a key change with the previous key', async () => {
    const a = await app();
    await sendTelemetry(e, { ...a, type: 'license_key_changed', plan: 'business', license: 'NEW', prevLicense: 'OLD' });
    const [event] = await rows('SELECT * FROM telemetry_events');
    expect(event.license_fp).toBeTruthy();
    expect(event.prev_license_fp).toBeTruthy();
    expect(event.license_fp).not.toBe(event.prev_license_fp);
  });

  it('links the optional trial id and the app and OS versions', async () => {
    const a = await app();
    await sendTelemetry(e, { ...a, type: 'buy_clicked', trialId: 'trial-abc' });
    expect((await rows('SELECT trial_id FROM telemetry_customers'))[0].trial_id).toBe('trial-abc');
    expect(await rows('SELECT app_version, os_build FROM telemetry_events')).toEqual([{ app_version: '1.3.0', os_build: '10.0.26200' }]);
    // a later event can supply the link if the first one had none
    const b = await app();
    await sendTelemetry(e, { ...b, type: 'buy_clicked' });
    await sendTelemetry(e, { ...b, type: 'buy_clicked', trialId: 'trial-xyz' });
    expect((await rows('SELECT trial_id FROM telemetry_customers WHERE customer_uuid = ?', b.customer))[0].trial_id).toBe('trial-xyz');
  });

  it('clamps a wild client clock into the last 90 days and never the future', async () => {
    const a = await app();
    const now = NOW / SECOND;
    await sendTelemetry(e, { ...a, type: 'buy_clicked', occurredAt: 1_000 });
    await sendTelemetry(e, { ...a, type: 'buy_clicked', occurredAt: now + 10 * 86_400 });
    const times = (await rows('SELECT occurred_at FROM telemetry_events ORDER BY seq')).map((r) => r.occurred_at);
    expect(times).toEqual([now - 90 * 86_400, now]);
  });

  it('rejects events signed by a different key than the one bound to the customer', async () => {
    const a = await app();
    await sendTelemetry(e, { ...a, type: 'buy_clicked' });
    const intruder = await newInstall();
    const { reply } = await sendTelemetry(e, { ...a, install: intruder, type: 'buy_clicked' });
    expect(reply.status).toBe(400);
    expect(await rows('SELECT 1 FROM telemetry_events')).toHaveLength(1);
  });

  it('rejects a changed field (the signature covers plan and license) and bad signatures', async () => {
    const a = await app();
    const tampered = await sendTelemetry(e, { ...a, type: 'license_activated', plan: 'business', license: 'K', signedOverrides: { plan: 'individual' } });
    expect(tampered.reply.status).toBe(400);
    const wrongSig = await sendTelemetry(e, { ...a, type: 'buy_clicked', overrides: { sig: 'A'.repeat(86) } });
    expect(wrongSig.reply.status).toBe(400);
    expect(await rows('SELECT 1 FROM telemetry_events')).toHaveLength(0);
    expect(await rows('SELECT 1 FROM telemetry_customers')).toHaveLength(0); // nothing is written before the signature checks out
  });

  it('rejects malformed events with a plain 400', async () => {
    const a = await app();
    const bad: Record<string, unknown>[] = [
      { event_id: 'not-a-uuid' },
      { customer_uuid: 'nope' },
      { type: 'something_else' },
      { occurred_at: -1 },
      { occurred_at: 1.5 },
      { pubkey: 'short' },
      { proto: 2 },
      { signals: [] },
      { trial_id: '' },
    ];
    for (const overrides of bad) {
      expect((await sendTelemetry(e, { ...a, type: 'buy_clicked', overrides })).reply.status, JSON.stringify(overrides)).toBe(400);
    }
    // field rules per type
    expect((await sendTelemetry(e, { ...a, type: 'license_activated', license: 'K' })).reply.status).toBe(400); // plan missing
    expect((await sendTelemetry(e, { ...a, type: 'license_activated', plan: 'individual' })).reply.status).toBe(400); // license missing
    expect((await sendTelemetry(e, { ...a, type: 'license_activated', plan: 'individual', license: 'K', overrides: { plan: 'enterprise' } })).reply.status).toBe(400);
    expect((await sendTelemetry(e, { ...a, type: 'license_key_changed', plan: 'individual', license: 'K' })).reply.status).toBe(400); // prev missing
    expect((await sendTelemetry(e, { ...a, type: 'license_key_changed', plan: 'individual', license: 'K', prevLicense: 'K' })).reply.status).toBe(400); // same key
    expect(await rows('SELECT 1 FROM telemetry_events')).toHaveLength(0);
  });

  it('answers 429 when the per-IP or per-customer limiter refuses', async () => {
    const a = await app();
    const refuse = { limit: async () => ({ success: false }) };
    expect((await sendTelemetry({ ...e, TELEMETRY_IP_LIMITER: refuse } as TrialEnv, { ...a, type: 'buy_clicked' })).reply.status).toBe(429);
    expect((await sendTelemetry({ ...e, TELEMETRY_CUSTOMER_LIMITER: refuse } as TrialEnv, { ...a, type: 'buy_clicked' })).reply.status).toBe(429);
    expect(await rows('SELECT 1 FROM telemetry_events')).toHaveLength(0);
  });

  it('refuses an envelope for another endpoint (the AAD binds the path)', async () => {
    const a = await app();
    const { body } = await sendTelemetry(e, { ...a, type: 'buy_clicked' });
    // the same sealed body replayed against /usage cannot open there
    const { call } = await import('./client');
    const reply = await call(e, 'usage', body);
    expect(reply.status).toBe(400);
  });
});
