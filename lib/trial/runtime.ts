// Resolves the real Workers environment for the route files. Handlers take the
// environment as an argument, so everything else stays testable.

import { configStatus, type TrialEnv } from './config';
import { PINCHPDF, productDb, type ProductSpec } from './product';
import { unavailable } from './responses';

export async function getTrialEnv(product: ProductSpec = PINCHPDF): Promise<TrialEnv | undefined> {
  try {
    const { env } = await import('cloudflare:workers');
    const trial = env as unknown as Partial<TrialEnv>;
    // The product's own database must be bound; PinchPDF's has always been required for the trial service.
    return productDb(trial as TrialEnv, product) ? (trial as TrialEnv) : undefined;
  } catch {
    return undefined;
  }
}

// A broken configuration is logged at most once a minute per Worker instance (so a busy endpoint
// cannot flood the logs), always as names and short descriptions, never values.
const CONFIG_LOG_INTERVAL_MS = 60_000;
let lastConfigLog = 0;

/** Test hook. */
export function resetConfigLog() {
  lastConfigLog = 0;
}

function logConfigProblem(fields: Record<string, unknown>, now: number) {
  if (lastConfigLog !== 0 && now - lastConfigLog < CONFIG_LOG_INTERVAL_MS) return;
  lastConfigLog = now;
  console.error(JSON.stringify({ svc: 'trial', result: 'config_invalid', ...fields }));
}

/**
 * Runs a handler only when the configuration is complete and well formed. Otherwise the answer is
 * 503 "unavailable" (the protocol's server-side failure, which the app shows as "service
 * unavailable", never as a decision about the user) and the log names what to fix. Without this
 * check a malformed secret surfaced as a silent 400 or a generic crash.
 */
export async function runWithEnv(env: TrialEnv, run: (env: TrialEnv) => Promise<Response>, now = Date.now(), product: ProductSpec = PINCHPDF): Promise<Response> {
  const { missing, invalid } = configStatus(env, product);
  if (missing.length > 0 || invalid.length > 0) {
    logConfigProblem({ missing, invalid }, now);
    return unavailable();
  }
  try {
    return await run(env);
  } catch (error) {
    console.error(JSON.stringify({ svc: 'trial', result: 'unhandled', message: String((error as Error)?.message).slice(0, 120) }));
    return unavailable();
  }
}

export async function withTrialEnv(run: (env: TrialEnv) => Promise<Response>, product: ProductSpec = PINCHPDF): Promise<Response> {
  const env = await getTrialEnv(product);
  if (!env) {
    logConfigProblem({ product: product.id, missing: [product.dbBinding] }, Date.now());
    return unavailable(); // not configured here: the app reads this as "service unavailable"
  }
  return runWithEnv(env, run, Date.now(), product);
}

/** Raw environment for routes that need only secrets or limiters (the API docs). */
export async function getRawEnv<T>(): Promise<T> {
  try {
    const { env } = await import('cloudflare:workers');
    return env as unknown as T;
  } catch {
    return {} as T;
  }
}

/** Environment for the update check: bindings only, so a broken trial secret cannot take it down. */
export async function withUpdatesEnv(run: (env: import('../updates/store').UpdatesEnv) => Promise<Response>): Promise<Response> {
  return run(await getRawEnv<import('../updates/store').UpdatesEnv>());
}
