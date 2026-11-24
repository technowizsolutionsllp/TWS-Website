// Request handlers for the three trial endpoints. They take the environment and
// the clock as arguments so tests can drive them directly; the Next route files
// only supply the real ones.
//
// The same handlers serve PinchPDF and NoDupe. A `product` setting (lib/trial/product.ts) carries the
// endpoint paths, the database, the signing prefix and how a trial is counted: PinchPDF has one counter,
// NoDupe one counter per scan mode (basic, similar, deep). PinchPDF is the default everywhere.

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
  insertModeTrial,
  insertTrial,
  loadModes,
  writeModeUsage,
  writeUsage,
  type ModeRow,
  type NewTrial,
  type TrialRow,
} from './db';
import { openRequest, readLimitedText, sealResponse } from './envelope';
import { findBlockingRow } from './matching';
import { HEALTH_HEADER, outcomeOf, recordMetric, tagOutcome } from './metrics';
import { emailBlindIndex, encryptField } from './pii';
import {
  NODUPE_LIMITS,
  PINCHPDF,
  SCAN_MODES,
  limitKey,
  privacyVersion,
  productDb,
  sumCounts,
  termsVersion,
  type ProductSpec,
  type ScanCounts,
} from './product';
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
function log(endpoint: string, result: string, kid?: string, trialId?: string, product: ProductSpec = PINCHPDF) {
  console.log(JSON.stringify({ svc: 'trial', ...(product === PINCHPDF ? {} : { product: product.id }), endpoint, result, kid, trial: trialId?.slice(0, 8) }));
}

// ---------------------------------------------------------------- /challenge

async function challengeInner(request: Request, env: TrialEnv, clock: Clock, product: ProductSpec): Promise<Response> {
  if (await limited(env.TRIAL_CHALLENGE_LIMITER, limitKey(product, clientIp(request)))) return rateLimited();

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

  const { challenge, expiresAt } = await issueChallenge(env, pubkey, Math.floor(clock() / 1000), undefined, undefined, product);
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

const MAX_REPORTED_USED = 1_000_000;

/** NoDupe: `{ basic, similar, deep }`, each a whole number from 0 to MAX_REPORTED_USED, and nothing else. */
function parseModeCounts(value: unknown): ScanCounts | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== SCAN_MODES.length || !SCAN_MODES.every((mode) => keys.includes(mode))) return null;
  const out = {} as ScanCounts;
  for (const mode of SCAN_MODES) {
    const n = record[mode];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > MAX_REPORTED_USED) return null;
    out[mode] = n;
  }
  return out;
}

/** The answer's `used` and `limit`: one number for PinchPDF, one per mode for NoDupe. */
function counters(row: TrialRow, modes: ModeRow | null) {
  return modes ? { used: modes.used, limit: modes.limit } : { used: row.used, limit: row.limit_total };
}

function registeredAnswer(row: TrialRow, modes: ModeRow | null) {
  return {
    result: 'registered',
    trial_id: row.id,
    state: deriveState(row),
    ...counters(row, modes),
    registered_at: row.received_at,
    support_ref: row.support_ref,
  };
}

async function modesFor(db: D1Database, product: ProductSpec, row: TrialRow): Promise<ModeRow | null> {
  return product.perMode ? loadModes(db, row.id) : null;
}

async function registerInner(request: Request, env: TrialEnv, clock: Clock, product: ProductSpec): Promise<Response> {
  if (await limited(env.TRIAL_REGISTER_LIMITER, limitKey(product, clientIp(request)))) return rateLimited();

  // (1) open the envelope
  const open = await openRequest(request, 'register', env, product);
  if (!open.ok) return open.response;
  const { opened } = open;
  const body = opened.body;
  const seal = async (payload: unknown, result: string, trialId?: string) => {
    log('register', result, opened.kid, trialId, product);
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
  const wantTerms = termsVersion(env, product);
  const wantPrivacy = privacyVersion(env, product);
  if (consent.terms_version !== wantTerms || consent.privacy_version !== wantPrivacy) {
    return seal({ result: 'terms_outdated', terms_version: wantTerms, privacy_version: wantPrivacy }, 'terms_outdated');
  }
  const acceptedAt = consent.accepted_at;
  if (typeof acceptedAt !== 'number' || !Number.isSafeInteger(acceptedAt) || acceptedAt < 0) {
    return seal({ result: 'invalid', field: 'consent' }, 'invalid_consent');
  }

  // NoDupe: an install that already used some free scans before it registered reports them here, so that
  // registering never gives it a fresh trial. Absent means none. The counts are clamped to the limits.
  let initial: ScanCounts = { basic: 0, similar: 0, deep: 0 };
  if (product.perMode && body.used !== undefined && body.used !== null) {
    const parsed = parseModeCounts(body.used);
    if (!parsed) return badRequest();
    initial = parsed;
  }

  const clientSignals = await parseClientSignals(body.signals, product);
  if (!clientSignals) return badRequest();

  // (3) + (4) challenge and proof of work, still without touching D1
  const nowSeconds = Math.floor(clock() / 1000);
  const check = await verifyChallenge(env, body.challenge, body.solution, pubkeyBytes, nowSeconds, product);
  if (check === 'expired') return seal({ result: 'challenge_expired' }, 'challenge_expired');
  if (check !== 'ok') return badRequest();

  try {
    const db = productDb(env, product);
    if (!db) throw new Error(`${product.dbBinding} is not bound`);

    // (5) idempotent replay for an ACTIVE install key
    const existing = await findActiveByPubkey(db, pubkey);
    if (existing) return seal(registeredAnswer(existing, await modesFor(db, product, existing)), 'registered_replay', existing.id);

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
      const trial: NewTrial = {
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
      };
      if (product.perMode) await insertModeTrial(db, trial, NODUPE_LIMITS, initial);
      else await insertTrial(db, trial);
    } catch (error) {
      // Two identical requests raced: the loser finds the winner's row.
      const winner = await findActiveByPubkey(db, pubkey);
      if (winner) return seal(registeredAnswer(winner, await modesFor(db, product, winner)), 'registered_replay', winner.id);
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
    return seal(registeredAnswer(row, await modesFor(db, product, row)), 'registered', id);
  } catch (error) {
    console.error(JSON.stringify({ svc: 'trial', product: product.id, endpoint: 'register', result: 'db_error', message: String((error as Error)?.message).slice(0, 120) }));
    return tagOutcome(unavailable(), 'db_error');
  }
}

// -------------------------------------------------------------------- /usage

async function usageInner(request: Request, env: TrialEnv, clock: Clock, product: ProductSpec): Promise<Response> {
  // Per-IP first: opening the envelope costs a key agreement, so floods are refused before that work.
  if (await limited(env.TRIAL_USAGE_IP_LIMITER, limitKey(product, clientIp(request)))) return rateLimited();

  const open = await openRequest(request, 'usage', env, product);
  if (!open.ok) return open.response;
  const { opened } = open;
  const body = opened.body;
  const seal = async (payload: unknown, result: string, trialId?: string) => {
    log('usage', result, opened.kid, trialId, product);
    return tagOutcome(await sealResponse(opened, 'usage', payload), result);
  };

  const trialId = body.trial_id;
  const sig = b64urlDecode(body.sig);
  // PinchPDF reports one number; NoDupe reports one number per mode.
  const used = body.used;
  const modeUsed = product.perMode ? parseModeCounts(used) : null;
  const usedOk = product.perMode
    ? modeUsed !== null
    : typeof used === 'number' && Number.isSafeInteger(used) && used >= 0 && used <= MAX_REPORTED_USED;
  if (
    body.proto !== PROTOCOL_VERSION ||
    typeof trialId !== 'string' ||
    trialId.length < 1 ||
    trialId.length > 64 ||
    !usedOk ||
    !sig
  ) {
    return badRequest();
  }

  if (await limited(env.TRIAL_USAGE_LIMITER, limitKey(product, trialId))) return rateLimited();

  try {
    const db = productDb(env, product);
    if (!db) throw new Error(`${product.dbBinding} is not bound`);
    const row = await findById(db, trialId);
    // A reset row has no active key; it is the same as an unknown trial.
    if (!row || row.status === 'reset' || !row.pubkey) return seal({ result: 'unknown_trial' }, 'unknown_trial');

    // Verify the install-key signature BEFORE any write.
    const publicKey = b64urlDecode(row.pubkey);
    const signed = modeUsed ? `${modeUsed.basic}|${modeUsed.similar}|${modeUsed.deep}` : String(used);
    const message = utf8(`${product.prefix}-trial-usage-v1|${trialId}|${signed}`);
    if (!publicKey || !(await ed25519Verify(publicKey, sig, message))) {
      log('usage', 'bad_signature', opened.kid, trialId, product);
      return tagOutcome(badRequest(), 'bad_signature');
    }

    const now = Math.floor(clock() / 1000);

    if (modeUsed) {
      // S_i = max(S_i, min(reported_i, T_i)) for each mode; a lower or duplicate count changes nothing.
      const stored = await loadModes(db, trialId);
      if (!stored) return seal({ result: 'unknown_trial' }, 'unknown_trial');
      const next = {} as ScanCounts;
      let changed = false;
      for (const mode of SCAN_MODES) {
        next[mode] = Math.max(stored.used[mode], Math.min(modeUsed[mode], stored.limit[mode]));
        if (next[mode] !== stored.used[mode]) changed = true;
      }
      if (changed || now - row.last_server_contact_at > CONTACT_WRITE_INTERVAL_SECONDS) await writeModeUsage(db, trialId, next, now);
      const updated = { ...row, used: sumCounts(next) };
      return seal({ result: 'ok', state: deriveState(updated), used: next, limit: stored.limit }, 'ok', trialId);
    }

    // S_new = max(S, min(used, T)); a lower or duplicate count changes nothing.
    const next = Math.max(row.used, Math.min(used as number, row.limit_total));
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
    console.error(JSON.stringify({ svc: 'trial', product: product.id, endpoint: 'usage', result: 'db_error', message: String((error as Error)?.message).slice(0, 120) }));
    return tagOutcome(unavailable(), 'db_error');
  }
}


// ------------------------------------------------------------ request counting

async function counted(
  endpoint: 'challenge' | 'register' | 'usage',
  request: Request,
  env: TrialEnv,
  clock: Clock,
  product: ProductSpec,
  run: () => Promise<Response>,
): Promise<Response> {
  const skip = request.headers.get(HEALTH_HEADER) === '1';
  let response: Response;
  try {
    response = await run();
  } catch (error) {
    if (!skip) await recordMetric(env, endpoint, 'error', clock(), product.id);
    throw error;
  }
  if (!skip) await recordMetric(env, endpoint, outcomeOf(response), clock(), product.id);
  return response;
}

export const handleChallenge = (request: Request, env: TrialEnv, clock: Clock = systemClock, product: ProductSpec = PINCHPDF) =>
  counted('challenge', request, env, clock, product, () => challengeInner(request, env, clock, product));
export const handleRegister = (request: Request, env: TrialEnv, clock: Clock = systemClock, product: ProductSpec = PINCHPDF) =>
  counted('register', request, env, clock, product, () => registerInner(request, env, clock, product));
export const handleUsage = (request: Request, env: TrialEnv, clock: Clock = systemClock, product: ProductSpec = PINCHPDF) =>
  counted('usage', request, env, clock, product, () => usageInner(request, env, clock, product));
