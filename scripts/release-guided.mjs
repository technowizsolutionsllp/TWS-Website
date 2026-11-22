// The guided way to publish and change releases: `npm run release:publish` and `npm run release:update` with no
// version and no notes ask what they need, one question at a time, each with a short explanation. Anything given as an
// option (--rollout 25, --dry-run, ...) answers its question in advance, so the same command also works for people who
// know what they want. With --notes (or a version) the commands behave as before and ask nothing, which keeps them
// usable in scripts.
//
// What the guided publish does:
//   1. looks in the installer folder (where the build puts the setup programs) and in the published list, and shows
//      every installer with its status, so nothing has to be typed
//   2. asks which of the new ones to publish
//   3. reads the user-facing release notes from EXTERNAL_RELEASE_NOTES.md (the text shown on GitHub and in the app,
//      kept apart from the developer CHANGELOG.md) and shows them for confirmation
//   4. asks the rollout (and whether the release is mandatory), whether to rehearse with a dry run, and the signing seed
//   5. runs publishRelease (release-publish-lib.mjs), which keeps its own safety checks and typed confirmation
//
// Like release-publish-lib.mjs, this file only talks to the outside through `deps`, so the tests run it with scripted
// answers and an in-memory GitHub. deps = { makeIo(repo), ask(prompt), askSecret(prompt), listFiles(folder),
// readText(path) }; `ask` is only supplied in an interactive terminal, which is what switches the guided mode on.

import { compareVersions, parseFlags, refuseKeyFile, checkRepository, readList, publishRelease, updateRelease, PUBLISH_FLAGS, UPDATE_FLAGS, DEFAULT_REPO, DEFAULT_ROLLOUT, DEFAULT_SITE } from './release-publish-lib.mjs';

export const NOTES_FILE = 'EXTERNAL_RELEASE_NOTES.md';
const MAX_NOTES = 10;
const MAX_NOTE_LENGTH = 200;
const ATTEMPTS = 5;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isVersion = (text) => {
  try {
    compareVersions(text, text);
    return true;
  } catch {
    return false;
  }
};

/**
 * The release notes for one version from EXTERNAL_RELEASE_NOTES.md: the bullet lines under the heading "## <version>"
 * (the heading may carry a date after it). Returns null when the version has no heading. HTML comments are ignored, so
 * the file can carry instructions and examples.
 */
export function parseReleaseNotes(text, version) {
  const lines = text.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const heading = new RegExp(`^##\\s+\\[?v?${escapeRegExp(version)}\\]?(\\s|$)`);
  const at = lines.findIndex((line) => heading.test(line));
  if (at === -1) return null;
  const notes = [];
  for (let i = at + 1; i < lines.length && !/^##\s/.test(lines[i]); i += 1) {
    const bullet = /^\s*[-*]\s+(.+?)\s*$/.exec(lines[i]);
    if (bullet) notes.push(bullet[1]);
  }
  return notes;
}

/** Why a list of notes cannot be published, or null when it can. The same limits the signed list enforces. */
export function notesProblem(notes) {
  if (notes.length < 1) return 'there are no bullet lines under it';
  if (notes.length > MAX_NOTES) return `there are ${notes.length} lines; the most is ${MAX_NOTES}`;
  const long = notes.find((n) => n.length > MAX_NOTE_LENGTH);
  if (long) return `a line is ${long.length} characters; the most is ${MAX_NOTE_LENGTH}: "${long.slice(0, 40)}..."`;
  if (notes.some((n) => /[\u0000-\u001f\u007f]/.test(n))) return 'a line contains a control character';
  return null;
}

/** Where the build puts installers, and how their file names carry the version, from the product's installer path. */
export function installerLocation(installerFor) {
  const sample = installerFor('0.0.0');
  const cut = Math.max(sample.lastIndexOf('/'), sample.lastIndexOf('\\'));
  const folder = cut === -1 ? '.' : sample.slice(0, cut);
  const name = sample.slice(cut + 1);
  const pattern = new RegExp(`^${escapeRegExp(name).replace(escapeRegExp('0.0.0'), '(.+)')}$`);
  return { folder, pattern };
}

const channelOf = (version) => (version.includes('-') ? 'beta' : 'stable');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const size = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const pad = (text, width) => String(text).padEnd(width);

/**
 * The installers in the folder, newest version first, each with what could be done with it: "new" (can be published),
 * "published" (already in the list) or "older" (not newer than the channel's latest, refused unless --allow-older).
 */
export function classifyInstallers(files, location, index, allowOlder = false) {
  const listed = index?.releases ?? [];
  const rows = [];
  for (const file of files) {
    const m = location.pattern.exec(file.name);
    if (!m || !isVersion(m[1])) continue;
    const version = m[1];
    const channel = channelOf(version);
    const highest = listed.filter((r) => r.channel === channel).reduce((best, r) => (best === null || compareVersions(r.version, best) > 0 ? r.version : best), null);
    let status = 'new';
    let note = 'ready to publish';
    if (listed.some((r) => r.version === version)) {
      status = 'published';
      note = 'already published';
    } else if (highest !== null && compareVersions(version, highest) <= 0) {
      status = allowOlder ? 'new' : 'older';
      note = allowOlder ? `older than ${highest} (allowed by --allow-older)` : `not newer than ${highest} (the latest ${channel}), cannot be published`;
    }
    rows.push({ version, channel, file: file.name, size: file.size, built: file.mtimeMs, status, note });
  }
  return rows.sort((a, b) => compareVersions(b.version, a.version));
}

// ---------------------------------------------------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Asks one question: the question, a few lines of explanation, then the prompt with the default in brackets. An empty
 * answer takes the default. `check(answer)` returns { value } or { problem }; the question is asked again on a problem.
 */
async function ask({ log, deps }, { question, help = [], hint, fallback, check }) {
  log('');
  log(question);
  for (const line of help) log(`  ${line}`);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const typed = (await deps.ask(`${hint} `)).trim();
    const answer = typed === '' ? fallback : typed;
    const result = check(answer);
    if (result.problem === undefined) return result.value;
    log(`  ${result.problem}`);
  }
  throw new Error('Too many answers that did not fit. Run the command again.');
}

const yesNo = (answer) => {
  const a = String(answer).toLowerCase();
  if (a === 'y' || a === 'yes') return { value: true };
  if (a === 'n' || a === 'no') return { value: false };
  return { problem: 'Please answer y (yes) or n (no).' };
};

const percent = (answer) => {
  if (!/^\d{1,3}$/.test(String(answer)) || Number(answer) > 100) return { problem: 'Please type a whole number from 0 to 100.' };
  return { value: Number(answer) };
};

function pickNumbers(answer, rows, selectable) {
  const text = String(answer).toLowerCase().trim();
  if (text === 'all') return { value: selectable };
  const chosen = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const n = Number(part);
    const row = Number.isInteger(n) ? rows[n - 1] : undefined;
    if (!row) return { problem: `"${part}" is not one of the numbers in the list.` };
    if (!selectable.includes(row)) return { problem: `${row.version} cannot be published (${row.note}).` };
    if (!chosen.includes(row)) chosen.push(row);
  }
  return chosen.length ? { value: chosen } : { problem: 'Type the number of a release, for example 1.' };
}

/** True when `npm run release:publish` was run with no version and no notes in an interactive terminal. */
export function isGuidedPublish(argv, deps) {
  if (typeof deps.ask !== 'function') return false;
  try {
    const { flags, positional } = parseFlags(argv, PUBLISH_FLAGS);
    return positional.length === 0 && flags['--notes'] === undefined;
  } catch {
    return false; // the normal path reports the mistake
  }
}

/** True when `npm run release:update` was run with no version and no change in an interactive terminal. */
export function isGuidedUpdate(argv, deps) {
  if (typeof deps.ask !== 'function') return false;
  try {
    const { flags, positional } = parseFlags(argv, UPDATE_FLAGS);
    const changes = ['--rollout', '--pause', '--withdraw', '--enable', '--mandatory', '--not-mandatory', '--min-supported', '--clear-min-supported', '--notes', '--notes-url'];
    return positional.length === 0 && !changes.some((f) => flags[f] !== undefined);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Guided publish
// ---------------------------------------------------------------------------------------------------------------------

export async function guidedPublish(argv, product, options, deps) {
  refuseKeyFile(argv);
  const { flags } = parseFlags(argv, PUBLISH_FLAGS);
  if (flags['--yes']) throw new Error('--yes is not used in the guided flow, which always asks for the final confirmation. Give --notes and a version to run without questions.');
  if (!options?.defaults?.installer) throw new Error(`The guided flow needs to know where ${product} installers are built.`);
  const repo = flags['--repo'] ?? DEFAULT_REPO;
  const branch = flags['--branch'] ?? 'main';
  const io = deps.makeIo(repo);
  const log = (line) => io.log(line);
  const ctx = { log, deps };
  const notesFile = options.notesFile ?? NOTES_FILE;

  log(`Publishing a ${product} release, step by step.`);
  log('A question shows the answer it will use in [brackets]: press Enter to accept it. Nothing is created on GitHub until the last confirmation,');
  log('and a dry run (explained below) creates nothing at all. Options such as --rollout 25, --dry-run, --min-supported, --notes-url or --channel answer a question in advance.');

  log(`\nChecking ${repo} ...`);
  await checkRepository(io, repo);
  const { index } = await readList(io, { repo, branch, product });

  const location = installerLocation(options.defaults.installer);
  const files = (await deps.listFiles(location.folder)) ?? [];
  const rows = classifyInstallers(files, location, index, flags['--allow-older'] === true);
  if (rows.length === 0) {
    throw new Error(`No ${product} installer was found in ${location.folder}. ${options.buildHint ?? 'Build it first.'}`);
  }
  log(`\nInstallers found in ${location.folder} (published list: ${index ? `${index.releases.length} release(s)` : 'empty'}):\n`);
  log(`  ${pad('#', 3)}${pad('Version', 16)}${pad('Channel', 9)}${pad('Built', 12)}${pad('Size', 10)}Status`);
  rows.forEach((r, i) => log(`  ${pad(i + 1, 3)}${pad(r.version, 16)}${pad(r.channel, 9)}${pad(day(r.built), 12)}${pad(size(r.size), 10)}${r.note}`));

  const selectable = rows.filter((r) => r.status === 'new');
  if (selectable.length === 0) {
    log(`\nNothing here can be published: every installer is already published or not newer than what is published. Build a new version first (${options.buildHint ?? 'see RELEASE_MANAGEMENT.md'}).`);
    return { published: [] };
  }
  const chosen = await ask(ctx, {
    question: 'Which release do you want to sign and publish?',
    help: ['Type the number from the list (for example 1), several separated by commas (1,2), or "all". Several are published oldest first.', 'Installers that are already published or not newer than the latest cannot be chosen.'],
    hint: `Number(s) [${rows.indexOf(selectable[0]) + 1}]:`,
    fallback: String(rows.indexOf(selectable[0]) + 1),
    check: (answer) => pickNumbers(answer, rows, selectable),
  });
  chosen.sort((a, b) => compareVersions(a.version, b.version));

  let seed = null;
  const published = [];
  for (const [n, row] of chosen.entries()) {
    log(`\n==== ${product} ${row.version}${chosen.length > 1 ? `  (release ${n + 1} of ${chosen.length})` : ''} ====`);
    const text = await deps.readText(notesFile);
    const found = text === null || text === undefined ? null : parseReleaseNotes(text, row.version);
    if (found === null) {
      throw new Error(
        `${notesFile} has no section for ${row.version}. The text people read on GitHub and in the app comes from that file (the developer CHANGELOG.md is not used).\n` +
          `Add a section like this, save the file and run the command again:\n\n  ## ${row.version}\n  - Faster compression of large files\n  - Fixed a crash on encrypted PDFs\n`,
      );
    }
    const problem = notesProblem(found);
    if (problem) throw new Error(`The section for ${row.version} in ${notesFile} cannot be used: ${problem}. Fix it and run the command again.`);
    log(`\nRelease notes for ${row.version}, from ${notesFile} (this is what people will read):`);
    for (const line of found) log(`  - ${line}`);
    const notesOk = await ask(ctx, {
      question: 'Are these the right release notes?',
      help: ['If not, answer n, edit the section in the file, and run the command again.'],
      hint: 'Use these notes? [Y/n]:',
      fallback: 'y',
      check: yesNo,
    });
    if (!notesOk) {
      log(`Stopped. Edit ${notesFile} and run the command again. Nothing was published.`);
      return { published };
    }

    const mandatory =
      flags['--mandatory'] === true ||
      (await ask(ctx, {
        question: 'Must every user install this update?',
        help: ['Normally no: the app shows a notice and people update when they choose.', 'Answer y only for a critical fix: apps then stop compressing until they update, at once, whatever the rollout says.'],
        hint: 'Mandatory? [y/N]:',
        fallback: 'n',
        check: yesNo,
      }));
    const rollout = mandatory
      ? 100
      : flags['--rollout'] !== undefined
        ? Number(flags['--rollout'])
        : await ask(ctx, {
            question: 'What share of users should be offered this release first?',
            help: [
              'A percentage from 0 to 100. Start small: if something is wrong, few people are affected and you can pause it.',
              `Later you raise it with "${options.updateCommand ?? 'npm run release:update --'}" (for example 5, then 25, then 100).`,
            ],
            hint: `Rollout percent [${DEFAULT_ROLLOUT}]:`,
            fallback: String(DEFAULT_ROLLOUT),
            check: percent,
          });
    if (mandatory) log('\nMandatory: it is offered to everyone at once (the rollout percentage does not apply).');

    const dryRunOnly = flags['--dry-run'] === true;
    const rehearse =
      dryRunOnly ||
      (await ask(ctx, {
        question: 'Do a dry run first?',
        help: [
          'A dry run does everything except publish: it checks the repository and the version, signs the release and prints a summary of exactly what would be published.',
          'Nothing is created on GitHub and nobody can see it. Afterwards you are asked whether to publish for real, without answering these questions again.',
        ],
        hint: 'Dry run first? [Y/n]:',
        fallback: 'y',
        check: yesNo,
      }));

    if (seed === null) {
      log('\nThe signing seed proves the release comes from you; the website and the apps check the signature.');
      log('Paste it now. Nothing is shown while you paste, and it is not stored anywhere (it is kept in memory until this command ends).');
      seed = (await deps.askSecret('Signing seed (43 characters): ')).trim();
    }

    const settings = {
      product,
      version: row.version,
      installer: `${location.folder}/${row.file}`,
      channel: flags['--channel'] ?? row.channel,
      notes: found,
      notesUrl: flags['--notes-url'] ?? null,
      minSupported: flags['--min-supported'] ?? null,
      mandatory,
      rollout,
      pubDate: flags['--pub-date'],
      repo,
      branch,
      seed,
      allowOlder: flags['--allow-older'] === true,
      outDir: flags['--out'] ?? 'release-out',
      site: flags['--no-site-check'] ? null : (flags['--site'] ?? DEFAULT_SITE),
      updateCommand: options.updateCommand,
      pageCommand: options.pageCommand,
      yes: false,
    };

    if (rehearse) {
      log('\n--- Dry run ---');
      await publishRelease({ ...settings, dryRun: true }, io);
      if (dryRunOnly) continue;
      const real = await ask(ctx, {
        question: 'Publish it for real now?',
        help: ['This creates the public GitHub release and then publishes the list, with the steps shown as they run. You will be asked once more to type the version.'],
        hint: 'Publish now? [y/N]:',
        fallback: 'n',
        check: yesNo,
      });
      if (!real) {
        log('Not published. Run the command again when you are ready.');
        continue;
      }
    }
    const result = await publishRelease({ ...settings, dryRun: false }, io);
    if (result.published) published.push(row.version);
  }
  return { published };
}

// ---------------------------------------------------------------------------------------------------------------------
// Guided update
// ---------------------------------------------------------------------------------------------------------------------

const stateOf = (r) => (r.enabled === false ? 'withdrawn' : r.rollout_percent === 0 ? 'paused' : r.mandatory ? 'mandatory' : `${r.rollout_percent}% of users`);

export async function guidedUpdate(argv, product, deps, options) {
  const { flags } = parseFlags(argv, UPDATE_FLAGS);
  const repo = flags['--repo'] ?? DEFAULT_REPO;
  const branch = flags['--branch'] ?? 'main';
  const io = deps.makeIo(repo);
  const log = (line) => io.log(line);
  const ctx = { log, deps };

  log(`Changing a published ${product} release, step by step. No signing seed is needed: only switches such as the rollout change, never the signed file.`);
  log(`\nChecking ${repo} ...`);
  await checkRepository(io, repo);
  const { index } = await readList(io, { repo, branch, product });
  const rows = [...(index?.releases ?? [])].sort((a, b) => compareVersions(b.version, a.version));
  if (rows.length === 0) {
    log(`\nNothing is published for ${product} yet. Publish a release first (${options?.publishCommand ?? 'npm run release:publish'}).`);
    return { changed: [], published: false };
  }
  log('\nPublished releases:\n');
  log(`  ${pad('#', 3)}${pad('Version', 16)}${pad('Channel', 9)}Offered to`);
  rows.forEach((r, i) => log(`  ${pad(i + 1, 3)}${pad(r.version, 16)}${pad(r.channel, 9)}${stateOf(r)}`));

  const row = await ask(ctx, {
    question: 'Which release do you want to change?',
    help: ['Type the number from the list.'],
    hint: 'Number [1]:',
    fallback: '1',
    check: (answer) => (rows[Number(answer) - 1] ? { value: rows[Number(answer) - 1] } : { problem: 'Type one of the numbers in the list.' }),
  });
  const actions = [
    ['raise', 'Change how many users are offered it (raise the rollout, for example 5 to 25 to 100)'],
    ['pause', 'Pause it: nobody new is offered it, installs that have it keep it (rollout 0)'],
    ['withdraw', 'Withdraw it: it is removed from the offer and the previous release is offered again'],
    ['enable', 'Offer a withdrawn release again'],
    ['mandatory', 'Make it mandatory, or not mandatory'],
  ];
  const action = await ask(ctx, {
    question: `What do you want to do with ${row.version}? (now: ${stateOf(row)})`,
    help: actions.map(([, text], i) => `${i + 1}  ${text}`),
    hint: 'Number:',
    fallback: '',
    check: (answer) => (actions[Number(answer) - 1] ? { value: actions[Number(answer) - 1][0] } : { problem: 'Type one of the numbers above.' }),
  });
  const changes = {};
  if (action === 'raise') {
    changes.rollout = await ask(ctx, {
      question: 'What share of users should be offered it?',
      help: ['A percentage from 0 to 100. Raise it step by step while you watch for problems.'],
      hint: `Rollout percent [${row.rollout_percent >= 100 ? 100 : Math.min(100, row.rollout_percent === 0 ? 5 : row.rollout_percent * 5)}]:`,
      fallback: String(row.rollout_percent >= 100 ? 100 : Math.min(100, row.rollout_percent === 0 ? 5 : row.rollout_percent * 5)),
      check: percent,
    });
  } else if (action === 'pause') changes.rollout = 0;
  else if (action === 'withdraw') changes.enabled = false;
  else if (action === 'enable') changes.enabled = true;
  else {
    changes.mandatory = await ask(ctx, {
      question: `Must every user install ${row.version}?`,
      help: ['Yes: apps stop compressing until they update. No: the update is only a notice.'],
      hint: `Mandatory? [${row.mandatory ? 'Y/n' : 'y/N'}]:`,
      fallback: row.mandatory ? 'y' : 'n',
      check: yesNo,
    });
  }
  return updateRelease(
    { product, version: row.version, changes, repo, branch, dryRun: flags['--dry-run'] === true, yes: false, pageCommand: options?.pageCommand },
    io,
  );
}
