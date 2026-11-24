// Post-deploy smoke test of app telemetry and the Insights JSON API, over HTTP, as the app would use it.
//
//   node scripts/telemetry-smoke.mjs [baseUrl] [--product nodupe] [--yes-production]      (default http://localhost:3000, PinchPDF)
//
// Server key: from TRIAL_SERVER_PUBLIC (b64url X25519 public key) and TRIAL_KID, or derived from
// TRIAL_KEY_<kid> in .dev.vars (local dev only). Optional ADMIN_USER and ADMIN_PASSWORD (env) also
// check the Insights JSON API sees the events.
//
// It WRITES a few real telemetry rows (marked app_version "smoke-test"), so it refuses to run against
// the production host unless you pass --yes-production. At the end it prints the SQL that removes them.
// It exits non-zero on the first failed check, so it can gate a release.

import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const { subtle } = webcrypto;
const args = process.argv.slice(2);
const productArg = args.indexOf('--product') >= 0 ? args[args.indexOf('--product') + 1] : 'pinchpdf';
if (productArg !== 'pinchpdf' && productArg !== 'nodupe') throw new Error('--product must be pinchpdf or nodupe');
const P = productArg; // product prefix: paths, signing and hashing
const base = (args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--product') ?? 'http://localhost:3000').replace(/\/$/, '');
const kid = process.env.TRIAL_KID ?? 'k1';
const enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const sha256 = (d) => createHash('sha256').update(d).digest();

if (/(^|\/\/)(www\.)?technowizsolutions\.com/.test(base) && !args.includes('--yes-production')) {
  console.error('Refusing to write smoke events to production. Use staging, or pass --yes-production if you really mean it.');
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

async function serverPublic() {
  if (process.env.TRIAL_SERVER_PUBLIC) return unb64u(process.env.TRIAL_SERVER_PUBLIC);
  const vars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  const secret = vars.match(new RegExp(`^TRIAL_KEY_${kid}=(.+)$`, 'm'))?.[1]?.trim();
  if (!secret) throw new Error(`Set TRIAL_SERVER_PUBLIC, or put TRIAL_KEY_${kid} in .dev.vars`);
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), unb64u(secret)]);
  const key = await subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, true, ['deriveBits']);
  return unb64u((await subtle.exportKey('jwk', key)).x);
}

async function hkdf(ikm, salt, info) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, k, 256));
}

const serverKey = await serverPublic();

// node:http(s) rather than fetch: fetch (undici) silently retries an HTTP 421 and then fails on the
// already-sent body, but 421 is an answer this protocol uses on purpose (unknown key id).
function post(url, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = (target.protocol === 'https:' ? https : http).request(
      target,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (response) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode, json: async () => JSON.parse(text) });
        });
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

async function sealedPost(body, useKid = kid) {
  const eph = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const srv = await subtle.importKey('raw', serverKey, { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: srv }, eph.privateKey, 256));
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const kReq = await hkdf(shared, nonce, `${P}-trial-v1 req`);
  const kResp = await hkdf(shared, nonce, `${P}-trial-v1 resp`);
  const aesReq = await subtle.importKey('raw', kReq, 'AES-GCM', false, ['encrypt']);
  const aad = `POST /api/${P}/trial/v1/telemetry|${useKid}`;
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(aad) }, aesReq, enc.encode(JSON.stringify(body))));
  const res = await post(`${base}/api/${P}/trial/v1/telemetry`, JSON.stringify({ v: 1, kid: useKid, epk: b64u(epk), n: b64u(nonce), ct: b64u(ct) }));
  const json = await res.json().catch(() => null);
  if (res.status !== 200 || !json?.ct) return { status: res.status, plain: json };
  const aesResp = await subtle.importKey('raw', kResp, 'AES-GCM', false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(json.n), additionalData: enc.encode(`${b64u(nonce)}|telemetry`) }, aesResp, unb64u(json.ct));
  return { status: 200, result: JSON.parse(new TextDecoder().decode(pt)) };
}

// ---------------------------------------------------------------- the app's side: install, customer, signing
const keys = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const pubkey = b64u(new Uint8Array(await subtle.exportKey('raw', keys.publicKey)));
const customer = randomUUID();
const licenseHash = (key) => b64u(sha256(enc.encode(`${P}-telemetry-license-v1|${key}`)));
const signalHash = (name, value) => b64u(sha256(enc.encode(`${P}-trial-signal-v1|${name}|${value}`)));
const device = (n) => ({ guid: signalHash('guid', `smoke-guid-${customer}-${n}`), smbios: signalHash('smbios', `smoke-smbios-${customer}-${n}`), board: signalHash('board', `smoke-board-${customer}-${n}`) });

async function event(type, extra = {}, signOverride = {}) {
  const f = { event_id: randomUUID(), customer_uuid: customer, type, occurred_at: Math.floor(Date.now() / 1000), ...extra };
  const installer = type === 'install' || type === 'uninstall'; // from the installer: anonymous, with install_kind
  const anonymous = type === 'buy_clicked' || installer;
  const message = [
    `${P}-telemetry-v1`, f.event_id, f.customer_uuid, f.type, f.occurred_at,
    anonymous ? '' : (signOverride.plan ?? f.plan ?? ''),
    anonymous ? '' : (f.license ?? ''),
    type === 'license_key_changed' ? (f.prev_license ?? '') : '',
    ...(installer ? [f.install_kind ?? ''] : []),
  ].join('|');
  const sig = b64u(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, keys.privateKey, enc.encode(message))));
  return { proto: 1, ...f, pubkey, sig, ...(installer ? {} : { signals: device(1) }), app_version: 'smoke-test', os_build: 'smoke-test' };
}

console.log(`Telemetry smoke test against ${base} (key id ${kid})\n`);

// 1. the routes exist and are protected the way the health page expects
const get = await fetch(`${base}/api/${P}/trial/v1/telemetry`);
check('GET telemetry is refused (405: POST only)', get.status === 405, `got ${get.status}`);
const anon = await fetch(`${base}/api/${P}/insights/v1/buying`);
check('Insights JSON asks for a login (401, or 404 when the admin login is off)', anon.status === 401 || anon.status === 404, `got ${anon.status}`);

// 2. a realistic sequence of events, as sealed envelopes
const oldKey = `SMOKE-${customer}-OLD`;
const newKey = `SMOKE-${customer}-NEW`;
const click = await event('buy_clicked');
const activate = await event('license_activated', { plan: 'business', license: licenseHash(oldKey) });
const steps = [
  ['buy click', click],
  ['activation (business)', activate],
  ['same activation again (a retry)', activate],
  ['deactivation', await event('license_deactivated', { plan: 'business', license: licenseHash(oldKey) })],
  ['key change', await event('license_key_changed', { plan: 'business', license: licenseHash(newKey), prev_license: licenseHash(oldKey) })],
  ['install (new)', await event('install', { install_kind: 'new' })],
  ['uninstall', await event('uninstall')],
];
for (const [name, body] of steps) {
  const reply = await sealedPost(body);
  check(`sealed ${name} is accepted`, reply.result?.result === 'ok', reply.result ? '' : `HTTP ${reply.status} ${JSON.stringify(reply.plain)}`);
}

// 3. refusals
const tampered = await sealedPost(await event('license_activated', { plan: 'business', license: licenseHash(newKey) }, { plan: 'individual' }));
check('a tampered event is refused (400)', tampered.status === 400, `got ${tampered.status}`);
const wrongKid = await sealedPost(click, 'nokid');
check('an unknown key id is refused (421)', wrongKid.status === 421, `got ${wrongKid.status}`);

// 4. the Insights JSON API sees them (needs the admin login)
if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
  const auth = `Basic ${Buffer.from(`${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`).toString('base64')}`;
  for (const tab of ['buying', 'licenses', 'devices', 'installs']) {
    const res = await fetch(`${base}/api/${P}/insights/v1/${tab}`, { headers: { authorization: auth } });
    const json = await res.json().catch(() => null);
    const aligned = json && Object.values(json.series ?? {}).every((s) => Array.isArray(s) && s.length === json.bucket_starts.length);
    check(`Insights JSON "${tab}" answers 200 with aligned series`, res.status === 200 && json?.tab === tab && aligned, `HTTP ${res.status}`);
    if (tab === 'buying') check('the smoke buy click is counted', json?.attempts >= 1, `attempts ${json?.attempts}`);
    if (tab === 'licenses') check('active licenses are counted', json?.current?.active >= 1, `active ${json?.current?.active}`);
    if (tab === 'devices') check('the deactivation is counted', json?.deactivations >= 1, `deactivations ${json?.deactivations}`);
    if (tab === 'installs') check('the install and the uninstall are counted', json?.new >= 1 && json?.uninstalls >= 1, `new ${json?.new}, uninstalls ${json?.uninstalls}`);
  }
  const bad = await fetch(`${base}/api/${P}/insights/v1/buying?from=2026-12-31&to=2026-01-01`, { headers: { authorization: auth } });
  check('a bad date range is a 400', bad.status === 400, `got ${bad.status}`);
} else {
  console.log('SKIP  Insights JSON checks (set ADMIN_USER and ADMIN_PASSWORD to run them)');
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
console.log('\nRemove the smoke rows when you are done (staging):');
console.log(`  npx wrangler d1 execute ${P} --remote --command "DELETE FROM telemetry_events WHERE app_version = 'smoke-test'; DELETE FROM telemetry_customers WHERE customer_uuid = '${customer}';"`);
process.exit(failures === 0 ? 0 : 1);
