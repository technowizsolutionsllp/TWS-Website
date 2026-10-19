const encoder = new TextEncoder();

async function hmac(keyBytes: Uint8Array, data: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

export function timingSafeEqual(a: string, b: string) {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// Lemon Squeezy: X-Signature = hex(HMAC-SHA256(signing secret, raw body)).
export async function verifyLemonSqueezy(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = toHex(await hmac(encoder.encode(secret), rawBody));
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}

// Dodo Payments follows the Standard Webhooks spec:
// signed content = `${webhook-id}.${webhook-timestamp}.${body}`, key = base64
// part of the `whsec_...` secret, header = space-separated `v1,<base64 sig>`.
export async function verifyDodo(
  rawBody: string,
  headers: Headers,
  secret: string,
  toleranceSeconds = 300,
) {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatures = headers.get('webhook-signature');
  if (!id || !timestamp || !signatures) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

  let keyBytes: Uint8Array;
  try {
    keyBytes = fromBase64(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  } catch {
    return false;
  }

  const expected = toBase64(await hmac(keyBytes, `${id}.${timestamp}.${rawBody}`));
  return signatures.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && !!sig && timingSafeEqual(expected, sig);
  });
}
