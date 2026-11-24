// Generates test/telemetry-protocol-vectors.json (the app telemetry contract) and its SHA-256, for PinchPDF; or, with the
// argument `nodupe`, test/nodupe-telemetry-protocol-vectors.json for NoDupe (the same contract with the nodupe- prefixes).
//
// Like generate-trial-vectors.mjs this uses ONLY node:crypto and is written independently of lib/,
// so the server tests check the implementation against a second one, and the app team can run
// the same vectors against theirs. It pins the three things that silently break a client:
//   1. the license hash:   SHA-256("<product>-telemetry-license-v1|" || normalized key)
//   2. the signed message: <product>-telemetry-v1|event_id|customer_uuid|type|occurred_at|plan|license|prev_license
//      (install and uninstall, from the installer, add one field: |install_kind, empty for uninstall)
//   3. the server fingerprint of a license: base64url(HMAC-SHA256(PEPPER, "license|" || license hash bytes))
// Run:  node scripts/generate-telemetry-vectors.mjs [nodupe]
// The output is deterministic: running it twice yields byte-identical files.

import { createHash, createHmac, createPrivateKey, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const P = process.argv[2] === 'nodupe' ? 'nodupe' : 'pinchpdf'; // product prefix
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const sha256 = (data) => createHash('sha256').update(data).digest();
const fixed = (label, length) => sha256(Buffer.from(`${P}-telemetry-vector|${label}`)).subarray(0, length);

// The same test-only pepper the Vitest config uses (public, never a real secret).
const TEST_PEPPER = 'cGVwcGVyLXRlc3Qta2V5LTAxMjM0NTY3ODkwMTIzNDU';

const seed = fixed('install-seed', 32);
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
const publicRaw = Buffer.from(privateKey.export({ format: 'jwk' }).x, 'base64url') ?? null;
const otherSeed = fixed('other-install-seed', 32);
const otherKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), otherSeed]), format: 'der', type: 'pkcs8' });

const licenseHash = (normalizedKey) => sha256(Buffer.from(`${P}-telemetry-license-v1|${normalizedKey}`));
const serverFingerprint = (hashBytes) => b64u(createHmac('sha256', Buffer.from(TEST_PEPPER, 'base64url')).update(Buffer.concat([Buffer.from('license|'), hashBytes])).digest());
const signMessage = (key, message) => b64u(sign(null, Buffer.from(message), key));

const KEYS = {
  new: `${P === 'nodupe' ? 'NODUPE' : 'PINCH'}-AAAA-BBBB-CCCC-0001`,
  old: `${P === 'nodupe' ? 'NODUPE' : 'PINCH'}-AAAA-BBBB-CCCC-0000`,
};
const customer = '3f2b8c1e-5a47-4d0e-9b6a-7c1d2e3f4a5b';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = 1_800_000_000;

// "message" is built exactly as the protocol states; optional fields not sent are empty strings.
function event(name, n, type, extra = {}) {
  const f = { event_id: uuid(n), customer_uuid: customer, type, occurred_at: T + n, ...extra };
  // buy_clicked, install and uninstall are anonymous: plan, license and prev_license are empty. install and uninstall carry
  // one more field, install_kind (new | upgrade | reinstall for an install, empty for an uninstall).
  const installer = type === 'install' || type === 'uninstall';
  const anonymous = type === 'buy_clicked' || installer;
  const message = [
    `${P}-telemetry-v1`,
    f.event_id,
    f.customer_uuid,
    f.type,
    f.occurred_at,
    anonymous ? '' : (f.plan ?? ''),
    anonymous ? '' : (f.license ?? ''),
    type === 'license_key_changed' ? (f.prev_license ?? '') : '',
    ...(installer ? [f.install_kind ?? ''] : []),
  ].join('|');
  return { name, fields: f, message, sig: signMessage(privateKey, message) };
}

const hashB64 = (key) => b64u(licenseHash(key));
const events = [
  event('buy click', 1, 'buy_clicked'),
  event('activation, individual', 2, 'license_activated', { plan: 'individual', license: hashB64(KEYS.old) }),
  event('deactivation', 3, 'license_deactivated', { plan: 'individual', license: hashB64(KEYS.old) }),
  event('activation, business', 4, 'license_activated', { plan: 'business', license: hashB64(KEYS.new) }),
  event('key change', 5, 'license_key_changed', { plan: 'business', license: hashB64(KEYS.new), prev_license: hashB64(KEYS.old) }),
  event('install, new', 8, 'install', { install_kind: 'new' }),
  event('install, upgrade', 9, 'install', { install_kind: 'upgrade' }),
  event('install, reinstall', 10, 'install', { install_kind: 'reinstall' }),
  event('uninstall', 11, 'uninstall'),
];

// Events that must be refused with a plain HTTP 400 (a real app never sends them).
const good = events[3];
const rejects = [
  {
    name: 'plan changed after signing',
    reason: 'the signature covers plan',
    fields: { ...good.fields, plan: 'individual' },
    sig: good.sig,
  },
  {
    name: 'license changed after signing',
    reason: 'the signature covers the license hash',
    fields: { ...good.fields, license: hashB64(KEYS.old) },
    sig: good.sig,
  },
  {
    name: 'signed by another install key',
    reason: 'the signature must verify under the pubkey that is sent',
    fields: good.fields,
    sig: signMessage(otherKey, good.message),
  },
  {
    name: 'key change to the same key',
    reason: 'license and prev_license must differ',
    ...(() => {
      const e = event('x', 6, 'license_key_changed', { plan: 'business', license: hashB64(KEYS.new), prev_license: hashB64(KEYS.new) });
      return { fields: e.fields, sig: e.sig };
    })(),
  },
  {
    name: 'activation without a plan',
    reason: 'plan is required for license_activated',
    ...(() => {
      const e = event('x', 7, 'license_activated', { license: hashB64(KEYS.new) });
      return { fields: e.fields, sig: e.sig };
    })(),
  },
  {
    name: 'install without an install kind',
    reason: 'install_kind is required for install',
    ...(() => {
      const e = event('x', 12, 'install');
      return { fields: e.fields, sig: e.sig };
    })(),
  },
  {
    name: 'install kind changed after signing',
    reason: 'the signature covers install_kind',
    fields: { ...events[5].fields, install_kind: 'upgrade' },
    sig: events[5].sig,
  },
  {
    name: 'uninstall with an install kind',
    reason: 'install_kind belongs to install events only',
    ...(() => {
      const e = event('x', 13, 'uninstall', { install_kind: 'new' });
      return { fields: e.fields, sig: e.sig };
    })(),
  },
];

const vectors = {
  protocol: 1,
  ...(P === 'nodupe' ? { product: 'nodupe' } : {}),
  note: 'Generated by scripts/generate-telemetry-vectors.mjs. Copy byte-identically into the app repository and record the SHA-256 in the protocol header.',
  install: { seed: b64u(seed), public_key: b64u(publicRaw) },
  customer_uuid: customer,
  license_hashes: Object.entries(KEYS).map(([name, key]) => ({ name, normalized_key: key, hash: hashB64(key), server_fingerprint_with_test_pepper: serverFingerprint(licenseHash(key)) })),
  test_pepper: TEST_PEPPER,
  events,
  rejects,
};

const json = `${JSON.stringify(vectors, null, 2)}\n`;
const base = P === 'nodupe' ? 'nodupe-telemetry-protocol-vectors' : 'telemetry-protocol-vectors';
writeFileSync(new URL(`../test/${base}.json`, import.meta.url), json);
writeFileSync(new URL(`../test/${base}.sha256`, import.meta.url), `${createHash('sha256').update(json).digest('hex')}\n`);
console.log(`${base} written`);
