-- NoDupe trial registration and app telemetry. Same design as PinchPDF's migrations 0001 to 0004, in NoDupe's own
-- database (binding NODUPE_DB, database "nodupe"), so the two products never share rows.
--
-- The free trial counts scans per mode (basic, similar, deep), with the allowance stored per trial (5 / 3 / 1).
-- `used` and `limit_total` stay and hold the SUM over the modes, so a trial is "exhausted" only when every mode is
-- at its limit and the shared code that reads them works unchanged.
--
-- This replaces the anonymous scan-report tables of migration 0001, which were never deployed to a live service.

DROP TABLE IF EXISTS nodupe_scan_reports;
DROP TABLE IF EXISTS nodupe_installs;

CREATE TABLE trials (
  id              TEXT PRIMARY KEY,                -- 128-bit random, b64url (the trial_id)
  pubkey          TEXT UNIQUE,                     -- ACTIVE install key, Ed25519 b64url; NULL once detached by reset-device
  pubkey_retired  TEXT,                            -- the detached key after a reset (history only; never used for idempotency)
  support_ref     TEXT NOT NULL,                   -- 8 chars from 40 random bits; shown to the user for support
  h_guid          TEXT,                            -- HMAC-SHA256(PEPPER, "guid|" || client hash); NULL = unusable or cleared by a reset
  h_smbios        TEXT,
  h_board         TEXT,
  name_enc        TEXT,                            -- "v1.<iv>.<ct>" AES-256-GCM, AAD = id|name; NULL after erase-contact
  email_enc       TEXT,
  email_bidx      TEXT,                            -- HMAC-SHA256(PEPPER_EMAIL, lower(email)), indexed for support
  used            INTEGER NOT NULL DEFAULT 0,      -- sum of used_basic + used_similar + used_deep
  limit_total     INTEGER NOT NULL DEFAULT 9,      -- sum of the three limits
  used_basic      INTEGER NOT NULL DEFAULT 0,
  used_similar    INTEGER NOT NULL DEFAULT 0,
  used_deep       INTEGER NOT NULL DEFAULT 0,
  limit_basic     INTEGER NOT NULL DEFAULT 5,
  limit_similar   INTEGER NOT NULL DEFAULT 3,
  limit_deep      INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',  -- active | revoked | reset ("exhausted" is derived, never stored)
  terms_version   TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  accepted_at     INTEGER NOT NULL,                -- client's claim
  received_at     INTEGER NOT NULL,                -- server clock, authoritative
  created_at      INTEGER NOT NULL,
  last_server_contact_at INTEGER NOT NULL,         -- last time the app contacted the server (NOT last app use: the app works offline)
  app_version     TEXT,
  os_build        TEXT,
  used_at_reset   INTEGER,                         -- set by reset-device
  product         TEXT NOT NULL DEFAULT 'nodupe'
);

CREATE INDEX idx_trials_guid    ON trials(h_guid);
CREATE INDEX idx_trials_smbios  ON trials(h_smbios);
CREATE INDEX idx_trials_board   ON trials(h_board);
CREATE INDEX idx_trials_email   ON trials(email_bidx);
CREATE INDEX idx_trials_created ON trials(created_at);

-- Append-only; operator actions only. details holds previous values, never personal data.
CREATE TABLE trial_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trial_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  operator TEXT NOT NULL,
  at INTEGER NOT NULL,
  details TEXT
);

-- Daily request counters (counts only, never personal data), written in small batches by lib/trial/metrics.ts.
CREATE TABLE metrics_daily (
  day      TEXT NOT NULL,      -- UTC day, YYYY-MM-DD
  product  TEXT NOT NULL,
  endpoint TEXT NOT NULL,      -- challenge | register | usage | telemetry
  outcome  TEXT NOT NULL,      -- result code, e.g. registered, already_used, rate_limited
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, product, endpoint, outcome)
) WITHOUT ROWID;

-- App telemetry (buy clicks, license lifecycle events, installs and uninstalls). Holds no name, email, raw license
-- key or raw device value. Everything identifying a machine or a license is a keyed hash.
CREATE TABLE telemetry_customers (
  customer_uuid  TEXT PRIMARY KEY,
  pubkey         TEXT NOT NULL,
  trial_id       TEXT,                -- optional link to trials.id, set when the app sends it
  first_seen_at  INTEGER NOT NULL
);

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

-- Append-only. type is buy_clicked | license_activated | license_deactivated | license_key_changed | install | uninstall.
CREATE TABLE telemetry_events (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL UNIQUE,   -- UUID from the app; a retry is ignored
  customer_uuid   TEXT NOT NULL,
  type            TEXT NOT NULL,
  plan            TEXT,                   -- individual | business
  license_fp      TEXT,                   -- HMAC of the app's license hash; NULL for buy_clicked, install and uninstall
  prev_license_fp TEXT,                   -- license_key_changed only: the key that was replaced
  device_id       TEXT,                   -- NULL when the machine had no usable signal, and for install and uninstall
  occurred_at     INTEGER NOT NULL,       -- app clock, clamped into [received_at - 90 days, received_at]
  received_at     INTEGER NOT NULL,       -- server clock, authoritative
  app_version     TEXT,
  os_build        TEXT,
  install_kind    TEXT                    -- install events only: new | upgrade | reinstall
);
CREATE INDEX idx_telemetry_events_type_time ON telemetry_events(type, occurred_at);
CREATE INDEX idx_telemetry_events_customer  ON telemetry_events(customer_uuid);
CREATE INDEX idx_telemetry_events_license   ON telemetry_events(license_fp);
