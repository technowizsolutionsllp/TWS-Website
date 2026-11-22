// The command line around release-publish-lib.mjs: real GitHub (through the `gh` command), real files, real prompts.
// Used by the thin per-product wrappers (scripts/release/publish.mjs and update.mjs in each product repository) and by
// scripts/release-publish.mjs and release-update.mjs in the website repository. The argument handling itself lives in
// release-publish-lib.mjs (publishFromArgs, updateFromArgs), where it is tested.
//
// Which GitHub account is used: the one that owns the releases repository, when the GitHub CLI has a saved login
// for it (checked with `gh auth token --user <owner>`; the CLI's active account is not changed). Otherwise the
// active account is used, and the run stops if that account cannot write to the repository.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { publishFromArgs, updateFromArgs } from './release-publish-lib.mjs';

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

const realDeps = { makeIo, env: process.env, exists: existsSync, readText: async (path) => readFileSync(path, 'utf8') };

function fail(error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

/** argv: [version, installer, ...flags]; see publishFromArgs for the options. */
export async function runPublish(argv, product, options = {}) {
  try {
    await publishFromArgs(argv, product, options, realDeps);
  } catch (error) {
    fail(error);
  }
}

/** argv: [version, ...flags]. */
export async function runUpdate(argv, product) {
  try {
    await updateFromArgs(argv, product, realDeps);
  } catch (error) {
    fail(error);
  }
}
