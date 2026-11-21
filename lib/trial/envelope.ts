// Sealed envelope for /register and /usage (protocol section 4).
//
//   request  { v, kid, epk, n, ct }   X25519(eph, server kid key) -> HKDF -> AES-256-GCM
//   response { v, n, ct }             AES-256-GCM under k_resp, AAD "<request n>|<endpoint>"

import { aesGcmOpen, aesGcmSeal, hkdfSha256, x25519Shared } from './crypto';
import { b64urlDecode, b64urlEncode, randomBytes, utf8 } from './bytes';
import {
  BASE_PATH,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  PROTOCOL_VERSION,
  acceptedKids,
  kidPrivateKey,
  type TrialEnv,
} from './config';
import { badRequest, kidUnsupported } from './responses';

export type Endpoint = 'register' | 'usage';

export type OpenedRequest = {
  kid: string;
  /** Request nonce, base64url (bound into the response AAD). */
  nB64: string;
  kResp: Uint8Array<ArrayBuffer>;
  body: Record<string, unknown>;
};

// Why an envelope was refused, for the logs only. The HTTP answer stays a plain 400 or 421 and says
// nothing (the app must not learn anything from a refusal). Reason and key id only: never request
// content. Capped per minute so junk traffic cannot flood the logs.
const REJECT_LOG_LIMIT = 5;
const REJECT_LOG_WINDOW_MS = 60_000;
let rejectWindowStart = 0;
let rejectLogged = 0;

/** Test hook. */
export function resetRejectLog() {
  rejectWindowStart = 0;
  rejectLogged = 0;
}

function logRejected(endpoint: Endpoint, reason: string, kid?: string, now = Date.now()) {
  if (now - rejectWindowStart >= REJECT_LOG_WINDOW_MS) {
    rejectWindowStart = now;
    rejectLogged = 0;
  }
  if (rejectLogged >= REJECT_LOG_LIMIT) return;
  rejectLogged += 1;
  console.warn(JSON.stringify({ svc: 'trial', endpoint, result: 'envelope_rejected', reason, kid }));
}

export const requestAad = (endpoint: Endpoint, kid: string) => `POST ${BASE_PATH}${endpoint}|${kid}`;
export const responseAad = (nReqB64: string, endpoint: Endpoint) => `${nReqB64}|${endpoint}`;

/** Reads at most MAX_REQUEST_BYTES; returns null when the body is larger. */
export async function readLimitedText(request: Request, maxBytes = MAX_REQUEST_BYTES): Promise<string | null> {
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(all);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Opens a sealed request. On failure returns the plain HTTP error Response the
 * route must send (400 bad request, 421 unknown or retired kid).
 */
export async function openRequest(
  request: Request,
  endpoint: Endpoint,
  env: TrialEnv,
): Promise<{ ok: true; opened: OpenedRequest } | { ok: false; response: Response }> {
  let text: string | null;
  try {
    text = await readLimitedText(request);
  } catch {
    logRejected(endpoint, 'unreadable_body');
    return { ok: false, response: badRequest() };
  }
  if (text === null) {
    logRejected(endpoint, 'unreadable_body');
    return { ok: false, response: badRequest() };
  }

  const envelope = parseJsonObject(text);
  if (!envelope || envelope.v !== PROTOCOL_VERSION) {
    logRejected(endpoint, 'not_an_envelope');
    return { ok: false, response: badRequest() };
  }

  const kid = envelope.kid;
  if (typeof kid !== 'string' || !/^[A-Za-z0-9]{1,16}$/.test(kid)) {
    logRejected(endpoint, 'bad_kid_format');
    return { ok: false, response: badRequest() };
  }
  const epk = b64urlDecode(envelope.epk);
  const nonce = b64urlDecode(envelope.n);
  const ct = b64urlDecode(envelope.ct);
  if (!epk || epk.length !== 32 || !nonce || nonce.length !== 12 || !ct || ct.length < 16) {
    logRejected(endpoint, 'bad_envelope_fields', kid);
    return { ok: false, response: badRequest() };
  }

  // The allowlist is authoritative: a secret that exists for a kid that is not
  // listed (retired or emergency-removed) must not be usable.
  const privateB64 = kidPrivateKey(env, kid);
  if (!acceptedKids(env).includes(kid) || !privateB64) {
    logRejected(endpoint, 'kid_not_accepted', kid); // the app uses a key id this server does not list
    return { ok: false, response: kidUnsupported() };
  }
  const privateRaw = b64urlDecode(privateB64);
  if (!privateRaw) {
    logRejected(endpoint, 'server_key_unreadable', kid);
    return { ok: false, response: kidUnsupported() };
  }

  const shared = await x25519Shared(privateRaw, epk);
  if (!shared) {
    logRejected(endpoint, 'key_agreement_failed', kid);
    return { ok: false, response: badRequest() };
  }

  const kReq = await hkdfSha256(shared, nonce, 'pinchpdf-trial-v1 req', 32);
  const plaintext = await aesGcmOpen(kReq, nonce, utf8(requestAad(endpoint, kid)), ct);
  if (!plaintext) {
    // A well-formed envelope that does not open: the app encrypted to a public key that is not the
    // pair of this server's TRIAL_KEY_<kid> (most common after a key change), or it was altered.
    logRejected(endpoint, 'decrypt_failed', kid);
    return { ok: false, response: badRequest() };
  }

  let body: Record<string, unknown> | null;
  try {
    body = parseJsonObject(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    body = null;
  }
  if (!body) {
    logRejected(endpoint, 'bad_plaintext', kid);
    return { ok: false, response: badRequest() };
  }

  const kResp = await hkdfSha256(shared, nonce, 'pinchpdf-trial-v1 resp', 32);
  return { ok: true, opened: { kid, nB64: b64urlEncode(nonce), kResp, body } };
}

/** Seals a response object (always HTTP 200; the protocol result is inside). */
export async function sealResponse(
  opened: Pick<OpenedRequest, 'kResp' | 'nB64'>,
  endpoint: Endpoint,
  payload: unknown,
  nonce: Uint8Array = randomBytes(12),
): Promise<Response> {
  const plaintext = utf8(JSON.stringify(payload));
  const ct = await aesGcmSeal(opened.kResp, nonce, utf8(responseAad(opened.nB64, endpoint)), plaintext);
  const body = JSON.stringify({ v: PROTOCOL_VERSION, n: b64urlEncode(nonce), ct: b64urlEncode(ct) });
  if (body.length > MAX_RESPONSE_BYTES) throw new Error('trial response exceeds the 4 KiB limit');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
