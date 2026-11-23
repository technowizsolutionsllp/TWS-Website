// Daily request counters for the admin insights page.
//
// Counts are kept in memory and written to D1 in small batches: at most one batch per
// instance every FLUSH_INTERVAL_MS, and one statement per distinct (day, product, endpoint,
// outcome). A flood of bad requests therefore cannot use up the D1 write allowance, and a
// metrics failure can never fail a trial request. The numbers are approximate: counts still
// waiting in memory are lost if an instance is recycled before its next flush.

import type { TrialEnv } from './config';

export const PRODUCT = 'pinchpdf';

// Requests from the admin health page carry this header and are left out of the counters.
// The counters are approximate and not a security control: the rate limiters and the envelope
// checks do not look at this header, so setting it only hides a client's own requests from the numbers.
export const HEALTH_HEADER = 'x-tws-health';
export const FLUSH_INTERVAL_MS = 10_000;
const MAX_PENDING_KEYS = 200;

type MetricsEnv = Pick<TrialEnv, 'TRIAL_DB'>;

const pending = new Map<string, number>(); // "day|product|endpoint|outcome" -> count
let lastFlush = 0;
let flushing = false;
let failureLogged = false;

/** Test hook. */
export function resetMetrics() {
  pending.clear();
  lastFlush = 0;
  flushing = false;
  failureLogged = false;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Outcome label for a response that was not tagged by a handler: derived from its HTTP status. */
export function outcomeFromStatus(status: number): string {
  if (status === 200) return 'ok';
  if (status === 400) return 'bad_request';
  if (status === 421) return 'kid_unsupported';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  return `http_${status}`;
}

/**
 * Counts one request. Never throws. `clockMs` picks the day; the flush throttle always uses
 * the real clock, so a fixed test clock cannot stall it.
 */
export async function recordMetric(env: MetricsEnv, endpoint: string, outcome: string, clockMs: number = Date.now(), product: string = PRODUCT): Promise<void> {
  try {
    const key = `${utcDay(clockMs)}|${product}|${endpoint}|${outcome}`;
    if (pending.size < MAX_PENDING_KEYS || pending.has(key)) pending.set(key, (pending.get(key) ?? 0) + 1);

    const now = Date.now();
    if (flushing || now - lastFlush < FLUSH_INTERVAL_MS || pending.size === 0) return;
    flushing = true;
    lastFlush = now;
    const batch = [...pending];
    pending.clear();
    try {
      const statement = env.TRIAL_DB.prepare(
        `INSERT INTO metrics_daily (day, product, endpoint, outcome, count) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(day, product, endpoint, outcome) DO UPDATE SET count = count + excluded.count`,
      );
      await env.TRIAL_DB.batch(
        batch.map(([k, count]) => {
          const [day, product, ep, out] = k.split('|');
          return statement.bind(day, product, ep, out, count);
        }),
      );
    } catch (error) {
      // Drop this batch rather than retry forever (for example if migration 0002 is not applied yet).
      if (!failureLogged) {
        failureLogged = true;
        console.warn(JSON.stringify({ svc: 'trial', result: 'metrics_write_failed', message: String((error as Error)?.message).slice(0, 120) }));
      }
    } finally {
      flushing = false;
    }
  } catch {
    // metrics must never affect a request
  }
}

// Handlers tag a response with the result code they already log; the wrapper reads it back.
const tagged = new WeakMap<Response, string>();

export function tagOutcome(response: Response, outcome: string): Response {
  tagged.set(response, outcome);
  return response;
}

export function outcomeOf(response: Response): string {
  return tagged.get(response) ?? outcomeFromStatus(response.status);
}
