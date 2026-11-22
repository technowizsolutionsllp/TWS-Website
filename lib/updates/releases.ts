// The release list (index.json) for one product: its shape, how an entry is verified, and which release
// an app should be offered. See docs/RELEASES.md section B.
//
// Each entry's identity is signed offline with the release key (Ed25519):
//
//   pinchpdf-release-v1|<Product>|<channel>|<version>|<sha256>|<size>
//
// The signature covers what the file is. The operational switches (enabled, rollout_percent, mandatory,
// min_supported, notes) are NOT signed, so a release can be paused or its notes fixed by re-uploading
// index.json without the offline key. The server drops every entry whose signature does not verify,
// so someone who can write to the bucket still cannot offer a file the key holder did not sign.

import { b64urlDecode, utf8 } from '../trial/bytes';
import { ed25519Verify } from '../trial/crypto';
import { compareVersions, parseVersion } from './version';

export const PRODUCTS = ['PinchPDF', 'NoDupe'] as const;
export type Product = (typeof PRODUCTS)[number];
export const CHANNELS = ['stable', 'beta'] as const;
export type Channel = (typeof CHANNELS)[number];

export const MAX_RELEASES = 500;
export const MAX_NOTES = 10;
export const MAX_NOTE_LENGTH = 200;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** The PinchPDF app only opens release notes on the company site, and refuses an update answer that names any other address. */
export const COMPANY_HOST = 'technowizsolutions.com';

export function isCompanyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === COMPANY_HOST || url.hostname.endsWith(`.${COMPANY_HOST}`));
  } catch {
    return false;
  }
}

export type Release = {
  version: string;
  channel: Channel;
  pub_date: string;
  notes: string[];
  notes_url: string | null;
  file: string;
  sha256: string;
  size: number;
  signature: string;
  min_supported: string | null;
  mandatory: boolean;
  rollout_percent: number;
  enabled: boolean;
};

export function releaseMessage(product: Product, release: Pick<Release, 'channel' | 'version' | 'sha256' | 'size'>): string {
  return `pinchpdf-release-v1|${product}|${release.channel}|${release.version}|${release.sha256}|${release.size}`;
}

/** The GitHub release tag of a version: <Product>-v<version>, for example PinchPDF-v1.3.0. A version is unique per product. */
export function releaseTag(product: Product, version: string): string {
  return `${product}-v${version}`;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && !CONTROL_CHARACTERS.test(value) ? value : null;
}

export type ParsedIndex = { releases: Release[]; problems: string[] };

/** Validates a whole index. Bad entries are dropped and reported; a bad file as a whole yields no releases. */
export async function parseIndex(source: string, product: Product, publicKey: Uint8Array | Uint8Array[]): Promise<ParsedIndex> {
  // Several keys may be trusted at once (key rotation); an entry is accepted if any of them signed it.
  const publicKeys = Array.isArray(publicKey) ? publicKey : [publicKey];
  const problems: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return { releases: [], problems: ['index.json is not valid JSON'] };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { releases: [], problems: ['index.json must be an object'] };
  const root = data as Record<string, unknown>;
  if (root.product !== undefined && root.product !== product) {
    return { releases: [], problems: [`index.json is for "${String(root.product).slice(0, 40)}", not ${product}`] };
  }
  if (!Array.isArray(root.releases)) return { releases: [], problems: ['index.json has no "releases" list'] };
  if (root.releases.length > MAX_RELEASES) problems.push(`more than ${MAX_RELEASES} releases: only the first ${MAX_RELEASES} are read`);

  const releases: Release[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of root.releases.slice(0, MAX_RELEASES).entries()) {
    const label = `release #${i + 1}`;
    const bad = (why: string) => problems.push(`${label}: ${why}`);
    if (typeof raw !== 'object' || raw === null) {
      bad('not an object');
      continue;
    }
    const e = raw as Record<string, unknown>;
    const version = typeof e.version === 'string' ? e.version : '';
    const parsed = parseVersion(version);
    if (!parsed) {
      bad('version is not a semantic version');
      continue;
    }
    const channel = e.channel;
    if (channel !== 'stable' && channel !== 'beta') {
      bad(`${version}: channel must be "stable" or "beta"`);
      continue;
    }
    if (channel === 'stable' && parsed.pre.length > 0) {
      bad(`${version}: a stable release cannot be a pre-release version`);
      continue;
    }
    if (seen.has(version)) {
      bad(`${version}: listed twice (a version is unique across channels)`);
      continue;
    }
    const sha256 = typeof e.sha256 === 'string' ? e.sha256.toLowerCase() : '';
    const size = e.size;
    const file = typeof e.file === 'string' ? e.file : '';
    const folder = `${releaseTag(product, version)}/`;
    if (!SHA256.test(sha256)) {
      bad(`${version}: sha256 must be 64 hex characters`);
      continue;
    }
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) {
      bad(`${version}: size must be a positive whole number`);
      continue;
    }
    if (!file.startsWith(folder) || !FILE_NAME.test(file.slice(folder.length))) {
      bad(`${version}: file must be ${folder}<file name>`);
      continue;
    }
    const pubDate = typeof e.pub_date === 'string' ? e.pub_date : '';
    if (!/^\d{4}-\d{2}-\d{2}T/.test(pubDate) || Number.isNaN(Date.parse(pubDate))) {
      bad(`${version}: pub_date must be an RFC 3339 date and time`);
      continue;
    }
    const notes = Array.isArray(e.notes) ? e.notes.map((n) => text(n, MAX_NOTE_LENGTH)) : null;
    if (!notes || notes.length < 1 || notes.length > MAX_NOTES || notes.some((n) => n === null)) {
      bad(`${version}: notes must be 1 to ${MAX_NOTES} short lines of plain text`);
      continue;
    }
    let notesUrl: string | null = null;
    if (e.notes_url !== undefined && e.notes_url !== null) {
      notesUrl = text(e.notes_url, 300);
      if (!notesUrl || !/^https:\/\/[^\s]+$/.test(notesUrl)) {
        bad(`${version}: notes_url must be an https address`);
        continue;
      }
      if (!isCompanyUrl(notesUrl)) {
        // Kept out of the answer rather than dropping the release: the app would refuse the whole update because of this link.
        problems.push(`${label}: ${version}: notes_url ignored (the app only opens addresses on ${COMPANY_HOST})`);
        notesUrl = null;
      }
    }
    let minSupported: string | null = null;
    if (e.min_supported !== undefined && e.min_supported !== null) {
      if (!parseVersion(e.min_supported)) {
        bad(`${version}: min_supported is not a semantic version`);
        continue;
      }
      minSupported = e.min_supported as string;
    }
    const rollout = e.rollout_percent === undefined ? 100 : e.rollout_percent;
    if (typeof rollout !== 'number' || !Number.isInteger(rollout) || rollout < 0 || rollout > 100) {
      bad(`${version}: rollout_percent must be a whole number from 0 to 100`);
      continue;
    }
    if ((e.mandatory !== undefined && typeof e.mandatory !== 'boolean') || (e.enabled !== undefined && typeof e.enabled !== 'boolean')) {
      bad(`${version}: mandatory and enabled must be true or false`);
      continue;
    }
    const signature = b64urlDecode(e.signature);
    const entry: Release = {
      version,
      channel,
      pub_date: pubDate,
      notes: notes as string[],
      notes_url: notesUrl,
      file,
      sha256,
      size,
      signature: e.signature as string,
      min_supported: minSupported,
      mandatory: e.mandatory === true,
      rollout_percent: rollout,
      enabled: e.enabled !== false,
    };
    const signed = signature ? utf8(releaseMessage(product, entry)) : null;
    let verified = false;
    if (signature && signed) {
      for (const key of publicKeys) {
        if (await ed25519Verify(key, signature, signed)) {
          verified = true;
          break;
        }
      }
    }
    if (!verified) {
      bad(`${version}: the signature does not verify against ${publicKeys.length === 1 ? 'the release key' : 'any trusted release key'}`);
      continue;
    }
    seen.add(version);
    releases.push(entry);
  }
  return { releases, problems };
}

export type Offer =
  | { update: false; latest: string | null }
  | { update: true; release: Release; mandatory: boolean; rollout_percent: number; latest: string };

/**
 * Which release to offer an app on `current`. A beta app is offered the newest of the stable and beta
 * releases; a stable app only stable ones. Withdrawn releases (enabled: false) are skipped, so the
 * previous one is offered. A release held at rollout 0 is still the newest: apps are told, and wait.
 */
export function selectUpdate(releases: Release[], current: string, channel: Channel): Offer {
  const eligible = releases.filter((r) => r.enabled && (channel === 'beta' || r.channel === 'stable'));
  let newest: Release | null = null;
  for (const r of eligible) if (!newest || compareVersions(r.version, newest.version) > 0) newest = r;
  if (!newest || compareVersions(newest.version, current) <= 0) return { update: false, latest: newest?.version ?? null };
  // A release held at rollout 0 (paused) stays held even when it would otherwise be forced: a pause must always work.
  // Otherwise a mandatory release, or one the app is below min_supported for, goes to everyone at once.
  const held = newest.rollout_percent === 0;
  const forced = !held && (newest.mandatory || (newest.min_supported !== null && compareVersions(current, newest.min_supported) < 0));
  return { update: true, release: newest, mandatory: forced, rollout_percent: forced ? 100 : newest.rollout_percent, latest: newest.version };
}
