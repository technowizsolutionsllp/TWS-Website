// The scheduled retention run: for each product's database, apply the trial retention periods and delete telemetry older
// than its period. Used by the tws-retention Worker (workers/retention). No secrets are needed: the statements only
// compare timestamps, and no name, email or key is read or written.

import { purgeStatements } from '../../scripts/telemetry-purge-sql.mjs';
import { PRODUCT_SPECS, productDb } from '../trial/product';
import { runTrialRetention, type TrialRetentionResult } from '../trial/retention';

export type RetentionEnv = { TRIAL_DB?: D1Database; NODUPE_DB?: D1Database };

export type ProductRetentionReport =
  | { product: string; ok: true; trials: TrialRetentionResult; telemetry: { eventsDeleted: number; customersDeleted: number; devicesDeleted: number } }
  | { product: string; ok: false; reason: string };

export async function runRetention(env: RetentionEnv, nowSeconds: number): Promise<ProductRetentionReport[]> {
  const reports: ProductRetentionReport[] = [];
  for (const product of PRODUCT_SPECS) {
    const db = productDb(env as Parameters<typeof productDb>[0], product);
    if (!db) {
      reports.push({ product: product.id, ok: false, reason: 'database_not_bound' });
      continue;
    }
    try {
      const trials = await runTrialRetention(db, nowSeconds);
      const purge = await db.batch(purgeStatements(nowSeconds).map((sql) => db.prepare(sql)));
      const changes = (i: number) => purge[i]?.meta?.changes ?? 0;
      reports.push({ product: product.id, ok: true, trials, telemetry: { eventsDeleted: changes(0), customersDeleted: changes(1), devicesDeleted: changes(2) } });
    } catch (cause) {
      reports.push({ product: product.id, ok: false, reason: String((cause as Error)?.message).slice(0, 120) });
    }
  }
  return reports;
}
