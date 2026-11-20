// Server-side handling of the client's signal hashes (protocol section 2).
//
//   client hash   SHA-256("pinchpdf-trial-signal-v1|<name>|" || normalized value)   (32 bytes, b64url on the wire)
//   stored value  b64url( HMAC-SHA256(PEPPER, "<name>|" || client_hash_bytes) )
//
// The signal name is part of both inputs so identical values in different
// columns cannot collide.

import { b64urlDecode, b64urlEncode, concat, utf8 } from './bytes';
import { hmacSha256, sha256 } from './crypto';
import type { TrialEnv } from './config';
import { SIGNAL_NAMES, type SignalName, type Signals } from './matching';

// Known placeholder values (normalized: trimmed, lowercase). A patched client
// must not be able to send these as "usable" signals, either to collide with
// other machines or to dodge a real match. The list is versioned and shared
// through the vectors file; the app's own filter is a superset (contains-match).
export const PLACEHOLDER_LIST_VERSION = '1';
export const PLACEHOLDER_VALUES: readonly string[] = [
  'o.e.m',
  'o.e.m.',
  'to be filled by o.e.m.',
  'default string',
  'none',
  'not specified',
  'not applicable',
  'system serial number',
  'base board serial number',
  'to be filled',
  '123456789',
  '0000000',
  '00000000',
  'n/a',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
];

export async function clientSignalHash(name: SignalName, normalizedValue: string): Promise<string> {
  return b64urlEncode(await sha256(utf8(`pinchpdf-trial-signal-v1|${name}|${normalizedValue}`)));
}

let placeholderHashes: Promise<Record<SignalName, Set<string>>> | undefined;

function loadPlaceholderHashes() {
  placeholderHashes ??= (async () => {
    const out = { guid: new Set<string>(), smbios: new Set<string>(), board: new Set<string>() };
    for (const name of SIGNAL_NAMES) {
      for (const value of PLACEHOLDER_VALUES) out[name].add(await clientSignalHash(name, value));
    }
    return out;
  })();
  return placeholderHashes;
}

/**
 * Parses the request's `signals` object. A signal that is missing, null,
 * malformed, or a known placeholder hash is unusable (null). Returns null when
 * the object itself is malformed.
 */
export async function parseClientSignals(value: unknown): Promise<Record<SignalName, Uint8Array | null> | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const placeholders = await loadPlaceholderHashes();
  const out = {} as Record<SignalName, Uint8Array | null>;
  for (const name of SIGNAL_NAMES) {
    const raw = input[name];
    if (raw === null || raw === undefined) {
      out[name] = null;
      continue;
    }
    const bytes = b64urlDecode(raw);
    if (!bytes || bytes.length !== 32) return null;
    out[name] = placeholders[name].has(raw as string) ? null : bytes;
  }
  return out;
}

/** HMAC the usable client hashes with the pepper. */
export async function pepperSignals(env: TrialEnv, clientHashes: Record<SignalName, Uint8Array | null>): Promise<Signals> {
  const out = {} as Signals;
  for (const name of SIGNAL_NAMES) {
    const hash = clientHashes[name];
    out[name] = hash ? b64urlEncode(await hmacSha256(env.PEPPER, concat(utf8(`${name}|`), hash))) : null;
  }
  return out;
}
