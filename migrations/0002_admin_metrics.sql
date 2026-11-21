-- Admin insights: a product column on trials, and daily request counters.
-- Counters hold only counts, never personal data. Rows are written in small batches
-- by lib/trial/metrics.ts, not once per request.

-- Existing rows belong to PinchPDF.
ALTER TABLE trials ADD COLUMN product TEXT NOT NULL DEFAULT 'pinchpdf';

CREATE INDEX idx_trials_created ON trials(created_at);

CREATE TABLE metrics_daily (
  day      TEXT NOT NULL,      -- UTC day, YYYY-MM-DD
  product  TEXT NOT NULL,
  endpoint TEXT NOT NULL,      -- challenge | register | usage
  outcome  TEXT NOT NULL,      -- result code, e.g. registered, already_used, rate_limited
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, product, endpoint, outcome)
) WITHOUT ROWID;
