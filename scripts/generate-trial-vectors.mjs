// Generates test/trial-protocol-vectors.json (protocol section 9, revision 5) and its SHA-256, for PinchPDF; or, with the
// argument `nodupe`, test/nodupe-trial-protocol-vectors.json for NoDupe (the same protocol with the nodupe- prefixes,
// per-mode usage reports and NoDupe's own placeholder list). The PinchPDF output does not depend on this argument.
//
// This script uses ONLY node:crypto and is written independently of lib/trial,
// so the library tests check the implementation against a second one.
// Run:  node scripts/generate-trial-vectors.mjs [nodupe]
// The output is deterministic: running it twice yields byte-identical files.

import { createHash, webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const { subtle } = webcrypto;
const P = process.argv[2] === 'nodupe' ? 'nodupe' : 'pinchpdf'; // product prefix
const NODUPE = P === 'nodupe';
const enc = new TextEncoder();
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const sha256 = (data) => createHash('sha256').update(data).digest();
const cat = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
const fixed = (label, length) => sha256(enc.encode(`${P}-trial-vector|${label}`)).subarray(0, length);

async function hmac(keyBytes, data) {
  const key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', key, data));
}

async function hkdf(ikm, salt, info, length = 32) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, key, length * 8));
}

const PKCS8 = { Ed25519: '302e020100300506032b657004220420', X25519: '302e020100300506032b656e04220420' };

async function keyPair(alg, seed) {
  const priv = await subtle.importKey('pkcs8', Buffer.from(PKCS8[alg] + hex(seed), 'hex'), { name: alg }, true, alg === 'Ed25519' ? ['sign'] : ['deriveBits']);
  const jwk = await subtle.exportKey('jwk', priv);
  return { priv, publicRaw: Buffer.from(jwk.x, 'base64url') };
}

async function aesSeal(key, nonce, aad, plaintext) {
  const k = await subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(aad), tagLength: 128 }, k, plaintext));
}

const leadingZeroBits = (bytes) => {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) { bits += 8; continue; }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
};

const u64be = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const lenBytes = (s) => cat(u32le(Buffer.byteLength(s)), enc.encode(s));

// ------------------------------------------------------------------ placeholders
const PLACEHOLDERS = [
  'o.e.m',
  'o.e.m.',
  'to be filled by o.e.m.',
  'to be filled by o.e.m',
  'to be filled',
  'default string',
  'default',
  'none',
  'null',
  'empty',
  'unknown',
  'not specified',
  'not applicable',
  'not available',
  'n/a',
  'x.x',
  'system serial number',
  'base board serial number',
  'chassis serial number',
  'serial number',
  'system product name',
  '0',
  '1',
  '0000000',
  '00000000',
  '12345678',
  '123456789',
  '0123456789',
  '1234567890',
  'sn12345678',
  'sn1234567890',
  'xxxxxxxx',
  'xxxxxxxxxxxx',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '11111111-1111-1111-1111-111111111111',
  '03000200-0400-0500-0006-000700080009',
  '00020003-0004-0005-0006-000700080009',
  '12345678-1234-1234-1234-123456789012',
];
if (NODUPE) PLACEHOLDERS.push('duplicate-cleaner-fallback-machine-id');
const clientHash = (name, value) => sha256(enc.encode(`${P}-trial-signal-v1|${name}|${value}`));

// ------------------------------------------------------------------ signals
const pepper = fixed('pepper', 32);
const signalCases = [];
for (const [name, value] of [
  ['guid', '0a1b2c3d-1111-2222-3333-444455556666'],
  ['smbios', '4c4c4544-0042-3510-8051-b8c04f4d3332'],
  ['board', 'ab12cd34ef'],
  ['guid', 'ab12cd34ef'], // identical value, different column: must differ
]) {
  const ch = clientHash(name, value);
  const server = await hmac(pepper, cat(enc.encode(`${name}|`), ch));
  signalCases.push({ name, normalized: value, client_hash: b64u(ch), server_hmac: b64u(server) });
}
const placeholderHashes = PLACEHOLDERS.map((value) => ({
  value,
  hashes: { guid: b64u(clientHash('guid', value)), smbios: b64u(clientHash('smbios', value)), board: b64u(clientHash('board', value)) },
}));

// ------------------------------------------------------------------ matching (section 2)
const NAMES = ['guid', 'smbios', 'board'];
function referenceBlocks(request, row) {
  const both = NAMES.filter((n) => request[n] !== null && row[n] !== null);
  const equal = both.filter((n) => request[n] === row[n]);
  if (both.length === 0) return false;
  return equal.length >= Math.min(2, both.length);
}
const matching = [];
for (let reqMask = 0; reqMask < 8; reqMask += 1) {
  for (let rowMask = 0; rowMask < 8; rowMask += 1) {
    for (let eqMask = 0; eqMask < 8; eqMask += 1) {
      const request = {}; const row = {};
      NAMES.forEach((n, i) => {
        request[n] = reqMask & (1 << i) ? `req-${n}` : null;
        row[n] = rowMask & (1 << i) ? (eqMask & (1 << i) ? `req-${n}` : `row-${n}`) : null;
      });
      matching.push({ request, row, blocks: referenceBlocks(request, row) });
    }
  }
}
// Named cases written by hand from the table in section 2 (not computed).
const s = (g, sm, b) => ({ guid: g, smbios: sm, board: b });
const matchingNamed = [
  { name: 'one usable signal equal blocks', request: s('x', null, null), row: s('x', 'a', 'b'), blocks: true },
  { name: 'one usable signal different does not block', request: s('x', null, null), row: s('y', 'a', 'b'), blocks: false },
  { name: 'three usable, only guid equal: no block', request: s('x', 'a', 'b'), row: s('x', 'q', 'r'), blocks: false },
  { name: 'three usable, two equal: block', request: s('x', 'a', 'b'), row: s('y', 'a', 'b'), blocks: true },
  { name: 'windows reinstall (guid changed, smbios and board equal): block', request: s('new', 'a', 'b'), row: s('old', 'a', 'b'), blocks: true },
  { name: 'row with two usable needs both', request: s('x', 'a', 'b'), row: s('x', null, 'z'), blocks: false },
  { name: 'row with one usable needs that one', request: s('x', 'a', 'b'), row: s(null, 'a', null), blocks: true },
  { name: 'types never cross', request: s('v', null, null), row: s(null, 'v', null), blocks: false },
  { name: 'no overlap in usable types', request: s('x', null, null), row: s(null, 'a', 'b'), blocks: false },
];

// ------------------------------------------------------------------ envelope
const server = await keyPair('X25519', fixed('server-x25519', 32));
const eph = await keyPair('X25519', fixed('client-ephemeral', 32));
const sharedBits = new Uint8Array(
  await subtle.deriveBits({ name: 'X25519', public: await subtle.importKey('raw', server.publicRaw, { name: 'X25519' }, false, []) }, eph.priv, 256),
);
const reqNonce = fixed('request-nonce', 12);
const respNonce = fixed('response-nonce', 12);
const kReq = await hkdf(sharedBits, reqNonce, `${P}-trial-v1 req`);
const kResp = await hkdf(sharedBits, reqNonce, `${P}-trial-v1 resp`);
const KID = 'k1';
const requestPlaintext = JSON.stringify({ proto: 1, hello: 'envelope vector' });
const requestAad = `POST /api/${P}/trial/v1/usage|${KID}`;
const requestCt = await aesSeal(kReq, reqNonce, requestAad, enc.encode(requestPlaintext));
const responsePlaintext = JSON.stringify({ result: 'unknown_trial' });
const responseAad = `${b64u(reqNonce)}|usage`;
const responseCt = await aesSeal(kResp, respNonce, responseAad, enc.encode(responsePlaintext));
const flip = (bytes) => { const c = Buffer.from(bytes); c[c.length - 1] ^= 1; return c; };
const requestEnvelope = { v: 1, kid: KID, epk: b64u(eph.publicRaw), n: b64u(reqNonce), ct: b64u(requestCt) };
const wrongAadCt = await aesSeal(kReq, reqNonce, `POST /api/${P}/trial/v1/register|${KID}`, enc.encode(requestPlaintext));
const wrongKidCt = await aesSeal(kReq, reqNonce, `POST /api/${P}/trial/v1/usage|k0`, enc.encode(requestPlaintext));

// Revision 5: a sealed /lookup, the same envelope with its own AAD, and a `found` answer.
const lookupNonce = fixed('lookup-request-nonce', 12);
const lookupRespNonce = fixed('lookup-response-nonce', 12);
const lookupKReq = await hkdf(sharedBits, lookupNonce, `${P}-trial-v1 req`);
const lookupKResp = await hkdf(sharedBits, lookupNonce, `${P}-trial-v1 resp`);
const lookupPlaintext = JSON.stringify({
  proto: 1,
  signals: { guid: signalCases[0].client_hash, smbios: signalCases[1].client_hash, board: null },
});
const lookupAad = `POST /api/${P}/trial/v1/lookup|${KID}`;
const lookupCt = await aesSeal(lookupKReq, lookupNonce, lookupAad, enc.encode(lookupPlaintext));
const lookupAnswer = JSON.stringify({
  result: 'found',
  state: 'active',
  used: NODUPE ? { basic: 2, similar: 1, deep: 0 } : 3,
  limit: NODUPE ? { basic: 5, similar: 3, deep: 1 } : 5,
  registered_at: 1767225700,
  email_hint: 'j\u2022\u2022\u2022@example.com',
  support_ref: 'K7QF2M9X',
});
const lookupResponseAad = `${b64u(lookupNonce)}|lookup`;
const lookupRespCt = await aesSeal(lookupKResp, lookupRespNonce, lookupResponseAad, enc.encode(lookupAnswer));

// ------------------------------------------------------------------ record MAC (section 8.1; consumed by the app)
const recordIkm = fixed('record-ikm', 32);
const zeroSalt = new Uint8Array(32);
const macKey = await hkdf(recordIkm, zeroSalt, `${P}-trial-v1 record-mac`);
const signSeed = await hkdf(recordIkm, zeroSalt, `${P}-trial-v1 sign-seed`);
const signPair = await keyPair('Ed25519', signSeed);

function serializeRecord(r) {
  const parts = [enc.encode(`${P}-trial-v1 record`), u32le(r.seq), lenBytes(r.machine_guid)];
  if (r.pending) parts.push(Buffer.from([1]), Buffer.from(r.pending.pubkey, 'base64url'), u64le(r.pending.started_at));
  else parts.push(Buffer.from([0]));
  if (r.trial) {
    const t = r.trial;
    parts.push(Buffer.from([1]), lenBytes(t.trial_id), Buffer.from([t.limit, t.used, t.cloud_used]), u64le(t.registered_at), lenBytes(t.support_ref));
  } else parts.push(Buffer.from([0]));
  return cat(...parts);
}
const records = [];
for (const record of [
  { seq: 7, machine_guid: 'machine-guid-test', pending: null, trial: { trial_id: 'TRIALID123', limit: 5, used: 2, cloud_used: 1, registered_at: 1767225700, support_ref: 'K7QF2M9X' } },
  { seq: 8, machine_guid: 'machine-guid-test', pending: { pubkey: b64u(signPair.publicRaw), started_at: 1767225600 }, trial: null },
]) {
  const bytes = serializeRecord(record);
  records.push({ record, serialization_hex: hex(bytes), mac: b64u(await hmac(macKey, bytes)) });
}

// ------------------------------------------------------------------ usage signature
const usageTrialId = 'TRIALID123';
// PinchPDF signs one count; NoDupe signs the three counts: <prefix>-trial-usage-v1|<trial_id>|<basic>|<similar>|<deep>
const usageMessages = NODUPE
  ? [[3, 0, 1], [0, 0, 0], [5, 3, 1]].map(([b, sm, d]) => `${P}-trial-usage-v1|${usageTrialId}|${b}|${sm}|${d}`)
  : [3, 0, 6].map((used) => `${P}-trial-usage-v1|${usageTrialId}|${used}`);
const usageSignatures = [];
for (const message of usageMessages) {
  usageSignatures.push({ message, signature: b64u(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, signPair.priv, enc.encode(message)))) });
}

// ------------------------------------------------------------------ challenge + proof of work
const challengeKey = fixed('challenge-key', 32);
const challengeTs = 1767225600;
const challengeRand = fixed('challenge-rand', 16);
const difficulty = 8;
const challengeMac = await hmac(
  challengeKey,
  cat(enc.encode(`${P}-trial-challenge-v1`), u64be(challengeTs), challengeRand, Buffer.from([difficulty]), sha256(signPair.publicRaw)),
);
const challenge = cat(u64be(challengeTs), challengeRand, Buffer.from([difficulty]), challengeMac);
let solution;
for (let counter = 0; ; counter += 1) {
  const candidate = u64be(counter);
  if (leadingZeroBits(sha256(cat(challenge, candidate))) >= difficulty) { solution = candidate; break; }
}
const boundaries = [
  { name: 'age 599 s', now: challengeTs + 599, expect: 'ok' },
  { name: 'age 600 s', now: challengeTs + 600, expect: 'ok' },
  { name: 'age 601 s', now: challengeTs + 601, expect: 'expired' },
  { name: 'issued 30 s in the future', now: challengeTs - 30, expect: 'ok' },
  { name: 'issued 31 s in the future', now: challengeTs - 31, expect: 'malformed' },
];

// ------------------------------------------------------------------ counters (section 3.2, 6.2)
const counters = [];
if (NODUPE) {
  // one counter per mode, limits 5 / 3 / 1; exhausted only when every mode is at its limit
  const T = { basic: 5, similar: 3, deep: 1 };
  for (const [S, used] of [
    [{ basic: 0, similar: 0, deep: 0 }, { basic: 1, similar: 0, deep: 0 }],
    [{ basic: 2, similar: 1, deep: 0 }, { basic: 1, similar: 3, deep: 0 }],
    [{ basic: 4, similar: 3, deep: 0 }, { basic: 100, similar: 100, deep: 0 }],
    [{ basic: 5, similar: 3, deep: 0 }, { basic: 5, similar: 3, deep: 1 }],
    [{ basic: 5, similar: 3, deep: 1 }, { basic: 0, similar: 0, deep: 0 }],
  ]) {
    const S_new = Object.fromEntries(Object.keys(T).map((m) => [m, Math.max(S[m], Math.min(used[m], T[m]))]));
    counters.push({ S, T, used, S_new, state: Object.keys(T).every((m) => S_new[m] >= T[m]) ? 'exhausted' : 'active' });
  }
} else {
  for (const [S, T, used] of [[0, 5, 1], [4, 5, 5], [4, 5, 6], [4, 5, 100], [5, 5, 2], [3, 5, 3], [3, 5, 1], [0, 5, 0]]) {
    const next = Math.max(S, Math.min(used, T));
    counters.push({ S, T, used, S_new: next, state: next >= T ? 'exhausted' : 'active' });
  }
}

// ------------------------------------------------------------------ restore (revision 5)
// A computer that already holds a trial and registers again. Written here independently of lib/trial/restore.ts.
const BULLETS = '\u2022\u2022\u2022';
const firstCodePoint = (text) => String.fromCodePoint(text.codePointAt(0));
function referenceDecision(row, request) {
  if (row.status === 'revoked') return 'revoked';
  if (typeof request.resume === 'string' && request.resume === row.support_ref) return 'restore';
  return request.email_matches ? 'restore' : 'already_used';
}
const restoreDecisions = [];
for (const status of ['active', 'revoked']) {
  for (const resume of [null, 'K7QF2M9X', 'ZZ7QF2M9']) {
    for (const email_matches of [false, true]) {
      const row = { status, support_ref: 'K7QF2M9X' };
      const request = { resume, email_matches };
      restoreDecisions.push({ row, request, decision: referenceDecision(row, request) });
    }
  }
}
function referenceMaskEmail(email) {
  const at = email.lastIndexOf('@');
  return at < 1 ? BULLETS : firstCodePoint(email.slice(0, at)) + BULLETS + email.slice(at);
}
function referenceMaskName(name) {
  const words = name.split(/\s+/).filter((w) => w.length > 0).slice(0, 4);
  return words.length === 0 ? BULLETS : words.map((w) => firstCodePoint(w) + BULLETS).join(' ');
}
const emailMasks = ['jane.doe@example.com', 'a@b.co', 'Jane@Example.com', 'x@y@example.org', '\u{1F600}abc@example.com', 'Ünal@exämple.de', '@example.com', 'no-at-sign'].map(
  (email) => ({ email, hint: referenceMaskEmail(email) }),
);
const nameMasks = ['Jane Doe', 'Jane van Doe', '  Ana  ', 'A B C D E', 'Ölaf Øster', '\u674e \u5c0f\u9f99', 'Jean-Luc Picard', '   '].map((name) => ({ name, hint: referenceMaskName(name) }));
const restore = {
  note:
    'Revision 5. `decisions`: what /register does when the request matches a stored trial (revoked: refuse with the support reference only; restore: continue the trial; already_used: refuse with registered_at and name_hint). ' +
    'Masks keep the first Unicode code point (not grapheme) of the local part or of each word (at most four words), then U+2022 three times.',
  decisions: restoreDecisions,
  email_masks: emailMasks,
  name_masks: nameMasks,
};
if (NODUPE) {
  // A restore keeps the higher count per mode, never above the mode's limit (the usage rule).
  const T = { basic: 5, similar: 3, deep: 1 };
  restore.count_merges = [
    [{ basic: 2, similar: 1, deep: 0 }, { basic: 1, similar: 9, deep: 0 }],
    [{ basic: 0, similar: 0, deep: 0 }, { basic: 0, similar: 0, deep: 0 }],
    [{ basic: 5, similar: 3, deep: 1 }, { basic: 0, similar: 0, deep: 0 }],
    [{ basic: 3, similar: 0, deep: 0 }, { basic: 4, similar: 2, deep: 1 }],
  ].map(([stored, reported]) => ({
    stored,
    reported,
    limit: T,
    merged: Object.fromEntries(Object.keys(T).map((m) => [m, Math.max(stored[m], Math.min(reported[m], T[m]))])),
  }));
}

const vectors = {
  protocol: 1,
  revision: 5,
  ...(NODUPE ? { product: 'nodupe' } : {}),
  note: 'Generated by scripts/generate-trial-vectors.mjs. Do not edit by hand. Binary values are base64url without padding.',
  placeholders: { version: NODUPE ? 'nodupe-1' : '1', values: PLACEHOLDERS, hashes: placeholderHashes },
  signals: { pepper: b64u(pepper), cases: signalCases },
  matching: { named: matchingNamed, exhaustive: matching },
  envelope: {
    kid: KID,
    server_private: b64u(fixed('server-x25519', 32)),
    server_public: b64u(server.publicRaw),
    ephemeral_public: b64u(eph.publicRaw),
    shared_secret: b64u(sharedBits),
    request_nonce: b64u(reqNonce),
    k_req: b64u(kReq),
    k_resp: b64u(kResp),
    request_plaintext: requestPlaintext,
    request_aad: requestAad,
    request: requestEnvelope,
    response_nonce: b64u(respNonce),
    response_plaintext: responsePlaintext,
    response_aad: responseAad,
    response: { v: 1, n: b64u(respNonce), ct: b64u(responseCt) },
    reject: [
      { name: 'tampered tag', request: { ...requestEnvelope, ct: b64u(flip(requestCt)) } },
      { name: 'wrong AAD (other endpoint)', request: { ...requestEnvelope, ct: b64u(wrongAadCt) } },
      { name: 'wrong kid inside AAD', request: { ...requestEnvelope, ct: b64u(wrongKidCt) } },
    ],
    lookup: {
      request_nonce: b64u(lookupNonce),
      k_req: b64u(lookupKReq),
      k_resp: b64u(lookupKResp),
      request_plaintext: lookupPlaintext,
      request_aad: lookupAad,
      request: { v: 1, kid: KID, epk: b64u(eph.publicRaw), n: b64u(lookupNonce), ct: b64u(lookupCt) },
      response_nonce: b64u(lookupRespNonce),
      response_plaintext: lookupAnswer,
      response_aad: lookupResponseAad,
      response: { v: 1, n: b64u(lookupRespNonce), ct: b64u(lookupRespCt) },
    },
  },
  // The local trial record is the app's own (PinchPDF's V3); NoDupe's local record has its own format, so it has no record vectors.
  ...(NODUPE ? {} : { record: { ikm: b64u(recordIkm), mac_key: b64u(macKey), sign_seed: b64u(signSeed), sign_public: b64u(signPair.publicRaw), cases: records } }),
  usage_signature: { public: b64u(signPair.publicRaw), trial_id: usageTrialId, cases: usageSignatures },
  challenge: {
    key: b64u(challengeKey),
    pubkey: b64u(signPair.publicRaw),
    ts: challengeTs,
    rand: b64u(challengeRand),
    difficulty,
    challenge: b64u(challenge),
    solution: b64u(solution),
    boundaries,
  },
  counters,
  restore,
};

const json = `${JSON.stringify(vectors, null, 2)}\n`;
const base = NODUPE ? 'nodupe-trial-protocol-vectors' : 'trial-protocol-vectors';
writeFileSync(new URL(`../test/${base}.json`, import.meta.url), json);
const digest = createHash('sha256').update(json).digest('hex');
writeFileSync(new URL(`../test/${base}.sha256`, import.meta.url), `${digest}\n`);
console.log(`wrote test/${base}.json (${json.length} bytes)\nsha256 ${digest}`);
