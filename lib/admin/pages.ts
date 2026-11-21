// HTML for the admin pages. Server-rendered, no scripts: the date range and product are plain
// links and a GET form, so a view can be bookmarked and the pages work with JavaScript off.

import { columnChart, esc, fmtNum, shareBars } from './charts';
import { ENDPOINTS, type Insights } from './insights';
import { PRODUCTS, dayStartMs, dayString, type ProductChoice, type Range } from './range';

export const ADMIN_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const CSS = `
:root{--bg:#fcfcfb;--surface:#fff;--neutral:#f1f0ec;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--line:#e1e0d9;--accent:#185fa5;--accent-bg:#e6f1fb;--danger:#a32d2d;--s0:#2a78d6;--s1:#eb6834;--s2:#1baf7a;--s3:#6250d6}
@media (prefers-color-scheme:dark){:root{--bg:#151515;--surface:#1c1c1b;--neutral:#242422;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--line:#2c2c2a;--accent:#85b7eb;--accent-bg:#0c447c;--danger:#f09595;--s0:#3987e5;--s1:#d95926;--s2:#199e70;--s3:#9085e9}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}.wrap{max-width:760px;margin:0 auto;padding:0 16px 48px}
header{border-bottom:1px solid var(--line);background:var(--surface)}header .wrap{display:flex;align-items:center;gap:18px;padding-top:12px;padding-bottom:12px;flex-wrap:wrap}
header b{font-weight:600}header nav{display:flex;gap:14px;font-size:14px}header nav a{text-decoration:none;color:var(--ink2)}header nav a[aria-current]{color:var(--ink);font-weight:600}
h1{font-size:22px;font-weight:600;margin:24px 0 4px}h2{font-size:14px;font-weight:600;margin:0 0 2px}.sub{color:var(--ink2);font-size:13px;margin:0 0 14px}
.muted{color:var(--muted);font-size:13px}.notice{background:var(--neutral);border-radius:8px;padding:8px 12px;font-size:13px;color:var(--ink2);margin:0 0 12px}
.err{color:var(--danger);font-size:13px;margin:0 0 10px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 12px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0 0 14px}
.k{background:var(--neutral);border-radius:8px;padding:12px 14px}.k .l{font-size:12px;color:var(--ink2);margin:0}.k .v{font-size:24px;font-weight:600;margin:2px 0 0;font-variant-numeric:tabular-nums}.k .d{font-size:12px;color:var(--muted);margin:2px 0 0}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:0 0 10px}.bar label{display:block;font-size:12px;color:var(--ink2);margin:0 0 3px}
input[type=date]{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);width:150px}
button,.btn{font:inherit;font-size:14px;padding:7px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-block}
.seg{display:flex}.seg a{font-size:13px;padding:5px 12px;border:1px solid var(--line);margin-left:-1px;text-decoration:none;color:var(--ink);background:var(--surface)}
.seg a:first-child{border-radius:8px 0 0 8px;margin-left:0}.seg a:last-child{border-radius:0 8px 8px 0}.seg a[aria-current]{background:var(--accent-bg);color:var(--accent);border-color:var(--accent);position:relative}
.lg{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--ink2);margin:0 0 6px}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.row{display:flex;align-items:center;gap:8px;font-size:12px;margin:5px 0}.rl{width:140px;color:var(--ink2);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.track{flex:1;background:var(--neutral);border-radius:4px;height:8px}.fill{height:8px;border-radius:4px}.rv{min-width:72px;text-align:right;font-variant-numeric:tabular-nums}
.s0{fill:var(--s0);background:var(--s0)}.s1{fill:var(--s1);background:var(--s1)}.s2{fill:var(--s2);background:var(--s2)}.s3{fill:var(--s3);background:var(--s3)}
.d0{background:var(--s0)}.d1{background:var(--s1)}.d2{background:var(--s2)}.d3{background:var(--s3)}
svg{display:block}.ax{fill:var(--muted);font-size:11px}.grid{stroke:var(--line);stroke-width:1}.hit{fill:transparent}.hit:hover{fill:var(--neutral);opacity:.6}
.cta{display:block;text-decoration:none;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px}.cta:hover{border-color:var(--muted)}.cta b{font-size:16px}.cta span{display:block;color:var(--ink2);font-size:13px;margin-top:2px}.cta .go{color:var(--accent);margin-top:8px}
.ctas{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
@media (max-width:520px){.rl{width:96px}}
`;

export function layout(title: string, active: 'home' | 'insights' | 'health', body: string, extra: { css?: string; script?: string } = {}): string {
  const link = (href: string, label: string, key: string) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>${CSS}${extra.css ?? ''}</style></head>
<body><header><div class="wrap"><b>TWS admin</b><nav>${link('/admin', 'Home', 'home')}${link('/admin/insights', 'Insights', 'insights')}${link('/admin/health', 'Health check', 'health')}<a href="/api/pinchpdf/trial/docs">API docs</a></nav></div></header>
<main class="wrap">${body}</main>${extra.script ?? ''}</body></html>`;
}

export function renderHome(): string {
  return layout(
    'Admin',
    'home',
    `<h1>Admin</h1><p class="sub">Operations for Technowiz Solutions products.</p>
<div class="ctas">
<a class="cta" href="/admin/insights"><b>Insights</b><span>Trials, requests and outcomes, by product and date range.</span><span class="go">Open insights →</span></a>
<a class="cta" href="/admin/health"><b>Health check</b><span>Live status of every API endpoint and website page, with errors if any.</span><span class="go">Run health check →</span></a>
<a class="cta" href="/api/pinchpdf/trial/docs"><b>API docs</b><span>Swagger reference for the trial API. Separate login.</span><span class="go">Open docs →</span></a>
</div>`,
  );
}

// ------------------------------------------------------------------ insights

const query = (product: ProductChoice, from: string, to: string) => `/admin/insights?product=${product}&from=${from}&to=${to}`;

function kpi(label: string, value: string, note: string): string {
  return `<div class="k"><p class="l">${esc(label)}</p><p class="v">${esc(value)}</p><p class="d">${esc(note)}</p></div>`;
}

function controls(range: Range, product: ProductChoice, today: string, error: string | null): string {
  const productLinks = [...PRODUCTS.map((p) => ({ id: p.id as ProductChoice, name: p.name })), { id: 'all' as ProductChoice, name: 'All products' }]
    .map((p) => `<a href="${query(p.id, range.from, range.to)}"${p.id === product ? ' aria-current="true"' : ''}>${esc(p.name)}</a>`)
    .join('');
  const presets = [7, 30, 90, 365]
    .map((days) => {
      const from = dayString(dayStartMs(today) - (days - 1) * 86_400_000);
      const active = range.to === today && range.days === days;
      return `<a href="${query(product, from, today)}"${active ? ' aria-current="true"' : ''}>${days === 365 ? '1 year' : `${days} days`}</a>`;
    })
    .join('');
  return `<div class="bar"><div><label>Product</label><div class="seg">${productLinks}</div></div></div>
<form class="bar" method="get" action="/admin/insights">
<input type="hidden" name="product" value="${esc(product)}">
<div><label for="from">From</label><input type="date" id="from" name="from" value="${esc(range.from)}" max="${esc(today)}" required></div>
<div><label for="to">To</label><input type="date" id="to" name="to" value="${esc(range.to)}" max="${esc(today)}" required></div>
<button type="submit">Apply</button>
<div class="seg" style="margin-left:auto">${presets}</div>
</form>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}`;
}

export function renderInsights(data: Insights, nowMs: number, error: string | null): string {
  const { range, product, cohort } = data;
  const today = dayString(nowMs);
  const names = product === 'all' ? 'All products' : (PRODUCTS.find((p) => p.id === product)?.name ?? product);
  const unit = data.weekly ? 'week' : 'day';
  const delta = cohort.previousN > 0 ? Math.round(((cohort.n - cohort.previousN) / cohort.previousN) * 100) : null;

  const req = data.requests;
  const requestTotal = req.available ? req.total : 0;
  const errorRate = req.available && req.total > 0 ? `${((req.errors / req.total) * 100).toFixed(1)}%` : '—';

  const notices: string[] = [];
  notices.push(`${esc(names)} · ${esc(range.from)} to ${esc(range.to)} (${range.days} day${range.days === 1 ? '' : 's'}${data.weekly ? ', shown as weekly totals' : ''}). Compared with the ${range.days} days before it. UTC days.`);
  if (!req.available) notices.push('Request counts are not available yet: apply migration 0002 to the database.');
  else if (req.firstDay === null) notices.push('No requests have been counted yet. Counting starts once this version is live.');
  else if (req.firstDay > range.from) notices.push(`Request counting started on ${esc(req.firstDay)}. Earlier days show no request data.`);

  const cls = ['s0', 's1', 's2', 's3'];
  const regSeries = data.registrations.map((r, i) => ({ name: PRODUCTS.find((p) => p.id === r.product)?.name ?? r.product, cls: cls[i % 4], values: r.values }));
  const regLegend = regSeries.length > 1 ? `<div class="lg">${regSeries.map((s) => `<span><i class="d${cls.indexOf(s.cls)}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';

  const endpointSeries = req.available ? req.byEndpoint.map((e, i) => ({ name: e.endpoint, cls: cls[i], values: e.values })) : [];

  const lifecycle = shareBars(
    cohort.n === 0
      ? []
      : [
          { label: 'Registered', count: cohort.n },
          { label: 'Used at least once', count: cohort.usedAtLeastOnce },
          { label: 'Exhausted all uses', count: cohort.exhausted },
          { label: 'Revoked or reset', count: cohort.revokedOrReset },
        ],
    cohort.n,
  );

  const outcomeTotal = req.available ? req.registerOutcomes.reduce((sum, o) => sum + o.count, 0) : 0;
  const outcomes = req.available ? shareBars(req.registerOutcomes, outcomeTotal) : '<p class="muted">Not available yet.</p>';

  const usesChart = columnChart({
    labels: data.usesHistogram.map((u) => String(u.used)),
    series: [{ name: 'trials', cls: 's0', values: data.usesHistogram.map((u) => u.count) }],
    ariaLabel: 'Trials by number of uses consumed',
    height: 140,
  });

  const body = `<h1>Insights</h1><p class="sub">Aggregate numbers only. No names, emails or device data.</p>
${controls(range, product, today, error)}
${notices.map((n) => `<p class="notice">${n}</p>`).join('')}
<div class="kpis">
${kpi('Total trials', fmtNum(data.allTimeAtEnd), 'all time, at range end')}
${kpi('New in range', fmtNum(cohort.n), delta === null ? 'no earlier data to compare' : `${delta >= 0 ? '+' : ''}${delta}% vs previous`)}
${kpi('Active trials', fmtNum(data.current.active), 'active, with uses left, now')}
${kpi('Exhausted', fmtNum(cohort.exhausted), `of ${fmtNum(cohort.n)} trials in range`)}
${kpi('Requests', req.available ? fmtNum(requestTotal) : '—', 'in range')}
${kpi('Error rate', errorRate, 'unavailable and rate limited')}
</div>
<section class="card"><h2>New trials per ${unit}</h2><p class="sub">Registrations accepted by the server</p>${regLegend}${columnChart({ labels: data.buckets, series: regSeries, ariaLabel: `New trials per ${unit}`, unit: 'new trials' })}</section>
<section class="card"><h2>Requests per ${unit}</h2><p class="sub">Calls to the trial endpoints</p>
${req.available ? `<div class="lg">${ENDPOINTS.map((e, i) => `<span><i class="d${i}"></i>${e}</span>`).join('')}</div>${columnChart({ labels: data.buckets, series: endpointSeries, ariaLabel: `Requests per ${unit} by endpoint`, unit: 'requests' })}` : '<p class="muted">Not available yet.</p>'}</section>
<div class="grid2">
<section class="card"><h2>Trial lifecycle</h2><p class="sub">Where trials registered in this range ended up</p>${lifecycle}</section>
<section class="card"><h2>Register outcomes</h2><p class="sub">What the server answered in this range</p>${outcomes}</section>
</div>
<div class="grid2">
<section class="card"><h2>Uses per trial</h2><p class="sub">Trials by number of files processed</p>${usesChart}</section>
<section class="card"><h2>App versions</h2><p class="sub">Trials registered in this range</p>${shareBars(data.appVersions, cohort.n)}<h2 style="margin-top:12px">Windows builds</h2>${shareBars(data.osBuilds, cohort.n)}</section>
</div>
<p class="muted">Generated ${esc(data.generatedAt.replace('T', ' ').slice(0, 19))} UTC. Request counts are approximate: a few can be missed when an instance restarts.</p>`;
  return layout('Insights · TWS admin', 'insights', body);
}
