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
import { createInterface } from 'node:readline';
import { createInterface as createPromptInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pageFromArgs, publishFromArgs, updateFromArgs } from './release-publish-lib.mjs';

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
      const rl = createPromptInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`\nType the version (${version}) to confirm, or anything else to cancel: `);
      rl.close();
      return answer.trim() === version;
    },
  };
}

/**
 * Asks for the signing seed in the terminal with nothing shown while it is typed or pasted. The seed is deliberately
 * not accepted from an environment variable, a file or the command line (they leave it in places other programs and
 * the shell history can read), so a terminal that is not interactive is refused.
 */
export function askSecret(question) {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('The signing seed is typed when asked, so this must run in an interactive terminal (not piped or scheduled).'));
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const hidden = new Writable({ write: (_chunk, _encoding, done) => done() });
    const rl = createInterface({ input: process.stdin, output: hidden, terminal: true });
    let answer = '';
    rl.once('line', (line) => {
      answer = line;
      rl.close();
    });
    rl.once('SIGINT', () => {
      rl.close();
      process.stdout.write('\nCancelled.\n');
      process.exit(130);
    });
    rl.once('close', () => {
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const realDeps = { makeIo, exists: existsSync, askSecret };

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

/** argv: [version, ...flags]. options.pageCommand: how to run the downloads page script, shown if it could not be updated. */
export async function runUpdate(argv, product, options = {}) {
  try {
    await updateFromArgs(argv, product, realDeps, options);
  } catch (error) {
    fail(error);
  }
}

/** argv: [...flags]. Regenerates <Product>/README.md (the downloads page) from the published list. */
export async function runPage(argv, product) {
  try {
    await pageFromArgs(argv, product, realDeps);
  } catch (error) {
    fail(error);
  }
}
