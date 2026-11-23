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

/** The PinchPDF app only opens release notes on the company site, and refuses an update answer that names any other address. */
export function isCompanyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'technowizsolutions.com' || url.hostname.endsWith('.technowizsolutions.com'));
  } catch {
    return false;
  }
}

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

/** The GitHub release tag of a version, for example PinchPDF-v1.3.0. */
export const releaseTag = (product, version) => `${product}-v${version}`;

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
  if (notesUrl !== null && !isCompanyUrl(notesUrl)) throw new Error('notes_url must be an https address on technowizsolutions.com (the app only opens those, and refuses the whole update otherwise)');
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
    file: `${releaseTag(product, version)}/${fileName}`,
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
  if (base.releases.some((r) => r.version === entry.version)) {
    throw new Error(`${entry.version} is already in the list; a released version is never replaced. Publish a new version.`);
  }
  return { product, releases: [...base.releases, entry] };
}

// ---------------------------------------------------------------------------------------------------------------------
// A one-file ZIP, for people whose browser blocks a bare .exe download. "Stored" (no compression: an installer is already
// compressed) with a fixed date, so the same installer always gives the same zip bytes. Only the downloads page and the
// GitHub release use it; the apps update from the signed .exe, never from the zip.
// ---------------------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (the checksum a zip file stores). */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip file holding one file, stored without compression, dated 1980-01-01 so the result is reproducible. */
export function zipSingle(name, bytes) {
  if (bytes.length >= 0xffffffff) throw new Error('the installer is too large for a simple zip file');
  const nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length === 0 || nameBytes.length > 255) throw new Error('the file name for the zip is not usable');
  const crc = crc32(bytes);
  const local = 30 + nameBytes.length;
  const central = 46 + nameBytes.length;
  const out = new Uint8Array(local + bytes.length + central + 22);
  const view = new DataView(out.buffer);
  const DATE = 0x0021; // 1980-01-01
  // local file header
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true); // version needed
  view.setUint16(6, 0x0800, true); // the name is UTF-8
  view.setUint16(8, 0, true); // stored
  view.setUint16(10, 0, true); // time
  view.setUint16(12, DATE, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, bytes.length, true);
  view.setUint32(22, bytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  out.set(nameBytes, 30);
  out.set(bytes, local);
  // central directory
  const c0 = local + bytes.length;
  view.setUint32(c0, 0x02014b50, true);
  view.setUint16(c0 + 4, 20, true); // version made by
  view.setUint16(c0 + 6, 20, true);
  view.setUint16(c0 + 8, 0x0800, true);
  view.setUint16(c0 + 10, 0, true);
  view.setUint16(c0 + 12, 0, true);
  view.setUint16(c0 + 14, DATE, true);
  view.setUint32(c0 + 16, crc, true);
  view.setUint32(c0 + 20, bytes.length, true);
  view.setUint32(c0 + 24, bytes.length, true);
  view.setUint16(c0 + 28, nameBytes.length, true);
  view.setUint32(c0 + 38, 0x20, true); // archive attribute
  view.setUint32(c0 + 42, 0, true); // offset of the local header
  out.set(nameBytes, c0 + 46);
  // end of central directory
  const e0 = c0 + central;
  view.setUint32(e0, 0x06054b50, true);
  view.setUint16(e0 + 8, 1, true);
  view.setUint16(e0 + 10, 1, true);
  view.setUint32(e0 + 12, central, true);
  view.setUint32(e0 + 16, c0, true);
  return out;
}
