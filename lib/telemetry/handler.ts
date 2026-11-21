// POST /api/pinchpdf/trial/v1/telemetry: one sealed app event (buy click or license lifecycle).
//
// Same sealed envelope as /register and /usage. The app signs each event with its install key; the key
// is bound to customer_uuid on first sight, so nobody else can add events to that customer. Everything
// identifying a license or a machine is a keyed hash. No name or email is accepted or stored.
//
// Signed message (UTF-8), fields joined by "|", absent optional fields as the empty string:
//   pinchpdf-telemetry-v1|event_id|customer_uuid|type|occurred_at|plan|license|prev_license

import { b64urlDecode, b64urlEncode, concat, newTrialId, utf8 } from '../trial/bytes';
import { PROTOCOL_VERSION, type RateLimiter, type TrialEnv } from '../trial/config';
import { ed25519Verify, hmacSha256 } from '../trial/crypto';
import { openRequest, sealResponse } from '../trial/envelope';
import { rowBlocks } from '../trial/matching';
import { badRequest, rateLimited, unavailable } from '../trial/responses';
import { parseClientSignals, pepperSignals } from '../trial/signals';
import {
  EVENT_TYPES,
  PLANS,
  findCustomer,
  findDeviceCandidates,
  insertCustomer,
  insertDevice,
  insertEvent,
  setCustomerTrial,
  type EventType,
  type Plan,
} from './db';

type Clock = () => number; // milliseconds
const systemClock: Clock = () => Date.now();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_BACKDATE_SECONDS = 90 * 24 * 3600; // an offline app may report late; older claims are clamped

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 'unknown'; // never trust X-Forwarded-For
}

async function limited(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return false;
  try {
    return !(await limiter.limit({ key })).success;
  } catch {
    return false; // a limiter failure must not become an outage
  }
}

function log(result: string, kid?: string, type?: string) {
  console.log(JSON.stringify({ svc: 'telemetry', result, kid, type })); // codes only, never identifiers
}

function optionalText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && !CONTROL_CHARACTERS.test(value) ? value.trim().slice(0, maxLength) || null : null;
}

/** Keyed fingerprint of the app's license hash (32 bytes). Same keying idea as the trial signals. */
async function licenseFingerprint(env: TrialEnv, clientHash: Uint8Array): Promise<string> {
  return b64urlEncode(await hmacSha256(env.PEPPER, concat(utf8('license|'), clientHash)));
}

export async function handleTelemetry(request: Request, env: TrialEnv, clock: Clock = systemClock): Promise<Response> {
  if (await limited(env.TELEMETRY_IP_LIMITER, clientIp(request))) return rateLimited();

  const open = await openRequest(request, 'telemetry', env);
  if (!open.ok) return open.response;
  const { opened } = open;
  const body = opened.body;
  const seal = (payload: unknown, result: string, type?: string) => {
    log(result, opened.kid, type);
    return sealResponse(opened, 'telemetry', payload);
  };

  // ---- validate (a genuine app never sends a malformed event, so these are plain 400s)
  const eventId = body.event_id;
  const customerUuid = body.customer_uuid;
  const type = body.type;
  const occurredClaim = body.occurred_at;
  const pubkeyBytes = b64urlDecode(body.pubkey);
  const sig = b64urlDecode(body.sig);
  if (
    body.proto !== PROTOCOL_VERSION ||
    typeof eventId !== 'string' ||
    !UUID.test(eventId) ||
    typeof customerUuid !== 'string' ||
    !UUID.test(customerUuid) ||
    typeof type !== 'string' ||
    !(EVENT_TYPES as readonly string[]).includes(type) ||
    typeof occurredClaim !== 'number' ||
    !Number.isSafeInteger(occurredClaim) ||
    occurredClaim < 0 ||
    !pubkeyBytes ||
    pubkeyBytes.length !== 32 ||
    !sig
  ) {
    return badRequest();
  }
  const eventType = type as EventType;

  let plan: Plan | null = null;
  if (body.plan !== undefined && body.plan !== null) {
    if (typeof body.plan !== 'string' || !(PLANS as readonly string[]).includes(body.plan)) return badRequest();
    plan = body.plan as Plan;
  }
  const licenseBytes = body.license === undefined || body.license === null ? null : b64urlDecode(body.license);
  const prevBytes = body.prev_license === undefined || body.prev_license === null ? null : b64urlDecode(body.prev_license);
  if ((body.license != null && licenseBytes?.length !== 32) || (body.prev_license != null && prevBytes?.length !== 32)) return badRequest();

  const needsLicense = eventType !== 'buy_clicked';
  if (needsLicense && !licenseBytes) return badRequest();
  if (eventType === 'license_key_changed' && !prevBytes) return badRequest();
  if (eventType === 'license_key_changed' && b64urlEncode(prevBytes!) === b64urlEncode(licenseBytes!)) return badRequest();
  if ((eventType === 'license_activated' || eventType === 'license_key_changed') && !plan) return badRequest();

  const trialId = body.trial_id === undefined || body.trial_id === null ? null : optionalText(body.trial_id, 64);
  if (body.trial_id != null && !trialId) return badRequest();

  const clientSignals = await parseClientSignals(body.signals ?? { guid: null, smbios: null, board: null });
  if (!clientSignals) return badRequest();

  // The signature covers every meaningful field, so a stored event is exactly what the app signed.
  const message = utf8(
    [
      'pinchpdf-telemetry-v1',
      eventId,
      customerUuid,
      eventType,
      occurredClaim,
      eventType === 'buy_clicked' ? '' : (plan ?? ''),
      eventType === 'buy_clicked' ? '' : (body.license as string),
      eventType === 'license_key_changed' ? (body.prev_license as string) : '',
    ].join('|'),
  );
  if (!(await ed25519Verify(pubkeyBytes, sig, message))) {
    log('bad_signature', opened.kid, eventType);
    return badRequest();
  }

  if (await limited(env.TELEMETRY_CUSTOMER_LIMITER, customerUuid)) return rateLimited();

  try {
    const db = env.TRIAL_DB;
    const now = Math.floor(clock() / 1000);
    const pubkey = b64urlEncode(pubkeyBytes);

    // Bind the install key on first sight; afterwards only that key may speak for this customer.
    let customer = await findCustomer(db, customerUuid);
    if (!customer) {
      await insertCustomer(db, customerUuid, pubkey, trialId, now);
      customer = await findCustomer(db, customerUuid);
    }
    if (!customer || customer.pubkey !== pubkey) {
      log('key_mismatch', opened.kid, eventType);
      return badRequest();
    }
    if (trialId && !customer.trial_id) await setCustomerTrial(db, customerUuid, trialId);

    // Resolve the machine with the trial's matching policy, creating it when unseen.
    let deviceId: string | null = null;
    if (Object.values(clientSignals).some(Boolean)) {
      const signals = await pepperSignals(env, clientSignals);
      const known = (await findDeviceCandidates(db, signals)).find((row) =>
        rowBlocks(signals, { guid: row.h_guid, smbios: row.h_smbios, board: row.h_board }),
      );
      if (known) deviceId = known.device_id;
      else {
        deviceId = newTrialId();
        await insertDevice(db, deviceId, signals, now);
      }
    }

    const occurredAt = Math.min(now, Math.max(now - MAX_BACKDATE_SECONDS, occurredClaim));
    await insertEvent(db, {
      eventId,
      customerUuid,
      type: eventType,
      plan: eventType === 'buy_clicked' ? null : plan,
      licenseFp: eventType === 'buy_clicked' ? null : await licenseFingerprint(env, licenseBytes!),
      prevLicenseFp: eventType === 'license_key_changed' ? await licenseFingerprint(env, prevBytes!) : null,
      deviceId,
      occurredAt,
      receivedAt: now,
      appVersion: optionalText(body.app_version, 32),
      osBuild: optionalText(body.os_build, 64),
    });
    return seal({ result: 'ok' }, 'ok', eventType);
  } catch (error) {
    console.error(JSON.stringify({ svc: 'telemetry', result: 'db_error', message: String((error as Error)?.message).slice(0, 120) }));
    return unavailable();
  }
}
