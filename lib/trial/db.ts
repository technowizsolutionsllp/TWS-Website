// D1 access for the trial service. Prepared statements with bound parameters only.

import type { Signals, StoredDevice } from './matching';

export type TrialRow = {
  id: string;
  pubkey: string | null;
  support_ref: string;
  used: number;
  limit_total: number;
  status: string;
  received_at: number;
  last_server_contact_at: number;
};

export type TrialState = 'active' | 'exhausted' | 'revoked';

/** Protocol 3.2.4: revoked if revoked; else exhausted if S >= T; else active. */
export function deriveState(row: Pick<TrialRow, 'status' | 'used' | 'limit_total'>): TrialState {
  if (row.status === 'revoked') return 'revoked';
  return row.used >= row.limit_total ? 'exhausted' : 'active';
}

const ROW_COLUMNS = 'id, pubkey, support_ref, used, limit_total, status, received_at, last_server_contact_at';

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
