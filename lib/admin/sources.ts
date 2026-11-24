// Which database each Insights view reads. PinchPDF and NoDupe keep their data in separate D1 databases, so a
// product view reads one database and "All products" reads both and combines the numbers. Counts only.

import { loadEvents, type EventRow } from '../telemetry/db';
import { loadInstallRows } from '../telemetry/installs';
import type { InstallRow } from '../telemetry/compute';
import { PRODUCT_SPECS, productDb, productById, type ProductSpec } from '../trial/product';
import { loadInsights, type Insights, type Labelled } from './insights';
import type { ProductChoice, Range } from './range';

export type SourceEnv = { TRIAL_DB?: D1Database; NODUPE_DB?: D1Database };
export type Source = { product: ProductSpec; db: D1Database };

/** The databases behind a product choice, leaving out any that is not bound in this deployment. */
export function sourcesFor(env: SourceEnv, choice: ProductChoice): Source[] {
  const specs = choice === 'all' ? PRODUCT_SPECS : [productById(choice)].filter((p): p is ProductSpec => !!p);
  return specs.flatMap((product) => {
    const db = productDb(env as Parameters<typeof productDb>[0], product);
    return db ? [{ product, db }] : [];
  });
}

/** Products in the choice whose database is missing (so a page can say so instead of silently showing less). */
export function missingSources(env: SourceEnv, choice: ProductChoice): ProductSpec[] {
  const have = new Set(sourcesFor(env, choice).map((s) => s.product.id));
  const wanted = choice === 'all' ? PRODUCT_SPECS : PRODUCT_SPECS.filter((p) => p.id === choice);
  return wanted.filter((p) => !have.has(p.id));
}

function mergeLabels(lists: Labelled[][], top = 6): Labelled[] {
  const sums = new Map<string, number>();
  for (const list of lists) for (const item of list) sums.set(item.label, (sums.get(item.label) ?? 0) + item.count);
  return [...sums].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, top);
}

const add = (...lists: number[][]) => lists[0].map((_, i) => lists.reduce((sum, list) => sum + (list[i] ?? 0), 0));

/** Combines per-product Insights (same range) into the "All products" view. */
export function mergeInsights(parts: Insights[]): Insights {
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const histogram = new Map<number, number>();
  for (const part of parts) for (const h of part.usesHistogram) histogram.set(h.used, (histogram.get(h.used) ?? 0) + h.count);
  const available = parts.flatMap((p) => (p.requests.available ? [p.requests] : []));
  const sum = (pick: (i: Insights) => number) => parts.reduce((total, p) => total + pick(p), 0);
  return {
    ...first,
    product: 'all',
    productColumn: parts.every((p) => p.productColumn),
    allTimeAtEnd: sum((p) => p.allTimeAtEnd),
    current: {
      total: sum((p) => p.current.total),
      active: sum((p) => p.current.active),
      exhausted: sum((p) => p.current.exhausted),
      revoked: sum((p) => p.current.revoked),
      reset: sum((p) => p.current.reset),
    },
    cohort: {
      n: sum((p) => p.cohort.n),
      previousN: sum((p) => p.cohort.previousN),
      usedAtLeastOnce: sum((p) => p.cohort.usedAtLeastOnce),
      exhausted: sum((p) => p.cohort.exhausted),
      revokedOrReset: sum((p) => p.cohort.revokedOrReset),
    },
    registrations: parts.flatMap((p) => p.registrations),
    usesHistogram: [...histogram].map(([used, count]) => ({ used, count })).sort((a, b) => a.used - b.used),
    appVersions: mergeLabels(parts.map((p) => p.appVersions)),
    osBuilds: mergeLabels(parts.map((p) => p.osBuilds)),
    requests:
      available.length === 0
        ? { available: false }
        : {
            available: true,
            firstDay: available.map((r) => r.firstDay).filter((d): d is string => !!d).sort()[0] ?? null,
            total: available.reduce((t, r) => t + r.total, 0),
            errors: available.reduce((t, r) => t + r.errors, 0),
            byEndpoint: first.requests.available
              ? first.requests.byEndpoint.map((e, i) => ({ endpoint: e.endpoint, values: add(...available.map((r) => r.byEndpoint[i].values)) }))
              : available[0].byEndpoint,
            registerOutcomes: mergeLabels(available.map((r) => r.registerOutcomes), 50),
          },
  };
}

/** Trials-tab numbers for a product choice. */
export async function loadInsightsFor(env: SourceEnv, range: Range, choice: ProductChoice, nowMs: number): Promise<Insights> {
  const sources = sourcesFor(env, choice);
  if (sources.length === 0) throw new Error('no database is bound for this product choice');
  const parts = await Promise.all(sources.map((s) => loadInsights(s.db, range, s.product.id, nowMs)));
  const merged = mergeInsights(parts);
  return choice === 'all' ? merged : { ...merged, product: choice };
}

/** Buy and license events from every selected product's database, oldest first. */
export async function loadEventsFor(env: SourceEnv, choice: ProductChoice): Promise<EventRow[]> {
  const lists = await Promise.all(sourcesFor(env, choice).map((s) => loadEvents(s.db)));
  return lists.flat().sort((a, b) => a.occurred_at - b.occurred_at);
}

export async function loadInstallRowsFor(env: SourceEnv, choice: ProductChoice): Promise<InstallRow[]> {
  const lists = await Promise.all(sourcesFor(env, choice).map((s) => loadInstallRows(s.db)));
  return lists.flat().sort((a, b) => a.occurred_at - b.occurred_at);
}
