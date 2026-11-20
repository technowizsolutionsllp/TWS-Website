// End-to-end smoke test of the trial service over HTTP, as the PinchPDF app would use it.
//
//   node scripts/trial-smoke.mjs [baseUrl]            (default http://localhost:3000)
//
// Reads TRIAL_KEY_k1 from .dev.vars to derive the server public key (local dev only).
// For staging, set TRIAL_SERVER_PUBLIC (b64url X25519 public key) and TRIAL_KID instead.
// Registers a throwaway "device" with random signals, so it never collides with a real one.

import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { subtle } = webcrypto;
const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const root = `${base}/api/pinchpdf/trial/v1`;
const kid = process.env.TRIAL_KID ?? 'k1';
const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const sha256 = (d) => createHash('sha256').update(d).digest();

async function serverPublic() {
  if (process.env.TRIAL_SERVER_PUBLIC) return unb64u(process.env.TRIAL_SERVER_PUBLIC);
  const vars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  const secret = vars.match(new RegExp(`^TRIAL_KEY_${kid}=(.+)$`, 'm'))?.[1]?.trim();
  if (!secret) throw new Error(`TRIAL_KEY_${kid} not found in .dev.vars`);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), unb64u(secret)]);
  const key = await subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
  return unb64u((await subtle.exportKey('jwk', key)).x);
}

async function hkdf(ikm, salt, info) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, k, 256));
}

async function sealed(endpoint, body, serverKey) {
  const eph = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const srv = await subtle.importKey('raw', serverKey, { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: srv }, eph.privateKey, 256));
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const kReq = await hkdf(shared, nonce, 'pinchpdf-trial-v1 req');
  const kResp = await hkdf(shared, nonce, 'pinchpdf-trial-v1 resp');
  const aesReq = await subtle.importKey('raw', kReq, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(`POST /api/pinchpdf/trial/v1/${endpoint}|${kid}`) }, aesReq, enc.encode(JSON.stringify(body))));
  const res = await fetch(`${root}/${endpoint}`, { method: 'POST', body: JSON.stringify({ v: 1, kid, epk: b64u(epk), n: b64u(nonce), ct: b64u(ct) }) });
  const json = await res.json();
  if (res.status !== 200 || !json.ct) return { status: res.status, plain: json };
  const aesResp = await subtle.importKey('raw', kResp, 'AES-GCM', false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(json.n), additionalData: enc.encode(`${b64u(nonce)}|${endpoint}`) }, aesResp, unb64u(json.ct));
  return { status: 200, result: JSON.parse(new TextDecoder().decode(pt)) };
}

const signalHash = (name, value) => b64u(sha256(enc.encode(`pinchpdf-trial-signal-v1|${name}|${value}`)));

const keys = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pubkey = b64u(new Uint8Array(await subtle.exportKey('raw', keys.publicKey)));
const serverKey = await serverPublic();

const chRes = await fetch(`${root}/challenge`, { method: 'POST', body: JSON.stringify({ proto: 1, pubkey }) });
const ch = await chRes.json();
const challenge = unb64u(ch.challenge);
const difficulty = challenge[24];
const started = Date.now();
let solution;
for (let i = 0n; ; i += 1n) {
  const sol = Buffer.alloc(8);
  sol.writeBigUInt64BE(i);
  const digest = sha256(Buffer.concat([challenge, sol]));
  let bits = 0;
  for (const byte of digest) { if (byte === 0) { bits += 8; continue; } bits += Math.clz32(byte) - 24; break; }
  if (bits >= difficulty) { solution = sol; break; }
}
console.log(`challenge: ${challenge.length} bytes, difficulty ${difficulty}, solved in ${Date.now() - started} ms`);

const tag = randomBytes(6).toString('hex');
const registerBody = {
  proto: 1, challenge: ch.challenge, solution: b64u(solution), pubkey,
  name: 'Smoke Test', email: `smoke-${tag}@example.com`,
  consent: { terms_version: process.env.TRIAL_TERMS_VERSION ?? '2026-11-20', privacy_version: process.env.TRIAL_PRIVACY_VERSION ?? '2026-11-20', accepted_at: Math.floor(Date.now() / 1000) },
  signals: { guid: signalHash('guid', `smoke-guid-${tag}`), smbios: signalHash('smbios', `smoke-smbios-${tag}`), board: signalHash('board', `smoke-board-${tag}`) },
  app_version: 'smoke', os_build: 'smoke',
};
const reg = await sealed('register', registerBody, serverKey);
console.log('register:', JSON.stringify(reg));
if (reg.result?.result !== 'registered') process.exit(1);

const replay = await sealed('register', registerBody, serverKey);
console.log('replay  :', replay.result?.trial_id === reg.result.trial_id ? 'same trial (idempotent)' : `UNEXPECTED ${JSON.stringify(replay)}`);

for (const used of [1, 3, 2, 9]) {
  const message = `pinchpdf-trial-usage-v1|${reg.result.trial_id}|${used}`;
  const sig = b64u(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, keys.privateKey, enc.encode(message))));
  const usage = await sealed('usage', { proto: 1, trial_id: reg.result.trial_id, used, sig, app_version: 'smoke' }, serverKey);
  console.log(`usage ${used}:`, JSON.stringify(usage.result ?? usage));
}
