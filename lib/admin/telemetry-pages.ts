// HTML for the app-telemetry tabs of /admin/insights (Buying, Licenses, Devices). Server-rendered, no
// scripts. Numbers come from lib/telemetry/data.ts, the same functions the JSON API uses.

import { buyingData, devicesData, licensesData, scansData, MAX_WINDOW_DAYS, type TelemetryTab } from '../telemetry/data';
import type { EventRow } from '../telemetry/db';
import type { ScanReportRow } from '../telemetry/nodupe';
import { columnChart, esc, fmtNum } from './charts';
import { kpi, layout } from './pages';
import { dayStartMs, dayString, type ProductChoice, type Range } from './range';
import { tabNav } from './tabs';

export type TelemetryView = {
  tab: TelemetryTab;
  product: ProductChoice;
  range: Range;
  windowDays: number;
  error: string | null;
  /** false while the database or migration behind the tab is missing: the tab still opens, with a notice. */
  available: boolean;
};

const WINDOW_CHOICES = [1, 3, 7, 14, 30];
const pct = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);
const labels = (starts: number[]) => starts.map((s) => dayString(s * 1000).slice(5));
const legend = (items: { name: string; i: number }[]) => `<div class="lg">${items.map((x) => `<span><i class="d${x.i}"></i>${esc(x.name)}</span>`).join('')}</div>`;

function controls(view: TelemetryView, today: string): string {
  const { tab, product, range, windowDays } = view;
  const href = (from: string, to: string, window = windowDays) => `/admin/insights?tab=${tab}&product=${product}&from=${from}&to=${to}&window=${window}`;
  const presets = [7, 30, 90, 365]
    .map((days) => {
      const from = dayString(dayStartMs(today) - (days - 1) * 86_400_000);
      return `<a href="${href(from, today)}"${range.to === today && range.days === days ? ' aria-current="true"' : ''}>${days === 365 ? '1 year' : `${days} days`}</a>`;
    })
    .join('');
  const windows =
    tab === 'buying'
      ? `<div class="bar"><div><label>Counts as abandoned after no activation for</label><div class="seg">${[...new Set([...WINDOW_CHOICES, windowDays])]
          .sort((a, b) => a - b)
          .map((d) => `<a href="${href(range.from, range.to, d)}"${d === windowDays ? ' aria-current="true"' : ''}>${d} ${d === 1 ? 'day' : 'days'}</a>`)
          .join('')}</div></div></div>`
      : '';
  return `<form class="bar" method="get" action="/admin/insights">
<input type="hidden" name="tab" value="${tab}"><input type="hidden" name="product" value="${esc(product)}"><input type="hidden" name="window" value="${windowDays}">
<div><label for="from">From</label><input type="date" id="from" name="from" value="${esc(range.from)}" max="${esc(today)}" required></div>
<div><label for="to">To</label><input type="date" id="to" name="to" value="${esc(range.to)}" max="${esc(today)}" required></div>
<button type="submit">Apply</button>
<div class="seg" style="margin-left:auto">${presets}</div>
</form>
${windows}${view.error ? `<p class="err" role="alert">${esc(view.error)}</p>` : ''}`;
}

export function renderTelemetryTab(view: TelemetryView, events: EventRow[], nowMs: number, scanReports: ScanReportRow[] = []): string {
  const now = Math.floor(nowMs / 1000);
  const { range } = view;
  const unit = range.days > 120 ? 'week' : 'day';

  const isScans = view.tab === 'scans';
  const notices: string[] = [
    `${esc(range.from)} to ${esc(range.to)} (${range.days} day${range.days === 1 ? '' : 's'}${unit === 'week' ? ', shown as weekly totals' : ''}). UTC days. ${isScans ? 'NoDupe scan counts only.' : 'PinchPDF app telemetry only.'}`,
  ];
  if (!view.available) {
    notices.push(
      isScans
        ? 'The NoDupe database is not available: bind NODUPE_DB and apply its migrations. Run: npx wrangler d1 migrations apply nodupe --remote'
        : 'Telemetry tables are not available yet: apply migration 0003 to the database. Run: npx wrangler d1 migrations apply pinchpdf --remote',
    );
  } else if (isScans ? scanReports.length === 0 : events.length === 0) {
    notices.push(isScans ? 'No NoDupe scan reports have been received yet.' : 'No telemetry has been received yet. Events appear here once the app version that sends them is in use.');
  }
  if (view.product === 'nodupe' && !isScans) notices.push('NoDupe sends scan counts only, no buy or license events. See the Scans tab.');
  if (view.product === 'pinchpdf' && isScans) notices.push('The Scans tab is always NoDupe, whatever product is selected.');

  let body: string;
  if (view.tab === 'scans') {
    const d = scansData(scanReports, range);
    const a = d.free_allowance;
    body = `<div class="kpis">
${kpi('Installs reporting', fmtNum(d.installs), 'sent a scan report, ever')}
${kpi('Basic scans', fmtNum(d.total.basic), `free allowance ${a.basic}`)}
${kpi('Similar scans', fmtNum(d.total.similar), `free allowance ${a.similar}`)}
${kpi('Deep scans', fmtNum(d.total.deep), `free allowance ${a.deep}`)}
${kpi('At the free limit', fmtNum(d.at_allowance.all_modes), 'installs, in all three modes')}
</div>
<div class="kpis">
${kpi('Basic at limit', fmtNum(d.at_allowance.basic), `installs with ${a.basic} or more`)}
${kpi('Similar at limit', fmtNum(d.at_allowance.similar), `installs with ${a.similar} or more`)}
${kpi('Deep at limit', fmtNum(d.at_allowance.deep), `installs with ${a.deep} or more`)}
</div>
<section class="card"><h2>Scans by mode, per ${unit}</h2><p class="sub">New scans reported in each ${unit} of the range: ${fmtNum(d.in_range.basic)} basic, ${fmtNum(d.in_range.similar)} similar, ${fmtNum(d.in_range.deep)} deep.</p>
${legend([{ name: 'Basic', i: 0 }, { name: 'Similar', i: 1 }, { name: 'Deep', i: 2 }])}
${columnChart({
  labels: labels(d.bucket_starts),
  series: [
    { name: 'Basic', cls: 's0', values: d.series.basic },
    { name: 'Similar', cls: 's1', values: d.series.similar },
    { name: 'Deep', cls: 's2', values: d.series.deep },
  ],
  ariaLabel: `NoDupe scans per ${unit} by mode`,
  unit: 'scans',
})}</section>
<section class="card"><h2>Installs reporting, per ${unit}</h2><p class="sub">Installs that sent a scan report in that ${unit}</p>${columnChart({
      labels: labels(d.bucket_starts),
      series: [{ name: 'Installs', cls: 's0', values: d.series.installs_reporting }],
      ariaLabel: `NoDupe installs reporting per ${unit}`,
      unit: 'installs',
    })}</section>
<p class="muted">Each install reports running totals; the latest report per install is its current count, and growth between reports is counted in the ${unit} of the later report. Licensed installs are anonymous here, so the totals include them and "at the free limit" is an upper bound on free users who have run out. No file names, paths or results are sent.</p>`;
  } else if (view.tab === 'buying') {
    const d = buyingData(events, range, view.windowDays, now);
    body = `<div class="kpis">
${kpi('Buy attempts', fmtNum(d.attempts), 'in range')}
${kpi('Activated in time', fmtNum(d.converted), `within ${d.window_days} days`)}
${kpi('Abandoned', fmtNum(d.abandoned), `no activation in ${d.window_days} days`)}
${kpi('Still open', fmtNum(d.pending), 'window not over yet')}
${kpi('Conversion', pct(d.conversion_rate), 'of attempts past their window')}
${kpi('Came back late', fmtNum(d.late), 'activated after the window')}
</div>
<section class="card"><h2>Buy clicks by outcome, per ${unit}</h2><p class="sub">By ${unit} of the first click. Abandoned means no license was activated within ${d.window_days} days of the click.</p>
${legend([{ name: 'Activated in time', i: 0 }, { name: 'Abandoned', i: 1 }, { name: 'Still open', i: 2 }])}
${columnChart({
  labels: labels(d.bucket_starts),
  series: [
    { name: 'Activated in time', cls: 's0', values: d.series.converted },
    { name: 'Abandoned', cls: 's1', values: d.series.abandoned },
    { name: 'Still open', cls: 's2', values: d.series.pending },
  ],
  ariaLabel: `Buy clicks by outcome per ${unit}`,
  unit: 'buy attempts',
})}</section>
<p class="muted">Several clicks by the same install inside one window count as one attempt. Abandoned is an upper bound: someone who bought and activated on a different install, or has not opened the app online yet, shows here until their activation arrives.</p>`;
  } else if (view.tab === 'licenses') {
    const d = licensesData(events, range, now);
    const c = d.current;
    body = `<div class="kpis">
${kpi('Active licenses', fmtNum(c.active), 'with an active device, now')}
${kpi('Individual', fmtNum(c.individual), 'active, now')}
${kpi('Business', fmtNum(c.business), 'active, now')}
${kpi('Devices in use', fmtNum(c.active_devices), c.active ? `${(c.active_devices / c.active).toFixed(1)} per license` : 'no active license')}
${kpi('On several devices', fmtNum(c.on_multiple_devices), 'active licenses')}
</div>
<section class="card"><h2>Active licenses</h2><p class="sub">Licenses with at least one active device, at the end of each ${unit}</p>${columnChart({
      labels: labels(d.bucket_starts),
      series: [{ name: 'Active licenses', cls: 's0', values: d.series.active }],
      ariaLabel: `Active licenses at the end of each ${unit}`,
      unit: 'active licenses',
    })}</section>
<section class="card"><h2>Active licenses by plan</h2><p class="sub">Individual and Business, at the end of each ${unit}</p>
${legend([{ name: 'Individual', i: 0 }, { name: 'Business', i: 1 }])}
${columnChart({
  labels: labels(d.bucket_starts),
  series: [
    { name: 'Individual', cls: 's0', values: d.series.individual },
    { name: 'Business', cls: 's1', values: d.series.business },
  ],
  ariaLabel: `Active licenses by plan at the end of each ${unit}`,
  unit: 'active licenses',
})}</section>`;
  } else {
    const d = devicesData(events, range);
    body = `<div class="kpis">
${kpi('Deactivations', fmtNum(d.deactivations), 'in range')}
${kpi('Moved to another device', fmtNum(d.moved), 'activated elsewhere after')}
${kpi('Same device again', fmtNum(d.same_device), 're-activated on that device')}
${kpi('Not in use since', fmtNum(d.unused), 'no activation after')}
${kpi('Key changes', fmtNum(d.key_changes), 'in range')}
</div>
<section class="card"><h2>Deactivations by what happened next</h2><p class="sub">A deactivation is usually a license moving to another computer, not a lost customer.</p>
${legend([{ name: 'Moved to another device', i: 0 }, { name: 'Activated again on the same device', i: 1 }, { name: 'Not in use since', i: 2 }])}
${columnChart({
  labels: labels(d.bucket_starts),
  series: [
    { name: 'Moved to another device', cls: 's0', values: d.series.moved },
    { name: 'Same device again', cls: 's1', values: d.series.same_device },
    { name: 'Not in use since', cls: 's2', values: d.series.unused },
  ],
  ariaLabel: `Deactivations per ${unit} by what happened next`,
  unit: 'deactivations',
})}</section>
<section class="card"><h2>License key changes</h2><p class="sub">An install switched from one license key to another</p>${columnChart({
      labels: labels(d.bucket_starts),
      series: [{ name: 'Key changes', cls: 's0', values: d.series.key_changes }],
      ariaLabel: `License key changes per ${unit}`,
      unit: 'key changes',
    })}</section>`;
  }

  const html = `<h1>Insights</h1><p class="sub">Aggregate numbers only. No names, emails, license keys or device data.</p>
${tabNav(view.tab, view.product, range, view.windowDays)}
${controls(view, dayString(nowMs))}
${notices.map((n) => `<p class="notice">${n}</p>`).join('')}
${body}
<p class="muted">Generated ${esc(new Date(nowMs).toISOString().replace('T', ' ').slice(0, 19))} UTC. Window limit ${MAX_WINDOW_DAYS} days.</p>`;
  return layout(`${view.tab[0].toUpperCase()}${view.tab.slice(1)} · Insights · TWS admin`, 'insights', html);
}
