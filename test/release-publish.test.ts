// The release publishing scripts, run against an in-memory stand-in for GitHub: the order of the steps, the safety
// checks (public repository, may write, tag free, version newer, file checked after upload), conflicts, dry runs,
// and the rollout / pause / withdraw changes. The signed list the script produces is read back with the Worker's own parser.

import { beforeEach, describe, expect, it } from 'vitest';
import vectors from './release-vectors.json';
import { b64urlDecode } from '../lib/trial/bytes';
import { parseIndex } from '../lib/updates/releases';
import { compareVersions as siteCompare } from '../lib/updates/version';
import {
  checkNewer,
  compareVersions,
  parseFlags,
  publishRelease,
  updateEntry,
  updateRelease,
  type GhResult,
  type PublishOptions,
  type ReleaseIndex,
  type ReleaseIo,
} from '../scripts/release-publish-lib.mjs';
import { buildEntry, mergeIndex } from '../scripts/release-lib.mjs';

const REPO = 'test-org/app-releases';
const seed = vectors.signing_seed_test_only;
const publicKey = b64urlDecode(vectors.public_key)!;
const text = (s: string) => new TextEncoder().encode(s);
const ok = (stdout = ''): GhResult => ({ status: 0, stdout, stderr: '' });
const notFound = (): GhResult => ({ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });

type Fake = ReturnType<typeof fake>;
function fake(over: { isPrivate?: boolean; canPush?: boolean } = {}) {
  const s = {
    calls: [] as string[],
    log: [] as string[],
    files: new Map<string, Uint8Array>([['PinchPDF-1.3.0-x64.exe', text('installer bytes 1.3.0')]]),
    written: new Map<string, string>(),
    lists: new Map<string, { text: string; sha: string }>(),
    releases: new Map<string, { args: string[] }>(),
    downloads: new Map<string, Uint8Array>(),
    isPrivate: over.isPrivate ?? false,
    canPush: over.canPush ?? true,
    shaCounter: 1,
    conflicts: 0, // the next N list writes fail as if someone else had just changed the list
    onConflict: undefined as undefined | (() => void),
    tamperDownload: false,
    downloadStatus: 200,
    answer: true,
  };
  const listPath = (product: string) => `${product}/index.json`;
  const io: ReleaseIo = {
    log: (line) => void s.log.push(line),
    readFile: async (path) => {
      const bytes = s.files.get(path);
      if (!bytes) throw new Error(`no such file ${path}`);
      return bytes;
    },
    writeFile: async (path, content) => void s.written.set(path, content),
    sha256: async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map((b) => b.toString(16).padStart(2, '0')).join(''),
    sleep: async () => undefined,
    fetchBytes: async (url) => {
      const bytes = s.downloads.get(url);
      return bytes && s.downloadStatus === 200 ? { status: 200, bytes: s.tamperDownload ? text('something else') : bytes } : { status: s.downloadStatus === 200 ? 404 : s.downloadStatus, bytes: new Uint8Array() };
    },
    fetchJson: async () => ({ status: 200, json: null }),
    confirm: async () => s.answer,
    gh: async (args) => {
      s.calls.push(args.slice(0, 3).join(' '));
      if (args[0] === 'api' && args[1] === `repos/${REPO}`) return ok(JSON.stringify({ private: s.isPrivate, permissions: { push: s.canPush } }));
      const tag = args[1]?.match(/releases\/tags\/(.+)$/)?.[1];
      if (tag) return s.releases.has(tag) ? ok('{}') : notFound();
      const contents = args[1]?.match(/contents\/([^?]+)/)?.[1];
      if (contents && args[2] !== '-X' && args[0] === 'api' && args[1] !== undefined && !args.includes('PUT')) {
        const hit = s.lists.get(contents);
        return hit ? ok(JSON.stringify({ sha: hit.sha, content: Buffer.from(hit.text).toString('base64') })) : notFound();
      }
      if (args.includes('PUT')) {
        const path = args[3].match(/contents\/(.+)$/)![1];
        const field = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
        if (s.conflicts > 0) {
          s.conflicts -= 1;
          s.onConflict?.();
          return { status: 1, stdout: '', stderr: 'gh: sha does not match (HTTP 409)' };
        }
        const current = s.lists.get(path);
        if (current && field('sha') !== current.sha) return { status: 1, stdout: '', stderr: 'gh: sha does not match (HTTP 409)' };
        if (!current && field('sha') !== undefined) return { status: 1, stdout: '', stderr: 'gh: unexpected sha (HTTP 422)' };
        s.shaCounter += 1;
        s.lists.set(path, { text: Buffer.from(field('content')!, 'base64').toString('utf8'), sha: `sha${s.shaCounter}` });
        s.calls.push(`PUT ${path}`);
        return ok('{}');
      }
      if (args[0] === 'release' && args[1] === 'create') {
        s.releases.set(args[2], { args });
        const file = args[3].split(/[\\/]/).pop()!;
        s.downloads.set(`https://github.com/${REPO}/releases/download/${args[2]}/${file}`, s.files.get(args[3])!);
        return ok('https://github.com/x');
      }
      return { status: 1, stdout: '', stderr: `unexpected gh call ${args.join(' ')}` };
    },
  };
  const seedList = (product: string, index: ReleaseIndex) => void s.lists.set(listPath(product), { text: `${JSON.stringify(index)}\n`, sha: 'sha1' });
  const list = (product: string) => JSON.parse(s.lists.get(listPath(product))!.text) as ReleaseIndex;
  return { s, io, seedList, list };
}

const base = (over: Partial<PublishOptions> = {}): PublishOptions => ({
  product: 'PinchPDF',
  version: '1.3.0',
  installer: 'PinchPDF-1.3.0-x64.exe',
  channel: 'stable',
  notes: ['Faster compression', 'Fixed a crash'],
  rollout: 5,
  repo: REPO,
  seed,
  yes: true,
  site: null,
  pubDate: '2026-12-01T00:00:00Z',
  ...over,
});

const old120 = () => buildEntry({ product: 'PinchPDF', channel: 'stable', version: '1.2.0', fileName: 'PinchPDF-1.2.0-x64.exe', bytes: text('old'), notes: ['First release'], seed, pubDate: '2026-10-01T00:00:00Z' });
const emptyList = (): ReleaseIndex => ({ product: 'PinchPDF', releases: [] });

let gh: Fake;
beforeEach(() => {
  gh = fake();
  gh.seedList('PinchPDF', emptyList());
});

describe('publishing a release', () => {
  it('creates the GitHub release with the installer first, then publishes a list the website accepts', async () => {
    gh.seedList('PinchPDF', mergeIndex(emptyList(), 'PinchPDF', old120()));
    const result = await publishRelease(base(), gh.io);
    expect(result).toMatchObject({ tag: 'PinchPDF-v1.3.0', published: true });

    const order = gh.s.calls.filter((c) => c.startsWith('release create') || c.startsWith('PUT '));
    expect(order).toEqual(['release create PinchPDF-v1.3.0', 'PUT PinchPDF/index.json']); // the list is last

    const create = gh.s.releases.get('PinchPDF-v1.3.0')!.args;
    expect(create).toContain('PinchPDF-1.3.0-x64.exe'); // the installer is attached
    expect(create.some((a) => a.endsWith('release.json'))).toBe(true);
    expect(create).toContain('--latest=false');
    expect(create).not.toContain('--prerelease');
    expect(create[create.indexOf('--notes') + 1]).toBe('- Faster compression\n- Fixed a crash');

    // The list now holds both releases, and every entry verifies with the Worker's own parser and the test key.
    const parsed = await parseIndex(JSON.stringify(gh.list('PinchPDF')), 'PinchPDF', publicKey);
    expect(parsed.problems).toEqual([]);
    expect(parsed.releases.map((r) => r.version)).toEqual(['1.2.0', '1.3.0']);
    expect(parsed.releases[1]).toMatchObject({ rollout_percent: 5, file: 'PinchPDF-v1.3.0/PinchPDF-1.3.0-x64.exe', enabled: true });
    expect([...gh.s.written.keys()].sort()).toEqual(['release-out/PinchPDF-v1.3.0/release.json', 'release-out/PinchPDF/index.json']);
  });

  it('marks a beta release as a pre-release', async () => {
    gh.s.files.set('PinchPDF-1.4.0-beta.1-x64.exe', text('beta bytes'));
    await publishRelease(base({ version: '1.4.0-beta.1', channel: 'beta', installer: 'PinchPDF-1.4.0-beta.1-x64.exe' }), gh.io);
    expect(gh.s.releases.get('PinchPDF-v1.4.0-beta.1')!.args).toContain('--prerelease');
  });

  it('creates the list when none exists yet', async () => {
    gh.s.lists.clear();
    expect((await publishRelease(base(), gh.io)).published).toBe(true);
    expect(gh.list('PinchPDF').releases.map((r) => r.version)).toEqual(['1.3.0']);
  });

  it('does nothing on a dry run, or when the person does not confirm', async () => {
    expect((await publishRelease(base({ dryRun: true }), gh.io)).published).toBe(false);
    expect((await publishRelease(base({ yes: false }), Object.assign(gh.io, { confirm: async () => false }))).published).toBe(false);
    expect(gh.s.releases.size).toBe(0);
    expect(gh.s.calls.some((c) => c.startsWith('PUT'))).toBe(false);
    expect(gh.list('PinchPDF').releases).toEqual([]);
    expect(gh.s.log.join('\n')).toMatch(/Dry run: nothing was published/);
  });

  it('refuses before touching anything: private repository, no write access, a tag that exists, a missing key, bad input', async () => {
    const cases: [string, () => Promise<unknown>, RegExp][] = [
      ['private repository', () => publishRelease(base(), fake({ isPrivate: true }).io), /not public/],
      ['no write access', () => publishRelease(base(), fake({ canPush: false }).io), /cannot write/],
      ['no seed', () => publishRelease(base({ seed: undefined }), gh.io), /seed is missing/],
      ['unknown product', () => publishRelease(base({ product: 'pinchpdf' }), gh.io), /product must be one of/],
      ['bad repository', () => publishRelease(base({ repo: 'owner/..' }), gh.io), /owner\/name/],
      ['bad branch', () => publishRelease(base({ branch: 'a/../b' }), gh.io), /branch/],
      ['stable with a pre-release version', () => publishRelease(base({ version: '1.3.0-rc.1' }), gh.io), /stable release cannot/],
      ['missing installer', () => publishRelease(base({ installer: 'nope.exe' }), gh.io), /no such file/],
    ];
    for (const [name, run, pattern] of cases) await expect(run(), name).rejects.toThrow(pattern);
    expect(gh.s.releases.size).toBe(0);
    expect(gh.s.calls.some((c) => c.startsWith('PUT'))).toBe(false);

    gh.s.releases.set('PinchPDF-v1.3.0', { args: [] });
    await expect(publishRelease(base(), gh.io)).rejects.toThrow(/already exists/);
  });

  it('refuses a version that is listed, or not newer than the channel\'s latest, unless told otherwise', async () => {
    gh.seedList('PinchPDF', mergeIndex(mergeIndex(emptyList(), 'PinchPDF', old120()), 'PinchPDF', buildEntry({ product: 'PinchPDF', channel: 'stable', version: '1.3.0', fileName: 'PinchPDF-1.3.0-x64.exe', bytes: text('x'), notes: ['n'], seed })));
    await expect(publishRelease(base(), gh.io)).rejects.toThrow(/already in the list/);
    gh.s.files.set('PinchPDF-1.2.5-x64.exe', text('hotfix'));
    await expect(publishRelease(base({ version: '1.2.5', installer: 'PinchPDF-1.2.5-x64.exe' }), gh.io)).rejects.toThrow(/not newer than 1\.3\.0/);
    expect(gh.s.releases.size).toBe(0);
    expect((await publishRelease(base({ version: '1.2.5', installer: 'PinchPDF-1.2.5-x64.exe', allowOlder: true }), gh.io)).published).toBe(true);
  });

  it('compares versions only inside the channel (a stable fix may follow a newer beta)', () => {
    const index = { product: 'PinchPDF', releases: [old120(), buildEntry({ product: 'PinchPDF', channel: 'beta', version: '1.4.0-beta.1', fileName: 'b.exe', bytes: text('b'), notes: ['n'], seed })] };
    const stable = buildEntry({ product: 'PinchPDF', channel: 'stable', version: '1.3.1', fileName: 'a.exe', bytes: text('a'), notes: ['n'], seed });
    expect(() => checkNewer(index, stable)).not.toThrow();
    expect(() => checkNewer(index, { ...stable, version: '1.1.0' })).toThrow(/not newer/);
  });

  it('never publishes the list when the downloaded file is not the one that was signed, or cannot be downloaded', async () => {
    gh.s.tamperDownload = true;
    await expect(publishRelease(base(), gh.io)).rejects.toThrow(/does not match the installer you signed/);
    expect(gh.s.calls.some((c) => c.startsWith('PUT'))).toBe(false);
    expect(gh.list('PinchPDF').releases).toEqual([]);

    const other = fake();
    other.seedList('PinchPDF', emptyList());
    other.s.downloadStatus = 404;
    await expect(publishRelease(base(), other.io)).rejects.toThrow(/did not answer 200/);
    expect(other.s.calls.some((c) => c.startsWith('PUT'))).toBe(false);
  });

  it('retries on top of the other person\'s change when the list moved meanwhile, and keeps both', async () => {
    gh.s.conflicts = 1;
    gh.s.onConflict = () => gh.seedList('PinchPDF', mergeIndex(emptyList(), 'PinchPDF', old120())); // someone else published 1.2.0 meanwhile
    expect((await publishRelease(base(), gh.io)).published).toBe(true);
    expect(gh.list('PinchPDF').releases.map((r) => r.version)).toEqual(['1.2.0', '1.3.0']);
    expect(gh.s.log.join('\n')).toMatch(/retrying/);
  });

  it('says exactly what to do when the list cannot be published after the release was created', async () => {
    gh.s.conflicts = 99;
    await expect(publishRelease(base(), gh.io)).rejects.toThrow(/release PinchPDF-v1\.3\.0 IS created, but the list was not published/);
    expect(gh.s.releases.has('PinchPDF-v1.3.0')).toBe(true);
  });
});

describe('changing a published release', () => {
  const listed = async (rollout = 5) => {
    const entry = old120();
    gh.seedList('PinchPDF', mergeIndex(emptyList(), 'PinchPDF', { ...entry, rollout_percent: rollout }));
    return entry;
  };
  const run = (changes: Parameters<typeof updateRelease>[0]['changes'], over: { dryRun?: boolean; yes?: boolean } = {}) =>
    updateRelease({ product: 'PinchPDF', version: '1.2.0', changes, repo: REPO, yes: true, ...over }, gh.io);

  it('raises the rollout, pauses, withdraws and re-enables, and never touches what was signed', async () => {
    const signed = await listed();
    await run({ rollout: 25 });
    expect(gh.list('PinchPDF').releases[0].rollout_percent).toBe(25);
    await run({ rollout: 0 });
    expect(gh.list('PinchPDF').releases[0].rollout_percent).toBe(0);
    await run({ enabled: false });
    expect(gh.list('PinchPDF').releases[0].enabled).toBe(false);
    await run({ enabled: true, mandatory: true, minSupported: '1.0.0', notes: ['A new line'] });
    const after = gh.list('PinchPDF').releases[0];
    expect(after).toMatchObject({ enabled: true, mandatory: true, min_supported: '1.0.0', notes: ['A new line'] });
    for (const field of ['version', 'channel', 'file', 'sha256', 'size', 'signature'] as const) expect(after[field], field).toBe(signed[field]);
    // The website's parser still accepts it: the signature was not disturbed.
    expect((await parseIndex(JSON.stringify(gh.list('PinchPDF')), 'PinchPDF', publicKey)).problems).toEqual([]);
  });

  it('shows a dry run and cancels on "no", without writing', async () => {
    await listed();
    gh.s.calls.length = 0;
    await run({ rollout: 50 }, { dryRun: true });
    await updateRelease({ product: 'PinchPDF', version: '1.2.0', changes: { rollout: 50 }, repo: REPO, yes: false }, Object.assign(gh.io, { confirm: async () => false }));
    expect(gh.s.calls.some((c) => c.startsWith('PUT'))).toBe(false);
    expect(gh.list('PinchPDF').releases[0].rollout_percent).toBe(5);
  });

  it('rejects an unknown version, an unchanged setting and invalid values', async () => {
    await listed();
    await expect(updateRelease({ product: 'PinchPDF', version: '9.9.9', changes: { rollout: 5 }, repo: REPO, yes: true }, gh.io)).rejects.toThrow(/not in the list/);
    await expect(run({ rollout: 5 })).rejects.toThrow(/nothing to change/);
    for (const bad of [{ rollout: 101 }, { rollout: -1 }, { rollout: 2.5 }, { minSupported: 'x' }, { notes: [] }, { notesUrl: 'http://x' }]) {
      expect(() => updateEntry(gh.list('PinchPDF'), '1.2.0', bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('refuses a repository that is private or one it cannot write to', async () => {
    await expect(updateRelease({ product: 'PinchPDF', version: '1.2.0', changes: { rollout: 9 }, repo: REPO, yes: true }, fake({ canPush: false }).io)).rejects.toThrow(/cannot write/);
  });
});

describe('command line flags and versions', () => {
  const spec = { values: ['--notes', '--rollout'], booleans: ['--dry-run'] };
  it('rejects unknown flags, a missing value and a value on a switch, so a typo never publishes at 100%', () => {
    expect(parseFlags(['1.3.0', 'a.exe', '--rollout', '5', '--dry-run', '--notes=a|b'], spec)).toEqual({ positional: ['1.3.0', 'a.exe'], flags: { '--rollout': '5', '--dry-run': true, '--notes': 'a|b' } });
    expect(() => parseFlags(['--rollut', '5'], spec)).toThrow(/unknown option --rollut/);
    expect(() => parseFlags(['--rollout'], spec)).toThrow(/needs a value/);
    expect(() => parseFlags(['--rollout', '--dry-run'], spec)).toThrow(/needs a value/);
    expect(() => parseFlags(['--dry-run=yes'], spec)).toThrow(/does not take a value/);
  });

  it('orders versions exactly as the website does', () => {
    const versions = ['0.9.9', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.10.0', '2.0.0'];
    for (const a of versions) for (const b of versions) expect(compareVersions(a, b), `${a} vs ${b}`).toBe(Math.sign(siteCompare(a, b)));
    expect(() => compareVersions('1.2', '1.2.3')).toThrow(/not a semantic version/);
  });
});
