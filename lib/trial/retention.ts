// Free-trial retention: how long a trial's name and email, and its whole record, are kept, the job that applies it, and
// the Health check reading that notices when the job is overdue. The SQL is scripts/trial-retention-sql.mjs (shared with
// the manual script and the tws-retention Worker); the privacy notices (Annex A and B) must state the same periods.

import { CONTACT_RETENTION_DAYS, RECORD_RETENTION_DAYS, trialRetentionStatements } from '../../scripts/trial-retention-sql.mjs';

export { CONTACT_RETENTION_DAYS, RECORD_RETENTION_DAYS };

/** The job runs daily; allow this many days before the Health check warns that it is overdue. */
export const TRIAL_RETENTION_GRACE_DAYS = 3;

export type TrialRetentionResult = { contactErased: number; recordsDeleted: number; auditRowsDeleted: number };

/** Applies the retention periods to one product's database. Idempotent; safe to run as often as wanted. */
export async function runTrialRetention(db: D1Database, nowSeconds: number): Promise<TrialRetentionResult> {
  // One batch: D1 runs it as a transaction, so a failure leaves no audit row without its change.
  const results = await db.batch(trialRetentionStatements(nowSeconds).map((sql) => db.prepare(sql)));
  const changes = (index: number) => results[index]?.meta?.changes ?? 0;
  return { contactErased: changes(1), recordsDeleted: changes(3), auditRowsDeleted: changes(4) };
}

export type TrialRetentionReading = { oldestContact: number | null; oldestRecord: number | null };

/** What is stored: the oldest last-contact time among rows that still hold a name or email, and among all rows. */
export async function readTrialRetention(db: D1Database): Promise<TrialRetentionReading> {
  const row = await db
    .prepare('SELECT MIN(CASE WHEN name_enc IS NOT NULL OR email_enc IS NOT NULL OR email_bidx IS NOT NULL THEN last_server_contact_at END) AS oldestContact, MIN(last_server_contact_at) AS oldestRecord FROM trials')
    .first<TrialRetentionReading>();
  return { oldestContact: row?.oldestContact ?? null, oldestRecord: row?.oldestRecord ?? null };
}

export function trialRetentionStatus(reading: TrialRetentionReading, nowSeconds: number): { status: 'ok' | 'warn'; detail: string } {
  const age = (t: number | null) => (t === null ? null : Math.floor((nowSeconds - t) / 86400));
  const contactAge = age(reading.oldestContact);
  const recordAge = age(reading.oldestRecord);
  const late: string[] = [];
  if (contactAge !== null && contactAge > CONTACT_RETENTION_DAYS + TRIAL_RETENTION_GRACE_DAYS) late.push(`a name or email is held ${contactAge} days after the last contact (limit ${CONTACT_RETENTION_DAYS})`);
  if (recordAge !== null && recordAge > RECORD_RETENTION_DAYS + TRIAL_RETENTION_GRACE_DAYS) late.push(`a record is ${recordAge} days old (limit ${RECORD_RETENTION_DAYS})`);
  if (late.length > 0) {
    return { status: 'warn', detail: `The retention job is overdue: ${late.join('; ')}. Check the tws-retention Worker (docs/RETENTION.md) or run: node scripts/trial-retention.mjs --run --remote` };
  }
  if (recordAge === null) return { status: 'ok', detail: 'No trial records are stored.' };
  return { status: 'ok', detail: `Oldest record: ${recordAge} days since last contact (limit ${RECORD_RETENTION_DAYS}). Oldest name or email: ${contactAge === null ? 'none stored' : `${contactAge} days (limit ${CONTACT_RETENTION_DAYS})`}.` };
}
