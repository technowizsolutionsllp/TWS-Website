// GET /api/<product>/updates/v1/check?v=1.2.3&channel=stable&os=win11&arch=x64
//
// Plain (not sealed) and personal-data free: the request carries only the app version, channel, OS and
// architecture. No installation id, customer id or license is sent, so a check cannot be linked to
// telemetry. Staged rollout works without identifying anyone: the answer carries rollout_percent and
// the app compares it with a random number it keeps locally. See docs/RELEASES.md.

import type { RateLimiter } from '../trial/config';
import { HEALTH_HEADER, recordMetric } from '../trial/metrics';
import { plain, rateLimited } from '../trial/responses';
import { selectUpdate, type Channel, type Product } from './releases';
import { loadReleases, updatesConfig, type UpdatesEnv } from './store';
import { isVersion } from './version';

type Clock = () => number;
const systemClock: Clock = () => Date.now();

export const CACHE_SECONDS = 300;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,15}$/;

const CONFIG_LOG_INTERVAL_MS = 60_000;
let lastConfigLog = 0;

/** Test hook. */
export function resetUpdatesLog() {
  lastConfigLog = 0;
}

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

function tagged(response: Response, outcome: string): { response: Response; outcome: string } {
  return { response, outcome };
}

async function check(request: Request, env: UpdatesEnv, product: Product, clock: Clock): Promise<{ response: Response; outcome: string }> {
  if (await limited(env.UPDATES_IP_LIMITER, clientIp(request))) return tagged(rateLimited(), 'rate_limited');

  const url = new URL(request.url);
  const v = url.searchParams.get('v');
  const channel = url.searchParams.get('channel') ?? 'stable';
  const os = url.searchParams.get('os');
  const arch = url.searchParams.get('arch');
  if (!isVersion(v) || (channel !== 'stable' && channel !== 'beta') || (os !== null && !TOKEN.test(os)) || (arch !== null && !TOKEN.test(arch))) {
    return tagged(plain(400, { error: 'bad_request' }), 'bad_request');
  }

  const config = updatesConfig(env, product);
  if (!config.ok) {
    const now = clock();
    if (lastConfigLog === 0 || now - lastConfigLog >= CONFIG_LOG_INTERVAL_MS) {
      lastConfigLog = now;
      console.error(JSON.stringify({ svc: 'updates', result: 'unconfigured', missing: config.missing }));
    }
    return tagged(plain(503, { error: 'unconfigured' }, { 'Retry-After': '300' }), 'unconfigured');
  }

  const loaded = await loadReleases(config, product, clock());
  if (!loaded.ok) {
    console.error(JSON.stringify({ svc: 'updates', result: 'no_releases', product, reason: loaded.reason }));
    return tagged(plain(503, { error: 'unavailable' }, { 'Retry-After': '300' }), 'unavailable');
  }

  const offer = selectUpdate(loaded.value.releases, v, channel as Channel);
  const cacheHeaders = { 'Cache-Control': `public, max-age=${CACHE_SECONDS}`, 'X-Content-Type-Options': 'nosniff' };
  if (!offer.update) {
    return tagged(Response.json({ update_available: false, latest: offer.latest }, { headers: cacheHeaders }), 'current');
  }
  const r = offer.release;
  const body = {
    update_available: true,
    product,
    version: r.version,
    channel: r.channel,
    pub_date: r.pub_date,
    notes: r.notes,
    notes_url: r.notes_url,
    download: { url: `${config.downloadBase}/${r.file}`, sha256: r.sha256, size: r.size, signature: r.signature },
    // A paused release (rollout 0) is sent without min_supported: the app forces an install that is below it whatever the
    // rollout says, which would defeat the pause.
    min_supported: offer.rollout_percent === 0 ? null : r.min_supported,
    mandatory: offer.mandatory,
    rollout_percent: offer.rollout_percent,
  };
  return tagged(Response.json(body, { headers: cacheHeaders }), 'update_available');
}

export async function handleUpdateCheck(request: Request, env: UpdatesEnv, product: Product, clock: Clock = systemClock): Promise<Response> {
  const skip = request.headers.get(HEALTH_HEADER) === '1';
  let result: { response: Response; outcome: string };
  try {
    result = await check(request, env, product, clock);
  } catch (error) {
    console.error(JSON.stringify({ svc: 'updates', result: 'unhandled', message: String((error as Error)?.message).slice(0, 120) }));
    result = tagged(plain(503, { error: 'unavailable' }, { 'Retry-After': '300' }), 'unavailable');
  }
  if (!skip && env.TRIAL_DB) await recordMetric({ TRIAL_DB: env.TRIAL_DB }, 'update_check', result.outcome, clock(), product.toLowerCase());
  return result.response;
}
