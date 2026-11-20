// Plain (unsealed) responses: only the HTTP 400/421/429/503 error bodies.

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export function plain(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...headers, ...extra } });
}

export const badRequest = () => plain(400, { error: 'bad_request' });
export const kidUnsupported = () => plain(421, { error: 'kid_unsupported' });
export const rateLimited = (retryAfterSeconds = 60) =>
  plain(429, { error: 'rate_limited' }, { 'Retry-After': String(retryAfterSeconds) });
export const unavailable = () => plain(503, { error: 'unavailable' }, { 'Retry-After': '30' });
