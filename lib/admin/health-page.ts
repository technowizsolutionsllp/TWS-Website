// HTML for /admin/health. The server renders every row, so the page is readable on its own;
// a small script (allowed by a per-response nonce, on this page only) then runs the live probes
// from the browser, re-runs the server checks through /admin/health?format=json, and updates the
// indicators. All text from the server is escaped here; the script only ever uses textContent.

import { esc } from './charts';
import { CHECK_CATEGORIES, type Check } from './health-checks';
import { PROBE_CATEGORIES, type Probe } from './health-targets';
import { layout } from './pages';

export const healthCsp = (nonce: string) =>
  [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

const CSS = `
:root{--ok:#1a8f66;--warn:#b86e00}
@media (prefers-color-scheme:dark){:root{--ok:#3ccf9d;--warn:#e8a84b}}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--muted);flex:none}
[data-state=ok]>.dot,.sum[data-state=ok] .dot,.hbadge[data-state=ok]{--c:var(--ok)}
[data-state=warn]>.dot,.sum[data-state=warn] .dot,.hbadge[data-state=warn]{--c:var(--warn)}
[data-state=fail]>.dot,.sum[data-state=fail] .dot,.hbadge[data-state=fail]{--c:var(--danger)}
.hrow[data-state]>.dot,.sum[data-state] .dot{background:var(--c,var(--muted))}
.hrow[data-state=pending]>.dot,.sum[data-state=pending] .dot{animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.hrow[data-state=pending]>.dot,.sum[data-state=pending] .dot{animation:none}}
.sum{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;border-left:6px solid var(--c,var(--line))}
.sum[data-state=ok]{--c:var(--ok)}.sum[data-state=warn]{--c:var(--warn)}.sum[data-state=fail]{--c:var(--danger)}
.sum .dot{width:14px;height:14px;margin-right:8px;vertical-align:-1px}.sum b{font-size:17px}.sum p{margin:2px 0 0}
.hctl{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--ink2)}
.hctl select{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}
button[disabled]{opacity:.6;cursor:default}
.hhead{display:flex;align-items:center;justify-content:space-between;gap:10px}
.hbadge{font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--c,var(--line));color:var(--c,var(--ink2));white-space:nowrap}
.hlist{list-style:none;margin:6px 0 0;padding:0}
.hrow{display:grid;grid-template-columns:14px 1fr auto auto;gap:2px 10px;align-items:center;padding:9px 0;border-top:1px solid var(--line)}
.hrow:first-child{border-top:0}
.hname{overflow-wrap:anywhere}.hpath{color:var(--muted);font-size:12px;margin-left:6px;overflow-wrap:anywhere}
.hstat{font-size:13px;font-weight:600;white-space:nowrap;color:var(--c,var(--ink2))}
.hrow[data-state=ok]{--c:var(--ok)}.hrow[data-state=warn]{--c:var(--warn)}.hrow[data-state=fail]{--c:var(--danger)}.hrow[data-state=pending]{--c:var(--muted)}
.hms{font-size:12px;color:var(--muted);min-width:44px;text-align:right;font-variant-numeric:tabular-nums}
.hmsg{grid-column:2/-1;margin:0;font-size:13px;color:var(--ink2);white-space:pre-line;overflow-wrap:anywhere}.hmsg:empty{display:none}
.hrow[data-state=fail] .hmsg{color:var(--danger)}
`;

const STATE_TEXT = { pending: 'Checking…', ok: 'OK', warn: 'Warning', fail: 'Failed' } as const;
type State = keyof typeof STATE_TEXT;

function row(id: string, label: string, path: string | null, state: State, statText: string, detail: string, ms?: number): string {
  return `<li class="hrow" id="row-${esc(id)}" data-state="${state}"><span class="dot" aria-hidden="true"></span>` +
    `<span><span class="hname">${esc(label)}</span>${path ? `<code class="hpath">${esc(path)}</code>` : ''}</span>` +
    `<span class="hstat">${esc(statText)}</span><span class="hms">${ms && ms > 0 ? `${ms} ms` : ''}</span>` +
    `<p class="hmsg">${esc(detail)}</p></li>`;
}

function card(id: string, title: string, description: string, rows: string[], okCount: number, worst: State, pending: boolean): string {
  const badgeState: State = pending ? 'pending' : worst;
  return `<section class="card hcat" id="cat-${esc(id)}"><div class="hhead"><h2>${esc(title)}</h2>` +
    `<span class="hbadge" data-state="${badgeState}">${pending ? 'Checking…' : `${okCount} of ${rows.length} OK`}</span></div>` +
    `<p class="sub">${esc(description)}</p><ul class="hlist">${rows.join('')}</ul></section>`;
}

export type HealthPageData = { checks: Check[]; probes: Probe[]; generatedAt: string };

// The script. Plain ES2017, no template literals (it is embedded in a template literal here).
const CLIENT_SCRIPT = `
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('health-data').textContent);
  var STATE_TEXT = { pending: 'Checking\\u2026', ok: 'OK', warn: 'Warning', fail: 'Failed' };
  var REASON = {
    401: 'A login prompt was not expected here.',
    403: 'Blocked (403): a Cloudflare security rule or the app refused the request.',
    404: 'Not found (404): the route or page is missing from this deployment.',
    405: 'Method not allowed (405).',
    429: 'Rate limited (429): the route is reachable, but this address sent too many requests. Wait a minute.',
    500: 'Server error (500): the page or route crashed. Check the Worker logs.',
    502: 'Bad gateway (502).',
    503: 'Service unavailable (503): the service reports a configuration or database problem. See the server checks above.',
    504: 'Gateway timeout (504).',
    522: 'Cloudflare could not connect to the origin (522).',
    525: 'TLS handshake with the origin failed (525).'
  };
  var running = false;
  var timer = null;

  function $(id) { return document.getElementById(id); }
  // Built from the origin so a page address that carries a user name or password never leaks into requests.
  function url(path) { return location.origin + path; }

  function setRow(id, state, extra, msg, ms) {
    var row = $('row-' + id);
    if (!row) return;
    row.setAttribute('data-state', state);
    row.querySelector('.hstat').textContent = STATE_TEXT[state] + (extra ? ' \\u00b7 ' + extra : '');
    row.querySelector('.hms').textContent = ms > 0 ? ms + ' ms' : '';
    row.querySelector('.hmsg').textContent = msg || '';
  }

  function summarize() {
    var total = { pending: 0, ok: 0, warn: 0, fail: 0 };
    document.querySelectorAll('.hcat').forEach(function (cat) {
      var rows = cat.querySelectorAll('.hrow');
      var c = { pending: 0, ok: 0, warn: 0, fail: 0 };
      rows.forEach(function (r) { c[r.getAttribute('data-state')]++; });
      for (var k in c) total[k] += c[k];
      var badge = cat.querySelector('.hbadge');
      var state = c.pending ? 'pending' : c.fail ? 'fail' : c.warn ? 'warn' : 'ok';
      badge.setAttribute('data-state', state);
      badge.textContent = c.pending ? 'Checking\\u2026' : c.ok + ' of ' + rows.length + ' OK';
    });
    var state = total.fail ? 'fail' : total.pending ? 'pending' : total.warn ? 'warn' : 'ok';
    $('summary').setAttribute('data-state', state);
    $('sum-title').textContent =
      total.fail ? total.fail + (total.fail === 1 ? ' check is failing' : ' checks are failing')
      : total.pending ? 'Checking\\u2026'
      : total.warn ? 'Everything is reachable, with ' + total.warn + (total.warn === 1 ? ' warning' : ' warnings')
      : 'All systems operational';
    $('sum-sub').textContent = total.ok + ' OK \\u00b7 ' + total.warn + ' warning \\u00b7 ' + total.fail + ' failed' + (total.pending ? ' \\u00b7 ' + total.pending + ' checking' : '');
  }

  function randomKey() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    var text = '';
    for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return btoa(text).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }

  function classify(probe, status) {
    if (probe.ok.indexOf(status) >= 0) return 'ok';
    if (status === 429 || (probe.warn || []).indexOf(status) >= 0) return 'warn';
    return 'fail';
  }

  function runProbe(probe) {
    var started = performance.now();
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 10000);
    var init = { method: probe.method, credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { 'x-tws-health': '1' } };
    if (probe.body === 'challenge') {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify({ proto: 1, pubkey: randomKey() });
    }
    return fetch(url(probe.path), init).then(
      function (res) { return { status: res.status }; },
      function (err) { return { status: 0, aborted: Boolean(err && err.name === 'AbortError') }; }
    ).then(function (r) {
      clearTimeout(timeout);
      var ms = Math.round(performance.now() - started);
      var state = classify(probe, r.status);
      var message = '';
      if (state !== 'ok') {
        message = r.status === 0
          ? (r.aborted ? 'No answer within 10 seconds.' : 'No answer: network error, a blocked request, or this device is offline.')
          : 'HTTP ' + r.status + '. ' + (REASON[r.status] || (r.status >= 500 ? 'Server error.' : 'Unexpected answer.'));
        if (probe.note) message += ' ' + probe.note;
      }
      setRow(probe.id, state, r.status ? 'HTTP ' + r.status : 'no answer', message, ms);
    });
  }

  function pool(items, worker, size) {
    var index = 0;
    function next() {
      if (index >= items.length) return Promise.resolve();
      return worker(items[index++]).then(next);
    }
    var runners = [];
    for (var i = 0; i < size; i++) runners.push(next());
    return Promise.all(runners);
  }

  function runServer() {
    return fetch(url('/admin/health?format=json'), { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
      if (res.status === 401) throw new Error('The admin login expired. Reload this page.');
      if (!res.ok) throw new Error('The server checks answered HTTP ' + res.status + '.');
      return res.json();
    }).then(function (payload) {
      $('server-error').textContent = '';
      payload.checks.forEach(function (check) { setRow(check.id, check.status, '', check.detail, check.ms || 0); });
      $('generated').textContent = payload.generatedAt.replace('T', ' ').slice(0, 19) + ' UTC';
    }).catch(function (error) {
      $('server-error').textContent = 'Server checks could not be refreshed: ' + error.message;
    });
  }

  function run() {
    if (running) return Promise.resolve();
    running = true;
    var button = $('run');
    button.disabled = true;
    button.textContent = 'Checking\\u2026';
    return Promise.all([runServer(), pool(data.probes, runProbe, 6)]).then(function () {
      $('checked').textContent = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    }).then(function () {
      running = false;
      button.disabled = false;
      button.textContent = 'Run health check';
      summarize();
    });
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = null;
    var seconds = Number($('auto').value);
    if (seconds > 0) timer = setInterval(function () { if (!document.hidden) run(); }, seconds * 1000);
  }

  $('run').addEventListener('click', run);
  $('auto').addEventListener('change', schedule);
  summarize();
  run();
})();
`;

function safeJson(value: unknown): string {
  // Safe inside a <script> element: no "</script>" or HTML comment can be formed.
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

export function renderHealth({ checks, probes, generatedAt }: HealthPageData, nonce: string): string {
  const serverCard = (id: 'platform' | 'trial-selftest') => {
    const category = CHECK_CATEGORIES.find((c) => c.id === id)!;
    const items = checks.filter((check) => check.category === id);
    const worst: State = items.some((c) => c.status === 'fail') ? 'fail' : items.some((c) => c.status === 'warn') ? 'warn' : 'ok';
    return card(
      id,
      category.title,
      category.description,
      items.map((c) => row(c.id, c.label, null, c.status, STATE_TEXT[c.status], c.detail, c.ms)),
      items.filter((c) => c.status === 'ok').length,
      worst,
      false,
    );
  };
  const probeCard = (id: (typeof PROBE_CATEGORIES)[number]['id']) => {
    const category = PROBE_CATEGORIES.find((c) => c.id === id)!;
    const items = probes.filter((probe) => probe.category === id);
    return card(id, category.title, category.description, items.map((p) => row(p.id, p.label, `${p.method === 'POST' ? 'POST ' : ''}${p.path}`, 'pending', STATE_TEXT.pending, '')), 0, 'ok', true);
  };

  const body = `<h1>Health check</h1>
<p class="sub">Live status of the APIs and pages. Configuration and the trial API self-test run on the server. Endpoint and page checks run from this browser over the public internet, the same way a visitor or the PinchPDF app reaches the site. Nothing is changed or sent by email.</p>
<section class="card sum" id="summary" data-state="pending" role="status" aria-live="polite">
<div><span class="dot" aria-hidden="true"></span><b id="sum-title">Checking…</b><p class="muted" id="sum-sub"></p><p class="muted">Last checked <span id="checked">…</span> · server checks at <span id="generated">${esc(generatedAt.replace('T', ' ').slice(0, 19))} UTC</span></p></div>
<div class="hctl"><button type="button" id="run" class="btn">Run health check</button><label>Auto-refresh <select id="auto"><option value="0">Off</option><option value="30">Every 30 s</option><option value="60">Every minute</option><option value="300">Every 5 minutes</option></select></label></div>
</section>
<p class="err" id="server-error" role="alert"></p>
<noscript><p class="notice">JavaScript is off. The configuration checks below are current as of this page load; the endpoint and page checks need JavaScript.</p></noscript>
${serverCard('platform')}
${probeCard('trial-api')}
${serverCard('trial-selftest')}
${probeCard('site-api')}
${probeCard('protected')}
${probeCard('pages')}
${probeCard('files')}
<p class="muted">Endpoints that only accept POST are probed with GET and must answer 405: that proves the route is live without touching rate limiters, the database or email. The challenge endpoint gets a real POST (it stores nothing). Probe requests are not counted in Insights.</p>
<script type="application/json" id="health-data" nonce="${esc(nonce)}">${safeJson({ probes })}</script>`;

  return layout('Health check · TWS admin', 'health', body, {
    css: CSS,
    script: `<script nonce="${esc(nonce)}">${CLIENT_SCRIPT}</script>`,
  });
}
