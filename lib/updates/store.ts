// Reads a product's release list from R2 (releases/<Product>/index.json), validates it, and caches it.
//
// The cache keeps R2 reads to about one per product per instance per CACHE_MS, and keeps the LAST GOOD
// list: if a later upload is unreadable or invalid as a whole, apps keep getting the previous answer
// instead of an outage. Individual bad entries are dropped by parseIndex and reported as problems.

import { b64urlDecode } from '../trial/bytes';
import type { RateLimiter } from '../trial/config';
import { parseIndex, type Product, type Release } from './releases';

export const CACHE_MS = 5 * 60_000;
export const MAX_INDEX_BYTES = 1_000_000;

export type UpdatesEnv = {
  TRIAL_DB?: D1Database;
  /** R2 bucket holding releases/<Product>/... (read-only use). */
  RELEASES_BUCKET?: R2Bucket;
  /** Public https address that serves the bucket, no trailing slash needed. Installer URLs are built from it. */
  RELEASES_BASE_URL?: string;
  /** The release key's public half, 32 bytes, base64url. Entries not signed by it are ignored. */
  RELEASE_PUBLIC_KEY?: string;
  UPDATES_IP_LIMITER?: RateLimiter;
};

export type UpdatesConfig =
  | { ok: true; bucket: R2Bucket; baseUrl: string; publicKey: Uint8Array }
  | { ok: false; missing: string[] };

export function updatesConfig(env: UpdatesEnv): UpdatesConfig {
  const missing: string[] = [];
  if (!env.RELEASES_BUCKET) missing.push('RELEASES_BUCKET (R2 binding)');
  const base = env.RELEASES_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base || !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(base)) missing.push('RELEASES_BASE_URL (an https address)');
  const key = b64urlDecode(env.RELEASE_PUBLIC_KEY?.trim());
  if (!key || key.length !== 32) missing.push('RELEASE_PUBLIC_KEY (32 bytes, base64url)');
  if (missing.length > 0 || !env.RELEASES_BUCKET || !base || !key) return { ok: false, missing };
  return { ok: true, bucket: env.RELEASES_BUCKET, baseUrl: base, publicKey: key };
}

export type Loaded = { releases: Release[]; problems: string[]; stale: boolean; at: number };
export type LoadResult = { ok: true; value: Loaded } | { ok: false; reason: string };

const cache = new Map<string, { value: Loaded; fetchedAt: number }>();

/** Test hook. */
export function resetReleaseCache() {
  cache.clear();
}

export async function loadReleases(config: Extract<UpdatesConfig, { ok: true }>, product: Product, now: number = Date.now()): Promise<LoadResult> {
  const hit = cache.get(product);
  if (hit && now - hit.fetchedAt < CACHE_MS) return { ok: true, value: hit.value };

  let failure = '';
  try {
    const object = await config.bucket.get(`releases/${product}/index.json`);
    if (!object) {
      failure = `releases/${product}/index.json is not uploaded yet`;
    } else if (object.size > MAX_INDEX_BYTES) {
      failure = `index.json is larger than ${MAX_INDEX_BYTES} bytes`;
    } else {
      const parsed = await parseIndex(await object.text(), product, config.publicKey);
      // A file that is unusable as a whole (not JSON, wrong product, no list) must not replace a good list.
      const wholeFileBad = parsed.releases.length === 0 && parsed.problems.some((p) => p.startsWith('index.json'));
      if (!wholeFileBad) {
        const value: Loaded = { releases: parsed.releases, problems: parsed.problems, stale: false, at: now };
        cache.set(product, { value, fetchedAt: now });
        return { ok: true, value };
      }
      failure = parsed.problems[0];
    }
  } catch (error) {
    failure = `could not read the bucket: ${String((error as Error)?.message ?? error).slice(0, 100)}`;
  }

  if (hit) {
    // Keep serving the last good list, and try again after another cache period.
    const value: Loaded = { ...hit.value, stale: true, problems: [...hit.value.problems.filter((p) => !p.startsWith('using the last good list')), `using the last good list: ${failure}`] };
    cache.set(product, { value, fetchedAt: now });
    return { ok: true, value };
  }
  return { ok: false, reason: failure };
}
