// Reading and writing the checkout setting (one JSON row per mode) and its change history, in the product's own
// database. A missing row means the links built into the app. A row that does not pass the rules is never served:
// the built-in links are used instead and the problem is logged.

import type { ProductId } from '../trial/product';
import { MODES, parseConfig, servable, type CheckoutConfig, type Mode } from './config';
import { defaultConfig } from './defaults';

export type Stored = {
  config: CheckoutConfig;
  /** 0 when nothing is saved yet. */
  version: number;
  updatedAt: number | null;
  source: 'saved' | 'built-in' | 'unreadable';
};

export type AuditRow = { at: number; operator: string; mode: Mode; change: string; before: string; after: string; checked: string; reason: string };

export async function loadConfig(db: D1Database, product: ProductId, mode: Mode): Promise<Stored> {
  const row = await db.prepare('SELECT config, version, updated_at FROM checkout_config WHERE mode = ?1').bind(mode).first<{ config: string; version: number; updated_at: number }>();
  if (!row) return { config: defaultConfig(product, mode), version: 0, updatedAt: null, source: 'built-in' };
  let parsed: CheckoutConfig | null = null;
  try {
    parsed = parseConfig(JSON.parse(row.config));
  } catch {
    parsed = null;
  }
  if (!parsed || !servable(product, mode, parsed)) {
    console.error(JSON.stringify({ svc: 'checkout', result: 'config_unreadable', product, mode, version: row.version }));
    return { config: defaultConfig(product, mode), version: row.version, updatedAt: row.updated_at, source: 'unreadable' };
  }
  return { config: parsed, version: row.version, updatedAt: row.updated_at, source: 'saved' };
}

export async function loadBoth(db: D1Database, product: ProductId): Promise<Record<Mode, Stored>> {
  const [live, test] = await Promise.all(MODES.map((mode) => loadConfig(db, product, mode)));
  return { live, test };
}

export type SaveOutcome = 'saved' | 'stale';

/**
 * Saves a setting if nobody saved this mode since `expectedVersion` was read, and writes the change history in the
 * same batch. Returns 'stale' (and writes nothing) when the version moved on.
 */
export async function saveConfig(db: D1Database, mode: Mode, config: CheckoutConfig, expectedVersion: number, nowSec: number, audit: Omit<AuditRow, 'mode' | 'at'>[]): Promise<SaveOutcome> {
  const json = JSON.stringify(config);
  const write =
    expectedVersion === 0
      ? db.prepare('INSERT OR IGNORE INTO checkout_config (mode, config, version, updated_at) VALUES (?1, ?2, 1, ?3)').bind(mode, json, nowSec)
      : db.prepare('UPDATE checkout_config SET config = ?2, version = version + 1, updated_at = ?3 WHERE mode = ?1 AND version = ?4').bind(mode, json, nowSec, expectedVersion);
  const result = await write.run();
  if ((result.meta?.changes ?? 0) !== 1) return 'stale';
  if (audit.length > 0) {
    await db.batch(
      audit.map((row) =>
        db
          .prepare('INSERT INTO checkout_audit (at, operator, mode, change, before, after, checked, reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
          .bind(nowSec, row.operator, mode, row.change.slice(0, 300), row.before.slice(0, 1000), row.after.slice(0, 1000), row.checked.slice(0, 1000), row.reason.slice(0, 500)),
      ),
    );
  }
  return 'saved';
}

export async function recentAudit(db: D1Database, limit = 20): Promise<AuditRow[]> {
  const rows = await db.prepare('SELECT at, operator, mode, change, before, after, checked, reason FROM checkout_audit ORDER BY at DESC, id DESC LIMIT ?1').bind(limit).all<AuditRow>();
  return rows.results ?? [];
}

/**
 * Records a promotion starting or ending on its own, once, when the admin page next loads (nothing runs on a timer).
 * The row carries the time it happened, not the time it was noticed.
 */
export async function recordScheduleEvents(db: D1Database, configs: Record<Mode, Stored>, nowSec: number): Promise<void> {
  const events: { at: number; operator: string; mode: Mode; change: string; before: string; after: string }[] = [];
  for (const mode of MODES) {
    const { config, source } = configs[mode];
    if (source !== 'saved') continue;
    const fallback = `Set ${config.default_set + 1}: ${config.sets[config.default_set].name}`;
    config.sets.forEach((set, i) => {
      if (i === 0) return;
      const label = `Set ${i + 1}: ${set.name}`;
      if (set.starts_at !== null && set.starts_at <= nowSec) events.push({ at: set.starts_at, operator: 'auto-start', mode, change: `Set ${i + 1} started`, before: fallback, after: label });
      if (set.ends_at !== null && set.ends_at <= nowSec) events.push({ at: set.ends_at, operator: 'auto-end', mode, change: `Set ${i + 1} ended`, before: label, after: fallback });
    });
  }
  if (events.length === 0) return;
  const reasons: Record<string, string> = { 'auto-start': 'Start date reached', 'auto-end': 'End date reached' };
  await db.batch(
    events.map((e) =>
      db
        .prepare(
          `INSERT INTO checkout_audit (at, operator, mode, change, before, after, checked, reason)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, '', ?7
           WHERE NOT EXISTS (SELECT 1 FROM checkout_audit WHERE at = ?1 AND operator = ?2 AND mode = ?3 AND change = ?4)`,
        )
        .bind(e.at, e.operator, e.mode, e.change, e.before, e.after, reasons[e.operator]),
    ),
  );
}
