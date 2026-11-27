// HTML for /admin/checkout: where the Buy buttons send buyers. Server-rendered with no scripts, like every admin page.
//
// Layout (from the approved prototype): what buyers get now (with a 9-week schedule strip) → provider order → the link
// sets as cards that open in place → a sticky "Review and save" bar. "Review and save" answers with a second page that
// lists every change next to its live-check result; only that page can save. See docs/CHECKOUT_LINKS.md.

import { buyerLine, keyLabel, linkAt, roleOf, type Change } from '../checkout/changes';
import {
  DODO_HOST,
  LEMON_STORES,
  MAX_SETS,
  MODES,
  MODE_NAMES,
  PROVIDERS,
  PROVIDER_NAMES,
  TIERS,
  TIER_NAMES,
  errorsInSet,
  fmtUtc,
  hasEnded,
  isDated,
  linkKey,
  promotions,
  runningSet,
  setLabel,
  setName,
  spanText,
  urlOf,
  usedSets,
  type CheckoutConfig,
  type ConfigErrors,
  type Mode,
  type Provider,
} from '../checkout/config';
import type { LinksAnswer } from '../checkout/handler';
import type { AuditRow, Stored } from '../checkout/store';
import type { CheckResult } from '../checkout/verify';
import { PRODUCT_SPECS, type ProductSpec } from '../trial/product';
import { esc } from './charts';
import { layout } from './pages';

const CSS = `
:root{--ok:#17714f;--ok-bg:#e3f4ec;--warn:#8a5a00;--warn-bg:#fdf1d8;--danger-bg:#fbeaea;--shadow:0 6px 24px rgba(20,20,10,.12)}
@media (prefers-color-scheme:dark){:root{--ok:#7fd3ad;--ok-bg:#123a2a;--warn:#f0c46b;--warn-bg:#3a2d10;--danger-bg:#3a1c1c;--shadow:0 6px 24px rgba(0,0,0,.5)}}
.wrap{padding-bottom:24px}
.ck{display:grid;gap:14px}.ck .card{margin:0;display:grid;gap:12px;min-width:0}
.head{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;justify-content:space-between}
.bar .lab{display:block;font-size:12px;color:var(--ink2);margin:0 0 3px}
.notice.test{background:var(--warn-bg);color:var(--warn)}.notice.stop{background:var(--danger-bg);color:var(--danger)}.notice.good{background:var(--ok-bg);color:var(--ok)}
.msgs{display:grid;gap:8px}.msgs .notice,.msgs .err{margin:0}
.err{margin:0;font-size:12px}
.chip{display:inline-block;font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;background:var(--neutral);color:var(--ink2);white-space:nowrap}
.chip.run,.chip.ok{background:var(--ok-bg);color:var(--ok)}.chip.plan,.chip.p{background:var(--accent-bg);color:var(--accent)}.chip.bad{background:var(--danger-bg);color:var(--danger)}.chip.warn{background:var(--warn-bg);color:var(--warn)}
.now{display:grid;gap:6px}.now div{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;font-size:14px}.now .t{width:84px;color:var(--ink2);font-size:13px}
.tl{position:relative;height:40px;margin-top:14px}.tl .base{position:absolute;inset:6px 0;border-radius:6px;background:var(--neutral)}
.tl .blk{position:absolute;top:6px;bottom:6px;border-radius:6px;border:1px solid var(--accent);background:var(--accent-bg);color:var(--accent);font-size:11px;padding:0 6px;display:flex;align-items:center;min-width:6px;overflow:hidden}
.tl .blk span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}.tl .blk.run{border-color:var(--ok);background:var(--ok-bg);color:var(--ok)}.tl .blk.old{border-color:var(--line);background:var(--neutral);color:var(--muted)}
.tl .blk.more{border-right-style:dashed;border-top-right-radius:0;border-bottom-right-radius:0}
.tl .nowm{position:absolute;top:-12px;bottom:0;width:2px;margin-left:-1px;background:var(--ink)}.tl .nowm span{position:absolute;top:-4px;left:4px;font-size:11px;white-space:nowrap}
.ticks{position:relative;height:16px;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.ticks span{position:absolute;transform:translateX(-50%);white-space:nowrap}
@media (max-width:560px){.ticks span.odd{display:none}}
.sched{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13px}.sched li{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}.sched .when{color:var(--ink2);font-variant-numeric:tabular-nums}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.tile{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer}.tile input{margin-top:4px}
.tile b{display:block;font-size:14px}.tile small{display:block;font-size:12px;color:var(--ink2)}.tile.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}.tile.on small{color:var(--accent)}
.force{display:flex;gap:10px;align-items:flex-start;font-size:14px;cursor:pointer}.force small{display:block;color:var(--ink2);font-size:12px;max-width:62ch}
.ck input[type=text],.ck input[type=datetime-local],.ck select{font:inherit;font-size:13px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);width:100%;min-width:0}
.ck .bad{border-color:var(--danger)}
.deffld{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:14px}.deffld select{width:auto;max-width:100%}
.sets{display:grid;gap:10px}
details.set{border:1px solid var(--line);border-radius:10px;background:var(--surface)}details.set.live{border-color:var(--ok);box-shadow:inset 0 0 0 1px var(--ok)}
details.set>summary{list-style:none;cursor:pointer;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;padding:10px 12px}
details.set>summary::-webkit-details-marker{display:none}
details.set>summary::before{content:"";width:7px;height:7px;border-right:2px solid var(--ink2);border-bottom:2px solid var(--ink2);transform:rotate(-45deg);margin:0 4px 0 2px}
details.set[open]>summary::before{transform:rotate(45deg)}
.set .num{font-size:12px;color:var(--ink2);font-weight:600}.set .nm{font-weight:600;font-size:14px;overflow-wrap:anywhere}.set .cnt{font-size:12px;color:var(--muted);margin-left:auto}
.set .body{border-top:1px solid var(--line);padding:12px;display:grid;gap:14px}
.meta{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:end}
.fld{display:grid;gap:3px;min-width:0}.fld label{font-size:12px;color:var(--ink2)}
.dates-line{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;color:var(--ink2)}
.pg{display:grid;gap:8px}.pgh{display:flex;gap:8px;align-items:center}.pgh h3{font-size:13px;margin:0}
.lhead,.lmain{display:grid;grid-template-columns:120px minmax(0,1fr) 64px;gap:8px;align-items:center}
.lhead{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.lrow{display:grid;gap:4px}.lmain .open{font-size:12px;white-space:nowrap}
.linfo{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline;font-size:12px;color:var(--muted);padding-left:128px;min-width:0}.linfo span{overflow-wrap:anywhere}
.lrow .err,.lrow .vr{margin-left:128px}
.vr{font-size:12px;margin:0;padding:4px 8px;border-radius:6px}.vr.pass{background:var(--ok-bg);color:var(--ok)}.vr.fail{background:var(--danger-bg);color:var(--danger)}.vr.warnr{background:var(--warn-bg);color:var(--warn)}
.set-foot{display:flex;justify-content:flex-end}
.acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
button.sm,.btn.sm{font-size:12px;padding:4px 10px}button.primary{background:var(--accent);border-color:var(--accent);color:var(--surface)}button.danger{color:var(--danger)}button[disabled]{opacity:.5;cursor:not-allowed}
.savebar{position:sticky;bottom:10px;z-index:5;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;box-shadow:var(--shadow)}
.savebar .st{font-size:13px;color:var(--ink2);margin-right:auto}.savebar .st.dirty{color:var(--warn);font-weight:600}
.offscreen{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.tbl{overflow-x:auto}.tbl table{border-collapse:collapse;width:100%;font-size:12px;min-width:560px}.tbl th,.tbl td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl th{color:var(--ink2);font-weight:600}.tbl td.u{word-break:break-all;max-width:260px}.tbl td{font-variant-numeric:tabular-nums}
.ok-t{color:var(--ok)}.bad-t{color:var(--danger)}.warn-t{color:var(--warn)}
.cmp{display:grid;grid-template-columns:84px minmax(0,1fr) minmax(0,1fr);gap:6px 12px;font-size:13px;align-items:baseline}.cmp .h{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.confirm{display:grid;gap:6px;border:1px solid var(--line);border-radius:10px;padding:10px 12px}.confirm label{display:flex;gap:8px;align-items:flex-start;font-size:13px}
.confirm ul{margin:0;padding-left:26px;font-size:12px}.confirm li{overflow-wrap:anywhere}
details.ref{padding:0}details.ref>summary{cursor:pointer;padding:12px 14px;font-weight:600;font-size:14px}details.ref>div{padding:0 14px 14px;display:grid;gap:8px}
.how{font-size:13px;color:var(--ink2);margin:0;padding-left:18px}.how li{margin:2px 0}
pre{margin:0;font-size:12px;background:var(--neutral);border-radius:8px;padding:10px 12px;overflow-x:auto}
code{font-size:12px;word-break:break-all}
@media (max-width:560px){.meta{grid-template-columns:1fr}.lhead{display:none}.lmain{grid-template-columns:minmax(0,1fr) auto}.lmain input{grid-column:1/-1;grid-row:2}.linfo{padding-left:0}.lrow .err,.lrow .vr{margin-left:0}.cmp{grid-template-columns:70px minmax(0,1fr) minmax(0,1fr);font-size:12px}}
`;

/** A check result the page remembers for a link, valid only while the link and its type are unchanged. */
export type ShownResult = CheckResult & { url: string; type: string };

export type EditorView = {
  product: ProductSpec;
  mode: Mode;
  nowSec: number;
  saved: Stored;
  draft: CheckoutConfig;
  version: number;
  errors: ConfigErrors;
  results: Record<string, ShownResult>;
  /** Sets whose card starts open. */
  open: number[];
  dirtyCount: number;
  notice: string | null;
  error: string | null;
  history: AuditRow[];
  answer: LinksAnswer;
};

export type ReviewView = {
  product: ProductSpec;
  mode: Mode;
  nowSec: number;
  saved: Stored;
  draft: CheckoutConfig;
  version: number;
  changes: Change[];
  /** Keys checked with the providers, in order. */
  checked: string[];
  results: Record<string, ShownResult>;
  failed: number;
  warned: number;
  token: string;
  needConfirm: boolean;
  pages: { tier: string; provider: Provider; url: string; sets: number[] }[];
  reason: string;
  reasonError: string | null;
  confirmError: string | null;
  error: string | null;
};

const DAY = 86_400;
const pageUrl = (product: string, mode: string) => `/admin/checkout?product=${product}&mode=${mode}`;
const resultText = (r: CheckResult) => `${r.ok ? '✓ Verified: ' : r.warn ? '! ' : '✕ '}${r.text}`;
const resultClass = (r: CheckResult) => (r.ok ? 'pass' : r.warn ? 'warnr' : 'fail');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtDay = (sec: number) => fmtUtc(sec).split(' ').slice(0, 2).join(' ');
const datetimeValue = (sec: number | null) => (sec === null ? '' : new Date(sec * 1000).toISOString().slice(0, 16));
function inWords(seconds: number): string {
  const hours = Math.round(seconds / 3600);
  return hours >= 48 ? `${Math.round(hours / 24)} days` : plural(hours, 'hour');
}

function switcher(view: { product: ProductSpec; mode: Mode }): string {
  const products = PRODUCT_SPECS.map((p) => `<a href="${pageUrl(p.id, view.mode)}"${p === view.product ? ' aria-current="true"' : ''}>${esc(p.name)}</a>`).join('');
  const modes = MODES.map((m) => `<a href="${pageUrl(view.product.id, m)}"${m === view.mode ? ' aria-current="true"' : ''}>${MODE_NAMES[m]}</a>`).join('');
  return `<div class="bar"><div><span class="lab">Product</span><div class="seg">${products}</div></div><div><span class="lab">Mode</span><div class="seg">${modes}</div></div></div>`;
}

function messages(view: { mode: Mode; product: ProductSpec; saved: Stored; error: string | null; notice?: string | null }): string {
  const out: string[] = [];
  if (view.error) out.push(`<p class="notice stop" role="alert">${esc(view.error)}</p>`);
  if (view.notice) out.push(`<p class="notice good" role="status">${esc(view.notice)}</p>`);
  if (view.mode === 'test') out.push('<p class="notice test">Test mode: sandbox links, used by debug builds of the apps. No real payments.</p>');
  if (view.saved.source === 'unreadable') out.push('<p class="notice stop">The saved setting for this tab does not pass the rules (it may have been edited in the database), so the site serves the links built into the app. Saving here replaces it.</p>');
  if (view.saved.config.force) out.push(`<p class="notice stop">Forced: ${esc(view.product.name)} (${MODE_NAMES[view.mode]}) opens only ${PROVIDER_NAMES[view.saved.config.primary]}, with no backup.</p>`);
  return out.length > 0 ? `<div class="msgs">${out.join('')}</div>` : '';
}

function summary(view: EditorView): string {
  const s = view.saved.config;
  const now = view.nowSec;
  const lines = TIERS.map((t) => {
    const r = buyerLine(s, t, now);
    return `<div><span class="t">${TIER_NAMES[t]}</span><b>${esc(r.text)}</b><span class="chip ${r.tone === 'ok' ? 'p' : r.tone}">${esc(r.note)}</span></div>`;
  }).join('');
  const t0 = Math.floor(now / DAY) * DAY - DAY;
  const len = 63 * DAY;
  const pct = (sec: number) => Math.max(0, Math.min(100, ((sec - t0) / len) * 100)).toFixed(2);
  const running = runningSet(s, now);
  const blocks = s.sets
    .map((set, i) => {
      if (i === 0 || !isDated(set)) return '';
      const b = set.starts_at ?? t0;
      const e = set.ends_at ?? Infinity;
      if (e <= t0 || b >= t0 + len) return '';
      const cls = `blk${hasEnded(set, now) ? ' old' : running === i ? ' run' : ''}${e > t0 + len ? ' more' : ''}`;
      const width = (Number(pct(Math.min(e, t0 + len))) - Number(pct(b))).toFixed(2);
      return `<div class="${cls}" style="left:${pct(b)}%;width:${width}%" title="${esc(`${setLabel(s, i)}, ${spanText(set)}`)}"><span>${esc(setName(s, i))}</span></div>`;
    })
    .join('');
  const hasDated = s.sets.some((set, i) => i > 0 && isDated(set));
  const ticks = Array.from({ length: 8 }, (_, k) => `<span class="${k % 2 === 0 ? 'odd' : ''}" style="left:${(((k + 1) * 7) / 63) * 100}%">${fmtDay(t0 + (k + 1) * 7 * DAY)}</span>`).join('');
  const strip = hasDated ? `<div><div class="tl" aria-hidden="true"><div class="base"></div>${blocks}<div class="nowm" style="left:${pct(now)}%"><span>Now</span></div></div><div class="ticks" aria-hidden="true">${ticks}</div></div>` : '';
  const items = [`<li><span class="chip ${running >= 0 ? '' : 'run'}">${running >= 0 ? 'Default, paused' : 'Default'}</span><b>${esc(setLabel(s, s.default_set))}</b><span class="when">Buyers get it whenever no promotion is running.</span></li>`];
  const promos = promotions(s, now);
  for (const i of promos) {
    const set = s.sets[i];
    const isRunning = running === i;
    const when = isRunning ? (set.ends_at !== null ? `, ends in ${inWords(set.ends_at - now)}` : '') : `, starts in ${inWords((set.starts_at ?? now) - now)}`;
    items.push(`<li><span class="chip ${isRunning ? 'run' : 'plan'}">${isRunning ? 'Running' : 'Scheduled'}</span><b>${esc(setLabel(s, i))}</b><span class="when">${esc(spanText(set) + when)}</span></li>`);
  }
  if (promos.length === 0) items.push('<li class="muted">No promotions scheduled.</li>');
  const source = view.saved.source === 'saved' ? `Saved settings, ${MODE_NAMES[view.mode]}` : `Links built into the app, ${MODE_NAMES[view.mode]} (nothing saved yet)`;
  return `<section class="card"><div class="head"><h2>What buyers get now</h2><span class="muted">${esc(source)}</span></div><div class="now">${lines}</div>${strip}<ul class="sched">${items.join('')}</ul></section>`;
}

function providerOrder(view: EditorView): string {
  const d = view.draft;
  const tiles = PROVIDERS.map((p) => {
    const on = d.primary === p;
    const role = on ? (d.force ? 'Primary, forced: the only provider buyers see' : 'Primary: opens first') : d.force ? 'Not used while the primary is forced' : 'Backup: opens when the primary cannot';
    return `<label class="tile${on ? ' on' : ''}" for="primary-${p}"><input type="radio" name="primary" id="primary-${p}" value="${p}"${on ? ' checked' : ''}><span><b>${PROVIDER_NAMES[p]}</b><small>${esc(role)}</small></span></label>`;
  }).join('');
  const orderError = view.errors.order ? `<p class="err">${esc(view.errors.order)}</p>` : '';
  return `<section class="card"><div><h2>Provider order</h2><p class="sub" style="margin:0">Applies to every link set.</p></div>
<div class="tiles" role="radiogroup" aria-label="Primary provider">${tiles}</div>${orderError}
<label class="force"><input type="checkbox" name="force" id="force"${d.force ? ' checked' : ''}><span><b>Force the primary provider</b><small>Apps and the website open only the primary, with no backup, even when its checkout is down. Key activation is not affected: keys from both providers still activate.</small></span></label></section>`;
}

function linkRow(view: EditorView, i: number, p: Provider, r: number, used: number[]): string {
  const d = view.draft;
  const link = d.sets[i].links[p][r];
  const key = linkKey(i, p, r);
  const id = `url-${i}-${p}-${r}`;
  const error = view.errors.fields[key];
  const inherited = !link.url && i > 0 ? urlOf(d.sets[0], link.type, p) : '';
  const url = link.url || inherited;
  let chip = 'Not set';
  let tone = '';
  if (error) [chip, tone] = ['Refused', 'bad'];
  else if (!url) chip = 'Not set';
  else if (!link.url) chip = 'Uses set 1';
  else if (!used.includes(i)) chip = 'Set not in use';
  else if (p === d.primary) [chip, tone] = ['Buyers get this', 'p'];
  else [chip, tone] = d.force ? ['Not used while forced', ''] : ['Backup', 'ok'];
  const label = `set ${i + 1}, ${PROVIDER_NAMES[p]} link ${r + 1}`;
  const options = TIERS.map((t) => `<option value="${t}"${link.type === t ? ' selected' : ''}>${TIER_NAMES[t]}</option>`).join('');
  const placeholder = i > 0 ? 'Empty: uses set 1' : p === 'dodo' ? `https://${DODO_HOST[view.mode]}/buy/pdt_…?quantity=1` : `https://${LEMON_STORES[view.product.id][0]}.lemonsqueezy.com/checkout/buy/…`;
  const result = view.results[key];
  const showResult = result && !error && link.url && result.url === link.url && result.type === link.type;
  return `<div class="lrow"><div class="lmain">
<select name="type.${key}" id="type-${id}" aria-label="License type, ${esc(label)}"${view.errors.types[key] ? ' class="bad"' : ''}>${options}</select>
<input type="text" inputmode="url" name="url.${key}" id="${id}" value="${esc(link.url)}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off" aria-label="Checkout link, ${esc(label)}"${error && !view.errors.types[key] ? ' class="bad"' : ''}>
${url && !error ? `<a class="open" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : '<span></span>'}
</div><div class="linfo"><span class="chip ${tone}">${chip}</span>${inherited ? `<span>${esc(inherited)}</span>` : !link.url && i > 0 ? `<span>Set 1 has no ${TIER_NAMES[link.type]} link either.</span>` : ''}</div>
${error ? `<p class="err">${esc(error)}</p>` : ''}${showResult ? `<p class="vr ${resultClass(result)}">${esc(resultText(result))}</p>` : ''}</div>`;
}

function setCard(view: EditorView, i: number, used: number[], live: number): string {
  const d = view.draft;
  const set = d.sets[i];
  const role = roleOf(d, i, view.nowSec);
  const problems = errorsInSet(view.errors, i);
  let own = 0;
  let inherited = 0;
  for (const p of PROVIDERS) {
    for (const link of set.links[p]) {
      if (link.url) own += 1;
      else if (i > 0 && urlOf(d.sets[0], link.type, p)) inherited += 1;
    }
  }
  const count = i === 0 ? `${own} of 4 links` : `${own} own, ${inherited} from set 1`;
  const parts: string[] = [];
  if (i === 0) parts.push('<p class="sub" style="margin:0">The standard links. Empty links in other sets use these. Set 1 cannot be renamed, dated or removed.</p>');
  else {
    const dateError = view.errors.dates[i];
    const now = view.nowSec;
    let status = '';
    if (!isDated(set)) status = d.default_set === i ? 'No dates: this is the default set.' : 'No dates. Buyers get this set only if you make it the default.';
    else if (hasEnded(set, now)) status = 'Ended. Set new dates to run it again.';
    else if (set.starts_at !== null && set.starts_at > now) status = `Starts in ${inWords(set.starts_at - now)}${set.ends_at === null ? ', no end.' : `, runs ${inWords(set.ends_at - set.starts_at)}, then buyers get the default set.`}`;
    else status = `Running now${set.ends_at === null ? ', no end.' : `, ends in ${inWords(set.ends_at - now)}, then buyers get the default set.`}`;
    parts.push(`<div class="meta">
<div class="fld"><label for="name-${i}">Name</label><input type="text" name="name.${i}" id="name-${i}" value="${esc(set.name)}" maxlength="60" placeholder="e.g. Black Friday 2026"${view.errors.names[i] ? ' class="bad"' : ''}></div>
<div class="fld"><label for="starts-${i}">Starts (UTC, optional)</label><input type="datetime-local" name="starts.${i}" id="starts-${i}" value="${datetimeValue(set.starts_at)}" step="60"${dateError && /start|overlap/.test(dateError) ? ' class="bad"' : ''}></div>
<div class="fld"><label for="ends-${i}">Ends (UTC, optional)</label><input type="datetime-local" name="ends.${i}" id="ends-${i}" value="${datetimeValue(set.ends_at)}" step="60"${dateError && !/start/.test(dateError) ? ' class="bad"' : ''}></div>
</div>${view.errors.names[i] ? `<p class="err">${esc(view.errors.names[i])}</p>` : ''}
<div class="dates-line"><span>${esc(status)}</span>${isDated(set) ? `<button type="submit" name="intent" value="clear:${i}" class="sm">Clear dates</button>` : ''}</div>${dateError ? `<p class="err">${esc(dateError)}</p>` : ''}`);
  }
  parts.push('<div class="lhead" aria-hidden="true"><span>License type</span><span>Checkout link</span><span></span></div>');
  for (const p of PROVIDERS) {
    const on = d.primary === p;
    const chip = on ? (d.force ? 'Primary, forced' : 'Primary') : d.force ? 'Not used while forced' : 'Backup';
    parts.push(`<div class="pg"><div class="pgh"><h3>${PROVIDER_NAMES[p]}</h3><span class="chip ${on ? 'p' : d.force ? '' : 'ok'}">${chip}</span></div>${linkRow(view, i, p, 0, used)}${linkRow(view, i, p, 1, used)}</div>`);
  }
  if (i > 0) parts.push(`<div class="set-foot"><button type="submit" name="intent" value="remove:${i}" class="sm danger"${d.default_set === i ? ' disabled title="Make another set the default first"' : ''}>Remove set ${i + 1}</button></div>`);
  const tone = role.tone === 'run' ? 'run' : role.tone === 'plan' ? 'plan' : role.tone === 'warn' ? 'warn' : role.tone === 'bad' ? 'bad' : '';
  return `<details class="set${live === i ? ' live' : ''}" id="set-${i}"${view.open.includes(i) ? ' open' : ''}>
<summary><span class="num">Set ${i + 1}</span><span class="nm">${esc(setName(d, i))}</span><span class="chip ${tone}">${esc(role.text)}</span>${problems ? `<span class="chip bad">${plural(problems, 'problem')}</span>` : ''}<span class="cnt">${count}</span></summary>
<div class="body">${parts.join('\n')}</div></details>`;
}

function linkSets(view: EditorView): string {
  const d = view.draft;
  const used = usedSets(d, view.nowSec);
  const live = runningSet(d, view.nowSec) >= 0 ? runningSet(d, view.nowSec) : d.default_set;
  const options = d.sets
    .map((set, i) => `<option value="${i}"${d.default_set === i ? ' selected' : ''}${i > 0 && isDated(set) && d.default_set !== i ? ' disabled' : ''}>${esc(setLabel(d, i))}${i > 0 && isDated(set) ? ' (has dates)' : ''}</option>`)
    .join('');
  const left = MAX_SETS - d.sets.length;
  return `<section class="card"><div class="head"><h2>Link sets</h2><button type="submit" name="intent" value="check" class="sm">Check all links</button></div>
<p class="sub" style="margin:0">Set 1 holds the standard links. Add up to 3 more sets for a promotion or a short-term change. Give a set a start or an end date (both optional) and it runs by itself on those dates. Promotion dates cannot overlap. In sets 2 to 4, an empty link uses set 1's link of the same license type.</p>
<div class="deffld"><label for="default-set">When no promotion is running, buyers get</label><select name="default_set" id="default-set"${view.errors.defaultSet ? ' class="bad"' : ''}>${options}</select></div>
${view.errors.defaultSet ? `<p class="err">${esc(view.errors.defaultSet)}</p>` : ''}
<div class="sets">${d.sets.map((_, i) => setCard(view, i, used, live)).join('\n')}</div>
<div class="acts"><button type="submit" name="intent" value="add" class="sm"${left <= 0 ? ' disabled' : ''}>+ Add link set</button><span class="muted">${left <= 0 ? 'All 4 sets are in use. Remove one to add another.' : `${plural(left, 'more set')} can be added.`}</span></div></section>`;
}

function historyTable(rows: AuditRow[]): string {
  const body =
    rows.length === 0
      ? '<tr><td colspan="5" class="muted">No changes yet. The apps use the links built into them.</td></tr>'
      : rows
          .map((h) => {
            const who = h.operator === 'admin-ui' ? '' : ` (${h.operator})`;
            const after = `${h.after || '(cleared)'}${h.checked ? ` [${h.checked}]` : ''}`;
            return `<tr><td>${esc(new Date(h.at * 1000).toISOString().replace('T', ' ').slice(0, 16))}</td><td>${MODE_NAMES[h.mode]}</td><td>${esc(h.change)}</td><td class="u">${esc(h.before ? `${h.before} → ${after}` : after)}</td><td>${esc(h.reason + who)}</td></tr>`;
          })
          .join('');
  return `<section class="card"><h2>Recent changes</h2><p class="sub" style="margin:0">The last 20 changes for this product, both tabs. The admin login is shared, so changes are recorded as "admin-ui".</p>
<div class="tbl"><table><thead><tr><th>When (UTC)</th><th>Mode</th><th>Change</th><th>Before → after</th><th>Reason</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function reference(view: EditorView): string {
  const base = `https://technowizsolutions.com/api/${view.product.id}/checkout/v1/`;
  return `<details class="card ref"><summary>What the apps fetch</summary><div>
<p class="sub" style="margin:0">Public, no login, from the saved settings. Only the set buyers get now is sent, with set 1's links filled in where it has none, grouped by license type. The website's Buy buttons can use the second address, which redirects to the checkout.</p>
<p style="margin:0"><code>GET ${esc(base)}links?mode=${view.mode}</code></p><p style="margin:0"><code>GET ${esc(base)}open?tier=individual&amp;mode=${view.mode}</code> → 302 to the checkout</p>
<pre>${esc(JSON.stringify(view.answer, null, 2))}</pre></div></details>
<details class="card ref"><summary>When changes take effect</summary><div><ul class="how">
<li>Before anything is saved, the server opens each new or changed link (in any set) and the links buyers will get, and checks that each is a real checkout page for this product and license type. In Live, if one fails, nothing is saved. In Test a failure is only a warning.</li>
<li>The license type must match what the page sells. A Dodo link must be that license's product; for Lemon Squeezy the server reads the product name on the checkout page. Changing only a link's license type is checked too.</li>
<li>Opening a link for the check starts a checkout session or cart at the provider, as a buyer's click would. Nothing is bought.</li>
<li>Website Buy links: within a minute. Apps: the next time someone opens the Upgrade window. A link that fails the app's own check is ignored, and the app uses the link built into it.</li>
<li>A Dodo product the app does not know cannot be saved here: the app would refuse its keys. Adding one needs an app release. For a promotion, use a discount code on the same product.</li>
</ul></div></details>`;
}

export function renderCheckoutEditor(view: EditorView): string {
  const dirty = view.dirtyCount > 0;
  const problems = Object.keys(view.errors.fields).length + Object.keys(view.errors.names).length + Object.keys(view.errors.dates).length + (view.errors.order ? 1 : 0) + (view.errors.defaultSet ? 1 : 0);
  const state = dirty ? `${plural(view.dirtyCount, 'unsaved change')}${problems ? `, ${plural(problems, 'problem')} to fix` : ''}` : 'No unsaved changes';
  const body = `<div class="ck"><div><h1>Checkout links</h1><p class="sub" style="margin:0">Where the Buy buttons in PinchPDF and NoDupe send buyers. The apps fetch these links when the Upgrade window opens and keep the last copy. If they cannot reach the site, they use that copy, or the links built into the app.</p></div>
${switcher(view)}
${messages(view)}
${summary(view)}
<form method="post" action="/admin/checkout" class="ck" novalidate>
<input type="hidden" name="product" value="${view.product.id}"><input type="hidden" name="mode" value="${view.mode}"><input type="hidden" name="version" value="${view.version}"><input type="hidden" name="sets" value="${view.draft.sets.length}">
<input type="hidden" name="results" value="${esc(JSON.stringify(view.results))}">
<button type="submit" name="intent" value="review" class="offscreen" tabindex="-1" aria-hidden="true">Review and save</button>
${providerOrder(view)}
${linkSets(view)}
<div class="savebar"><span class="st${dirty ? ' dirty' : ''}">${esc(state)}</span><a class="btn" href="${pageUrl(view.product.id, view.mode)}">Discard changes</a><button type="submit" name="intent" value="review" class="primary">Review and save</button></div>
</form>
${historyTable(view.history)}
${reference(view)}</div>`;
  return layout('Checkout links', 'checkout', body, { css: CSS });
}

export function renderCheckoutReview(view: ReviewView): string {
  const s = view.saved.config;
  const d = view.draft;
  const n = view.checked.length;
  let status = '';
  if (n === 0) status = 'No link needs a check for these changes.';
  else if (view.failed) status = '';
  else if (view.warned) status = `${view.warned} of ${plural(n, 'link')} failed the check. In Test that is a warning only: you can still save.`;
  else status = `All ${plural(n, 'link')} passed the check with the provider.`;
  const cell = (key: string | null) => {
    if (!key) return '<td class="muted">No check needed</td>';
    const r = view.results[key];
    if (!r) return '<td></td>';
    return `<td class="${r.ok ? 'ok-t' : r.warn ? 'warn-t' : 'bad-t'}">${esc(resultText(r))}</td>`;
  };
  const changedKeys = view.changes.map((c) => c.key).filter((k): k is string => !!k);
  const rows = view.changes.map((c) => `<tr><td>${esc(c.change)}</td><td class="u">${esc(c.before ? `${c.before} → ${c.after || '(cleared)'}` : c.after || '(cleared)')}</td>${cell(c.key)}</tr>`).join('');
  const also = view.checked.filter((k) => !changedKeys.includes(k));
  const alsoRows = also.map((k) => `<tr><td>${esc(keyLabel(d, k))}</td><td class="u">${esc(linkAt(d, k)?.url ?? '')}</td>${cell(k)}</tr>`).join('');
  const compare = TIERS.map((t) => {
    const a = buyerLine(s, t, view.nowSec);
    const b = buyerLine(d, t, view.nowSec);
    return `<span class="muted">${TIER_NAMES[t]}</span><span>${esc(`${a.text} (${a.note})`)}</span><b>${esc(`${b.text} (${b.note})`)}</b>`;
  }).join('');
  const pages = view.pages
    .map((p) => `<li>${esc(`${TIER_NAMES[p.tier as 'individual']}, ${PROVIDER_NAMES[p.provider]} (set${p.sets.length > 1 ? 's' : ''} ${p.sets.join(', ')}): `)}<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open ↗</a></li>`)
    .join('');
  const blocked = view.failed > 0;
  const body = `<div class="ck"><div><h1>Review changes</h1><p class="sub" style="margin:0">${esc(view.product.name)} (${MODE_NAMES[view.mode]}). Nothing is saved until you click Save changes.</p></div>
${view.error ? `<p class="notice stop" role="alert">${esc(view.error)}</p>` : ''}
${view.mode === 'test' ? '<p class="notice test">Test mode: sandbox links. In Test a failed check is a warning only.</p>' : ''}
${status ? `<p class="notice${view.warned ? ' test' : ' good'}" role="status">${esc(status)}</p>` : ''}
${blocked ? `<p class="notice stop" role="alert">${esc(`${plural(view.failed, 'link')} of ${n} failed the check, so these changes cannot be saved. Go back to editing to fix ${view.failed === 1 ? 'it' : 'them'}, or discard the changes.`)}</p>` : ''}
<section class="card"><h2>Changes</h2><div class="tbl"><table><thead><tr><th>Change</th><th>Before → after</th><th>Check with the provider</th></tr></thead><tbody>${rows}</tbody></table></div>
${also.length ? `<h2>Also checked: links buyers will get</h2><div class="tbl"><table><tbody>${alsoRows}</tbody></table></div>` : ''}
<h2>Buyers get</h2><div class="cmp"><span></span><span class="h">Now</span><span class="h">After you save</span>${compare}</div></section>
<form method="post" action="/admin/checkout" class="card" novalidate>
<input type="hidden" name="product" value="${view.product.id}"><input type="hidden" name="mode" value="${view.mode}"><input type="hidden" name="version" value="${view.version}">
<input type="hidden" name="draft" value="${esc(JSON.stringify(d))}"><input type="hidden" name="results" value="${esc(JSON.stringify(view.results))}"><input type="hidden" name="token" value="${esc(view.token)}">
<button type="submit" name="intent" value="${blocked ? 'back' : 'save'}" class="offscreen" tabindex="-1" aria-hidden="true">Submit</button>
<div class="fld"><label for="reason">Reason (kept in the change history)</label><input type="text" name="reason" id="reason" value="${esc(view.reason)}" maxlength="500" placeholder="e.g. Black Friday promotion, 28 Nov to 2 Dec"${view.reasonError ? ' class="bad"' : ''}>${view.reasonError ? `<p class="err">${esc(view.reasonError)}</p>` : ''}</div>
${view.needConfirm ? `<div class="confirm"><label><input type="checkbox" name="confirm" id="confirm"><span>I opened these checkout pages and they work. <span class="muted">Needed in Live when what buyers get changes.</span></span></label><ul>${pages}</ul>${view.confirmError ? `<p class="err">${esc(view.confirmError)}</p>` : ''}</div>` : ''}
<div class="acts"><button type="submit" name="intent" value="save" class="primary"${blocked ? ' disabled' : ''}>Save changes</button><button type="submit" name="intent" value="back">Back to editing</button></div>
</form></div>`;
  return layout('Review checkout changes', 'checkout', body, { css: CSS });
}
