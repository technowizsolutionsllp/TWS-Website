// A minimal PinchPDF-app stand-in for tests: install key, signals, envelope
// sealing, proof of work. Written against the protocol text, not the server code.

import { b64urlDecode, b64urlEncode, concat, leadingZeroBits, u64be, utf8 } from '../lib/trial/bytes';
import { aesGcmOpen, aesGcmSeal, hkdfSha256, sha256 } from '../lib/trial/crypto';
import { handleChallenge, handleRegister, handleUsage } from '../lib/trial/handlers';
import type { TrialEnv } from '../lib/trial/config';
import { clientSignalHash } from '../lib/trial/signals';

export const NOW = 1_800_000_000_000; // ms

export type Install = { publicRaw: Uint8Array; publicB64: string; sign: (message: string) => Promise<string> };

export async function newInstall(): Promise<Install> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicRaw,
    publicB64: b64urlEncode(publicRaw),
    sign: async (message) =>
      b64urlEncode(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, utf8(message)))),
  };
}

export type Device = { guid: string | null; smbios: string | null; board: string | null };

let counter = 0;
export function newDevice(): Device {
  counter += 1;
  return { guid: `guid-${counter}`, smbios: `smbios-${counter}`, board: `board-${counter}` };
}

export async function hashDevice(device: Device) {
  return {
    guid: device.guid === null ? null : await clientSignalHash('guid', device.guid),
    smbios: device.smbios === null ? null : await clientSignalHash('smbios', device.smbios),
    board: device.board === null ? null : await clientSignalHash('board', device.board),
  };
}

const PKCS8_X25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);

async function serverPublic(env: TrialEnv, kid: string): Promise<Uint8Array<ArrayBuffer>> {
  const priv = b64urlDecode((env as unknown as Record<string, string>)[`TRIAL_KEY_${kid}`])!;
  const key = await crypto.subtle.importKey('pkcs8', concat(PKCS8_X25519, priv), { name: 'X25519' }, true, ['deriveBits']);
  return b64urlDecode(((await crypto.subtle.exportKey("jwk", key)) as JsonWebKey).x)!;
}

const url = (endpoint: string) => `https://technowizsolutions.com/api/pinchpdf/trial/v1/${endpoint}`;

export async function seal(env: TrialEnv, endpoint: 'register' | 'usage', body: unknown, kid = 'k1') {
  const eph = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const epk = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const serverKey = await crypto.subtle.importKey('raw', await serverPublic(env, kid), { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: serverKey }, eph.privateKey, 256));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const kReq = await hkdfSha256(shared, nonce, 'pinchpdf-trial-v1 req');
  const kResp = await hkdfSha256(shared, nonce, 'pinchpdf-trial-v1 resp');
  const ct = await aesGcmSeal(kReq, nonce, utf8(`POST /api/pinchpdf/trial/v1/${endpoint}|${kid}`), utf8(JSON.stringify(body)));
  const envelope = { v: 1, kid, epk: b64urlEncode(epk), n: b64urlEncode(nonce), ct: b64urlEncode(ct) };
  return { envelope, kResp, nB64: b64urlEncode(nonce) };
}

// Tests read sealed results freely (result.trial_id and so on), so they are loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Reply = { status: number; plain: Record<string, unknown> | null; result: Record<string, any> | null };

/** Sends a sealed request and opens the sealed answer, if there is one. */
export async function call(
  env: TrialEnv,
  endpoint: 'register' | 'usage',
  body: unknown,
  options: { now?: number; kid?: string; mutate?: (envelope: Record<string, unknown>) => void } = {},
): Promise<Reply> {
  const sealed = await seal(env, endpoint, body, options.kid);
  options.mutate?.(sealed.envelope);
  const request = new Request(url(endpoint), { method: 'POST', body: JSON.stringify(sealed.envelope) });
  const clock = () => options.now ?? NOW;
  const response = endpoint === 'register' ? await handleRegister(request, env, clock) : await handleUsage(request, env, clock);
  const json = (await response.json()) as Record<string, unknown>;
  if (response.status === 200 && typeof json.ct === 'string') {
    const pt = await aesGcmOpen(sealed.kResp, b64urlDecode(json.n)!, utf8(`${sealed.nB64}|${endpoint}`), b64urlDecode(json.ct)!);
    if (!pt) throw new Error('sealed response did not open under k_resp');
    return { status: 200, plain: null, result: JSON.parse(new TextDecoder().decode(pt)) };
  }
  return { status: response.status, plain: json, result: null };
}

export async function fetchChallenge(env: TrialEnv, pubkeyB64: string, now = NOW) {
  const response = await handleChallenge(
    new Request(url('challenge'), { method: 'POST', body: JSON.stringify({ proto: 1, pubkey: pubkeyB64 }) }),
    env,
    () => now,
  );
  return { response, json: (await response.json()) as { challenge?: string; expires_at?: number } };
}

export async function solve(challengeB64: string, difficulty: number): Promise<string> {
  const challenge = b64urlDecode(challengeB64)!;
  for (let i = 0; ; i += 1) {
    const candidate = u64be(i);
    if (leadingZeroBits(await sha256(concat(challenge, candidate))) >= difficulty) return b64urlEncode(candidate);
  }
}

export type RegisterOptions = {
  device?: Device;
  install?: Install;
  name?: string;
  email?: string;
  now?: number;
  challengeNow?: number;
  consent?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
};

/** Full client flow: challenge, proof of work, sealed register. */
export async function register(env: TrialEnv, options: RegisterOptions = {}) {
  const install = options.install ?? (await newInstall());
  const device = options.device ?? newDevice();
  const now = options.now ?? NOW;
  const { json } = await fetchChallenge(env, install.publicB64, options.challengeNow ?? now);
  const difficulty = Number(env.TRIAL_DIFFICULTY ?? 20);
  const solution = await solve(json.challenge!, difficulty);
  const body = {
    proto: 1,
    challenge: json.challenge,
    solution,
    pubkey: install.publicB64,
    name: options.name ?? 'Jane Doe',
    email: options.email ?? 'jane@example.com',
    consent: options.consent ?? { terms_version: env.TRIAL_TERMS_VERSION, privacy_version: env.TRIAL_PRIVACY_VERSION, accepted_at: Math.floor(now / 1000) - 5 },
    signals: await hashDevice(device),
    app_version: '1.3.0',
    os_build: '10.0.26200',
    ...options.overrides,
  };
  return { install, device, body, reply: await call(env, 'register', body, { now }) };
}

export async function reportUsage(env: TrialEnv, install: Install, trialId: string, used: number, now = NOW, signedUsed = used) {
  const sig = await install.sign(`pinchpdf-trial-usage-v1|${trialId}|${signedUsed}`);
  return call(env, 'usage', { proto: 1, trial_id: trialId, used, sig, app_version: '1.3.0' }, { now });
}
