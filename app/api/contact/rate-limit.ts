// Per-client rate limiting for the contact endpoint.
//
// On Cloudflare Workers this uses the CONTACT_RATE_LIMITER binding declared in
// wrangler.json. Where the binding is unavailable (local Node server, tests) it
// falls back to a best-effort in-memory limiter with the same limits.

const limit = 5;
const periodSeconds = 60;

type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

const hits = new Map<string, number[]>();

async function getBinding(): Promise<RateLimiter | undefined> {
  try {
    const { env } = await import('cloudflare:workers');
    return (env as { CONTACT_RATE_LIMITER?: RateLimiter }).CONTACT_RATE_LIMITER;
  } catch {
    return undefined;
  }
}

function clientKey(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('cf-connecting-ip') || forwarded || 'unknown';
}

function inMemoryAllow(key: string) {
  const now = Date.now();
  const windowStart = now - periodSeconds * 1000;
  const recent = (hits.get(key) ?? []).filter((time) => time > windowStart);

  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }

  recent.push(now);
  hits.set(key, recent);

  if (hits.size > 1000) {
    for (const [storedKey, times] of hits) {
      if (times.every((time) => time <= windowStart)) {
        hits.delete(storedKey);
      }
    }
  }

  return true;
}

export const rateLimitRetryAfterSeconds = periodSeconds;

export async function isRateLimited(request: Request) {
  const key = clientKey(request);
  const binding = await getBinding();

  if (binding) {
    const { success } = await binding.limit({ key });
    return !success;
  }

  return !inMemoryAllow(key);
}
