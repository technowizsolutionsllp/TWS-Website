// Protected API documentation for the trial service: Swagger UI plus the OpenAPI
// spec, behind HTTP Basic authentication (a user ID and a password held as
// Worker secrets). Fails closed: with no credentials configured the routes
// answer 404 as if they did not exist.
//
//   GET /api/pinchpdf/trial/docs        Swagger UI
//   GET /api/pinchpdf/trial/docs/spec   OpenAPI 3.1 JSON

import { utf8 } from './bytes';
import type { RateLimiter } from './config';
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

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
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
    headers: { ...SECURITY_HEADERS, 'WWW-Authenticate': 'Basic realm="PinchPDF trial API docs", charset="UTF-8"' },
  });
}

/** Returns a Response when the request must NOT proceed, or null when it is authorised. */
export async function guardDocs(request: Request, env: DocsEnv): Promise<Response | null> {
  if (!env.DOCS_USER || !env.DOCS_PASSWORD) return plain(404, { error: 'not_found' }, SECURITY_HEADERS); // disabled
  if (env.TRIAL_DOCS_LIMITER) {
    try {
      // Counts every request, so password guessing is throttled per IP.
      if (!(await env.TRIAL_DOCS_LIMITER.limit({ key: clientIp(request) })).success) return rateLimited();
    } catch {
      // a limiter failure must not lock the owner out
    }
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
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>PinchPDF trial API</title>
<link rel="stylesheet" href="${base}/swagger-ui.css" integrity="${SWAGGER_CSS_SRI}" crossorigin="anonymous">
<style>body{margin:0}</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="${base}/swagger-ui-bundle.js" integrity="${SWAGGER_JS_SRI}" crossorigin="anonymous"></script>
<script>
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
  return new Response(html, { status: 200, headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function handleDocsSpec(request: Request, env: DocsEnv): Promise<Response> {
  const blocked = await guardDocs(request, env);
  if (blocked) return blocked;
  return new Response(JSON.stringify(buildOpenApiSpec(), null, 2), {
    status: 200,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
