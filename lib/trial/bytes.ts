// Byte helpers shared by the trial service (protocol section 4 encoding rules).
// Binary values on the wire are base64url WITHOUT padding.

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text) as Uint8Array<ArrayBuffer>;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Strict decoder: unpadded base64url only, canonical encoding only (a value
 * whose re-encoding differs, for example non-zero trailing bits, is rejected).
 * Returns null on any problem.
 */
export function b64urlDecode(text: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    return null;
  }
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return b64urlEncode(out) === text ? out : null;
  } catch {
    return null;
  }
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function u64be(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value));
  return out;
}

export function readU64be(bytes: Uint8Array): number {
  return Number(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0));
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function isAllZero(bytes: Uint8Array): boolean {
  let acc = 0;
  for (const byte of bytes) acc |= byte;
  return acc === 0;
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

// Crockford base32 (no I, L, O, U): 8 characters = 40 random bits.
const SUPPORT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newSupportRef(): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of randomBytes(5)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += SUPPORT_ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return out;
}

/** 128-bit random trial id, base64url. */
export function newTrialId(): string {
  return b64urlEncode(randomBytes(16));
}
