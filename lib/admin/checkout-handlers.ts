// /admin/checkout: edit where the Buy buttons send buyers. Same login, same-site check and no-script rules as the other
// admin pages. Every action is a form post with an `intent`:
//
//   review      validate, check the touched links with the providers, answer with the review page (default button)
//   save        only from the review page: re-validate, confirm the review is genuine and recent, save, record history
//   back        from the review page to the editor, keeping the changes
//   check       check every link with the providers, save nothing
//   add | remove:<n> | clear:<n>   change the list of sets or a set's dates, save nothing
//
// The review page carries the draft and the check results back in hidden fields, with an HMAC (keyed from the admin
// password) over them. So Save cannot skip the check, and the history records what the server itself found.

import { allLinkKeys, buyersChange, diffConfigs, linkAt, linksToCheck, pagesToConfirm } from '../checkout/changes';
import {
  MAX_SETS,
  MODE_NAMES,
  PROVIDERS,
  allUrls,
  emptySet,
  errorCount,
  errorsInSet,
  isMode,
  isProvider,
  isTier,
  otherMode,
  parseConfig,
  validateConfig,
  type CheckoutConfig,
  type ConfigErrors,
  type LinkSet,
  type Mode,
} from '../checkout/config';
import { linksAnswer } from '../checkout/handler';
import { loadBoth, recentAudit, recordScheduleEvents, saveConfig, type Stored } from '../checkout/store';
import { verifyLink, type Fetcher } from '../checkout/verify';
import { b64urlEncode, utf8 } from '../trial/bytes';
import { PINCHPDF, productById, productDb, type ProductSpec } from '../trial/product';
import { ADMIN_HEADERS, guardAdmin, isSameOrigin } from './auth';
import { renderCheckoutEditor, renderCheckoutReview, type EditorView, type ReviewView, type ShownResult } from './checkout-page';
import type { AdminRuntimeEnv } from './handlers';
import { ADMIN_CSP } from './pages';
import { cleanReason } from './records';

export type CheckoutAdminEnv = AdminRuntimeEnv;

const MAX_BODY_BYTES = 65_536;
const REVIEW_TTL_SECONDS = 30 * 60;

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { ...ADMIN_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': ADMIN_CSP } });
}

const simplePage = (message: string, status: number) => html(`<!doctype html><title>Checkout links</title><p>${message}</p>`, status);

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const bytes = await request.arrayBuffer();
  return bytes.byteLength > MAX_BODY_BYTES ? null : new TextDecoder().decode(bytes);
}

// ------------------------------------------------------------------ reading the editor form

const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

/** A datetime-local value, read as UTC. undefined = not a valid date and time. */
function parseDate(raw: string | null): number | null | undefined {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const m = value.match(DATETIME);
  if (!m) return undefined;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 16) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` ? ms / 1000 : undefined;
}

function draftFromForm(form: URLSearchParams, saved: CheckoutConfig): { draft: CheckoutConfig; badDates: number[] } {
  const count = Math.min(MAX_SETS, Math.max(1, Number.parseInt(form.get('sets') ?? '1', 10) || 1));
  const badDates: number[] = [];
  const sets: LinkSet[] = [];
  for (let i = 0; i < count; i += 1) {
    const set = emptySet(i === 0 ? (saved.sets[0]?.name ?? 'Standard') : (form.get(`name.${i}`) ?? '').trim().slice(0, 200));
    if (i > 0) {
      const starts = parseDate(form.get(`starts.${i}`));
      const ends = parseDate(form.get(`ends.${i}`));
      if (starts === undefined || ends === undefined) badDates.push(i);
      set.starts_at = starts ?? null;
      set.ends_at = ends ?? null;
    }
    for (const provider of PROVIDERS) {
      set.links[provider].forEach((row, r) => {
        const type = form.get(`type.${i}.${provider}.${r}`);
        if (isTier(type)) row.type = type;
        row.url = (form.get(`url.${i}.${provider}.${r}`) ?? '').trim().slice(0, 2048);
      });
    }
    sets.push(set);
  }
  const primary = form.get('primary');
  const def = Number.parseInt(form.get('default_set') ?? '0', 10);
  return {
    draft: { primary: isProvider(primary) ? primary : saved.primary, force: form.get('force') === 'on', default_set: def >= 0 && def < count ? def : 0, sets },
    badDates,
  };
}

/** Check results the page carries between posts. Display only: Save trusts them only under a valid review token. */
function resultsFromForm(raw: string | null): Record<string, ShownResult> {
  const out: Record<string, ShownResult> = {};
  try {
    const value = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    if (!value || typeof value !== 'object') return out;
    for (const [key, r] of Object.entries(value).slice(0, 32)) {
      if (!/^[0-3]\.(dodo|lemon_squeezy)\.[01]$/.test(key) || !r || typeof r !== 'object') continue;
      const { ok, warn, text, url, type } = r as Record<string, unknown>;
      if (typeof ok !== 'boolean' || typeof text !== 'string' || typeof url !== 'string' || typeof type !== 'string') continue;
      out[key] = { ok, ...(warn === true ? { warn: true } : {}), text: text.slice(0, 400), url: url.slice(0, 2048), type: type.slice(0, 16) };
    }
  } catch {
    // ignore: results are only shown, never trusted
  }
  return out;
}

// ------------------------------------------------------------------ the review token

async function mac(env: CheckoutAdminEnv, parts: string[]): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8(`tws-checkout-review-v1|${env.ADMIN_PASSWORD ?? ''}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(parts.join('\n')))));
}

const tokenParts = (product: ProductSpec, mode: Mode, version: number, issued: number, passed: boolean, draftJson: string, resultsJson: string) => [
  product.id,
  mode,
  String(version),
  String(issued),
  passed ? '1' : '0',
  draftJson,
  resultsJson,
];

async function issueToken(env: CheckoutAdminEnv, product: ProductSpec, mode: Mode, version: number, nowSec: number, passed: boolean, draftJson: string, resultsJson: string): Promise<string> {
  return `${nowSec}.${passed ? 1 : 0}.${await mac(env, tokenParts(product, mode, version, nowSec, passed, draftJson, resultsJson))}`;
}

async function tokenValid(env: CheckoutAdminEnv, token: string, product: ProductSpec, mode: Mode, version: number, nowSec: number, draftJson: string, resultsJson: string): Promise<'ok' | 'expired' | 'invalid' | 'failed'> {
  const m = token.match(/^(\d{1,12})\.([01])\.([A-Za-z0-9_-]{43})$/);
  if (!m) return 'invalid';
  const issued = Number(m[1]);
  const expected = await mac(env, tokenParts(product, mode, version, issued, m[2] === '1', draftJson, resultsJson));
  if (expected.length !== m[3].length) return 'invalid';
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ m[3].charCodeAt(i);
  if (diff !== 0) return 'invalid';
  if (nowSec - issued > REVIEW_TTL_SECONDS || issued > nowSec + 60) return 'expired';
  return mode === 'live' && m[2] !== '1' ? 'failed' : 'ok';
}

// ------------------------------------------------------------------ checks

async function runChecks(product: ProductSpec, mode: Mode, draft: CheckoutConfig, keys: string[], fetcher?: Fetcher): Promise<Record<string, ShownResult>> {
  const entries = await Promise.all(
    keys.map(async (key) => {
      const link = linkAt(draft, key)!;
      const result = await verifyLink(product.id, mode, link.type, link.provider, link.url, fetcher);
      return [key, { ...result, url: link.url, type: link.type }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

// ------------------------------------------------------------------ the handler

type Context = {
  env: CheckoutAdminEnv;
  db: D1Database;
  product: ProductSpec;
  mode: Mode;
  nowSec: number;
  both: Record<Mode, Stored>;
  fetcher?: Fetcher;
};

function validate(ctx: Context, draft: CheckoutConfig, badDates: number[] = []): ConfigErrors {
  const errors = validateConfig(ctx.product.id, ctx.mode, draft, ctx.both[ctx.mode].config, allUrls(ctx.both[otherMode(ctx.mode)].config), ctx.nowSec);
  for (const i of badDates) errors.dates[i] = 'Enter a date and time (UTC), or leave it empty.';
  return errors;
}

async function editor(ctx: Context, draft: CheckoutConfig, extra: { version?: number; results?: Record<string, ShownResult>; open?: number[]; notice?: string | null; error?: string | null; badDates?: number[]; status?: number } = {}): Promise<Response> {
  const saved = ctx.both[ctx.mode];
  const errors = validate(ctx, draft, extra.badDates);
  const results = extra.results ?? {};
  const failedSets = Object.entries(results).filter(([, r]) => !r.ok).map(([k]) => Number(k.split('.')[0]));
  const open = [...new Set([0, ...(extra.open ?? []), ...draft.sets.map((_, i) => i).filter((i) => errorsInSet(errors, i) > 0), ...failedSets])].filter((i) => i < draft.sets.length);
  const view: EditorView = {
    product: ctx.product,
    mode: ctx.mode,
    nowSec: ctx.nowSec,
    saved,
    draft,
    version: extra.version ?? saved.version,
    errors,
    results,
    open,
    dirtyCount: diffConfigs(saved.config, draft).length,
    notice: extra.notice ?? null,
    error: extra.error ?? null,
    history: await recentAudit(ctx.db),
    answer: linksAnswer(ctx.product, ctx.mode, saved.config, saved.updatedAt, ctx.nowSec),
  };
  return html(renderCheckoutEditor(view), extra.status ?? 200);
}

function countResults(results: Record<string, ShownResult>, keys: string[]) {
  let failed = 0;
  let warned = 0;
  for (const key of keys) {
    const r = results[key];
    if (r && !r.ok) {
      if (r.warn) warned += 1;
      else failed += 1;
    }
  }
  return { failed, warned };
}

function reviewView(ctx: Context, draft: CheckoutConfig, version: number, results: Record<string, ShownResult>, token: string, extra: Partial<ReviewView> = {}): ReviewView {
  const saved = ctx.both[ctx.mode].config;
  const checked = Object.keys(results);
  const { failed, warned } = countResults(results, checked);
  const needConfirm = ctx.mode === 'live' && buyersChange(saved, draft, ctx.nowSec);
  return {
    product: ctx.product,
    mode: ctx.mode,
    nowSec: ctx.nowSec,
    saved: ctx.both[ctx.mode],
    draft,
    version,
    changes: diffConfigs(saved, draft),
    checked,
    results,
    failed,
    warned,
    token,
    needConfirm,
    pages: needConfirm ? pagesToConfirm(saved, draft, ctx.nowSec) : [],
    reason: '',
    reasonError: null,
    confirmError: null,
    error: null,
    ...extra,
  };
}

async function review(ctx: Context, draft: CheckoutConfig, version: number, badDates: number[]): Promise<Response> {
  const saved = ctx.both[ctx.mode].config;
  const errors = validate(ctx, draft, badDates);
  const problems = errorCount(errors);
  if (problems > 0) {
    return editor(ctx, draft, { version, badDates, error: `${problems === 1 ? 'Fix the problem' : `Fix the ${problems} problems`} marked in red first. Sets with a problem are open below.`, status: 400 });
  }
  if (diffConfigs(saved, draft).length === 0) return editor(ctx, draft, { version, notice: 'There are no changes to save.' });
  const keys = linksToCheck(saved, draft, ctx.nowSec);
  const results = await runChecks(ctx.product, ctx.mode, draft, keys, ctx.fetcher);
  const { failed } = countResults(results, keys);
  const draftJson = JSON.stringify(draft);
  const resultsJson = JSON.stringify(results);
  const token = await issueToken(ctx.env, ctx.product, ctx.mode, version, ctx.nowSec, failed === 0, draftJson, resultsJson);
  return html(renderCheckoutReview(reviewView(ctx, draft, version, results, token)));
}

async function save(ctx: Context, form: URLSearchParams, version: number): Promise<Response> {
  const draftJson = form.get('draft') ?? '';
  const resultsJson = form.get('results') ?? '{}';
  let draft: CheckoutConfig | null = null;
  try {
    draft = parseConfig(JSON.parse(draftJson));
  } catch {
    draft = null;
  }
  if (!draft) return editor(ctx, ctx.both[ctx.mode].config, { error: 'That request was not understood. Nothing was saved.', status: 400 });
  const results = resultsFromForm(resultsJson);
  const token = form.get('token') ?? '';
  const verdict = await tokenValid(ctx.env, token, ctx.product, ctx.mode, version, ctx.nowSec, draftJson, resultsJson);
  if (verdict === 'invalid') return editor(ctx, draft, { version, results, error: 'This review could not be confirmed. Nothing was saved. Review the changes again.', status: 400 });
  if (verdict === 'expired') return editor(ctx, draft, { version, results, error: 'This review is more than 30 minutes old. Nothing was saved. Review the changes again, so the links are checked again.', status: 400 });
  if (verdict === 'failed') return editor(ctx, draft, { version, results, error: 'A link failed the check, so these changes cannot be saved in Live. Fix it and review again.', status: 400 });

  const errors = validate(ctx, draft);
  if (errorCount(errors) > 0) return editor(ctx, draft, { version, results, error: 'The changes no longer pass the rules (a date may have passed). Nothing was saved. Fix them and review again.', status: 400 });

  const saved = ctx.both[ctx.mode];
  const reason = cleanReason(form.get('reason'));
  const needConfirm = ctx.mode === 'live' && buyersChange(saved.config, draft, ctx.nowSec);
  const confirmed = form.get('confirm') === 'on';
  if (!reason || (needConfirm && !confirmed)) {
    return html(
      renderCheckoutReview(
        reviewView(ctx, draft, version, results, token, {
          reason: (form.get('reason') ?? '').slice(0, 500),
          reasonError: reason ? null : 'Give a reason of 3 to 500 characters.',
          confirmError: needConfirm && !confirmed ? 'Open the pages above, then tick the box.' : null,
        }),
      ),
      400,
    );
  }

  const changes = diffConfigs(saved.config, draft);
  const audit = changes.map((c) => {
    const r = c.key ? results[c.key] : undefined;
    const checked = r ? `${r.ok ? 'verified' : 'check failed, saved in Test'}: ${r.text}` : '';
    return { operator: 'admin-ui', change: c.change, before: c.before, after: c.after, checked, reason };
  });
  const outcome = await saveConfig(ctx.db, ctx.mode, draft, version, ctx.nowSec, audit);
  if (outcome === 'stale') {
    const fresh = await loadBoth(ctx.db, ctx.product.id);
    return editor(
      { ...ctx, both: fresh },
      draft,
      {
        version: fresh[ctx.mode].version,
        results,
        error: 'Someone saved this tab after you opened it, so nothing was saved. Your changes are still below: review them again to save them over the newer setting, or click Discard changes to see it.',
        status: 409,
      },
    );
  }
  console.log(JSON.stringify({ svc: 'admin', result: 'checkout_saved', product: ctx.product.id, mode: ctx.mode, changes: changes.length, checked: Object.keys(results).length }));
  const location = `/admin/checkout?product=${ctx.product.id}&mode=${ctx.mode}&saved=${changes.length}&checked=${Object.keys(results).length}`;
  return new Response(null, { status: 303, headers: { ...ADMIN_HEADERS, Location: location } });
}

export async function handleAdminCheckout(request: Request, env: CheckoutAdminEnv, nowMs: number = Date.now(), fetcher?: Fetcher): Promise<Response> {
  const blocked = await guardAdmin(request, env);
  if (blocked) return blocked;
  if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { ...ADMIN_HEADERS, Allow: 'GET, POST' } });
  if (request.method === 'POST' && !isSameOrigin(request)) return new Response('Forbidden', { status: 403, headers: ADMIN_HEADERS });

  let form = new URL(request.url).searchParams;
  if (request.method === 'POST') {
    const body = await readBody(request);
    if (body === null) return simplePage('That request was too large.', 413);
    form = new URLSearchParams(body);
  }
  const product = productById(form.get('product') ?? '') ?? PINCHPDF;
  const rawMode = form.get('mode');
  const mode: Mode = isMode(rawMode) ? rawMode : 'live';
  const db = productDb(env as Parameters<typeof productDb>[0], product);
  if (!db) return simplePage(`The ${product.name} database is not configured here.`, 503);
  const nowSec = Math.floor(nowMs / 1000);

  try {
    const both = await loadBoth(db, product.id);
    const ctx: Context = { env, db, product, mode, nowSec, both, fetcher };
    const saved = both[mode];

    if (request.method === 'GET') {
      await recordScheduleEvents(db, both, nowSec);
      const count = Number(form.get('saved'));
      const checked = Number(form.get('checked'));
      const notice =
        Number.isInteger(count) && count > 0
          ? `Saved ${count} change${count === 1 ? '' : 's'} to ${product.name} (${MODE_NAMES[mode]})${checked > 0 ? `, after checking ${checked} link${checked === 1 ? '' : 's'} with the providers` : ''}. The website uses them within a minute; the apps the next time the Upgrade window opens.`
          : null;
      return editor(ctx, saved.config, { notice });
    }

    const intent = form.get('intent') ?? 'review';
    const version = Number.parseInt(form.get('version') ?? '', 10);
    const knownVersion = Number.isInteger(version) && version >= 0 ? version : saved.version;

    if (intent === 'save') return await save(ctx, form, knownVersion);
    if (intent === 'back') {
      let draft: CheckoutConfig | null = null;
      try {
        draft = parseConfig(JSON.parse(form.get('draft') ?? ''));
      } catch {
        draft = null;
      }
      return editor(ctx, draft ?? saved.config, { version: knownVersion, results: resultsFromForm(form.get('results')) });
    }

    const { draft, badDates } = draftFromForm(form, saved.config);
    const results = resultsFromForm(form.get('results'));
    if (intent === 'add') {
      if (draft.sets.length < MAX_SETS) draft.sets.push(emptySet());
      return editor(ctx, draft, { version: knownVersion, results, badDates, open: [draft.sets.length - 1] });
    }
    const target = Number(intent.split(':')[1]);
    if (intent.startsWith('remove:') && Number.isInteger(target) && target > 0 && target < draft.sets.length && target !== draft.default_set) {
      draft.sets.splice(target, 1);
      if (draft.default_set > target) draft.default_set -= 1;
      return editor(ctx, draft, { version: knownVersion, badDates: badDates.filter((i) => i < target).concat(badDates.filter((i) => i > target).map((i) => i - 1)) });
    }
    if (intent.startsWith('clear:') && Number.isInteger(target) && target > 0 && target < draft.sets.length) {
      draft.sets[target].starts_at = null;
      draft.sets[target].ends_at = null;
      return editor(ctx, draft, { version: knownVersion, results, badDates: badDates.filter((i) => i !== target), open: [target] });
    }
    if (intent === 'check') {
      const errors = validate(ctx, draft, badDates);
      const keys = allLinkKeys(draft).filter((key) => !errors.fields[key]);
      if (keys.length === 0) return editor(ctx, draft, { version: knownVersion, badDates, error: 'There are no links to check on this tab.' });
      const checked = await runChecks(product, mode, draft, keys, fetcher);
      const bad = Object.values(checked).filter((r) => !r.ok).length;
      return editor(ctx, draft, {
        version: knownVersion,
        badDates,
        results: checked,
        ...(bad
          ? { error: `${bad} of ${keys.length} links failed the check. The sets with a failed link are open below. Nothing was saved.` }
          : { notice: `All ${keys.length} links are real checkout pages for ${product.name} and match their license type. Nothing was saved.` }),
      });
    }
    return await review(ctx, draft, knownVersion, badDates);
  } catch (cause) {
    console.error(JSON.stringify({ svc: 'admin', result: 'checkout_failed', product: product.id, message: String((cause as Error)?.message).slice(0, 160) }));
    return simplePage(`Checkout links could not be loaded. Check that the database migrations are applied: npx wrangler d1 migrations apply ${product.dbName} --remote`, 503);
  }
}
