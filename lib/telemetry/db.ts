// D1 access for app telemetry. Prepared statements with bound parameters only.

import type { Signals } from '../trial/matching';

export const EVENT_TYPES = ['buy_clicked', 'license_activated', 'license_deactivated', 'license_key_changed'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const PLANS = ['individual', 'business'] as const;
export type Plan = (typeof PLANS)[number];

export type CustomerRow = { customer_uuid: string; pubkey: string; trial_id: string | null };

export async function findCustomer(db: D1Database, uuid: string): Promise<CustomerRow | null> {
  return db.prepare('SELECT customer_uuid, pubkey, trial_id FROM telemetry_customers WHERE customer_uuid = ?1').bind(uuid).first<CustomerRow>();
}

/** Binds the install key on first sight. A concurrent first event for the same uuid is ignored here. */
export async function insertCustomer(db: D1Database, uuid: string, pubkey: string, trialId: string | null, now: number): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO telemetry_customers (customer_uuid, pubkey, trial_id, first_seen_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(uuid, pubkey, trialId, now)
    .run();
}

export async function setCustomerTrial(db: D1Database, uuid: string, trialId: string): Promise<void> {
  await db.prepare('UPDATE telemetry_customers SET trial_id = ?2 WHERE customer_uuid = ?1 AND trial_id IS NULL').bind(uuid, trialId).run();
}

export type DeviceRow = { device_id: string; h_guid: string | null; h_smbios: string | null; h_board: string | null };

export async function findDeviceCandidates(db: D1Database, signals: Signals): Promise<DeviceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT device_id, h_guid, h_smbios, h_board FROM telemetry_devices
       WHERE h_guid = ?1 OR h_smbios = ?2 OR h_board = ?3 ORDER BY rowid`,
    )
    .bind(signals.guid, signals.smbios, signals.board)
    .all<DeviceRow>();
  return results;
}

export async function insertDevice(db: D1Database, deviceId: string, signals: Signals, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO telemetry_devices (device_id, h_guid, h_smbios, h_board, first_seen_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(deviceId, signals.guid, signals.smbios, signals.board, now)
    .run();
}

export type NewEvent = {
  eventId: string;
  customerUuid: string;
  type: EventType;
  plan: Plan | null;
  licenseFp: string | null;
  prevLicenseFp: string | null;
  deviceId: string | null;
  occurredAt: number;
  receivedAt: number;
  appVersion: string | null;
  osBuild: string | null;
};

/** Idempotent on event_id: an app retry changes nothing. Returns true when a row was added. */
export async function insertEvent(db: D1Database, e: NewEvent): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO telemetry_events
         (event_id, customer_uuid, type, plan, license_fp, prev_license_fp, device_id, occurred_at, received_at, app_version, os_build)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
    .bind(e.eventId, e.customerUuid, e.type, e.plan, e.licenseFp, e.prevLicenseFp, e.deviceId, e.occurredAt, e.receivedAt, e.appVersion, e.osBuild)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Row shape the Insights dashboard reads. Nothing here identifies a person. */
export type EventRow = {
  seq: number;
  customer_uuid: string;
  type: EventType;
  plan: Plan | null;
  license_fp: string | null;
  prev_license_fp: string | null;
  device_id: string | null;
  occurred_at: number;
};

export async function loadEvents(db: D1Database): Promise<EventRow[]> {
  const { results } = await db
    .prepare(
      `SELECT seq, customer_uuid, type, plan, license_fp, prev_license_fp, device_id, occurred_at
       FROM telemetry_events ORDER BY occurred_at, seq`,
    )
    .all<EventRow>();
  return results;
}
