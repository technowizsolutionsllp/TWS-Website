// Public, read-only checkout endpoints, one pair per product:
//
//   GET /api/<product>/checkout/v1/links?mode=live|test   JSON for the app: the set buyers get now, both licenses
//   GET /api/<product>/checkout/v1/open?tier=individual|business&mode=live|test   302 to the checkout (website buttons)
//
// No login and no personal data: the request carries only the mode (and tier). The answer is computed from the saved
// setting on every request (a promotion starts and ends by the clock, not by a job), so the links answer may be cached
// for at most 60 seconds. When the database cannot be read the answer is 503 and the app keeps its saved or built-in
// links. See docs/CHECKOUT_LINKS.md.

import type { RateLimiter } from '../trial/config';
import { productDb, type ProductSpec } from '../trial/product';
import { plain, rateLimited } from '../trial/responses';
import { PROVIDERS, TIERS, activeSet, effective, isMode, isTier, resolveCheckout, type CheckoutConfig, type Mode, type Provider, type Tier } from './config';
import { loadConfig } from './store';

export type CheckoutEnv = { TRIAL_DB?: D1Database; NODUPE_DB?: D1Database; CHECKOUT_IP_LIMITER?: RateLimiter };

export const LINKS_CACHE_SECONDS = 60;

export type LinksAnswer = {
  product: string;
  mode: Mode;
  set: { number: number; name: string; ends_at: string | null };
  primary: Provider;
  force: boolean;
  links: Record<Tier, Record<Provider, string | null>>;
  updated_at: string | null;
};

const iso = (seconds: number | null) => (seconds === null ? null : new Date(seconds * 1000).toISOString());

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 'unknown'; // never trust X-Forwarded-For
}

async function limited(env: CheckoutEnv, request: Request): Promise<boolean> {
  if (!env.CHECKOUT_IP_LIMITER) return false;
  try {
    return !(await env.CHECKOUT_IP_LIMITER.limit({ key: clientIp(request) })).success;
  } catch {
    return false; // a limiter failure must not become an outage
  }
}

const unavailable = () => plain(503, { error: 'unavailable' }, { 'Retry-After': '60' });
const logFailure = (product: ProductSpec, cause: unknown) =>
  console.error(JSON.stringify({ svc: 'checkout', product: product.id, result: 'db_error', message: String((cause as Error)?.message).slice(0, 120) }));

/** Builds the app's answer from a setting. Exported for the admin page's "What the apps fetch" preview. */
export function linksAnswer(product: ProductSpec, mode: Mode, config: CheckoutConfig, updatedAt: number | null, nowSec: number): LinksAnswer {
  const index = activeSet(config, nowSec);
  const set = config.sets[index];
  const links = Object.fromEntries(
    TIERS.map((tier) => [tier, Object.fromEntries(PROVIDERS.map((provider) => [provider, effective(config, index, tier, provider).url || null]))]),
  ) as LinksAnswer['links'];
  return {
    product: product.id,
    mode,
    set: { number: index + 1, name: set.name, ends_at: index > 0 ? iso(set.ends_at) : null },
    primary: config.primary,
    force: config.force,
    links,
    updated_at: iso(updatedAt),
  };
}

export async function handleCheckoutLinks(request: Request, env: CheckoutEnv, product: ProductSpec, nowMs: number = Date.now()): Promise<Response> {
  if (await limited(env, request)) return rateLimited();
  const mode = new URL(request.url).searchParams.get('mode') ?? 'live';
  if (!isMode(mode)) return plain(400, { error: 'bad_request', message: 'mode must be live or test.' });
  const db = productDb(env as Parameters<typeof productDb>[0], product);
  if (!db) return unavailable();
  try {
    const stored = await loadConfig(db, product.id, mode);
    const body = linksAnswer(product, mode, stored.config, stored.updatedAt, Math.floor(nowMs / 1000));
    return Response.json(body, { headers: { 'Cache-Control': `public, max-age=${LINKS_CACHE_SECONDS}`, 'X-Content-Type-Options': 'nosniff' } });
  } catch (cause) {
    logFailure(product, cause);
    return unavailable();
  }
}

export async function handleCheckoutOpen(request: Request, env: CheckoutEnv, product: ProductSpec, nowMs: number = Date.now()): Promise<Response> {
  if (await limited(env, request)) return rateLimited();
  const params = new URL(request.url).searchParams;
  const tier = params.get('tier');
  const mode = params.get('mode') ?? 'live';
  if (!isTier(tier) || !isMode(mode)) return plain(400, { error: 'bad_request', message: 'tier must be individual or business, and mode live or test.' });
  const db = productDb(env as Parameters<typeof productDb>[0], product);
  if (!db) return unavailable();
  try {
    const stored = await loadConfig(db, product.id, mode);
    const resolved = resolveCheckout(stored.config, tier, Math.floor(nowMs / 1000));
    if (!resolved.url) return plain(404, { error: 'no_link', message: 'No checkout link is set for this license.' });
    return new Response(null, { status: 302, headers: { Location: resolved.url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch (cause) {
    logFailure(product, cause);
    return unavailable();
  }
}
