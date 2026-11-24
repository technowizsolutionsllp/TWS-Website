// SQL for the free-trial retention periods stated in the trial privacy notices (Annex A PinchPDF, Annex B NoDupe).
// Pure functions (no I/O): scripts/trial-retention.mjs runs them with wrangler, the tws-retention Worker runs them on a
// schedule, and the tests run them against a local database. The same statements apply to either product's database.
//
// Policy, measured from the last time the app contacted our server (trials.last_server_contact_at):
//   - name and email (and the email index) are erased after CONTACT_RETENTION_DAYS (24 months); the row stays, so the
//     one-trial-per-computer rule and the usage counts keep working;
//   - the whole row (device hashes, counts, support reference) is deleted after RECORD_RETENTION_DAYS (5 years);
//   - operator audit rows (trial_audit, which hold no name, email or hash) are deleted 5 years after they were written.
// Every erasure and deletion is itself written to trial_audit (operator 'retention-job'), in the same run, with the
// support reference only. Keep these numbers equal to the privacy notices (a manual review item) and to
// lib/trial/retention.ts (a test checks that).

export const CONTACT_RETENTION_DAYS = 730;
export const RECORD_RETENTION_DAYS = 1826;

const DAY = 86400;
const HAS_CONTACT = '(name_enc IS NOT NULL OR email_enc IS NOT NULL OR email_bidx IS NOT NULL)';

/**
 * Statements for one run, relative to `nowSeconds`. Order matters: each audit row is written before the change it records.
 * Periods can be shortened for a test but never below 30 days, and the record period must not be shorter than the contact period.
 */
export function trialRetentionStatements(nowSeconds, contactDays = CONTACT_RETENTION_DAYS, recordDays = RECORD_RETENTION_DAYS) {
  if (!Number.isInteger(nowSeconds) || nowSeconds <= 0) throw new Error('nowSeconds must be a positive integer');
  if (!Number.isInteger(contactDays) || contactDays < 30) throw new Error('contactDays must be an integer of at least 30');
  if (!Number.isInteger(recordDays) || recordDays < contactDays) throw new Error('recordDays must be an integer, not shorter than contactDays');
  const contactCutoff = nowSeconds - contactDays * DAY;
  const recordCutoff = nowSeconds - recordDays * DAY;
  const audit = (action, reason, details) =>
    `INSERT INTO trial_audit (trial_id, action, reason, operator, at, details) SELECT id, '${action}', '${reason}', 'retention-job', ${nowSeconds}, ${details} FROM trials`;
  return [
    `${audit('retention-erase-contact', 'name and email older than the retention period', 'NULL')} WHERE last_server_contact_at < ${contactCutoff} AND ${HAS_CONTACT}`,
    `UPDATE trials SET name_enc = NULL, email_enc = NULL, email_bidx = NULL WHERE last_server_contact_at < ${contactCutoff} AND ${HAS_CONTACT}`,
    `${audit('retention-delete-record', 'record older than the retention period', "json_object('support_ref', support_ref)")} WHERE last_server_contact_at < ${recordCutoff}`,
    `DELETE FROM trials WHERE last_server_contact_at < ${recordCutoff}`,
    `DELETE FROM trial_audit WHERE at < ${recordCutoff}`,
  ];
}
