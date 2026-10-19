import { getEnv } from './env';
import { timingSafeEqual } from './verify';

export const adminCookieName = 'tws_admin';

async function sessionToken(secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('tws-admin-session-v1'));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkAdminSecret(candidate: string) {
  const secret = await getEnv('ADMIN_SECRET');
  return !!secret && timingSafeEqual(candidate, secret);
}

export async function issueAdminToken() {
  const secret = await getEnv('ADMIN_SECRET');
  return secret ? sessionToken(secret) : null;
}

// Accepts the session cookie, or `Authorization: Bearer <ADMIN_SECRET>` for scripts.
export async function isAdmin(cookieValue: string | undefined, authHeader?: string | null) {
  const secret = await getEnv('ADMIN_SECRET');
  if (!secret) return false;
  if (cookieValue && timingSafeEqual(cookieValue, await sessionToken(secret))) return true;
  const bearer = authHeader?.match(/^Bearer (.+)$/)?.[1];
  return !!bearer && timingSafeEqual(bearer, secret);
}
