-- Checkout links for the NoDupe Buy buttons, edited on /admin/checkout and served to the app by
-- GET /api/nodupe/checkout/v1/links. One row per mode (live, test) holding the whole setting as JSON: the primary
-- provider, Force, the default link set and up to 4 link sets (see lib/checkout/config.ts). The JSON is checked by
-- the code on every read and write. No row means the links built into the app (lib/checkout/defaults.ts) are used,
-- so this migration adds no data. PinchPDF has the same tables in its own database (migrations/0005).
CREATE TABLE checkout_config (
  mode        TEXT PRIMARY KEY CHECK (mode IN ('live', 'test')),
  config      TEXT NOT NULL,                     -- JSON, lib/checkout/config.ts CheckoutConfig
  version     INTEGER NOT NULL,                  -- +1 on every save; the admin form sends it back (stale saves are refused)
  updated_at  INTEGER NOT NULL                   -- unix seconds
);

-- Every change, including a promotion starting or ending on its own. Public checkout URLs only: no personal data.
CREATE TABLE checkout_audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,                    -- unix seconds
  operator  TEXT NOT NULL,                       -- 'admin-ui', or 'auto-start' / 'auto-end' for a promotion's own dates
  mode      TEXT NOT NULL CHECK (mode IN ('live', 'test')),
  change    TEXT NOT NULL,                       -- e.g. 'Primary provider', 'Set 2, Dodo Payments, link 1 (Individual)'
  before    TEXT NOT NULL DEFAULT '',
  after     TEXT NOT NULL DEFAULT '',
  checked   TEXT NOT NULL DEFAULT '',            -- what the live check found, for a link change
  reason    TEXT NOT NULL
);
CREATE INDEX idx_checkout_audit_at ON checkout_audit (at);
