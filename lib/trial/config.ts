// Environment contract for the trial service (website plan sections 4 and 6).
//
// Secrets (set with `wrangler secret put`, never in wrangler.json), all
// base64url of at least 16 random bytes (32 recommended):
//   PEPPER, PEPPER_EMAIL, PII_KEY, CHALLENGE_KEY
//   TRIAL_KEY_<kid>   X25519 private key (raw 32 bytes) for each kid
// Plain configuration (wrangler.json "vars"):
//   ACCEPTED_KIDS, TRIAL_TERMS_VERSION, TRIAL_PRIVACY_VERSION,
//   TRIAL_DIFFICULTY, TRIAL_DIFFICULTY_MIN/MAX, TRIAL_LIMIT
// Bindings: TRIAL_DB (D1); optional rate limiters TRIAL_CHALLENGE_LIMITER,
//   TRIAL_REGISTER_LIMITER, TRIAL_USAGE_LIMITER.

export type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export type TrialEnv = {
  TRIAL_DB: D1Database;
  PEPPER: string;
  PEPPER_EMAIL: string;
  PII_KEY: string;
  CHALLENGE_KEY: string;
  ACCEPTED_KIDS: string;
  TRIAL_TERMS_VERSION: string;
  TRIAL_PRIVACY_VERSION: string;
  TRIAL_DIFFICULTY?: string;
  TRIAL_DIFFICULTY_MIN?: string;
  TRIAL_DIFFICULTY_MAX?: string;
  TRIAL_LIMIT?: string;
  TRIAL_CHALLENGE_LIMITER?: RateLimiter;
  TRIAL_REGISTER_LIMITER?: RateLimiter;
  TRIAL_USAGE_LIMITER?: RateLimiter;
};

export const PROTOCOL_VERSION = 1;
export const BASE_PATH = '/api/pinchpdf/trial/v1/';

export const MAX_REQUEST_BYTES = 8 * 1024;
export const MAX_RESPONSE_BYTES = 4 * 1024;

export const CHALLENGE_MAX_AGE_SECONDS = 600;
export const CHALLENGE_FUTURE_TOLERANCE_SECONDS = 30;
export const CONTACT_WRITE_INTERVAL_SECONDS = 3600;

function intVar(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function difficultyRange(env: TrialEnv) {
  const min = intVar(env.TRIAL_DIFFICULTY_MIN, 16, 1, 32);
  const max = intVar(env.TRIAL_DIFFICULTY_MAX, 28, min, 32);
  const current = intVar(env.TRIAL_DIFFICULTY, 20, min, max);
  return { min, max, current };
}

export function trialLimit(env: TrialEnv): number {
  return intVar(env.TRIAL_LIMIT, 5, 1, 255);
}

export function acceptedKids(env: TrialEnv): string[] {
  return (env.ACCEPTED_KIDS ?? '')
    .split(',')
    .map((kid) => kid.trim())
    .filter((kid) => /^[A-Za-z0-9]{1,16}$/.test(kid));
}

/** Private key secret for a kid, or undefined when no secret exists. */
export function kidPrivateKey(env: TrialEnv, kid: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[`TRIAL_KEY_${kid}`];
  return typeof value === 'string' && value ? value : undefined;
}
