-- NoDupe scan-count reports (the `scan_summary` telemetry event, docs/PINCHPDF_TELEMETRY.md).
-- Lives in its own D1 database (binding NODUPE_DB, database "nodupe"), apart from the PinchPDF trial.
-- Holds no name, email, license, device identifier, file name or path: an install's random id, its public
-- key, and how many scans of each mode it has run.

-- One row per NoDupe install. customer_uuid is minted by the app; pubkey is the install's Ed25519 key,
-- bound on first sight, so later reports must be signed by it.
CREATE TABLE nodupe_installs (
  customer_uuid  TEXT PRIMARY KEY,
  pubkey         TEXT NOT NULL,
  first_seen_at  INTEGER NOT NULL
);

-- Append-only. Each report is a running total since install, so the latest per install is its current
-- count and the growth between two reports is what happened in between.
CREATE TABLE nodupe_scan_reports (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT NOT NULL UNIQUE,    -- UUID from the app; a retry is ignored
  customer_uuid  TEXT NOT NULL,
  scans_basic    INTEGER NOT NULL,
  scans_similar  INTEGER NOT NULL,
  scans_deep     INTEGER NOT NULL,
  occurred_at    INTEGER NOT NULL,        -- app clock, clamped into [received_at - 90 days, received_at]
  received_at    INTEGER NOT NULL,        -- server clock, authoritative
  app_version    TEXT,
  os_build       TEXT
);
CREATE INDEX idx_nodupe_scan_reports_customer ON nodupe_scan_reports(customer_uuid, occurred_at);
CREATE INDEX idx_nodupe_scan_reports_time     ON nodupe_scan_reports(occurred_at);
