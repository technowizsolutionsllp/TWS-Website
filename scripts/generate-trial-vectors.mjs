// Generates test/trial-protocol-vectors.json (protocol section 9) and its SHA-256.
//
// This script uses ONLY node:crypto and is written independently of lib/trial,
// so the library tests check the implementation against a second one.
// Run:  node scripts/generate-trial-vectors.mjs
// The output is deterministic: running it twice yields byte-identical files.

import { createHash, webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const { subtle } = webcrypto;
const enc = new TextEncoder();
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const sha256 = (data) => createHash('sha256').update(data).digest();
const cat = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
const fixed = (label, length) => sha256(enc.encode(`pinchpdf-trial-vector|${label}`)).subarray(0, length);

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
  'o.e.m', 'o.e.m.', 'to be filled by o.e.m.', 'default string', 'none', 'not specified', 'not applicable',
  'system serial number', 'base board serial number', 'to be filled', '123456789', '0000000', '00000000', 'n/a',
  '00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
];
const clientHash = (name, value) => sha256(enc.encode(`pinchpdf-trial-signal-v1|${name}|${value}`));

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
const kReq = await hkdf(sharedBits, reqNonce, 'pinchpdf-trial-v1 req');
const kResp = await hkdf(sharedBits, reqNonce, 'pinchpdf-trial-v1 resp');
const KID = 'k1';
const requestPlaintext = JSON.stringify({ proto: 1, hello: 'envelope vector' });
const requestAad = `POST /api/pinchpdf/trial/v1/usage|${KID}`;
const requestCt = await aesSeal(kReq, reqNonce, requestAad, enc.encode(requestPlaintext));
const responsePlaintext = JSON.stringify({ result: 'unknown_trial' });
const responseAad = `${b64u(reqNonce)}|usage`;
const responseCt = await aesSeal(kResp, respNonce, responseAad, enc.encode(responsePlaintext));
const flip = (bytes) => { const c = Buffer.from(bytes); c[c.length - 1] ^= 1; return c; };
const requestEnvelope = { v: 1, kid: KID, epk: b64u(eph.publicRaw), n: b64u(reqNonce), ct: b64u(requestCt) };
const wrongAadCt = await aesSeal(kReq, reqNonce, `POST /api/pinchpdf/trial/v1/register|${KID}`, enc.encode(requestPlaintext));
const wrongKidCt = await aesSeal(kReq, reqNonce, `POST /api/pinchpdf/trial/v1/usage|k0`, enc.encode(requestPlaintext));

// ------------------------------------------------------------------ record MAC (section 8.1; consumed by the app)
const recordIkm = fixed('record-ikm', 32);
const zeroSalt = new Uint8Array(32);
const macKey = await hkdf(recordIkm, zeroSalt, 'pinchpdf-trial-v1 record-mac');
const signSeed = await hkdf(recordIkm, zeroSalt, 'pinchpdf-trial-v1 sign-seed');
const signPair = await keyPair('Ed25519', signSeed);

function serializeRecord(r) {
  const parts = [enc.encode('pinchpdf-trial-v1 record'), u32le(r.seq), lenBytes(r.machine_guid)];
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
const usageMessages = [3, 0, 6].map((used) => `pinchpdf-trial-usage-v1|${usageTrialId}|${used}`);
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
  cat(enc.encode('pinchpdf-trial-challenge-v1'), u64be(challengeTs), challengeRand, Buffer.from([difficulty]), sha256(signPair.publicRaw)),
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
for (const [S, T, used] of [[0, 5, 1], [4, 5, 5], [4, 5, 6], [4, 5, 100], [5, 5, 2], [3, 5, 3], [3, 5, 1], [0, 5, 0]]) {
  const next = Math.max(S, Math.min(used, T));
  counters.push({ S, T, used, S_new: next, state: next >= T ? 'exhausted' : 'active' });
}

const vectors = {
  protocol: 1,
  note: 'Generated by scripts/generate-trial-vectors.mjs. Do not edit by hand. Binary values are base64url without padding.',
  placeholders: { version: '1', values: PLACEHOLDERS, hashes: placeholderHashes },
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
  },
  record: { ikm: b64u(recordIkm), mac_key: b64u(macKey), sign_seed: b64u(signSeed), sign_public: b64u(signPair.publicRaw), cases: records },
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
};

const json = `${JSON.stringify(vectors, null, 2)}\n`;
writeFileSync(new URL('../test/trial-protocol-vectors.json', import.meta.url), json);
const digest = createHash('sha256').update(json).digest('hex');
writeFileSync(new URL('../test/trial-protocol-vectors.sha256', import.meta.url), `${digest}\n`);
console.log(`wrote test/trial-protocol-vectors.json (${json.length} bytes)\nsha256 ${digest}`);
