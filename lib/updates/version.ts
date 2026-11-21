// Semantic versions for the update check: parsing and ordering (semver 2.0 without build metadata).
// Pre-releases sort before the release they lead up to: 1.4.0-beta.1 < 1.4.0.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export type Version = { major: number; minor: number; patch: number; pre: string[] };

export function parseVersion(text: unknown): Version | null {
  if (typeof text !== 'string' || text.length > 64) return null;
  const match = SEMVER.exec(text);
  if (!match) return null;
  const numbers = [match[1], match[2], match[3]].map(Number);
  if (!numbers.every((n) => Number.isSafeInteger(n))) return null;
  const pre = match[4] ? match[4].split('.') : [];
  // Numeric pre-release identifiers must not have leading zeros.
  if (pre.some((id) => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) return null;
  return { major: numbers[0], minor: numbers[1], patch: numbers[2], pre };
}

export const isVersion = (text: unknown): text is string => parseVersion(text) !== null;

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a release is newer than its own pre-releases
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === undefined) return -1; // fewer identifiers sort first
    if (b[i] === undefined) return 1;
    const aNumeric = /^\d+$/.test(a[i]);
    const bNumeric = /^\d+$/.test(b[i]);
    if (aNumeric && bNumeric) {
      const diff = Number(a[i]) - Number(b[i]);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1; // numeric identifiers sort before alphanumeric ones
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Negative when a < b, 0 when equal, positive when a > b. Both must be valid versions. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error('compareVersions needs valid semantic versions');
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  }
  return comparePre(x.pre, y.pre);
}
