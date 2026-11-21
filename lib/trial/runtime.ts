// Resolves the real Workers environment for the route files. Handlers take the
// environment as an argument, so everything else stays testable.

import { configStatus, type TrialEnv } from './config';
import { unavailable } from './responses';

export async function getTrialEnv(): Promise<TrialEnv | undefined> {
  try {
    const { env } = await import('cloudflare:workers');
    const trial = env as unknown as Partial<TrialEnv>;
    return trial.TRIAL_DB ? (trial as TrialEnv) : undefined;
  } catch {
    return undefined;
  }
}

// Logged once per Worker instance, only when something is missing (names, never values).
let configLogged = false;

/** Test hook. */
export function resetConfigLog() {
  configLogged = false;
}

function logMissingConfig(env: TrialEnv) {
  if (configLogged) return;
  const { present, missing } = configStatus(env);
  if (missing.length === 0) return;
  configLogged = true;
  console.warn(JSON.stringify({ svc: 'trial', result: 'config_incomplete', missing, present }));
}

export async function withTrialEnv(run: (env: TrialEnv) => Promise<Response>): Promise<Response> {
  const env = await getTrialEnv();
  if (!env) {
    console.warn(JSON.stringify({ svc: 'trial', result: 'config_incomplete', missing: ['TRIAL_DB'] }));
    return unavailable(); // not configured here: the app reads this as "service unavailable"
  }
  logMissingConfig(env);
  try {
    return await run(env);
  } catch (error) {
    console.error(JSON.stringify({ svc: 'trial', result: 'unhandled', message: String((error as Error)?.message).slice(0, 120) }));
    return unavailable();
  }
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
