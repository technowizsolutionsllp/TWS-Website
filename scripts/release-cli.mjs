// The command line around scripts/release-publish-lib.mjs: real GitHub (through the `gh` command), real files, real prompts.
// Used by scripts/release-publish.mjs, scripts/release-update.mjs and the per-product wrappers in releases/<Product>/.
//
// Which GitHub account is used: the one that owns the releases repository, when the GitHub CLI has a saved login
// for it (checked with `gh auth token --user <owner>`; the CLI's active account is not changed). Otherwise the
// active account is used, and the run stops if that account cannot write to the repository.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { DEFAULT_REPO, DEFAULT_SITE, parseFlags, publishRelease, updateRelease } from './release-publish-lib.mjs';

const PUBLISH_FLAGS = {
  values: ['--channel', '--notes', '--notes-url', '--min-supported', '--rollout', '--pub-date', '--repo', '--branch', '--key-file', '--out', '--site'],
  booleans: ['--mandatory', '--dry-run', '--yes', '--allow-older', '--no-site-check'],
};
const UPDATE_FLAGS = {
  values: ['--rollout', '--min-supported', '--notes', '--notes-url', '--repo', '--branch'],
  booleans: ['--pause', '--withdraw', '--enable', '--mandatory', '--not-mandatory', '--dry-run', '--yes', '--clear-min-supported'],
};

function ghFor(repo) {
  const owner = repo.split('/')[0];
  const saved = spawnSync('gh', ['auth', 'token', '--user', owner], { encoding: 'utf8' });
  const token = saved.status === 0 ? saved.stdout.trim() : '';
  return (args) => {
    const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: token ? { ...process.env, GH_TOKEN: token } : process.env });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr || r.error?.message || '' };
  };
}

function makeIo(repo) {
  const gh = ghFor(repo);
  return {
    log: (line) => console.log(line),
    gh: async (args) => gh(args),
    readFile: async (path) => new Uint8Array(readFileSync(path)),
    writeFile: async (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    sha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchBytes: async (url) => {
      try {
        const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
        return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
      } catch {
        return { status: 0, bytes: new Uint8Array() };
      }
    },
    fetchJson: async (url) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        return { status: response.status, json: await response.json().catch(() => null) };
      } catch {
        return { status: 0, json: null };
      }
    },
    confirm: async (version) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`\nType the version (${version}) to confirm, or anything else to cancel: `);
      rl.close();
      return answer.trim() === version;
    },
  };
}

function fail(error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

/** argv: [version, installer, ...flags]. */
export async function runPublish(argv, product) {
  try {
    const { flags, positional } = parseFlags(argv, PUBLISH_FLAGS);
    const [version, installer] = positional;
    if (positional.length !== 2) throw new Error(`Usage: <version> <installer.exe> --notes "first change|second change" [--channel stable|beta] [--rollout 5] [--dry-run] ... (see releases/${product}/RELEASE_MANAGEMENT.md)`);
    if (!flags['--notes']) throw new Error('Add --notes "first change|second change" (the major changes users will read).');
    const seed = flags['--key-file'] ? readFileSync(flags['--key-file'], 'utf8').trim() : process.env.RELEASE_SIGNING_KEY?.trim();
    const repo = flags['--repo'] ?? DEFAULT_REPO;
    const rollout = flags['--rollout'] === undefined ? 100 : Number(flags['--rollout']);
    await publishRelease(
      {
        product,
        version,
        installer,
        channel: flags['--channel'] ?? 'stable',
        notes: flags['--notes'].split('|').map((n) => n.trim()).filter(Boolean),
        notesUrl: flags['--notes-url'] ?? null,
        minSupported: flags['--min-supported'] ?? null,
        mandatory: flags['--mandatory'] === true,
        rollout,
        pubDate: flags['--pub-date'],
        repo,
        branch: flags['--branch'] ?? 'main',
        seed,
        dryRun: flags['--dry-run'] === true,
        yes: flags['--yes'] === true,
        allowOlder: flags['--allow-older'] === true,
        outDir: flags['--out'] ?? 'release-out',
        site: flags['--no-site-check'] ? null : (flags['--site'] ?? DEFAULT_SITE),
      },
      makeIo(repo),
    );
  } catch (error) {
    fail(error);
  }
}

/** argv: [version, ...flags]. */
export async function runUpdate(argv, product) {
  try {
    const { flags, positional } = parseFlags(argv, UPDATE_FLAGS);
    if (positional.length !== 1) throw new Error(`Usage: <version> [--rollout 25 | --pause | --withdraw | --enable] [--mandatory | --not-mandatory] [--min-supported 1.1.0 | --clear-min-supported] [--notes "a|b"] [--dry-run] (see releases/${product}/RELEASE_MANAGEMENT.md)`);
    const changes = {};
    if (flags['--pause'] && flags['--rollout'] !== undefined) throw new Error('use either --pause or --rollout, not both');
    if (flags['--pause']) changes.rollout = 0;
    if (flags['--rollout'] !== undefined) changes.rollout = Number(flags['--rollout']);
    if (flags['--withdraw'] && flags['--enable']) throw new Error('use either --withdraw or --enable, not both');
    if (flags['--withdraw']) changes.enabled = false;
    if (flags['--enable']) changes.enabled = true;
    if (flags['--mandatory'] && flags['--not-mandatory']) throw new Error('use either --mandatory or --not-mandatory, not both');
    if (flags['--mandatory']) changes.mandatory = true;
    if (flags['--not-mandatory']) changes.mandatory = false;
    if (flags['--min-supported'] !== undefined && flags['--clear-min-supported']) throw new Error('use either --min-supported or --clear-min-supported, not both');
    if (flags['--min-supported'] !== undefined) changes.minSupported = flags['--min-supported'];
    if (flags['--clear-min-supported']) changes.minSupported = null;
    if (flags['--notes'] !== undefined) changes.notes = flags['--notes'].split('|').map((n) => n.trim()).filter(Boolean);
    if (flags['--notes-url'] !== undefined) changes.notesUrl = flags['--notes-url'];
    if (Object.keys(changes).length === 0) throw new Error('Nothing to change: give at least one of --rollout, --pause, --withdraw, --enable, --mandatory, --not-mandatory, --min-supported, --notes.');
    const repo = flags['--repo'] ?? DEFAULT_REPO;
    await updateRelease(
      { product, version: positional[0], changes, repo, branch: flags['--branch'] ?? 'main', dryRun: flags['--dry-run'] === true, yes: flags['--yes'] === true },
      makeIo(repo),
    );
  } catch (error) {
    fail(error);
  }
}
