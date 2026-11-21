// Release signing and index building for app releases (docs/RELEASES.md, section B). Pure functions with no
// file or network access, so the tests and the vector generator can use them; scripts/release-prepare.mjs is
// the command line around them.
//
// Signed message (UTF-8), signed with the offline Ed25519 release key:
//   pinchpdf-release-v1|<Product>|<channel>|<version>|<sha256>|<size>

import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto';

export const PRODUCTS = ['PinchPDF', 'NoDupe'];
export const CHANNELS = ['stable', 'beta'];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export const b64u = (bytes) => Buffer.from(bytes).toString('base64url');

export function generateKeypair() {
  const seed = randomBytes(32);
  return { seed: b64u(seed), publicKey: publicKeyFromSeed(b64u(seed)) };
}

function privateKey(seedB64u) {
  const seed = Buffer.from(String(seedB64u ?? '').trim(), 'base64url');
  if (seed.length !== 32) throw new Error('The signing key must be a 32-byte seed in base64url');
  return createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export function publicKeyFromSeed(seedB64u) {
  const der = createPublicKey(privateKey(seedB64u)).export({ format: 'der', type: 'spki' });
  return b64u(der.subarray(der.length - 32)); // the raw 32 bytes at the end of the SPKI structure
}

export function releaseMessage(product, { channel, version, sha256, size }) {
  return `pinchpdf-release-v1|${product}|${channel}|${version}|${sha256}|${size}`;
}

export function signRelease(seedB64u, message) {
  return b64u(sign(null, Buffer.from(message, 'utf8'), privateKey(seedB64u)));
}

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** One signed release entry. `bytes` is the installer; only its hash and size are kept. */
export function buildEntry({ product, channel, version, fileName, bytes, notes, notesUrl = null, minSupported = null, mandatory = false, rollout = 100, enabled = true, pubDate, seed }) {
  if (!PRODUCTS.includes(product)) throw new Error(`product must be one of ${PRODUCTS.join(', ')} (exact spelling)`);
  if (!CHANNELS.includes(channel)) throw new Error('channel must be stable or beta');
  const parsed = SEMVER.exec(version ?? '');
  if (!parsed) throw new Error('version must be a semantic version such as 1.3.0 or 1.4.0-beta.1');
  if (channel === 'stable' && parsed[4]) throw new Error('a stable release cannot have a pre-release version; use the beta channel');
  if (!FILE_NAME.test(fileName ?? '')) throw new Error('the installer file name may use only letters, digits, dot, dash and underscore');
  if (!Array.isArray(notes) || notes.length < 1 || notes.length > 10 || notes.some((n) => typeof n !== 'string' || n.length < 1 || n.length > 200 || CONTROL.test(n))) {
    throw new Error('notes must be 1 to 10 short lines of plain text (200 characters each)');
  }
  if (notesUrl !== null && !/^https:\/\/[^\s]+$/.test(notesUrl)) throw new Error('notes_url must be an https address');
  if (minSupported !== null && !SEMVER.test(minSupported)) throw new Error('min_supported must be a semantic version');
  if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) throw new Error('rollout must be a whole number from 0 to 100');
  if (!bytes || bytes.length === 0) throw new Error('the installer is empty');
  const date = pubDate ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (Number.isNaN(Date.parse(date))) throw new Error('pub_date is not a valid date');

  const entry = {
    version,
    channel,
    pub_date: date,
    notes,
    notes_url: notesUrl,
    file: `${product}/${channel}/${version}/${fileName}`,
    sha256: sha256Hex(bytes),
    size: bytes.length,
    signature: '',
    min_supported: minSupported,
    mandatory,
    rollout_percent: rollout,
    enabled,
  };
  entry.signature = signRelease(seed, releaseMessage(product, entry));
  return entry;
}

/** Adds an entry to an index object (or starts one). A version is never replaced: a fix is a new version. */
export function mergeIndex(index, product, entry) {
  const base = index ?? { product, releases: [] };
  if (base.product !== undefined && base.product !== product) throw new Error(`that index is for ${base.product}, not ${product}`);
  if (!Array.isArray(base.releases)) throw new Error('the index has no releases list');
  if (base.releases.some((r) => r.version === entry.version && r.channel === entry.channel)) {
    throw new Error(`${entry.version} is already in the ${entry.channel} list; a released version is never replaced. Publish a new version.`);
  }
  return { product, releases: [...base.releases, entry] };
}
