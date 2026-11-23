// D1 access for NoDupe scan reports. They live in their own database (NODUPE_DB), apart from the
// PinchPDF trial and telemetry tables. Prepared statements with bound parameters only.

/** Running totals of scans by mode, as reported by a scan_summary event. */
export type ScanCounts = { basic: number; similar: number; deep: number };

/** Free allowance per mode. Informational: the app enforces it, the server only records what it is told. */
export const FREE_SCAN_ALLOWANCE: ScanCounts = { basic: 5, similar: 3, deep: 1 };

export type InstallRow = { customer_uuid: string; pubkey: string };

export async function findInstall(db: D1Database, uuid: string): Promise<InstallRow | null> {
  return db.prepare('SELECT customer_uuid, pubkey FROM nodupe_installs WHERE customer_uuid = ?1').bind(uuid).first<InstallRow>();
}

/** Binds the install key on first sight. A concurrent first report for the same uuid is ignored here. */
export async function insertInstall(db: D1Database, uuid: string, pubkey: string, now: number): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO nodupe_installs (customer_uuid, pubkey, first_seen_at) VALUES (?1, ?2, ?3)').bind(uuid, pubkey, now).run();
}

export type NewScanReport = {
  eventId: string;
  customerUuid: string;
  scans: ScanCounts;
  occurredAt: number;
  receivedAt: number;
  appVersion: string | null;
  osBuild: string | null;
};

/** Idempotent on event_id: an app retry changes nothing. Returns true when a row was added. */
export async function insertScanReport(db: D1Database, r: NewScanReport): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO nodupe_scan_reports
         (event_id, customer_uuid, scans_basic, scans_similar, scans_deep, occurred_at, received_at, app_version, os_build)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(r.eventId, r.customerUuid, r.scans.basic, r.scans.similar, r.scans.deep, r.occurredAt, r.receivedAt, r.appVersion, r.osBuild)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Row shape the Insights dashboard reads. Nothing here identifies a person. */
export type ScanReportRow = {
  seq: number;
  customer_uuid: string;
  occurred_at: number;
  scans_basic: number;
  scans_similar: number;
  scans_deep: number;
};

export async function loadScanReports(db: D1Database): Promise<ScanReportRow[]> {
  const { results } = await db
    .prepare(
      `SELECT seq, customer_uuid, occurred_at, scans_basic, scans_similar, scans_deep
       FROM nodupe_scan_reports ORDER BY occurred_at, seq`,
    )
    .all<ScanReportRow>();
  return results;
}
