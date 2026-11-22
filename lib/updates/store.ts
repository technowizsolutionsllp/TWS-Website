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
  /**
   * The release key's public half, 32 bytes, base64url. For key rotation, give several separated by commas
   * (at most MAX_RELEASE_KEYS): an entry signed by any of them is accepted. Entries signed by none are ignored.
   */
  RELEASE_PUBLIC_KEY?: string;
  UPDATES_IP_LIMITER?: RateLimiter;
};

const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;

/**
 * "owner/name". Neither part may be "." or ".." (a URL parser would collapse it into a different path), and a name
 * cannot end in ".git". The setting is the only thing that decides which GitHub path the Worker reads, so it is strict.
 */
export function isRepoName(repo: string): boolean {
  return REPO.test(repo) && !repo.includes('..') && repo.split('/').every((part) => part !== '.') && !repo.endsWith('.git');
}
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const MAX_RELEASE_KEYS = 4;

export type UpdatesConfig =
  | { ok: true; repo: string; rawBase: string; downloadBase: string; publicKeys: Uint8Array[] }
  | { ok: false; missing: string[] };

/** "key1,key2" -> the keys. All-or-nothing: one malformed, repeated or surplus key makes the setting invalid, so a typo can never silently drop a key. */
function parseKeys(setting: string | undefined): Uint8Array[] | null {
  const parts = (setting ?? '').split(',').map((p) => p.trim());
  if (parts.length === 0 || parts.length > MAX_RELEASE_KEYS || new Set(parts).size !== parts.length) return null;
  const keys: Uint8Array[] = [];
  for (const part of parts) {
    const key = b64urlDecode(part);
    if (!key || key.length !== 32) return null;
    keys.push(key);
  }
  return keys;
}

export function updatesConfig(env: UpdatesEnv): UpdatesConfig {
  const missing: string[] = [];
  const repo = env.RELEASES_REPO?.trim() ?? '';
  if (!isRepoName(repo)) missing.push('RELEASES_REPO (a public GitHub repository, owner/name)');
  const branch = env.RELEASES_BRANCH?.trim() || 'main';
  if (!BRANCH.test(branch) || branch.includes('..')) missing.push('RELEASES_BRANCH (a plain branch name)');
  const keys = parseKeys(env.RELEASE_PUBLIC_KEY);
  if (!keys) missing.push(`RELEASE_PUBLIC_KEY (one 32-byte base64url key, or up to ${MAX_RELEASE_KEYS} different ones separated by commas)`);
  if (missing.length > 0 || !keys) return { ok: false, missing };
  return {
    ok: true,
    repo,
    rawBase: `https://raw.githubusercontent.com/${repo}/${branch}`,
    downloadBase: `https://github.com/${repo}/releases/download`,
    publicKeys: keys,
  };
}

export type Loaded = { releases: Release[]; problems: string[]; stale: boolean; at: number };
export type LoadResult = { ok: true; value: Loaded } | { ok: false; reason: string };

type Cached = { value: Loaded; fetchedAt: number };
const cache = new Map<string, Cached>();
// One fetch per list at a time: when the cache expires, a burst of requests shares a single request to GitHub.
const inflight = new Map<string, Promise<LoadResult>>();

/** Test hook. */
export function resetReleaseCache() {
  cache.clear();
  inflight.clear();
}

/** The body as text, or null when it is larger than `max` bytes. Stops reading as soon as the limit is passed. */
async function readLimited(response: Response, max: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!response.body) {
    const whole = await response.text();
    return whole.length > max ? null : whole;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

export function loadReleases(config: Extract<UpdatesConfig, { ok: true }>, product: Product, now: number = Date.now()): Promise<LoadResult> {
  const key = `${config.repo}|${product}`;
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_MS) return Promise.resolve({ ok: true, value: hit.value });
  const running = inflight.get(key);
  if (running) return running;
  const started = refresh(config, product, now, key, hit).finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
}

async function refresh(config: Extract<UpdatesConfig, { ok: true }>, product: Product, now: number, key: string, hit: Cached | undefined): Promise<LoadResult> {
  let failure = '';
  const url = `${config.rawBase}/${product}/index.json`;
  try {
    // Cloudflare Workers support only "follow" and "manual" ('error' throws before any request is made), so redirects are
    // handled by hand: with "manual" a redirect comes back as an ordinary 3xx answer and is refused below, never followed.
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (response.status >= 300 && response.status < 400) {
      failure = `GitHub redirected ${product}/index.json (${response.status}); redirects are not followed`;
    } else if (response.status === 404) {
      failure = `${product}/index.json is not published yet in ${config.repo}`;
    } else if (!response.ok) {
      failure = `GitHub answered ${response.status} for ${product}/index.json`;
    } else {
      const text = await readLimited(response, MAX_INDEX_BYTES);
      if (text === null) {
        failure = `index.json is larger than ${MAX_INDEX_BYTES} bytes`;
      } else {
        const parsed = await parseIndex(text, product, config.publicKeys);
        // A file that is unusable as a whole (not JSON, wrong product, no list) must not replace a good list.
        // Neither must a list in which EVERY entry was rejected (for example after a wrong key edit): that is a
        // mistake to keep serving the last good answer through, not an intention to publish nothing.
        const wholeFileBad = parsed.releases.length === 0 && parsed.problems.some((p) => p.startsWith('index.json'));
        const everyEntryRejected = parsed.releases.length === 0 && parsed.problems.some((p) => p.startsWith('release #'));
        if (!wholeFileBad && !(everyEntryRejected && hit)) {
          const value: Loaded = { releases: parsed.releases, problems: parsed.problems, stale: false, at: now };
          cache.set(key, { value, fetchedAt: now });
          return { ok: true, value };
        }
        failure = wholeFileBad ? parsed.problems[0] : `no entry in ${product}/index.json is valid (${parsed.problems[0]})`;
      }
    }
  } catch (error) {
    failure = `could not reach GitHub: ${String((error as Error)?.message ?? error).slice(0, 100)}`;
  }

  if (hit) {
    // Keep serving the last good list, and try again after another cache period.
    const value: Loaded = { ...hit.value, stale: true, problems: [...hit.value.problems.filter((p) => !p.startsWith('using the last good list')), `using the last good list: ${failure}`] };
    cache.set(key, { value, fetchedAt: now });
    return { ok: true, value };
  }
  return { ok: false, reason: failure };
}
