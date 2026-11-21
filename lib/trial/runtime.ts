// Resolves the real Workers environment for the route files. Handlers take the
// environment as an argument, so everything else stays testable.

import type { TrialEnv } from './config';
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

export async function withTrialEnv(run: (env: TrialEnv) => Promise<Response>): Promise<Response> {
  const env = await getTrialEnv();
  if (!env) return unavailable(); // not configured here: the app reads this as "service unavailable"
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
