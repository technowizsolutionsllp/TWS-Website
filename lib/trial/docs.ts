// Protected API documentation for the trial service: Swagger UI plus the OpenAPI
// spec, behind HTTP Basic authentication (a user ID and a password held as
// Worker secrets). Fails closed: with no credentials configured the routes
// answer 404 as if they did not exist.
//
//   GET /api/pinchpdf/trial/docs        Swagger UI
//   GET /api/pinchpdf/trial/docs/spec   OpenAPI 3.1 JSON
//   GET /api/pinchpdf/trial/docs/health Configuration check (names and reasons, never values)

import { utf8 } from './bytes';
import { configStatus, type RateLimiter, type TrialEnv } from './config';
import { sha256 } from './crypto';
import { buildOpenApiSpec } from './openapi';
import { plain, rateLimited } from './responses';

export type DocsEnv = {
  DOCS_USER?: string;
  DOCS_PASSWORD?: string;
  TRIAL_DOCS_LIMITER?: RateLimiter;
};

// Pinned, with Subresource Integrity hashes (computed from the files at this version).
const SWAGGER_VERSION = '5.17.14';
const SWAGGER_CSS_SRI = 'sha384-wxLW6kwyHktdDGr6Pv1zgm/VGJh99lfUbzSn6HNHBENZlCN7W602k9VkGdxuFvPn';
const SWAGGER_JS_SRI = 'sha384-wmyclcVGX/WhUkdkATwhaK1X1JtiNrr2EoYJ+diV3vj4v6OC5yCeSu+yW13SYJep';

// A very short password makes Basic auth guessable, so the docs stay OFF below this length.
// Per-IP rate limiting (TRIAL_DOCS_LIMITER) is the main guard against guessing; a longer password is still better.
export const MIN_DOCS_PASSWORD_LENGTH = 8;

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

// Best-effort fallback (per isolate) used only when the rate-limit binding is not available,
// so password guessing is never completely unthrottled.
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

/** Test hook. */
export function resetDocsFallbackLimiter() {
  fallbackHits.clear();
  disabledLogged = false;
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 'unknown'; // never trust X-Forwarded-For
}

/** Constant-time comparison of two strings via their SHA-256 digests (no length leak). */
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

function challenge(): Response {
  return new Response('Authentication required', {
    status: 401,
    headers: { ...SECURITY_HEADERS, 'WWW-Authenticate': 'Basic realm="PinchPDF and NoDupe API docs", charset="UTF-8"' },
  });
}

/** Returns a Response when the request must NOT proceed, or null when it is authorised. */
// The docs are off when misconfigured. Say why in the logs (once per instance), by name only,
// so a deploy that dropped a secret is easy to spot. Never logs a value.
let disabledLogged = false;
function logDocsDisabled(env: DocsEnv) {
  if (disabledLogged) return;
  disabledLogged = true;
  console.warn(
    JSON.stringify({
      svc: 'trial',
      endpoint: 'docs',
      result: 'disabled',
      DOCS_USER: Boolean(env.DOCS_USER),
      DOCS_PASSWORD: Boolean(env.DOCS_PASSWORD),
      password_long_enough: (env.DOCS_PASSWORD?.length ?? 0) >= MIN_DOCS_PASSWORD_LENGTH,
    }),
  );
}

export async function guardDocs(request: Request, env: DocsEnv): Promise<Response | null> {
  if (!env.DOCS_USER || !env.DOCS_PASSWORD || env.DOCS_PASSWORD.length < MIN_DOCS_PASSWORD_LENGTH) {
    logDocsDisabled(env);
    return plain(404, { error: 'not_found' }, SECURITY_HEADERS); // disabled, fail closed
  }
  // Counts every request, so password guessing is throttled per IP before credentials are checked.
  if (env.TRIAL_DOCS_LIMITER) {
    try {
      if (!(await env.TRIAL_DOCS_LIMITER.limit({ key: clientIp(request) })).success) return rateLimited();
    } catch {
      // a limiter failure must not lock the owner out
    }
  } else if (!fallbackAllow(clientIp(request))) {
    return rateLimited();
  }
  const given = parseBasic(request.headers.get('authorization'));
  if (!given) return challenge();
  // Evaluate both so timing does not reveal which one was wrong.
  const [userOk, passwordOk] = await Promise.all([sameSecret(given.user, env.DOCS_USER), sameSecret(given.password, env.DOCS_PASSWORD)]);
  return userOk && passwordOk ? null : challenge();
}

export async function handleDocsPage(request: Request, env: DocsEnv): Promise<Response> {
  const blocked = await guardDocs(request, env);
  if (blocked) return blocked;
  const base = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}`;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>PinchPDF and NoDupe API</title>
<link rel="stylesheet" href="${base}/swagger-ui.css" integrity="${SWAGGER_CSS_SRI}" crossorigin="anonymous">
<style>body{margin:0}</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="${base}/swagger-ui-bundle.js" integrity="${SWAGGER_JS_SRI}" crossorigin="anonymous"></script>
<script nonce="${nonce}">
  window.ui = SwaggerUIBundle({
    url: '/api/pinchpdf/trial/docs/spec',
    dom_id: '#swagger-ui',
    deepLinking: true,
    docExpansion: 'list',
    // The sealed endpoints cannot be exercised from a browser form.
    supportedSubmitMethods: [],
  });
</script>
</body>
</html>
`;
  // Only the pinned Swagger files (also integrity-checked) and our one nonce'd inline script may run.
  // Swagger UI sets inline style attributes, hence style-src 'unsafe-inline'.
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data:",
    "font-src 'self' data: https://cdn.jsdelivr.net",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return new Response(html, {
    status: 200,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp },
  });
}

/**
 * Configuration check behind the same password as the docs: which secrets are missing or
 * malformed, by name and with a short reason, never a value. Open it after every deploy.
 * A 200 means the trial endpoints will run; a 503 means they answer "unavailable" until the
 * listed items are fixed.
 */
export async function handleDocsHealth(request: Request, env: DocsEnv & Partial<TrialEnv>): Promise<Response> {
  const blocked = await guardDocs(request, env);
  if (blocked) return blocked;
  const { missing, invalid } = configStatus(env);
  const checks = {
    database_binding: Boolean(env.TRIAL_DB),
    secrets_present: missing.length === 0,
    secrets_well_formed: invalid.length === 0,
  };
  const ok = checks.database_binding && missing.length === 0 && invalid.length === 0;
  return new Response(JSON.stringify({ ok, checks, missing, invalid }, null, 2), {
    status: ok ? 200 : 503,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function handleDocsSpec(request: Request, env: DocsEnv): Promise<Response> {
  const blocked = await guardDocs(request, env);
  if (blocked) return blocked;
  return new Response(JSON.stringify(buildOpenApiSpec(), null, 2), {
    status: 200,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
