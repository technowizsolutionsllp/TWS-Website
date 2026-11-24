// Telemetry Insights: the calculations (pure), the admin tabs and the JSON API.

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAdminGuard, type AdminEnv } from '../lib/admin/auth';
import { handleAdminInsights, type AdminRuntimeEnv } from '../lib/admin/handlers';
import { handleInsightsApi } from '../lib/admin/insights-api';
import { buildRange } from '../lib/admin/range';
import { INSIGHT_TABS } from '../lib/admin/tabs';
import { DAY, bucketIndex, bucketsFor, buyAttempts, countByBucket, deactivations, installSeries, licenseSeries, type InstallRow } from '../lib/telemetry/compute';
import { installsData } from '../lib/telemetry/data';
import { insertEvent, type EventRow, type EventType, type Plan } from '../lib/telemetry/db';
import { newDevice, newInstall, sendTelemetry } from './client';
import type { TrialEnv } from '../lib/trial/config';
import { NODUPE } from '../lib/trial/product';

const NOW_MS = Date.UTC(2026, 10, 21, 12, 0, 0); // 2026-11-21 12:00 UTC
const NOW = NOW_MS / 1000;
const range = buildRange('2026-10-23', '2026-11-21'); // the last 30 days

let seq = 0;
function ev(type: EventType, customer: string, ago: number, extra: Partial<EventRow> = {}): EventRow {
  seq += 1;
  return { seq, customer_uuid: customer, type, plan: null, license_fp: null, prev_license_fp: null, device_id: null, occurred_at: NOW - ago, ...extra };
}
const act = (customer: string, ago: number, license: string, device: string, plan: Plan = 'individual') =>
  ev('license_activated', customer, ago, { license_fp: license, device_id: device, plan });
const drop = (customer: string, ago: number, license: string, device: string) => ev('license_deactivated', customer, ago, { license_fp: license, device_id: device });

describe('buckets', () => {
  it('are one per UTC day for a short range and one per week for a long one', () => {
    const daily = bucketsFor(range);
    expect(daily.starts).toHaveLength(30);
    expect(daily.step).toBe(DAY);
    const weekly = bucketsFor(buildRange('2026-01-01', '2026-11-21'));
    expect(weekly.step).toBe(7 * DAY);
    expect(weekly.starts).toHaveLength(Math.ceil(325 / 7));
  });
  it('place a time in its bucket, and nothing outside the range', () => {
    const b = bucketsFor(range);
    expect(bucketIndex(range.fromSec, b)).toBe(0);
    expect(bucketIndex(range.toSecExclusive - 1, b)).toBe(29);
    expect(bucketIndex(range.fromSec - 1, b)).toBe(-1);
    expect(bucketIndex(range.toSecExclusive, b)).toBe(-1);
    expect(countByBucket([range.fromSec, range.fromSec + 5, range.fromSec - 5, range.toSecExclusive - 1], b)).toEqual([2, ...new Array(28).fill(0), 1]);
  });
});

describe('buy attempts', () => {
  it('converts when the same customer activates inside the window', () => {
    const attempts = buyAttempts([ev('buy_clicked', 'a', 5 * DAY), act('a', 4 * DAY, 'L', 'd')], 7, NOW);
    expect(attempts).toMatchObject([{ customer: 'a', outcome: 'converted' }]);
  });
  it('is pending while the window is open and abandoned after it', () => {
    expect(buyAttempts([ev('buy_clicked', 'a', 2 * DAY)], 7, NOW)[0].outcome).toBe('pending');
    expect(buyAttempts([ev('buy_clicked', 'a', 8 * DAY)], 7, NOW)[0].outcome).toBe('abandoned');
  });
  it('re-slices the same history when the window changes', () => {
    const events = [ev('buy_clicked', 'a', 10 * DAY), act('a', 5 * DAY, 'L', 'd')]; // activated 5 days after the click
    expect(buyAttempts(events, 7, NOW)[0].outcome).toBe('converted');
    expect(buyAttempts(events, 3, NOW)[0]).toMatchObject({ outcome: 'abandoned', late: true });
  });
  it('counts repeat clicks inside one window as one attempt, and a later click after it as another', () => {
    const events = [ev('buy_clicked', 'a', 30 * DAY), ev('buy_clicked', 'a', 29 * DAY), ev('buy_clicked', 'a', 10 * DAY)];
    expect(buyAttempts(events, 7, NOW)).toHaveLength(2);
  });
  it('does not count an activation from before the click, or by another customer', () => {
    const events = [act('a', 9 * DAY, 'L', 'd'), act('b', 4 * DAY, 'M', 'e'), ev('buy_clicked', 'a', 8 * DAY)];
    expect(buyAttempts(events, 7, NOW)[0].outcome).toBe('abandoned');
  });
  it('treats a key change as entering a key', () => {
    const events = [ev('buy_clicked', 'a', 3 * DAY), ev('license_key_changed', 'a', 2 * DAY, { license_fp: 'N', prev_license_fp: 'O', device_id: 'd', plan: 'business' })];
    expect(buyAttempts(events, 7, NOW)[0].outcome).toBe('converted');
  });
});

describe('active licenses', () => {
  const b = bucketsFor(range);
  const last = (events: EventRow[]) => licenseSeries(events, b, NOW);
  it('is active while any device is active, and inactive once every device is released', () => {
    const events = [act('a', 20 * DAY, 'L', 'd1'), act('a', 19 * DAY, 'L', 'd2'), drop('a', 10 * DAY, 'L', 'd1'), drop('a', 3 * DAY, 'L', 'd2')];
    const { points, current } = last(events);
    expect(points[13].active).toBe(1); // end of 5 Nov: both devices active
    expect(points[22].active).toBe(1); // end of 14 Nov: d2 still active after d1 was released
    expect(points[points.length - 1].active).toBe(0);
    expect(current.active).toBe(0);
  });
  it('counts history from before the range (a license activated last year is still active)', () => {
    const { points } = last([act('a', 400 * DAY, 'L', 'd')]);
    expect(points[0].active).toBe(1);
    expect(points[points.length - 1].active).toBe(1);
  });
  it('counts a license that moved to another computer as still active (not churn)', () => {
    const events = [act('a', 20 * DAY, 'L', 'old'), drop('a', 4 * DAY, 'L', 'old'), act('a', 4 * DAY - 60, 'L', 'new')];
    expect(last(events).current).toMatchObject({ active: 1, activeSeats: 1 });
  });
  it('splits active licenses by plan, using the latest plan seen for each', () => {
    const events = [act('a', 5 * DAY, 'L1', 'd1', 'individual'), act('b', 5 * DAY, 'L2', 'd2', 'business'), act('c', 5 * DAY, 'L3', 'd3', 'business')];
    expect(last(events).current.byPlan).toEqual({ individual: 1, business: 2 });
  });
  it('moves a seat from the old key to the new key on a key change', () => {
    const events = [act('a', 9 * DAY, 'OLD', 'd'), ev('license_key_changed', 'a', 2 * DAY, { license_fp: 'NEW', prev_license_fp: 'OLD', device_id: 'd', plan: 'business' })];
    expect(last(events).current).toMatchObject({ active: 1, byPlan: { individual: 0, business: 1 } });
  });
  it('reports licenses on more than one device', () => {
    expect(last([act('a', 5 * DAY, 'L', 'd1'), act('a', 4 * DAY, 'L', 'd2')]).current).toMatchObject({ active: 1, activeSeats: 2, multiDevice: 1 });
  });
  it('falls back to the customer when a machine had no usable signal', () => {
    const events = [ev('license_activated', 'a', 5 * DAY, { license_fp: 'L', plan: 'individual' }), ev('license_deactivated', 'a', 4 * DAY, { license_fp: 'L' })];
    expect(last(events).current.active).toBe(0);
  });
});

describe('deactivations are classed by what happened next', () => {
  it('moved, same device, or not in use since', () => {
    const events = [
      act('a', 30 * DAY, 'L1', 'd1'), drop('a', 20 * DAY, 'L1', 'd1'), act('a', 19 * DAY, 'L1', 'd2'),
      act('b', 30 * DAY, 'L2', 'd3'), drop('b', 20 * DAY, 'L2', 'd3'), act('b', 19 * DAY, 'L2', 'd3'),
      act('c', 30 * DAY, 'L3', 'd4'), drop('c', 20 * DAY, 'L3', 'd4'),
    ];
    expect(deactivations(events).map((d) => d.outcome)).toEqual(['moved', 'same_device', 'unused']);
  });
});

describe('installs (installer events)', () => {
  const row = (type: 'install' | 'uninstall', ago: number, kind: string | null, customer = 'a'): InstallRow => ({ customer_uuid: customer, type, install_kind: kind, occurred_at: NOW - ago });

  it('counts installs by kind and uninstalls per bucket', () => {
    const b = bucketsFor(range);
    const series = installSeries([row('install', 2 * DAY, 'new'), row('install', 2 * DAY, 'upgrade', 'b'), row('install', DAY, 'reinstall', 'c'), row('uninstall', DAY, null, 'a')], b);
    expect(series.byKind.new.reduce((x, y) => x + y, 0)).toBe(1);
    expect(series.byKind.upgrade.reduce((x, y) => x + y, 0)).toBe(1);
    expect(series.byKind.reinstall.reduce((x, y) => x + y, 0)).toBe(1);
    expect(series.uninstalls.reduce((x, y) => x + y, 0)).toBe(1);
  });

  it('leaves out events outside the range, and sums to the headline numbers', () => {
    const rows = [row('install', 2 * DAY, 'new'), row('install', 90 * DAY, 'new', 'old'), row('install', DAY, 'new', 'b'), row('uninstall', DAY, null, 'b')];
    const data = installsData(rows, range);
    expect(data).toMatchObject({ installs: 2, new: 2, upgrades: 0, reinstalls: 0, uninstalls: 1, distinct_installs: 2, distinct_uninstalls: 1, net_new: 1, uninstall_rate: 0.5 });
    expect(data.series.new.reduce((x, y) => x + y, 0)).toBe(2);
  });

  it('has no rate when there is no install, and works with no events at all', () => {
    expect(installsData([], range)).toMatchObject({ installs: 0, uninstalls: 0, uninstall_rate: null, net_new: 0 });
    expect(installsData([row('uninstall', DAY, null)], range)).toMatchObject({ installs: 0, uninstalls: 1, uninstall_rate: null });
  });
});

// ------------------------------------------------------------------- admin tabs and API

const creds: AdminEnv = { ADMIN_USER: 'ops', ADMIN_PASSWORD: 'correct horse battery' };
const full = (): AdminRuntimeEnv => ({ ...creds, TRIAL_DB: env.TRIAL_DB, NODUPE_DB: env.NODUPE_DB });
const good = `Basic ${btoa('ops:correct horse battery')}`;
const get = (path: string, authorization: string | null = good) =>
  new Request(`https://technowizsolutions.com${path}`, { headers: authorization ? { authorization } : {} });

async function seed() {
  const base = { receivedAt: NOW, appVersion: null, osBuild: null, licenseFp: null, prevLicenseFp: null, plan: null, deviceId: null };
  const add = (type: EventType, customer: string, ago: number, extra: Record<string, unknown> = {}) =>
    insertEvent(env.TRIAL_DB, { ...base, eventId: crypto.randomUUID(), customerUuid: customer, type, occurredAt: NOW - ago, ...extra } as never);
  await add('buy_clicked', 'c1', 3 * DAY);
  await add('license_activated', 'c1', 2 * DAY, { licenseFp: 'L1', plan: 'business', deviceId: 'd1' });
  await add('buy_clicked', 'c2', 20 * DAY);
}

beforeEach(() => resetAdminGuard());

describe('/admin/insights tabs', () => {
  it('keeps the same login as the other admin pages', async () => {
    for (const tab of ['buying', 'licenses', 'devices']) {
      expect((await handleAdminInsights(get(`/admin/insights?tab=${tab}`, null), full(), NOW_MS)).status, tab).toBe(401);
    }
  });

  it('shows the tab row on every tab, with the current one marked', async () => {
    await seed();
    for (const tab of INSIGHT_TABS) {
      const html = await (await handleAdminInsights(get(`/admin/insights?tab=${tab.id}`), full(), NOW_MS)).text();
      expect(html, tab.id).toContain('aria-label="Insights sections"');
      expect(html, tab.id).toMatch(new RegExp(`tab=${tab.id}[^"]*" aria-current="true">${tab.label}<`));
    }
  });

  it('leaves the original trials page as the default', async () => {
    const html = await (await handleAdminInsights(get('/admin/insights'), full(), NOW_MS)).text();
    expect(html).toContain('New trials per');
    expect(html).toMatch(/tab=trials[^"]*" aria-current="true">Trials</);
  });

  it('shows the buying funnel and re-slices it with the window', async () => {
    await seed();
    const html = async (q: string) => (await handleAdminInsights(get(`/admin/insights?tab=buying${q}`), full(), NOW_MS)).text();
    const seven = await html('&window=7');
    expect(seven).toContain('Buy clicks by outcome');
    expect(seven).toContain('no activation in 7 days');
    expect(await html('&window=3')).toContain('no activation in 3 days');
  });

  it('shows active licenses and the plan split', async () => {
    await seed();
    const html = await (await handleAdminInsights(get('/admin/insights?tab=licenses'), full(), NOW_MS)).text();
    expect(html).toContain('Active licenses by plan');
    expect(html).toMatch(/<p class="l">Business<\/p><p class="v">1</);
  });

  it('opens with a notice, not an error, before migration 0003 is applied', async () => {
    const broken = { ...full(), TRIAL_DB: { prepare: () => { throw new Error('no such table: telemetry_events'); } } as unknown as D1Database };
    const response = await handleAdminInsights(get('/admin/insights?tab=devices'), broken, NOW_MS);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('apply the latest migration');
  });

  it('works with no events at all, and on a long range (weekly buckets)', async () => {
    for (const tab of ['buying', 'licenses', 'devices']) {
      const response = await handleAdminInsights(get(`/admin/insights?tab=${tab}&from=2026-01-01&to=2026-11-21`), full(), NOW_MS);
      expect(response.status, tab).toBe(200);
      expect(await response.text()).toContain('shown as weekly totals');
    }
  });

  it('puts nothing user-supplied into the page', async () => {
    const html = await (await handleAdminInsights(get('/admin/insights?tab=buying&window=%3Cscript%3E&product=INJECTED%3Cmarker'), full(), NOW_MS)).text();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('INJECTED');
  });
});

async function seedNodupeTrials() {
  let n = 0;
  const trial = (ago: number, used: { basic: number; similar: number; deep: number }, status = 'active') => {
    n += 1;
    const at = NOW - ago;
    return env.NODUPE_DB.prepare(
      `INSERT INTO trials (id, pubkey, support_ref, name_enc, email_enc, used, limit_total, used_basic, used_similar, used_deep, status, terms_version, privacy_version,
         accepted_at, received_at, created_at, last_server_contact_at, product)
       VALUES (?1, ?2, ?3, 'v1.SECRETNAME.x', 'v1.SECRETEMAIL.x', ?4, 9, ?5, ?6, ?7, ?8, 'v', 'v', ?9, ?9, ?9, ?9, 'nodupe')`,
    )
      .bind(`t${n}`, `pk${n}`, `REF${n}`, used.basic + used.similar + used.deep, used.basic, used.similar, used.deep, status, at)
      .run();
  };
  await trial(3 * DAY, { basic: 5, similar: 3, deep: 1 }); // used everything
  await trial(2 * DAY, { basic: 2, similar: 0, deep: 0 });
  await trial(2 * DAY, { basic: 5, similar: 1, deep: 0 });
  await trial(60 * DAY, { basic: 1, similar: 1, deep: 1 }); // before the range
  await trial(2 * DAY, { basic: 3, similar: 3, deep: 1 }, 'reset'); // reset by support: left out
}

describe('/admin/insights scans tab', () => {
  it('shows NoDupe scan counts per mode from its trials, counts only', async () => {
    await seedNodupeTrials();
    const html = await (await handleAdminInsights(get('/admin/insights?tab=scans&product=nodupe'), full(), NOW_MS)).text();
    expect(html).toContain('Basic scans used per trial');
    expect(html).toMatch(/<p class="l">Trials registered<\/p><p class="v">3</); // in range, reset one left out
    expect(html).toMatch(/<p class="l">Basic scans<\/p><p class="v">12</); // 5 + 2 + 5
    expect(html).toMatch(/<p class="l">Used everything<\/p><p class="v">1</);
    expect(html).toMatch(/<p class="l">Basic at limit<\/p><p class="v">2</);
    expect(html).toMatch(/<p class="l">Deep at limit<\/p><p class="v">1</);
    expect(html).toMatch(/<p class="l">All trials, ever<\/p><p class="v">4</);
    for (const secret of ['SECRETNAME', 'SECRETEMAIL', 'REF1', 'pk1']) expect(html).not.toContain(secret);
  });

  it('is NoDupe\'s whatever product is selected, and says so for PinchPDF', async () => {
    await seedNodupeTrials();
    const pinch = await (await handleAdminInsights(get('/admin/insights?tab=scans&product=pinchpdf'), full(), NOW_MS)).text();
    expect(pinch).toContain('always NoDupe');
    expect(pinch).toMatch(/<p class="l">Trials registered<\/p><p class="v">3</);
  });

  it('opens with a notice when the NoDupe database is not bound, and leaves the other tabs alone', async () => {
    const unbound = { ...full(), NODUPE_DB: undefined };
    const scans = await handleAdminInsights(get('/admin/insights?tab=scans'), unbound, NOW_MS);
    expect(scans.status).toBe(200);
    expect(await scans.text()).toContain('NODUPE_DB');
    expect((await handleAdminInsights(get('/admin/insights?tab=buying'), unbound, NOW_MS)).status).toBe(200);
  });

  it('says there is nothing yet when no NoDupe trial exists', async () => {
    const html = await (await handleAdminInsights(get('/admin/insights?tab=scans'), full(), NOW_MS)).text();
    expect(html).toContain('No NoDupe trials have been registered yet');
  });
});

describe('/admin/insights installs tab', () => {
  async function seedInstalls(db: D1Database) {
    const add = (type: EventType, customer: string, ago: number, installKind: 'new' | 'upgrade' | 'reinstall' | null) =>
      insertEvent(db, { eventId: crypto.randomUUID(), customerUuid: customer, type, plan: null, licenseFp: null, prevLicenseFp: null, deviceId: null, installKind, occurredAt: NOW - ago, receivedAt: NOW, appVersion: null, osBuild: null });
    await add('install', 'i1', 4 * DAY, 'new');
    await add('install', 'i2', 3 * DAY, 'new');
    await add('install', 'i3', 2 * DAY, 'upgrade');
    await add('uninstall', 'i1', DAY, null);
  }

  it('shows installs by kind and uninstalls for PinchPDF, NoDupe and both', async () => {
    await seedInstalls(env.TRIAL_DB);
    await seedInstalls(env.NODUPE_DB);
    const kpi = (html: string, label: string) => html.match(new RegExp(`<p class="l">${label}</p><p class="v">(\\d+)<`))?.[1];
    for (const [product, installs] of [['pinchpdf', '3'], ['nodupe', '3'], ['all', '6']]) {
      const html = await (await handleAdminInsights(get(`/admin/insights?tab=installs&product=${product}`), full(), NOW_MS)).text();
      expect(kpi(html, 'Installs'), product).toBe(installs);
      expect(html).toContain('Installs by kind');
      expect(html).not.toContain('i1');
    }
  });

  it('keeps installer events out of the buying, licenses and devices numbers', async () => {
    await seedInstalls(env.TRIAL_DB);
    const html = await (await handleAdminInsights(get('/admin/insights?tab=licenses'), full(), NOW_MS)).text();
    expect(html).toMatch(/<p class="l">Active licenses<\/p><p class="v">0</);
    expect(html).toContain('No telemetry has been received yet');
  });

  it('says so when no installer event has arrived', async () => {
    const html = await (await handleAdminInsights(get('/admin/insights?tab=installs'), full(), NOW_MS)).text();
    expect(html).toContain('No installs or uninstalls have been reported yet');
  });
});

describe('/api/pinchpdf/insights/v1/{tab}', () => {
  const run = (tab: string, query = '', authorization: string | null = good, environment: AdminRuntimeEnv = full()) =>
    handleInsightsApi(get(`/api/pinchpdf/insights/v1/${tab}${query}`, authorization), environment, NOW_MS);
  // The tests read the JSON freely, so it is loosely typed (as in client.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Json = Record<string, any>;

  it('needs the admin login, and is 404 when it is not configured', async () => {
    expect((await run('buying', '', null)).status).toBe(401);
    expect((await run('buying', '', `Basic ${btoa('ops:wrong password')}`)).status).toBe(401);
    expect((await run('buying', '', good, { TRIAL_DB: env.TRIAL_DB })).status).toBe(404);
  });

  it('has no scans tab for PinchPDF (404), and installs works', async () => {
    expect((await run('scans')).status).toBe(404);
    await insertEvent(env.TRIAL_DB, { eventId: crypto.randomUUID(), customerUuid: 'i1', type: 'install', plan: null, licenseFp: null, prevLicenseFp: null, deviceId: null, installKind: 'new', occurredAt: NOW - DAY, receivedAt: NOW, appVersion: null, osBuild: null });
    const installs = (await (await run('installs')).json()) as Json;
    expect(installs).toMatchObject({ product: 'pinchpdf', tab: 'installs', installs: 1, new: 1, uninstalls: 0 });
    expect(JSON.stringify(installs)).not.toContain('i1');
  });

  it('answers 404 for an unknown tab, without leaking anything', async () => {
    const response = await run('secrets');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('returns the numbers the tabs show, as JSON', async () => {
    await seed();
    const buying = (await (await run('buying', '?window=7')).json()) as Json;
    expect(buying).toMatchObject({ tab: 'buying', window_days: 7, converted: 1, abandoned: 1, pending: 0, conversion_rate: 0.5, generated_at: NOW, bucket_days: 1 });
    expect(buying.range).toEqual({ from: '2026-10-23', to: '2026-11-21', days: 30 });
    expect(buying.bucket_starts).toHaveLength(30);
    expect(buying.series.converted).toHaveLength(30);

    const licenses = (await (await run('licenses')).json()) as Json;
    expect(licenses.current).toMatchObject({ active: 1, business: 1, individual: 0, active_devices: 1 });
    expect(licenses.series.active.at(-1)).toBe(1);

    const devices = (await (await run('devices')).json()) as Json;
    expect(devices).toMatchObject({ deactivations: 0, key_changes: 0 });
  });

  it('applies the date range and the window, and rejects a bad range', async () => {
    await seed();
    const narrow = (await (await run('buying', '?from=2026-11-18&to=2026-11-21')).json()) as Json;
    expect(narrow.attempts).toBe(1); // only c1's click (3 days ago) is in the last 4 days
    expect(narrow.bucket_starts).toHaveLength(4);
    expect(((await (await run('buying', '?window=9999')).json()) as Json).window_days).toBe(90);
    expect(((await (await run('buying', '?window=abc')).json()) as Json).window_days).toBe(7);
    const bad = await run('buying', '?from=2026-11-21&to=2026-11-01');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'bad_range' });
  });

  it('is never cached and carries no identifiers (only counts)', async () => {
    await seed();
    const response = await run('licenses');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    for (const needle of ['L1', 'd1', 'c1', 'c2']) expect(text).not.toContain(`"${needle}"`);
  });

  it('answers 503, not a stack trace, when the database fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...full(), TRIAL_DB: { prepare: () => { throw new Error('d1 down'); } } as unknown as D1Database };
    const response = await run('buying', '', good, broken);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('d1 down');
    error.mockRestore();
  });
});

describe('/api/nodupe/insights/v1/{tab}', () => {
  const run = (tab: string, query = '', authorization: string | null = good, environment: AdminRuntimeEnv = full()) =>
    handleInsightsApi(get(`/api/nodupe/insights/v1/${tab}${query}`, authorization), environment, NOW_MS, NODUPE);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Json = Record<string, any>;

  it('needs the same admin login', async () => {
    expect((await run('scans', '', null)).status).toBe(401);
    expect((await run('scans', '', good, { TRIAL_DB: env.TRIAL_DB, NODUPE_DB: env.NODUPE_DB })).status).toBe(404);
  });

  it('returns NoDupe\'s scan numbers per mode from its trials, as counts only', async () => {
    await seedNodupeTrials();
    const scans = (await (await run('scans')).json()) as Json;
    expect(scans).toMatchObject({
      product: 'nodupe',
      tab: 'scans',
      free_allowance: { basic: 5, similar: 3, deep: 1 },
      registered_in_range: 3,
      total: { basic: 12, similar: 4, deep: 1 },
      at_limit: { basic: 2, similar: 1, deep: 1, all_modes: 1 },
      all_time: { trials: 4 },
    });
    expect(scans.histogram.basic).toEqual([0, 0, 1, 0, 0, 2]); // two at 5, one at 2
    expect(scans.histogram.deep).toEqual([2, 1]);
    const text = JSON.stringify(scans);
    for (const secret of ['SECRETNAME', 'SECRETEMAIL', 'REF1', 'pk1', 't1']) expect(text).not.toContain(secret);
  });

  it('reads NoDupe\'s own database: PinchPDF events do not appear, NoDupe events do', async () => {
    const event = (db: D1Database, type: EventType, extra: Record<string, unknown>) =>
      insertEvent(db, { eventId: crypto.randomUUID(), customerUuid: 'c1', type, plan: null, licenseFp: null, prevLicenseFp: null, deviceId: null, occurredAt: NOW - DAY, receivedAt: NOW, appVersion: null, osBuild: null, ...extra } as never);
    await event(env.TRIAL_DB, 'buy_clicked', {});
    expect(((await (await run('buying')).json()) as Json).attempts).toBe(0);
    await event(env.NODUPE_DB, 'buy_clicked', {});
    expect(((await (await run('buying')).json()) as Json).attempts).toBe(1);
  });

  it('answers 503 when NoDupe\'s database is not bound', async () => {
    expect((await run('buying', '', good, { ...full(), NODUPE_DB: undefined })).status).toBe(503);
  });
});

describe('telemetry requests are counted like the trial ones', () => {
  it('records the outcome in metrics_daily (shown in the requests chart of the Trials tab)', async () => {
    const e = env as unknown as TrialEnv;
    const { reply } = await sendTelemetry(e, { install: await newInstall(), customer: crypto.randomUUID(), device: newDevice(), type: 'buy_clicked' });
    expect(reply.result).toEqual({ result: 'ok' });
    const { results } = await env.TRIAL_DB.prepare("SELECT endpoint, outcome, count FROM metrics_daily WHERE endpoint = 'telemetry'").all();
    expect(results).toEqual([{ endpoint: 'telemetry', outcome: 'ok', count: 1 }]);
  });
});
