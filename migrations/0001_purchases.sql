-- One row per purchase. Providers send the customer and the license key in
-- separate events, so rows are upserted by (provider, order_ref) and filled in
-- as each event arrives.
CREATE TABLE IF NOT EXISTS purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,          -- 'lemonsqueezy' | 'dodo'
  order_ref   TEXT NOT NULL,          -- provider order / payment id
  name        TEXT,
  email       TEXT,
  license_key TEXT,
  product     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (provider, order_ref)
);
CREATE INDEX IF NOT EXISTS purchases_created_idx ON purchases (created_at DESC);
