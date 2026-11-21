// App update check: versions, the signed release list, which release is offered, the endpoint over a real
// (local) R2 bucket, caching and last-good fallback, counters, and the Health check.

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import vectors from './release-vectors.json';
import { runServerChecks, type HealthEnv } from '../lib/admin/health-checks';
import { b64urlDecode } from '../lib/trial/bytes';
import { FLUSH_INTERVAL_MS, HEALTH_HEADER } from '../lib/trial/metrics';
import { CACHE_SECONDS, handleUpdateCheck, resetUpdatesLog } from '../lib/updates/handler';
import { parseIndex, releaseMessage, selectUpdate, type Release } from '../lib/updates/releases';
import { CACHE_MS, resetReleaseCache, updatesConfig, type UpdatesEnv } from '../lib/updates/store';
import { compareVersions, parseVersion } from '../lib/updates/version';

const publicKey = b64urlDecode(vectors.public_key)!;
const ip = { 'cf-connecting-ip': '203.0.113.9' };
const T0 = 1_800_000_000_000;

const index = (product: 'PinchPDF' | 'NoDupe') => JSON.parse(JSON.stringify(vectors.indexes[product])) as { product: string; releases: Release[] };
const config = (over: Partial<UpdatesEnv> = {}): UpdatesEnv => ({
  RELEASES_BUCKET: env.RELEASES_BUCKET,
  RELEASES_BASE_URL: 'https://downloads.example.test',
  RELEASE_PUBLIC_KEY: vectors.public_key,
  TRIAL_DB: env.TRIAL_DB,
  ...over,
});
async function put(product: string, data: unknown) {
  await env.RELEASES_BUCKET.put(`releases/${product}/index.json`, typeof data === 'string' ? data : JSON.stringify(data));
}
const ask = (query: string, over: Partial<UpdatesEnv> = {}, product: 'PinchPDF' | 'NoDupe' = 'PinchPDF', clock = () => T0, headers: Record<string, string> = ip) =>
  handleUpdateCheck(new Request(`https://t.test/api/x/updates/v1/check${query}`, { headers }), config(over), product, clock);

beforeEach(async () => {
  resetReleaseCache();
  resetUpdatesLog();
  const listed = await env.RELEASES_BUCKET.list();
  for (const object of listed.objects) await env.RELEASES_BUCKET.delete(object.key);
});

describe('versions', () => {
  it('orders semantic versions, with pre-releases before their release', () => {
    const ordered = ['0.9.9', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.10.0', '2.0.0'];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      expect(compareVersions(ordered[i], ordered[i + 1]), `${ordered[i]} < ${ordered[i + 1]}`).toBeLessThan(0);
      expect(compareVersions(ordered[i + 1], ordered[i])).toBeGreaterThan(0);
    }
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0); // numeric, not text, order
  });

  it('rejects anything that is not a plain semantic version', () => {
    for (const bad of ['', '1', '1.2', '01.2.3', '1.2.3.4', 'v1.2.3', '1.2.3+build', '1.2.3-', '1.2.3-01', ' 1.2.3', '1.2.3\n', 'a.b.c', '1.2.3-beta..1', 'x'.repeat(65)]) {
      expect(parseVersion(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion('1.4.0-beta.1')).toMatchObject({ major: 1, minor: 4, patch: 0, pre: ['beta', '1'] });
  });
});

describe('the release list', () => {
  it('accepts the entries signed by the Node release tool (two implementations agree)', async () => {
    for (const product of ['PinchPDF', 'NoDupe'] as const) {
      const parsed = await parseIndex(JSON.stringify(vectors.indexes[product]), product, publicKey);
      expect(parsed.problems, product).toEqual([]);
      expect(parsed.releases.length).toBe(vectors.indexes[product].releases.length);
    }
    for (const [name, message] of Object.entries(vectors.messages)) {
      const entry = (vectors.entries as Record<string, Release>)[name];
      expect(releaseMessage(name.startsWith('nodupe') ? 'NoDupe' : 'PinchPDF', entry), name).toBe(message);
    }
  });

  const tamper = async (mutate: (data: { product: string; releases: Record<string, unknown>[] }) => void, product: 'PinchPDF' | 'NoDupe' = 'PinchPDF') => {
    const data = index(product) as unknown as { product: string; releases: Record<string, unknown>[] };
    mutate(data);
    return parseIndex(JSON.stringify(data), product, publicKey);
  };

  it('drops an entry whose signed facts were changed (hash, size, version, channel, file, product)', async () => {
    for (const change of [
      (r: Record<string, unknown>) => (r.sha256 = 'a'.repeat(64)),
      (r: Record<string, unknown>) => (r.size = 1),
      (r: Record<string, unknown>) => (r.signature = 'A'.repeat(86)),
      (r: Record<string, unknown>) => (r.signature = ''),
    ]) {
      const parsed = await tamper((d) => change(d.releases[1]));
      expect(parsed.releases.map((r) => r.version)).toEqual(['1.2.0', '1.4.0-beta.1']);
      expect(parsed.problems.join()).toMatch(/1\.3\.0.*(signature|sha256)/);
    }
    // A signature made for another product, channel or version does not carry over.
    const swapped = await tamper((d) => (d.releases[1].version = '1.9.9'));
    expect(swapped.releases.find((r) => r.version === '1.9.9')).toBeUndefined();
    const channel = await tamper((d) => (d.releases[0].channel = 'beta'));
    expect(channel.releases.find((r) => r.version === '1.2.0')).toBeUndefined();
  });

  it('does not accept entries signed by a different key', async () => {
    const other = new Uint8Array(32).fill(7);
    const parsed = await parseIndex(JSON.stringify(vectors.indexes.PinchPDF), 'PinchPDF', other);
    expect(parsed.releases).toEqual([]);
    expect(parsed.problems.length).toBe(3);
  });

  it('refuses a list for the wrong product, a list that is not JSON, and one without releases', async () => {
    expect((await parseIndex(JSON.stringify(vectors.indexes.NoDupe), 'PinchPDF', publicKey)).problems[0]).toMatch(/"NoDupe", not PinchPDF/);
    expect((await parseIndex('{nope', 'PinchPDF', publicKey)).problems[0]).toMatch(/not valid JSON/);
    expect((await parseIndex('[]', 'PinchPDF', publicKey)).problems[0]).toMatch(/must be an object/);
    expect((await parseIndex('{"product":"PinchPDF"}', 'PinchPDF', publicKey)).problems[0]).toMatch(/no "releases" list/);
  });

  it('checks the shape of every unsigned field too', async () => {
    const cases: [string, (r: Record<string, unknown>) => void, RegExp][] = [
      ['file outside its folder', (r) => (r.file = 'NoDupe/stable/1.2.0/x.exe'), /file must be/],
      ['file with a path trick', (r) => (r.file = 'PinchPDF/stable/1.2.0/../../x.exe'), /file must be/],
      ['file with a space', (r) => (r.file = 'PinchPDF/stable/1.2.0/a b.exe'), /file must be/],
      ['bad date', (r) => (r.pub_date = 'yesterday'), /pub_date/],
      ['no notes', (r) => (r.notes = []), /notes/],
      ['too many notes', (r) => (r.notes = Array.from({ length: 11 }, () => 'x')), /notes/],
      ['a long note', (r) => (r.notes = ['x'.repeat(201)]), /notes/],
      ['a control character in a note', (r) => (r.notes = ['a\u0007b']), /notes/],
      ['http notes link', (r) => (r.notes_url = 'http://x.test'), /notes_url/],
      ['rollout above 100', (r) => (r.rollout_percent = 101), /rollout/],
      ['fractional rollout', (r) => (r.rollout_percent = 5.5), /rollout/],
      ['text rollout', (r) => (r.rollout_percent = '5'), /rollout/],
      ['enabled as text', (r) => (r.enabled = 'yes'), /true or false/],
      ['bad min_supported', (r) => (r.min_supported = '1.x'), /min_supported/],
      ['upper-case hash is fine but short hash is not', (r) => (r.sha256 = 'abc'), /sha256/],
      ['zero size', (r) => (r.size = 0), /size/],
    ];
    for (const [name, mutate, expected] of cases) {
      const parsed = await tamper((d) => mutate(d.releases[1]));
      expect(parsed.releases.find((r) => r.version === '1.3.0'), name).toBeUndefined();
      expect(parsed.problems.join('\n'), name).toMatch(expected);
      expect(parsed.releases.length, `${name}: the other entries are kept`).toBe(2);
    }
  });

  it('refuses a stable release with a pre-release version and a version listed twice', async () => {
    const pre = await tamper((d) => (d.releases[0].version = '1.2.0-rc.1'));
    expect(pre.problems.join()).toMatch(/stable release cannot be a pre-release/);
    const twice = await tamper((d) => d.releases.push({ ...d.releases[1] }));
    expect(twice.problems.join()).toMatch(/listed twice/);
    expect(twice.releases.filter((r) => r.version === '1.3.0')).toHaveLength(1);
  });

  it('keeps unsigned operational settings out of the signature, so a release can be paused without the key', async () => {
    const parsed = await tamper((d) => Object.assign(d.releases[1], { enabled: false, rollout_percent: 0, mandatory: true, min_supported: '1.2.0', notes: ['Edited notes'] }));
    const entry = parsed.releases.find((r) => r.version === '1.3.0')!;
    expect(entry).toMatchObject({ enabled: false, rollout_percent: 0, mandatory: true, min_supported: '1.2.0', notes: ['Edited notes'] });
  });
});

describe('which release is offered', () => {
  const list = async () => (await parseIndex(JSON.stringify(vectors.indexes.PinchPDF), 'PinchPDF', publicKey)).releases;
  const withChange = async (version: string, change: Partial<Release>) => (await list()).map((r) => (r.version === version ? { ...r, ...change } : r));

  it('offers the newest stable release to a stable app, and the newest of stable and beta to a beta app', async () => {
    const releases = await list();
    expect(selectUpdate(releases, '1.2.0', 'stable')).toMatchObject({ update: true, release: { version: '1.3.0' } });
    expect(selectUpdate(releases, '1.2.0', 'beta')).toMatchObject({ update: true, release: { version: '1.4.0-beta.1' } });
    expect(selectUpdate(releases, '1.3.0', 'stable')).toEqual({ update: false, latest: '1.3.0' });
    expect(selectUpdate(releases, '1.4.0-beta.1', 'beta')).toEqual({ update: false, latest: '1.4.0-beta.1' });
  });

  it('says there is nothing newer for a build that is ahead of everything published', async () => {
    expect(selectUpdate(await list(), '9.0.0', 'stable')).toEqual({ update: false, latest: '1.3.0' });
    expect(selectUpdate([], '1.0.0', 'stable')).toEqual({ update: false, latest: null });
  });

  it('skips a withdrawn release and offers the one before it', async () => {
    const releases = await withChange('1.3.0', { enabled: false });
    expect(selectUpdate(releases, '1.0.0', 'stable')).toMatchObject({ update: true, release: { version: '1.2.0' } });
    expect(selectUpdate(releases, '1.2.0', 'stable')).toEqual({ update: false, latest: '1.2.0' });
  });

  it('passes the rollout percentage through, and a held release (0) is still the newest', async () => {
    expect(selectUpdate(await list(), '1.2.0', 'stable')).toMatchObject({ rollout_percent: 25, mandatory: false });
    const held = selectUpdate(await withChange('1.3.0', { rollout_percent: 0 }), '1.2.0', 'stable');
    expect(held).toMatchObject({ update: true, rollout_percent: 0 });
  });

  it('forces the update, ignoring the rollout, when the release is mandatory or the app is below min_supported', async () => {
    const mandatory = selectUpdate(await withChange('1.3.0', { mandatory: true }), '1.2.0', 'stable');
    expect(mandatory).toMatchObject({ mandatory: true, rollout_percent: 100 });
    const tooOld = selectUpdate(await list(), '1.0.5', 'stable'); // 1.3.0 requires at least 1.1.0
    expect(tooOld).toMatchObject({ mandatory: true, rollout_percent: 100 });
    const supported = selectUpdate(await list(), '1.1.0', 'stable');
    expect(supported).toMatchObject({ mandatory: false, rollout_percent: 25 });
  });
});

describe('GET /updates/v1/check', () => {
  it('is 503 "unconfigured" until the bucket, the base URL and the key are set, and names what is missing in the log only', async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: unknown) => lines.push(String(line));
    try {
      const response = await ask('?v=1.0.0', { RELEASES_BUCKET: undefined, RELEASES_BASE_URL: undefined, RELEASE_PUBLIC_KEY: undefined });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'unconfigured' });
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(lines.join()).toContain('RELEASES_BUCKET');
      await ask('?v=1.0.0', { RELEASE_PUBLIC_KEY: 'short' });
      expect(updatesConfig(config({ RELEASES_BASE_URL: 'http://insecure.test' })).ok).toBe(false);
      expect(updatesConfig(config({ RELEASE_PUBLIC_KEY: 'A'.repeat(43) })).ok).toBe(true); // 32 bytes of valid base64url
    } finally {
      console.error = original;
    }
  });

  it('is 503 "unavailable" when no list has been uploaded, and never leaks internals', async () => {
    const response = await ask('?v=1.0.0');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
  });

  it('answers 400 for a missing or malformed version, channel, os or arch', async () => {
    await put('PinchPDF', index('PinchPDF'));
    for (const query of ['', '?v=', '?v=1.2', '?v=1.2.3-', '?v=1.2.3&channel=nightly', '?v=1.2.3&channel=STABLE', '?v=1.2.3&os=win%2011', '?v=1.2.3&arch=' + 'x'.repeat(17), '?v=1.2.3&os=%3Cb%3E']) {
      const response = await ask(query);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toEqual({ error: 'bad_request' });
    }
  });

  it('offers an update with the notes, a download link under the base URL, and what the app must verify', async () => {
    await put('PinchPDF', index('PinchPDF'));
    const response = await ask('?v=1.2.0&os=win11&arch=x64');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      update_available: true,
      product: 'PinchPDF',
      version: '1.3.0',
      channel: 'stable',
      pub_date: '2026-12-01T00:00:00Z',
      notes: ['Faster compression on large files', 'Fixed a crash on encrypted PDFs'],
      notes_url: 'https://technowizsolutions.com/pinchpdf/release-notes',
      download: {
        url: 'https://downloads.example.test/releases/PinchPDF/stable/1.3.0/PinchPDF-1.3.0-x64.exe',
        sha256: vectors.entries.pinchpdf_1_3_0.sha256,
        size: vectors.entries.pinchpdf_1_3_0.size,
        signature: vectors.entries.pinchpdf_1_3_0.signature,
      },
      min_supported: '1.1.0',
      mandatory: false,
      rollout_percent: 25,
    });
    expect(response.headers.get('cache-control')).toBe(`public, max-age=${CACHE_SECONDS}`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('says "current" when there is nothing newer, still with the latest version', async () => {
    await put('PinchPDF', index('PinchPDF'));
    const response = await ask('?v=1.3.0');
    expect(await response.json()).toEqual({ update_available: false, latest: '1.3.0' });
  });

  it('serves each product from its own folder', async () => {
    await put('PinchPDF', index('PinchPDF'));
    await put('NoDupe', index('NoDupe'));
    expect(((await (await ask('?v=1.0.0', {}, 'NoDupe')).json()) as { version: string }).version).toBe('2.0.0');
    expect(((await (await ask('?v=1.0.0', {}, 'PinchPDF')).json()) as { version: string }).version).toBe('1.3.0');
    // A list uploaded to the wrong product's folder is not used for it.
    await put('PinchPDF', index('NoDupe'));
    resetReleaseCache();
    expect((await ask('?v=1.0.0', {}, 'PinchPDF')).status).toBe(503);
  });

  it('uses the beta channel only when asked', async () => {
    await put('PinchPDF', index('PinchPDF'));
    expect(((await (await ask('?v=1.2.0&channel=beta')).json()) as { version: string }).version).toBe('1.4.0-beta.1');
    expect(((await (await ask('?v=1.2.0&channel=stable')).json()) as { version: string }).version).toBe('1.3.0');
  });

  it('is rate limited per IP (a limiter failure does not stop answers)', async () => {
    await put('PinchPDF', index('PinchPDF'));
    const blocked = await ask('?v=1.2.0', { UPDATES_IP_LIMITER: { limit: async () => ({ success: false }) } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    const broken = await ask('?v=1.2.0', { UPDATES_IP_LIMITER: { limit: async () => { throw new Error('down'); } } });
    expect(broken.status).toBe(200);
  });

  it('keys the limiter on the connecting IP only, never on X-Forwarded-For', async () => {
    await put('PinchPDF', index('PinchPDF'));
    const keys: string[] = [];
    const limiter = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true }; } };
    await ask('?v=1.2.0', { UPDATES_IP_LIMITER: limiter }, 'PinchPDF', () => T0, { 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '6.6.6.6' });
    expect(keys).toEqual(['198.51.100.4']);
  });

  it('reads R2 once per cache period and picks up a new upload after it', async () => {
    await put('PinchPDF', { ...index('PinchPDF'), releases: index('PinchPDF').releases.slice(0, 1) }); // only 1.2.0
    expect(((await (await ask('?v=1.0.0', {}, 'PinchPDF', () => T0)).json()) as { version: string }).version).toBe('1.2.0');
    await put('PinchPDF', index('PinchPDF')); // now 1.3.0 too
    expect(((await (await ask('?v=1.0.0', {}, 'PinchPDF', () => T0 + CACHE_MS - 1)).json()) as { version: string }).version).toBe('1.2.0');
    expect(((await (await ask('?v=1.0.0', {}, 'PinchPDF', () => T0 + CACHE_MS + 1)).json()) as { version: string }).version).toBe('1.3.0');
  });

  it('keeps serving the last good list when a later upload is broken, and recovers when it is fixed', async () => {
    await put('PinchPDF', index('PinchPDF'));
    expect((await ask('?v=1.2.0', {}, 'PinchPDF', () => T0)).status).toBe(200);
    await put('PinchPDF', '{ this is not json');
    const later = T0 + CACHE_MS + 1;
    const stale = await ask('?v=1.2.0', {}, 'PinchPDF', () => later);
    expect(stale.status).toBe(200);
    expect(((await stale.json()) as { version: string }).version).toBe('1.3.0');
    await put('PinchPDF', index('NoDupe')); // wrong product also counts as broken
    expect((await ask('?v=1.2.0', {}, 'PinchPDF', () => later + CACHE_MS + 1)).status).toBe(200);
    await put('PinchPDF', { ...index('PinchPDF'), releases: index('PinchPDF').releases.slice(0, 1) });
    expect(((await (await ask('?v=1.0.0', {}, 'PinchPDF', () => later + 3 * CACHE_MS)).json()) as { version: string }).version).toBe('1.2.0');
  });

  it('serves a good list even when some entries are bad (they are dropped)', async () => {
    const data = index('PinchPDF');
    data.releases[1].sha256 = 'f'.repeat(64);
    await put('PinchPDF', data);
    expect(((await (await ask('?v=1.0.0')).json()) as { version: string }).version).toBe('1.2.0');
  });

  it('counts requests by outcome per product, without storing anything about the caller, and skips health probes', async () => {
    await put('PinchPDF', index('PinchPDF'));
    await put('NoDupe', index('NoDupe'));
    let now = 1_000_000; // counters are written in batches at most every FLUSH_INTERVAL_MS
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const tick = () => { now += FLUSH_INTERVAL_MS; };
    await ask('?v=1.2.0'); tick(); // update_available
    await ask('?v=1.3.0'); tick(); // current
    await ask('?v=bad'); tick(); // bad_request
    await ask('?v=1.0.0', {}, 'NoDupe'); tick();
    await ask('?v=1.2.0', {}, 'PinchPDF', () => T0, { ...ip, [HEALTH_HEADER]: '1' }); tick(); // not counted
    await ask('?v=1.2.0'); tick(); // flushes the pending counts
    const rows = (await env.TRIAL_DB.prepare("SELECT product, endpoint, outcome, count FROM metrics_daily WHERE endpoint = 'update_check' ORDER BY product, outcome").all()).results;
    expect(rows).toEqual([
      { product: 'nodupe', endpoint: 'update_check', outcome: 'update_available', count: 1 },
      { product: 'pinchpdf', endpoint: 'update_check', outcome: 'bad_request', count: 1 },
      { product: 'pinchpdf', endpoint: 'update_check', outcome: 'current', count: 1 },
      { product: 'pinchpdf', endpoint: 'update_check', outcome: 'update_available', count: 2 }, // the 4th request and the one that flushed
    ]);
    vi.restoreAllMocks();
    const columns = (await env.TRIAL_DB.prepare("SELECT name FROM pragma_table_info('metrics_daily')").all<{ name: string }>()).results.map((c) => c.name);
    expect(columns).toEqual(['day', 'product', 'endpoint', 'outcome', 'count']); // no ip, version or user columns
  });

  it('never reflects the query back in an answer', async () => {
    await put('PinchPDF', index('PinchPDF'));
    const response = await ask('?v=1.2.0&os=SENTINEL-os&arch=SENTINEL-arch');
    expect(await response.text()).not.toContain('SENTINEL');
  });
});

describe('Health check for updates', () => {
  const healthy = (over: Partial<UpdatesEnv> = {}) =>
    ({ ...(env as unknown as Record<string, unknown>), ...config(over), ADMIN_USER: 'ops', ADMIN_PASSWORD: 'correct horse battery', DOCS_USER: 'd', DOCS_PASSWORD: 'long-enough-pass', RESEND_API_KEY: 'k', CONTACT_FROM_EMAIL: 'c@example.com' }) as unknown as HealthEnv;
  const releasesCheck = async (over: Partial<UpdatesEnv> = {}) => (await runServerChecks(healthy(over))).find((c) => c.id === 'releases')!;

  it('warns, naming what is missing, until updates are set up', async () => {
    const check = await releasesCheck({ RELEASES_BUCKET: undefined, RELEASES_BASE_URL: undefined, RELEASE_PUBLIC_KEY: undefined });
    expect(check.status).toBe('warn');
    for (const name of ['RELEASES_BUCKET', 'RELEASES_BASE_URL', 'RELEASE_PUBLIC_KEY']) expect(check.detail).toContain(name);
  });

  it('warns when a list is not uploaded, and is ok with valid lists', async () => {
    expect((await releasesCheck()).detail).toContain('not uploaded yet');
    await put('PinchPDF', index('PinchPDF'));
    await put('NoDupe', index('NoDupe'));
    const check = await releasesCheck();
    expect(check.status).toBe('ok');
    expect(check.detail).toContain('PinchPDF: 3 valid release(s), 3 enabled');
    expect(check.detail).toContain('NoDupe: 1 valid release(s), 1 enabled');
  });

  it('warns and names the entry when a release in the list is invalid', async () => {
    const data = index('PinchPDF');
    data.releases[1].sha256 = 'f'.repeat(64);
    await put('PinchPDF', data);
    await put('NoDupe', index('NoDupe'));
    const check = await releasesCheck();
    expect(check.status).toBe('warn');
    expect(check.detail).toMatch(/1\.3\.0.*signature/);
  });
});
