// D1 access for the trial service. Prepared statements with bound parameters only.

import type { Signals, StoredDevice } from './matching';
import { SCAN_MODES, sumCounts, type ScanCounts } from './product';

export type TrialRow = {
  id: string;
  pubkey: string | null;
  support_ref: string;
  used: number;
  limit_total: number;
  status: string;
  received_at: number;
  /** When the trial was first registered. A restore (revision 5) updates received_at, never this. */
  created_at: number;
  last_server_contact_at: number;
};

export type TrialState = 'active' | 'exhausted' | 'revoked';

/** Protocol 3.2.4: revoked if revoked; else exhausted if S >= T; else active. */
export function deriveState(row: Pick<TrialRow, 'status' | 'used' | 'limit_total'>): TrialState {
  if (row.status === 'revoked') return 'revoked';
  return row.used >= row.limit_total ? 'exhausted' : 'active';
}

const ROW_COLUMNS = 'id, pubkey, support_ref, used, limit_total, status, received_at, created_at, last_server_contact_at';

export async function findActiveByPubkey(db: D1Database, pubkey: string): Promise<TrialRow | null> {
  return db.prepare(`SELECT ${ROW_COLUMNS} FROM trials WHERE pubkey = ?1`).bind(pubkey).first<TrialRow>();
}

export async function findById(db: D1Database, id: string): Promise<TrialRow | null> {
  return db.prepare(`SELECT ${ROW_COLUMNS} FROM trials WHERE id = ?1`).bind(id).first<TrialRow>();
}

type CandidateRow = { id: string; support_ref: string; status: string; h_guid: string | null; h_smbios: string | null; h_board: string | null };

function toDevice(row: CandidateRow): StoredDevice {
  return {
    id: row.id,
    support_ref: row.support_ref,
    status: row.status,
    signals: { guid: row.h_guid, smbios: row.h_smbios, board: row.h_board },
  };
}

/**
 * Indexed OR over the three hashes. The blocking decision is made in code
 * (matching.ts), never in SQL. A NULL parameter never equals anything.
 * `beforeId` limits the result to rows inserted before that row (race check).
 */
export async function findCandidates(db: D1Database, signals: Signals, beforeId?: string): Promise<StoredDevice[]> {
  const base = `SELECT id, support_ref, status, h_guid, h_smbios, h_board FROM trials
     WHERE status != 'reset' AND (h_guid = ?1 OR h_smbios = ?2 OR h_board = ?3)`;
  const statement = beforeId
    ? db
        .prepare(`${base} AND id != ?4 AND rowid < (SELECT rowid FROM trials WHERE id = ?4) ORDER BY rowid`)
        .bind(signals.guid, signals.smbios, signals.board, beforeId)
    : db.prepare(`${base} ORDER BY rowid`).bind(signals.guid, signals.smbios, signals.board);
  const { results } = await statement.all<CandidateRow>();
  return results.map(toDevice);
}

export type NewTrial = {
  id: string;
  pubkey: string;
  supportRef: string;
  signals: Signals;
  nameEnc: string;
  emailEnc: string;
  emailBidx: string;
  limit: number;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: number;
  now: number;
  appVersion: string | null;
  osBuild: string | null;
};

export async function insertTrial(db: D1Database, t: NewTrial): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO trials (id, pubkey, support_ref, h_guid, h_smbios, h_board, name_enc, email_enc, email_bidx,
         used, limit_total, status, terms_version, privacy_version, accepted_at, received_at, created_at,
         last_server_contact_at, app_version, os_build)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, 'active', ?11, ?12, ?13, ?14, ?14, ?14, ?15, ?16)`,
    )
    .bind(
      t.id,
      t.pubkey,
      t.supportRef,
      t.signals.guid,
      t.signals.smbios,
      t.signals.board,
      t.nameEnc,
      t.emailEnc,
      t.emailBidx,
      t.limit,
      t.termsVersion,
      t.privacyVersion,
      t.acceptedAt,
      t.now,
      t.appVersion,
      t.osBuild,
    )
    .run();
  return result.meta?.rows_written ?? 0;
}

export async function deleteTrial(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM trials WHERE id = ?1').bind(id).run();
}

/** Raise the high-water mark and/or refresh the contact time; one write at most. */
export async function writeUsage(db: D1Database, id: string, used: number, now: number): Promise<void> {
  await db
    // MAX/MIN in SQL keep the high-water mark monotonic even if two reports race.
    .prepare(
      `UPDATE trials SET used = MIN(limit_total, MAX(used, ?2)), last_server_contact_at = ?3
       WHERE id = ?1 AND status != 'reset'`,
    )
    .bind(id, used, now)
    .run();
}

// ------------------------------------------------------------------ NoDupe: one counter per scan mode
//
// NoDupe's `trials` table (migrations-nodupe) has the same columns as PinchPDF's plus a used_ and a limit_
// column per mode. `used` and `limit_total` stay and hold the SUM over the modes, so the shared code that
// reads them (deriveState, Insights) works unchanged: a trial is exhausted only when every mode is at its limit.

export type ModeRow = { used: ScanCounts; limit: ScanCounts };

type ModeColumns = {
  used_basic: number;
  used_similar: number;
  used_deep: number;
  limit_basic: number;
  limit_similar: number;
  limit_deep: number;
};

export async function loadModes(db: D1Database, id: string): Promise<ModeRow | null> {
  const row = await db
    .prepare('SELECT used_basic, used_similar, used_deep, limit_basic, limit_similar, limit_deep FROM trials WHERE id = ?1')
    .bind(id)
    .first<ModeColumns>();
  if (!row) return null;
  return {
    used: { basic: row.used_basic, similar: row.used_similar, deep: row.used_deep },
    limit: { basic: row.limit_basic, similar: row.limit_similar, deep: row.limit_deep },
  };
}

/** Inserts a NoDupe trial. `initial` is what the install had already used before it registered (clamped to the limits). */
export async function insertModeTrial(db: D1Database, t: NewTrial, limits: ScanCounts, initial: ScanCounts): Promise<number> {
  const used = {} as ScanCounts;
  for (const mode of SCAN_MODES) used[mode] = Math.min(limits[mode], Math.max(0, initial[mode]));
  const result = await db
    .prepare(
      `INSERT INTO trials (id, pubkey, support_ref, h_guid, h_smbios, h_board, name_enc, email_enc, email_bidx,
         used, limit_total, used_basic, used_similar, used_deep, limit_basic, limit_similar, limit_deep,
         status, terms_version, privacy_version, accepted_at, received_at, created_at,
         last_server_contact_at, app_version, os_build, product)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
         'active', ?18, ?19, ?20, ?21, ?21, ?21, ?22, ?23, 'nodupe')`,
    )
    .bind(
      t.id,
      t.pubkey,
      t.supportRef,
      t.signals.guid,
      t.signals.smbios,
      t.signals.board,
      t.nameEnc,
      t.emailEnc,
      t.emailBidx,
      sumCounts(used),
      sumCounts(limits),
      used.basic,
      used.similar,
      used.deep,
      limits.basic,
      limits.similar,
      limits.deep,
      t.termsVersion,
      t.privacyVersion,
      t.acceptedAt,
      t.now,
      t.appVersion,
      t.osBuild,
    )
    .run();
  return result.meta?.rows_written ?? 0;
}

/**
 * Raises each mode's high-water mark (never lowers it, never above its limit) and refreshes the contact time.
 * MAX/MIN in SQL keep every counter monotonic even if two reports race. `used` is kept equal to the sum.
 */
export async function writeModeUsage(db: D1Database, id: string, reported: ScanCounts, now: number): Promise<void> {
  const b = 'MIN(limit_basic, MAX(used_basic, ?2))';
  const s = 'MIN(limit_similar, MAX(used_similar, ?3))';
  const d = 'MIN(limit_deep, MAX(used_deep, ?4))';
  await db
    .prepare(
      `UPDATE trials SET used_basic = ${b}, used_similar = ${s}, used_deep = ${d},
         used = ${b} + ${s} + ${d}, last_server_contact_at = ?5
       WHERE id = ?1 AND status != 'reset'`,
    )
    .bind(id, reported.basic, reported.similar, reported.deep, now)
    .run();
}

// ------------------------------------------------------------------ restore (protocol revision 5)

export type ContactRow = { name_enc: string | null; email_enc: string | null; email_bidx: string | null };

export async function loadContact(db: D1Database, id: string): Promise<ContactRow | null> {
  return db.prepare('SELECT name_enc, email_enc, email_bidx FROM trials WHERE id = ?1').bind(id).first<ContactRow>();
}

export type Restore = {
  id: string;
  pubkey: string;
  /** Replacement name (encrypted); null keeps the stored one. */
  nameEnc: string | null;
  /** Replacement email (encrypted, and its blind index); null keeps the stored one. */
  email: { enc: string; bidx: string } | null;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: number;
  now: number;
  appVersion: string | null;
  osBuild: string | null;
  /** NoDupe: what the install reports it has used; merged per mode, never lowering a count. */
  reported: ScanCounts | null;
  /** How the trial was recognised ('resume' or 'email'), for the audit row. */
  matchedBy: 'resume' | 'email';
  /** The counts before the restore, for the audit row (no personal data). */
  previous: number | ScanCounts;
  /**
   * The install key being replaced, for the audit row. The row keeps only the latest one in pubkey_retired, so the
   * audit is where every key a trial has had can be traced (it is an install's public key, not personal data).
   */
  previousKey: string | null;
};

/**
 * Moves an active trial to a new install key, records the new consent, optionally replaces the contact
 * fields and (NoDupe) merges the reported counts, then appends a trial_audit row. One D1 batch, so either
 * all of it is written or none. Returns false when nothing was written: the row is no longer active (revoked, reset or
 * deleted meanwhile), or an identical request already moved it to this key.
 */
export async function restoreTrial(db: D1Database, r: Restore, perMode: boolean): Promise<boolean> {
  const sets = [
    'pubkey_retired = pubkey',
    'pubkey = ?2',
    'terms_version = ?3',
    'privacy_version = ?4',
    'accepted_at = ?5',
    'received_at = ?6',
    'last_server_contact_at = ?6',
    'app_version = ?7',
    'os_build = ?8',
  ];
  const params: unknown[] = [r.id, r.pubkey, r.termsVersion, r.privacyVersion, r.acceptedAt, r.now, r.appVersion, r.osBuild];
  if (r.nameEnc !== null) {
    params.push(r.nameEnc);
    sets.push(`name_enc = ?${params.length}`);
  }
  if (r.email !== null) {
    params.push(r.email.enc, r.email.bidx);
    sets.push(`email_enc = ?${params.length - 1}`, `email_bidx = ?${params.length}`);
  }
  if (perMode && r.reported) {
    const n = params.length;
    const b = `MIN(limit_basic, MAX(used_basic, ?${n + 1}))`;
    const s = `MIN(limit_similar, MAX(used_similar, ?${n + 2}))`;
    const d = `MIN(limit_deep, MAX(used_deep, ?${n + 3}))`;
    sets.push(`used_basic = ${b}`, `used_similar = ${s}`, `used_deep = ${d}`, `used = ${b} + ${s} + ${d}`);
    params.push(r.reported.basic, r.reported.similar, r.reported.deep);
  }
  const [update] = await db.batch([
    // `pubkey IS NOT ?2`: an identical request that already moved the trial to this key changes nothing (and writes
    // no second audit row), so pubkey_retired keeps the old key rather than the new one.
    db.prepare(`UPDATE trials SET ${sets.join(', ')} WHERE id = ?1 AND status = 'active' AND pubkey IS NOT ?2`).bind(...params),
    db
      .prepare(
        `INSERT INTO trial_audit (trial_id, action, reason, operator, at, details)
         SELECT ?1, 'restore', ?2, 'service', ?3, ?4 WHERE changes() > 0`,
      )
      .bind(r.id, r.matchedBy, r.now, JSON.stringify({ used: r.previous, previous_key: r.previousKey })),
  ]);
  return (update.meta?.changes ?? 0) > 0;
}
