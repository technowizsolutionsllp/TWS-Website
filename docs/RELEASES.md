# Releases

How releases are handled. There are two kinds, and they work differently.

| Kind | What it is | Status |
|---|---|---|
| **A. Website and backend releases** | This repository: the site, the APIs, the admin area, the database migrations | In place. Follow section A. |
| **B. App releases** | The PinchPDF and NoDupe installers that users download and update to | **Server side built; switched off until you set it up** (see "Turning it on"). Installers and the release list live in a public GitHub repository. The app side (the check, download and verification inside PinchPDF and NoDupe) is the app team's. |

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

> **Status: the server side is built and tested; it is switched off until you set it up** (see "Turning it on"). The apps' side (the check, the download and the verification inside PinchPDF and NoDupe) is the app team's and is not in this repository.

The apps update themselves by asking the website whether a newer version exists. The website answers from a **signed release list** kept in a public GitHub repository. Installers are GitHub release assets, so there is no storage service to pay for or run. You publish a release by creating a GitHub release and committing the list; the website itself is not deployed.

### Where things live

One public repository for both products, for example `technowizsolutionsllp/app-releases` (the name is a setting, `RELEASES_REPO`). It holds only the lists; the installers are attached to releases.

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
- The list is read from `https://raw.githubusercontent.com/<RELEASES_REPO>/main/<Product>/index.json` and installers are downloaded from `https://github.com/<RELEASES_REPO>/releases/download/<tag>/<file>`. These are the only two hosts the website contacts for this, and the app should allow only that host and path prefix.
- **A released version is never replaced.** A fix is a new version. If someone swapped an installer on GitHub, the SHA-256 and signature in the list would no longer match and apps would refuse it.
- The list is versioned by git, so every change to a release (including a pause) has an author, a time and a diff.
- Protect the `main` branch of the repository (require a pull request or restrict who can push), and keep the number of people who can write to it small.

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
| `notes_url` | Link to the full release notes (https), optional |
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

### Publishing a release (manual)

1. **Build** the installer and code-sign it (Windows Authenticode).
2. **Prepare:** fetch the current list, then run the tool:

   ```
   curl -fsSL https://raw.githubusercontent.com/<RELEASES_REPO>/main/PinchPDF/index.json -o current-index.json
   node scripts/release-prepare.mjs PinchPDF 1.3.0 PinchPDF-1.3.0-x64.exe --channel stable --notes "first change|second change" --notes-url https://technowizsolutions.com/pinchpdf/release-notes --rollout 5 --index current-index.json --repo <RELEASES_REPO>
   ```

   It hashes the installer, signs with the release key (`RELEASE_SIGNING_KEY` or `--key-file`), writes `release-out/PinchPDF-v1.3.0/release.json` and the new `release-out/PinchPDF/index.json`, refuses a version already in the list, and prints the two commands below. (For the very first release there is no list yet: leave out `--index`.)
3. **Create the GitHub release with the installer first** (the tool prints this command): `gh release create PinchPDF-v1.3.0 <installer> <release.json> --repo <RELEASES_REPO> --title "PinchPDF 1.3.0" --notes "…"` (add `--prerelease` for beta).
4. **Publish the list last:** replace `PinchPDF/index.json` on `main` with the new file (GitHub's web editor, or clone, copy, commit and push). Doing it last means the list never points at a download that does not exist yet.
5. **Verify:** call the check endpoint with an older version and confirm it offers the release, the download link works, and the SHA-256 of the downloaded file matches. The list is cached for about 5 minutes by the website and a few minutes more by GitHub, so allow about 10 minutes.
6. **Roll out in steps:** the first entry starts at a small `rollout_percent` (for example 5). Edit the list to raise it to 25, then 100.
7. **Record it:** mention app-facing changes in the website changelog if the site changed too.

### Pausing, rolling back, forcing

- **Pause or withdraw:** edit the list: `rollout_percent: 0` holds the release (nobody is offered it, and no older release is offered instead), `enabled: false` withdraws it (the previous enabled release is offered again). It takes effect within about 10 minutes. Installs that already have the release keep it, so the fix is a **newer** version, never a reused number.
- **Force an update:** `mandatory: true` on the new release, or raise `min_supported` to cut off old, insecure versions. Use sparingly and say why in the notes.

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
  "download": { "url": "https://github.com/<RELEASES_REPO>/releases/download/PinchPDF-v1.3.0/PinchPDF-1.3.0-x64.exe", "sha256": "…", "size": 48211000, "signature": "…" },
  "min_supported": "1.1.0",
  "mandatory": false,
  "rollout_percent": 25
}
```

A current app gets `{ "update_available": false, "latest": "1.3.0" }`. The server picks the newest `enabled` release for the channel that is newer than `v`: a stable app is offered stable releases only, a beta app the newest of stable and beta. The app then verifies the SHA-256, the Ed25519 signature (against the public key built into it) and the Windows code signature before running the installer. A 503 (`unconfigured` or `unavailable`) or 429 means "no update now": the app keeps running and asks again later.

### Rules that keep it safe and private

- **Privacy:** the request carries only the app version, channel, OS and architecture. It has no installation id and no customer id, so it is not linked to telemetry. The privacy policy (section 2.8) covers it in a draft paragraph. The IP address is seen by Cloudflare and, for the download, by GitHub.
- **Staged rollout without identifying anyone:** the server returns `rollout_percent`; the app compares it with a random number it keeps locally.
- **Signing keys:** the Ed25519 release key is kept offline or in a secret manager, never in a repository. Its public half is built into the app and set as `RELEASE_PUBLIC_KEY`. Rotation means shipping an app that trusts both keys first, then switching (the website accepts one key today; supporting two is a small change).
- **Microsoft Store builds:** the Store updates those itself, so the app does not use this check there.
- **Rate limit and cache:** per-IP limit on the endpoint (`UPDATES_IP_LIMITER`), and the answer is cacheable at the edge for 5 minutes. If GitHub cannot be reached, the website keeps serving the last good list.

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

The code is deployed but idle until these exist. Nothing here needs a Cloudflare service or a card.

1. **Make the release key:** `node scripts/release-prepare.mjs --keygen`. Keep the seed offline (a password manager or an offline file, never a repository). The public key goes in step 4 and into the apps.
2. **Create the public repository** `app-releases` under the organisation (or another name; then use it everywhere below). Add `PinchPDF/index.json` and `NoDupe/index.json`, each containing `{ "product": "PinchPDF", "releases": [] }` (and `"NoDupe"` for the second). Protect the `main` branch.
3. **Install the GitHub CLI** if you will use `gh release create` (`gh auth login`), or create releases in the GitHub web page instead.
4. **Add to `wrangler.json`** under `"vars"`, then merge and deploy: `"RELEASES_REPO": "technowizsolutionsllp/app-releases"` and `"RELEASE_PUBLIC_KEY": "<the public key from step 1>"`. Both are public values, so plain variables are right. (`RELEASES_BRANCH` defaults to `main`.)
5. **Publish the first release** as above, then open **Admin, Health check**: *App updates* should show your releases as valid.

### What is built, and what is not

Built here: both endpoints and their Swagger entries, the release-list validation (signatures, tags, paths, limits), the 5-minute cache with last-good fallback, the per-IP limiter `UPDATES_IP_LIMITER`, request counters (`update_check`, by product and outcome, in `metrics_daily`; no chart yet), the Health check and probes, the prepare and key tools, shared test vectors (`test/release-vectors.json`, signed with a public test-only key) and tests.

Not built, and not in this repository: the apps' update check, download, hash and signature verification, the local rollout random number, and the update prompt. Still to decide: the release repository's name, where the release key is kept, and the privacy wording (a draft paragraph is in section 2.8 of the privacy policy, for counsel).
