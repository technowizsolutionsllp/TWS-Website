# Technowiz Solutions website

The marketing site for Technowiz Solutions (products: PinchPDF, NoDupe) and the backend services the PinchPDF app talks to. It is a vinext (Next.js on Cloudflare Workers) app with a D1 database.

| Area | What it is | Docs |
|---|---|---|
| Website | Marketing pages, contact and support forms, legal pages | `app/` |
| Trial service | PinchPDF free-trial registration: sealed, rate-limited API with one trial per computer | [docs/PINCHPDF_TRIAL_SERVICE.md](docs/PINCHPDF_TRIAL_SERVICE.md) |
| App telemetry | Buy clicks and license events reported by the app (activate, deactivate, change key) | [docs/PINCHPDF_TELEMETRY.md](docs/PINCHPDF_TELEMETRY.md) |
| Admin | `/admin`: Insights (Trials, Buying, Licenses, Devices tabs), Health check, API docs link | [docs/ADMIN.md](docs/ADMIN.md) |
| API docs | Swagger at `/api/pinchpdf/trial/docs` (own login) covering the trial, telemetry and Insights JSON endpoints | |
| Brand | Guidelines, logos, icons | [docs/TECHNOWIZ_BRAND_GUIDELINES.md](docs/TECHNOWIZ_BRAND_GUIDELINES.md) |

How it fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What changed and when: [CHANGELOG.md](CHANGELOG.md). Every document, and when each must be updated: [Documentation](#documentation).

## Site map

Every address the site serves. `/sitemap.xml` (`app/sitemap.ts`) lists the public pages for search engines; the admin Health check probes all of them.

```
Public pages
  /                          Home
  /about                     About
  /nodupe   /pinchpdf        Product pages (also /products/[slug]; /pdf-compressor redirects to /pinchpdf)
  /get-support               Support form
  /privacy                   Privacy Policy (13 sections + Annex A: PinchPDF free-trial privacy notice)
  /terms                     Terms of Service (Part A website terms, Part B software license
                             with Schedule A PinchPDF and Schedule B NoDupe; the free-trial terms are Schedule A, Part 2)
  /legal                     Index of the legal documents with last-updated dates
  /robots.txt  /sitemap.xml  /manifest.webmanifest

Redirects kept for the app and older links (307)
  /pinchpdf/legal/privacy      (and /…/<version>)  ->  /privacy#pinchpdf-trial
  /pinchpdf/legal/trial-terms  (and /…/<version>)  ->  /terms#schedule-a-trial
  /license                                         ->  /terms#software-license

APIs
  /api/contact  /api/get-support                   Website forms (email via Resend)
  /api/pinchpdf/trial/v1/{challenge,register,usage,telemetry}   The PinchPDF app (sealed envelope)
  /api/pinchpdf/insights/v1/{buying,licenses,devices}           Insights JSON (admin login)
  /api/pinchpdf/updates/v1/check  /api/nodupe/updates/v1/check  Does a newer app version exist (plain GET, no personal data)
  /api/pinchpdf/trial/docs                         Swagger UI (own login), plus /spec and /health

Admin (HTTP Basic login)
  /admin                     Home
  /admin/insights            Trials, Buying, Licenses, Devices tabs
  /admin/health              Health check
```

The legal pages in detail, with their anchors, are in [docs/legal/STRUCTURE.md](docs/legal/STRUCTURE.md#page-structure).

## Getting started

Needs Node 22.13 or newer.

```
npm ci
copy .dev.vars.example .dev.vars          # fill with random values (see the file for how)
npx wrangler d1 migrations apply TRIAL_DB --local --config wrangler.json
npm run dev
```

| Command | Does |
|---|---|
| `npm test` | Vitest inside workerd with a real local D1 |
| `npm run typecheck`, `npm run lint` | Static checks |
| `npm run build` | Production build |
| `node scripts/trial-smoke.mjs [url]` | Trial register and usage flow over HTTP |
| `node scripts/telemetry-smoke.mjs [url]` | Telemetry events and the Insights JSON API over HTTP. Writes rows: use local or staging (it refuses production without `--yes-production`) |
| `node scripts/telemetry-purge.mjs [--run --remote]` | Deletes telemetry events older than 24 months, or `--erase <customer-uuid>` for one customer. Dry run unless `--run` is given |
| `node scripts/release-prepare.mjs ...` | Signs an app release and prepares its `index.json` for manual upload to R2 (`--keygen` makes the release key). See [docs/RELEASES.md](docs/RELEASES.md) |
| `node scripts/trial-admin.mjs ...` | Operator actions on trials (reset, revoke, erase), audited |
| `node scripts/generate-trial-vectors.mjs`, `node scripts/generate-telemetry-vectors.mjs` | Regenerate the shared protocol vectors the app team tests against |

## Configuration

Plain settings and bindings live in `wrangler.json` (the source of truth: a deploy overwrites dashboard-only variables and bindings). Secrets are set as type **Secret** in the Cloudflare dashboard (Workers, `tws-website`, Settings, Variables and Secrets), never as plain variables.

| Secret | Used for |
|---|---|
| `PEPPER`, `PEPPER_EMAIL`, `PII_KEY`, `CHALLENGE_KEY`, `TRIAL_KEY_<kid>` | Trial and telemetry hashing, encryption and the sealed envelope. Losing `PEPPER` or `PII_KEY` makes stored data unreadable: keep an offline backup |
| `ADMIN_USER`, `ADMIN_PASSWORD` | `/admin` and the Insights JSON API. Both answer 404 until set |
| `DOCS_USER`, `DOCS_PASSWORD` | The Swagger docs |
| `RESEND_API_KEY` | Contact and support email |

The database is the D1 database `pinchpdf`. Apply migrations with `wrangler d1 migrations apply` (not by pasting SQL in the dashboard): `0001` trials, `0002` admin metrics, `0003` telemetry. The admin **Health check** page shows what is missing.

## Testing and deploy safety

CI (`.github/workflows/ci.yml`) runs typecheck, lint, the full test suite, checks that both shared vector files match their generators, a production build and a `wrangler deploy --dry-run`. The tests include deploy guards: bindings used in code but missing from `wrangler.json`, duplicate rate-limit ids, migration numbering, schema drift, and any API route missing from Swagger or the health page. After deploying to staging, run the smoke scripts and open **Admin, Health check**. Details: [docs/PINCHPDF_TELEMETRY.md](docs/PINCHPDF_TELEMETRY.md#testing).

## Releases

There are two kinds of release, described in [docs/RELEASES.md](docs/RELEASES.md):

- **Website and backend** (this repository): a PR with a changelog line, green CI, a merge commit, migrations applied first, then the Health check and smoke tests after the deploy. To name a version, move the changelog's `Unreleased` entries under a new heading, bump `version` in `package.json` and tag the merge commit (`vX.Y.Z`).
- **App installers** (PinchPDF and NoDupe): uploaded by hand to Cloudflare R2 under `releases/PinchPDF/` and `releases/NoDupe/`, listed in a signed `index.json` per product, and offered to the apps through the update-check endpoints, with staged rollout, mandatory updates and signed downloads. **The server side is built but switched off** until you create the bucket and set the base URL and release key ("Turning it on" in the document); the apps' side is the app team's.

## Documentation

Everything written down about this project, in one list. If a document is not here, add it here.

| Document | What it is for | Audience |
|---|---|---|
| [README.md](README.md) | Entry point: what the project is, setup, configuration, testing, this index | Everyone |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version, with PR links, deploy notes and the interface versions | Everyone |
| [docs/RELEASES.md](docs/RELEASES.md) | How releases are handled: website versions and deploys, and the app release flow (R2 uploads, release list, update check, rollout, rollback) | Everyone who ships |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the system is built: layers, code layout, data, security model, admin, deploy flow, decisions | Developers |
| [docs/PINCHPDF_TRIAL_SERVICE.md](docs/PINCHPDF_TRIAL_SERVICE.md) | Trial service runbook: first deploy, operator actions, key rotation, deviations from the plan | Operator, developers |
| [docs/ADMIN.md](docs/ADMIN.md) | Operator guide to `/admin`: Insights tabs, login, request counters, Health check | Operator |
| [docs/PINCHPDF_TELEMETRY.md](docs/PINCHPDF_TELEMETRY.md) | Telemetry contract for the app team, Insights definitions, testing, deploy checklist, privacy status, limits | App team, operator |
| API reference (Swagger) | Live OpenAPI spec at `/api/pinchpdf/trial/docs`; source is `lib/trial/openapi.ts` | App team |
| [docs/TECHNOWIZ_BRAND_GUIDELINES.md](docs/TECHNOWIZ_BRAND_GUIDELINES.md) | Brand voice, logo, colour, typography, icons, page formula | Design, marketing |
| [docs/marketing-package/](docs/marketing-package/README.md) | Brand assets and briefs: logo concepts, website copy, social templates, tokens, icon sheets | Design, marketing |
| `.dev.vars.example` | The local secrets a developer must create, and how to generate them | Developers |
| `test/*-protocol-vectors.json` (+ `.sha256`) | Shared test vectors for the app team; copied byte-identically into the app repository | App team |
| Header comments in `lib/trial/config.ts`, `migrations/*.sql`, `scripts/*` | The environment contract, schema meaning and script usage, next to the code they describe | Developers |
| [docs/legal/STRUCTURE.md](docs/legal/STRUCTURE.md) | How the legal documents are laid out at `/privacy` and `/terms`, what changed in the text, and the open owner decisions | Owner, counsel |
| [docs/legal/LEGAL_COUNSEL_MEMO.md](docs/legal/LEGAL_COUNSEL_MEMO.md), [docs/legal/PRIVACY_LEGAL_REVIEW.md](docs/legal/PRIVACY_LEGAL_REVIEW.md) | AI-prepared legal review notes (not legal advice); the memo supersedes the review where they differ | Owner, counsel |

### Keeping the documents current

A change is not finished until the documents it touches are updated in the same pull request. Find your change in the left column.

| When you... | Update |
|---|---|
| Merge anything a user, operator or the app team could notice | `CHANGELOG.md`: add a line under `Unreleased` (Added, Changed, Fixed, Security), with the PR link |
| Release (deploy a set of changes you want to name) | `CHANGELOG.md`: move `Unreleased` under a new version heading and date, bump `version` in `package.json`, tag the merge commit (details in `docs/RELEASES.md`) |
| Change how app releases are published or offered (R2 layout, release list fields, update-check endpoint, rollout rules) | `docs/RELEASES.md` section B, `lib/trial/openapi.ts` for the endpoint, the app team, and Interface versions in the changelog |
| Add, rename or remove a page or route | The README site map, `app/sitemap.ts`, the Health check probes (`lib/admin/health-targets.ts`), and for a legal page `/legal` and `docs/legal/STRUCTURE.md` |
| Add or move an endpoint, table, binding, secret or directory, or change a layer | `docs/ARCHITECTURE.md` (sections 1 to 7), and the README configuration table for a secret |
| Change a trial endpoint, field, result code or operator action | `docs/PINCHPDF_TRIAL_SERVICE.md`, `lib/trial/openapi.ts`, regenerate `test/trial-protocol-vectors.json` with `scripts/generate-trial-vectors.mjs`, tell the app team, and note it under Interface versions in the changelog |
| Change the telemetry contract, an Insights definition or a chart | `docs/PINCHPDF_TELEMETRY.md`, `lib/trial/openapi.ts`, `scripts/generate-telemetry-vectors.mjs` and the vectors, the app team, and Interface versions |
| Add a migration | The table in `docs/ARCHITECTURE.md` section 4, the migration list in this README, the health check's required tables, the changelog (with the command to apply it) |
| Add or change an environment variable, secret or rate limiter | `wrangler.json`, the header of `lib/trial/config.ts`, `.dev.vars.example` if it is a secret, the README configuration table, and the Health check |
| Add an admin page or Insights tab | `docs/ARCHITECTURE.md` section 6, `docs/ADMIN.md`, the health probes (a test fails if a route is missing) |
| Change what personal data is collected, kept or shown, or for how long | The privacy and terms pages, `/legal` and `docs/legal/STRUCTURE.md`, and the effective-date keys (`app/privacy`, `app/terms`, `app/pinchpdf/legal/versions.ts`; the trial pages always show the latest text, and `TRIAL_*_VERSION` in `wrangler.json` must equal the latest key, which a test checks), the trial and telemetry docs, and the Privacy and legal status section below. Wording is for the owner and counsel to approve |
| Change a script or the CI workflow | The README commands table, the testing paragraph here and in the trial and telemetry docs |
| Change brand, logo, colours or product copy | `docs/TECHNOWIZ_BRAND_GUIDELINES.md`, the relevant file in `docs/marketing-package/`, `lib/brand-system.ts` |
| Add a document | The table above |

Reviewers: ask "which row of this table applies?" before approving. The tests catch some drift (a route missing from Swagger or the health page, vectors out of date, migration numbering), but not stale prose.

## Privacy and legal status (open items)

The privacy and terms pages and the trial notices are drafts (`reviewed: false` in `app/pinchpdf/legal/versions.ts`). A counsel-style review prepared by an AI model, not a lawyer, lists what must be settled before the trial registration ships (see [docs/legal/LEGAL_COUNSEL_MEMO.md](docs/legal/LEGAL_COUNSEL_MEMO.md); its points are marked for verification by a licensed advocate). Where it meets the code in this repository:

- **Telemetry changes a promise.** The legal text and the PinchPDF README say licensed users send nothing to a server. Telemetry sends license events from licensed installs, so those statements, the store listings and in-app text must change before the app ships it.
- **Consent is collected in the app.** Decided: the installer and the trial acceptance screen show the choices; consent to the computer check is required for the trial; buy clicks are optional (declining blocks nothing); activation events rely on legitimate interest with a right to object. The server trusts the app not to send `buy_clicked` without consent and stores no consent evidence for telemetry (unlike the trial registration). A server-side gate is possible as a protocol change. India's DPDP Act has no general legitimate-interest basis, so counsel should check the activation events.
- **Retention.** Telemetry events are kept 24 months (the GDPR sets no fixed period; this is the owner's documented choice), then deleted by `scripts/telemetry-purge.mjs`, which also erases one customer on request. The purge is run by hand until a scheduled trigger is added; the Health check warns when it is overdue. The trial data periods in the trial notice are separate and still need their own purge.
- **Pseudonymised, not anonymous.** Device and license values are keyed hashes of persistent identifiers. Describe them that way. If the app sends `trial_id`, telemetry can be linked to the trial's encrypted name and email.
- **Records.** The processing register, the balancing test and impact assessment, processor agreements and an incident runbook should cover telemetry as well as the trial.
- **Translations.** The notices must exist in the product's languages, with English controlling.
- **What already fits.** No names, emails, raw license keys or raw device values are stored; logs hold result codes only; both are covered by tests.

Nothing here is legal advice. Decisions on wording, retention periods and consent design are for the owner and a licensed advocate.
