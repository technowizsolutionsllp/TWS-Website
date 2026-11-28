// Continuing a trial on a recognised computer (protocol 1, revision 5).
//
// A computer that already holds a trial (it matches a stored row under the device policy) and registers
// again, for example after the app was reinstalled and its install key was lost, gets that same trial back
// with the count the service already has. It is never given a fresh one. These are the pure rules; the
// handlers in handlers.ts apply them, and the shared vectors (scripts/generate-trial-vectors.mjs) test them.

import { SCAN_MODES, type ScanCounts } from './product';

/** What /register does when the request matches a stored trial (step 7). */
export type RestoreDecision = 'revoked' | 'restore' | 'already_used';

/**
 * - revoked: the trial was revoked; refuse with the support reference only.
 * - restore: the request names the trial's support reference (`resume`, which the app got from /lookup),
 *   or its email matches the stored one; the trial continues under the new install key.
 * - already_used: any other request from that computer (another email, for example) is refused.
 */
export function restoreDecision(
  row: { status: string; support_ref: string },
  request: { resume: string | null; emailMatches: boolean },
): RestoreDecision {
  if (row.status === 'revoked') return 'revoked';
  if (request.resume !== null && request.resume === row.support_ref) return 'restore';
  if (request.emailMatches) return 'restore';
  return 'already_used';
}

const MASK = '•••';
const first = (word: string) => [...word][0] ?? '';

/** "jane.doe@example.com" -> "j•••@example.com". Only the first character of the local part is shown. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return MASK;
  return `${first(email.slice(0, at))}${MASK}${email.slice(at)}`;
}

const MAX_NAME_WORDS = 4;

/** "Jane van Doe" -> "J••• v••• D•••". The first character of each word (at most four words). */
export function maskName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, MAX_NAME_WORDS);
  return words.length === 0 ? MASK : words.map((w) => `${first(w)}${MASK}`).join(' ');
}

/** NoDupe: a restore keeps the higher count per mode and never goes above the limit (the usage rule). */
export function mergeCounts(stored: ScanCounts, reported: ScanCounts, limit: ScanCounts): ScanCounts {
  const out = {} as ScanCounts;
  for (const mode of SCAN_MODES) out[mode] = Math.max(stored[mode], Math.min(reported[mode], limit[mode]));
  return out;
}

/** A support reference as the service issues it: 8 characters of Crockford base32 (no I, L, O, U). */
export const SUPPORT_REF_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/;
