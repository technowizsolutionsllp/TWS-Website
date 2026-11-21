// Request handlers for the three trial endpoints. They take the environment and
// the clock as arguments so tests can drive them directly; the Next route files
// only supply the real ones.

import { b64urlDecode, b64urlEncode, newSupportRef, newTrialId, utf8 } from './bytes';
import { issueChallenge, verifyChallenge } from './challenge';
import {
  CONTACT_WRITE_INTERVAL_SECONDS,
  PROTOCOL_VERSION,
  trialLimit,
  type RateLimiter,
  type TrialEnv,
} from './config';
import { ed25519Verify } from './crypto';
import {
  deleteTrial,
  deriveState,
  findActiveByPubkey,
  findById,
  findCandidates,
  insertTrial,
  writeUsage,
  type TrialRow,
} from './db';
import { openRequest, readLimitedText, sealResponse } from './envelope';
import { findBlockingRow } from './matching';
import { outcomeOf, recordMetric, tagOutcome } from './metrics';
import { emailBlindIndex, encryptField } from './pii';
import { badRequest, plain, rateLimited, unavailable } from './responses';
import { parseClientSignals, pepperSignals } from './signals';

type Clock = () => number; // milliseconds
const systemClock: Clock = () => Date.now();

// Only the header Cloudflare sets at its edge is trusted. X-Forwarded-For is client-controlled, so
// it is never used as a rate-limit key (everything without the header shares one "unknown" bucket).
function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

async function limited(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return false; // binding not present (tests, or not on this plan): other layers apply
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false; // a limiter failure must not become an outage
  }
}

// Logging: result codes only. Never names, emails, hashes or full ids.
function log(endpoint: string, result: string, kid?: string, trialId?: string) {
  console.log(JSON.stringify({ svc: 'trial', endpoint, result, kid, trial: trialId?.slice(0, 8) }));
}

// ---------------------------------------------------------------- /challenge

async function challengeInner(request: Request, env: TrialEnv, clock: Clock): Promise<Response> {
  if (await limited(env.TRIAL_CHALLENGE_LIMITER, clientIp(request))) return rateLimited();

  let text: string | null;
  try {
    text = await readLimitedText(request, 1024);
  } catch {
    return badRequest();
  }
  let body: { proto?: unknown; pubkey?: unknown } | null = null;
  try {
    body = text === null ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  const pubkey = body && typeof body === 'object' ? b64urlDecode(body.pubkey) : null;
  if (!body || body.proto !== PROTOCOL_VERSION || !pubkey || pubkey.length !== 32) return badRequest();

  const { challenge, expiresAt } = await issueChallenge(env, pubkey, Math.floor(clock() / 1000));
  return plain(200, { challenge: b64urlEncode(challenge), expires_at: expiresAt });
}

// ----------------------------------------------------------------- /register

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function cleanText(value: unknown, minLength: number, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (length < minLength || length > maxLength || CONTROL_CHARACTERS.test(trimmed)) return null;
  return trimmed;
}

function optionalText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && !CONTROL_CHARACTERS.test(value) ? value.trim().slice(0, maxLength) || null : null;
}

function registeredAnswer(row: TrialRow) {
  return {
    result: 'registered',
    trial_id: row.id,
    state: deriveState(row),
    used: row.used,
    limit: row.limit_total,
    registered_at: row.received_at,
    support_ref: row.support_ref,
  };
}

async function registerInner(request: Request, env: TrialEnv, clock: Clock): Promise<Response> {
  if (await limited(env.TRIAL_REGISTER_LIMITER, clientIp(request))) return rateLimited();

  // (1) open the envelope
  const open = await openRequest(request, 'register', env);
  if (!open.ok) return open.response;
  const { opened } = open;
  const body = opened.body;
  const seal = async (payload: unknown, result: string, trialId?: string) => {
    log('register', result, opened.kid, trialId);
    return tagOutcome(await sealResponse(opened, 'register', payload), result);
  };

  // (2) validate fields
  if (body.proto !== PROTOCOL_VERSION) return badRequest();
  const pubkeyBytes = b64urlDecode(body.pubkey);
  if (!pubkeyBytes || pubkeyBytes.length !== 32) return badRequest();
  const pubkey = b64urlEncode(pubkeyBytes);

  const name = cleanText(body.name, 1, 100);
  if (name === null) return seal({ result: 'invalid', field: 'name' }, 'invalid_name');
  const email = cleanText(body.email, 3, 254);
  if (email === null || !EMAIL_PATTERN.test(email)) return seal({ result: 'invalid', field: 'email' }, 'invalid_email');

  const consent = body.consent as { terms_version?: unknown; privacy_version?: unknown; accepted_at?: unknown } | null;
  if (!consent || typeof consent !== 'object') return seal({ result: 'invalid', field: 'consent' }, 'invalid_consent');
  if (consent.terms_version !== env.TRIAL_TERMS_VERSION || consent.privacy_version !== env.TRIAL_PRIVACY_VERSION) {
    return seal(
      { result: 'terms_outdated', terms_version: env.TRIAL_TERMS_VERSION, privacy_version: env.TRIAL_PRIVACY_VERSION },
      'terms_outdated',
    );
  }
  const acceptedAt = consent.accepted_at;
  if (typeof acceptedAt !== 'number' || !Number.isSafeInteger(acceptedAt) || acceptedAt < 0) {
    return seal({ result: 'invalid', field: 'consent' }, 'invalid_consent');
  }

  const clientSignals = await parseClientSignals(body.signals);
  if (!clientSignals) return badRequest();

  // (3) + (4) challenge and proof of work, still without touching D1
  const nowSeconds = Math.floor(clock() / 1000);
  const check = await verifyChallenge(env, body.challenge, body.solution, pubkeyBytes, nowSeconds);
  if (check === 'expired') return seal({ result: 'challenge_expired' }, 'challenge_expired');
  if (check !== 'ok') return badRequest();

  try {
    const db = env.TRIAL_DB;

    // (5) idempotent replay for an ACTIVE install key
    const existing = await findActiveByPubkey(db, pubkey);
    if (existing) return seal(registeredAnswer(existing), 'registered_replay', existing.id);

    // (6) no usable signal at all
    if (!Object.values(clientSignals).some(Boolean)) return seal({ result: 'unsupported_device' }, 'unsupported_device');

    // (7) device matching policy
    const signals = await pepperSignals(env, clientSignals);
    const blocking = findBlockingRow(signals, await findCandidates(db, signals));
    if (blocking) return seal({ result: 'already_used', support_ref: blocking.support_ref }, 'already_used');

    // (8) encrypt contact fields and insert
    const id = newTrialId();
    const supportRef = newSupportRef();
    try {
      await insertTrial(db, {
        id,
        pubkey,
        supportRef,
        signals,
        nameEnc: await encryptField(env, id, 'name', name),
        emailEnc: await encryptField(env, id, 'email', email),
        emailBidx: await emailBlindIndex(env, email),
        limit: trialLimit(env),
        termsVersion: consent.terms_version as string,
        privacyVersion: consent.privacy_version as string,
        acceptedAt,
        now: nowSeconds,
        appVersion: optionalText(body.app_version, 32),
        osBuild: optionalText(body.os_build, 64),
      });
    } catch (error) {
      // Two identical requests raced: the loser finds the winner's row.
      const winner = await findActiveByPubkey(db, pubkey);
      if (winner) return seal(registeredAnswer(winner), 'registered_replay', winner.id);
      throw error;
    }

    // D1 offers no interactive transaction, so two DIFFERENT keys from the same
    // machine can both pass step 7. Re-check against rows inserted before ours;
    // the earlier insert wins and the later one withdraws.
    const earlier = findBlockingRow(signals, await findCandidates(db, signals, id));
    if (earlier) {
      await deleteTrial(db, id);
      return seal({ result: 'already_used', support_ref: earlier.support_ref }, 'already_used_race');
    }

    const row = await findById(db, id);
    if (!row) throw new Error('inserted trial not found');
    return seal(registeredAnswer(row), 'registered', id);
  } catch (error) {
    console.error(JSON.stringify({ svc: 'trial', endpoint: 'register', result: 'db_error', message: String((error as Error)?.message).slice(0, 120) }));
    return tagOutcome(unavailable(), 'db_error');
  }
}

// -------------------------------------------------------------------- /usage

const MAX_REPORTED_USED = 1_000_000;

async function usageInner(request: Request, env: TrialEnv, clock: Clock): Promise<Response> {
  // Per-IP first: opening the envelope costs a key agreement, so floods are refused before that work.
  if (await limited(env.TRIAL_USAGE_IP_LIMITER, clientIp(request))) return rateLimited();

  const open = await openRequest(request, 'usage', env);
  if (!open.ok) return open.response;
  const { opened } = open;
  const body = opened.body;
  const seal = async (payload: unknown, result: string, trialId?: string) => {
    log('usage', result, opened.kid, trialId);
    return tagOutcome(await sealResponse(opened, 'usage', payload), result);
  };

  const trialId = body.trial_id;
  const used = body.used;
  const sig = b64urlDecode(body.sig);
  if (
    body.proto !== PROTOCOL_VERSION ||
    typeof trialId !== 'string' ||
    trialId.length < 1 ||
    trialId.length > 64 ||
    typeof used !== 'number' ||
    !Number.isSafeInteger(used) ||
    used < 0 ||
    used > MAX_REPORTED_USED ||
    !sig
  ) {
    return badRequest();
  }

  if (await limited(env.TRIAL_USAGE_LIMITER, trialId)) return rateLimited();

  try {
    const db = env.TRIAL_DB;
    const row = await findById(db, trialId);
    // A reset row has no active key; it is the same as an unknown trial.
    if (!row || row.status === 'reset' || !row.pubkey) return seal({ result: 'unknown_trial' }, 'unknown_trial');

    // Verify the install-key signature BEFORE any write.
    const publicKey = b64urlDecode(row.pubkey);
    const message = utf8(`pinchpdf-trial-usage-v1|${trialId}|${used}`);
    if (!publicKey || !(await ed25519Verify(publicKey, sig, message))) {
      log('usage', 'bad_signature', opened.kid, trialId);
      return tagOutcome(badRequest(), 'bad_signature');
    }

    // S_new = max(S, min(used, T)); a lower or duplicate count changes nothing.
    const now = Math.floor(clock() / 1000);
    const next = Math.max(row.used, Math.min(used, row.limit_total));
    if (next !== row.used || now - row.last_server_contact_at > CONTACT_WRITE_INTERVAL_SECONDS) {
      await writeUsage(db, trialId, next, now);
    }

    const updated = { ...row, used: next };
    return seal(
      { result: 'ok', state: deriveState(updated), used: next, limit: row.limit_total },
      'ok',
      trialId,
    );
  } catch (error) {
    console.error(JSON.stringify({ svc: 'trial', endpoint: 'usage', result: 'db_error', message: String((error as Error)?.message).slice(0, 120) }));
    return tagOutcome(unavailable(), 'db_error');
  }
}


// ------------------------------------------------------------ request counting

async function counted(endpoint: 'challenge' | 'register' | 'usage', env: TrialEnv, clock: Clock, run: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try {
    response = await run();
  } catch (error) {
    await recordMetric(env, endpoint, 'error', clock());
    throw error;
  }
  await recordMetric(env, endpoint, outcomeOf(response), clock());
  return response;
}

export const handleChallenge = (request: Request, env: TrialEnv, clock: Clock = systemClock) =>
  counted('challenge', env, clock, () => challengeInner(request, env, clock));
export const handleRegister = (request: Request, env: TrialEnv, clock: Clock = systemClock) =>
  counted('register', env, clock, () => registerInner(request, env, clock));
export const handleUsage = (request: Request, env: TrialEnv, clock: Clock = systemClock) =>
  counted('usage', env, clock, () => usageInner(request, env, clock));
