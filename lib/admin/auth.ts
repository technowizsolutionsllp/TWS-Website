// HTTP Basic protection for the /admin pages. Same rules as the API docs: with no credentials
// configured the pages answer 404 as if they did not exist, guessing is throttled per IP before
// credentials are checked, and nothing is logged except which setting is missing (never a value).

import { utf8 } from '../trial/bytes';
import type { RateLimiter } from '../trial/config';
import { sha256 } from '../trial/crypto';
import { plain, rateLimited } from '../trial/responses';

export type AdminEnv = {
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;
  TRIAL_ADMIN_LIMITER?: RateLimiter;
};

export const MIN_ADMIN_PASSWORD_LENGTH = 8;

export const ADMIN_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// Best-effort per-instance fallback, used only when the rate-limit binding is missing.
const FALLBACK_LIMIT = 20;
const FALLBACK_WINDOW_MS = 60_000;
const fallbackHits = new Map<string, number[]>();

function fallbackAllow(key: string, now = Date.now()): boolean {
  const recent = (fallbackHits.get(key) ?? []).filter((t) => t > now - FALLBACK_WINDOW_MS);
  if (recent.length >= FALLBACK_LIMIT) {
    fallbackHits.set(key, recent);
    return false;
  }
  recent.push(now);
  fallbackHits.set(key, recent);
  if (fallbackHits.size > 500) {
    for (const [k, times] of fallbackHits) if (times.every((t) => t <= now - FALLBACK_WINDOW_MS)) fallbackHits.delete(k);
  }
  return true;
}

let disabledLogged = false;

/** Test hook. */
export function resetAdminGuard() {
  fallbackHits.clear();
  disabledLogged = false;
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 'unknown'; // never trust X-Forwarded-For
}

async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(utf8(given)), sha256(utf8(expected))]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function parseBasic(header: string | null): { user: string; password: string } | null {
  const match = header?.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return null;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0)));
    const colon = decoded.indexOf(':');
    return colon < 0 ? null : { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
  } catch {
    return null;
  }
}

const challenge = () =>
  new Response('Authentication required', {
    status: 401,
    headers: { ...ADMIN_HEADERS, 'WWW-Authenticate': 'Basic realm="TWS admin", charset="UTF-8"' },
  });

/**
 * CSRF guard for state-changing requests. Browsers send saved Basic credentials on cross-site requests too, so a POST
 * that comes from another site must be refused. A browser always sends Origin (or Sec-Fetch-Site) on a cross-site POST;
 * a script such as curl sends neither and is allowed (it had to supply the credentials itself).
 *
 * The admin pages send `Referrer-Policy: no-referrer`, and under that policy a browser sends `Origin: null` on a form
 * POST, even to the same site. So `null` says nothing about where the form came from: decide by Sec-Fetch-Site, and
 * refuse if it is missing (a sandboxed frame on another site also sends `Origin: null`).
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === 'null') return request.headers.get('sec-fetch-site') === 'same-origin';
  if (origin !== null) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}

/** Returns a Response when the request must NOT proceed, or null when it is authorised. */
export async function guardAdmin(request: Request, env: AdminEnv): Promise<Response | null> {
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD_LENGTH) {
    if (!disabledLogged) {
      disabledLogged = true;
      console.warn(
        JSON.stringify({
          svc: 'admin',
          result: 'disabled',
          ADMIN_USER: Boolean(env.ADMIN_USER),
          ADMIN_PASSWORD: Boolean(env.ADMIN_PASSWORD),
          password_long_enough: (env.ADMIN_PASSWORD?.length ?? 0) >= MIN_ADMIN_PASSWORD_LENGTH,
        }),
      );
    }
    return plain(404, { error: 'not_found' }, ADMIN_HEADERS);
  }
  if (env.TRIAL_ADMIN_LIMITER) {
    try {
      if (!(await env.TRIAL_ADMIN_LIMITER.limit({ key: clientIp(request) })).success) return rateLimited();
    } catch {
      // a limiter failure must not lock the owner out
    }
  } else if (!fallbackAllow(clientIp(request))) {
    return rateLimited();
  }
  const given = parseBasic(request.headers.get('authorization'));
  if (!given) return challenge();
  const [userOk, passwordOk] = await Promise.all([sameSecret(given.user, env.ADMIN_USER), sameSecret(given.password, env.ADMIN_PASSWORD)]);
  return userOk && passwordOk ? null : challenge();
}
