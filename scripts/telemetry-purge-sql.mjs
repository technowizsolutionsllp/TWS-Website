// SQL for the telemetry retention policy and for erasing one customer. Pure functions (no I/O) so
// the tests can run them against a local database; scripts/telemetry-purge.mjs runs them with wrangler.
//
// Policy: license and purchase events are kept for DEFAULT_RETENTION_DAYS after they were received,
// then deleted, together with customers and device records nothing refers to any more. Only counts
// that identify no one survive (the Insights pages compute them from events, so older charts empty out).
// Keep this number equal to TELEMETRY_RETENTION_DAYS in lib/telemetry/retention.ts and to the period
// the privacy policy states (a test checks the first; the second is a manual review item).

export const DEFAULT_RETENTION_DAYS = 730;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Statements that delete everything older than `days` (default 730), relative to `nowSeconds`. */
export function purgeStatements(nowSeconds, days = DEFAULT_RETENTION_DAYS) {
  if (!Number.isInteger(nowSeconds) || nowSeconds <= 0) throw new Error('nowSeconds must be a positive integer');
  if (!Number.isInteger(days) || days < 30) throw new Error('days must be an integer of at least 30');
  const cutoff = nowSeconds - days * 86400;
  return [
    `DELETE FROM telemetry_events WHERE received_at < ${cutoff}`,
    // An old customer or device is only removed once no event refers to it.
    `DELETE FROM telemetry_customers WHERE first_seen_at < ${cutoff} AND customer_uuid NOT IN (SELECT customer_uuid FROM telemetry_events)`,
    `DELETE FROM telemetry_devices WHERE first_seen_at < ${cutoff} AND device_id NOT IN (SELECT device_id FROM telemetry_events WHERE device_id IS NOT NULL)`,
  ];
}

/** Statements that erase one customer's telemetry on request (the customer_uuid must be a UUID). */
export function eraseStatements(customerUuid) {
  const uuid = String(customerUuid ?? '').toLowerCase();
  if (!UUID.test(uuid)) throw new Error('customer uuid must look like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
  return [
    `DELETE FROM telemetry_events WHERE customer_uuid = '${uuid}'`,
    `DELETE FROM telemetry_customers WHERE customer_uuid = '${uuid}'`,
    // Devices are shared by matching and hold only hashes: remove the ones nothing refers to now.
    `DELETE FROM telemetry_devices WHERE device_id NOT IN (SELECT device_id FROM telemetry_events WHERE device_id IS NOT NULL)`,
  ];
}

/**
 * NoDupe scan reports live in their own database (nodupe), so they have their own statements, run against
 * that database. Same period: reports received more than `days` ago are deleted, then installs nothing
 * refers to any more.
 */
export function nodupePurgeStatements(nowSeconds, days = DEFAULT_RETENTION_DAYS) {
  if (!Number.isInteger(nowSeconds) || nowSeconds <= 0) throw new Error('nowSeconds must be a positive integer');
  if (!Number.isInteger(days) || days < 30) throw new Error('days must be an integer of at least 30');
  const cutoff = nowSeconds - days * 86400;
  return [
    `DELETE FROM nodupe_scan_reports WHERE received_at < ${cutoff}`,
    `DELETE FROM nodupe_installs WHERE first_seen_at < ${cutoff} AND customer_uuid NOT IN (SELECT customer_uuid FROM nodupe_scan_reports)`,
  ];
}

/** Statements that erase one NoDupe install's reports on request (the install id must be a UUID). */
export function nodupeEraseStatements(customerUuid) {
  const uuid = String(customerUuid ?? '').toLowerCase();
  if (!UUID.test(uuid)) throw new Error('install id must look like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
  return [`DELETE FROM nodupe_scan_reports WHERE customer_uuid = '${uuid}'`, `DELETE FROM nodupe_installs WHERE customer_uuid = '${uuid}'`];
}
