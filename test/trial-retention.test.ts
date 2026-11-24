// Trial retention: name and email are erased 24 months after the last contact, the whole record is deleted after 5 years,
// both are audited, newer data is untouched, and the scheduled Worker applies it to both products' databases.

import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { runServerChecks, type HealthEnv } from '../lib/admin/health-checks';
import { runRetention } from '../lib/retention/run';
import { CONTACT_RETENTION_DAYS, RECORD_RETENTION_DAYS, TRIAL_RETENTION_GRACE_DAYS, readTrialRetention, runTrialRetention, trialRetentionStatus } from '../lib/trial/retention';
import { CONTACT_RETENTION_DAYS as SQL_CONTACT_DAYS, RECORD_RETENTION_DAYS as SQL_RECORD_DAYS, trialRetentionStatements } from '../scripts/trial-retention-sql.mjs';
import worker from '../workers/retention/index';
import websiteConfig from '../wrangler.json';
import retentionConfig from '../workers/retention/wrangler.json';

const DAY = 86400;
const NOW = 1_900_000_000;
const dbs = { pinchpdf: () => env.TRIAL_DB, nodupe: () => env.NODUPE_DB } as const;

let seq = 0;
async function addTrial(db: D1Database, daysSinceContact: number, contact = true) {
  seq += 1;
  const at = NOW - daysSinceContact * DAY;
  await db
    .prepare(
      `INSERT INTO trials (id, pubkey, support_ref, h_guid, name_enc, email_enc, email_bidx, used, limit_total, status, terms_version, privacy_version,
         accepted_at, received_at, created_at, last_server_contact_at)
       VALUES (?1, ?2, ?3, 'hash', ?4, ?5, ?6, 2, 5, 'active', 'v', 'v', ?7, ?7, ?7, ?7)`,
    )
    .bind(`id${seq}`, `pk${seq}`, `REF${seq}`, contact ? 'v1.iv.NAME' : null, contact ? 'v1.iv.EMAIL' : null, contact ? 'bidx' : null, at)
    .run();
  return `id${seq}`;
}
const row = (db: D1Database, id: string) => db.prepare('SELECT * FROM trials WHERE id = ?').bind(id).first<Record<string, unknown>>();
const audits = async (db: D1Database) => (await db.prepare('SELECT trial_id, action, operator, at, details FROM trial_audit ORDER BY id').all<Record<string, unknown>>()).results;

describe('the periods', () => {
  it('are the same in the SQL, the code the Health check reads, and the privacy notices (24 months, 5 years)', () => {
    expect(SQL_CONTACT_DAYS).toBe(CONTACT_RETENTION_DAYS);
    expect(SQL_RECORD_DAYS).toBe(RECORD_RETENTION_DAYS);
    expect(CONTACT_RETENTION_DAYS).toBe(730);
    expect(RECORD_RETENTION_DAYS).toBe(5 * 365 + 1);
  });

  it('refuses a bad clock or a period that makes no sense', () => {
    expect(() => trialRetentionStatements(0)).toThrow();
    expect(() => trialRetentionStatements(NOW, 10)).toThrow(/at least 30/);
    expect(() => trialRetentionStatements(NOW, 100.5)).toThrow();
    expect(() => trialRetentionStatements(NOW, 365, 100)).toThrow(/not shorter/);
  });
});

for (const [name, db] of Object.entries(dbs)) {
  describe(`${name} database`, () => {
    it('erases name and email after 24 months and keeps the row, its device hash and its counts', async () => {
      const old = await addTrial(db(), CONTACT_RETENTION_DAYS + 1);
      const recent = await addTrial(db(), CONTACT_RETENTION_DAYS - 1);
      const result = await runTrialRetention(db(), NOW);
      expect(result).toEqual({ contactErased: 1, recordsDeleted: 0, auditRowsDeleted: 0 });
      expect(await row(db(), old)).toMatchObject({ name_enc: null, email_enc: null, email_bidx: null, h_guid: 'hash', used: 2, status: 'active' });
      expect(await row(db(), recent)).toMatchObject({ name_enc: 'v1.iv.NAME', email_enc: 'v1.iv.EMAIL', email_bidx: 'bidx' });
    });

    it('deletes the whole record after 5 years and keeps everything younger', async () => {
      const ancient = await addTrial(db(), RECORD_RETENTION_DAYS + 1);
      const middle = await addTrial(db(), RECORD_RETENTION_DAYS - 1, false);
      const result = await runTrialRetention(db(), NOW);
      expect(result.recordsDeleted).toBe(1);
      expect(await row(db(), ancient)).toBeNull();
      expect(await row(db(), middle)).not.toBeNull();
    });

    it('audits each erasure and deletion with the support reference only, never a name, email or hash', async () => {
      const erased = await addTrial(db(), CONTACT_RETENTION_DAYS + 5);
      const deleted = await addTrial(db(), RECORD_RETENTION_DAYS + 5);
      await runTrialRetention(db(), NOW);
      const log = await audits(db());
      expect(log.map((a) => `${a.trial_id}:${a.action}`).sort()).toEqual(
        [`${erased}:retention-erase-contact`, `${deleted}:retention-erase-contact`, `${deleted}:retention-delete-record`].sort(),
      );
      expect(log.every((a) => a.operator === 'retention-job' && a.at === NOW)).toBe(true);
      const del = log.find((a) => a.action === 'retention-delete-record')!;
      expect(JSON.parse(String(del.details))).toEqual({ support_ref: expect.stringMatching(/^REF\d+$/) });
      expect(JSON.stringify(log)).not.toMatch(/NAME|EMAIL|hash|bidx/);
    });

    it('deletes operator audit rows five years after they were written, and no sooner', async () => {
      const id = await addTrial(db(), 10);
      const insert = (at: number) => db().prepare("INSERT INTO trial_audit (trial_id, action, reason, operator, at) VALUES (?, 'revoke', 'r', 'op', ?)").bind(id, at).run();
      await insert(NOW - (RECORD_RETENTION_DAYS + 1) * DAY);
      await insert(NOW - (RECORD_RETENTION_DAYS - 1) * DAY);
      const result = await runTrialRetention(db(), NOW);
      expect(result.auditRowsDeleted).toBe(1);
      expect((await audits(db())).map((a) => a.at)).toEqual([NOW - (RECORD_RETENTION_DAYS - 1) * DAY]);
    });

    it('is safe to run twice and does nothing on an empty database', async () => {
      expect(await runTrialRetention(db(), NOW)).toEqual({ contactErased: 0, recordsDeleted: 0, auditRowsDeleted: 0 });
      await addTrial(db(), CONTACT_RETENTION_DAYS + 1);
      await runTrialRetention(db(), NOW);
      const before = (await audits(db())).length;
      expect(await runTrialRetention(db(), NOW)).toEqual({ contactErased: 0, recordsDeleted: 0, auditRowsDeleted: 0 });
      expect((await audits(db())).length).toBe(before);
    });

    it('does not count a row without contact data as erased again', async () => {
      await addTrial(db(), CONTACT_RETENTION_DAYS + 100, false);
      expect((await runTrialRetention(db(), NOW)).contactErased).toBe(0);
    });
  });
}

describe('the scheduled run', () => {
  it('applies trial retention and the telemetry purge to both products, each in its own database', async () => {
    const pinch = await addTrial(env.TRIAL_DB, CONTACT_RETENTION_DAYS + 1);
    const nodupe = await addTrial(env.NODUPE_DB, CONTACT_RETENTION_DAYS + 1);
    const old = NOW - 800 * DAY;
    for (const db of [env.TRIAL_DB, env.NODUPE_DB]) {
      await db.prepare("INSERT INTO telemetry_events (event_id, customer_uuid, type, occurred_at, received_at) VALUES (?, 'u', 'buy_clicked', ?, ?)").bind(`e${seq}${Math.random()}`, old, old).run();
    }
    const reports = await runRetention({ TRIAL_DB: env.TRIAL_DB, NODUPE_DB: env.NODUPE_DB }, NOW);
    expect(reports).toMatchObject([
      { product: 'pinchpdf', ok: true, trials: { contactErased: 1 }, telemetry: { eventsDeleted: 1 } },
      { product: 'nodupe', ok: true, trials: { contactErased: 1 }, telemetry: { eventsDeleted: 1 } },
    ]);
    expect(await row(env.TRIAL_DB, pinch)).toMatchObject({ name_enc: null });
    expect(await row(env.NODUPE_DB, nodupe)).toMatchObject({ name_enc: null });
  });

  it('reports a missing database instead of skipping it quietly, and still runs the other', async () => {
    await addTrial(env.TRIAL_DB, CONTACT_RETENTION_DAYS + 1);
    const reports = await runRetention({ TRIAL_DB: env.TRIAL_DB }, NOW);
    expect(reports[0]).toMatchObject({ product: 'pinchpdf', ok: true, trials: { contactErased: 1 } });
    expect(reports[1]).toEqual({ product: 'nodupe', ok: false, reason: 'database_not_bound' });
  });

  it('makes the Cron run fail when a product failed, and succeeds when both worked', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const controller = { scheduledTime: NOW * 1000 } as ScheduledController;
    await expect(worker.scheduled(controller, { TRIAL_DB: env.TRIAL_DB, NODUPE_DB: env.NODUPE_DB })).resolves.toBeUndefined();
    await expect(worker.scheduled(controller, { TRIAL_DB: env.TRIAL_DB })).rejects.toThrow('nodupe');
    expect((await worker.fetch()).status).toBe(404);
  });
});

describe('the Worker configuration', () => {
  it('binds the same two databases as the website, and runs once a day', () => {
    const byBinding = (config: { d1_databases: { binding: string; database_name: string; database_id: string }[] }) => Object.fromEntries(config.d1_databases.map((d) => [d.binding, d]));
    const website = byBinding(websiteConfig as never);
    const retention = byBinding(retentionConfig as never);
    expect(Object.keys(retention).sort()).toEqual(['NODUPE_DB', 'TRIAL_DB']);
    for (const binding of Object.keys(retention)) expect({ name: retention[binding].database_name, id: retention[binding].database_id }, binding).toEqual({ name: website[binding].database_name, id: website[binding].database_id });
    expect(retentionConfig.triggers.crons).toHaveLength(1);
    expect(retentionConfig.triggers.crons[0]).toMatch(/^\d+ \d+ \* \* \*$/);
  });
});

describe('the Health check reading', () => {
  it('is ok when nothing is stored, ok within the periods plus grace, and warns beyond them naming where to look', () => {
    expect(trialRetentionStatus({ oldestContact: null, oldestRecord: null }, NOW).status).toBe('ok');
    expect(trialRetentionStatus({ oldestContact: NOW - (CONTACT_RETENTION_DAYS + TRIAL_RETENTION_GRACE_DAYS) * DAY, oldestRecord: NOW - 100 * DAY }, NOW).status).toBe('ok');
    const contact = trialRetentionStatus({ oldestContact: NOW - (CONTACT_RETENTION_DAYS + TRIAL_RETENTION_GRACE_DAYS + 1) * DAY, oldestRecord: NOW - 100 * DAY }, NOW);
    expect(contact.status).toBe('warn');
    expect(contact.detail).toContain('tws-retention');
    const record = trialRetentionStatus({ oldestContact: null, oldestRecord: NOW - (RECORD_RETENTION_DAYS + TRIAL_RETENTION_GRACE_DAYS + 1) * DAY }, NOW);
    expect(record.status).toBe('warn');
  });

  it('reads the oldest contact and record from a database', async () => {
    await addTrial(env.TRIAL_DB, 900, false);
    await addTrial(env.TRIAL_DB, 100);
    expect(await readTrialRetention(env.TRIAL_DB)).toEqual({ oldestContact: NOW - 100 * DAY, oldestRecord: NOW - 900 * DAY });
  });

  it('shows up in the server checks for both products and warns on an overdue row', async () => {
    const limiter = { limit: async () => ({ success: true }) };
    const healthEnv = { ...(env as unknown as Record<string, unknown>), ADMIN_USER: 'ops', ADMIN_PASSWORD: 'correct horse battery', DOCS_USER: 'd', DOCS_PASSWORD: 'long-enough-pass', RESEND_API_KEY: 'k', CONTACT_FROM_EMAIL: 'c@example.com', TRIAL_DOCS_LIMITER: limiter } as unknown as HealthEnv;
    const clean = await runServerChecks(healthEnv);
    expect(clean.find((c) => c.id === 'trial-retention')).toMatchObject({ status: 'ok' });
    expect(clean.find((c) => c.id === 'nodupe-trial-retention')).toMatchObject({ status: 'ok' });

    const now = Math.floor(Date.now() / 1000);
    await env.NODUPE_DB
      .prepare("INSERT INTO trials (id, pubkey, support_ref, name_enc, used, limit_total, status, terms_version, privacy_version, accepted_at, received_at, created_at, last_server_contact_at) VALUES ('late', 'pk', 'LATE0001', 'v1.a.b', 0, 9, 'active', 'v', 'v', ?1, ?1, ?1, ?1)")
      .bind(now - 900 * DAY)
      .run();
    const checks = await runServerChecks(healthEnv);
    expect(checks.find((c) => c.id === 'nodupe-trial-retention')).toMatchObject({ status: 'warn' });
    expect(checks.find((c) => c.id === 'trial-retention')).toMatchObject({ status: 'ok' });
  });
});
