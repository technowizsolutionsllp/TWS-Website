// POST <product base>/telemetry: one sealed app event.
//   PinchPDF: /api/pinchpdf/trial/v1/telemetry     NoDupe: /api/nodupe/trial/v1/telemetry
//
// Same sealed envelope as /register and /usage. The app signs each event with its install key; the key
// is bound to customer_uuid on first sight, so nobody else can add events to that customer. Everything
// identifying a license or a machine is a keyed hash. No name or email is accepted or stored.
//
// Events: buy_clicked, license_activated, license_deactivated, license_key_changed, install, uninstall.
//
// Signed message (UTF-8), fields joined by "|", absent optional fields as the empty string:
//   <prefix>-telemetry-v1|event_id|customer_uuid|type|occurred_at|plan|license|prev_license
// where <prefix> is "pinchpdf" or "nodupe". install and uninstall are anonymous like buy_clicked (plan, license
// and prev_license empty; any device signals, trial id, plan or license sent with them are ignored and not
// stored) and carry one more field: |install_kind, which is new, upgrade or reinstall for install and empty for
// uninstall. The same handler serves both products; each one's events go to its own database.

import { b64urlDecode, b64urlEncode, concat, newTrialId, utf8 } from '../trial/bytes';
import { PROTOCOL_VERSION, type RateLimiter, type TrialEnv } from '../trial/config';
import { ed25519Verify, hmacSha256 } from '../trial/crypto';
import { openRequest, sealResponse } from '../trial/envelope';
import { rowBlocks } from '../trial/matching';
import { HEALTH_HEADER, outcomeOf, recordMetric, tagOutcome } from '../trial/metrics';
import { PINCHPDF, limitKey, productDb, type ProductSpec } from '../trial/product';
import { badRequest, rateLimited, unavailable } from '../trial/responses';
import { parseClientSignals, pepperSignals } from '../trial/signals';
import {
  EVENT_TYPES,
  INSTALL_KINDS,
  PLANS,
  findCustomer,
  findDeviceCandidates,
  insertCustomer,
  insertDevice,
  insertEvent,
  setCustomerTrial,
  type EventType,
  type InstallKind,
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

function log(result: string, kid: string | undefined, type: string | undefined, product: ProductSpec) {
  console.log(JSON.stringify({ svc: 'telemetry', ...(product === PINCHPDF ? {} : { product: product.id }), result, kid, type })); // codes only, never identifiers
}

function optionalText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && !CONTROL_CHARACTERS.test(value) ? value.trim().slice(0, maxLength) || null : null;
}

/** Keyed fingerprint of the app's license hash (32 bytes). Same keying idea as the trial signals. */
async function licenseFingerprint(env: TrialEnv, clientHash: Uint8Array): Promise<string> {
  return b64urlEncode(await hmacSha256(env.PEPPER, concat(utf8('license|'), clientHash)));
}

async function telemetryInner(request: Request, env: TrialEnv, clock: Clock, product: ProductSpec): Promise<Response> {
  if (await limited(env.TELEMETRY_IP_LIMITER, limitKey(product, clientIp(request)))) return rateLimited();

  const open = await openRequest(request, 'telemetry', env, product);
  if (!open.ok) return open.response;
  const { opened } = open;
  const body = opened.body;
  const seal = async (payload: unknown, result: string, type?: string) => {
    log(result, opened.kid, type, product);
    return tagOutcome(await sealResponse(opened, 'telemetry', payload), result);
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

  // install and uninstall come from the installer and carry no license or device: they are anonymous like buy_clicked.
  const installerEvent = eventType === 'install' || eventType === 'uninstall';
  const anonymous = eventType === 'buy_clicked' || installerEvent;

  let installKind: InstallKind | null = null;
  if (eventType === 'install') {
    if (typeof body.install_kind !== 'string' || !(INSTALL_KINDS as readonly string[]).includes(body.install_kind)) return badRequest();
    installKind = body.install_kind as InstallKind;
  } else if (body.install_kind !== undefined && body.install_kind !== null && body.install_kind !== '') {
    return badRequest(); // install_kind belongs to install events only
  }

  let plan: Plan | null = null;
  if (!installerEvent && body.plan !== undefined && body.plan !== null) {
    if (typeof body.plan !== 'string' || !(PLANS as readonly string[]).includes(body.plan)) return badRequest();
    plan = body.plan as Plan;
  }
  const licenseBytes = installerEvent || body.license === undefined || body.license === null ? null : b64urlDecode(body.license);
  const prevBytes = installerEvent || body.prev_license === undefined || body.prev_license === null ? null : b64urlDecode(body.prev_license);
  if (!installerEvent && ((body.license != null && licenseBytes?.length !== 32) || (body.prev_license != null && prevBytes?.length !== 32))) return badRequest();

  const needsLicense = !anonymous;
  if (needsLicense && !licenseBytes) return badRequest();
  if (eventType === 'license_key_changed' && !prevBytes) return badRequest();
  if (eventType === 'license_key_changed' && b64urlEncode(prevBytes!) === b64urlEncode(licenseBytes!)) return badRequest();
  if ((eventType === 'license_activated' || eventType === 'license_key_changed') && !plan) return badRequest();

  const trialId = installerEvent || body.trial_id === undefined || body.trial_id === null ? null : optionalText(body.trial_id, 64);
  if (!installerEvent && body.trial_id != null && !trialId) return badRequest();

  const clientSignals = installerEvent ? { guid: null, smbios: null, board: null } : await parseClientSignals(body.signals ?? { guid: null, smbios: null, board: null }, product);
  if (!clientSignals) return badRequest();

  // The signature covers every meaningful field, so a stored event is exactly what the app signed.
  const message = utf8(
    [
      `${product.prefix}-telemetry-v1`,
      eventId,
      customerUuid,
      eventType,
      occurredClaim,
      anonymous ? '' : (plan ?? ''),
      anonymous ? '' : (body.license as string),
      eventType === 'license_key_changed' ? (body.prev_license as string) : '',
      ...(installerEvent ? [installKind ?? ''] : []),
    ].join('|'),
  );
  if (!(await ed25519Verify(pubkeyBytes, sig, message))) {
    log('bad_signature', opened.kid, eventType, product);
    return tagOutcome(badRequest(), 'bad_signature');
  }

  if (await limited(env.TELEMETRY_CUSTOMER_LIMITER, limitKey(product, customerUuid))) return rateLimited();

  try {
    const db = productDb(env, product);
    if (!db) throw new Error(`${product.dbBinding} is not bound`);
    const now = Math.floor(clock() / 1000);
    const pubkey = b64urlEncode(pubkeyBytes);

    // Bind the install key on first sight; afterwards only that key may speak for this customer.
    let customer = await findCustomer(db, customerUuid);
    if (!customer) {
      await insertCustomer(db, customerUuid, pubkey, trialId, now);
      customer = await findCustomer(db, customerUuid);
    }
    if (!customer || customer.pubkey !== pubkey) {
      log('key_mismatch', opened.kid, eventType, product);
      return tagOutcome(badRequest(), 'key_mismatch');
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
      plan: anonymous ? null : plan,
      licenseFp: anonymous ? null : await licenseFingerprint(env, licenseBytes!),
      prevLicenseFp: eventType === 'license_key_changed' ? await licenseFingerprint(env, prevBytes!) : null,
      deviceId,
      installKind,
      occurredAt,
      receivedAt: now,
      appVersion: optionalText(body.app_version, 32),
      osBuild: optionalText(body.os_build, 64),
    });
    return seal({ result: 'ok' }, 'ok', eventType);
  } catch (error) {
    console.error(JSON.stringify({ svc: 'telemetry', product: product.id, result: 'db_error', message: String((error as Error)?.message).slice(0, 120) }));
    return tagOutcome(unavailable(), 'db_error');
  }
}

/** Counts the request for the admin Insights charts (never throws, skips the health page's own probes). */
export async function handleTelemetry(request: Request, env: TrialEnv, clock: Clock = systemClock, product: ProductSpec = PINCHPDF): Promise<Response> {
  const skip = request.headers.get(HEALTH_HEADER) === '1';
  let response: Response;
  try {
    response = await telemetryInner(request, env, clock, product);
  } catch (error) {
    if (!skip) await recordMetric(env, 'telemetry', 'error', clock(), product.id);
    throw error;
  }
  if (!skip) await recordMetric(env, 'telemetry', outcomeOf(response), clock(), product.id);
  return response;
}
