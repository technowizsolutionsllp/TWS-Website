// Field encryption for contact data (website plan section 4).
// Stored as "v1.<iv b64url>.<ciphertext+tag b64url>", AES-256-GCM, AAD = "<trial id>|<field>".

import { aesGcmOpen, aesGcmSeal, hmacSha256 } from './crypto';
import { b64urlDecode, b64urlEncode, randomBytes, utf8 } from './bytes';
import type { TrialEnv } from './config';

export type PiiField = 'name' | 'email';

function piiKey(env: TrialEnv): Uint8Array {
  const raw = b64urlDecode(env.PII_KEY);
  if (!raw || raw.length !== 32) throw new Error('PII_KEY must be 32 bytes, base64url');
  return raw;
}

export async function encryptField(env: TrialEnv, trialId: string, field: PiiField, value: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await aesGcmSeal(piiKey(env), iv, utf8(`${trialId}|${field}`), utf8(value));
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

export async function decryptField(env: TrialEnv, trialId: string, field: PiiField, stored: string): Promise<string | null> {
  const [version, ivB64, ctB64] = stored.split('.');
  const iv = b64urlDecode(ivB64);
  const ct = b64urlDecode(ctB64);
  if (version !== 'v1' || !iv || !ct) return null;
  const pt = await aesGcmOpen(piiKey(env), iv, utf8(`${trialId}|${field}`), ct);
  return pt ? new TextDecoder().decode(pt) : null;
}

/** Blind index for support lookup by email: HMAC-SHA256(PEPPER_EMAIL, lower(email)). */
export async function emailBlindIndex(env: TrialEnv, email: string): Promise<string> {
  return b64urlEncode(await hmacSha256(env.PEPPER_EMAIL, utf8(email.trim().toLowerCase())));
}
