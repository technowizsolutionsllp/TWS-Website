// Query-string handling for /admin/insights: the product and the date range.
// Every day is a UTC day. Invalid input falls back to the defaults and reports why.

export const PRODUCTS = [
  { id: 'pinchpdf', name: 'PinchPDF' },
  { id: 'nodupe', name: 'NoDupe' },
] as const;

export type ProductId = (typeof PRODUCTS)[number]['id'];
export type ProductChoice = ProductId | 'all';

export const DEFAULT_PRODUCT: ProductChoice = 'pinchpdf';
export const MAX_RANGE_DAYS = 366;
export const WEEKLY_OVER_DAYS = 120;
export const DEFAULT_RANGE_DAYS = 30;

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type Range = {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  days: number;
  fromSec: number;
  toSecExclusive: number; // start of the day after `to`
  prevFromSec: number; // same length immediately before `from`
};

export function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function validDay(value: string | null): value is string {
  return value !== null && DATE_PATTERN.test(value) && Number.isFinite(dayStartMs(value)) && dayString(dayStartMs(value)) === value;
}

export function buildRange(from: string, to: string): Range {
  const fromMs = dayStartMs(from);
  const days = Math.round((dayStartMs(to) - fromMs) / DAY_MS) + 1;
  return {
    from,
    to,
    days,
    fromSec: fromMs / 1000,
    toSecExclusive: (dayStartMs(to) + DAY_MS) / 1000,
    prevFromSec: (fromMs - days * DAY_MS) / 1000,
  };
}

export function defaultRange(nowMs: number): Range {
  const today = dayString(nowMs);
  return buildRange(dayString(dayStartMs(today) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS), today);
}

export function isProductChoice(value: string | null): value is ProductChoice {
  return value === 'all' || PRODUCTS.some((p) => p.id === value);
}

export function parseQuery(params: URLSearchParams, nowMs: number): { product: ProductChoice; range: Range; error: string | null } {
  const rawProduct = params.get('product');
  const product = isProductChoice(rawProduct) ? rawProduct : DEFAULT_PRODUCT;
  const fallback = defaultRange(nowMs);
  const today = dayString(nowMs);

  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  if (rawFrom === null && rawTo === null) return { product, range: fallback, error: null };

  const from = rawFrom === null || rawFrom === '' ? fallback.from : rawFrom;
  const to = rawTo === null || rawTo === '' ? fallback.to : rawTo;
  const fail = (error: string) => ({ product, range: fallback, error });

  if (!validDay(from) || !validDay(to)) return fail('Dates must look like 2026-11-21.');
  if (to > today) return fail("The end date can't be in the future.");
  if (from > to) return fail('The start date must be on or before the end date.');
  const range = buildRange(from, to);
  if (range.days > MAX_RANGE_DAYS) return fail(`Ranges are limited to ${MAX_RANGE_DAYS} days. Pick a shorter range.`);
  return { product, range, error: null };
}
