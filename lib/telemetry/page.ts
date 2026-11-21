// GET /insights: the private Insights dashboard (app telemetry). Server-rendered HTML in tabs
// (?tab=overview|buying|licenses|devices) so no single page gets long. Behind HTTP Basic authentication
// (INSIGHTS_USER / INSIGHTS_PASSWORD Worker secrets); fails closed with a 404 when they are missing or weak.

import type { RateLimiter } from '../trial/config';
import { MIN_DOCS_PASSWORD_LENGTH, SECURITY_HEADERS, clientIp, fallbackAllow, parseBasic, sameSecret } from '../trial/docs';
import { plain, rateLimited } from '../trial/responses';
import { dayLabel, esc, lineChart, stackedBars, stat } from './charts';
import { BUYING_WEEKS, DEVICE_WEEKS, INSIGHTS_API_BASE, INSIGHTS_TABS, buyingData, devicesData, licensesData, overviewData, tabData, type InsightsTab } from './data';
import { loadEvents, type EventRow } from './db';

export type InsightsEnv = {
  TRIAL_DB?: D1Database;
  INSIGHTS_USER?: string;
  INSIGHTS_PASSWORD?: string;
  INSIGHTS_ABANDON_DAYS?: string;
  INSIGHTS_LIMITER?: RateLimiter;
};

type Clock = () => number; // milliseconds
const systemClock: Clock = () => Date.now();

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'buying', label: 'Buying' },
  { id: 'licenses', label: 'Licenses' },
  { id: 'devices', label: 'Devices' },
] as const;
type TabId = InsightsTab;

export const WINDOW_CHOICES = [1, 3, 7, 14, 30] as const;

function challenge(): Response {
  return new Response('Authentication required', {
    status: 401,
    headers: { ...SECURITY_HEADERS, 'WWW-Authenticate': 'Basic realm="Technowiz Insights", charset="UTF-8"' },
  });
}

let disabledLogged = false;
/** Test hook. */
export function resetInsightsLog() {
  disabledLogged = false;
}

async function guard(request: Request, env: InsightsEnv): Promise<Response | null> {
  if (!env.INSIGHTS_USER || !env.INSIGHTS_PASSWORD || env.INSIGHTS_PASSWORD.length < MIN_DOCS_PASSWORD_LENGTH) {
    if (!disabledLogged) {
      disabledLogged = true;
      console.warn(
        JSON.stringify({
          svc: 'insights',
          result: 'disabled',
          INSIGHTS_USER: Boolean(env.INSIGHTS_USER),
          INSIGHTS_PASSWORD: Boolean(env.INSIGHTS_PASSWORD),
          password_long_enough: (env.INSIGHTS_PASSWORD?.length ?? 0) >= MIN_DOCS_PASSWORD_LENGTH,
        }),
      );
    }
    return plain(404, { error: 'not_found' }, SECURITY_HEADERS);
  }
  // Every request counts, so password guessing is throttled per IP before credentials are checked.
  if (env.INSIGHTS_LIMITER) {
    try {
      if (!(await env.INSIGHTS_LIMITER.limit({ key: clientIp(request) })).success) return rateLimited();
    } catch {
      // a limiter failure must not lock the owner out
    }
  } else if (!fallbackAllow(`insights|${clientIp(request)}`)) {
    return rateLimited();
  }
  const given = parseBasic(request.headers.get('authorization'));
  if (!given) return challenge();
  const [userOk, passwordOk] = await Promise.all([sameSecret(given.user, env.INSIGHTS_USER), sameSecret(given.password, env.INSIGHTS_PASSWORD)]);
  return userOk && passwordOk ? null : challenge();
}

function parseWindow(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(90, Math.max(1, parsed)) : fallback;
}

function defaultWindow(env: InsightsEnv): number {
  return parseWindow(env.INSIGHTS_ABANDON_DAYS ?? null, 7);
}

const pct = (rate: number | null) => (rate === null ? 'n/a' : `${Math.round(rate * 100)}%`);

const STYLE = `
:root{color-scheme:light;--surface:#fcfcfb;--panel:#ffffff;--text:#0b0b0b;--text2:#52514e;--muted:#6b6a66;--line:#e3e2dd;--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--surface:#1a1a19;--panel:#222221;--text:#f0efec;--text2:#c3c2b7;--muted:#a3a299;--line:#3a3a37;--series-1:#3987e5;--series-2:#d95926;--series-3:#199e70}}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:24px 16px 56px}
h1{margin:0 0 4px;font-size:24px}
.sub{margin:0 0 20px;color:var(--text2)}
.tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:20px}
.tabs a{padding:10px 14px;color:var(--text2);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs a:hover{color:var(--text)}
.tabs a[aria-current=page]{color:var(--text);border-bottom-color:var(--series-1);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.statvalue{font-size:28px;font-weight:600;line-height:1.1}
.statlabel{color:var(--text2);margin-top:4px}
.statnote{color:var(--muted);font-size:13px;margin-top:2px}
.chart{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
.chart h3{margin:0;font-size:16px}
.chart figcaption p{margin:2px 0 10px;color:var(--text2);font-size:13px}
.chart svg{width:100%;height:auto;display:block}
.legend{display:flex;gap:16px;flex-wrap:wrap;list-style:none;margin:0 0 6px;padding:0;color:var(--text2);font-size:13px}
.legend li{display:flex;align-items:center;gap:6px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}
.f1{fill:var(--series-1);background:var(--series-1)}.f2{fill:var(--series-2);background:var(--series-2)}.f3{fill:var(--series-3);background:var(--series-3)}
.seg{stroke:var(--panel);stroke-width:2}
.line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.l1{stroke:var(--series-1)}
.dot{stroke:var(--panel);stroke-width:2}
.hit{fill:transparent}
.grid{stroke:var(--line);stroke-width:1}
.base{stroke:var(--muted);stroke-width:1}
.tick{fill:var(--muted);font-size:11px}
.endlabel{fill:var(--text);font-size:12px;font-weight:600}
.empty{fill:var(--muted);font-size:13px}
.tableview{margin-top:8px;color:var(--text2);font-size:13px}
.tableview summary{cursor:pointer}
.tableview table{border-collapse:collapse;margin-top:8px;width:100%}
.tableview th,.tableview td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:right}
.tableview th[scope=row],.tableview th:first-child{text-align:left}
.pills{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0 0 16px;color:var(--text2);font-size:13px}
.pills a{padding:4px 10px;border:1px solid var(--line);border-radius:999px;color:var(--text2);text-decoration:none}
.pills a[aria-current=true]{background:var(--series-1);border-color:var(--series-1);color:#fff}
.note{color:var(--text2);font-size:13px;margin:0 0 20px}
.note strong{color:var(--text)}
`;

type View = { tab: TabId; window: number };

function href(view: View, change: Partial<View>): string {
  const next = { ...view, ...change };
  return `?tab=${next.tab}&amp;window=${next.window}`;
}

function windowPills(view: View): string {
  const links = WINDOW_CHOICES.map(
    (d) => `<a href="${href(view, { window: d })}" ${d === view.window ? 'aria-current="true"' : ''}>${d} ${d === 1 ? 'day' : 'days'}</a>`,
  ).join('');
  const custom = (WINDOW_CHOICES as readonly number[]).includes(view.window) ? '' : `<a href="${href(view, {})}" aria-current="true">${view.window} days</a>`;
  return `<div class="pills"><span>Counts as abandoned after no activation for</span>${links}${custom}</div>`;
}

function renderTab(view: View, events: EventRow[], now: number): string {
  const labels = (weeks: number[]) => weeks.map(dayLabel);

  if (view.tab === 'buying') {
    const d = buyingData(events, view.window, now);
    return (
      windowPills(view) +
      `<div class="stats">${stat('Buy attempts', d.attempts, `last ${BUYING_WEEKS} weeks`)}${stat('Activated in time', d.converted)}${stat('Abandoned', d.abandoned, `no activation within ${view.window} days`)}${stat('Still open', d.pending)}${stat('Conversion', pct(d.conversion_rate), 'of attempts past their window')}${stat('Came back late', d.late, 'activated after the window')}</div>` +
      stackedBars({
        title: 'Buy clicks by outcome',
        subtitle: `By week of the first click. Abandoned means no license was activated within ${view.window} days of the click.`,
        labels: labels(d.week_starts),
        series: [
          { name: 'Activated in time', slot: 1 },
          { name: 'Abandoned', slot: 2 },
          { name: 'Still open', slot: 3 },
        ],
        data: [d.weekly.converted, d.weekly.abandoned, d.weekly.pending],
        firstColumn: 'Week of',
      }) +
      `<p class="note">Several clicks by the same install inside one window count as one attempt. <strong>Abandoned is an upper bound:</strong> someone who bought and activated on a different install, or has not opened the app online yet, shows here until their activation arrives.</p>`
    );
  }

  if (view.tab === 'licenses') {
    const d = licensesData(events, now);
    const c = d.current;
    const weekLabels = labels(d.week_starts);
    return (
      `<div class="stats">${stat('Active licenses', c.active, 'at least one active device')}${stat('Individual', c.individual)}${stat('Business', c.business)}${stat('Devices in use', c.active_devices, c.active ? `${(c.active_devices / c.active).toFixed(1)} per license` : '')}${stat('On more than one device', c.on_multiple_devices)}</div>` +
      lineChart({
        title: 'Active licenses',
        subtitle: 'Licenses with at least one active device, at the end of each week.',
        labels: weekLabels,
        name: 'Active licenses',
        values: d.weekly.active,
        firstColumn: 'Week of',
      }) +
      stackedBars({
        title: 'Active licenses by plan',
        subtitle: 'Individual and Business, at the end of each week.',
        labels: weekLabels,
        series: [
          { name: 'Individual', slot: 1 },
          { name: 'Business', slot: 2 },
        ],
        data: [d.weekly.individual, d.weekly.business],
        firstColumn: 'Week of',
      })
    );
  }

  if (view.tab === 'devices') {
    const d = devicesData(events, now);
    const weekLabels = labels(d.week_starts);
    return (
      `<div class="stats">${stat('Deactivations', d.deactivations, `last ${DEVICE_WEEKS} weeks`)}${stat('Moved to another device', d.moved)}${stat('Same device again', d.same_device)}${stat('Not in use since', d.unused)}${stat('Key changes', d.key_changes, `last ${DEVICE_WEEKS} weeks`)}</div>` +
      stackedBars({
        title: 'Deactivations by what happened next',
        subtitle: 'A deactivation is usually a license moving to another computer, not a lost customer.',
        labels: weekLabels,
        series: [
          { name: 'Moved to another device', slot: 1 },
          { name: 'Activated again on the same device', slot: 2 },
          { name: 'Not in use since', slot: 3 },
        ],
        data: [d.weekly.moved, d.weekly.same_device, d.weekly.unused],
        firstColumn: 'Week of',
      }) +
      stackedBars({
        title: 'License key changes',
        subtitle: 'An install switched from one license key to another.',
        labels: weekLabels,
        series: [{ name: 'Key changes', slot: 1 }],
        data: [d.weekly.key_changes],
        firstColumn: 'Week of',
      })
    );
  }

  const d = overviewData(events, view.window, now);
  const m = d.last_30_days;
  const first = d.first_event_at === null ? 'none yet' : dayLabel(d.first_event_at);
  return (
    windowPills(view) +
    `<div class="stats">${stat('Active licenses', d.active_licenses)}${stat('Individual', d.individual)}${stat('Business', d.business)}${stat('Buy attempts', m.buy_attempts, 'last 30 days')}${stat('Abandoned', m.abandoned, `no activation in ${view.window} days`)}${stat('Conversion', pct(m.conversion_rate), 'last 30 days')}${stat('Deactivations', m.deactivations, 'last 30 days')}${stat('Moved device', m.moved_device, 'last 30 days')}</div>` +
    `<p class="note">${d.events_recorded} events recorded, the first on ${esc(first)}. Open <strong>Buying</strong> for the buy-to-activation funnel, <strong>Licenses</strong> for active keys and plans, and <strong>Devices</strong> for deactivations and key changes. All times are UTC; weeks start on Monday.</p>`
  );
}

function pageHtml(view: View, body: string, nonce: string): string {
  const tabs = TABS.map((t) => `<a href="${href(view, { tab: t.id })}" ${t.id === view.tab ? 'aria-current="page"' : ''}>${esc(t.label)}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Insights</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div class="wrap">
<h1>Insights</h1>
<p class="sub">PinchPDF app telemetry. No names, emails or license keys are stored.</p>
<nav class="tabs" aria-label="Insights sections">${tabs}</nav>
${body}
</div>
</body>
</html>
`;
}

export async function handleInsights(request: Request, env: InsightsEnv, clock: Clock = systemClock): Promise<Response> {
  const blocked = await guard(request, env);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const requested = url.searchParams.get('tab');
  const tab = (TABS.find((t) => t.id === requested)?.id ?? 'overview') as TabId;
  const view: View = { tab, window: parseWindow(url.searchParams.get('window'), defaultWindow(env)) };

  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  };

  if (!env.TRIAL_DB) return new Response(pageHtml(view, '<p class="note">The database is not configured here.</p>', nonce), { status: 503, headers });
  try {
    const events = await loadEvents(env.TRIAL_DB);
    const now = Math.floor(clock() / 1000);
    return new Response(pageHtml(view, renderTab(view, events, now), nonce), { status: 200, headers });
  } catch (error) {
    console.error(JSON.stringify({ svc: 'insights', result: 'db_error', message: String((error as Error)?.message).slice(0, 120) }));
    return new Response(pageHtml(view, '<p class="note">The data could not be loaded. Try again shortly.</p>', nonce), { status: 503, headers });
  }
}


// ------------------------------------------------------------------- JSON API

export { INSIGHTS_API_BASE };

/**
 * GET /api/pinchpdf/insights/v1/{overview|buying|licenses|devices}?window=<days>
 * The same numbers as the dashboard tab of that name, as JSON. Same Basic authentication.
 * `window` is the abandoned-buy window in days (1-90); it only affects overview and buying.
 */
export async function handleInsightsApi(request: Request, env: InsightsEnv, clock: Clock = systemClock): Promise<Response> {
  const blocked = await guard(request, env);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const tab = url.pathname.replace(/\/+$/, '').split('/').pop() as InsightsTab;
  if (!INSIGHTS_TABS.includes(tab)) return plain(404, { error: 'not_found' }, SECURITY_HEADERS);
  if (!env.TRIAL_DB) return plain(503, { error: 'unavailable' }, { ...SECURITY_HEADERS, 'Retry-After': '30' });

  const windowDays = parseWindow(url.searchParams.get('window'), defaultWindow(env));
  try {
    const events = await loadEvents(env.TRIAL_DB);
    const now = Math.floor(clock() / 1000);
    return plain(200, { tab, generated_at: now, ...tabData(tab, events, windowDays, now) }, SECURITY_HEADERS);
  } catch (error) {
    console.error(JSON.stringify({ svc: 'insights', endpoint: 'api', result: 'db_error', message: String((error as Error)?.message).slice(0, 120) }));
    return plain(503, { error: 'unavailable' }, { ...SECURITY_HEADERS, 'Retry-After': '30' });
  }
}
