// Request handlers for finding and deleting trial records: the /admin/records page (HTML forms) and the admin JSON API
// POST /api/<product>/records/v1/{search|delete}. Both use the admin login, refuse requests that come from another
// site, and share the data layer in records.ts, so a deletion is audited the same way whichever door it came through.

import { productById, PINCHPDF, type ProductSpec } from '../trial/product';
import { plain } from '../trial/responses';
import { ADMIN_HEADERS, guardAdmin, isSameOrigin } from './auth';
import type { AdminRuntimeEnv } from './handlers';
import { ADMIN_CSP } from './pages';
import { isProductChoice, type ProductChoice } from './range';
import { renderRecords, type RecordsView } from './records-page';
import {
  DELETE_ACTIONS,
  cleanQuery,
  cleanReason,
  deleteRecord,
  isTrialId,
  searchRecords,
  MAX_RESULTS,
  MIN_QUERY_LENGTH,
  type DeleteAction,
  type RecordsEnv,
  type TrialRecord,
} from './records';
import { missingSources, sourcesFor } from './sources';

export type RecordsRuntimeEnv = AdminRuntimeEnv & RecordsEnv;

const MAX_BODY_BYTES = 4096;

function page(view: RecordsView, status = 200): Response {
  return new Response(renderRecords(view), {
    status,
    headers: { ...ADMIN_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': ADMIN_CSP },
  });
}

const emptyView = (product: ProductChoice): RecordsView => ({ product, query: '', results: null, truncated: false, capped: false, notice: null, error: null, missing: [] });

const configured = (env: RecordsRuntimeEnv) => Boolean(env.PII_KEY && env.PEPPER_EMAIL);

/** Reads a small request body as text, or null when it is too large. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const bytes = await request.arrayBuffer();
  return bytes.byteLength > MAX_BODY_BYTES ? null : new TextDecoder().decode(bytes);
}

type Searched = { results: TrialRecord[]; truncated: boolean; capped: boolean };

/** Searches every selected product's database and merges the answers, newest first. */
async function searchProducts(env: RecordsRuntimeEnv, choice: ProductChoice, query: string, nowSec: number, operator: string): Promise<Searched> {
  const parts = await Promise.all(sourcesFor(env, choice).map((s) => searchRecords(env, s.db, s.product, query, nowSec, operator)));
  const merged = parts.flatMap((p) => p.results).sort((a, b) => b.created_at - a.created_at);
  return { results: merged.slice(0, MAX_RESULTS), truncated: parts.some((p) => p.truncated) || merged.length > MAX_RESULTS, capped: parts.some((p) => p.capped) };
}

function productFor(env: RecordsRuntimeEnv, id: string): { product: ProductSpec; db: D1Database } | null {
  const spec = productById(id);
  return spec ? (sourcesFor(env, spec.id)[0] ?? null) : null;
}

// ------------------------------------------------------------------ /admin/records

export async function handleAdminRecords(request: Request, env: RecordsRuntimeEnv, nowMs: number = Date.now()): Promise<Response> {
  const blocked = await guardAdmin(request, env);
  if (blocked) return blocked;

  if (request.method === 'GET') {
    const raw = new URL(request.url).searchParams.get('product');
    const choice = isProductChoice(raw) ? raw : 'all';
    return page({ ...emptyView(choice), missing: missingSources(env, choice).map((p) => p.name) });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { ...ADMIN_HEADERS, Allow: 'GET, POST' } });
  if (!isSameOrigin(request)) return new Response('Forbidden', { status: 403, headers: ADMIN_HEADERS });

  const body = await readBody(request);
  const form = body === null ? null : new URLSearchParams(body);
  const field = (name: string) => form?.get(name) ?? '';
  const rawView = field('view') || field('product');
  const choice: ProductChoice = isProductChoice(rawView) ? rawView : 'all';
  const view = (extra: Partial<RecordsView>): RecordsView => ({ ...emptyView(choice), missing: missingSources(env, choice).map((p) => p.name), ...extra });
  if (form === null) return page(view({ error: 'That request was too large.' }), 400);
  if (!configured(env)) return page(view({ error: 'The trial secrets (PII_KEY, PEPPER_EMAIL) are not available here, so records cannot be opened.' }), 503);
  const nowSec = Math.floor(nowMs / 1000);

  try {
    if (form.has('action')) {
      const action = field('action') as DeleteAction;
      const target = productFor(env, field('product'));
      const reason = cleanReason(field('reason'));
      const id = field('id');
      if (!DELETE_ACTIONS.includes(action) || !target || !isTrialId(id)) return page(view({ error: 'That request was not understood.' }), 400);
      if (!reason) return page(view({ error: 'Give a reason of 3 to 500 characters.' }), 400);
      const result = await deleteRecord(target.db, target.product, { id, action, reason, operator: 'admin-ui', nowSec, confirmRef: field('confirm') });
      if (result.outcome === 'not_found') return page(view({ error: 'That record no longer exists.' }), 404);
      if (result.outcome === 'confirm_mismatch') return page(view({ error: 'The support reference you typed does not match. Nothing was changed.' }), 400);
      const what = action === 'delete' ? 'Deleted' : 'Erased the name and email of';
      return page(view({ notice: `${what} record ${result.support_ref} (${target.product.name}). It is in the audit log.` }));
    }

    const query = cleanQuery(field('q'));
    if (!query) return page(view({ query: field('q').slice(0, 100), error: `Type at least ${MIN_QUERY_LENGTH} characters.` }), 400);
    if (sourcesFor(env, choice).length === 0) return page(view({ query, error: 'The database for this product is not configured here.' }), 503);
    const found = await searchProducts(env, choice, query, nowSec, 'admin-ui');
    return page(view({ query, ...found }));
  } catch (cause) {
    console.error(JSON.stringify({ svc: 'admin', result: 'records_failed', message: String((cause as Error)?.message).slice(0, 120) }));
    return page(view({ error: 'Records could not be loaded. Check that the database migrations are applied.' }), 503);
  }
}

// ------------------------------------------------------------------ /api/<product>/records/v1

type Parsed = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

async function parseJson(request: Request): Promise<Parsed> {
  const bad = (message: string, status = 400): Parsed => ({ ok: false, response: plain(status, { error: 'bad_request', message }, ADMIN_HEADERS) });
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return bad('Send Content-Type: application/json.', 415);
  const text = await readBody(request);
  if (text === null) return bad('The body is too large.', 413);
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, body: value as Record<string, unknown> } : bad('The body must be a JSON object.');
  } catch {
    return bad('The body is not valid JSON.');
  }
}

async function guardApi(request: Request, env: RecordsRuntimeEnv, product: ProductSpec): Promise<{ response: Response } | { body: Record<string, unknown>; db: D1Database }> {
  const blocked = await guardAdmin(request, env);
  if (blocked) return { response: blocked };
  if (!isSameOrigin(request)) return { response: plain(403, { error: 'forbidden' }, ADMIN_HEADERS) };
  const source = sourcesFor(env, product.id)[0];
  if (!source || !configured(env)) return { response: plain(503, { error: 'unavailable' }, { ...ADMIN_HEADERS, 'Retry-After': '30' }) };
  const parsed = await parseJson(request);
  if (!parsed.ok) return { response: parsed.response };
  return { body: parsed.body, db: source.db };
}

const unavailable = () => plain(503, { error: 'unavailable' }, { ...ADMIN_HEADERS, 'Retry-After': '30' });
const logFailure = (endpoint: string, cause: unknown) =>
  console.error(JSON.stringify({ svc: 'admin', endpoint, result: 'db_error', message: String((cause as Error)?.message).slice(0, 120) }));

/** POST /api/<product>/records/v1/search with { "q": "..." }. */
export async function handleRecordsSearchApi(request: Request, env: RecordsRuntimeEnv, nowMs: number = Date.now(), product: ProductSpec = PINCHPDF): Promise<Response> {
  if (request.method !== 'POST') return plain(405, { error: 'method_not_allowed' }, { ...ADMIN_HEADERS, Allow: 'POST' });
  const guarded = await guardApi(request, env, product);
  if ('response' in guarded) return guarded.response;
  const query = cleanQuery(guarded.body.q);
  if (!query) return plain(400, { error: 'bad_request', message: `q must be ${MIN_QUERY_LENGTH} to 100 printable characters.` }, ADMIN_HEADERS);
  try {
    const found = await searchRecords(env, guarded.db, product, query, Math.floor(nowMs / 1000), 'admin-api');
    return plain(200, { product: product.id, query, count: found.results.length, truncated: found.truncated, capped: found.capped, results: found.results }, ADMIN_HEADERS);
  } catch (cause) {
    logFailure('records_search', cause);
    return unavailable();
  }
}

/** POST /api/<product>/records/v1/delete with { "id", "action": "erase_contact" | "delete", "reason" }. */
export async function handleRecordsDeleteApi(request: Request, env: RecordsRuntimeEnv, nowMs: number = Date.now(), product: ProductSpec = PINCHPDF): Promise<Response> {
  if (request.method !== 'POST') return plain(405, { error: 'method_not_allowed' }, { ...ADMIN_HEADERS, Allow: 'POST' });
  const guarded = await guardApi(request, env, product);
  if ('response' in guarded) return guarded.response;
  const { id, action, reason: rawReason } = guarded.body;
  const reason = cleanReason(rawReason);
  if (!isTrialId(id) || typeof action !== 'string' || !(DELETE_ACTIONS as readonly string[]).includes(action)) {
    return plain(400, { error: 'bad_request', message: 'id must be a trial id and action must be erase_contact or delete.' }, ADMIN_HEADERS);
  }
  if (!reason) return plain(400, { error: 'bad_request', message: 'reason must be 3 to 500 printable characters.' }, ADMIN_HEADERS);
  try {
    const result = await deleteRecord(guarded.db, product, { id, action: action as DeleteAction, reason, operator: 'admin-api', nowSec: Math.floor(nowMs / 1000) });
    if (result.outcome !== 'done') return plain(404, { error: 'not_found' }, ADMIN_HEADERS);
    return plain(200, { ok: true, product: product.id, id, action, support_ref: result.support_ref }, ADMIN_HEADERS);
  } catch (cause) {
    logFailure('records_delete', cause);
    return unavailable();
  }
}
