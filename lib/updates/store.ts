// Reads a product's release list from a public GitHub repository, validates it, and caches it.
//
//   list:       https://raw.githubusercontent.com/<RELEASES_REPO>/<branch>/<Product>/index.json
//   installers: https://github.com/<RELEASES_REPO>/releases/download/<Product>-v<version>/<file>
//
// Only those two GitHub hosts are ever contacted, built from a validated "owner/name", so the setting
// cannot point the Worker anywhere else. The cache keeps requests to about one per product per instance per
// CACHE_MS, and keeps the LAST GOOD list: if a later edit is unreadable or invalid as a whole, apps keep
// getting the previous answer instead of an outage. Individual bad entries are dropped by parseIndex and
// reported as problems. GitHub's own cache can add a few minutes after an edit.

import { b64urlDecode } from '../trial/bytes';
import type { RateLimiter } from '../trial/config';
import { parseIndex, type Product, type Release } from './releases';

export const CACHE_MS = 5 * 60_000;
export const MAX_INDEX_BYTES = 1_000_000;
export const FETCH_TIMEOUT_MS = 5_000;

export type UpdatesEnv = {
  TRIAL_DB?: D1Database;
  /** The public GitHub repository holding the release lists and installers, as "owner/name". */
  RELEASES_REPO?: string;
  /** Branch holding the lists. Default "main". */
  RELEASES_BRANCH?: string;
  /** The release key's public half, 32 bytes, base64url. Entries not signed by it are ignored. */
  RELEASE_PUBLIC_KEY?: string;
  UPDATES_IP_LIMITER?: RateLimiter;
};

const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type UpdatesConfig =
  | { ok: true; repo: string; rawBase: string; downloadBase: string; publicKey: Uint8Array }
  | { ok: false; missing: string[] };

export function updatesConfig(env: UpdatesEnv): UpdatesConfig {
  const missing: string[] = [];
  const repo = env.RELEASES_REPO?.trim() ?? '';
  if (!REPO.test(repo) || repo.includes('..')) missing.push('RELEASES_REPO (a public GitHub repository, owner/name)');
  const branch = env.RELEASES_BRANCH?.trim() || 'main';
  if (!BRANCH.test(branch) || branch.includes('..')) missing.push('RELEASES_BRANCH (a plain branch name)');
  const key = b64urlDecode(env.RELEASE_PUBLIC_KEY?.trim());
  if (!key || key.length !== 32) missing.push('RELEASE_PUBLIC_KEY (32 bytes, base64url)');
  if (missing.length > 0 || !key) return { ok: false, missing };
  return {
    ok: true,
    repo,
    rawBase: `https://raw.githubusercontent.com/${repo}/${branch}`,
    downloadBase: `https://github.com/${repo}/releases/download`,
    publicKey: key,
  };
}

export type Loaded = { releases: Release[]; problems: string[]; stale: boolean; at: number };
export type LoadResult = { ok: true; value: Loaded } | { ok: false; reason: string };

const cache = new Map<string, { value: Loaded; fetchedAt: number }>();

/** Test hook. */
export function resetReleaseCache() {
  cache.clear();
}

export async function loadReleases(config: Extract<UpdatesConfig, { ok: true }>, product: Product, now: number = Date.now()): Promise<LoadResult> {
  const hit = cache.get(`${config.repo}|${product}`);
  if (hit && now - hit.fetchedAt < CACHE_MS) return { ok: true, value: hit.value };

  let failure = '';
  const url = `${config.rawBase}/${product}/index.json`;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (response.status === 404) {
      failure = `${product}/index.json is not published yet in ${config.repo}`;
    } else if (!response.ok) {
      failure = `GitHub answered ${response.status} for ${product}/index.json`;
    } else {
      const text = await response.text();
      if (text.length > MAX_INDEX_BYTES) {
        failure = `index.json is larger than ${MAX_INDEX_BYTES} bytes`;
      } else {
        const parsed = await parseIndex(text, product, config.publicKey);
        // A file that is unusable as a whole (not JSON, wrong product, no list) must not replace a good list.
        const wholeFileBad = parsed.releases.length === 0 && parsed.problems.some((p) => p.startsWith('index.json'));
        if (!wholeFileBad) {
          const value: Loaded = { releases: parsed.releases, problems: parsed.problems, stale: false, at: now };
          cache.set(`${config.repo}|${product}`, { value, fetchedAt: now });
          return { ok: true, value };
        }
        failure = parsed.problems[0];
      }
    }
  } catch (error) {
    failure = `could not reach GitHub: ${String((error as Error)?.message ?? error).slice(0, 100)}`;
  }

  if (hit) {
    // Keep serving the last good list, and try again after another cache period.
    const value: Loaded = { ...hit.value, stale: true, problems: [...hit.value.problems.filter((p) => !p.startsWith('using the last good list')), `using the last good list: ${failure}`] };
    cache.set(`${config.repo}|${product}`, { value, fetchedAt: now });
    return { ok: true, value };
  }
  return { ok: false, reason: failure };
}
