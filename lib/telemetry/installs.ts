// Installer events (install and uninstall) for Insights. Counts only; nothing here identifies a person or a machine.

import type { InstallRow } from './compute';

/** Every install and uninstall event, oldest first. Small: one row per install or uninstall. */
export async function loadInstallRows(db: D1Database): Promise<InstallRow[]> {
  const { results } = await db
    .prepare(
      `SELECT customer_uuid, type, install_kind, occurred_at FROM telemetry_events
       WHERE type IN ('install', 'uninstall') ORDER BY occurred_at, seq`,
    )
    .all<InstallRow>();
  return results;
}
