// The live check: before a change is saved, the server opens each link it touches and confirms the page is a real
// checkout for this product and the link's license type. Format rules (config.ts) catch a wrong host or a mistyped
// id; only opening the page shows that it exists, sells the right thing and is in the right mode.
//
// What a provider page carries (learned from the sandbox links, November 2026):
//   * Dodo Payments: /buy/<product> answers 307 to /session/cks_... on the same host. The page data sits in
//     `self.__next_f.push([1,"..."])` chunks: the cart's `product_id`, a `one_time_price` with `price` (cents) and
//     `currency`, and `discount_amount` (null when no code applies). The host tells live from test.
//   * Lemon Squeezy: /checkout/buy/<uuid> answers a redirect to /checkout/cart/<uuid>?sig=... on the same store host.
//     The page's `data-page` attribute holds JSON: props.store.slug, props.product.name ("PinchPDF Individual ..."),
//     props.cart.test_mode, props.cart.currency, props.cart.discount_id and props.cart.items[].variant.slug (= uuid)
//     with its price.
// Opening a link creates a checkout session or cart at the provider, as a buyer's click would. The request carries
// nothing personal: no cookies, a fixed user agent.

import type { ProductId } from '../trial/product';
import { DODO_HOST, DODO_PRODUCTS, MODE_NAMES, PROVIDER_NAMES, TIER_NAMES, checkUrl, otherMode, otherTier, parseLink, type Mode, type Provider, type Tier } from './config';

export type CheckResult = { ok: boolean; warn?: boolean; text: string };
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export const CHECK_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 3_000_000;
const USER_AGENT = 'TWS-Admin-LinkCheck/1.0';

const productName = (product: ProductId) => (product === 'pinchpdf' ? 'PinchPDF' : 'NoDupe');
const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toFixed(2)}`;

class CheckFailed extends Error {}
const fail = (text: string): never => {
  throw new CheckFailed(text);
};

/** Fetches a page, following at most 3 redirects, each of which must stay on `host`. */
async function openPage(url: string, host: string, provider: Provider, fetcher: Fetcher, timeoutMs: number): Promise<string> {
  const name = PROVIDER_NAMES[provider];
  let current = url;
  for (let hop = 0; ; hop += 1) {
    let response: Response;
    try {
      response = await fetcher(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      return fail(timedOut ? `No answer from ${name} within ${Math.round(timeoutMs / 1000)} seconds. Try again later.` : `${name} could not be reached. Try again later.`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return fail(`${name} answered ${response.status} without saying where to go.`);
      if (hop >= MAX_REDIRECTS) return fail(`${name} redirected more than ${MAX_REDIRECTS} times.`);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return fail(`${name} redirected to an address that is not valid.`);
      }
      if (next.protocol !== 'https:' || next.hostname !== host) return fail(`The link redirects to ${next.hostname}, not to the ${name} checkout. Check the link in the ${name} dashboard.`);
      current = next.toString();
      continue;
    }
    if (response.status === 404) return fail(`${name} answered 404: there is no checkout page at this link.`);
    if (response.status !== 200) return fail(`${name} answered ${response.status} instead of a checkout page.`);
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return fail(`${name} did not answer with a web page.`);
    const text = await response.text();
    if (text.length > MAX_PAGE_BYTES) return fail(`The ${name} page is unexpectedly large.`);
    return text;
  }
}

/** Joins the Next.js data chunks of a Dodo checkout page into one string. */
export function dodoPageData(html: string): string {
  const parts: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try {
      parts.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      // a chunk that is not a plain string holds nothing we read
    }
  }
  return parts.join('');
}

function checkDodo(html: string, product: ProductId, mode: Mode, tier: Tier, expectedId: string, code: string | null): string {
  const data = dodoPageData(html);
  const ids = [...new Set([...data.matchAll(/"product_id":"(pdt_[A-Za-z0-9]+)"/g)].map((m) => m[1]))];
  if (ids.length === 0) return fail('The page has no Dodo checkout data. It may not be a checkout page.');
  if (!ids.includes(expectedId)) {
    const other = DODO_PRODUCTS[product][mode][otherTier(tier)];
    if (other && ids.includes(other)) return fail(`The checkout sells the ${TIER_NAMES[otherTier(tier)]} product, but the license type is ${TIER_NAMES[tier]}.`);
    return fail(`The checkout sells ${ids.join(', ')}, not the link's product ${expectedId}.`);
  }
  const price = data.match(/"type":"(one_time_price|recurring_price)"[^{}]*?"price":(\d+)[^{}]*?"currency":"([A-Z]{3})"/);
  if (!price) return fail('Could not read a price from the Dodo page.');
  if (price[1] !== 'one_time_price') return fail('The Dodo product has a recurring price. The apps sell one-time licenses.');
  const amount = Number(price[2]);
  if (!(amount > 0)) return fail('The Dodo product has no price.');
  let discount = '';
  if (code) {
    const applied = data.match(/"discount_amount":(null|\d+)/);
    if (applied && applied[1] === 'null') return fail(`Dodo did not apply the discount code ${code}. Check the code in the Dodo dashboard (active, and allowed for this product).`);
    discount = applied ? `, discount code ${code} applied (${money(Number(applied[1]), price[3])} off)` : `, discount code ${code} (could not be confirmed on the page)`;
  }
  return `Dodo checkout for ${productName(product)} ${TIER_NAMES[tier]} (${expectedId}), one-time ${money(amount, price[3])}${discount}.`;
}

function unescapeAttribute(text: string): string {
  return text.replace(/&(quot|amp|lt|gt|#0?39|#x27);/g, (entity) => ({ '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#039;': "'", '&#39;': "'", '&#x27;': "'" })[entity] ?? entity);
}

type LemonPage = {
  props?: {
    store?: { slug?: unknown };
    product?: { name?: unknown };
    cart?: { test_mode?: unknown; currency?: unknown; discount_id?: unknown; items?: { price?: unknown; variant?: { slug?: unknown; name?: unknown } }[] };
  };
};

/** The JSON a Lemon Squeezy checkout page carries in its data-page attribute, or null. */
export function lemonPageData(html: string): LemonPage | null {
  const match = html.match(/data-page="([^"]*)"/);
  if (!match) return null;
  try {
    const value = JSON.parse(unescapeAttribute(match[1])) as unknown;
    return value && typeof value === 'object' ? (value as LemonPage) : null;
  } catch {
    return null;
  }
}

function checkLemon(html: string, product: ProductId, mode: Mode, tier: Tier, store: string, uuid: string, code: string | null): string {
  const page = lemonPageData(html);
  const props = page?.props;
  if (!props?.cart) return fail('The page has no Lemon Squeezy checkout data. It may not be a checkout page.');
  if (props.store?.slug !== store) return fail(`The checkout belongs to the store "${String(props.store?.slug)}", not "${store}".`);
  const item = (props.cart.items ?? []).find((i) => i?.variant?.slug === uuid);
  if (!item) return fail('The cart does not hold the product of this link.');
  const name = typeof props.product?.name === 'string' ? props.product.name : '';
  const words = `${name} ${typeof item.variant?.name === 'string' ? item.variant.name : ''}`.toLowerCase();
  const says = (t: Tier) => words.includes(t);
  if (says(otherTier(tier)) && !says(tier)) return fail(`The page sells "${name}", which is the ${TIER_NAMES[otherTier(tier)]} license, but the license type is ${TIER_NAMES[tier]}. Change the license type, or paste the ${TIER_NAMES[tier]} link from the Lemon Squeezy dashboard.`);
  if (!says(tier)) return fail(`The product name "${name}" does not say ${TIER_NAMES[tier]}, so the license type cannot be confirmed. Name the product or variant "${TIER_NAMES[tier]}" in Lemon Squeezy.`);
  const testMode = props.cart.test_mode;
  if (typeof testMode !== 'boolean') return fail('Could not read whether the checkout is in test mode.');
  if (testMode !== (mode === 'test')) {
    const belongs = otherMode(mode);
    return fail(`This is a ${testMode ? 'test-mode' : 'live'} Lemon Squeezy checkout. Put it on the ${MODE_NAMES[belongs]} tab.`);
  }
  const price = typeof item.price === 'number' ? item.price : 0;
  const currency = typeof props.cart.currency === 'string' && /^[A-Z]{3}$/.test(props.cart.currency) ? props.cart.currency : null;
  if (!(price > 0) || !currency) return fail('Could not read a price from the Lemon Squeezy page.');
  if (code && !props.cart.discount_id) return fail(`Lemon Squeezy did not apply the discount code ${code}. Check the code in the Lemon Squeezy dashboard.`);
  return `Lemon Squeezy checkout in the "${store}" store for "${name}"${testMode ? ' (test mode)' : ''}, ${money(price, currency)}${code ? `, discount code ${code} applied` : ''}.`;
}

/**
 * Opens a link and checks the page. In Test a failure comes back with `warn` set: the page may show it but saving is
 * allowed. In Live a failure blocks the save.
 */
export async function verifyLink(product: ProductId, mode: Mode, tier: Tier, provider: Provider, url: string, fetcher: Fetcher = (u, i) => fetch(u, i), timeoutMs = CHECK_TIMEOUT_MS): Promise<CheckResult> {
  const finish = (result: CheckResult): CheckResult => (!result.ok && mode === 'test' ? { ...result, warn: true } : result);
  const format = checkUrl(product, mode, tier, provider, url);
  if (format) return finish({ ok: false, text: format });
  if (!url) return finish({ ok: false, text: 'No link to check.' });
  const link = parseLink(provider, url);
  try {
    if (provider === 'dodo') {
      const html = await openPage(url, DODO_HOST[mode], provider, fetcher, timeoutMs);
      return { ok: true, text: checkDodo(html, product, mode, tier, link.productId!, link.discountCode) };
    }
    const html = await openPage(url, link.url.hostname, provider, fetcher, timeoutMs);
    return { ok: true, text: checkLemon(html, product, mode, tier, link.store!, link.uuid!, link.discountCode) };
  } catch (cause) {
    if (cause instanceof CheckFailed) return finish({ ok: false, text: cause.message });
    console.error(JSON.stringify({ svc: 'checkout', result: 'check_error', provider, message: String((cause as Error)?.message).slice(0, 120) }));
    return finish({ ok: false, text: `The ${PROVIDER_NAMES[provider]} page could not be read.` });
  }
}
