-- PinchPDF app telemetry (buy clicks and license lifecycle events).
-- Holds no name, email, raw license key or raw device value. Everything identifying a machine or a
-- license is a keyed hash (HMAC with PEPPER), the same scheme as the trial signals.

-- One row per app install identity. customer_uuid is the common reference minted by the app;
-- pubkey is the install's Ed25519 key, bound on first sight, so later events must be signed by it.
CREATE TABLE telemetry_customers (
  customer_uuid  TEXT PRIMARY KEY,
  pubkey         TEXT NOT NULL,
  trial_id       TEXT,                -- optional link to trials.id, set when the app sends it
  first_seen_at  INTEGER NOT NULL
);

-- A machine, resolved with the same matching policy as the trial (matching.ts): same machine iff
-- at least min(2, usable in both) signals are equal. device_id is random and stable per machine.
CREATE TABLE telemetry_devices (
  device_id      TEXT PRIMARY KEY,
  h_guid         TEXT,
  h_smbios       TEXT,
  h_board        TEXT,
  first_seen_at  INTEGER NOT NULL
);
CREATE INDEX idx_telemetry_devices_guid   ON telemetry_devices(h_guid);
CREATE INDEX idx_telemetry_devices_smbios ON telemetry_devices(h_smbios);
CREATE INDEX idx_telemetry_devices_board  ON telemetry_devices(h_board);

-- Append-only. type is buy_clicked | license_activated | license_deactivated | license_key_changed.
CREATE TABLE telemetry_events (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL UNIQUE,   -- UUID from the app; a retry is ignored
  customer_uuid   TEXT NOT NULL,
  type            TEXT NOT NULL,
  plan            TEXT,                   -- individual | business
  license_fp      TEXT,                   -- HMAC of the app's license hash; NULL for buy_clicked
  prev_license_fp TEXT,                   -- license_key_changed only: the key that was replaced
  device_id       TEXT,                   -- NULL when the machine had no usable signal
  occurred_at     INTEGER NOT NULL,       -- app clock, clamped into [received_at - 90 days, received_at]
  received_at     INTEGER NOT NULL,       -- server clock, authoritative
  app_version     TEXT,
  os_build        TEXT
);
CREATE INDEX idx_telemetry_events_type_time ON telemetry_events(type, occurred_at);
CREATE INDEX idx_telemetry_events_customer  ON telemetry_events(customer_uuid);
CREATE INDEX idx_telemetry_events_license   ON telemetry_events(license_fp);
