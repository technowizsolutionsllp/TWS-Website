// In-process self-test of the trial API. It plays the part of the PinchPDF app against this
// server's own handlers: asks for a challenge, then sends a real sealed /register and /usage
// request encrypted to the server's own public key for each accepted key id, and opens the
// sealed answers. That proves the private key, the envelope code and the database read path
// work together, without writing anything:
//
//   * /register is sent with an empty name, which the handler refuses before any database access;
//   * /usage is sent for a trial id that cannot exist, which reads the database and answers
//     `unknown_trial`.
//
// The requests carry the health header (so request counters skip them) and the handlers get a
// copy of the environment without rate limiters: the caller is the logged-in admin, and a limiter
// must not turn a health check into a failure or eat the budget of real clients.
//
// What this cannot prove is that the app embeds the matching public key. The health page shows
// the public key for each key id so it can be compared with the app.

import { b64urlDecode, b64urlEncode, concat, randomBytes, utf8 } from '../trial/bytes';
import { acceptedKids, configStatus, kidPrivateKey, type TrialEnv } from '../trial/config';
import { aesGcmOpen, aesGcmSeal, hkdfSha256 } from '../trial/crypto';
import { requestAad, responseAad } from '../trial/envelope';
import { handleChallenge, handleRegister, handleUsage } from '../trial/handlers';
import { HEALTH_HEADER } from '../trial/metrics';

export type SelfTestStep = { id: string; label: string; status: 'ok' | 'fail'; detail: string; ms: number };

const PKCS8_X25519_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
const LIMITERS = new Set(['TRIAL_CHALLENGE_LIMITER', 'TRIAL_REGISTER_LIMITER', 'TRIAL_USAGE_LIMITER', 'TRIAL_USAGE_IP_LIMITER']);

/** Public key (base64url) for a key id, derived from its private secret; null if the secret is unusable. */
export async function serverPublicKey(env: Partial<TrialEnv>, kid: string): Promise<string | null> {
  const privateRaw = b64urlDecode(kidPrivateKey(env as TrialEnv, kid));
  if (!privateRaw || privateRaw.length !== 32) return null;
  try {
    const key = await crypto.subtle.importKey('pkcs8', concat(PKCS8_X25519_PREFIX, privateRaw) as BufferSource, { name: 'X25519' }, true, ['deriveBits']);
    const x = ((await crypto.subtle.exportKey('jwk', key)) as JsonWebKey).x;
    return typeof x === 'string' ? x : null;
  } catch {
    return null;
  }
}

function withoutLimiters(env: TrialEnv): TrialEnv {
  return new Proxy(env, { get: (target, name) => (typeof name === 'string' && LIMITERS.has(name) ? undefined : Reflect.get(target, name)) });
}

function plainRequest(endpoint: string, body: unknown): Request {
  return new Request(`https://health.invalid/api/pinchpdf/trial/v1/${endpoint}`, {
    method: 'POST',
    headers: { [HEALTH_HEADER]: '1', 'cf-connecting-ip': 'health-check' },
    body: JSON.stringify(body),
  });
}

type Sealed = { status: number; result: Record<string, unknown> | null };

async function sealedCall(env: TrialEnv, endpoint: 'register' | 'usage', kid: string, publicKey: string, body: unknown): Promise<Sealed> {
  const eph = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const epk = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const serverKey = await crypto.subtle.importKey('raw', b64urlDecode(publicKey)! as BufferSource, { name: 'X25519' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: serverKey }, eph.privateKey, 256));
  const nonce = randomBytes(12);
  const nB64 = b64urlEncode(nonce);
  const kReq = await hkdfSha256(shared, nonce, 'pinchpdf-trial-v1 req');
  const kResp = await hkdfSha256(shared, nonce, 'pinchpdf-trial-v1 resp');
  const ct = await aesGcmSeal(kReq, nonce, utf8(requestAad(endpoint, kid)), utf8(JSON.stringify(body)));

  const request = plainRequest(endpoint, { v: 1, kid, epk: b64urlEncode(epk), n: nB64, ct: b64urlEncode(ct) });
  const response = endpoint === 'register' ? await handleRegister(request, env) : await handleUsage(request, env);
  if (response.status !== 200) return { status: response.status, result: null };

  const sealed = (await response.json()) as { n?: string; ct?: string };
  const opened = await aesGcmOpen(kResp, b64urlDecode(sealed.n)!, utf8(responseAad(nB64, endpoint)), b64urlDecode(sealed.ct)!);
  if (!opened) return { status: 200, result: null };
  return { status: 200, result: JSON.parse(new TextDecoder().decode(opened)) as Record<string, unknown> };
}

const statusMeaning = (status: number) =>
  status === 400
    ? 'the server could not open the request with its own key (TRIAL_KEY is unreadable or wrong)'
    : status === 421
      ? 'the key id is not accepted or its secret is unusable'
      : status === 503
        ? 'the service reported itself unavailable (configuration or database)'
        : `unexpected HTTP ${status}`;

async function timed(id: string, label: string, run: () => Promise<{ ok: boolean; detail: string }>): Promise<SelfTestStep> {
  const started = Date.now();
  try {
    const { ok, detail } = await run();
    return { id, label, status: ok ? 'ok' : 'fail', detail, ms: Date.now() - started };
  } catch (error) {
    return { id, label, status: 'fail', detail: `threw: ${String((error as Error)?.message).slice(0, 160)}`, ms: Date.now() - started };
  }
}

export async function runTrialSelfTest(rawEnv: TrialEnv): Promise<SelfTestStep[]> {
  const { missing, invalid } = configStatus(rawEnv);
  if (!rawEnv.TRIAL_DB || missing.length > 0 || invalid.length > 0) {
    return [{ id: 'selftest-skipped', label: 'Trial API self-test', status: 'fail', detail: 'Skipped: fix the configuration problems above first.', ms: 0 }];
  }
  const env = withoutLimiters(rawEnv);
  const steps: SelfTestStep[] = [];

  steps.push(
    await timed('selftest-challenge', 'Challenge issued', async () => {
      const pubkey = b64urlEncode(randomBytes(32));
      const response = await handleChallenge(plainRequest('challenge', { proto: 1, pubkey }), env);
      if (response.status !== 200) return { ok: false, detail: `HTTP ${response.status}: ${statusMeaning(response.status)}` };
      const challenge = b64urlDecode(((await response.json()) as { challenge?: string }).challenge);
      if (!challenge || challenge.length !== 57) return { ok: false, detail: 'the challenge is not 57 bytes, so the app will reject it' };
      const difficulty = challenge[24];
      if (difficulty > 26) return { ok: false, detail: `difficulty ${difficulty} is above 26: the app treats that as "service unavailable"` };
      return { ok: true, detail: `57 bytes, difficulty ${difficulty}` };
    }),
  );

  for (const kid of acceptedKids(rawEnv)) {
    const publicKey = await serverPublicKey(rawEnv, kid);
    if (!publicKey) {
      steps.push({ id: `selftest-register-${kid}`, label: `Sealed register (key ${kid})`, status: 'fail', detail: `TRIAL_KEY_${kid} cannot be turned into a public key`, ms: 0 });
      continue;
    }
    steps.push(
      await timed(`selftest-register-${kid}`, `Sealed register (key ${kid})`, async () => {
        const { status, result } = await sealedCall(env, 'register', kid, publicKey, { proto: 1, pubkey: b64urlEncode(randomBytes(32)), name: '', email: '' });
        if (!result) return { ok: false, detail: status === 200 ? 'the sealed answer could not be opened' : `HTTP ${status}: ${statusMeaning(status)}` };
        return result.result === 'invalid'
          ? { ok: true, detail: 'request opened and a sealed answer came back' }
          : { ok: false, detail: `unexpected answer "${String(result.result)}"` };
      }),
      await timed(`selftest-usage-${kid}`, `Sealed usage (key ${kid})`, async () => {
        const { status, result } = await sealedCall(env, 'usage', kid, publicKey, { proto: 1, trial_id: 'health-check', used: 0, sig: b64urlEncode(randomBytes(64)) });
        if (!result) return { ok: false, detail: status === 200 ? 'the sealed answer could not be opened' : `HTTP ${status}: ${statusMeaning(status)}` };
        return result.result === 'unknown_trial'
          ? { ok: true, detail: 'request opened, database read, sealed answer came back' }
          : { ok: false, detail: `unexpected answer "${String(result.result)}"` };
      }),
    );
  }
  return steps;
}
