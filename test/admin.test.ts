// The /admin pages: login, query handling, the numbers, request counters and charts.

import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_ADMIN_PASSWORD_LENGTH, resetAdminGuard, type AdminEnv } from '../lib/admin/auth';
import { columnChart, esc, niceMax, shareBars } from '../lib/admin/charts';
import { handleAdminHome, handleAdminInsights, type AdminRuntimeEnv } from '../lib/admin/handlers';
import { loadInsights } from '../lib/admin/insights';
import { MAX_RANGE_DAYS, buildRange, parseQuery } from '../lib/admin/range';
import { FLUSH_INTERVAL_MS, outcomeFromStatus, recordMetric } from '../lib/trial/metrics';
import { handleChallenge } from '../lib/trial/handlers';

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0); // 2026-11-21
const creds: AdminEnv = { ADMIN_USER: 'ops', ADMIN_PASSWORD: 'correct horse battery' };
const basic = (user: string, password: string) => `Basic ${btoa(`${user}:${password}`)}`;
const get = (path: string, authorization?: string, headers: Record<string, string> = {}) =>
  new Request(`https://technowizsolutions.com${path}`, { headers: { ...(authorization ? { authorization } : {}), ...headers } });
const good = basic(creds.ADMIN_USER!, creds.ADMIN_PASSWORD!);
const full = (): AdminRuntimeEnv => ({ ...creds, TRIAL_DB: env.TRIAL_DB, NODUPE_DB: env.NODUPE_DB });

beforeEach(() => resetAdminGuard());
afterEach(() => vi.restoreAllMocks());

let seq = 0;
async function addTrial(day: string, fields: Partial<{ product: string; used: number; limit: number; status: string; app: string | null; os: string | null }> = {}) {
  seq += 1;
  const created = Date.parse(`${day}T10:00:00Z`) / 1000;
  await env.TRIAL_DB.prepare(
    `INSERT INTO trials (id, pubkey, support_ref, name_enc, email_enc, used, limit_total, status, terms_version, privacy_version,
       accepted_at, received_at, created_at, last_server_contact_at, app_version, os_build, product)
     VALUES (?1, ?2, ?3, 'v1.SECRETNAME.x', 'v1.SECRETEMAIL.x', ?4, ?5, ?6, 'v', 'v', ?7, ?7, ?7, ?7, ?8, ?9, ?10)`,
  )
    .bind(`id${seq}`, `pk${seq}`, `REF${seq}`, fields.used ?? 0, fields.limit ?? 5, fields.status ?? 'active', created, fields.app === undefined ? '1.4.2' : fields.app, fields.os === undefined ? 'Win 11' : fields.os, fields.product ?? 'pinchpdf')
    .run();
}

describe('admin login', () => {
  it('stays off (404) when credentials are missing or the password is too short', async () => {
    for (const partial of [{}, { ADMIN_USER: 'a' }, { ADMIN_PASSWORD: 'longenough' }, { ADMIN_USER: 'a', ADMIN_PASSWORD: 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1) }]) {
      expect((await handleAdminHome(get('/admin', basic('a', 'longenough')), partial)).status).toBe(404);
    }
  });

  it('asks for a login, refuses wrong ones, and accepts the right one', async () => {
    const anonymous = await handleAdminHome(get('/admin'), full());
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toMatch(/^Basic realm="TWS admin"/);
    for (const header of [basic('ops', 'wrong password'), basic('other', creds.ADMIN_PASSWORD!), 'Bearer x', 'Basic !!!']) {
      expect((await handleAdminHome(get('/admin', header), full())).status, header).toBe(401);
      expect((await handleAdminInsights(get('/admin/insights', header), full(), NOW)).status, header).toBe(401);
    }
    expect((await handleAdminHome(get('/admin', good), full())).status).toBe(200);
  });

  it('serves pages that cannot be cached, indexed or run scripts', async () => {
    const response = await handleAdminHome(get('/admin', good), full());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    const csp = response.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    expect(csp).toContain("frame-ancestors 'none'");
    const html = await response.text();
    expect(html).not.toContain('<script');
    expect(html).toContain('href="/admin/insights"');
    expect(html).toContain('href="/api/pinchpdf/trial/docs"');
  });

  it('throttles per IP before looking at credentials, and ignores X-Forwarded-For', async () => {
    const keys: string[] = [];
    const spy = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) };
    await handleAdminHome(get('/admin', undefined, { 'x-forwarded-for': '6.6.6.6' }), { ...creds, TRIAL_ADMIN_LIMITER: spy });
    await handleAdminHome(get('/admin', undefined, { 'cf-connecting-ip': '198.51.100.4' }), { ...creds, TRIAL_ADMIN_LIMITER: spy });
    expect(keys).toEqual(['unknown', '198.51.100.4']);
    const refuse = { limit: async () => ({ success: false }) };
    expect((await handleAdminHome(get('/admin', good), { ...creds, TRIAL_ADMIN_LIMITER: refuse })).status).toBe(429);
  });

  it('logs which setting is missing, by name only, once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const password = 'a-secret-admin-password';
    await handleAdminHome(get('/admin'), { ADMIN_PASSWORD: password });
    await handleAdminHome(get('/admin'), { ADMIN_PASSWORD: password });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ svc: 'admin', result: 'disabled', ADMIN_USER: false, ADMIN_PASSWORD: true });
    expect(line).not.toContain(password);
  });
});

describe('query handling', () => {
  const params = (query: string) => new URLSearchParams(query);

  it('defaults to PinchPDF and the last 30 days', () => {
    const { product, range, error } = parseQuery(params(''), NOW);
    expect(product).toBe('pinchpdf');
    expect(range).toMatchObject({ from: '2026-10-23', to: '2026-11-21', days: 30 });
    expect(error).toBeNull();
  });

  it('accepts a custom range and a product choice', () => {
    const parsed = parseQuery(params('product=all&from=2026-01-01&to=2026-01-31'), NOW);
    expect(parsed.product).toBe('all');
    expect(parsed.range).toMatchObject({ from: '2026-01-01', to: '2026-01-31', days: 31 });
    expect(parsed.range.toSecExclusive - parsed.range.fromSec).toBe(31 * 86400);
    expect(parsed.range.fromSec - parsed.range.prevFromSec).toBe(31 * 86400);
    expect(parseQuery(params('product=nodupe'), NOW).product).toBe('nodupe');
  });

  it('falls back to the defaults and says why for bad input', () => {
    const bad: [string, RegExp][] = [
      ['from=2026-13-01&to=2026-11-01', /look like/],
      ['from=yesterday&to=today', /look like/],
      ['from=2026-02-30&to=2026-03-01', /look like/],
      ['from=2026-11-10&to=2026-11-01', /on or before/],
      ['from=2026-11-01&to=2026-12-25', /future/],
      [`from=2024-01-01&to=2026-11-21`, new RegExp(`limited to ${MAX_RANGE_DAYS}`)],
    ];
    for (const [query, message] of bad) {
      const parsed = parseQuery(params(query), NOW);
      expect(parsed.error, query).toMatch(message);
      expect(parsed.range.days, query).toBe(30);
    }
    expect(parseQuery(params('product=evil%3Cscript%3E'), NOW).product).toBe('pinchpdf');
  });

  it('allows exactly the maximum range and one day', () => {
    expect(parseQuery(params('from=2025-11-21&to=2026-11-21'), NOW).error).toBeNull(); // 366 days
    expect(parseQuery(params('from=2026-11-21&to=2026-11-21'), NOW).range.days).toBe(1);
  });
});

describe('insights numbers', () => {
  it('counts trials, lifecycle, uses and versions for a range and product', async () => {
    await addTrial('2026-11-20', { used: 5, limit: 5 }); // exhausted
    await addTrial('2026-11-20', { used: 2 });
    await addTrial('2026-11-18', { used: 0, app: '1.4.1' });
    await addTrial('2026-11-18', { used: 1, status: 'revoked' });
    await addTrial('2026-11-19', { product: 'nodupe', used: 3, limit: 3, app: '2.1.0' });
    await addTrial('2026-10-01', { used: 4 }); // before the range

    const range = buildRange('2026-11-15', '2026-11-21');
    const pinch = await loadInsights(env.TRIAL_DB, range, 'pinchpdf', NOW);
    expect(pinch.cohort).toMatchObject({ n: 4, usedAtLeastOnce: 3, exhausted: 1, revokedOrReset: 1, previousN: 0 });
    expect(pinch.allTimeAtEnd).toBe(5);
    expect(pinch.buckets).toHaveLength(7);
    expect(pinch.registrations).toHaveLength(1);
    expect(pinch.registrations[0].values).toEqual([0, 0, 0, 2, 0, 2, 0]); // 11-18 x2, 11-20 x2
    expect(pinch.usesHistogram).toEqual([{ used: 0, count: 1 }, { used: 1, count: 1 }, { used: 2, count: 1 }, { used: 5, count: 1 }]);
    expect(pinch.appVersions[0]).toEqual({ label: '1.4.2', count: 3 });
    expect(pinch.current.active).toBe(3); // used 2, used 0 and the October trial; one is exhausted, one revoked
    expect(pinch.current.revoked).toBe(1);

    const nodupe = await loadInsights(env.TRIAL_DB, range, 'nodupe', NOW);
    expect(nodupe.cohort.n).toBe(1);
    expect(nodupe.cohort.exhausted).toBe(1);

    const all = await loadInsights(env.TRIAL_DB, range, 'all', NOW);
    expect(all.cohort.n).toBe(5);
    expect(all.registrations.map((r) => r.product)).toEqual(['pinchpdf', 'nodupe']);
    expect(all.registrations[1].values).toEqual([0, 0, 0, 0, 1, 0, 0]);
  });

  it('compares with the previous period of the same length', async () => {
    await addTrial('2026-11-20');
    await addTrial('2026-11-14');
    await addTrial('2026-11-13');
    const data = await loadInsights(env.TRIAL_DB, buildRange('2026-11-15', '2026-11-21'), 'pinchpdf', NOW);
    expect(data.cohort.n).toBe(1);
    expect(data.cohort.previousN).toBe(2);
  });

  it('shows weekly totals for long ranges and loses no trial', async () => {
    for (let i = 0; i < 20; i += 1) await addTrial(new Date(Date.UTC(2026, 0, 1 + i * 9)).toISOString().slice(0, 10));
    const range = buildRange('2026-01-01', '2026-07-19'); // 200 days
    const data = await loadInsights(env.TRIAL_DB, range, 'pinchpdf', NOW);
    expect(data.weekly).toBe(true);
    expect(data.buckets).toHaveLength(Math.ceil(200 / 7));
    expect(data.registrations[0].values.reduce((a, b) => a + b, 0)).toBe(data.cohort.n);
  });

  it('returns a clean empty state', async () => {
    const data = await loadInsights(env.TRIAL_DB, buildRange('2026-11-15', '2026-11-21'), 'pinchpdf', NOW);
    expect(data.cohort.n).toBe(0);
    const html = await (await handleAdminInsights(get('/admin/insights', good), full(), NOW)).text();
    expect(html).toContain('No data in this range');
    expect(html).toContain('—'); // error rate with no requests
  });

  it('still draws every chart and panel when there is no data at all', async () => {
    const html = await (await handleAdminInsights(get('/admin/insights', good), full(), NOW)).text();
    expect((html.match(/<svg/g) ?? []).length).toBe(3); // new trials, requests, uses per trial
    for (const text of ['challenge', 'register', 'usage', 'Registered', 'Used at least once', 'Exhausted all uses', 'Revoked or reset', 'already_used', 'No data yet']) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('Not available yet');
  });

  it('opens, as PinchPDF only, when migration 0002 has not added trials.product', async () => {
    await addTrial('2026-11-20');
    await env.TRIAL_DB.prepare('ALTER TABLE trials DROP COLUMN product').run();
    try {
      // NoDupe has its own database, which has the column, so only the views that read PinchPDF's are affected
      for (const product of ['all', 'pinchpdf']) {
        const response = await handleAdminInsights(get(`/admin/insights?product=${product}`, good), full(), NOW);
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('Migration 0002 is not applied');
        expect(html).toContain('<svg');
      }
      const data = await loadInsights(env.TRIAL_DB, buildRange('2026-11-15', '2026-11-21'), 'nodupe', NOW);
      expect(data.cohort.n).toBe(0);
      expect((await loadInsights(env.TRIAL_DB, buildRange('2026-11-15', '2026-11-21'), 'pinchpdf', NOW)).cohort.n).toBe(1);
    } finally {
      await env.TRIAL_DB.prepare("ALTER TABLE trials ADD COLUMN product TEXT NOT NULL DEFAULT 'pinchpdf'").run();
    }
  });

  it('never puts names, emails or ids in the page', async () => {
    await addTrial('2026-11-20');
    const html = await (await handleAdminInsights(get('/admin/insights?from=2026-11-01&to=2026-11-21', good), full(), NOW)).text();
    for (const secret of ['SECRETNAME', 'SECRETEMAIL', 'REF', 'pk1', 'id1<']) expect(html).not.toContain(secret);
  });

  it('escapes anything that comes from the data', async () => {
    await addTrial('2026-11-20', { app: '<img src=x onerror=alert(1)>', os: '"><script>x</script>' });
    const html = await (await handleAdminInsights(get('/admin/insights', good), full(), NOW)).text();
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;img src=x');
  });

  it('keeps the product and range in the links and form', async () => {
    const html = await (await handleAdminInsights(get('/admin/insights?product=all&from=2026-11-01&to=2026-11-10', good), full(), NOW)).text();
    expect(html).toContain('name="product" value="all"');
    expect(html).toContain('value="2026-11-01"');
    expect(html).toContain('href="/admin/insights?product=nodupe&from=2026-11-01&to=2026-11-10"');
    expect(html).toContain('href="/admin/insights?product=all&from=2026-11-15&to=2026-11-21"'); // 7 day preset keeps the product
  });

  it('reports a bad range on the page and shows the default instead', async () => {
    const response = await handleAdminInsights(get('/admin/insights?from=2026-11-10&to=2026-11-01', good), full(), NOW);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('on or before the end date');
    expect(html).toContain('2026-10-23');
  });

  it('answers 503 when the database is missing', async () => {
    expect((await handleAdminInsights(get('/admin/insights', good), creds, NOW)).status).toBe(503);
  });

  describe('two products, two databases', () => {
    async function addNodupeTrial(day: string, used = { basic: 0, similar: 0, deep: 0 }) {
      seq += 1;
      const created = Date.parse(`${day}T10:00:00Z`) / 1000;
      await env.NODUPE_DB.prepare(
        `INSERT INTO trials (id, pubkey, support_ref, name_enc, email_enc, used, limit_total, used_basic, used_similar, used_deep, status, terms_version, privacy_version,
           accepted_at, received_at, created_at, last_server_contact_at, app_version, os_build, product)
         VALUES (?1, ?2, ?3, 'v1.SECRETNAME.x', 'v1.SECRETEMAIL.x', ?4, 9, ?5, ?6, ?7, 'active', 'v', 'v', ?8, ?8, ?8, ?8, '2.1.0', 'Win 11', 'nodupe')`,
      )
        .bind(`nd${seq}`, `ndpk${seq}`, `NDREF${seq}`, used.basic + used.similar + used.deep, used.basic, used.similar, used.deep, created)
        .run();
    }

    it('shows a product from its own database, and All products from both', async () => {
      await addTrial('2026-11-20', { used: 2 });
      await addNodupeTrial('2026-11-20', { basic: 5, similar: 3, deep: 1 });
      await addNodupeTrial('2026-11-19');
      const range = buildRange('2026-11-15', '2026-11-21');
      const text = async (product: string) => (await handleAdminInsights(get(`/admin/insights?product=${product}&from=${range.from}&to=${range.to}`, good), full(), NOW)).text();
      const { loadInsightsFor } = await import('../lib/admin/sources');
      const pinch = await loadInsightsFor(full(), range, 'pinchpdf', NOW);
      const nodupe = await loadInsightsFor(full(), range, 'nodupe', NOW);
      const all = await loadInsightsFor(full(), range, 'all', NOW);
      expect(pinch.cohort.n).toBe(1);
      expect(nodupe.cohort).toMatchObject({ n: 2, exhausted: 1, usedAtLeastOnce: 1 });
      expect(all.cohort.n).toBe(3);
      expect(all.product).toBe('all');
      expect(all.registrations.map((r) => r.product)).toEqual(['pinchpdf', 'nodupe']);
      expect(all.current.total).toBe(3);
      for (const product of ['pinchpdf', 'nodupe', 'all']) expect(await text(product)).toContain('<svg');
      expect(await text('nodupe')).toContain('NoDupe');
    });

    it('says which database is missing instead of silently showing less', async () => {
      const onlyPinch: AdminRuntimeEnv = { ...creds, TRIAL_DB: env.TRIAL_DB };
      const html = await (await handleAdminInsights(get('/admin/insights?product=all', good), onlyPinch, NOW)).text();
      expect(html).toContain('The NoDupe database is not available here');
      expect((await handleAdminInsights(get('/admin/insights?product=nodupe', good), onlyPinch, NOW)).status).toBe(503);
    });
  });
});

describe('request counters', () => {
  const rows = async () =>
    (await env.TRIAL_DB.prepare('SELECT day, product, endpoint, outcome, count FROM metrics_daily ORDER BY endpoint, outcome').all()).results as {
      day: string; product: string; endpoint: string; outcome: string; count: number;
    }[];

  it('writes the first count at once, then batches within the flush interval', async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    await recordMetric(env, 'challenge', 'ok', NOW);
    expect(await rows()).toEqual([{ day: '2026-11-21', product: 'pinchpdf', endpoint: 'challenge', outcome: 'ok', count: 1 }]);

    for (let i = 0; i < 4; i += 1) await recordMetric(env, 'challenge', 'ok', NOW);
    expect((await rows())[0].count).toBe(1); // still waiting in memory

    clock += FLUSH_INTERVAL_MS;
    await recordMetric(env, 'challenge', 'ok', NOW);
    expect((await rows())[0].count).toBe(6); // 1 + 4 waiting + this one
  });

  it('keeps separate rows per endpoint, outcome and day', async () => {
    let clock = 5_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    await recordMetric(env, 'register', 'registered', NOW);
    clock += FLUSH_INTERVAL_MS;
    await recordMetric(env, 'register', 'already_used', NOW);
    clock += FLUSH_INTERVAL_MS;
    await recordMetric(env, 'register', 'already_used', NOW + 86_400_000);
    const all = await rows();
    expect(all.map((r) => `${r.day} ${r.outcome} ${r.count}`)).toEqual(['2026-11-21 already_used 1', '2026-11-22 already_used 1', '2026-11-21 registered 1']);
  });

  it('never throws, even when the database fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = { TRIAL_DB: { prepare: () => { throw new Error('boom'); }, batch: async () => { throw new Error('boom'); } } } as never;
    await expect(recordMetric(broken, 'usage', 'ok', NOW)).resolves.toBeUndefined();
    await expect(recordMetric(broken, 'usage', 'ok', NOW)).resolves.toBeUndefined();
  });

  it('counts a real handler call by its outcome, and does not change the response', async () => {
    const request = new Request('https://technowizsolutions.com/api/pinchpdf/trial/v1/challenge', { method: 'POST', body: '{}' });
    const response = await handleChallenge(request, env as never, () => NOW);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_request' });
    expect(response.headers.get('x-trial-outcome')).toBeNull();
    expect(await rows()).toEqual([{ day: '2026-11-21', product: 'pinchpdf', endpoint: 'challenge', outcome: 'bad_request', count: 1 }]);
  });

  it('maps untagged statuses to outcome names', () => {
    expect([200, 400, 421, 429, 503, 500].map(outcomeFromStatus)).toEqual(['ok', 'bad_request', 'kid_unsupported', 'rate_limited', 'unavailable', 'http_500']);
  });

  it('feeds the insights page: totals, error rate and register outcomes', async () => {
    const day = '2026-11-20';
    const insert = (endpoint: string, outcome: string, count: number) =>
      env.TRIAL_DB.prepare('INSERT INTO metrics_daily (day, product, endpoint, outcome, count) VALUES (?, ?, ?, ?, ?)').bind(day, 'pinchpdf', endpoint, outcome, count).run();
    await insert('challenge', 'ok', 40);
    await insert('register', 'registered', 30);
    await insert('register', 'already_used', 6);
    await insert('register', 'rate_limited', 4);
    await insert('usage', 'ok', 20);
    const data = await loadInsights(env.TRIAL_DB, buildRange('2026-11-15', '2026-11-21'), 'pinchpdf', NOW);
    expect(data.requests).toMatchObject({ available: true, total: 100, errors: 4, firstDay: day });
    if (!data.requests.available) throw new Error('unreachable');
    expect(data.requests.byEndpoint.map((e) => e.values.reduce((a, b) => a + b, 0))).toEqual([40, 40, 20, 0]); // challenge, register, usage, telemetry
    expect(data.requests.registerOutcomes[0]).toEqual({ label: 'registered', count: 30 });
    const html = await (await handleAdminInsights(get('/admin/insights', good), full(), NOW)).text();
    expect(html).toContain('4.0%');
    expect(html).toContain('already_used');
  });

  it('says request counts are unavailable, instead of failing, when the table is missing', async () => {
    await env.TRIAL_DB.prepare('ALTER TABLE metrics_daily RENAME TO metrics_daily_off').run();
    try {
      const response = await handleAdminInsights(get('/admin/insights', good), full(), NOW);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('apply migration 0002');
    } finally {
      await env.TRIAL_DB.prepare('ALTER TABLE metrics_daily_off RENAME TO metrics_daily').run();
    }
  });

  it('notes when counting started inside the range', async () => {
    await env.TRIAL_DB.prepare("INSERT INTO metrics_daily (day, product, endpoint, outcome, count) VALUES ('2026-11-19', 'pinchpdf', 'usage', 'ok', 1)").run();
    const html = await (await handleAdminInsights(get('/admin/insights', good), full(), NOW)).text();
    expect(html).toContain('Request counting started on 2026-11-19');
  });
});

describe('charts', () => {
  it('rounds the axis maximum up to a friendly number', () => {
    expect([0, 1, 3, 7, 13, 45, 99, 101, 4200].map(niceMax)).toEqual([4, 1, 4, 10, 20, 50, 100, 200, 5000]);
  });

  it('draws one column per label and a hover title for each', () => {
    const svg = columnChart({ labels: ['a', 'b', 'c'], series: [{ name: 'trials', cls: 's0', values: [1, 0, 5] }], ariaLabel: 'Trials' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<g><title>/g) ?? []).length).toBe(3);
    expect((svg.match(/class="s0"/g) ?? []).length).toBe(2); // the zero column draws no bar
    expect(svg).toContain('role="img"');
  });

  it('stacks series and keeps each column within the plot', () => {
    const svg = columnChart({
      labels: ['a'],
      series: [{ name: 'x', cls: 's0', values: [3] }, { name: 'y', cls: 's1', values: [3] }],
      ariaLabel: 'Stack',
    });
    expect(svg).toContain('class="s0"');
    expect(svg).toContain('class="s1"');
    const heights = [...svg.matchAll(/height="([0-9.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...heights)).toBeLessThanOrEqual(170);
  });

  it('shows an empty state and escapes labels', () => {
    const empty = columnChart({ labels: ['<b>'], series: [{ name: 'x', cls: 's0', values: [0] }], ariaLabel: 'Empty "chart"' });
    expect(empty).toContain('No data in this range');
    expect(empty).not.toContain('<b>');
    expect(empty).toContain('&lt;b&gt;');
    expect(empty).toContain('Empty &quot;chart&quot;');
    expect(esc(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });

  it('builds share bars with counts and percentages, shortening long labels', () => {
    const html = shareBars([{ label: 'x'.repeat(60), count: 3 }, { label: 'b', count: 1 }], 4);
    expect(html).toContain('75%');
    expect(html).toContain('3 · 75%');
    expect(html).toContain('…');
    expect(shareBars([], 0)).toContain('No data');
  });
});
