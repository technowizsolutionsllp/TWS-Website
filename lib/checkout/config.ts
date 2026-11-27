// The checkout-links setting of one product and mode, and the rules a saved setting must follow.
//
// A setting has a primary provider (the other is the backup), a Force switch (open only the primary, never the
// backup), a default link set, and 1 to 4 link sets. Set 1 holds the standard links. Sets 2 to 4 may carry a start
// and an end (each optional): such a set is a promotion and runs by itself between them. In every set each provider
// has two links, one per license type, and the admin chooses each link's license type. An empty link in sets 2 to 4
// uses set 1's link of the same license type. The same rules run on the admin page and on every read, so a hand-edited
// database row can never send a buyer somewhere the page would have refused. See docs/CHECKOUT_LINKS.md.

import type { ProductId } from '../trial/product';

export const MODES = ['live', 'test'] as const;
export type Mode = (typeof MODES)[number];
export const PROVIDERS = ['dodo', 'lemon_squeezy'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const TIERS = ['individual', 'business'] as const;
export type Tier = (typeof TIERS)[number];

export const MODE_NAMES: Record<Mode, string> = { live: 'Live', test: 'Test' };
export const PROVIDER_NAMES: Record<Provider, string> = { dodo: 'Dodo Payments', lemon_squeezy: 'Lemon Squeezy' };
export const TIER_NAMES: Record<Tier, string> = { individual: 'Individual', business: 'Business' };

export const MAX_SETS = 4;
export const MAX_URL_LENGTH = 512;
export const MAX_NAME_LENGTH = 60;
const YEAR_SECONDS = 366 * 86_400;

export type LinkRow = { type: Tier; url: string };
export type LinkSet = {
  name: string;
  /** Unix seconds, UTC. Sets 2-4 only. null = no start (runs from when it is saved). */
  starts_at: number | null;
  /** Unix seconds, UTC. Sets 2-4 only. null = no end. */
  ends_at: number | null;
  /** Two links per provider; the admin chooses each one's license type. */
  links: Record<Provider, [LinkRow, LinkRow]>;
};
export type CheckoutConfig = {
  primary: Provider;
  force: boolean;
  /** Index of the set buyers get when no promotion runs. Must be a set without dates. */
  default_set: number;
  sets: LinkSet[];
};

export const isMode = (value: unknown): value is Mode => value === 'live' || value === 'test';
export const isTier = (value: unknown): value is Tier => value === 'individual' || value === 'business';
export const isProvider = (value: unknown): value is Provider => value === 'dodo' || value === 'lemon_squeezy';
export const otherProvider = (p: Provider): Provider => (p === 'dodo' ? 'lemon_squeezy' : 'dodo');
export const otherTier = (t: Tier): Tier => (t === 'individual' ? 'business' : 'individual');
export const otherMode = (m: Mode): Mode => (m === 'live' ? 'test' : 'live');

// ------------------------------------------------------------------ what each product accepts

/** Dodo checkout hosts. A live link on the test host, or the reverse, is refused: that is Dodo's test/live separation. */
export const DODO_HOST: Record<Mode, string> = { live: 'checkout.dodopayments.com', test: 'test.checkout.dodopayments.com' };

/**
 * The Dodo products each app accepts keys from at activation. A link to any other Dodo product is refused: the app
 * would refuse the buyer's key. Adding a product is a code change made together with the app release that accepts it.
 * NoDupe has no Dodo test products.
 */
export const DODO_PRODUCTS: Record<ProductId, Record<Mode, Record<Tier, string | null>>> = {
  pinchpdf: {
    live: { individual: 'pdt_0Nplqin1uobNhVKSJLImM', business: 'pdt_0NplrzQavP5dhhEM7juVK' },
    test: { individual: 'pdt_0NpH4a2Ken4XQYwdqsupO', business: 'pdt_0NplruuBGvxKzjtN7cqFu' },
  },
  nodupe: {
    live: { individual: 'pdt_0Nspl8zc3NQ4lVqcDfd1V', business: 'pdt_0NspmmDgbLHobIoeUvOZC' },
    test: { individual: null, business: null },
  },
};

/** Lemon Squeezy stores (`<store>.lemonsqueezy.com`) each product sells from. */
export const LEMON_STORES: Record<ProductId, readonly string[]> = { pinchpdf: ['technowizsolutions'], nodupe: ['anshul'] };

/** The query parameter that pre-fills a discount code on each provider's checkout. */
export const DISCOUNT_PARAM: Record<Provider, string> = { dodo: 'discount_code', lemon_squeezy: 'checkout[discount_code]' };
const DISCOUNT_CODE = /^[A-Za-z0-9_-]{1,40}$/;
const LEMON_PATH = /^\/checkout\/buy\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const DODO_PATH = /^\/buy\/(pdt_[A-Za-z0-9]+)$/;

export type ParsedLink = { url: URL; provider: Provider; productId: string | null; store: string | null; uuid: string | null; discountCode: string | null };

/**
 * Checks one link against the format rules. Returns null when it is acceptable, otherwise the reason in words the
 * admin page shows. An empty link is acceptable (the caller decides whether one is needed).
 */
export function checkUrl(product: ProductId, mode: Mode, tier: Tier, provider: Provider, url: string): string | null {
  if (url === '') return null;
  const productName = product === 'pinchpdf' ? 'PinchPDF' : 'NoDupe';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'This is not a web address. Paste the full checkout link, starting with https://';
  }
  if (u.protocol !== 'https:') return 'Use an https:// link.';
  if (u.username || u.password) return 'Remove the user name or password from the link.';
  if (u.port) return 'Remove the port number from the link.';
  if (u.hash || url.includes('#')) return 'Remove the part after # from the link.';
  if (url.length > MAX_URL_LENGTH) return `The link is longer than ${MAX_URL_LENGTH} characters.`;
  if (/\s/.test(url)) return 'Remove the spaces from the link.';
  const extra: string[] = [];
  const seen = new Set<string>();
  u.searchParams.forEach((value, key) => {
    if (seen.has(key)) extra.push(key);
    seen.add(key);
    if (provider === 'dodo' && key === 'quantity' && value === '1') return;
    if (key === DISCOUNT_PARAM[provider] && DISCOUNT_CODE.test(value)) return;
    extra.push(key);
  });
  if (extra.length > 0) {
    return `Only ${provider === 'dodo' ? '?quantity=1 and ' : ''}${DISCOUNT_PARAM[provider]}=<code> (1 to 40 letters, digits, - or _) may follow the link. Remove: ${[...new Set(extra)].join(', ')}.`;
  }
  if (provider === 'dodo') {
    const other = otherMode(mode);
    if (u.hostname === DODO_HOST[other]) return `This is a ${other} Dodo link. Put it on the ${MODE_NAMES[other]} tab.`;
    if (u.hostname !== DODO_HOST[mode]) return `A ${mode} Dodo link must be on ${DODO_HOST[mode]}.`;
    const match = u.pathname.match(DODO_PATH);
    if (!match) return 'A Dodo checkout link looks like /buy/pdt_… .';
    const ids = DODO_PRODUCTS[product][mode];
    const ot = otherTier(tier);
    if (ids[ot] && match[1] === ids[ot]) return `This is the ${TIER_NAMES[ot]} product, but the license type says ${TIER_NAMES[tier]}. Change the license type to ${TIER_NAMES[ot]}.`;
    if (match[1] !== ids[tier]) {
      return `${productName} does not accept keys from Dodo product ${match[1]} (${MODE_NAMES[mode]}, ${TIER_NAMES[tier]}). Release an app that accepts it first, or use a discount code on the existing product.`;
    }
    return null;
  }
  const host = u.hostname.match(/^([a-z0-9-]+)\.lemonsqueezy\.com$/);
  if (!host) return 'A Lemon Squeezy link must be on <store>.lemonsqueezy.com.';
  if (!LEMON_STORES[product].includes(host[1])) return `The store "${host[1]}" is not a ${productName} store. Allowed: ${LEMON_STORES[product].join(', ')}.`;
  if (!LEMON_PATH.test(u.pathname)) return 'A Lemon Squeezy checkout link looks like /checkout/buy/<id>.';
  return null;
}

/** The parts of a link that passed checkUrl. */
export function parseLink(provider: Provider, url: string): ParsedLink {
  const u = new URL(url);
  return {
    url: u,
    provider,
    productId: provider === 'dodo' ? (u.pathname.match(DODO_PATH)?.[1] ?? null) : null,
    store: provider === 'lemon_squeezy' ? u.hostname.split('.')[0] : null,
    uuid: provider === 'lemon_squeezy' ? (u.pathname.match(LEMON_PATH)?.[1] ?? null) : null,
    discountCode: u.searchParams.get(DISCOUNT_PARAM[provider]),
  };
}

// ------------------------------------------------------------------ schedule

export const isDated = (set: LinkSet | undefined) => !!set && (set.starts_at !== null || set.ends_at !== null);
export const hasEnded = (set: LinkSet, nowSec: number) => set.ends_at !== null && set.ends_at <= nowSec;
export const notStarted = (set: LinkSet, nowSec: number) => set.starts_at !== null && set.starts_at > nowSec;

/** The promotion running now (index), or -1. */
export function runningSet(config: CheckoutConfig, nowSec: number): number {
  for (let i = 1; i < config.sets.length; i += 1) {
    const set = config.sets[i];
    if (!isDated(set)) continue;
    if ((set.starts_at ?? -Infinity) <= nowSec && nowSec < (set.ends_at ?? Infinity)) return i;
  }
  return -1;
}

/** The set buyers get now: a running promotion, otherwise the default set. */
export function activeSet(config: CheckoutConfig, nowSec: number): number {
  const running = runningSet(config, nowSec);
  return running >= 0 ? running : config.default_set;
}

/** Promotions that are running or still to come, in start order. */
export function promotions(config: CheckoutConfig, nowSec: number): number[] {
  return config.sets
    .map((_, i) => i)
    .filter((i) => i > 0 && isDated(config.sets[i]) && !hasEnded(config.sets[i], nowSec))
    .sort((a, b) => (config.sets[a].starts_at ?? 0) - (config.sets[b].starts_at ?? 0));
}

/** Every set buyers can get: the default and each running or future promotion. */
export function usedSets(config: CheckoutConfig, nowSec: number): number[] {
  const out = [config.default_set];
  for (const i of promotions(config, nowSec)) if (!out.includes(i)) out.push(i);
  return out;
}

// ------------------------------------------------------------------ links

export function rowOf(set: LinkSet, tier: Tier, provider: Provider): number {
  return set.links[provider].findIndex((row) => row.type === tier);
}

export function urlOf(set: LinkSet, tier: Tier, provider: Provider): string {
  const r = rowOf(set, tier, provider);
  return r < 0 ? '' : set.links[provider][r].url;
}

/** The link of a license and provider in a set: its own, or set 1's when a set 2-4 link is empty. */
export function effective(config: CheckoutConfig, index: number, tier: Tier, provider: Provider): { url: string; from: number; row: number } {
  const own = urlOf(config.sets[index], tier, provider);
  if (own || index === 0) return { url: own, from: index, row: rowOf(config.sets[index], tier, provider) };
  return { url: urlOf(config.sets[0], tier, provider), from: 0, row: rowOf(config.sets[0], tier, provider) };
}

export type Resolved = { url: string | null; provider: Provider | null; via: 'primary' | 'backup' | 'none' };

/** What a buyer of `tier` opens now: the primary, else the backup unless Force is on. */
export function resolveCheckout(config: CheckoutConfig, tier: Tier, nowSec: number): Resolved {
  const set = activeSet(config, nowSec);
  const primary = effective(config, set, tier, config.primary).url;
  if (primary) return { url: primary, provider: config.primary, via: 'primary' };
  if (config.force) return { url: null, provider: null, via: 'none' };
  const backup = effective(config, set, tier, otherProvider(config.primary)).url;
  return backup ? { url: backup, provider: otherProvider(config.primary), via: 'backup' } : { url: null, provider: null, via: 'none' };
}

// ------------------------------------------------------------------ validation

export type ConfigErrors = {
  /** Keyed `<set>.<provider>.<row>`. */
  fields: Record<string, string>;
  /** Keys whose problem is the license type (the page marks the type choice, not the link). */
  types: Record<string, true>;
  names: Record<number, string>;
  dates: Record<number, string>;
  order: string | null;
  defaultSet: string | null;
};

export const linkKey = (set: number, provider: Provider, row: number) => `${set}.${provider}.${row}`;

export function errorCount(errors: ConfigErrors): number {
  return Object.keys(errors.fields).length + Object.keys(errors.names).length + Object.keys(errors.dates).length + (errors.order ? 1 : 0) + (errors.defaultSet ? 1 : 0);
}

export function errorsInSet(errors: ConfigErrors, index: number): number {
  const fields = Object.keys(errors.fields).filter((key) => key.split('.')[0] === String(index)).length;
  return fields + (errors.names[index] ? 1 : 0) + (errors.dates[index] ? 1 : 0);
}

export function setName(config: CheckoutConfig, index: number): string {
  const name = config.sets[index]?.name.trim();
  return name || (index === 0 ? 'Standard' : 'New set');
}

export const setLabel = (config: CheckoutConfig, index: number) => `Set ${index + 1}: ${setName(config, index)}`;

export function fmtUtc(seconds: number): string {
  const d = new Date(seconds * 1000);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function spanText(set: LinkSet): string {
  return `${set.starts_at === null ? 'Now' : fmtUtc(set.starts_at)} → ${set.ends_at === null ? 'no end' : fmtUtc(set.ends_at)} UTC`;
}

/**
 * Every rule a setting must meet before it is saved. `saved` is the setting now in the database for this mode (dates
 * it already had may be in the past), `otherModeUrls` the links saved on the other tab (a link may not be in both).
 */
export function validateConfig(product: ProductId, mode: Mode, config: CheckoutConfig, saved: CheckoutConfig, otherModeUrls: string[], nowSec: number): ConfigErrors {
  const errors: ConfigErrors = { fields: {}, types: {}, names: {}, dates: {}, order: null, defaultSet: null };

  config.sets.forEach((set, i) => {
    if (i === 0) return;
    const wasEnd = saved.sets[i]?.ends_at ?? null;
    const wasStart = saved.sets[i]?.starts_at ?? null;
    const { starts_at: start, ends_at: end } = set;
    if (start !== null && start !== wasStart && start > nowSec + YEAR_SECONDS) errors.dates[i] = 'The start must be within a year.';
    else if (end !== null && end !== wasEnd && end <= nowSec) errors.dates[i] = 'The end must be in the future.';
    else if (end !== null && end > nowSec + YEAR_SECONDS) errors.dates[i] = 'The end must be within a year.';
    else if (start !== null && end !== null && start >= end) errors.dates[i] = 'The start must be before the end.';
  });

  if (isDated(config.sets[config.default_set])) {
    errors.defaultSet = `${setLabel(config, config.default_set)} has dates, so it runs by itself and cannot be the default. Choose another set, or clear its dates.`;
  }

  // Promotions may not overlap. A missing start counts from now; a missing end never ends. Ended sets are ignored.
  const spans = config.sets.flatMap((set, i) =>
    i === 0 || !isDated(set) || errors.dates[i] || hasEnded(set, nowSec) ? [] : [{ i, b: Math.max(set.starts_at ?? -Infinity, nowSec), e: set.ends_at ?? Infinity }],
  );
  for (const a of spans) {
    for (const b of spans) {
      if (a.i < b.i && a.b < b.e && b.b < a.e && !errors.dates[b.i]) {
        errors.dates[b.i] = `These dates overlap ${setLabel(config, a.i)} (${spanText(config.sets[a.i])}). Promotions cannot overlap.`;
      }
    }
  }

  config.sets.forEach((set, i) => {
    const name = set.name.trim();
    if (i > 0 && name.length < 2) errors.names[i] = 'Give the set a name of 2 to 60 characters, e.g. "Black Friday 2026".';
    else if (name.length > MAX_NAME_LENGTH) errors.names[i] = `Keep the name to ${MAX_NAME_LENGTH} characters.`;
    for (const provider of PROVIDERS) {
      set.links[provider].forEach((link, r) => {
        const mate = set.links[provider][1 - r];
        const key = linkKey(i, provider, r);
        let error: string | null = null;
        if (link.type === mate.type) {
          error = `Both ${PROVIDER_NAMES[provider]} links are ${TIER_NAMES[link.type]}. Each provider needs one Individual and one Business link.`;
          errors.types[key] = true;
        }
        if (!error) {
          error = checkUrl(product, mode, link.type, provider, link.url);
          if (error && /license type/.test(error)) errors.types[key] = true;
        }
        if (!error && link.url && link.url === mate.url) error = 'The Individual and Business links cannot be the same link.';
        if (!error && link.url && otherModeUrls.includes(link.url)) error = `This link is already saved on the ${MODE_NAMES[otherMode(mode)]} tab. Live and Test need different links.`;
        if (error) errors.fields[key] = error;
      });
    }
  });

  // Every set buyers can get needs both of the primary's links (after set 1's are filled in).
  for (const n of usedSets(config, nowSec)) {
    const missing = TIERS.filter((t) => !effective(config, n, t, config.primary).url);
    if (missing.length === 0) continue;
    const what = `${missing.map((t) => TIER_NAMES[t]).join(' or ')} link`;
    errors.order = `${PROVIDER_NAMES[config.primary]} cannot be the primary: ${n === 0 ? `set 1 has no ${what} for it.` : `neither set ${n + 1} nor set 1 has a ${what} for it.`} Add the link, or choose the other provider.`;
    break;
  }
  return errors;
}

/** Every saved link in a setting (for the "not on both tabs" rule). */
export function allUrls(config: CheckoutConfig): string[] {
  return config.sets.flatMap((set) => PROVIDERS.flatMap((p) => set.links[p].map((row) => row.url))).filter(Boolean);
}

// ------------------------------------------------------------------ the stored JSON

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isTime = (value: unknown): value is number | null => value === null || (Number.isSafeInteger(value) && (value as number) > 0);

/** Reads a stored or posted setting. Returns null for anything that is not exactly the expected shape. */
export function parseConfig(value: unknown): CheckoutConfig | null {
  if (!isObject(value) || !isProvider(value.primary) || typeof value.force !== 'boolean' || !Array.isArray(value.sets)) return null;
  const count = value.sets.length;
  if (count < 1 || count > MAX_SETS || !Number.isInteger(value.default_set) || (value.default_set as number) < 0 || (value.default_set as number) >= count) return null;
  const sets: LinkSet[] = [];
  for (const [i, raw] of value.sets.entries()) {
    if (!isObject(raw) || typeof raw.name !== 'string' || raw.name.length > 200 || !isTime(raw.starts_at) || !isTime(raw.ends_at) || !isObject(raw.links)) return null;
    if (i === 0 && (raw.starts_at !== null || raw.ends_at !== null)) return null;
    const links = {} as LinkSet['links'];
    for (const provider of PROVIDERS) {
      const rows = raw.links[provider];
      if (!Array.isArray(rows) || rows.length !== 2) return null;
      const parsed = rows.map((row) => (isObject(row) && isTier(row.type) && typeof row.url === 'string' && row.url.length <= 2048 ? { type: row.type, url: row.url } : null));
      if (parsed.some((row) => row === null)) return null;
      links[provider] = parsed as [LinkRow, LinkRow];
    }
    sets.push({ name: raw.name, starts_at: raw.starts_at, ends_at: raw.ends_at, links });
  }
  return { primary: value.primary, force: value.force, default_set: value.default_set as number, sets };
}

/** A setting is safe to serve only if it passes every rule that does not depend on the clock or the other tab. */
export function servable(product: ProductId, mode: Mode, config: CheckoutConfig): boolean {
  return config.sets.every((set) =>
    PROVIDERS.every((p) => set.links[p][0].type !== set.links[p][1].type && set.links[p].every((row) => checkUrl(product, mode, row.type, p, row.url) === null)),
  );
}

export function emptySet(name = ''): LinkSet {
  const pair = (): [LinkRow, LinkRow] => [
    { type: 'individual', url: '' },
    { type: 'business', url: '' },
  ];
  return { name, starts_at: null, ends_at: null, links: { dodo: pair(), lemon_squeezy: pair() } };
}

export function sameConfig(a: CheckoutConfig, b: CheckoutConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
