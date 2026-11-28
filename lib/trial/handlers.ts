// Request handlers for the trial endpoints (challenge, lookup, register, usage). They take the environment and
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
  loadContact,
  loadModes,
  restoreTrial,
  writeModeUsage,
  writeUsage,
  type ModeRow,
  type NewTrial,
  type TrialRow,
} from './db';
import { openRequest, readLimitedText, sealResponse } from './envelope';
import { findBlockingRow, type StoredDevice } from './matching';
import { HEALTH_HEADER, outcomeOf, recordMetric, tagOutcome } from './metrics';
import { decryptField, emailBlindIndex, encryptField } from './pii';
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
import { maskEmail, maskName, restoreDecision, SUPPORT_REF_PATTERN } from './restore';
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
    // created_at, not received_at: a restore records a new consent time but keeps the registration date.
    registered_at: row.created_at,
    support_ref: row.support_ref,
  };
}

async function modesFor(db: D1Database, product: ProductSpec, row: TrialRow): Promise<ModeRow | null> {
  return product.perMode ? loadModes(db, row.id) : null;
}

/**
 * The answer for a computer that already holds a trial and may not continue it here. A revoked trial gives
 * the support reference only. Otherwise the app can also tell the user when the trial was registered and,
 * masked, under which name ("J••• D•••"; null once the name was erased).
 */
async function refusal(env: TrialEnv, db: D1Database, device: StoredDevice) {
  if (device.status === 'revoked') return { result: 'already_used', support_ref: device.support_ref };
  const [row, contact] = await Promise.all([findById(db, device.id), loadContact(db, device.id)]);
  const name = contact?.name_enc ? await decryptField(env, device.id, 'name', contact.name_enc) : null;
  return {
    result: 'already_used',
    support_ref: device.support_ref,
    registered_at: row?.created_at ?? null,
    name_hint: name ? maskName(name) : null,
  };
}

// -------------------------------------------------------------------- /lookup
//
// Revision 5. Before it shows the registration form, the app asks whether this computer already holds a
// trial. Nothing is written and no proof of work is needed: the answer only describes a trial to the computer
// that holds it, and the email is masked. The app then offers "Continue your trial" (register with `resume`).

async function lookupInner(request: Request, env: TrialEnv, product: ProductSpec): Promise<Response> {
  if (await limited(env.TRIAL_REGISTER_LIMITER, limitKey(product, `lookup|${clientIp(request)}`))) return rateLimited();

  const open = await openRequest(request, 'lookup', env, product);
  if (!open.ok) return open.response;
  const { opened } = open;
  const body = opened.body;
  const seal = async (payload: unknown, result: string, trialId?: string) => {
    log('lookup', result, opened.kid, trialId, product);
    return tagOutcome(await sealResponse(opened, 'lookup', payload), result);
  };

  if (body.proto !== PROTOCOL_VERSION) return badRequest();
  const clientSignals = await parseClientSignals(body.signals, product);
  if (!clientSignals) return badRequest();
  if (!Object.values(clientSignals).some(Boolean)) return seal({ result: 'unsupported_device' }, 'unsupported_device');

  try {
    const db = productDb(env, product);
    if (!db) throw new Error(`${product.dbBinding} is not bound`);
    const signals = await pepperSignals(env, clientSignals);
    const match = findBlockingRow(signals, await findCandidates(db, signals));
    if (!match) return seal({ result: 'none' }, 'none');
    if (match.status === 'revoked') return seal({ result: 'already_used', support_ref: match.support_ref }, 'already_used', match.id);

    const [row, contact] = await Promise.all([findById(db, match.id), loadContact(db, match.id)]);
    if (!row) return seal({ result: 'none' }, 'none'); // deleted between the two reads
    const email = contact?.email_enc ? await decryptField(env, row.id, 'email', contact.email_enc) : null;
    return seal(
      {
        result: 'found',
        state: deriveState(row),
        ...counters(row, await modesFor(db, product, row)),
        registered_at: row.created_at,
        email_hint: email ? maskEmail(email) : null,
        support_ref: row.support_ref,
      },
      'found',
      row.id,
    );
  } catch (error) {
    console.error(JSON.stringify({ svc: 'trial', product: product.id, endpoint: 'lookup', result: 'db_error', message: String((error as Error)?.message).slice(0, 120) }));
    return tagOutcome(unavailable(), 'db_error');
  }
}

// ----------------------------------------------------------------- /register (continued)

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

  // Revision 5: `resume` is the support reference /lookup returned. With it, name and email may be left out
  // (the stored ones are kept); a name or email that is sent replaces the stored one.
  const resume = body.resume === undefined || body.resume === null ? null : body.resume;
  if (resume !== null && (typeof resume !== 'string' || !SUPPORT_REF_PATTERN.test(resume))) return badRequest();
  const absent = (value: unknown) => resume !== null && (value === undefined || value === null);

  const name = absent(body.name) ? null : cleanText(body.name, 1, 100);
  if (name === null && !absent(body.name)) return seal({ result: 'invalid', field: 'name' }, 'invalid_name');
  const email = absent(body.email) ? null : cleanText(body.email, 3, 254);
  if (!absent(body.email) && (email === null || !EMAIL_PATTERN.test(email))) {
    return seal({ result: 'invalid', field: 'email' }, 'invalid_email');
  }

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
  let reported: ScanCounts | null = null;
  if (product.perMode && body.used !== undefined && body.used !== null) {
    const parsed = parseModeCounts(body.used);
    if (!parsed) return badRequest();
    initial = parsed;
    reported = parsed;
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

    // (7) device matching policy. Revision 5: the computer already holds a trial. It continues that trial
    // when the request names it (`resume`) or carries the same email; anything else is refused.
    const signals = await pepperSignals(env, clientSignals);
    const blocking = findBlockingRow(signals, await findCandidates(db, signals));
    if (blocking) {
      const contact = blocking.status === 'revoked' ? null : await loadContact(db, blocking.id);
      const emailMatches = email !== null && !!contact?.email_bidx && contact.email_bidx === (await emailBlindIndex(env, email));
      if (restoreDecision(blocking, { resume, emailMatches }) !== 'restore') return seal(await refusal(env, db, blocking), 'already_used');

      const before = await findById(db, blocking.id);
      if (!before) throw new Error('matched trial not found');
      const modesBefore = await modesFor(db, product, before);
      let restored: boolean;
      try {
        restored = await restoreTrial(
          db,
          {
            id: before.id,
            pubkey,
            nameEnc: name === null ? null : await encryptField(env, before.id, 'name', name),
            email: email === null ? null : { enc: await encryptField(env, before.id, 'email', email), bidx: await emailBlindIndex(env, email) },
            termsVersion: consent.terms_version as string,
            privacyVersion: consent.privacy_version as string,
            acceptedAt,
            now: nowSeconds,
            appVersion: optionalText(body.app_version, 32),
            osBuild: optionalText(body.os_build, 64),
            reported,
            matchedBy: resume !== null && resume === before.support_ref ? 'resume' : 'email',
            previous: modesBefore ? modesBefore.used : before.used,
            previousKey: before.pubkey,
          },
          product.perMode,
        );
      } catch (error) {
        // The same request raced itself: the loser finds the winner's key already in place.
        const winner = await findActiveByPubkey(db, pubkey);
        if (winner) return seal(registeredAnswer(winner, await modesFor(db, product, winner)), 'registered_replay', winner.id);
        throw error;
      }
      if (restored) {
        const row = await findById(db, before.id);
        if (!row) throw new Error('restored trial not found');
        return seal({ ...registeredAnswer(row, await modesFor(db, product, row)), restored: true }, 'restored', row.id);
      }
      // Nothing was written. Either an identical request already moved the trial to this key (answer as a replay),
      // or the trial stopped being active between the read and the write. Then decide again on what is stored now:
      // revoked still refuses (support reference only); reset or deleted no longer blocks, so a new trial follows.
      const same = await findActiveByPubkey(db, pubkey);
      if (same) return seal(registeredAnswer(same, await modesFor(db, product, same)), 'registered_replay', same.id);
      const still = findBlockingRow(signals, await findCandidates(db, signals));
      if (still) return seal(await refusal(env, db, still), 'already_used');
    }

    // (8) encrypt contact fields and insert. A new trial needs both, `resume` or not.
    if (name === null) return seal({ result: 'invalid', field: 'name' }, 'invalid_name');
    if (email === null) return seal({ result: 'invalid', field: 'email' }, 'invalid_email');
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
      return seal(await refusal(env, db, earlier), 'already_used_race');
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
  endpoint: 'challenge' | 'lookup' | 'register' | 'usage',
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
export const handleLookup = (request: Request, env: TrialEnv, clock: Clock = systemClock, product: ProductSpec = PINCHPDF) =>
  counted('lookup', request, env, clock, product, () => lookupInner(request, env, product));
export const handleRegister = (request: Request, env: TrialEnv, clock: Clock = systemClock, product: ProductSpec = PINCHPDF) =>
  counted('register', request, env, clock, product, () => registerInner(request, env, clock, product));
export const handleUsage = (request: Request, env: TrialEnv, clock: Clock = systemClock, product: ProductSpec = PINCHPDF) =>
  counted('usage', request, env, clock, product, () => usageInner(request, env, clock, product));
