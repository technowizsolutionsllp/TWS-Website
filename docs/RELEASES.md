# Releases

How releases are handled. There are two kinds, and they work differently.

| Kind | What it is | Status |
|---|---|---|
| **A. Website and backend releases** | This repository: the site, the APIs, the admin area, the database migrations | In place. Follow section A. |
| **B. App releases** | The PinchPDF and NoDupe installers that users download and update to | **Server side built; the repository and keys are set up; the first release is still to be published** (see "Turning it on"). Installers and the release list live in a public GitHub repository, signed with an offline release key. The app side (the check, download and verification inside PinchPDF and NoDupe) is the app team's. |

## What runs when

Nothing reaches production until a change is **merged into the production branch** (`launch-marketing-site-contact-email`). A pull request, a pushed branch and a published app release each trigger different things, and only the merge deploys the website.

| Event | What runs | Where | Deploys the website? |
|---|---|---|---|
| **Push a branch, or open or update a pull request** | **GitHub Actions CI**: typecheck, lint, the full test suite, a check that the shared vector files match their generators, a production build, `wrangler deploy --dry-run`, a dependency audit. It uses a read-only token and no secrets | GitHub | **No** |
| **Push a branch, or open or update a pull request** | **Cloudflare Workers Builds** builds the branch (the "Workers Builds: tws-website" check). For a branch that is not the production branch this should be a **preview** only (`wrangler versions upload`). Confirm once in the Cloudflare dashboard (Workers, `tws-website`, Settings, Builds) that the production branch is `launch-marketing-site-contact-email` and that other branches only build previews | Cloudflare | **No** (a preview version at most, which is not the live site) |
| **Merge a pull request** into the production branch (merge commit, never squash) | The same CI runs on the branch, and **Workers Builds builds and deploys the production Worker** | GitHub, Cloudflare | **Yes: this is the production deploy.** Apply any new migration *before* the merge (section A) |
| **After a deploy** | You open the Admin **Health check**, and run the smoke scripts for protocol changes | You | No |
| **Change a website setting** (`RELEASES_REPO`, `RELEASE_PUBLIC_KEY`, a limiter, any `wrangler.json` value) | A normal pull request: the change only takes effect when it is merged and deployed | GitHub, Cloudflare | Yes, on merge |
| **Publish an app release** (`npm run release:publish` in the product repository) | Runs **on your computer**: signs the release, creates the GitHub release with the installer, then publishes the list in `technowizsolutionsllp/app-releases` | Your computer, GitHub | **No.** The website is not redeployed; it picks up the new list within about 10 minutes |
| **Change a rollout, pause or withdraw a release** (`npm run release:update`) | Runs on your computer and commits a change to the list in `app-releases` | Your computer, GitHub | **No**, and no signing seed is needed |
| **Rotate or add a release key** | A pull request changing `RELEASE_PUBLIC_KEY` (and the app team shipping an app that trusts the new key first) | GitHub, Cloudflare | Yes, on merge |

So: **merge first, deploy follows, then check the Health check, and only then publish a release** that depends on the new code. Publishing an app release never needs a website deploy, and a website deploy never publishes an app release.

**The whole flow on one page, with diagrams:** [UPDATE_FLOW.md](UPDATE_FLOW.md) (how a PinchPDF release is pushed, what to run when, the updater flow between the app, the website and GitHub, the addresses, and the app and website alignment check).

Related: [CHANGELOG.md](../CHANGELOG.md) (what changed), [ARCHITECTURE.md](ARCHITECTURE.md) (how it is built), [PINCHPDF_TELEMETRY.md](PINCHPDF_TELEMETRY.md) (the app protocol and deploy checklist).

---

## A. Website and backend releases

### Versions

- Versions are `MAJOR.MINOR.PATCH` in `package.json` and the changelog. Minor: a feature or an interface change (a page, an API, an endpoint, a migration). Patch: fixes and small adjustments. `1.0.0` is reserved for when the PinchPDF trial and telemetry are live in production with reviewed legal text.
- The changelog's early versions were assigned afterwards (the repository had no tags). From now on every release has a changelog heading, a `package.json` version and a git tag `vX.Y.Z` on the merge commit.
- Interfaces with their own version (trial protocol, telemetry protocol, Insights API, database schema, legal text dates) are listed in the changelog's "Interface versions" table. Change one and say so in the entry.

### Normal change

1. Branch from `launch-marketing-site-contact-email` (the base branch, not `main`).
2. Make the change, with tests. Update the documents the change touches ([README, "Keeping the documents current"](../README.md#keeping-the-documents-current)) and add a line under `Unreleased` in the changelog.
3. Open a PR. CI must pass: typecheck, lint, tests, shared vector checks, build, `wrangler deploy --dry-run`, dependency audit. Cloudflare Workers Builds also builds a preview.
4. Merge with a **merge commit** (`gh pr merge --merge`), never squash.
5. Cloudflare Workers Builds builds every push (a preview for each PR). Confirm in the Cloudflare dashboard which branch is the production branch, and treat a merge to it as a production deploy.

### Before merging a change that needs something else first

| If the change has | Do this before it deploys |
|---|---|
| A new migration | `npx wrangler d1 migrations apply pinchpdf --remote` (staging first). Pages and endpoints degrade, not crash, until it is applied, and the Health check names the command. Migrations only move forward: write them so the previous code still works against the new schema, so a rollback is safe. |
| A new secret or binding | Add the secret as type **Secret** in the Cloudflare dashboard. Bindings and plain variables go in `wrangler.json`, never only in the dashboard (a deploy removes them). |
| A change to a sealed or signed protocol | Regenerate the shared vectors (`scripts/generate-*-vectors.mjs`), give the app team the new file and the Swagger spec, and note it under Interface versions. |
| New or changed legal text | The owner and counsel approve the wording first. A test fails while any `OWNER TO CONFIRM` remains. Update store listings and in-app text too. |

### Cutting a version

When a set of merged changes should be named:

1. In `CHANGELOG.md`, move the `Unreleased` entries under a new heading with the version and date.
2. Set `version` in `package.json` to match.
3. Commit, merge, then tag the merge commit and push the tag: `git tag vX.Y.Z <merge-commit>` and `git push origin vX.Y.Z`.

### After a deploy

1. Open **Admin, Health check** and confirm everything is green.
2. Run the smoke tests against the new deploy: `node scripts/trial-smoke.mjs <url>` and `node scripts/telemetry-smoke.mjs <url>` (they write rows: staging only, unless you pass `--yes-production`).
3. If the release changed an app-facing endpoint, tell the app team.

### Rolling back

Revert the merge commit with a new PR and merge it. Because migrations are written to be backward compatible, the previous code keeps working. A data fix goes in as a new migration, not an edit to an old one.

---

## B. App releases (PinchPDF and NoDupe)

> **Status: the server side is built and tested.** The public repository, the protections and both public keys are set up; the endpoints stay off (503) until this branch is deployed, and the first release is published (see "Turning it on"). The apps' side (the check, the download and the verification inside PinchPDF and NoDupe) is the app team's and is not in this repository.

The apps update themselves by asking the website whether a newer version exists. The website answers from a **signed release list** kept in a public GitHub repository. Installers are GitHub release assets, so there is no storage service to pay for or run. You publish a release by creating a GitHub release and committing the list; the website itself is not deployed.

### Decisions (and why)

| Decision | Why |
|---|---|
| **Installers and release lists are hosted on GitHub** (public repository, GitHub Releases), not Cloudflare R2 | R2 needs a payment method even for the free allowance. GitHub is free, versions every change, and needs no new service to run |
| **A separate public repository, `technowizsolutionsllp/app-releases`, in the Technowiz account.** The website code stays in a private repository in another account | A release takes the visibility of its repository, so public downloads cannot live in the private code repository. The code repository is never touched to publish a release |
| **The repository holds no code, only lists and installers.** `main` blocks deletion and force pushes; immutable releases is on | Everything in it is public forever. Immutability backs the rule that a released version is never replaced |
| **Releases are published by hand** (GitHub web pages or the CLI), with no automation holding credentials | Few releases, and no stored token that could publish on someone's behalf |
| **A release is created as a draft with the installer, the stored file is checked against the signed hash, and only then it is published** (then the public download is checked again, and the list goes last) | Immutable releases do not accept files after publishing, and a wrong file must never become public or listed |
| **Each product's folder in the releases repository has a generated `README.md` and `index.html`: its public downloads page, on GitHub and as a web page (GitHub Pages)** (every available version, newest first, with link, size, SHA-256 and what changed; paused and withdrawn releases are not shown) | GitHub shows a folder's README under its file list, and GitHub Pages serves the `index.html` at `https://technowizsolutionsllp.github.io/app-releases/<Product>/`, so there is a stable, always-correct downloads page with a clean address, regenerated from the signed list by every publish and update so it cannot disagree with what apps are offered |
| **A pause (rollout 0) always wins; a new release starts at 5% unless told otherwise** | A bad mandatory release must be stoppable, and a forgotten flag must not push a release to everyone |
| **Two signatures protect an installer** (see "Signing layers") | The release key proves the listing is ours; the Windows code signature proves the file is ours to Windows and SmartScreen |
| **The release key is Ed25519, with a primary and a backup key, and the website and the apps trust a list of keys** | The public key is built into installed apps, so a key cannot be swapped later without stranding them. A backup that every app already trusts makes rotation and recovery possible |
| **The seed (private key) lives only offline, with the person who publishes.** Not in Cloudflare, not in GitHub, not in any repository | Whoever holds it can sign releases the apps accept. Keeping it off GitHub keeps the protection even if the GitHub account is taken over |
| **The public keys are a plain variable in `wrangler.json`** (`RELEASE_PUBLIC_KEY`), not a secret | They are not secret and the apps carry them anyway. In the file they are reviewed and deployed with the code |
| **The signed bytes include the channel; the switches (`enabled`, `rollout_percent`, `mandatory`, `min_supported`, `notes`) are not signed** | Nobody with write access can relabel a signed beta as stable, but a release can be paused or its notes fixed without the offline key |
| **The update check is a plain GET with no personal data** (version, channel, OS and architecture only), with a per-IP limit and a 5-minute cache | No installation id and no customer id, so it is not linked to telemetry. Covered by privacy policy section 2.8 |
| **The owner and repository name are permanent** | They are part of the apps' download allowlist |

**Open items:** the signing format is settled (the PinchPDF app uses this one, with the same shared vectors and the same two keys; see [UPDATE_FLOW.md](UPDATE_FLOW.md), section 8). Still open: (1) the first real release, which will be the first full test of the upload; (2) counsel review of privacy section 2.8; (3) NoDupe's app still updates through its own Tauri updater until it is moved to this check; (4) Windows code signing (Authenticode): the self-signed certificate is not trusted on other computers, so the app's check stays off until a certificate from a trusted authority exists.

### Signing layers and keys

Two different signatures exist, for two different jobs. Do not confuse them.

| | Release key (Ed25519) | Windows code signing (Authenticode) |
|---|---|---|
| What it signs | The listing for a release: product, channel, version, installer SHA-256 and size | The installer `.exe` itself |
| Made with | The seed from `release-prepare --keygen`, by `release-prepare` | A code-signing certificate. Today a self-signed one; a certificate from a trusted authority or a signing service is what Windows and SmartScreen trust |
| Checked by | The website (drops entries that do not verify) and the app, before it runs a downloaded installer | Windows and SmartScreen; the app can also check it |
| Status | Keys made; two public keys set in `wrangler.json` | A self-signed, permanent certificate exists (publisher `Technowiz Solutions LLP`). Windows does not trust it on other computers, so SmartScreen still warns and the app's check stays off. Waiting for a certificate from a trusted authority |

**Key format.** Ed25519, every value base64url (letters, digits, `-` and `_`, no `=` padding, no spaces): the **seed** is 32 raw bytes (43 characters), the **public key** is 32 raw bytes (43 characters), a **signature** is 64 bytes (86 characters). They are raw bytes, not PEM or PKCS#8 files. The seed is only ever typed or pasted at the publish script's hidden prompt; there is no key file and no environment variable.

**Two keys, made with `--keygen` run twice:**

| Key | Role | Where its seed is kept |
|---|---|---|
| **Primary** | Signs every release | Offline: a password manager entry or an encrypted offline file. Used on the computer of the person who publishes: the script asks for it with a hidden prompt each time (it is never read from an environment variable, a file or the command line) |
| **Backup** | Never signs, except for a planned rotation or a leak | Offline, in a **different** place from the primary |

The current public keys are recorded in "How the releases repository was set up", step 8. **The seeds are never** put in Cloudflare (variables, secrets or a Worker), in GitHub (any repository, or Actions secrets), in chat, in email or in the project folder. If a seed was ever pasted anywhere else, treat it as leaked: make a new pair and rotate (see "Key rotation").

### Where things live

One public repository for both products: **`technowizsolutionsllp/app-releases`** (the name is a setting, `RELEASES_REPO`). It sits in the Technowiz Solutions GitHub account, **separate from the private website repository**, which stays in the developer's own account. A release takes the visibility of the repository it belongs to, so the public downloads cannot live in the private website repository. The releases repository holds no source code, only the lists; the installers are attached to its releases. Everything in it, history included, is public.

```
app-releases/                        (public repository, branch main)
  PinchPDF/index.json                the list the website reads for PinchPDF
  NoDupe/index.json                  the list for NoDupe

GitHub Releases of that repository:
  PinchPDF-v1.3.0   asset PinchPDF-1.3.0-x64.exe, release.json
  PinchPDF-v1.4.0-beta.1   (marked pre-release)
  NoDupe-v2.1.0     asset NoDupe-2.1.0-x64.exe, release.json
```

- The folder names `PinchPDF` and `NoDupe` and the tag format `<Product>-v<version>` are exact and case-sensitive. The release tool and the website both enforce them.
- The list is read from `https://raw.githubusercontent.com/technowizsolutionsllp/app-releases/main/<Product>/index.json` (for example `https://raw.githubusercontent.com/technowizsolutionsllp/app-releases/main/PinchPDF/index.json`) and installers are downloaded from `https://github.com/technowizsolutionsllp/app-releases/releases/download/<tag>/<file>` (for example `https://github.com/technowizsolutionsllp/app-releases/releases/download/PinchPDF-v1.3.0/PinchPDF_1.3.0_x64-setup.exe`). The repository name is the `RELEASES_REPO` setting. These are the only two hosts the website contacts for this, and the app should allow only that host and path prefix.
- **A released version is never replaced.** A fix is a new version. If someone swapped an installer on GitHub, the SHA-256 and signature in the list would no longer match and apps would refuse it.
- The list is versioned by git, so every change to a release (including a pause) has an author, a time and a diff.
- The repository is protected: a ruleset on `main` blocks deleting the branch and force pushes (history cannot be rewritten), and **immutable releases** is on (once a release is published, its installer and tag cannot be changed or deleted). Keep the number of people who can write to it very small, and use two-factor authentication on every account that can. Whoever can sign in to the Technowiz account can edit the lists and publish releases; they still cannot offer an installer that is not signed with the release key.
- The owner and repository name are built into the apps' download allowlist, so treat `technowizsolutionsllp/app-releases` as permanent. Moving or renaming it later would strand installed apps until they update.

**The real addresses**

| What | Address |
|---|---|
| The repository | [https://github.com/technowizsolutionsllp/app-releases](https://github.com/technowizsolutionsllp/app-releases) |
| PinchPDF list (folder, and the file the website reads) | [https://github.com/technowizsolutionsllp/app-releases/tree/main/PinchPDF](https://github.com/technowizsolutionsllp/app-releases/tree/main/PinchPDF), file [index.json](https://github.com/technowizsolutionsllp/app-releases/blob/main/PinchPDF/index.json) |
| NoDupe list | [https://github.com/technowizsolutionsllp/app-releases/tree/main/NoDupe](https://github.com/technowizsolutionsllp/app-releases/tree/main/NoDupe), file [index.json](https://github.com/technowizsolutionsllp/app-releases/blob/main/NoDupe/index.json) |
| **Public downloads pages** (generated; every available version with link, size, SHA-256 and notes) | Web pages (GitHub Pages): [https://technowizsolutionsllp.github.io/app-releases/PinchPDF/](https://technowizsolutionsllp.github.io/app-releases/PinchPDF/) and [https://technowizsolutionsllp.github.io/app-releases/NoDupe/](https://technowizsolutionsllp.github.io/app-releases/NoDupe/), with an index at [https://technowizsolutionsllp.github.io/app-releases/](https://technowizsolutionsllp.github.io/app-releases/). The same content is the folder page on GitHub (the table rows above) |
| Installers (GitHub releases) | [https://github.com/technowizsolutionsllp/app-releases/releases](https://github.com/technowizsolutionsllp/app-releases/releases) |
| Create a release in the browser | [https://github.com/technowizsolutionsllp/app-releases/releases/new](https://github.com/technowizsolutionsllp/app-releases/releases/new) |
| What the website actually fetches | `https://raw.githubusercontent.com/technowizsolutionsllp/app-releases/main/PinchPDF/index.json` (and `.../NoDupe/index.json`) |

### `index.json`

```json
{ "product": "PinchPDF", "releases": [ { "version": "1.3.0", "channel": "stable", "...": "..." } ] }
```

One entry per release:

| Field | Meaning |
|---|---|
| `version` | Semantic version, **unique within the product** (across channels too, because it forms the release tag) |
| `channel` | `stable` or `beta`. A stable release cannot have a pre-release version (`1.4.0-beta.1` belongs in `beta`) |
| `pub_date` | When it was published (RFC 3339) |
| `notes` | The major changes shown to the user: 1 to 10 short plain-text lines |
| `notes_url` | Link to the full release notes, optional. Must be https **on `technowizsolutions.com`**: the app refuses a whole update answer that names any other address, so publishing refuses such a link and the website leaves one out of the answer (and the Health check reports it) |
| `file` | `<Product>-v<version>/<installer file name>`: the release tag and the asset name |
| `sha256`, `size` | Of the installer |
| `signature` | Ed25519 signature over the release identity, base64url, 64 bytes (see "Signed bytes") |
| `min_supported` | Apps below this version are told to update |
| `mandatory` | The app must update before it continues |
| `rollout_percent` | 0 to 100: how many installs are offered it |
| `enabled` | `false` withdraws the release |

### Signed bytes

The release key signs this UTF-8 string, with `|` between the parts and no trailing newline:

```
pinchpdf-release-v1|<Product>|<channel>|<version>|<sha256>|<size>
```

- `<Product>` is exactly `PinchPDF` or `NoDupe`; `<channel>` is `stable` or `beta`; `<version>` is the semantic version; `<sha256>` is the installer's lowercase hex SHA-256; `<size>` is its length in bytes as a plain integer.
- The channel is signed so that nobody who can write to the repository can relabel a signed beta as stable.
- The website drops any entry that does not verify. The app must verify the same bytes with the public key built into it, before running the installer.
- Test vectors made by the release tool with a public, test-only key: `test/release-vectors.json` (it holds the key, the messages and signed entries). The website's own tests verify them, so an app that verifies them agrees with the website.
- The switches (`enabled`, `rollout_percent`, `mandatory`, `min_supported`, `notes`) are not signed, so a release can be paused or its notes fixed without the offline key. The limit of that: someone who can write to the repository can force an update to a release the key holder really signed, or hold one back, but cannot offer a file that was not signed.

### Publishing a release

**The scripted way is the normal way, and it lives in the product repositories.** Each product repository (PDF Compressor for PinchPDF, Duplicate Cleaner for NoDupe) has a `RELEASE_MANAGEMENT.md` with the whole process, commands, rules, troubleshooting and UML diagrams, linked from its README. In short: `npm run release:publish` finds the installers the build produced, asks which to publish, reads the user-facing notes from `EXTERNAL_RELEASE_NOTES.md` (kept apart from the developer `CHANGELOG.md`) and asks for confirmation, then asks the rollout and whether to do a dry run first, asks for the signing seed (hidden), signs the release, creates the GitHub release with the installer, checks the uploaded file, then publishes the list last. `npm run release:update` asks which release and what to do (rollout, pause, withdraw, mandatory) without the signing seed. Options (`--rollout 25`, `--dry-run`, `--notes "a|b"` for a run without questions, ...) answer a question in advance. The questions and options are listed in `docs/UPDATE_FLOW.md`, section 1.1.

**Where the code is.** This repository is the source of truth for the signing and publishing code (`scripts/release-lib.mjs`, `release-publish-lib.mjs`, `release-cli.mjs`, and `test/release-vectors.json`), tested here against an in-memory GitHub (`test/release-publish.test.ts`) and the website's own parser. The product repositories keep byte-identical copies under `scripts/release/`, next to their own two wrappers (`publish.mjs`, `update.mjs`), and re-run the same tests plus a check that the copy still reproduces the website's signed vectors. After changing any shared file, run `node scripts/sync-release-scripts.mjs "<PDF Compressor path>" "<Duplicate Cleaner path>"` and commit the copies in both repositories (`--check` reports drift). The generic commands `node scripts/release-publish.mjs <Product> ...` and `release-update.mjs` work from here too.

**NoDupe has a second, older update path** (Tauri's updater reading `latest.json` from its own repository's releases, built by its GitHub Actions workflow). It is unchanged; its `RELEASE_MANAGEMENT.md` explains how the two relate.

The manual steps below do the same thing by hand and are the fallback if the script cannot be used.

1. **Build** the installer and code-sign it (Windows Authenticode).
2. **Prepare:** fetch the current list, then run the tool:

   ```
   curl -fsSL https://raw.githubusercontent.com/technowizsolutionsllp/app-releases/main/PinchPDF/index.json -o current-index.json
   node scripts/release-prepare.mjs PinchPDF 1.3.0 PinchPDF_1.3.0_x64-setup.exe --channel stable --notes "first change|second change" --notes-url https://technowizsolutions.com/pinchpdf/release-notes --rollout 5 --index current-index.json --repo technowizsolutionsllp/app-releases
   ```

   It hashes the installer, signs with the release key (asked for with a hidden prompt), writes `release-out/PinchPDF-v1.3.0/release.json` and the new `release-out/PinchPDF/index.json`, refuses a version already in the list, and prints the two commands below. (For the very first release there is no list yet: leave out `--index`.)
3. **Create the GitHub release with the installer first**, signed in to the **Technowiz account** (not your own). Either way, no code is pushed and nothing is cloned:
   - **In the browser:** open `https://github.com/technowizsolutionsllp/app-releases/releases/new`. In the tag box type the tag the tool printed (for example `PinchPDF-v1.3.0`) and choose *Create new tag on publish*. Drag in the installer and `release-out/PinchPDF-v1.3.0/release.json` (wait until both have finished uploading: the files go on before the release is published, which is what immutable releases require), set the title (`PinchPDF 1.3.0`) and the notes, tick *Set as a pre-release* for a beta, and click *Publish release*.
   - **Or with the GitHub CLI** (the tool prints the command): `gh release create PinchPDF-v1.3.0 <installer> <release.json> --repo technowizsolutionsllp/app-releases --title "PinchPDF 1.3.0" --notes "…" --latest=false --draft` (add `--prerelease` for beta), then, after checking the draft's installer, `gh release edit PinchPDF-v1.3.0 --repo technowizsolutionsllp/app-releases --draft=false`. The draft step matters: immutable releases do not accept files after a release is published. The CLI can hold both of your accounts: run `gh auth status`, and `gh auth switch --user technowizsolutionsllp` if another account is active. Using the wrong account gives a 404 or 403.
4. **Publish the list last:** in the same repository open `PinchPDF/index.json`, click the pencil icon, paste the contents of `release-out/PinchPDF/index.json` and commit to `main`. (Or clone, copy the file over, commit and push.) Doing it last means the list never points at a download that does not exist yet.
5. **Verify:** call the check endpoint with an older version and confirm it offers the release, the download link works, and the SHA-256 of the downloaded file matches. The list is cached for about 5 minutes by the website and a few minutes more by GitHub, so allow about 10 minutes.
6. **Roll out in steps:** the first entry starts at a small `rollout_percent` (for example 5). Edit the list to raise it to 25, then 100.
7. **Record it:** mention app-facing changes in the website changelog if the site changed too.

### Pausing, rolling back, forcing

- **Pause or withdraw:** edit the list: `rollout_percent: 0` holds the release (nobody is offered it, and no older release is offered instead; **a pause always wins, even over `mandatory` and `min_supported`**: a paused release is answered with `mandatory` false and `min_supported` empty, because the app forces an install that is below `min_supported` on its own copy, whatever the rollout says), `enabled: false` withdraws it (the previous enabled release is offered again). It takes effect within about 10 minutes. Installs that already have the release keep it, so the fix is a **newer** version, never a reused number.
- **Force an update:** `mandatory: true` on the new release, or raise `min_supported` to cut off old, insecure versions. A forced release goes to every affected app at once, whatever `rollout_percent` says, unless it is paused (rollout 0). Use sparingly and say why in the notes.

### How the app checks

`GET /api/pinchpdf/updates/v1/check?v=1.2.3&channel=stable&os=win11&arch=x64` for PinchPDF, and `/api/nodupe/updates/v1/check` for NoDupe. `v` is required; `channel` defaults to `stable`; `os` and `arch` are optional, up to 16 characters, and not stored.

```json
{
  "update_available": true,
  "product": "PinchPDF",
  "version": "1.3.0",
  "channel": "stable",
  "pub_date": "2026-12-01T00:00:00Z",
  "notes": ["Faster compression on large files", "Fixed a crash on encrypted PDFs"],
  "notes_url": "https://technowizsolutions.com/pinchpdf/release-notes",
  "download": { "url": "https://github.com/technowizsolutionsllp/app-releases/releases/download/PinchPDF-v1.3.0/PinchPDF_1.3.0_x64-setup.exe", "sha256": "…", "size": 48211000, "signature": "…" },
  "min_supported": "1.1.0",
  "mandatory": false,
  "rollout_percent": 25
}
```

A current app gets `{ "update_available": false, "latest": "1.3.0" }`. The server picks the newest `enabled` release for the channel that is newer than `v`: a stable app is offered stable releases only, a beta app the newest of stable and beta. The app then verifies the SHA-256, the Ed25519 signature (against the public key built into it) and the Windows code signature before running the installer. A 503 (`unconfigured` or `unavailable`) or 429 means "no update now": the app keeps running and asks again later.

### Rules that keep it safe and private

- **Privacy:** the request carries only the app version, channel, OS and architecture. It has no installation id and no customer id, so it is not linked to telemetry. The privacy policy (section 2.8) covers it in a draft paragraph. The IP address is seen by Cloudflare and, for the download, by GitHub.
- **Staged rollout without identifying anyone:** the server returns `rollout_percent`; the app compares it with a random number it keeps locally.
- **Signing keys:** the Ed25519 release key is kept offline or in a secret manager, never in a repository. Its public half is built into the app and set as `RELEASE_PUBLIC_KEY`. See "Key rotation" below.
- **Microsoft Store builds:** the Store updates those itself, so the app does not use this check there.
- **Rate limit and cache:** per-IP limit on the endpoint (`UPDATES_IP_LIMITER`), and the answer is cacheable at the edge for 5 minutes. If GitHub cannot be reached, the website keeps serving the last good list.

### Key rotation

The public key is built into every installed app, so the key cannot simply be swapped: an app that does not know the new key would reject every new release and its users would be stranded. Plan for rotation from the first release.

- **The website trusts up to four keys.** `RELEASE_PUBLIC_KEY` takes one public key, or several separated by commas: `"RELEASE_PUBLIC_KEY": "<key one>,<key two>"`. A list entry is accepted if **any** of them signed it. The setting is strict: spaces around commas are fine, but a repeated key, a malformed key, an empty part or more than four keys makes the whole setting invalid (the endpoints then answer 503 and Health check says so), so a typo can never silently drop a key.
- **The apps must trust the same list.** The app team builds a list of public keys into the app (more than one), and accepts a release if any of them verifies. The signed bytes do not change; there is no key id in the entry, the app simply tries each key.
- **Before the first release, make two keys.** Run `--keygen` twice. The **primary** key signs releases. The **backup** key is never used to sign; its seed is stored offline in a different place from the primary's. Both public keys go into the first app version and into `RELEASE_PUBLIC_KEY`.
- **Planned rotation** (for example yearly, or when staff change): sign new releases with the backup key. Nothing needs to be shipped, because every app already trusts it. Then make a new backup key, ship an app version that trusts it as well, and add it to `RELEASE_PUBLIC_KEY` once most users have that version.
- **If the primary seed may have leaked:** start signing with the backup key at once and ship an app version that no longer trusts the leaked key. Until users take that update, the leaked key is still accepted by the apps they have, so also protect the repository (two-factor authentication, few writers) and withdraw affected releases (`enabled: false`).
- **Removing a key from the website** (delete it from `RELEASE_PUBLIC_KEY`) makes the website ignore everything that key signed, including older releases still in the list. Re-sign those entries with the remaining key first, or remove them.

### Release checklist (app)

- [ ] Installer built and code-signed
- [ ] Prepared with the release tool (hash, size, signature, new list)
- [ ] GitHub release created with the installer attached (before the list)
- [ ] List published on `main` (after the release)
- [ ] Check endpoint offers it to an older version; download hash matches
- [ ] Starts at a small rollout; plan to raise it
- [ ] Notes written (major changes, plain language)
- [ ] Privacy and store text still accurate

### Turning it on (once, by you)

The code is idle until these exist. Nothing here needs a Cloudflare service or a card. Status as of 2026-11-22: steps 1 to 3 are done (step 3 takes effect when the branch is merged and deployed); steps 4 and 5, and two-factor authentication on the Technowiz account, are still to do.

1. **The public repository: done.** `https://github.com/technowizsolutionsllp/app-releases` exists in the Technowiz account (public), with an empty `PinchPDF/index.json` and `NoDupe/index.json` (`{ "product": "PinchPDF", "releases": [] }`), a ruleset on `main` that blocks branch deletion and force pushes, and immutable releases switched on. To check it from outside, open `https://raw.githubusercontent.com/technowizsolutionsllp/app-releases/main/PinchPDF/index.json` in a private window: it must load without signing in. Also turn on two-factor authentication for the Technowiz account (GitHub, Settings, Password and authentication) and keep its recovery codes offline.
2. **Release keys: done.** Two keys were made, a primary and a backup. To make keys: run `node scripts/release-prepare.mjs --keygen` twice. Keep each seed offline, in two different places (a password manager entry each, or an offline file; never a repository). The primary signs releases; the backup is only for rotation or a leak (see "Key rotation").
3. **Public keys in `wrangler.json`: done on the branch** (deploys with the merge). The setting goes under `"vars"`: `"RELEASES_REPO": "technowizsolutionsllp/app-releases"` (already added) and `"RELEASE_PUBLIC_KEY": "<primary public key>,<backup public key>"`. Both are public values, so plain variables are right. (`RELEASES_BRANCH` defaults to `main`.)
4. **To do: tell the app team** the exact repository (`technowizsolutionsllp/app-releases`), so their download allowlist is `github.com` with the path prefix `/technowizsolutionsllp/app-releases/releases/download/`, and give them **both** public keys, to be built into the app as a list.
5. **To do: publish the first release** as above, then open **Admin, Health check**: *App updates* should show your releases as valid.

### How the releases repository was set up (record, 2026-11-22)

This is exactly what was done, so it can be repeated or audited (for example to rebuild the repository, or to set up another one). It was done with the GitHub CLI, using the Technowiz account's saved login for each command only, without switching the CLI's active account. The same result can be reached in the GitHub web pages (New repository, then Settings, then Rules).

1. **Check which accounts the CLI knows and pick the Technowiz one for the commands that follow** (PowerShell; the token is held only in that shell session):

   ```powershell
   gh auth status
   $env:GH_TOKEN = (gh auth token --user technowizsolutionsllp)
   gh api users/technowizsolutionsllp --jq '{login,type,name}'   # type "User": a personal-type account, so the repository is created under /user/repos
   ```

2. **Create the public repository** with a first commit so that `main` exists, and with issues, wiki and projects off (nobody needs them here):

   ```powershell
   gh api -X POST user/repos -f name=app-releases `
     -f description="Signed release lists and installers for Technowiz Solutions apps (PinchPDF, NoDupe)" `
     -F private=false -F auto_init=true -F has_issues=false -F has_wiki=false -F has_projects=false
   ```

3. **Add the two empty release lists** (one commit each, on `main`). `<base64>` is the file's text encoded as base64; `{ "product": "PinchPDF", "releases": [] }` for `PinchPDF/index.json` and `{ "product": "NoDupe", "releases": [] }` for `NoDupe/index.json`:

   ```powershell
   gh api -X PUT repos/technowizsolutionsllp/app-releases/contents/PinchPDF/index.json `
     -f message="Add empty PinchPDF release list" -f content="<base64>" -f branch=main
   gh api -X PUT repos/technowizsolutionsllp/app-releases/contents/NoDupe/index.json `
     -f message="Add empty NoDupe release list" -f content="<base64>" -f branch=main
   ```

4. **Replace the generated README** with a short description (it says the repository holds no source code, what the two lists are, and that installers are attached to releases as `<Product>-v<version>`). This needs the existing file's `sha` (`gh api repos/technowizsolutionsllp/app-releases/contents/README.md --jq .sha`) passed as `-f sha=...` on the same `PUT`.

5. **Protect `main`** with a ruleset that blocks deleting the branch and force pushes. The body is sent from a file written without a byte-order mark, because piping it from PowerShell was rejected as invalid JSON:

   ```powershell
   # ruleset.json: {"name":"protect-main","target":"branch","enforcement":"active",
   #   "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
   #   "rules":[{"type":"deletion"},{"type":"non_fast_forward"}]}
   gh api -X POST repos/technowizsolutionsllp/app-releases/rulesets --input ruleset.json
   ```

   Pull requests are deliberately not required, so the lists can be edited in the browser; add `{"type":"pull_request", ...}` to the rules if you want review on every change.

6. **Turn on immutable releases** (a published release's installer and tag can no longer be changed or deleted):

   ```powershell
   gh api -X PUT repos/technowizsolutionsllp/app-releases/immutable-releases
   gh api repos/technowizsolutionsllp/app-releases/immutable-releases   # {"enabled":true,...}
   ```

7. **Check it is public and readable without signing in** (run without the token):

   ```powershell
   Remove-Item Env:GH_TOKEN
   (Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/technowizsolutionsllp/app-releases/main/PinchPDF/index.json).Content
   # { "product": "PinchPDF", "releases": [] }
   ```

8. **In this repository:** `"RELEASES_REPO": "technowizsolutionsllp/app-releases"` was added to `vars` in `wrangler.json`, and then `RELEASE_PUBLIC_KEY` with the two public keys (primary first, backup second, comma-separated). The website trusts both equally, so the setting does not say which is which. Record: the **primary** (signs releases) is `p9JxsF1_dxdTb3A4nPmpBg0ML68LtjYXKmDfdpxEALw`; the **backup** (kept offline, never used to sign unless rotating) is `WW3Qn6ADCPEWibnk1p75fT7YXN0dieXXWY0s1LuLAP8`. Public keys are not secret, so they can be written here; the seeds never are.

Not done by script, and needing a person: two-factor authentication on the Technowiz account, and keeping its recovery codes offline.

### What is built, and what is not

Built here: both endpoints and their Swagger entries, the release-list validation (signatures, tags, paths, limits), the 5-minute cache with last-good fallback, the per-IP limiter `UPDATES_IP_LIMITER`, request counters (`update_check`, by product and outcome, in `metrics_daily`; no chart yet), the Health check and probes, the prepare and key tools, shared test vectors (`test/release-vectors.json`, signed with a public test-only key) and tests.

Built in the PinchPDF app, not in this repository: the update check, download, hash and signature verification, the local rollout random number and the update prompt (`app_update.rs`). Not built for NoDupe, which still uses its own Tauri updater. Decided and recorded above: where the keys are kept (offline), the two-key setup and the repository. Still open: the signing format with the app team, Windows code signing, and the privacy wording (a draft paragraph is in section 2.8 of the privacy policy, for counsel).
