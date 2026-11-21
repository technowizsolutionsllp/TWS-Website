# Releases

How releases are handled. There are two kinds, and they work differently.

| Kind | What it is | Status |
|---|---|---|
| **A. Website and backend releases** | This repository: the site, the APIs, the admin area, the database migrations | In place. Follow section A. |
| **B. App releases** | The PinchPDF and NoDupe installers that users download and update to | **Agreed design, not built yet.** Section B is the specification to build against. The update-check endpoint, the prepare script and their tests do not exist yet. |

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

> **Status: agreed design, not implemented.** Nothing below exists in the code yet. When it is built, update this section to say what is real.

The apps update themselves by asking the website whether a newer version exists. The website answers from a release list kept in Cloudflare R2. You publish a release by uploading files by hand; there is no deploy.

### What gets uploaded where

```
releases/
  PinchPDF/
    index.json                          the list of releases the server reads
    stable/1.3.0/PinchPDF-1.3.0-x64.exe
    stable/1.3.0/release.json           notes, hash, signature, size
    beta/1.4.0-beta.1/...
  NoDupe/
    index.json
    stable/2.1.0/NoDupe-2.1.0-x64.exe
    ...
```

- One bucket, one folder per product, then channel (`stable` or `beta`), then version.
- The folder names are exact and case-sensitive (`PinchPDF`, `NoDupe`). The prepare script and the server both enforce them.
- Installers are served from a public address of the bucket (a custom domain, to be chosen). Downloads come straight from R2, not through the Worker.
- **A released file is never overwritten.** A fix is a new version.

### `index.json`

One entry per release:

| Field | Meaning |
|---|---|
| `version` | Semantic version, unique within the product |
| `channel` | `stable` or `beta` |
| `pub_date` | When it was published (RFC 3339) |
| `notes` | A short list of the major changes shown to the user |
| `notes_url` | Link to the full release notes |
| `file` | Path of the installer in the bucket |
| `sha256`, `size` | Of the installer |
| `signature` | Ed25519 signature over `product`, `version`, `sha256` and `size` (not just the file, so an old release cannot be replayed as a new one) |
| `min_supported` | Apps below this version are told to update |
| `mandatory` | The app must update before it continues |
| `rollout_percent` | 0 to 100, how many installs are offered it |
| `enabled` | `false` withdraws the release |

### Publishing a release (manual)

1. **Build** the installer and code-sign it (Windows Authenticode).
2. **Prepare:** `node scripts/release-prepare.mjs PinchPDF 1.3.0 <installer> --channel stable --notes "…"` computes the hash and size, signs with the release key, writes `release.json`, and adds the entry to a local copy of `index.json`. *(Planned script.)*
3. **Upload in this order:** the installer, then `release.json`, then `index.json` **last**, so the list never points at a file that is not there yet. Use the Cloudflare dashboard or `wrangler r2 object put`.
4. **Verify:** call the check endpoint with an older version and confirm it offers the release, the download link works, and the SHA-256 of the downloaded file matches.
5. **Roll out in steps:** publish at a small `rollout_percent` (for example 5), watch for problems, then raise it to 25 and 100 by editing `index.json` and uploading it again.
6. **Record it:** add the release notes page or link, and mention app-facing changes in the website changelog if the site changed too.

The server reads `index.json`, caches it for about 5 minutes, and ignores a malformed entry (it keeps serving the last good list). The Health check will show an invalid or stale list.

### Pausing, rolling back, forcing

- **Pause or withdraw:** set `rollout_percent` to 0 or `enabled` to `false` and upload `index.json`. It takes effect within the cache time. Installs that already have the release keep it, so the fix is a **newer** version, never a reused number.
- **Force an update:** `mandatory: true` on the new release, or raise `min_supported` to cut off old, insecure versions. Use sparingly; say why in the notes.

### How the app checks (planned endpoint)

`GET /api/<product>/updates/v1/check?v=1.2.3&channel=stable&os=win11&arch=x64`, for PinchPDF and NoDupe.

```json
{
  "update_available": true,
  "version": "1.3.0",
  "pub_date": "2026-12-01T00:00:00Z",
  "notes": ["Faster compression on large files", "Fixed a crash on encrypted PDFs"],
  "notes_url": "https://technowizsolutions.com/pinchpdf/release-notes",
  "download": { "url": "https://…/PinchPDF-1.3.0-x64.exe", "sha256": "…", "size": 48211000, "signature": "…" },
  "min_supported": "1.1.0",
  "mandatory": false,
  "rollout_percent": 25
}
```

A current app gets `{ "update_available": false, "latest": "1.3.0" }`. The server picks the newest `enabled` release for the channel that is newer than `v`. The app then verifies the SHA-256, the Ed25519 signature (against the public key built into the app) and the Windows code signature before running the installer.

### Rules that keep it safe and private

- **Privacy:** the request carries only the app version, channel, OS and architecture. It has no installation id and no customer id, so it is not linked to telemetry. The privacy policy (section 2.8) must mention this before the endpoint ships. The IP address is seen by Cloudflare as with any request.
- **Staged rollout without identifying anyone:** the server returns `rollout_percent`; the app compares it with a random number it keeps locally.
- **Signing keys:** the Ed25519 release key is kept offline or in a secret manager, never in this repository. Its public half is built into the app. Rotation means shipping an app that trusts both keys first, then switching.
- **Microsoft Store builds:** the Store updates those itself, so the app does not use this check there.
- **Rate limit and cache:** per-IP limit on the endpoint, and the answer is cacheable at the edge.

### Release checklist (app)

- [ ] Installer built and code-signed
- [ ] Release signed, `release.json` and `index.json` prepared
- [ ] Uploaded in order: installer, `release.json`, `index.json`
- [ ] Check endpoint offers it to an older version; download hash matches
- [ ] Starts at a small rollout; plan to raise it
- [ ] Notes written (major changes, plain language)
- [ ] Privacy and store text still accurate

### Not built yet

The endpoint and its Swagger entry, the prepare script, the Worker's R2 binding and index validation, the Health check for the list, tests, the public download address, the release-key custody decision, and the privacy-policy line.
