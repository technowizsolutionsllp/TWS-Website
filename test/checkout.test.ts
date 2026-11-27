// Checkout links: the rules (lib/checkout/config.ts), the live check against provider pages (verify.ts), the public
// endpoints GET /api/<product>/checkout/v1/{links,open}, and the /admin/checkout page with its review step.

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetAdminGuard } from '../lib/admin/auth';
import { handleAdminCheckout } from '../lib/admin/checkout-handlers';
import { diffConfigs, linksToCheck } from '../lib/checkout/changes';
import { checkUrl, parseConfig, resolveCheckout, validateConfig, type CheckoutConfig, type Mode } from '../lib/checkout/config';
import { defaultConfig } from '../lib/checkout/defaults';
import { handleCheckoutLinks, handleCheckoutOpen, type LinksAnswer } from '../lib/checkout/handler';
import { loadConfig } from '../lib/checkout/store';
import { dodoPageData, verifyLink, type Fetcher } from '../lib/checkout/verify';
import { NODUPE, PINCHPDF, type ProductSpec } from '../lib/trial/product';

const NOW = Date.UTC(2026, 10, 27, 9, 0, 0);
const NOW_SEC = NOW / 1000;
const DAY = 86_400;
const creds = { ADMIN_USER: 'ops', ADMIN_PASSWORD: 'correct horse battery' };
const good = `Basic ${btoa(`${creds.ADMIN_USER}:${creds.ADMIN_PASSWORD}`)}`;
const adminEnv = () => ({ ...creds, TRIAL_DB: env.TRIAL_DB, NODUPE_DB: env.NODUPE_DB });
const dbOf = (p: ProductSpec) => (p === NODUPE ? env.NODUPE_DB : env.TRIAL_DB);

const PIN = {
  dodoInd: 'https://checkout.dodopayments.com/buy/pdt_0Nplqin1uobNhVKSJLImM?quantity=1',
  dodoBus: 'https://checkout.dodopayments.com/buy/pdt_0NplrzQavP5dhhEM7juVK?quantity=1',
  lemonInd: 'https://technowizsolutions.lemonsqueezy.com/checkout/buy/584d4694-bd36-4e04-979c-2b4ffbaa3f68',
  lemonBus: 'https://technowizsolutions.lemonsqueezy.com/checkout/buy/ddf7f467-5c26-4551-a38e-48f990355519',
  testDodoInd: 'https://test.checkout.dodopayments.com/buy/pdt_0NpH4a2Ken4XQYwdqsupO?quantity=1',
};

beforeEach(() => resetAdminGuard());

// ------------------------------------------------------------------ fake provider pages

/** What each fake Lemon Squeezy uuid sells, and in which mode. */
const LEMON: Record<string, { name: string; store: string; test: boolean }> = {
  '584d4694-bd36-4e04-979c-2b4ffbaa3f68': { name: 'PinchPDF Individual Subscription', store: 'technowizsolutions', test: false },
  'ddf7f467-5c26-4551-a38e-48f990355519': { name: 'PinchPDF Business Subscription', store: 'technowizsolutions', test: false },
  '4449c474-c20f-4368-8f59-157235107996': { name: 'PinchPDF Individual Subscription', store: 'technowizsolutions', test: true },
  '18d4738b-eaf7-405f-a4f2-24f6ab7773fb': { name: 'PinchPDF Business Subscription', store: 'technowizsolutions', test: true },
  'cdf8bf3c-b950-4f21-a7fc-3e22bcd974d9': { name: 'NoDupe Individual', store: 'technowizsolutions', test: false },
  'c2f4c1b1-72cf-4308-aeb8-ee3b5653c6ff': { name: 'NoDupe Business', store: 'technowizsolutions', test: false },
  'b9633075-c930-47fe-b49d-1a92a3bcfd09': { name: 'NoDupe Individual', store: 'technowizsolutions', test: true },
  '5838f617-d05c-4e79-821a-60f47447ec4a': { name: 'NoDupe Business', store: 'technowizsolutions', test: true },
};

const attr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const htmlPage = (body: string) => new Response(`<!doctype html><html><body>${body}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

function dodoPage(productId: string, opts: { discount?: number | null; recurring?: boolean } = {}): Response {
  const data = JSON.stringify({
    sessionCalculation: { total_price: 117882, currency: 'INR', product_cart: [{ product_id: productId, discounted_price: 99900, og_price: 99900, discount_amount: opts.discount ?? null }] },
    product: { name: 'Pinch PDF', price: { type: opts.recurring ? 'recurring_price' : 'one_time_price', price: 1499, currency: 'USD' } },
  });
  const half = Math.floor(data.length / 2);
  // the data is split over two chunks, as Next.js does
  return htmlPage(`<script>self.__next_f.push([1,${JSON.stringify(data.slice(0, half))}])</script><script>self.__next_f.push([1,${JSON.stringify(data.slice(half))}])</script>`);
}

function lemonPage(uuid: string, opts: { discountId?: number | null; name?: string; test?: boolean; store?: string } = {}): Response {
  const known = LEMON[uuid] ?? { name: 'Unknown', store: 'technowizsolutions', test: false };
  const page = {
    component: 'Checkout',
    props: {
      store: { slug: opts.store ?? known.store },
      product: { name: opts.name ?? known.name },
      cart: { test_mode: opts.test ?? known.test, currency: 'INR', discount_id: opts.discountId ?? null, items: [{ price: 149900, variant: { slug: uuid, name: 'Default' } }] },
    },
  };
  return htmlPage(`<div id="app" data-page="${attr(JSON.stringify(page))}"></div>`);
}

type Fake = { fetcher: Fetcher; calls: string[] };

/** A provider that answers like the real ones: a redirect on the same host, then the checkout page. */
function fakeProviders(override: (url: URL) => Response | null = () => null): Fake {
  const calls: string[] = [];
  const fetcher: Fetcher = async (input) => {
    calls.push(input);
    const url = new URL(input);
    const custom = override(url);
    if (custom) return custom;
    if (url.hostname.endsWith('dodopayments.com')) {
      const buy = url.pathname.match(/^\/buy\/(pdt_\w+)$/);
      if (buy) return new Response(null, { status: 307, headers: { location: `/session/cks_${buy[1]}${url.search}` } });
      const session = url.pathname.match(/^\/session\/cks_(pdt_\w+)$/);
      if (session) return dodoPage(session[1], { discount: url.searchParams.get('discount_code') ? 20000 : null });
    }
    if (url.hostname.endsWith('lemonsqueezy.com')) {
      const buy = url.pathname.match(/^\/checkout\/buy\/([0-9a-f-]{36})$/);
      if (buy) return new Response(null, { status: 302, headers: { location: `https://${url.hostname}/checkout/cart/${buy[1]}?sig=abc${url.search ? `&${url.search.slice(1)}` : ''}` } });
      const cart = url.pathname.match(/^\/checkout\/cart\/([0-9a-f-]{36})$/);
      if (cart) return lemonPage(cart[1], { discountId: url.searchParams.get('checkout[discount_code]') ? 77 : null });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}

// ------------------------------------------------------------------ rules

describe('link rules', () => {
  it('accepts the links built into today\'s apps', () => {
    for (const product of [PINCHPDF, NODUPE]) {
      for (const mode of ['live', 'test'] as Mode[]) {
        const config = defaultConfig(product.id, mode);
        const errors = validateConfig(product.id, mode, config, config, [], NOW_SEC);
        expect(errors, `${product.id} ${mode}`).toMatchObject({ fields: {}, order: null, defaultSet: null });
        expect(config.primary, `${product.id} ${mode}`).toBe('dodo');
      }
    }
  });

  it('refuses a link to the other license, the other mode, an unknown Dodo product or another store', () => {
    expect(checkUrl('pinchpdf', 'live', 'individual', 'dodo', PIN.dodoBus)).toMatch(/This is the Business product, but the license type says Individual/);
    expect(checkUrl('pinchpdf', 'live', 'individual', 'dodo', PIN.testDodoInd)).toMatch(/test Dodo link. Put it on the Test tab/);
    expect(checkUrl('pinchpdf', 'live', 'individual', 'dodo', 'https://checkout.dodopayments.com/buy/pdt_SOMETHINGELSE')).toMatch(/does not accept keys from Dodo product pdt_SOMETHINGELSE/);
    expect(checkUrl('pinchpdf', 'live', 'individual', 'lemon_squeezy', 'https://anshul.lemonsqueezy.com/checkout/buy/b4f60bd8-eb55-4235-a09e-bc1b8ffe27ec')).toMatch(/not a PinchPDF store/);
    expect(checkUrl('nodupe', 'test', 'individual', 'dodo', 'https://test.checkout.dodopayments.com/buy/pdt_0NpH4a2Ken4XQYwdqsupO')).toMatch(/NoDupe does not accept keys/);
    // NoDupe moved to the technowizsolutions store; the app refuses its old anshul store links
    expect(checkUrl('nodupe', 'live', 'individual', 'lemon_squeezy', 'https://anshul.lemonsqueezy.com/checkout/buy/b4f60bd8-eb55-4235-a09e-bc1b8ffe27ec')).toMatch(/not a NoDupe store/);
    expect(checkUrl('nodupe', 'live', 'individual', 'lemon_squeezy', 'https://technowizsolutions.lemonsqueezy.com/checkout/buy/cdf8bf3c-b950-4f21-a7fc-3e22bcd974d9')).toBeNull();
    expect(checkUrl('nodupe', 'test', 'business', 'dodo', 'https://test.checkout.dodopayments.com/buy/pdt_0NsppEGBQIrZBKWPiKapg?quantity=1')).toBeNull();
  });

  it('allows only quantity=1 and a discount code after the link, and no tricks in the address', () => {
    expect(checkUrl('pinchpdf', 'live', 'individual', 'dodo', `${PIN.dodoInd}&discount_code=BF2026`)).toBeNull();
    expect(checkUrl('pinchpdf', 'live', 'individual', 'dodo', `${PIN.dodoInd}&redirect_url=https://evil.example`)).toMatch(/Remove: redirect_url/);
    expect(checkUrl('pinchpdf', 'live', 'individual', 'lemon_squeezy', `${PIN.lemonInd}?checkout[discount_code]=XMAS26`)).toBeNull();
    expect(checkUrl('pinchpdf', 'live', 'individual', 'lemon_squeezy', `${PIN.lemonInd}?checkout[email]=a@b.c`)).toMatch(/Remove/);
    for (const bad of ['http://checkout.dodopayments.com/buy/pdt_0Nplqin1uobNhVKSJLImM', 'https://user:pw@checkout.dodopayments.com/buy/pdt_0Nplqin1uobNhVKSJLImM', 'https://checkout.dodopayments.com:8443/buy/pdt_0Nplqin1uobNhVKSJLImM', `${PIN.dodoInd}#x`, 'not a link', 'https://checkout.dodopayments.com.evil.example/buy/pdt_0Nplqin1uobNhVKSJLImM']) {
      expect(checkUrl('pinchpdf', 'live', 'individual', 'dodo', bad), bad).not.toBeNull();
    }
  });

  it('needs one Individual and one Business link per provider, and no link on both tabs', () => {
    const config = defaultConfig('pinchpdf', 'live');
    config.sets[0].links.lemon_squeezy[1].type = 'individual';
    const errors = validateConfig('pinchpdf', 'live', config, defaultConfig('pinchpdf', 'live'), [PIN.dodoInd], NOW_SEC);
    expect(errors.fields['0.lemon_squeezy.0']).toMatch(/Both Lemon Squeezy links are Individual/);
    expect(errors.types['0.lemon_squeezy.1']).toBe(true);
    expect(errors.fields['0.dodo.0']).toMatch(/already saved on the Test tab/);
  });

  it('runs promotions by their dates, refuses overlaps, and keeps a dated set from being the default', () => {
    const saved = defaultConfig('pinchpdf', 'live');
    const config = defaultConfig('pinchpdf', 'live');
    const promo = (name: string, start: number | null, end: number | null) => ({ ...JSON.parse(JSON.stringify(config.sets[0])), name, starts_at: start, ends_at: end });
    config.sets.push(promo('Black Friday', NOW_SEC + DAY, NOW_SEC + 5 * DAY), promo('Overlap', NOW_SEC + 3 * DAY, NOW_SEC + 9 * DAY));
    config.sets[1].links.dodo[0].url = `${PIN.dodoInd}&discount_code=BF2026`;
    config.sets[2].links.dodo[0].url = `${PIN.dodoInd}&discount_code=OTHER`;
    let errors = validateConfig('pinchpdf', 'live', config, saved, [], NOW_SEC);
    expect(errors.dates[2]).toMatch(/overlap Set 2: Black Friday/);
    config.sets[2].starts_at = NOW_SEC + 6 * DAY;
    errors = validateConfig('pinchpdf', 'live', config, saved, [], NOW_SEC);
    expect(errors.dates).toEqual({});
    config.default_set = 1;
    expect(validateConfig('pinchpdf', 'live', config, saved, [], NOW_SEC).defaultSet).toMatch(/cannot be the default/);
    config.default_set = 0;
    expect(resolveCheckout(config, 'individual', NOW_SEC).url).toBe(PIN.dodoInd);
    expect(resolveCheckout(config, 'individual', NOW_SEC + 2 * DAY).url).toBe(`${PIN.dodoInd}&discount_code=BF2026`);
    // an empty link in a promotion uses set 1's link of the same license type
    expect(resolveCheckout(config, 'business', NOW_SEC + 2 * DAY).url).toBe(PIN.dodoBus);
    expect(resolveCheckout(config, 'individual', NOW_SEC + 10 * DAY).url).toBe(PIN.dodoInd);
    config.sets[2].ends_at = NOW_SEC - 1;
    expect(validateConfig('pinchpdf', 'live', config, saved, [], NOW_SEC).dates[2]).toMatch(/end must be in the future/);
  });

  it('falls back to the backup unless Force is on', () => {
    const config = defaultConfig('pinchpdf', 'live');
    config.sets[0].links.dodo[1].url = '';
    expect(resolveCheckout(config, 'business', NOW_SEC)).toMatchObject({ provider: 'lemon_squeezy', via: 'backup' });
    config.force = true;
    expect(resolveCheckout(config, 'business', NOW_SEC)).toMatchObject({ url: null, via: 'none' });
  });

  it('reads only a well-formed stored setting', () => {
    expect(parseConfig(defaultConfig('pinchpdf', 'live'))).not.toBeNull();
    for (const bad of [null, {}, { ...defaultConfig('pinchpdf', 'live'), sets: [] }, { ...defaultConfig('pinchpdf', 'live'), default_set: 3 }, { ...defaultConfig('pinchpdf', 'live'), primary: 'paypal' }]) {
      expect(parseConfig(bad)).toBeNull();
    }
    const dated = defaultConfig('pinchpdf', 'live');
    dated.sets[0].ends_at = NOW_SEC;
    expect(parseConfig(dated), 'set 1 cannot have dates').toBeNull();
  });

  it('checks every changed link (a changed license type counts) and the primary links of a new primary', () => {
    const saved = defaultConfig('pinchpdf', 'live');
    const draft = defaultConfig('pinchpdf', 'live');
    draft.primary = 'lemon_squeezy';
    expect(linksToCheck(saved, draft, NOW_SEC)).toEqual(['0.lemon_squeezy.0', '0.lemon_squeezy.1']);
    draft.primary = 'dodo';
    draft.sets[0].links.lemon_squeezy[0].type = 'business';
    draft.sets[0].links.lemon_squeezy[1].type = 'individual';
    expect(linksToCheck(saved, draft, NOW_SEC)).toEqual(['0.lemon_squeezy.0', '0.lemon_squeezy.1']);
    expect(diffConfigs(saved, draft).map((c) => c.change)).toEqual(['Set 1, Lemon Squeezy, link 1: license type', 'Set 1, Lemon Squeezy, link 2: license type']);
  });
});

// ------------------------------------------------------------------ live check

describe('live check', () => {
  it('reads the Dodo page data split over chunks', () => {
    expect(dodoPageData('<script>self.__next_f.push([1,"{\\"a\\":"])</script><script>self.__next_f.push([1,"1}"])</script>')).toBe('{"a":1}');
  });

  it('verifies real-looking Dodo and Lemon Squeezy checkouts, following a same-host redirect', async () => {
    const { fetcher, calls } = fakeProviders();
    const dodo = await verifyLink('pinchpdf', 'live', 'individual', 'dodo', PIN.dodoInd, fetcher);
    expect(dodo).toEqual({ ok: true, text: expect.stringContaining('one-time USD 14.99') });
    const lemon = await verifyLink('pinchpdf', 'live', 'business', 'lemon_squeezy', PIN.lemonBus, fetcher);
    expect(lemon).toEqual({ ok: true, text: expect.stringContaining('"PinchPDF Business Subscription"') });
    expect(calls).toHaveLength(4); // two hops each
  });

  it('refuses a Lemon Squeezy page that sells the other license (license types swapped)', async () => {
    const { fetcher } = fakeProviders();
    const r = await verifyLink('pinchpdf', 'live', 'business', 'lemon_squeezy', PIN.lemonInd, fetcher);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/which is the Individual license, but the license type is Business/);
  });

  it('refuses a test-mode Lemon checkout in Live, and reports it as a warning in Test', async () => {
    const { fetcher } = fakeProviders();
    const testLink = 'https://technowizsolutions.lemonsqueezy.com/checkout/buy/4449c474-c20f-4368-8f59-157235107996';
    expect(await verifyLink('pinchpdf', 'live', 'individual', 'lemon_squeezy', testLink, fetcher)).toMatchObject({ ok: false, text: expect.stringMatching(/test-mode .*Put it on the Test tab/) });
    expect(await verifyLink('pinchpdf', 'test', 'individual', 'lemon_squeezy', PIN.lemonInd, fetcher)).toMatchObject({ ok: false, warn: true, text: expect.stringMatching(/live Lemon Squeezy checkout. Put it on the Live tab/) });
  });

  it('fails on 404, on a redirect to another site, on a timeout, and on a discount code the provider did not apply', async () => {
    const notFound = fakeProviders((u) => (u.pathname.startsWith('/buy/') ? new Response('', { status: 404 }) : null));
    expect((await verifyLink('pinchpdf', 'live', 'individual', 'dodo', PIN.dodoInd, notFound.fetcher)).text).toMatch(/answered 404/);
    const away = fakeProviders((u) => (u.pathname.startsWith('/buy/') ? new Response(null, { status: 302, headers: { location: 'https://evil.example/pay' } }) : null));
    expect((await verifyLink('pinchpdf', 'live', 'individual', 'dodo', PIN.dodoInd, away.fetcher)).text).toMatch(/redirects to evil.example/);
    const slow: Fetcher = (_u, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))));
    expect((await verifyLink('pinchpdf', 'live', 'individual', 'dodo', PIN.dodoInd, slow, 50)).text).toMatch(/No answer from Dodo Payments/);
    const ignored = fakeProviders((u) => (u.pathname.startsWith('/session/') ? dodoPage('pdt_0Nplqin1uobNhVKSJLImM', { discount: null }) : null));
    expect((await verifyLink('pinchpdf', 'live', 'individual', 'dodo', `${PIN.dodoInd}&discount_code=NOPE`, ignored.fetcher)).text).toMatch(/did not apply the discount code NOPE/);
    const { fetcher } = fakeProviders();
    expect((await verifyLink('pinchpdf', 'live', 'individual', 'dodo', `${PIN.dodoInd}&discount_code=BF2026`, fetcher)).text).toMatch(/discount code BF2026 applied/);
  });

  it('refuses a Dodo page whose cart holds the other license, or a recurring price', async () => {
    const swapped = fakeProviders((u) => (u.pathname.startsWith('/session/') ? dodoPage('pdt_0NplrzQavP5dhhEM7juVK') : null));
    expect((await verifyLink('pinchpdf', 'live', 'individual', 'dodo', PIN.dodoInd, swapped.fetcher)).text).toMatch(/sells the Business product/);
    const recurring = fakeProviders((u) => (u.pathname.startsWith('/session/') ? dodoPage('pdt_0Nplqin1uobNhVKSJLImM', { recurring: true }) : null));
    expect((await verifyLink('pinchpdf', 'live', 'individual', 'dodo', PIN.dodoInd, recurring.fetcher)).text).toMatch(/recurring price/);
  });
});

// ------------------------------------------------------------------ public endpoints

async function store(product: ProductSpec, mode: Mode, config: CheckoutConfig, version = 1) {
  await dbOf(product).prepare('INSERT INTO checkout_config (mode, config, version, updated_at) VALUES (?1, ?2, ?3, ?4)').bind(mode, JSON.stringify(config), version, NOW_SEC - 3600).run();
}

const publicGet = (path: string) => new Request(`https://technowizsolutions.com${path}`);

describe.each([PINCHPDF, NODUPE])('GET /api/%s/checkout/v1', (product) => {
  const penv = () => ({ TRIAL_DB: env.TRIAL_DB, NODUPE_DB: env.NODUPE_DB });

  it('answers the built-in links until a setting is saved, cacheable for 60 seconds', async () => {
    const response = await handleCheckoutLinks(publicGet(`/api/${product.id}/checkout/v1/links`), penv(), product, NOW);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    const body = (await response.json()) as LinksAnswer;
    const built = defaultConfig(product.id, 'live');
    expect(body).toMatchObject({ product: product.id, mode: 'live', set: { number: 1, name: 'Standard', ends_at: null }, primary: built.primary, force: false, updated_at: null });
    expect(body.links.individual.dodo).toBe(built.sets[0].links.dodo[0].url);
    expect(body.links.business.lemon_squeezy).toBe(built.sets[0].links.lemon_squeezy[1].url);
  });

  it('answers a running promotion, grouped by the license type chosen for each link', async () => {
    const config = defaultConfig(product.id, 'live');
    const promo = JSON.parse(JSON.stringify(config.sets[0])) as CheckoutConfig['sets'][number];
    promo.name = 'Black Friday';
    promo.starts_at = NOW_SEC - DAY;
    promo.ends_at = NOW_SEC + DAY;
    // the admin listed the Business link first: the answer still puts it under "business"
    promo.links.dodo = [{ ...promo.links.dodo[1], url: `${promo.links.dodo[1].url}&discount_code=BF` }, { type: 'individual', url: '' }];
    config.sets.push(promo);
    await store(product, 'live', config);
    const body = (await (await handleCheckoutLinks(publicGet(`/api/${product.id}/checkout/v1/links?mode=live`), penv(), product, NOW)).json()) as LinksAnswer;
    expect(body.set).toEqual({ number: 2, name: 'Black Friday', ends_at: new Date((NOW_SEC + DAY) * 1000).toISOString() });
    expect(body.links.business.dodo).toMatch(/discount_code=BF$/);
    expect(body.links.individual.dodo).toBe(config.sets[0].links.dodo[0].url); // set 1's, since the promotion has none
    expect(body.updated_at).toBe(new Date((NOW_SEC - 3600) * 1000).toISOString());
  });

  it('redirects to the primary, else the backup, and never to the backup when forced', async () => {
    const config = defaultConfig(product.id, 'live');
    const primary = config.primary;
    config.sets[0].links[primary][0].url = '';
    await store(product, 'live', config);
    const open = await handleCheckoutOpen(publicGet(`/api/${product.id}/checkout/v1/open?tier=individual`), penv(), product, NOW);
    expect(open.status).toBe(302);
    expect(open.headers.get('location')).toBe(config.sets[0].links[primary === 'dodo' ? 'lemon_squeezy' : 'dodo'][0].url);
    expect(open.headers.get('cache-control')).toBe('no-store');
    await dbOf(product).prepare("UPDATE checkout_config SET config = json_set(config, '$.force', json('true'))").run();
    expect((await handleCheckoutOpen(publicGet(`/api/${product.id}/checkout/v1/open?tier=individual`), penv(), product, NOW)).status).toBe(404);
  });

  it('serves the built-in links when the stored setting breaks the rules (a hand-edited row)', async () => {
    const config = defaultConfig(product.id, 'live');
    config.sets[0].links.dodo[0].url = 'https://evil.example/buy';
    await store(product, 'live', config);
    const body = (await (await handleCheckoutLinks(publicGet(`/api/${product.id}/checkout/v1/links`), penv(), product, NOW)).json()) as LinksAnswer;
    expect(body.links.individual.dodo).toBe(defaultConfig(product.id, 'live').sets[0].links.dodo[0].url);
  });

  it('answers 400 to a bad mode or tier, 429 when throttled and 503 without a database', async () => {
    expect((await handleCheckoutLinks(publicGet(`/api/${product.id}/checkout/v1/links?mode=prod`), penv(), product, NOW)).status).toBe(400);
    expect((await handleCheckoutOpen(publicGet(`/api/${product.id}/checkout/v1/open?tier=team`), penv(), product, NOW)).status).toBe(400);
    const limiter = { limit: async () => ({ success: false }) };
    expect((await handleCheckoutLinks(publicGet(`/api/${product.id}/checkout/v1/links`), { ...penv(), CHECKOUT_IP_LIMITER: limiter }, product, NOW)).status).toBe(429);
    expect((await handleCheckoutLinks(publicGet(`/api/${product.id}/checkout/v1/links`), {}, product, NOW)).status).toBe(503);
  });
});

// ------------------------------------------------------------------ the admin page

type Init = { auth?: string | null; origin?: string; site?: string };
/** What a browser sends when the form on the admin page itself is posted: the page's no-referrer policy makes Origin null. */
const fromPage: Init = { origin: 'null', site: 'same-origin' };
const adminGet = (query: string, init: Init = {}) =>
  new Request(`https://technowizsolutions.com/admin/checkout${query}`, { headers: init.auth === null ? {} : { authorization: init.auth ?? good } });
const adminPost = (form: URLSearchParams, init: Init = {}) =>
  new Request('https://technowizsolutions.com/admin/checkout', {
    method: 'POST',
    headers: {
      authorization: good,
      'content-type': 'application/x-www-form-urlencoded',
      ...(init.origin ? { origin: init.origin } : {}),
      ...(init.site ? { 'sec-fetch-site': init.site } : {}),
    },
    body: form.toString(),
  });

const dt = (sec: number | null) => (sec === null ? '' : new Date(sec * 1000).toISOString().slice(0, 16));

/** The editor form's fields for a setting, named as the page names them. */
function editorForm(product: ProductSpec, mode: Mode, config: CheckoutConfig, version: number, intent: string): URLSearchParams {
  const form = new URLSearchParams({ product: product.id, mode, version: String(version), sets: String(config.sets.length), primary: config.primary, default_set: String(config.default_set), intent });
  if (config.force) form.set('force', 'on');
  config.sets.forEach((set, i) => {
    if (i > 0) {
      form.set(`name.${i}`, set.name);
      form.set(`starts.${i}`, dt(set.starts_at));
      form.set(`ends.${i}`, dt(set.ends_at));
    }
    for (const p of ['dodo', 'lemon_squeezy'] as const) {
      set.links[p].forEach((row, r) => {
        form.set(`type.${i}.${p}.${r}`, row.type);
        form.set(`url.${i}.${p}.${r}`, row.url);
      });
    }
  });
  return form;
}

const unescapeHtml = (text: string) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const hidden = (html: string, name: string) => unescapeHtml(html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1] ?? '');

/** The review page's form, answered with a reason and (optionally) the confirmation tick. */
function saveForm(html: string, extra: Record<string, string> = {}): URLSearchParams {
  const form = new URLSearchParams({ intent: 'save' });
  for (const name of ['product', 'mode', 'version', 'draft', 'results', 'token']) form.set(name, hidden(html, name));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

describe('/admin/checkout', () => {
  it('asks for the admin login and refuses posts from another site', async () => {
    expect((await handleAdminCheckout(adminGet('', { auth: null }), adminEnv(), NOW)).status).toBe(401);
    const form = editorForm(PINCHPDF, 'live', defaultConfig('pinchpdf', 'live'), 0, 'review');
    expect((await handleAdminCheckout(adminPost(form, { origin: 'https://evil.example' }), adminEnv(), NOW)).status).toBe(403);
    expect((await handleAdminCheckout(adminPost(form, { origin: 'null', site: 'cross-site' }), adminEnv(), NOW)).status).toBe(403);
    expect((await handleAdminCheckout(adminPost(form, { origin: 'null' }), adminEnv(), NOW)).status).toBe(403);
  });

  it('saves a change posted from the page itself, as a browser sends it (Origin: null)', async () => {
    const { fetcher } = fakeProviders();
    const draft = defaultConfig('nodupe', 'live');
    draft.primary = 'lemon_squeezy';
    const review = await handleAdminCheckout(adminPost(editorForm(NODUPE, 'live', draft, 0, 'review'), fromPage), adminEnv(), NOW, fetcher);
    expect(review.status).toBe(200);
    const saved = await handleAdminCheckout(adminPost(saveForm(await review.text(), { reason: 'Dodo outage', confirm: 'on' }), fromPage), adminEnv(), NOW, fetcher);
    expect(saved.status).toBe(303);
    expect((await loadConfig(env.NODUPE_DB, 'nodupe', 'live')).config.primary).toBe('lemon_squeezy');
  });

  it('shows the built-in links, every field the editor form posts, and no scripts', async () => {
    const response = await handleAdminCheckout(adminGet('?product=pinchpdf&mode=live'), adminEnv(), NOW);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain('What buyers get now');
    expect(html).toContain('Links built into the app, Live (nothing saved yet)');
    expect(html).not.toContain('<script');
    for (const field of editorForm(PINCHPDF, 'live', defaultConfig('pinchpdf', 'live'), 0, 'review').keys()) {
      if (field === 'intent' || field === 'force') continue;
      expect(html, field).toContain(`name="${field}"`);
    }
  });

  it('saves a primary switch only after the check, a reason and the confirmation tick, and records it', async () => {
    const { fetcher, calls } = fakeProviders();
    const draft = defaultConfig('pinchpdf', 'live');
    draft.primary = 'lemon_squeezy';
    const review = await handleAdminCheckout(adminPost(editorForm(PINCHPDF, 'live', draft, 0, 'review')), adminEnv(), NOW, fetcher);
    expect(review.status).toBe(200);
    const html = await review.text();
    expect(html).toContain('Review changes');
    expect(html).toContain('All 2 links passed the check with the provider.');
    expect(html).toContain('I opened these checkout pages and they work.');
    expect(calls.some((u) => u.includes('lemonsqueezy.com'))).toBe(true);

    const noReason = await handleAdminCheckout(adminPost(saveForm(html, { confirm: 'on' })), adminEnv(), NOW, fetcher);
    expect(noReason.status).toBe(400);
    expect(await noReason.text()).toContain('Give a reason of 3 to 500 characters.');
    const noTick = await handleAdminCheckout(adminPost(saveForm(html, { reason: 'Dodo outage' })), adminEnv(), NOW, fetcher);
    expect(await noTick.text()).toContain('Open the pages above, then tick the box.');

    const saved = await handleAdminCheckout(adminPost(saveForm(html, { reason: 'Dodo outage', confirm: 'on' })), adminEnv(), NOW, fetcher);
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toBe('/admin/checkout?product=pinchpdf&mode=live&saved=1&checked=2');
    expect((await loadConfig(env.TRIAL_DB, 'pinchpdf', 'live')).config.primary).toBe('lemon_squeezy');
    const audit = await env.TRIAL_DB.prepare('SELECT operator, change, before, after, reason FROM checkout_audit').all();
    expect(audit.results).toEqual([{ operator: 'admin-ui', change: 'Primary provider', before: 'Dodo Payments', after: 'Lemon Squeezy', reason: 'Dodo outage' }]);
    expect(await env.NODUPE_DB.prepare('SELECT COUNT(*) AS n FROM checkout_config').first('n')).toBe(0);

    const page = await (await handleAdminCheckout(adminGet('?product=pinchpdf&mode=live&saved=1&checked=2'), adminEnv(), NOW)).text();
    expect(page).toContain('Saved 1 change to PinchPDF (Live), after checking 2 links with the providers.');
  });

  it('refuses to save in Live when a check fails, and allows it with a warning in Test', async () => {
    const down = fakeProviders((u) => (u.hostname.endsWith('lemonsqueezy.com') ? new Response('', { status: 503 }) : null));
    const live = defaultConfig('pinchpdf', 'live');
    live.primary = 'lemon_squeezy';
    const html = await (await handleAdminCheckout(adminPost(editorForm(PINCHPDF, 'live', live, 0, 'review')), adminEnv(), NOW, down.fetcher)).text();
    expect(html).toContain('2 links of 2 failed the check, so these changes cannot be saved.');
    expect(html).toMatch(/value="save" class="primary" disabled/);
    const forced = await handleAdminCheckout(adminPost(saveForm(html, { reason: 'try anyway', confirm: 'on' })), adminEnv(), NOW, down.fetcher);
    expect(forced.status).toBe(400);
    expect(await forced.text()).toContain('A link failed the check, so these changes cannot be saved in Live.');
    expect(await env.TRIAL_DB.prepare('SELECT COUNT(*) AS n FROM checkout_config').first('n')).toBe(0);

    const test = defaultConfig('pinchpdf', 'test');
    test.primary = 'lemon_squeezy';
    const testHtml = await (await handleAdminCheckout(adminPost(editorForm(PINCHPDF, 'test', test, 0, 'review')), adminEnv(), NOW, down.fetcher)).text();
    expect(testHtml).toContain('In Test that is a warning only: you can still save.');
    const ok = await handleAdminCheckout(adminPost(saveForm(testHtml, { reason: 'sandbox switch' })), adminEnv(), NOW, down.fetcher);
    expect(ok.status).toBe(303);
    const checked = await env.TRIAL_DB.prepare("SELECT checked FROM checkout_audit WHERE change = 'Primary provider'").first('checked');
    expect(checked).toBe('');
  });

  it('refuses a review whose draft was changed after the check', async () => {
    const { fetcher } = fakeProviders();
    const draft = defaultConfig('pinchpdf', 'live');
    draft.sets[0].links.dodo[0].url = `${PIN.dodoInd}&discount_code=SPRING`;
    const html = await (await handleAdminCheckout(adminPost(editorForm(PINCHPDF, 'live', draft, 0, 'review')), adminEnv(), NOW, fetcher)).text();
    const form = saveForm(html, { reason: 'spring sale' });
    form.set('draft', form.get('draft')!.replace('SPRING', 'FREE100'));
    const response = await handleAdminCheckout(adminPost(form), adminEnv(), NOW, fetcher);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('This review could not be confirmed. Nothing was saved.');
    // and one more than 30 minutes old
    const late = await handleAdminCheckout(adminPost(saveForm(html, { reason: 'spring sale' })), adminEnv(), NOW + 31 * 60_000, fetcher);
    expect(await late.text()).toContain('more than 30 minutes old');
  });

  it('records the check result with a link change, and refuses a save over a newer one', async () => {
    const { fetcher } = fakeProviders();
    const draft = defaultConfig('pinchpdf', 'live');
    draft.sets[0].links.dodo[0].url = `${PIN.dodoInd}&discount_code=SPRING`;
    const html = await (await handleAdminCheckout(adminPost(editorForm(PINCHPDF, 'live', draft, 0, 'review')), adminEnv(), NOW, fetcher)).text();
    expect((await handleAdminCheckout(adminPost(saveForm(html, { reason: 'spring sale' })), adminEnv(), NOW, fetcher)).status).toBe(303);
    const row = await env.TRIAL_DB.prepare('SELECT change, checked FROM checkout_audit').first<{ change: string; checked: string }>();
    expect(row?.change).toBe('Set 1, Dodo Payments, link 1 (Individual)');
    expect(row?.checked).toMatch(/^verified: Dodo checkout for PinchPDF Individual .*discount code SPRING applied/);
    // the same review again: the version moved on
    const again = await handleAdminCheckout(adminPost(saveForm(html, { reason: 'spring sale' })), adminEnv(), NOW, fetcher);
    expect(again.status).toBe(409);
    expect(await again.text()).toContain('Someone saved this tab after you opened it');
  });

  it('adds, schedules and removes a promotion set without saving, and shows refused fields', async () => {
    const { fetcher } = fakeProviders();
    const base = defaultConfig('pinchpdf', 'live');
    const added = await (await handleAdminCheckout(adminPost(editorForm(PINCHPDF, 'live', base, 0, 'add')), adminEnv(), NOW, fetcher)).text();
    expect(added).toContain('name="name.1"');
    expect(added).toContain('<details class="set" id="set-1" open>');
    const withSet = defaultConfig('pinchpdf', 'live');
    withSet.sets.push({ name: 'X', starts_at: null, ends_at: null, links: { dodo: [{ type: 'individual', url: PIN.dodoBus }, { type: 'business', url: '' }], lemon_squeezy: [{ type: 'individual', url: '' }, { type: 'business', url: '' }] } });
    const refused = await handleAdminCheckout(adminPost(editorForm(PINCHPDF, 'live', withSet, 0, 'review')), adminEnv(), NOW, fetcher);
    expect(refused.status).toBe(400);
    const text = await refused.text();
    expect(text).toContain('Fix the 2 problems marked in red first.');
    expect(text).toContain('Give the set a name of 2 to 60 characters');
    expect(text).toContain('This is the Business product, but the license type says Individual.');
    const removed = await (await handleAdminCheckout(adminPost(editorForm(PINCHPDF, 'live', withSet, 0, 'remove:1')), adminEnv(), NOW, fetcher)).text();
    expect(removed).not.toContain('name="name.1"');
    expect(await env.TRIAL_DB.prepare('SELECT COUNT(*) AS n FROM checkout_config').first('n')).toBe(0);
  });

  it('records a promotion starting and ending on its own, once', async () => {
    const config = defaultConfig('nodupe', 'live');
    const promo = JSON.parse(JSON.stringify(config.sets[0])) as CheckoutConfig['sets'][number];
    Object.assign(promo, { name: 'Launch', starts_at: NOW_SEC - 2 * DAY, ends_at: NOW_SEC - DAY });
    config.sets.push(promo);
    await store(NODUPE, 'live', config);
    for (let i = 0; i < 2; i += 1) await handleAdminCheckout(adminGet('?product=nodupe&mode=live'), adminEnv(), NOW);
    const rows = await env.NODUPE_DB.prepare('SELECT operator, change, at FROM checkout_audit ORDER BY at').all();
    expect(rows.results).toEqual([
      { operator: 'auto-start', change: 'Set 2 started', at: NOW_SEC - 2 * DAY },
      { operator: 'auto-end', change: 'Set 2 ended', at: NOW_SEC - DAY },
    ]);
    expect(await env.TRIAL_DB.prepare('SELECT COUNT(*) AS n FROM checkout_audit').first('n')).toBe(0);
  });

  it('"Check all links" checks every link and saves nothing', async () => {
    const { fetcher, calls } = fakeProviders();
    const html = await (await handleAdminCheckout(adminPost(editorForm(NODUPE, 'live', defaultConfig('nodupe', 'live'), 0, 'check')), adminEnv(), NOW, fetcher)).text();
    expect(html).toContain('All 4 links are real checkout pages for NoDupe and match their license type. Nothing was saved.');
    expect(calls).toHaveLength(8);
    expect(await env.NODUPE_DB.prepare('SELECT COUNT(*) AS n FROM checkout_config').first('n')).toBe(0);
  });
});
