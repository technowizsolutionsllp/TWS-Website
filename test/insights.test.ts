// Insights: the calculations (pure) and the protected tabbed page.

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY, WEEK, buyAttempts, deactivations, lastWeeks, licenseSeries, weekStart } from '../lib/telemetry/compute';
import { insertEvent, type EventRow, type EventType, type Plan } from '../lib/telemetry/db';
import { TABS, handleInsights, handleInsightsApi, resetInsightsLog, type InsightsEnv } from '../lib/telemetry/page';
import { resetDocsFallbackLimiter } from '../lib/trial/docs';

const NOW = 1_800_000_000; // Unix seconds (a Friday)
let seq = 0;
function ev(type: EventType, customer: string, ago: number, extra: Partial<EventRow> = {}): EventRow {
  seq += 1;
  return { seq, customer_uuid: customer, type, plan: null, license_fp: null, prev_license_fp: null, device_id: null, occurred_at: NOW - ago, ...extra };
}
const act = (customer: string, ago: number, license: string, device: string, plan: Plan = 'individual') =>
  ev('license_activated', customer, ago, { license_fp: license, device_id: device, plan });
const drop = (customer: string, ago: number, license: string, device: string) => ev('license_deactivated', customer, ago, { license_fp: license, device_id: device });

describe('weeks', () => {
  it('start on Monday 00:00 UTC', () => {
    const monday = Date.UTC(2026, 10, 16) / 1000; // 16 Nov 2026 is a Monday
    expect(new Date(weekStart(monday + 3 * DAY + 5000) * 1000).getUTCDay()).toBe(1);
    expect(weekStart(monday + 6 * DAY)).toBe(monday);
    expect(weekStart(monday)).toBe(monday);
  });
  it('lists the last N weeks oldest first, ending with the current one', () => {
    const weeks = lastWeeks(NOW, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks[3]).toBe(weekStart(NOW));
    expect(weeks[3] - weeks[2]).toBe(WEEK);
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
  const weeks = lastWeeks(NOW, 3);
  it('is active while any device is active, and inactive once every device is released', () => {
    const events = [act('a', 20 * DAY, 'L', 'd1'), act('a', 19 * DAY, 'L', 'd2'), drop('a', 10 * DAY, 'L', 'd1'), drop('a', 3 * DAY, 'L', 'd2')];
    const { weekly, current } = licenseSeries(events, weeks, NOW);
    expect(weekly.map((s) => s.active)).toEqual([1, 1, 0]);
    expect(current.active).toBe(0);
  });
  it('counts a license that moved to another computer as still active (not churn)', () => {
    const events = [act('a', 20 * DAY, 'L', 'old'), drop('a', 4 * DAY, 'L', 'old'), act('a', 4 * DAY - 60, 'L', 'new')];
    const { current } = licenseSeries(events, weeks, NOW);
    expect(current).toMatchObject({ active: 1, activeSeats: 1 });
  });
  it('splits active licenses by plan, using the latest plan seen for each', () => {
    const events = [act('a', 5 * DAY, 'L1', 'd1', 'individual'), act('b', 5 * DAY, 'L2', 'd2', 'business'), act('c', 5 * DAY, 'L3', 'd3', 'business')];
    expect(licenseSeries(events, weeks, NOW).current.byPlan).toEqual({ individual: 1, business: 2 });
  });
  it('moves a seat from the old key to the new key on a key change', () => {
    const events = [act('a', 9 * DAY, 'OLD', 'd'), ev('license_key_changed', 'a', 2 * DAY, { license_fp: 'NEW', prev_license_fp: 'OLD', device_id: 'd', plan: 'business' })];
    const { current } = licenseSeries(events, weeks, NOW);
    expect(current).toMatchObject({ active: 1, byPlan: { individual: 0, business: 1 } });
  });
  it('reports licenses on more than one device', () => {
    const events = [act('a', 5 * DAY, 'L', 'd1'), act('a', 4 * DAY, 'L', 'd2')];
    expect(licenseSeries(events, weeks, NOW).current).toMatchObject({ active: 1, activeSeats: 2, multiDevice: 1 });
  });
  it('falls back to the customer when a machine had no usable signal', () => {
    const events = [ev('license_activated', 'a', 5 * DAY, { license_fp: 'L', plan: 'individual' }), ev('license_deactivated', 'a', 4 * DAY, { license_fp: 'L' })];
    expect(licenseSeries(events, weeks, NOW).current.active).toBe(0);
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

// ----------------------------------------------------------------------- page

const e = env as unknown as InsightsEnv & { TRIAL_DB: D1Database };
const creds: InsightsEnv = { ...e, INSIGHTS_USER: 'owner', INSIGHTS_PASSWORD: 'a-long-enough-password-1' };
const basic = (u: string, p: string) => `Basic ${btoa(`${u}:${p}`)}`;
const get = (query = '', authorization?: string) =>
  new Request(`https://technowizsolutions.com/insights${query}`, { headers: authorization ? { authorization } : {} });
const good = basic('owner', 'a-long-enough-password-1');

async function seed() {
  const base = { receivedAt: NOW, appVersion: null, osBuild: null, licenseFp: null, prevLicenseFp: null, plan: null, deviceId: null };
  const add = (type: EventType, customer: string, ago: number, extra: Record<string, unknown> = {}) =>
    insertEvent(e.TRIAL_DB, { ...base, eventId: crypto.randomUUID(), customerUuid: customer, type, occurredAt: NOW - ago, ...extra } as never);
  await add('buy_clicked', 'c1', 3 * DAY);
  await add('license_activated', 'c1', 2 * DAY, { licenseFp: 'L1', plan: 'business', deviceId: 'd1' });
  await add('buy_clicked', 'c2', 20 * DAY);
}

beforeEach(() => {
  resetDocsFallbackLimiter();
  resetInsightsLog();
});

describe('/insights', () => {
  it('asks for credentials, refuses wrong ones, and is 404 when not configured or the password is short', async () => {
    expect((await handleInsights(get(), creds, () => NOW * 1000)).status).toBe(401);
    expect((await handleInsights(get('', basic('owner', 'wrong')), creds, () => NOW * 1000)).status).toBe(401);
    expect((await handleInsights(get('', good), { ...e }, () => NOW * 1000)).status).toBe(404);
    expect((await handleInsights(get('', basic('owner', 'short')), { ...e, INSIGHTS_USER: 'owner', INSIGHTS_PASSWORD: 'short' }, () => NOW * 1000)).status).toBe(404);
  });

  it('logs which settings are missing by name only, once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handleInsights(get(), { ...e, INSIGHTS_PASSWORD: 'secret-value-that-is-long-1' }, () => NOW * 1000);
    await handleInsights(get(), { ...e, INSIGHTS_PASSWORD: 'secret-value-that-is-long-1' }, () => NOW * 1000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('secret-value');
    warn.mockRestore();
  });

  it('serves every tab with a strict CSP, no scripts and noindex', async () => {
    await seed();
    for (const tab of TABS) {
      const response = await handleInsights(get(`?tab=${tab.id}`, good), creds, () => NOW * 1000);
      expect(response.status, tab.id).toBe(200);
      const csp = response.headers.get('content-security-policy')!;
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('script-src');
      expect(csp).not.toContain('unsafe-inline');
      expect(response.headers.get('x-robots-tag')).toContain('noindex');
      const html = await response.text();
      expect(html).not.toContain('<script');
      expect(html).toContain(`aria-current="page">${tab.label}<`);
      expect(html).toContain(`<style nonce="${csp.match(/'nonce-([^']+)'/)![1]}">`);
    }
  });

  it('shows the funnel on Buying and re-slices it with the window', async () => {
    await seed();
    const html = async (query: string) => (await handleInsights(get(query, good), creds, () => NOW * 1000)).text();
    const week = await html('?tab=buying&window=7');
    expect(week).toContain('Buy clicks by outcome');
    expect(week).toContain('Abandoned');
    // c1 activated 1 day after the click: converted in 7 days and in 3 days
    expect(week).toMatch(/Activated in time<\/div><div class="statvalue">|statvalue">1<\/div><div class="statlabel">Activated in time/);
    expect(await html('?tab=buying&window=3')).toContain('within 3 days');
  });

  it('shows active licenses and the plan split on Licenses', async () => {
    await seed();
    const html = await (await handleInsights(get('?tab=licenses', good), creds, () => NOW * 1000)).text();
    expect(html).toContain('Active licenses by plan');
    expect(html).toMatch(/statvalue">1<\/div><div class="statlabel">Business/);
  });

  it('works with no events at all', async () => {
    for (const tab of TABS) {
      const response = await handleInsights(get(`?tab=${tab.id}`, good), creds, () => NOW * 1000);
      expect(response.status, tab.id).toBe(200);
    }
  });

  it('ignores an unknown tab, clamps the window, and escapes nothing user-supplied into the page', async () => {
    const response = await handleInsights(get('?tab=%3Cscript%3E&window=999999', good), creds, () => NOW * 1000);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('aria-current="page">Overview<');
    expect(html).toContain('window=90');
    expect(html).not.toContain('<script');
  });

  it('answers 503, not a stack trace, when the database fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...creds, TRIAL_DB: { prepare: () => { throw new Error('d1 down'); } } as unknown as D1Database };
    const response = await handleInsights(get('', good), broken, () => NOW * 1000);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('d1 down');
    error.mockRestore();
  });
});

// The tests read the JSON freely, so it is loosely typed (as in client.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

describe('/api/pinchpdf/insights/v1/{tab}', () => {
  const api = (tab: string, query = '', authorization?: string) =>
    new Request(`https://technowizsolutions.com/api/pinchpdf/insights/v1/${tab}${query}`, { headers: authorization ? { authorization } : {} });
  const run = (tab: string, query = '', authorization: string | null = good, environment: InsightsEnv = creds) =>
    handleInsightsApi(api(tab, query, authorization ?? undefined), environment, () => NOW * 1000);

  it('needs the same credentials as the dashboard, and is 404 when they are not configured', async () => {
    expect((await run('overview', '', null)).status).toBe(401);
    expect((await run('overview', '', basic('owner', 'wrong'))).status).toBe(401);
    expect((await run('overview', '', good, { ...e })).status).toBe(404);
  });

  it('answers 404 for an unknown tab, without leaking anything', async () => {
    const response = await run('secrets');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('returns the numbers the dashboard shows, as JSON', async () => {
    await seed();
    const buying = (await (await run('buying', '?window=7')).json()) as Json;
    expect(buying).toMatchObject({ tab: 'buying', window_days: 7, converted: 1, abandoned: 1, pending: 0, conversion_rate: 0.5, generated_at: NOW });
    expect(buying.week_starts).toHaveLength(12);
    expect(buying.weekly.converted).toHaveLength(12);

    const licenses = (await (await run('licenses')).json()) as Json;
    expect(licenses.current).toMatchObject({ active: 1, business: 1, individual: 0, active_devices: 1 });
    expect(licenses.weekly.active.at(-1)).toBe(1);

    const overview = (await (await run('overview')).json()) as Json;
    expect(overview).toMatchObject({ active_licenses: 1, events_recorded: 3, last_30_days: { buy_attempts: 2, converted: 1, abandoned: 1 } });

    const devices = (await (await run('devices')).json()) as Json;
    expect(devices).toMatchObject({ deactivations: 0, key_changes: 0 });
  });

  it('applies the window parameter and clamps it', async () => {
    await seed();
    expect(((await (await run('buying', '?window=1')).json()) as { window_days: number }).window_days).toBe(1);
    expect(((await (await run('buying', '?window=9999')).json()) as { window_days: number }).window_days).toBe(90);
    expect(((await (await run('buying', '?window=abc')).json()) as { window_days: number }).window_days).toBe(7);
  });

  it('is never cached and carries no identifiers (only counts)', async () => {
    await seed();
    const response = await run('licenses');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    for (const needle of ['L1', 'd1', 'c1', 'c2']) expect(text).not.toContain(`"${needle}"`);
  });

  it('answers 503 when the database fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...creds, TRIAL_DB: { prepare: () => { throw new Error('d1 down'); } } as unknown as D1Database };
    const response = await run('overview', '', good, broken);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('d1 down');
    error.mockRestore();
  });
});
