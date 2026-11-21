-- PinchPDF free-trial registration (website plan section 4).
-- Status is active | revoked | reset. "exhausted" is derived (used >= limit_total), never stored.

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
  used            INTEGER NOT NULL DEFAULT 0,
  limit_total     INTEGER NOT NULL DEFAULT 5,
  status          TEXT NOT NULL DEFAULT 'active',
  terms_version   TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  accepted_at     INTEGER NOT NULL,                -- client's claim
  received_at     INTEGER NOT NULL,                -- server clock, authoritative
  created_at      INTEGER NOT NULL,
  last_server_contact_at INTEGER NOT NULL,         -- last time the app contacted the server (NOT last app use: the app works offline)
  app_version     TEXT,
  os_build        TEXT,
  used_at_reset   INTEGER                          -- set by reset-device
);

CREATE INDEX idx_trials_guid   ON trials(h_guid);
CREATE INDEX idx_trials_smbios ON trials(h_smbios);
CREATE INDEX idx_trials_board  ON trials(h_board);
CREATE INDEX idx_trials_email  ON trials(email_bidx);   -- support lookup is an expected operation

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
