// HTML for /admin/records: search free-trial records by name, email, support reference or trial id, then erase the
// contact data or delete the record. Server-rendered with no scripts. Search and deletion are POST forms, so a name or
// an email never appears in a URL, a server log or the browser history.

import { esc } from './charts';
import { layout } from './pages';
import { PRODUCTS, type ProductChoice } from './range';
import { MAX_RESULTS, MIN_QUERY_LENGTH, SEARCH_SCAN_LIMIT, type TrialRecord } from './records';

const CSS = `
.find{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:0 0 14px}.find .grow{flex:1;min-width:220px}
.find label,.del label{display:block;font-size:12px;color:var(--ink2);margin:0 0 3px}
input[type=text],input[type=search],select{font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);width:100%}
select{width:auto}
.ok{background:var(--accent-bg);color:var(--accent);border-radius:8px;padding:8px 12px;font-size:13px;margin:0 0 12px}
.rec h2{font-size:15px;margin:0}.rec .who{color:var(--ink2);font-size:13px;margin:0 0 6px;word-break:break-all}
.meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--ink2);margin:0 0 8px}
.pill{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;background:var(--neutral);color:var(--ink2)}
details.del{margin-top:8px;border-top:1px solid var(--line);padding-top:8px}details.del summary{cursor:pointer;font-size:13px;color:var(--danger)}
.del form{display:grid;gap:10px;margin-top:10px}.del p{font-size:12px;color:var(--ink2);margin:0}
.acts{display:flex;flex-wrap:wrap;gap:8px}.danger{border-color:var(--danger);color:var(--danger)}
`;

export type RecordsView = {
  /** Which product(s) the search covers. */
  product: ProductChoice;
  query: string;
  /** null before any search. */
  results: TrialRecord[] | null;
  truncated: boolean;
  capped: boolean;
  /** Green message after an action. */
  notice: string | null;
  error: string | null;
  /** Products whose database is not available, named so the page does not silently show less. */
  missing: string[];
};

const dateTime = (seconds: number) => new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const productName = (id: string) => PRODUCTS.find((p) => p.id === id)?.name ?? id;

function usage(record: TrialRecord): string {
  if (!record.modes) return `${record.used} of ${record.limit_total} uses`;
  const { used, limit } = record.modes;
  return `Basic ${used.basic}/${limit.basic}, Similar ${used.similar}/${limit.similar}, Deep ${used.deep}/${limit.deep}`;
}

function recordCard(record: TrialRecord, view: RecordsView): string {
  const hasContact = record.name !== null || record.email !== null;
  const heading = record.name ? esc(record.name) : '<span class="muted">No name stored</span>';
  const email = record.email ? esc(record.email) : 'No email stored';
  return `<article class="card rec">
<h2>${heading}</h2><p class="who">${email}</p>
<div class="meta"><span class="pill">${esc(productName(record.product))}</span><span>Reference <b>${esc(record.support_ref)}</b></span><span>${esc(record.status)}</span><span>${esc(usage(record))}</span><span>Registered ${esc(dateTime(record.created_at))}</span><span>Last contact ${esc(dateTime(record.last_server_contact_at))}</span></div>
<details class="del"><summary>Erase or delete this record</summary>
<form method="post" action="/admin/records">
<input type="hidden" name="product" value="${esc(record.product)}"><input type="hidden" name="view" value="${esc(view.product)}"><input type="hidden" name="id" value="${esc(record.id)}">
<p><b>Erase name and email</b> removes the personal data and keeps the row, so the computer keeps its used scans and cannot start another free trial.${hasContact ? '' : ' (Nothing to erase here: no name or email is stored.)'}</p>
<p><b>Delete whole record</b> removes the row, including the device hashes. That computer can then register a new free trial. Telemetry events (no name or email) are not touched.</p>
<div><label for="reason-${esc(record.id)}">Reason (kept in the audit log)</label><input type="text" id="reason-${esc(record.id)}" name="reason" required minlength="3" maxlength="500" placeholder="e.g. deletion request received by email"></div>
<div><label for="confirm-${esc(record.id)}">Type the support reference <b>${esc(record.support_ref)}</b> to confirm</label><input type="text" id="confirm-${esc(record.id)}" name="confirm" required autocomplete="off" maxlength="8" style="max-width:160px"></div>
<div class="acts"><button type="submit" name="action" value="erase_contact">Erase name and email</button><button type="submit" name="action" value="delete" class="danger">Delete whole record</button></div>
</form></details>
</article>`;
}

export function renderRecords(view: RecordsView): string {
  const options = [...PRODUCTS.map((p) => ({ id: p.id as ProductChoice, name: p.name })), { id: 'all' as ProductChoice, name: 'All products' }]
    .map((p) => `<option value="${p.id}"${p.id === view.product ? ' selected' : ''}>${esc(p.name)}</option>`)
    .join('');

  const parts: string[] = [];
  parts.push('<h1>Records</h1><p class="sub">Find a free-trial record by name, email, support reference or trial id. Use it to answer deletion requests (Privacy 10.6). Opening a record is written to the audit log.</p>');
  if (view.notice) parts.push(`<p class="ok" role="status">${esc(view.notice)}</p>`);
  if (view.error) parts.push(`<p class="err" role="alert">${esc(view.error)}</p>`);
  if (view.missing.length > 0) parts.push(`<p class="notice">The ${esc(view.missing.join(' and '))} database is not available here, so it is not searched.</p>`);

  parts.push(`<form class="find" method="post" action="/admin/records">
<input type="hidden" name="intent" value="search">
<div><label for="product">Product</label><select id="product" name="product">${options}</select></div>
<div class="grow"><label for="q">Name, email, reference or trial id</label><input type="search" id="q" name="q" value="${esc(view.query)}" minlength="${MIN_QUERY_LENGTH}" maxlength="100" required autocomplete="off" autofocus></div>
<button type="submit">Search</button>
</form>`);

  if (view.results === null) {
    parts.push(`<p class="muted">Type at least ${MIN_QUERY_LENGTH} characters. A full email address is looked up exactly; a name or part of an email matches anywhere in it.</p>`);
  } else if (view.results.length === 0) {
    parts.push('<p class="muted">No record matches. An erased record has no name or email left to find: search by its support reference or trial id.</p>');
  } else {
    const count = view.truncated ? `Showing the first ${MAX_RESULTS} matches. Narrow the search to see others.` : `${view.results.length} match${view.results.length === 1 ? '' : 'es'}.`;
    parts.push(`<p class="muted">${esc(count)}</p>`);
    parts.push(view.results.map((r) => recordCard(r, view)).join('\n'));
  }
  if (view.capped) parts.push(`<p class="notice">Only the newest ${SEARCH_SCAN_LIMIT.toLocaleString('en-US')} records of a product were searched. For an older record, search the full email address.</p>`);

  return layout('Records', 'records', parts.join('\n'), { css: CSS });
}
