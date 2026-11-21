// Aggregate numbers for /admin/insights. Everything returned is a count: no names, emails,
// device hashes or trial ids ever leave the database through this module.

import { PRODUCTS, WEEKLY_OVER_DAYS, dayString, type ProductChoice, type ProductId, type Range } from './range';

const DAY_SEC = 86_400;
const ERROR_OUTCOMES = new Set(['unavailable', 'rate_limited', 'error', 'db_error']);
export const ENDPOINTS = ['challenge', 'register', 'usage'] as const;

export type Labelled = { label: string; count: number };

export type Insights = {
  range: Range;
  product: ProductChoice;
  weekly: boolean;
  generatedAt: string;
  /** false while migration 0002 is missing: every trial is then counted as PinchPDF. */
  productColumn: boolean;
  allTimeAtEnd: number;
  current: { total: number; active: number; exhausted: number; revoked: number; reset: number };
  cohort: { n: number; previousN: number; usedAtLeastOnce: number; exhausted: number; revokedOrReset: number };
  buckets: string[]; // one label per day, or per week when the range is long
  registrations: { product: ProductId; values: number[] }[];
  usesHistogram: { used: number; count: number }[];
  appVersions: Labelled[];
  osBuilds: Labelled[];
  requests:
    | { available: false }
    | {
        available: true;
        firstDay: string | null;
        total: number;
        errors: number;
        byEndpoint: { endpoint: (typeof ENDPOINTS)[number]; values: number[] }[];
        registerOutcomes: Labelled[];
      };
};

type Row = Record<string, number | string | null>;
const num = (value: unknown) => (typeof value === 'number' ? value : 0);

function bucketIndex(dayIndex: number, weekly: boolean) {
  return weekly ? Math.floor(dayIndex / 7) : dayIndex;
}

/** Whether trials.product exists (added by migration 0002). */
async function hasProductColumn(db: D1Database): Promise<boolean> {
  const { results } = await db.prepare('PRAGMA table_info(trials)').all<{ name: string }>();
  return (results ?? []).some((column) => column.name === 'product');
}

export async function loadInsights(db: D1Database, range: Range, product: ProductChoice, nowMs: number): Promise<Insights> {
  // Before migration 0002 the page still has to open: the product is then a constant.
  const productColumn = await hasProductColumn(db);
  const col = productColumn ? 'product' : "'pinchpdf'";
  const P = product === 'all' ? '' : ` AND ${col} = ?`;
  const pb: string[] = product === 'all' ? [] : [product];
  const cohort = `created_at >= ? AND created_at < ?${P}`;
  const cb = [range.fromSec, range.toSecExclusive, ...pb];
  const weekly = range.days > WEEKLY_OVER_DAYS;

  const top = (column: 'app_version' | 'os_build') =>
    db
      .prepare(`SELECT COALESCE(${column}, 'unknown') AS label, COUNT(*) AS c FROM trials WHERE ${cohort} GROUP BY label ORDER BY c DESC, label LIMIT 6`)
      .bind(...cb);

  const results = await db.batch([
    db.prepare(`SELECT COUNT(*) AS c FROM trials WHERE created_at < ?${P}`).bind(range.toSecExclusive, ...pb),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status = 'active' AND used < limit_total), 0) AS active,
                COALESCE(SUM(status = 'active' AND used >= limit_total), 0) AS exhausted,
                COALESCE(SUM(status = 'revoked'), 0) AS revoked,
                COALESCE(SUM(status = 'reset'), 0) AS reset
           FROM trials WHERE 1 = 1${P}`,
      )
      .bind(...pb),
    db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(used > 0), 0) AS used1,
                COALESCE(SUM(status = 'active' AND used >= limit_total), 0) AS exhausted,
                COALESCE(SUM(status IN ('revoked', 'reset')), 0) AS gone
           FROM trials WHERE ${cohort}`,
      )
      .bind(...cb),
    db.prepare(`SELECT COUNT(*) AS n FROM trials WHERE created_at >= ? AND created_at < ?${P}`).bind(range.prevFromSec, range.fromSec, ...pb),
    db.prepare(`SELECT created_at / ${DAY_SEC} AS d, ${col} AS product, COUNT(*) AS c FROM trials WHERE ${cohort} GROUP BY d, product`).bind(...cb),
    db.prepare(`SELECT used, COUNT(*) AS c FROM trials WHERE ${cohort} GROUP BY used ORDER BY used`).bind(...cb),
    top('app_version'),
    top('os_build'),
  ]);
  const rows = (index: number) => (results[index].results ?? []) as Row[];

  const bucketCount = weekly ? Math.ceil(range.days / 7) : range.days;
  const startDay = range.fromSec / DAY_SEC;
  const buckets = Array.from({ length: bucketCount }, (_, i) => dayString((range.fromSec + i * (weekly ? 7 : 1) * DAY_SEC) * 1000).slice(5));

  const shown: ProductId[] = product === 'all' ? PRODUCTS.map((p) => p.id) : [product];
  const registrations = shown.map((id) => ({ product: id, values: new Array<number>(bucketCount).fill(0) }));
  for (const row of rows(4)) {
    const target = registrations.find((r) => r.product === row.product);
    const index = bucketIndex(num(row.d) - startDay, weekly);
    if (target && index >= 0 && index < bucketCount) target.values[index] += num(row.c);
  }

  const first = rows(2)[0] ?? {};
  const now = rows(1)[0] ?? {};

  return {
    range,
    product,
    weekly,
    generatedAt: new Date(nowMs).toISOString(),
    productColumn,
    allTimeAtEnd: num(rows(0)[0]?.c),
    current: { total: num(now.total), active: num(now.active), exhausted: num(now.exhausted), revoked: num(now.revoked), reset: num(now.reset) },
    cohort: {
      n: num(first.n),
      previousN: num(rows(3)[0]?.n),
      usedAtLeastOnce: num(first.used1),
      exhausted: num(first.exhausted),
      revokedOrReset: num(first.gone),
    },
    buckets,
    registrations,
    usesHistogram: rows(5).map((r) => ({ used: num(r.used), count: num(r.c) })),
    appVersions: rows(6).map((r) => ({ label: String(r.label), count: num(r.c) })),
    osBuilds: rows(7).map((r) => ({ label: String(r.label), count: num(r.c) })),
    requests: await loadRequests(db, range, P, pb, bucketCount, weekly),
  };
}

async function loadRequests(db: D1Database, range: Range, P: string, pb: string[], bucketCount: number, weekly: boolean): Promise<Insights['requests']> {
  try {
    const [counts, firstDay] = await db.batch([
      db
        .prepare(`SELECT day, endpoint, outcome, SUM(count) AS c FROM metrics_daily WHERE day >= ? AND day <= ?${P} GROUP BY day, endpoint, outcome`)
        .bind(range.from, range.to, ...pb),
      db.prepare(`SELECT MIN(day) AS d FROM metrics_daily WHERE 1 = 1${P}`).bind(...pb),
    ]);
    const byEndpoint = ENDPOINTS.map((endpoint) => ({ endpoint, values: new Array<number>(bucketCount).fill(0) }));
    const outcomes = new Map<string, number>();
    let total = 0;
    let errors = 0;
    for (const row of (counts.results ?? []) as Row[]) {
      const count = num(row.c);
      total += count;
      if (ERROR_OUTCOMES.has(String(row.outcome))) errors += count;
      if (row.endpoint === 'register') outcomes.set(String(row.outcome), (outcomes.get(String(row.outcome)) ?? 0) + count);
      const target = byEndpoint.find((e) => e.endpoint === row.endpoint);
      const dayIndex = Math.round((Date.parse(`${row.day}T00:00:00Z`) / 1000 - range.fromSec) / DAY_SEC);
      const index = bucketIndex(dayIndex, weekly);
      if (target && index >= 0 && index < bucketCount) target.values[index] += count;
    }
    return {
      available: true,
      firstDay: ((firstDay.results ?? [])[0] as Row | undefined)?.d?.toString() ?? null,
      total,
      errors,
      byEndpoint,
      registerOutcomes: [...outcomes].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    };
  } catch {
    return { available: false }; // migration 0002 not applied yet
  }
}
