// HTML for the app-telemetry tabs of /admin/insights (Buying, Licenses, Devices). Server-rendered, no
// scripts. Numbers come from lib/telemetry/data.ts, the same functions the JSON API uses.

import { buyingData, devicesData, installsData, licensesData, scansData, MAX_WINDOW_DAYS, type TelemetryTab } from '../telemetry/data';
import type { InstallRow } from '../telemetry/compute';
import type { EventRow } from '../telemetry/db';
import type { ScanStats } from '../telemetry/scans';
import { NODUPE_LIMITS, SCAN_MODES } from '../trial/product';
import { columnChart, esc, fmtNum } from './charts';
import { kpi, layout } from './pages';
import { PRODUCTS, dayStartMs, dayString, type ProductChoice, type Range } from './range';
import { tabNav } from './tabs';

export type TelemetryView = {
  tab: TelemetryTab;
  product: ProductChoice;
  range: Range;
  windowDays: number;
  error: string | null;
  /** false while the database or migration behind the tab is missing: the tab still opens, with a notice. */
  available: boolean;
  /** Names of products whose database is not bound here, so the page can say its numbers are left out. */
  missing: string[];
};

/** What a tab draws from. Each tab reads only its own part. */
export type TelemetryData = { events: EventRow[]; installs: InstallRow[]; scans: ScanStats | null };

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

export function renderTelemetryTab(view: TelemetryView, data: TelemetryData, nowMs: number): string {
  const { events, installs, scans } = data;
  const now = Math.floor(nowMs / 1000);
  const { range } = view;
  const unit = range.days > 120 ? 'week' : 'day';

  const isScans = view.tab === 'scans';
  const names = view.product === 'all' ? 'All products' : (PRODUCTS.find((p) => p.id === view.product)?.name ?? view.product);
  const notices: string[] = [
    `${esc(names)} · ${esc(range.from)} to ${esc(range.to)} (${range.days} day${range.days === 1 ? '' : 's'}${unit === 'week' ? ', shown as weekly totals' : ''}). UTC days.`,
  ];
  if (!view.available) {
    notices.push(
      isScans
        ? 'The NoDupe database is not available: bind NODUPE_DB and apply its migrations. Run: npx wrangler d1 migrations apply nodupe --remote'
        : 'Telemetry tables are not available yet: apply the latest migration to the database. Run: npx wrangler d1 migrations apply pinchpdf --remote (and nodupe)',
    );
  } else if (isScans ? (scans?.all.trials ?? 0) === 0 : view.tab === 'installs' ? installs.length === 0 : events.length === 0) {
    notices.push(
      isScans
        ? 'No NoDupe trials have been registered yet.'
        : view.tab === 'installs'
          ? 'No installs or uninstalls have been reported yet. They appear once an installer version that sends them is in use.'
          : 'No telemetry has been received yet. Events appear here once the app version that sends them is in use.',
    );
  }
  if (view.missing.length > 0) notices.push(`The ${esc(view.missing.join(' and '))} database is not available here, so its numbers are not included.`);
  if (view.product === 'pinchpdf' && isScans) notices.push('The Scans tab is always NoDupe, whatever product is selected.');

  let body: string;
  if (view.tab === 'scans') {
    const d = scansData(scans ?? emptyScanStats(), range);
    const a = d.free_allowance;
    body = `<div class="kpis">
${kpi('Trials registered', fmtNum(d.registered_in_range), 'NoDupe, in range')}
${kpi('Basic scans', fmtNum(d.total.basic), `used by them, allowance ${a.basic} each`)}
${kpi('Similar scans', fmtNum(d.total.similar), `used by them, allowance ${a.similar} each`)}
${kpi('Deep scans', fmtNum(d.total.deep), `used by them, allowance ${a.deep} each`)}
${kpi('Used everything', fmtNum(d.at_limit.all_modes), 'at the limit in all three modes')}
</div>
<div class="kpis">
${kpi('Basic at limit', fmtNum(d.at_limit.basic), `trials with ${a.basic} used`)}
${kpi('Similar at limit', fmtNum(d.at_limit.similar), `trials with ${a.similar} used`)}
${kpi('Deep at limit', fmtNum(d.at_limit.deep), `trials with ${a.deep} used`)}
${kpi('All trials, ever', fmtNum(d.all_time.trials), 'NoDupe')}
</div>
${SCAN_MODES.map(
  (mode) => `<section class="card"><h2>${mode[0].toUpperCase()}${mode.slice(1)} scans used per trial</h2><p class="sub">How many of the ${fmtNum(d.registered_in_range)} trials registered in range have used 0 to ${NODUPE_LIMITS[mode]} ${mode} scans (the allowance is ${NODUPE_LIMITS[mode]}).</p>${columnChart({
    labels: d.histogram[mode].map((_, i) => String(i)),
    series: [{ name: 'Trials', cls: 's0', values: d.histogram[mode] }],
    ariaLabel: `NoDupe trials by ${mode} scans used`,
    unit: 'trials',
  })}</section>`,
).join('')}
<p class="muted">The counts come from each trial's own usage reports (the highest value seen per mode, never lowered). A scan is counted by the app when it completes. Trials that were reset by support are left out. All time: ${fmtNum(d.all_time.total.basic)} basic, ${fmtNum(d.all_time.total.similar)} similar and ${fmtNum(d.all_time.total.deep)} deep scans, ${fmtNum(d.all_time.at_limit.all_modes)} trials at the limit in every mode.</p>`;
  } else if (view.tab === 'installs') {
    const d = installsData(installs, range);
    body = `<div class="kpis">
${kpi('Installs', fmtNum(d.installs), 'installer runs, in range')}
${kpi('New', fmtNum(d.new), 'first install')}
${kpi('Upgrades', fmtNum(d.upgrades), 'over an older version')}
${kpi('Reinstalls', fmtNum(d.reinstalls), 'same version again')}
${kpi('Uninstalls', fmtNum(d.uninstalls), 'in range')}
${kpi('Uninstalls per install', pct(d.uninstall_rate), 'in range')}
</div>
<section class="card"><h2>Installs by kind, per ${unit}</h2><p class="sub">Installer runs that reported in each ${unit}</p>
${legend([{ name: 'New', i: 0 }, { name: 'Upgrades', i: 1 }, { name: 'Reinstalls', i: 2 }])}
${columnChart({
  labels: labels(d.bucket_starts),
  series: [
    { name: 'New', cls: 's0', values: d.series.new },
    { name: 'Upgrades', cls: 's1', values: d.series.upgrade },
    { name: 'Reinstalls', cls: 's2', values: d.series.reinstall },
  ],
  ariaLabel: `Installs by kind per ${unit}`,
  unit: 'installs',
})}</section>
<section class="card"><h2>Uninstalls, per ${unit}</h2><p class="sub">Uninstaller runs that reported in each ${unit}</p>${columnChart({
      labels: labels(d.bucket_starts),
      series: [{ name: 'Uninstalls', cls: 's0', values: d.series.uninstalls }],
      ariaLabel: `Uninstalls per ${unit}`,
      unit: 'uninstalls',
    })}</section>
<p class="muted">Counted from events the installer and uninstaller send (an install id, a time, the version and Windows build, and for an install whether it is new, an upgrade or a reinstall). Nothing identifies a person or a computer. An uninstall on a machine with no internet connection is not reported, so uninstalls are a lower bound.</p>`;
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

function emptyScanStats(): ScanStats {
  const zero = { basic: 0, similar: 0, deep: 0 };
  const group = { trials: 0, used: { ...zero }, atLimit: { ...zero }, allModesAtLimit: 0 };
  return {
    cohort: { ...group, histogram: { basic: new Array(NODUPE_LIMITS.basic + 1).fill(0), similar: new Array(NODUPE_LIMITS.similar + 1).fill(0), deep: new Array(NODUPE_LIMITS.deep + 1).fill(0) } },
    all: group,
  };
}
