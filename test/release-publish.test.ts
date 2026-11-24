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
  DEFAULT_ROLLOUT,
  pageFromArgs,
  parseFlags,
  publishFromArgs,
  publishRelease,
  refreshPage,
  pagesUrl,
  renderDownloadsHtml,
  renderDownloadsPage,
  updateEntry,
  updateFromArgs,
  updateRelease,
  type GhResult,
  type PublishOptions,
  type ReleaseIndex,
  type ReleaseIo,
} from '../scripts/release-publish-lib.mjs';
import { buildEntry, crc32, mergeIndex, zipSingle } from '../scripts/release-lib.mjs';
import { classifyInstallers, guidedPublish, guidedUpdate, installerLocation, isGuidedPublish, isGuidedUpdate, notesProblem, parseReleaseNotes } from '../scripts/release-guided.mjs';

const REPO = 'technowizsolutionsllp/app-releases_PinchPDF'; // PinchPDF's default repository, so command-line tests need no --repo
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
    written: new Map<string, string | Uint8Array>(),
    lists: new Map<string, { text: string; sha: string }>(),
    releases: new Map<string, { args: string[]; draft: boolean; assets: Map<string, Uint8Array> }>(),
    downloads: new Map<string, Uint8Array>(),
    isPrivate: over.isPrivate ?? false,
    canPush: over.canPush ?? true,
    shaCounter: 1,
    conflicts: 0, // the next N list writes fail as if someone else had just changed the list
    onConflict: undefined as undefined | (() => void),
    tamperDraft: false, // the file stored in the draft is not the one that was signed
    tamperPublic: false, // the public download is not the one that was signed
    tamperZipDraft: false, // the zip stored in the draft is not the one that was made
    tamperZipPublic: false, // the public zip is not the one that was made
    downloadStatus: 200, // what the public download answers (anything but 200 means it is not served)
    answer: true,
    failPut: new Set<string>(), // list paths whose write GitHub refuses
  };
  const listPath = (product: string) => `${product}/index.json`;
  const io: ReleaseIo = {
    log: (line) => void s.log.push(line),
    readFile: async (path) => {
      const bytes = s.files.get(path);
      if (!bytes) throw new Error(`no such file ${path}`);
      return bytes;
    },
    writeFile: async (path, content) => {
      s.written.set(path, content);
      if (typeof content !== 'string') s.files.set(path, content);
    },
    sha256: async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map((b) => b.toString(16).padStart(2, '0')).join(''),
    sleep: async () => undefined,
    fetchBytes: async (url) => {
      const bytes = s.downloads.get(url);
      return bytes && s.downloadStatus === 200 ? { status: 200, bytes: (url.endsWith('.zip') ? s.tamperZipPublic : s.tamperPublic) ? text('something else') : bytes } : { status: s.downloadStatus === 200 ? 404 : s.downloadStatus, bytes: new Uint8Array() };
    },
    fetchJson: async () => ({ status: 200, json: null }),
    confirm: async () => s.answer,
    gh: async (args) => {
      if (args[0] === 'api' && args[1] === `repos/${REPO}`) return ok(JSON.stringify({ private: s.isPrivate, permissions: { push: s.canPush } }));
      const tag = args[1]?.match(/releases\/tags\/(.+)$/)?.[1];
      if (tag) return s.releases.get(tag)?.draft === false ? ok('{}') : notFound(); // a draft has no public tag yet
      const contents = args[1]?.match(/contents\/([^?]+)/)?.[1];
      if (contents && args[2] !== '-X' && args[0] === 'api' && args[1] !== undefined && !args.includes('PUT')) {
        const hit = s.lists.get(contents);
        return hit ? ok(JSON.stringify({ sha: hit.sha, content: Buffer.from(hit.text).toString('base64') })) : notFound();
      }
      if (args.includes('PUT')) {
        const path = args[3].match(/contents\/(.+)$/)![1];
        const field = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
        if (s.failPut.has(path)) return { status: 1, stdout: '', stderr: 'gh: server error (HTTP 500)' };
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
        const assets = new Map<string, Uint8Array>();
        for (const arg of args.slice(3)) {
          if (arg.startsWith('--')) break;
          const bytes = s.files.get(arg);
          if (bytes) assets.set(arg.split(/[\/]/).pop()!, bytes);
        }
        s.releases.set(args[2], { args, draft: args.includes('--draft'), assets });
        s.calls.push(`release create ${args[2]}`);
        return ok('https://github.com/x');
      }
      if (args[0] === 'release' && args[1] === 'download') {
        const release = s.releases.get(args[2]);
        if (!release) return notFound();
        s.calls.push(`release download ${args[2]}`);
        const dir = args[args.indexOf('--dir') + 1];
        const pattern = args[args.indexOf('--pattern') + 1];
        const asset = release.assets.get(pattern);
        if (!asset) return notFound();
        const tampered = pattern.endsWith('.zip') ? s.tamperZipDraft : s.tamperDraft;
        s.files.set(`${dir}/${pattern}`, tampered ? text('something else') : asset);
        return ok();
      }
      if (args[0] === 'release' && args[1] === 'edit') {
        const release = s.releases.get(args[2]);
        if (!release) return notFound();
        if (!args.includes('--draft=false')) return { status: 1, stdout: '', stderr: 'unexpected edit' };
        release.draft = false;
        for (const [name, bytes] of release.assets) s.downloads.set(`https://github.com/${REPO}/releases/download/${args[2]}/${name}`, bytes);
        s.calls.push(`release edit ${args[2]}`);
        return ok();
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

    // Draft with the installer, checked, published, and only then the list: the list is last.
    const order = gh.s.calls.filter((c) => c.startsWith('release ') || c.startsWith('PUT '));
    expect(order).toEqual(['release create PinchPDF-v1.3.0', 'release download PinchPDF-v1.3.0', 'release download PinchPDF-v1.3.0', 'release edit PinchPDF-v1.3.0', 'PUT PinchPDF/index.json', 'PUT PinchPDF/README.md', 'PUT PinchPDF/index.html']);

    const create = gh.s.releases.get('PinchPDF-v1.3.0')!.args;
    expect(create).toContain('PinchPDF-1.3.0-x64.exe'); // the installer is attached
    expect(create.some((a) => a.endsWith('release.json'))).toBe(true);
    expect(create).toContain('--latest=false');
    expect(create).toContain('--draft'); // assets go on a draft, so immutable releases accept them
    expect(create).not.toContain('--prerelease');
    expect(create[create.indexOf('--notes') + 1]).toBe('- Faster compression\n- Fixed a crash');

    // The list now holds both releases, and every entry verifies with the Worker's own parser and the test key.
    const parsed = await parseIndex(JSON.stringify(gh.list('PinchPDF')), 'PinchPDF', publicKey);
    expect(parsed.problems).toEqual([]);
    expect(parsed.releases.map((r) => r.version)).toEqual(['1.2.0', '1.3.0']);
    expect(parsed.releases[1]).toMatchObject({ rollout_percent: 5, file: 'PinchPDF-v1.3.0/PinchPDF-1.3.0-x64.exe', enabled: true });
    expect([...gh.s.written.keys()].filter((k) => !k.endsWith('.keep')).sort()).toEqual(['release-out/PinchPDF-v1.3.0/PinchPDF-1.3.0-x64.zip', 'release-out/PinchPDF-v1.3.0/release.json', 'release-out/PinchPDF/index.json']);
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
      ['repository part is a dot', () => publishRelease(base({ repo: 'owner/.' }), gh.io), /owner\/name/],
      ['repository ends in .git', () => publishRelease(base({ repo: 'owner/app.git' }), gh.io), /owner\/name/],
      ['bad branch', () => publishRelease(base({ branch: 'a/../b' }), gh.io), /branch/],
      ['stable with a pre-release version', () => publishRelease(base({ version: '1.3.0-rc.1' }), gh.io), /stable release cannot/],
      ['missing installer', () => publishRelease(base({ installer: 'nope.exe' }), gh.io), /no such file/],
    ];
    for (const [name, run, pattern] of cases) await expect(run(), name).rejects.toThrow(pattern);
    expect(gh.s.releases.size).toBe(0);
    expect(gh.s.calls.some((c) => c.startsWith('PUT'))).toBe(false);

    gh.s.releases.set('PinchPDF-v1.3.0', { args: [], draft: false, assets: new Map() });
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
    // A wrong file in the DRAFT stops everything before the release is even made public.
    gh.s.tamperDraft = true;
    await expect(publishRelease(base(), gh.io)).rejects.toThrow(/stored in the draft .* does not match the one you signed/);
    expect(gh.s.calls.some((c) => c.startsWith('release edit') || c.startsWith('PUT'))).toBe(false);
    expect(gh.s.releases.get('PinchPDF-v1.3.0')!.draft).toBe(true);
    expect(gh.list('PinchPDF').releases).toEqual([]);

    // A wrong file served PUBLICLY after publishing still keeps the list unpublished.
    const wrongPublic = fake();
    wrongPublic.seedList('PinchPDF', emptyList());
    wrongPublic.s.tamperPublic = true;
    await expect(publishRelease(base(), wrongPublic.io)).rejects.toThrow(/does not match the installer you signed/);
    expect(wrongPublic.s.calls.some((c) => c.startsWith('PUT'))).toBe(false);

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
    await expect(publishRelease(base(), gh.io)).rejects.toThrow(/release PinchPDF-v1\.3\.0 IS published, but the list was not published/);
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

  it('refuses a release notes link outside the company site when publishing or changing (the app would refuse the whole update)', async () => {
    await expect(publishRelease(base({ notesUrl: 'https://github.com/technowizsolutionsllp/notes' }), gh.io)).rejects.toThrow(/on technowizsolutions\.com/);
    expect(gh.s.releases.size).toBe(0);
    expect((await publishRelease(base({ notesUrl: 'https://technowizsolutions.com/pinchpdf/release-notes', dryRun: true }), gh.io)).published).toBe(false);
    await listed();
    for (const bad of ['https://github.com/x', 'http://technowizsolutions.com/x', 'https://technowizsolutions.com.evil.test/x']) {
      expect(() => updateEntry(gh.list('PinchPDF'), '1.2.0', { notesUrl: bad }), bad).toThrow(/technowizsolutions\.com/);
    }
    expect(updateEntry(gh.list('PinchPDF'), '1.2.0', { notesUrl: 'https://technowizsolutions.com/pinchpdf/release-notes' }).changed).toEqual(['notes_url']);
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

describe('publishing from command line arguments', () => {
  const INSTALLER = 'src-tauri/target/release/bundle/setup/PinchPDF_1.3.0_x64-setup.exe';
  const options = {
    defaults: { version: '1.3.0', installer: (v: string) => `src-tauri/target/release/bundle/setup/PinchPDF_${v}_x64-setup.exe` },
    updateCommand: 'npm run release:update --',
    buildHint: 'Build it first.',
  };
  const asked: string[] = [];
  const deps = (g: Fake, typed: string = seed) => ({ makeIo: () => g.io, exists: (path: string) => g.s.files.has(path), askSecret: async (question: string) => (asked.push(question), typed) });
  beforeEach(() => gh.s.files.set(INSTALLER, text('setup bytes')));

  it('uses the package version and the build output when no version or file is given, and starts at the default 5% rollout', async () => {
    const result = await publishFromArgs(['--notes', 'Faster|Fixed a crash', '--yes', '--no-site-check'], 'PinchPDF', options, deps(gh));
    expect(result).toMatchObject({ tag: 'PinchPDF-v1.3.0', published: true });
    expect(result.entry).toMatchObject({ rollout_percent: DEFAULT_ROLLOUT, file: 'PinchPDF-v1.3.0/PinchPDF_1.3.0_x64-setup.exe', notes: ['Faster', 'Fixed a crash'] });
    expect(DEFAULT_ROLLOUT).toBe(5);
    expect(gh.s.log.join('\n')).toContain('npm run release:update -- 1.3.0 --rollout 25');
  });

  it('refuses a version that is not the package version (the installer carries the package version)', async () => {
    gh.s.files.set('other.exe', text('x'));
    await expect(publishFromArgs(['9.9.9', 'other.exe', '--notes', 'x', '--yes'], 'PinchPDF', options, deps(gh))).rejects.toThrow(/not the version in package\.json \(1\.3\.0\)/);
    expect(gh.s.releases.size).toBe(0);
  });

  it('says what to do when the installer is missing, and when the arguments are wrong', async () => {
    gh.s.files.delete(INSTALLER);
    await expect(publishFromArgs(['--notes', 'x'], 'PinchPDF', options, deps(gh))).rejects.toThrow(/does not exist\. Build it first\./);
    gh.s.files.set(INSTALLER, text('x'));
    await expect(publishFromArgs(['1.3.0', '--notes', 'x'], 'PinchPDF', options, deps(gh))).rejects.toThrow(/Usage/); // one positional is ambiguous
    await expect(publishFromArgs([], 'PinchPDF', options, deps(gh))).rejects.toThrow(/Add --notes/);
    await expect(publishFromArgs(['--notes', 'x', '--rollut', '5'], 'PinchPDF', options, deps(gh))).rejects.toThrow(/unknown option --rollut/);
    await expect(publishFromArgs(['--notes', 'x', '--rollout', 'lots', '--dry-run'], 'PinchPDF', options, deps(gh))).rejects.toThrow(/rollout must be a whole number/);
    await expect(publishFromArgs(['--notes', 'x', '--dry-run'], 'PinchPDF', options, deps(gh, ''))).rejects.toThrow(/seed is missing/);
    expect(gh.s.releases.size).toBe(0);
  });

  it('asks for the signing seed once, even for a dry run, and never takes it from a file or the environment', async () => {
    asked.length = 0;
    await publishFromArgs(['--notes', 'x', '--dry-run'], 'PinchPDF', options, deps(gh));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/Signing seed/);
    // the old ways are refused outright, before anything is asked or touched
    asked.length = 0;
    for (const argv of [['--notes', 'x', '--key-file', 'seed.txt'], ['--notes', 'x', '--key-file=seed.txt']]) {
      await expect(publishFromArgs(argv, 'PinchPDF', options, deps(gh))).rejects.toThrow(/--key-file does not exist any more/);
    }
    expect(asked).toHaveLength(0);
    // a seed in the environment is ignored: with nothing typed the publish stops
    process.env.RELEASE_SIGNING_KEY = seed;
    try {
      await expect(publishFromArgs(['--notes', 'x', '--dry-run'], 'PinchPDF', options, deps(gh, ''))).rejects.toThrow(/seed is missing/);
    } finally {
      delete process.env.RELEASE_SIGNING_KEY;
    }
    expect(gh.s.releases.size).toBe(0);
  });

  it('without defaults (the website repository) the version and installer are required', async () => {
    await expect(publishFromArgs(['--notes', 'x'], 'PinchPDF', undefined, deps(gh))).rejects.toThrow(/Usage: <version> <installer\.exe>/);
  });

  it('says plainly that a mandatory release forces everyone, whatever the rollout, and that a pause still holds it', async () => {
    await publishFromArgs(['--notes', 'x', '--mandatory', '--rollout', '5', '--dry-run'], 'PinchPDF', options, deps(gh));
    const summary = gh.s.log.join('\n');
    expect(summary).toMatch(/MANDATORY: every app is forced to update at once.*--pause still holds it/);
    expect(summary).not.toMatch(/rollout\s+5%/);
    await publishFromArgs(['--notes', 'x', '--min-supported', '1.1.0', '--dry-run'], 'PinchPDF', options, deps(gh));
    expect(gh.s.log.join('\n')).toMatch(/apps below it are forced to update at once/);
  });

  it('reads the change flags for update, refuses contradictory ones, and needs at least one change', async () => {
    gh.seedList('PinchPDF', mergeIndex(emptyList(), 'PinchPDF', { ...old120(), rollout_percent: 5 }));
    const run = (argv: string[]) => updateFromArgs(argv, 'PinchPDF', deps(gh));
    await expect(run(['1.2.0'])).rejects.toThrow(/Nothing to change/);
    await expect(run([])).rejects.toThrow(/Usage/);
    await expect(run(['1.2.0', '--pause', '--rollout', '10'])).rejects.toThrow(/either --pause or --rollout/);
    await expect(run(['1.2.0', '--withdraw', '--enable'])).rejects.toThrow(/either --withdraw or --enable/);
    await expect(run(['1.2.0', '--mandatory', '--not-mandatory'])).rejects.toThrow(/either --mandatory or --not-mandatory/);
    await expect(run(['1.2.0', '--min-supported', '1.0.0', '--clear-min-supported'])).rejects.toThrow(/either --min-supported or --clear-min-supported/);
    await run(['1.2.0', '--pause', '--yes']);
    expect(gh.list('PinchPDF').releases[0].rollout_percent).toBe(0);
    await run(['1.2.0', '--rollout', '40', '--mandatory', '--min-supported', '1.0.0', '--yes']);
    expect(gh.list('PinchPDF').releases[0]).toMatchObject({ rollout_percent: 40, mandatory: true, min_supported: '1.0.0' });
    await run(['1.2.0', '--clear-min-supported', '--not-mandatory', '--withdraw', '--yes']);
    expect(gh.list('PinchPDF').releases[0]).toMatchObject({ min_supported: null, mandatory: false, enabled: false });
  });
});

describe('the public downloads page (<Product>/README.md)', () => {
  const REAL = 'technowizsolutionsllp/app-releases_PinchPDF';
  const stable = (version: string, over: Record<string, unknown> = {}) => ({ ...buildEntry({ product: 'PinchPDF', channel: (over.channel as string | undefined) ?? 'stable', version, fileName: `PinchPDF_${version}_x64-setup.exe`, bytes: text(`bytes ${version}`), notes: [`Note for ${version}`], seed, pubDate: '2026-12-01T00:00:00Z' }), ...over });
  const list = (...entries: unknown[]) => ({ product: 'PinchPDF', releases: entries }) as unknown as ReleaseIndex;

  it('lists the current version with its real download link, size and hash, newest first, with what changed', () => {
    const page = renderDownloadsPage('PinchPDF', list(stable('1.2.0'), stable('1.3.0', { size: 11_807_150 })), REAL);
    expect(page).toContain('# PinchPDF downloads');
    expect(page).toContain('**Current version: 1.3.0** (released 2026-12-01)');
    expect(page).toContain(`https://github.com/${REAL}/releases/download/PinchPDF-v1.3.0/PinchPDF_1.3.0_x64-setup.exe`);
    expect(page).toContain('11.3 MB');
    expect(page).toMatch(/SHA-256: `[0-9a-f]{64}`/);
    expect(page.indexOf('| 1.3.0 |')).toBeLessThan(page.indexOf('| 1.2.0 |')); // newest first
    expect(page).toContain('### 1.3.0\n\n- Note for 1.3.0');
    expect(page).toContain('Get-FileHash');
    expect(page.startsWith('<!-- Generated by the release scripts')).toBe(true);
  });

  it('shows a newer beta separately, and does not list withdrawn or paused releases', () => {
    const beta = stable('1.4.0-beta.1', { channel: 'beta' });
    const page = renderDownloadsPage('PinchPDF', list(stable('1.2.0'), stable('1.3.0'), beta, stable('1.3.1', { enabled: false }), stable('1.3.2', { rollout_percent: 0 })), REAL);
    expect(page).toContain('**Newest beta (for testers): 1.4.0-beta.1**');
    expect(page).toContain('### 1.4.0-beta.1 (beta)');
    expect(page).toContain('**Current version: 1.3.0**'); // not the withdrawn 1.3.1 or the paused 1.3.2
    expect(page).not.toContain('1.3.1');
    expect(page).not.toContain('1.3.2');
  });

  it('says so when nothing is published, and escapes anything that could be read as markup', () => {
    expect(renderDownloadsPage('NoDupe', list(), REAL)).toContain('No release has been published yet.');
    const page = renderDownloadsPage('PinchPDF', list(stable('1.3.0', { notes: ['<script>alert(1)</script> and [a link](https://evil.test) | pipe', 'Use *stars* and `ticks`'] })), REAL);
    expect(page).not.toContain('<script>');
    expect(page).not.toContain('[a link](https://evil.test)');
    expect(page).toContain('\\<script\\>');
    expect(renderDownloadsPage('PinchPDF', list(stable('1.3.0')), REAL)).toBe(renderDownloadsPage('PinchPDF', list(stable('1.3.0')), REAL)); // deterministic
  });

  it('is written by publish (after the list), and a failure to write it never fails the publish', async () => {
    const result = await publishRelease(base(), gh.io);
    expect(result.published).toBe(true);
    const page = gh.s.lists.get('PinchPDF/README.md')!.text;
    expect(page).toContain('**Current version: 1.3.0**');
    expect(page).toContain(`https://github.com/${REPO}/releases/download/PinchPDF-v1.3.0/`);

    const broken = fake();
    broken.seedList('PinchPDF', emptyList());
    broken.s.failPut.add('PinchPDF/README.md');
    const again = await publishRelease(base(), broken.io);
    expect(again.published).toBe(true); // the release and the list are what matter
    expect(broken.s.log.join('\n')).toMatch(/Warning: the release and the list are published, but the downloads page for PinchPDF could not be updated \(PinchPDF\/README\.md.*release-page\.mjs PinchPDF/);
  });

  it('has a web page too (GitHub Pages): the same facts as static HTML, newest first, with nothing from the list left unescaped', () => {
    const beta = stable('1.4.0-beta.1', { channel: 'beta' });
    const html = renderDownloadsHtml('PinchPDF', list(stable('1.2.0'), stable('1.3.0', { size: 11_807_150, notes: ['<script>alert(1)</script> & "quotes"', 'Plain line'] }), beta, stable('1.3.1', { enabled: false }), stable('1.3.2', { rollout_percent: 0 })), REAL);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<title>PinchPDF downloads</title>');
    expect(html).toContain(`<a class="button" href="https://github.com/${REAL}/releases/download/PinchPDF-v1.3.0/PinchPDF_1.3.0_x64-setup.exe">Download PinchPDF_1.3.0_x64-setup.exe</a>`);
    expect(html).toContain('11.3 MB');
    expect(html).toContain('Newest beta (for testers): 1.4.0-beta.1');
    expect(html.indexOf('<td>1.3.0</td>')).toBeLessThan(html.indexOf('<td>1.2.0</td>')); // newest first
    expect(html).not.toContain('1.3.1');
    expect(html).not.toContain('1.3.2');
    // Nothing from the list can add markup or script.
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(renderDownloadsHtml('PinchPDF', list(stable('1.3.0')), REAL)).toBe(renderDownloadsHtml('PinchPDF', list(stable('1.3.0')), REAL));
    expect(renderDownloadsHtml('NoDupe', list(), REAL)).toContain('<p>No release has been published yet.</p>');
    expect(pagesUrl(REAL, 'PinchPDF')).toBe('https://technowizsolutionsllp.github.io/app-releases_PinchPDF/PinchPDF/');
    expect(renderDownloadsPage('PinchPDF', list(stable('1.3.0')), REAL)).toContain('Also as a web page: [https://technowizsolutionsllp.github.io/app-releases_PinchPDF/PinchPDF/]');
  });

  it('publish writes both pages, and either failing is only a warning', async () => {
    await publishRelease(base(), gh.io);
    expect(gh.s.lists.get('PinchPDF/index.html')!.text).toContain('<h1>PinchPDF downloads</h1>');
    expect(gh.s.lists.get('PinchPDF/index.html')!.text).toContain('Current version: 1.3.0');
    const broken = fake();
    broken.seedList('PinchPDF', emptyList());
    broken.s.failPut.add('PinchPDF/index.html');
    expect((await publishRelease(base(), broken.io)).published).toBe(true);
    expect(broken.s.log.join('\n')).toMatch(/could not be updated \(PinchPDF\/index\.html/);
  });

  it('follows a change: pausing or withdrawing a release takes it off the page', async () => {
    await publishRelease(base({ rollout: 50 }), gh.io);
    expect(gh.s.lists.get('PinchPDF/README.md')!.text).toContain('1.3.0');
    await updateRelease({ product: 'PinchPDF', version: '1.3.0', changes: { rollout: 0 }, repo: REPO, yes: true }, gh.io);
    expect(gh.s.lists.get('PinchPDF/README.md')!.text).not.toContain('PinchPDF-1.3.0-x64.exe');
    await updateRelease({ product: 'PinchPDF', version: '1.3.0', changes: { rollout: 100 }, repo: REPO, yes: true }, gh.io);
    expect(gh.s.lists.get('PinchPDF/README.md')!.text).toContain('PinchPDF-1.3.0-x64.exe');
    await updateRelease({ product: 'PinchPDF', version: '1.3.0', changes: { enabled: false }, repo: REPO, yes: true }, gh.io);
    expect(gh.s.lists.get('PinchPDF/README.md')!.text).toContain('No release has been published yet.');
    expect(gh.s.lists.get('PinchPDF/index.html')!.text).toContain('No release has been published yet.');
  });

  it('can be regenerated on its own, writes nothing when it is already right, and shows the page on a dry run', async () => {
    gh.seedList('PinchPDF', mergeIndex(emptyList(), 'PinchPDF', old120()));
    const first = await refreshPage({ product: 'PinchPDF', repo: REPO }, gh.io);
    expect(first).toMatchObject({ ok: true, changed: true });
    gh.s.calls.length = 0;
    expect(await refreshPage({ product: 'PinchPDF', repo: REPO }, gh.io)).toMatchObject({ ok: true, changed: false });
    expect(gh.s.calls.some((c) => c.startsWith('PUT'))).toBe(false);
    gh.s.lists.delete('PinchPDF/README.md');
    gh.s.log.length = 0;
    await refreshPage({ product: 'PinchPDF', repo: REPO, dryRun: true }, gh.io);
    expect(gh.s.log.join('\n')).toContain('# PinchPDF downloads');
    expect(gh.s.lists.has('PinchPDF/README.md')).toBe(false);
    await expect(pageFromArgs(['1.2.0'], 'PinchPDF', { makeIo: () => gh.io, exists: () => true, askSecret: async () => { throw new Error('the page script must never ask for the seed'); } })).rejects.toThrow(/Usage/);
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

describe('guided release flow (questions instead of options)', () => {
  const FOLDER = 'src-tauri/target/release/bundle/setup';
  const installerFor = (v: string) => `${FOLDER}/PinchPDF_${v}_x64-setup.exe`;
  const options = { defaults: { version: '1.4.0', installer: installerFor }, updateCommand: 'npm run release:update --', buildHint: 'Build it first.' };
  const NOTES =
    '# Release notes\n<!-- ## 9.9.9\n- never shown, this is inside a comment -->\n## 1.4.0 - 2026-11-22\n- Faster compression\n- Fixed a crash on encrypted files\n\n## 1.3.5\n- Smaller installer\n<!--\n- example line inside a comment\n-->\n\n## 1.4.0-beta.1\n- Beta only note\n';
  const at = (version: string, over: { size?: number } = {}) => ({ name: `PinchPDF_${version}_x64-setup.exe`, size: over.size ?? 41 * 1024 * 1024, mtimeMs: Date.UTC(2026, 10, 22) });

  /** A terminal with scripted answers. Every question asked is recorded; asking more than was scripted fails the test. */
  function terminal(answers: string[], opts: { versions?: string[]; notes?: string | null; typedSeed?: string; list?: ReleaseIndex } = {}) {
    const g = fake();
    const versions = opts.versions ?? ['1.4.0'];
    for (const v of versions) g.s.files.set(installerFor(v), text(`installer ${v}`));
    if (opts.list) g.seedList('PinchPDF', opts.list);
    const queue = [...answers];
    const asked: string[] = [];
    const secrets: string[] = [];
    const deps = {
      makeIo: () => g.io,
      exists: () => true,
      askSecret: async (q: string) => (secrets.push(q), opts.typedSeed ?? seed),
      ask: async (prompt: string) => {
        asked.push(prompt);
        if (queue.length === 0) throw new Error(`asked more than scripted: ${prompt}`);
        return queue.shift()!;
      },
      listFiles: () => versions.map((v) => at(v)),
      readText: async () => (opts.notes === undefined ? NOTES : opts.notes),
    };
    return { g, deps, asked, secrets, queue };
  }
  const listed = (...versions: string[]): ReleaseIndex => ({
    product: 'PinchPDF',
    releases: versions.map((v) => ({ ...buildEntry({ product: 'PinchPDF', channel: 'stable', version: v, fileName: `PinchPDF_${v}_x64-setup.exe`, bytes: text(`old ${v}`), notes: ['n'], seed, pubDate: '2026-10-01T00:00:00Z' }), rollout_percent: 5 })),
  });

  it('reads the notes, asks the few questions, rehearses, then publishes for real', async () => {
    // pick the release, notes ok, not mandatory, rollout 5, dry run yes, publish for real yes
    const t = terminal(['', '', '', '', '', 'y']);
    const result = await guidedPublish([], 'PinchPDF', options, t.deps);
    expect(result.published).toEqual(['1.4.0']);
    expect(t.queue).toEqual([]);
    const entry = t.g.list('PinchPDF').releases[0];
    expect(entry).toMatchObject({ version: '1.4.0', rollout_percent: 5, notes: ['Faster compression', 'Fixed a crash on encrypted files'], channel: 'stable' });
    const shown = t.g.s.log.join('\n');
    expect(shown).toContain('Dry run: nothing was published'); // the rehearsal came first
    expect(shown.indexOf('Dry run: nothing was published')).toBeLessThan(shown.indexOf('Step 1 of 7'));
    expect(t.asked.join('\n')).toMatch(/Mandatory\?/);
    expect(t.secrets).toHaveLength(1); // asked once
    expect(shown).not.toContain(seed); // the seed is never printed
    expect(shown).toContain('A dry run does everything except publish'); // the question explains itself
  });

  it('creates nothing when the rehearsal is not followed by "yes"', async () => {
    const t = terminal(['', '', '', '', '', 'n']);
    const result = await guidedPublish([], 'PinchPDF', options, t.deps);
    expect(result.published).toEqual([]);
    expect(t.g.s.releases.size).toBe(0);
    expect(t.g.s.lists.has('PinchPDF/index.json')).toBe(false);
    expect(t.g.s.log.join('\n')).toContain('Not published');
  });

  it('options answer their questions in advance: only the release, the notes and the mandatory question are asked', async () => {
    const t = terminal(['', '', '']);
    await guidedPublish(['--rollout', '25', '--dry-run'], 'PinchPDF', options, t.deps);
    expect(t.queue).toEqual([]);
    expect(t.asked).toHaveLength(3);
    expect(t.g.s.releases.size).toBe(0); // --dry-run: never publishes
    expect(t.g.s.log.join('\n')).toContain('rollout        25%');
  });

  it('a mandatory release goes to everyone and the rollout is not asked', async () => {
    const t = terminal(['', '', 'y', 'n']); // release, notes, mandatory yes, no dry run (the typed confirmation is the fake's "yes")
    await guidedPublish([], 'PinchPDF', options, t.deps);
    expect(t.g.list('PinchPDF').releases[0]).toMatchObject({ mandatory: true, rollout_percent: 100 });
    expect(t.asked.join('\n')).not.toMatch(/Rollout percent/);
  });

  it('asks again with the reason when an answer does not fit', async () => {
    const t = terminal(['9', '', '', '', 'lots', '250', '10', 'n']);
    await guidedPublish([], 'PinchPDF', options, t.deps);
    expect(t.g.list('PinchPDF').releases[0].rollout_percent).toBe(10);
    const shown = t.g.s.log.join('\n');
    expect(shown).toContain('"9" is not one of the numbers in the list.');
    expect(shown.match(/Please type a whole number from 0 to 100\./g)).toHaveLength(2);
  });

  it('lists installers with their status and refuses to publish one that is published or not newer', async () => {
    const t = terminal(['', '', ''], { versions: ['1.2.0', '1.3.0', '1.4.0'], list: listed('1.3.0') });
    await guidedPublish(['--dry-run', '--rollout', '5'], 'PinchPDF', options, t.deps);
    const shown = t.g.s.log.join('\n');
    expect(shown).toMatch(/1\.4\.0\s+stable\s+2026-11-22\s+41\.0 MB\s+ready to publish/);
    expect(shown).toMatch(/1\.3\.0\s+stable\s+\S+\s+\S+ MB\s+already published/);
    expect(shown).toMatch(/1\.2\.0\s+stable\s+\S+\s+\S+ MB\s+not newer than 1\.3\.0/);
    const again = terminal(['2', '1', '', '', ''], { versions: ['1.2.0', '1.3.0', '1.4.0'], list: listed('1.3.0') });
    await guidedPublish(['--dry-run', '--rollout', '5'], 'PinchPDF', options, again.deps);
    expect(again.g.s.log.join('\n')).toContain('1.3.0 cannot be published (already published)');
  });

  it('publishes several chosen releases oldest first, asking the seed once', async () => {
    const t = terminal(['all', '', '', '', 'n', '', '', '', 'n'], { versions: ['1.3.5', '1.4.0'], list: listed('1.3.0') });
    const result = await guidedPublish([], 'PinchPDF', options, t.deps);
    expect(result.published).toEqual(['1.3.5', '1.4.0']);
    expect(t.secrets).toHaveLength(1);
    expect(t.g.s.calls.filter((c) => c.startsWith('release create'))).toEqual(['release create PinchPDF-v1.3.5', 'release create PinchPDF-v1.4.0']);
  });

  it('stops before asking for the seed when the notes are missing or unusable, and says what to write', async () => {
    const missing = terminal([''], { notes: '# Notes\n## 1.3.5\n- Another version\n' });
    await expect(guidedPublish([], 'PinchPDF', options, missing.deps)).rejects.toThrow(/EXTERNAL_RELEASE_NOTES\.md has no section for 1\.4\.0[\s\S]*## 1\.4\.0\n {2}- /);
    const noFile = terminal([''], { notes: null });
    await expect(guidedPublish([], 'PinchPDF', options, noFile.deps)).rejects.toThrow(/has no section for 1\.4\.0/);
    const tooMany = terminal([''], { notes: `## 1.4.0\n${Array.from({ length: 11 }, (_, i) => `- line ${i}`).join('\n')}\n` });
    await expect(guidedPublish([], 'PinchPDF', options, tooMany.deps)).rejects.toThrow(/there are 11 lines; the most is 10/);
    for (const t of [missing, noFile, tooMany]) {
      expect(t.secrets).toHaveLength(0);
      expect(t.g.s.releases.size).toBe(0);
    }
  });

  it('stops when the person says the notes are wrong', async () => {
    const t = terminal(['', 'n']);
    const result = await guidedPublish([], 'PinchPDF', options, t.deps);
    expect(result.published).toEqual([]);
    expect(t.secrets).toHaveLength(0);
    expect(t.g.s.log.join('\n')).toContain('Edit EXTERNAL_RELEASE_NOTES.md and run the command again');
  });

  it('says so when there is no installer or nothing new, and refuses options that do not belong here', async () => {
    const none = terminal([], { versions: [] });
    await expect(guidedPublish([], 'PinchPDF', options, none.deps)).rejects.toThrow(/No PinchPDF installer was found in src-tauri.*Build it first\./);
    const done = terminal([], { versions: ['1.3.0'], list: listed('1.3.0') });
    expect((await guidedPublish([], 'PinchPDF', options, done.deps)).published).toEqual([]);
    expect(done.g.s.log.join('\n')).toContain('Nothing here can be published');
    await expect(guidedPublish(['--yes'], 'PinchPDF', options, terminal([]).deps)).rejects.toThrow(/--yes is not used in the guided flow/);
    await expect(guidedPublish(['--key-file', 'x'], 'PinchPDF', options, terminal([]).deps)).rejects.toThrow(/--key-file does not exist/);
  });

  it('is only used in an interactive terminal, with no version and no notes', () => {
    const interactive = { ask: async () => '' } as never;
    expect(isGuidedPublish([], interactive)).toBe(true);
    expect(isGuidedPublish(['--rollout', '25', '--dry-run'], interactive)).toBe(true);
    expect(isGuidedPublish(['--notes', 'a|b'], interactive)).toBe(false);
    expect(isGuidedPublish(['1.4.0', 'a.exe'], interactive)).toBe(false);
    expect(isGuidedPublish([], {} as never)).toBe(false); // not a terminal: the options are required, as before
    expect(isGuidedPublish(['--rollut', '5'], interactive)).toBe(false); // a typo goes to the normal path, which names it
    expect(isGuidedUpdate([], interactive)).toBe(true);
    expect(isGuidedUpdate(['1.4.0', '--rollout', '25'], interactive)).toBe(false);
    expect(isGuidedUpdate(['--pause'], interactive)).toBe(false);
  });

  it('changes a release by choosing it and the action', async () => {
    const raise = terminal(['1', '1', ''], { list: listed('1.4.0') }); // release 1, "change the rollout", the suggested 25
    await guidedUpdate([], 'PinchPDF', raise.deps, {});
    expect(raise.g.list('PinchPDF').releases[0].rollout_percent).toBe(25);
    const pause = terminal(['1', '2'], { list: listed('1.4.0') });
    await guidedUpdate([], 'PinchPDF', pause.deps, {});
    expect(pause.g.list('PinchPDF').releases[0].rollout_percent).toBe(0);
    const withdraw = terminal(['1', '3'], { list: listed('1.4.0') });
    await guidedUpdate([], 'PinchPDF', withdraw.deps, {});
    expect(withdraw.g.list('PinchPDF').releases[0].enabled).toBe(false);
    const empty = terminal([]);
    expect((await guidedUpdate([], 'PinchPDF', empty.deps, {})).published).toBe(false);
    expect(empty.g.s.log.join('\n')).toContain('Nothing is published for PinchPDF yet');
  });

  it('reads release notes from the section of the version, ignoring comments and other versions', () => {
    expect(parseReleaseNotes(NOTES, '1.4.0')).toEqual(['Faster compression', 'Fixed a crash on encrypted files']);
    expect(parseReleaseNotes(NOTES, '1.3.5')).toEqual(['Smaller installer']); // a comment inside a section is not a note
    expect(parseReleaseNotes(NOTES, '1.4.0-beta.1')).toEqual(['Beta only note']);
    expect(parseReleaseNotes(NOTES, '9.9.9')).toBeNull(); // only inside a comment
    expect(parseReleaseNotes('## [v1.0.0] - 2026\r\n* one\r\n', '1.0.0')).toEqual(['one']);
    expect(parseReleaseNotes('## 1.4.01\n- x\n', '1.4.0')).toBeNull();
    expect(notesProblem([])).toMatch(/no bullet lines/);
    expect(notesProblem(['x'.repeat(201)])).toMatch(/201 characters/);
    expect(notesProblem(['fine'])).toBeNull();
  });

  it('works out the installer folder and file names from the product path, and classifies what it finds', () => {
    const location = installerLocation(installerFor);
    expect(location.folder).toBe(FOLDER);
    expect(location.pattern.exec('PinchPDF_1.4.0-beta.1_x64-setup.exe')?.[1]).toBe('1.4.0-beta.1');
    expect(location.pattern.exec('PinchPDF_1.4.0_x64-setup.exe.sig')).toBeNull();
    const rows = classifyInstallers([at('1.4.0'), at('1.4.1-beta.1'), at('1.2.0'), { ...at('1.0.0'), name: 'readme.txt' }], location, listed('1.3.0'));
    expect(rows.map((r) => [r.version, r.channel, r.status])).toEqual([['1.4.1-beta.1', 'beta', 'new'], ['1.4.0', 'stable', 'new'], ['1.2.0', 'stable', 'older']]);
    expect(classifyInstallers([at('1.2.0')], location, listed('1.3.0'), true)[0].status).toBe('new');
  });
});

describe('zip of the installer (for people whose browser blocks a bare .exe)', () => {
  const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
  const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint16(at, true);
  const installerName = 'PinchPDF-1.3.0-x64.exe';
  const zipName = 'PinchPDF-1.3.0-x64.zip';

  it('writes a valid one-file zip: the right checksum, name, size and directory, and the same bytes every time', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926); // the standard check value
    const payload = new Uint8Array(70000).map((_, i) => (i * 31 + 7) & 0xff);
    const zip = zipSingle('Setup.exe', payload);
    expect(zipSingle('Setup.exe', payload)).toEqual(zip); // reproducible
    expect(u32(zip, 0)).toBe(0x04034b50); // local header
    expect(u16(zip, 8)).toBe(0); // stored
    expect(u32(zip, 14)).toBe(crc32(payload));
    expect(u32(zip, 18)).toBe(payload.length);
    expect(u32(zip, 22)).toBe(payload.length);
    expect(new TextDecoder().decode(zip.slice(30, 30 + u16(zip, 26)))).toBe('Setup.exe');
    expect(zip.slice(39, 39 + payload.length)).toEqual(payload); // 30 + name length 9
    const central = 39 + payload.length;
    expect(u32(zip, central)).toBe(0x02014b50);
    expect(u32(zip, central + 16)).toBe(crc32(payload));
    const end = zip.length - 22;
    expect(u32(zip, end)).toBe(0x06054b50);
    expect(u16(zip, end + 10)).toBe(1); // one entry
    expect(u32(zip, end + 16)).toBe(central); // where the directory starts
    expect(u32(zip, end + 12)).toBe(end - central); // its size
    expect(() => zipSingle('', payload)).toThrow(/not usable/);
  });

  it('is attached to the draft, checked there and in public, and its hash goes into the list (not into the signed bytes)', async () => {
    const gh = fake();
    gh.seedList('PinchPDF', emptyList());
    const result = await publishRelease(base(), gh.io);
    const entry = result.entry;
    expect(entry).toMatchObject({ zip_file: `PinchPDF-v1.3.0/${zipName}`, zip_size: expect.any(Number) });
    const release = gh.s.releases.get('PinchPDF-v1.3.0')!;
    expect([...release.assets.keys()].sort()).toEqual([installerName, zipName]);
    const zipBytes = release.assets.get(zipName)!;
    expect(entry.zip_sha256).toBe(await gh.io.sha256(zipBytes));
    expect(entry.zip_size).toBe(zipBytes.length);
    expect(zipBytes.slice(30 + installerName.length, 30 + installerName.length + 21)).toEqual(text('installer bytes 1.3.0')); // the installer is inside
    expect(gh.s.downloads.has(`https://github.com/${REPO}/releases/download/PinchPDF-v1.3.0/${zipName}`)).toBe(true);
    // The signature does not cover the zip: it is the same as for a release without one, and the website still accepts the entry.
    const without = buildEntry({ product: 'PinchPDF', channel: 'stable', version: '1.3.0', fileName: installerName, bytes: text('installer bytes 1.3.0'), notes: ['Faster compression', 'Fixed a crash'], seed, pubDate: '2026-12-01T00:00:00Z', rollout: 5 });
    expect(entry.signature).toBe(without.signature);
    expect((await parseIndex(JSON.stringify(gh.list('PinchPDF')), 'PinchPDF', publicKey)).problems).toEqual([]);
    expect(gh.s.log.join('\n')).toContain(`zip            ${zipName}`);
  });

  it('can be left out (--no-zip)', async () => {
    const gh = fake();
    const result = await publishRelease(base({ zip: false }), gh.io);
    expect(result.entry.zip_file).toBeUndefined();
    expect([...gh.s.releases.get('PinchPDF-v1.3.0')!.assets.keys()]).toEqual([installerName]);
    expect(gh.s.calls.filter((c) => c.startsWith('release download'))).toHaveLength(1);
    const viaFlags = fake();
    viaFlags.s.files.set('i.exe', text('x'));
    const deps = { makeIo: () => viaFlags.io, exists: () => true, askSecret: async () => seed };
    await publishFromArgs(['1.3.0', 'PinchPDF-1.3.0-x64.exe', '--notes', 'a', '--yes', '--no-site-check', '--no-zip'], 'PinchPDF', undefined, deps);
    expect([...viaFlags.s.releases.get('PinchPDF-v1.3.0')!.assets.keys()]).toEqual([installerName]);
  });

  it('stops and publishes nothing when the zip in the draft, or the public zip, is not the one that was made', async () => {
    const draft = fake();
    draft.s.tamperZipDraft = true;
    await expect(publishRelease(base(), draft.io)).rejects.toThrow(/STOP: the zip stored in the draft/);
    expect(draft.s.releases.get('PinchPDF-v1.3.0')!.draft).toBe(true);
    expect(draft.s.calls.some((c) => c.startsWith('PUT'))).toBe(false);

    const open = fake();
    open.s.tamperZipPublic = true;
    await expect(publishRelease(base(), open.io)).rejects.toThrow(/STOP: the zip GitHub serves/);
    expect(open.s.lists.has('PinchPDF/index.json')).toBe(false); // the list was never published
  });

  it('keeps the zip when a release is changed afterwards', () => {
    const zipped = { ...old120(), zip_file: 'PinchPDF-v1.2.0/a.zip', zip_sha256: 'a'.repeat(64), zip_size: 10 };
    const { after } = updateEntry({ product: 'PinchPDF', releases: [zipped] }, '1.2.0', { rollout: 50 });
    expect(after).toMatchObject({ rollout_percent: 50, zip_file: 'PinchPDF-v1.2.0/a.zip', zip_sha256: 'a'.repeat(64), zip_size: 10 });
  });

  it('is offered on the downloads pages next to the .exe, with its own SHA-256 and the SmartScreen note, and only where it exists', () => {
    const zipped = { ...old120(), version: '1.3.0', file: 'PinchPDF-v1.3.0/PinchPDF-1.3.0-x64.exe', zip_file: 'PinchPDF-v1.3.0/PinchPDF-1.3.0-x64.zip', zip_sha256: 'b'.repeat(64), zip_size: 2048 };
    const index = { product: 'PinchPDF', releases: [old120(), zipped] };
    const md = renderDownloadsPage('PinchPDF', index, REPO);
    expect(md).toContain(`[Download PinchPDF-1.3.0-x64.zip (a zip of the same installer)](https://github.com/${REPO}/releases/download/PinchPDF-v1.3.0/PinchPDF-1.3.0-x64.zip)`);
    expect(md).toContain(`Zip SHA-256: \`${'b'.repeat(64)}\``);
    expect(md).toMatch(/\[zip\]\(https:\/\/github\.com\/[^)]*PinchPDF-1\.3\.0-x64\.zip\)/);
    expect(md).toContain('unknown publisher');
    const html = renderDownloadsHtml('PinchPDF', index, REPO);
    expect(html).toContain(`href="https://github.com/${REPO}/releases/download/PinchPDF-v1.3.0/PinchPDF-1.3.0-x64.zip"`);
    expect(html).toContain(`Zip SHA-256: <code>${'b'.repeat(64)}</code>`);
    expect(html).toContain('unknown publisher');
    // a release without a zip shows none, and the explanation is left out when no listed release has one
    const plain = { product: 'PinchPDF', releases: [old120()] };
    expect(renderDownloadsPage('PinchPDF', plain, REPO)).not.toMatch(/zip/i);
    expect(renderDownloadsHtml('PinchPDF', plain, REPO)).not.toContain('Extract All');
    // an entry with a malformed zip is ignored rather than turned into a link
    for (const bad of [{ zip_file: '../x.zip' }, { zip_file: 'Other-v9.9.9/PinchPDF-1.3.0-x64.zip' },{ zip_file: 'a/b.zip<script>' }, { zip_sha256: 'short' }, { zip_size: 0 }]) {
      const broken = { product: 'PinchPDF', releases: [{ ...zipped, ...bad }] };
      expect(renderDownloadsPage('PinchPDF', broken, REPO)).not.toContain('a zip of the same installer');
      expect(renderDownloadsHtml('PinchPDF', broken, REPO)).not.toContain('<script>');
    }
  });
});
