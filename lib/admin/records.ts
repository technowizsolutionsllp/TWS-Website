// Find and delete trial records (the people behind free trials) for the admin page and the admin JSON API.
//
// Name and email are stored encrypted (lib/trial/pii.ts), so a search cannot be done in SQL: an exact email goes through
// the blind index, anything else is matched after decrypting the newest rows. Every record whose name or email is shown
// is written to trial_audit ('view-contact'), and every deletion is audited in the same batch as the change. The audit
// rows hold the previous counts and status, never a name, email or hash. Same actions as scripts/trial-admin.mjs
// (erase-contact, delete-all), so the audit trail reads the same whichever way it was done.

import { decryptField, emailBlindIndex } from '../trial/pii';
import type { TrialEnv } from '../trial/config';
import { SCAN_MODES, type ProductSpec, type ScanCounts } from '../trial/product';

export type RecordsEnv = { PII_KEY?: string; PEPPER_EMAIL?: string };

export const MIN_QUERY_LENGTH = 3;
export const MAX_QUERY_LENGTH = 100;
export const MAX_RESULTS = 25;
/** How many of the newest records a free-text search decrypts. An exact email does not have this limit. */
export const SEARCH_SCAN_LIMIT = 20_000;
export const MAX_REASON_LENGTH = 500;
export const MIN_REASON_LENGTH = 3;

export type DeleteAction = 'erase_contact' | 'delete';
export const DELETE_ACTIONS: readonly DeleteAction[] = ['erase_contact', 'delete'];
const AUDIT_ACTION: Record<DeleteAction, string> = { erase_contact: 'erase-contact', delete: 'delete-all' };

export type TrialRecord = {
  product: ProductSpec['id'];
  id: string;
  support_ref: string;
  name: string | null;
  email: string | null;
  status: string;
  used: number;
  limit_total: number;
  /** NoDupe only. */
  modes: { used: ScanCounts; limit: ScanCounts } | null;
  created_at: number;
  last_server_contact_at: number;
  /** Revision 5: each time the trial was continued on its computer under a new install key, oldest first. */
  restores: { at: number; matched_by: string }[];
};

export type SearchResult = { results: TrialRecord[]; truncated: boolean; capped: boolean };

type Row = {
  id: string;
  support_ref: string;
  status: string;
  used: number;
  limit_total: number;
  created_at: number;
  last_server_contact_at: number;
  name_enc: string | null;
  email_enc: string | null;
  used_basic?: number;
  used_similar?: number;
  used_deep?: number;
  limit_basic?: number;
  limit_similar?: number;
  limit_deep?: number;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const columns = (product: ProductSpec) =>
  `id, support_ref, status, used, limit_total, created_at, last_server_contact_at, name_enc, email_enc${product.perMode ? ', used_basic, used_similar, used_deep, limit_basic, limit_similar, limit_deep' : ''}`;

/** A query is usable when it has at least three characters once trimmed; returns the cleaned query or null. */
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim().replace(/\s+/g, ' ');
  if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH || /[\u0000-\u001f\u007f]/.test(q)) return null;
  return q;
}

/** A deletion needs a reason an operator can read later: printable text of 3 to 500 characters. */
export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const reason = raw.trim();
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH || /[\u0000-\u001f\u007f]/.test(reason)) return null;
  return reason;
}

export const isTrialId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

function piiEnv(env: RecordsEnv): TrialEnv {
  if (!env.PII_KEY || !env.PEPPER_EMAIL) throw new Error('PII_KEY and PEPPER_EMAIL are required');
  return env as unknown as TrialEnv;
}

async function toRecord(env: TrialEnv, product: ProductSpec, row: Row, decrypted?: { name: string | null; email: string | null }): Promise<TrialRecord> {
  const name = decrypted ? decrypted.name : row.name_enc ? await decryptField(env, row.id, 'name', row.name_enc) : null;
  const email = decrypted ? decrypted.email : row.email_enc ? await decryptField(env, row.id, 'email', row.email_enc) : null;
  return {
    product: product.id,
    id: row.id,
    support_ref: row.support_ref,
    name,
    email,
    status: row.status,
    used: row.used,
    limit_total: row.limit_total,
    modes: product.perMode
      ? {
          used: { basic: row.used_basic ?? 0, similar: row.used_similar ?? 0, deep: row.used_deep ?? 0 },
          limit: { basic: row.limit_basic ?? 0, similar: row.limit_similar ?? 0, deep: row.limit_deep ?? 0 },
        }
      : null,
    created_at: row.created_at,
    last_server_contact_at: row.last_server_contact_at,
    restores: [],
  };
}

/** Adds each record's restores (trial_audit 'restore' rows written by the trial service) to the records. */
async function addRestores(db: D1Database, records: TrialRecord[]): Promise<void> {
  if (records.length === 0) return;
  const marks = records.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT trial_id, at, reason FROM trial_audit WHERE action = 'restore' AND trial_id IN (${marks}) ORDER BY at, id`)
    .bind(...records.map((r) => r.id))
    .all<{ trial_id: string; at: number; reason: string }>();
  for (const row of results) records.find((r) => r.id === row.trial_id)?.restores.push({ at: row.at, matched_by: row.reason });
}

/**
 * Finds trial records in one product's database by email, name, support reference or trial id.
 * An exact email address uses the index. Anything else is a case-insensitive "contains" match on the decrypted name and
 * email of the newest SEARCH_SCAN_LIMIT records, or an exact match on the support reference or the trial id.
 * The records returned are written to trial_audit as viewed.
 */
export async function searchRecords(env: RecordsEnv, db: D1Database, product: ProductSpec, query: string, nowSec: number, operator: string): Promise<SearchResult> {
  const pii = piiEnv(env);
  const found: TrialRecord[] = [];
  let capped = false;

  if (EMAIL.test(query)) {
    const { results } = await db.prepare(`SELECT ${columns(product)} FROM trials WHERE email_bidx = ? ORDER BY created_at DESC LIMIT ?`).bind(await emailBlindIndex(pii, query), MAX_RESULTS + 1).all<Row>();
    for (const row of results) found.push(await toRecord(pii, product, row));
  } else {
    const needle = query.toLowerCase();
    const ref = query.toUpperCase();
    const { results } = await db.prepare(`SELECT ${columns(product)} FROM trials ORDER BY created_at DESC LIMIT ?`).bind(SEARCH_SCAN_LIMIT + 1).all<Row>();
    capped = results.length > SEARCH_SCAN_LIMIT;
    for (const row of results.slice(0, SEARCH_SCAN_LIMIT)) {
      if (found.length > MAX_RESULTS) break;
      const exact = row.id === query || row.support_ref === ref;
      const name = row.name_enc ? await decryptField(pii, row.id, 'name', row.name_enc) : null;
      const email = row.email_enc ? await decryptField(pii, row.id, 'email', row.email_enc) : null;
      if (exact || name?.toLowerCase().includes(needle) || email?.toLowerCase().includes(needle)) found.push(await toRecord(pii, product, row, { name, email }));
    }
  }

  const truncated = found.length > MAX_RESULTS;
  const results = found.slice(0, MAX_RESULTS);
  await addRestores(db, results);
  if (results.length > 0) {
    // Fail closed: no contact data is returned unless the view was recorded.
    await db.batch(
      results.map((r) =>
        db.prepare('INSERT INTO trial_audit (trial_id, action, reason, operator, at, details) VALUES (?, ?, ?, ?, ?, NULL)').bind(r.id, 'view-contact', 'admin records search', operator, nowSec),
      ),
    );
  }
  return { results, truncated, capped };
}

export type DeleteOutcome = { outcome: 'done'; support_ref: string } | { outcome: 'not_found' } | { outcome: 'confirm_mismatch' };

/**
 * Erases the name and email of a trial (the row stays, so the computer keeps its used scans and cannot register again),
 * or deletes the whole row (the computer can then register a new trial). The audit entry and the change are one batch.
 * `confirmRef`, when given, must equal the record's support reference (the admin page makes the operator type it).
 */
export async function deleteRecord(
  db: D1Database,
  product: ProductSpec,
  input: { id: string; action: DeleteAction; reason: string; operator: string; nowSec: number; confirmRef?: string },
): Promise<DeleteOutcome> {
  const row = await db.prepare(`SELECT ${columns(product)} FROM trials WHERE id = ?`).bind(input.id).first<Row>();
  if (!row) return { outcome: 'not_found' };
  if (input.confirmRef !== undefined && input.confirmRef.trim().toUpperCase() !== row.support_ref) return { outcome: 'confirm_mismatch' };

  const previous = JSON.stringify({
    status: row.status,
    used: row.used,
    limit_total: row.limit_total,
    ...(product.perMode ? Object.fromEntries(SCAN_MODES.flatMap((m) => [[`used_${m}`, row[`used_${m}` as const]], [`limit_${m}`, row[`limit_${m}` as const]]])) : {}),
    support_ref: row.support_ref,
    via: 'admin',
  });
  const audit = db
    .prepare('INSERT INTO trial_audit (trial_id, action, reason, operator, at, details) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(input.id, AUDIT_ACTION[input.action], input.reason, input.operator, input.nowSec, input.action === 'delete' ? null : previous);
  const change =
    input.action === 'delete'
      ? db.prepare('DELETE FROM trials WHERE id = ?').bind(input.id)
      : db.prepare('UPDATE trials SET name_enc = NULL, email_enc = NULL, email_bidx = NULL WHERE id = ?').bind(input.id);
  await db.batch([audit, change]);
  return { outcome: 'done', support_ref: row.support_ref };
}
