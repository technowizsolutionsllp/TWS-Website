// Thin wrappers over Web Crypto for the trial protocol. No third-party crypto:
// Workers and Node both provide X25519, Ed25519, HKDF, HMAC and AES-GCM.

import { b64urlDecode, concat, isAllZero, utf8 } from './bytes';

export async function sha256(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)) as Uint8Array<ArrayBuffer>;
}

// Imported HMAC keys are cached per secret string so a request only pays the
// import once per isolate (CPU time matters on the Free plan).
const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secretB64: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  const cacheKey = `${usage}|${secretB64}`;
  let key = hmacKeys.get(cacheKey);
  if (!key) {
    const raw = b64urlDecode(secretB64);
    if (!raw || raw.length < 16) throw new Error('trial secret is not valid base64url');
    key = crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
    hmacKeys.set(cacheKey, key);
  }
  return key;
}

export async function hmacSha256(secretB64: string, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const key = await hmacKey(secretB64, 'sign');
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as BufferSource)) as Uint8Array<ArrayBuffer>;
}

/** Constant-time HMAC check. */
export async function hmacVerify(secretB64: string, mac: Uint8Array, data: Uint8Array): Promise<boolean> {
  const key = await hmacKey(secretB64, 'verify');
  return crypto.subtle.verify('HMAC', key, mac as BufferSource, data as BufferSource);
}

export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length = 32,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: utf8(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits) as Uint8Array<ArrayBuffer>;
}

export async function aesGcmSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
    k,
    plaintext as BufferSource,
  );
  return new Uint8Array(ct) as Uint8Array<ArrayBuffer>;
}

/** Returns null when the tag does not verify. */
export async function aesGcmOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['decrypt']);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource, tagLength: 128 },
      k,
      ciphertext as BufferSource,
    );
    return new Uint8Array(pt) as Uint8Array<ArrayBuffer>;
  } catch {
    return null;
  }
}

// PKCS#8 wrapper for a raw 32-byte X25519 private key (RFC 8410).
const X25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]);

/** X25519 agreement. Returns null if the result is all zeros (low-order point). */
export async function x25519Shared(
  privateRaw: Uint8Array,
  publicRaw: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (privateRaw.length !== 32 || publicRaw.length !== 32) return null;
  try {
    const priv = await crypto.subtle.importKey(
      'pkcs8',
      concat(X25519_PKCS8_PREFIX, privateRaw) as BufferSource,
      { name: 'X25519' },
      false,
      ['deriveBits'],
    );
    const pub = await crypto.subtle.importKey('raw', publicRaw as BufferSource, { name: 'X25519' }, false, []);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: pub }, priv, 256));
    return isAllZero(bits) ? null : (bits as Uint8Array<ArrayBuffer>);
  } catch {
    return null;
  }
}

export async function ed25519Verify(
  publicRaw: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  if (publicRaw.length !== 32 || signature.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey('raw', publicRaw as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature as BufferSource, message as BufferSource);
  } catch {
    return false;
  }
}
