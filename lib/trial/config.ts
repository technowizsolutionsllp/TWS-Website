// Environment contract for the trial service (website plan sections 4 and 6).
//
// Secrets (set with `wrangler secret put`, never in wrangler.json), all BASE64URL (A-Z a-z 0-9 - _,
// no "=" padding, no quotes), NOT hex. A 32-byte value is 43 characters:
//   PEPPER, PEPPER_EMAIL, CHALLENGE_KEY   at least 16 bytes (32 recommended)
//   PII_KEY                               exactly 32 bytes
//   TRIAL_KEY_<kid>                       X25519 private key, exactly 32 bytes, for each kid
// A wrong format is reported by configStatus() below, logged, and answered with 503.
// Plain configuration (wrangler.json "vars"):
//   ACCEPTED_KIDS, TRIAL_TERMS_VERSION, TRIAL_PRIVACY_VERSION,
//   TRIAL_DIFFICULTY, TRIAL_DIFFICULTY_MIN/MAX, TRIAL_LIMIT
// Bindings: TRIAL_DB (D1); optional rate limiters TRIAL_CHALLENGE_LIMITER,
//   TRIAL_REGISTER_LIMITER, TRIAL_USAGE_LIMITER (per trial id), TRIAL_USAGE_IP_LIMITER (per IP),
//   TRIAL_DOCS_LIMITER (see docs.ts).

import { b64urlDecode } from './bytes';

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
  TRIAL_USAGE_IP_LIMITER?: RateLimiter;
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

export type ConfigProblem = { name: string; problem: string };

/**
 * Checks one secret against what the code actually needs, and says what is wrong in words.
 * Never includes the value (or any part of it), so the result is safe to log and to return
 * to the authenticated health route.
 *
 *   exactBytes  the secret must decode to exactly this many bytes (AES and X25519 keys)
 *   minBytes    the secret must decode to at least this many (HMAC keys)
 */
export function secretProblem(value: string, rule: { exactBytes: number } | { minBytes: number }): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    const found = [
      /=/.test(value) && '"=" padding',
      /\//.test(value) && '"/"',
      /\+/.test(value) && '"+"',
      /\s/.test(value) && 'spaces or line breaks',
      /["']/.test(value) && 'quotes',
    ].filter(Boolean);
    return `not base64url${found.length ? `: contains ${found.join(', ')}` : ''}. Use only A-Z a-z 0-9 - _ (no padding, no quotes)`;
  }
  const bytes = b64urlDecode(value);
  if (!bytes) return 'not valid base64url';
  if ('exactBytes' in rule && bytes.length !== rule.exactBytes) {
    const hex = value.length === rule.exactBytes * 2 && /^[0-9a-fA-F]+$/.test(value);
    return (
      `decodes to ${bytes.length} bytes, expected exactly ${rule.exactBytes} (${Math.ceil((rule.exactBytes * 4) / 3)} base64url characters)` +
      (hex ? '. This looks like HEX; the secret must be base64url, e.g. from: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"' : '')
    );
  }
  if ('minBytes' in rule && bytes.length < rule.minBytes) return `decodes to ${bytes.length} bytes, expected at least ${rule.minBytes}`;
  return null;
}

/**
 * Which required configuration names are present, missing or malformed. Names and short
 * descriptions only, never values, so it is safe to write to logs. Used to diagnose a deploy
 * that lost a secret or a secret pasted in the wrong format.
 */
export function configStatus(env: Partial<TrialEnv>): { present: string[]; missing: string[]; invalid: ConfigProblem[] } {
  const record = env as Record<string, unknown>;
  const text = (name: string) => (typeof record[name] === 'string' ? (record[name] as string) : '');
  const has = (name: string) => text(name).length > 0;
  const kids = acceptedKids(env as TrialEnv);
  const names = ['PEPPER', 'PEPPER_EMAIL', 'PII_KEY', 'CHALLENGE_KEY', 'ACCEPTED_KIDS', 'TRIAL_TERMS_VERSION', 'TRIAL_PRIVACY_VERSION', ...kids.map((kid) => `TRIAL_KEY_${kid}`)];

  const invalid: ConfigProblem[] = [];
  const check = (name: string, rule: { exactBytes: number } | { minBytes: number }) => {
    if (!has(name)) return;
    const problem = secretProblem(text(name), rule);
    if (problem) invalid.push({ name, problem });
  };
  for (const name of ['PEPPER', 'PEPPER_EMAIL', 'CHALLENGE_KEY']) check(name, { minBytes: 16 });
  check('PII_KEY', { exactBytes: 32 });
  for (const kid of kids) check(`TRIAL_KEY_${kid}`, { exactBytes: 32 });

  if (has('ACCEPTED_KIDS')) {
    const listed = text('ACCEPTED_KIDS').split(',').map((kid) => kid.trim()).filter(Boolean);
    if (kids.length === 0) invalid.push({ name: 'ACCEPTED_KIDS', problem: 'lists no usable key id (each must be 1 to 16 letters or digits, separated by commas)' });
    else if (listed.length !== kids.length) invalid.push({ name: 'ACCEPTED_KIDS', problem: 'has an entry that is not 1 to 16 letters or digits; it is ignored' });
  }
  return { present: names.filter(has), missing: names.filter((name) => !has(name)), invalid };
}

/** Private key secret for a kid, or undefined when no secret exists. */
export function kidPrivateKey(env: TrialEnv, kid: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[`TRIAL_KEY_${kid}`];
  return typeof value === 'string' && value ? value : undefined;
}
