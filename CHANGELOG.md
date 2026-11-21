# Changelog

All notable changes to the Technowiz Solutions website and its backend services. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). How the system fits together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## About the versions

The repository had no release tags and `package.json` has always said `0.1.0`. The versions below were assigned **afterwards** from the merged pull requests and commit history (Aug to Nov 2026), so each one is a point in history, not a build that was tagged at the time. From here on a version is created when a change is released: move the `Unreleased` entries under a new heading, bump `version` in `package.json` and tag the merge commit (`git tag v0.8.0`). Until that is done, `package.json` does not match the latest heading.

- Minor (`0.x.0`): a feature or an interface change (new page, API, endpoint, migration).
- Patch (`0.x.y`): fixes and small adjustments.
- `1.0.0`: reserved for when the PinchPDF trial and telemetry are live in production with reviewed legal text.

Interfaces that carry their own version are listed in [Interface versions](#interface-versions) at the end.

Entries link to pull requests in [technowizsolutionsllp/TWS-Website](https://github.com/technowizsolutionsllp/TWS-Website). Changes pushed without a pull request are marked "direct".

## [Unreleased]

Branch `telemetry-insights`, not yet merged or deployed.

### Added
- **PinchPDF app telemetry.** New sealed endpoint `POST /api/pinchpdf/trial/v1/telemetry` for buy clicks and license events (activated, deactivated, key changed), with plan (Individual or Business), a customer UUID as the common reference, and the same hashed device signals and app and OS version as the trial. No name or email. Events are signed with the install key, bound to the customer on first sight, idempotent on `event_id`, and rate limited per IP and per customer.
- **Insights tabs.** `/admin/insights` now has Trials, Buying, Licenses and Devices tabs. Buying shows buy attempts that were converted, pending or abandoned within a configurable window (`INSIGHTS_ABANDON_DAYS`, default 7); Licenses shows active licenses over time by plan; Devices shows deactivations (moved, same device, unused) and key changes. A deactivation is not counted as churn.
- **Insights JSON API.** `GET /api/pinchpdf/insights/v1/{buying|licenses|devices}` with the admin login, returning the same numbers as the charts.
- **Swagger.** The telemetry endpoint and the Insights API are described in the OpenAPI spec; a test fails when a route is missing from it.
- **Health check** covers the telemetry tables, both telemetry limiters and the telemetry and Insights API routes.
- **Migration `0003_telemetry.sql`:** `telemetry_customers`, `telemetry_devices`, `telemetry_events`.
- **Rate limiters** `TELEMETRY_IP_LIMITER` (namespace 1008) and `TELEMETRY_CUSTOMER_LIMITER` (1009).
- **Tests:** telemetry handler, edge cases, Insights computation (including seeded property tests against a reference model), health, shared protocol vectors written by an independent generator, and deploy-configuration guards (bindings, rate-limit ids, migration numbering, schema drift). 266 tests in total.
- **Smoke script** `scripts/telemetry-smoke.mjs`, which refuses to write to production without `--yes-production`.
- **CI:** telemetry vectors freshness check and `wrangler deploy --dry-run`.
- **Documentation:** root `README.md`, `docs/ARCHITECTURE.md`, this changelog, `docs/PINCHPDF_TELEMETRY.md`; `docs/PINCHPDF_TRIAL_SERVICE.md` updated.

### Needs doing before this ships
- Apply migration 0003 (`npx wrangler d1 migrations apply pinchpdf --remote`) and run the smoke script on staging.
- Give the app team `docs/PINCHPDF_TELEMETRY.md`, the Swagger spec and `test/telemetry-protocol-vectors.json`.
- Update the privacy and terms text, store listings and in-app text: telemetry means licensed installs now send events, which the current wording says they do not. Open privacy and legal items are listed in the README.
- Not built yet: a server-side consent gate that stores consent evidence, and a retention and purge policy.

## [0.7.1] - 2026-11-21

### Fixed
- `/admin/insights` no longer answers 503 when `trials.product` is missing (migration 0002 not applied): every trial is treated as PinchPDF and a notice names the migration command. ([#12](https://github.com/technowizsolutionsllp/TWS-Website/pull/12))
- Every Insights panel is drawn even with no data (empty axes and zero bars instead of "Not available yet").

## [0.7.0] - 2026-11-21

### Added
- **Admin health check** at `/admin/health`: live status per item with the error when something fails, refreshing on demand or every 30 seconds, 1 minute or 5 minutes. Server checks (D1, tables and migration 0002, trial secrets, rate limiters, email settings, docs login), a trial API self-test that seals real `register` and `usage` requests to the server's own handlers for every accepted key id without writing, the server public key per `kid`, and browser probes of the trial, contact, support, admin and docs routes, every site page and site files. ([#11](https://github.com/technowizsolutionsllp/TWS-Website/pull/11))
- `scripts/trial-pubkey.mjs` derives the public key from an existing private key.
- `GET /api/pinchpdf/trial/docs/health` reports configuration problems (names and reasons, never values).

### Changed
- **Trial secrets are validated.** `PII_KEY` and `TRIAL_KEY_<kid>` must be exactly 32 bytes in base64url; hex is called out by name. Any missing or malformed secret makes the three trial endpoints answer **503** with one `config_invalid` log line, instead of a silent 400 or a crash. Refused sealed requests log a reason and the `kid` (capped per minute).

### Deploy note
- With hex values for `PII_KEY` and `TRIAL_KEY_k1`, the trial endpoints answer 503 until both are re-set as 43-character base64url values and the app embeds the matching public key.

## [0.6.0] - 2026-11-21

### Added
- **Admin area.** `/admin` home and `/admin/insights`: KPIs, new trials, requests by endpoint, trial lifecycle, register outcomes, uses per trial, app versions and Windows builds, a product selector and any date range up to 366 days (weekly totals above 120 days). HTTP Basic login with `ADMIN_USER` and `ADMIN_PASSWORD`, 404 when unset, per-IP `TRIAL_ADMIN_LIMITER`. Aggregates only; no scripts; strict CSP. ([#10](https://github.com/technowizsolutionsllp/TWS-Website/pull/10))
- **Request counters** (`lib/trial/metrics.ts`), batched in memory so a flood cannot exhaust D1 writes and a counter failure never fails a request. Approximate by design.
- **Migration `0002_admin_metrics.sql`:** `trials.product`, `metrics_daily`, an index on `trials.created_at`.

## [0.5.2] - 2026-11-21

### Changed
- Minimum docs password length lowered from 16 to 8 characters. The routes still answer 404 below it and stay closed when either secret is missing; the per-IP limiter (20 a minute) is the main guard against guessing. ([#9](https://github.com/technowizsolutionsllp/TWS-Website/pull/9))

## [0.5.1] - 2026-11-21

### Added
- Diagnostics that log which trial and docs secrets are present or missing (names only, never values), once per Worker instance. The runbook now warns that secrets must be type Secret, not a plain Variable, because a deploy removes dashboard-only variables. This came from the docs returning 404 after `DOCS_USER` was added as a Variable. ([#8](https://github.com/technowizsolutionsllp/TWS-Website/pull/8); [#7](https://github.com/technowizsolutionsllp/TWS-Website/pull/7) was closed as a duplicate)

## [0.5.0] - 2026-11-21

### Added
- **PinchPDF free-trial registration service**, protocol v1 rev 3: one trial per computer, with the trial identity, limit and count held on the server. ([#6](https://github.com/technowizsolutionsllp/TWS-Website/pull/6))
  - Endpoints `challenge` (plain JSON proof of work), `register` and `usage` (sealed X25519, HKDF and AES-GCM envelope). Logic in `lib/trial/`.
  - Device matching policy: a stored row blocks a request when at least one signal is usable in both and at least `min(2, usable)` are equal.
  - Contact data encrypted at rest; device signals kept only as keyed hashes.
  - Migration `0001_trials.sql` (`trials`, `trial_audit`).
  - Operator tools: `scripts/trial-admin.mjs` (find, reset-device, adjust-limit, revoke, unrevoke, erase-contact, delete-all, export-contact), key generator, smoke test, shared vectors generator.
  - Swagger UI and OpenAPI spec at `/api/pinchpdf/trial/docs` behind HTTP Basic login (404 until `DOCS_USER` and `DOCS_PASSWORD` are set).
  - Draft versioned trial terms and privacy pages under `/pinchpdf/legal/…` (`reviewed: false`).
  - CI workflow with typecheck, lint, tests, vector check, build and a production dependency audit.
  - Vitest with the Cloudflare plugin (tests run in workerd against a local D1).
- Rate limiters `TRIAL_CHALLENGE_LIMITER`, `TRIAL_REGISTER_LIMITER`, `TRIAL_USAGE_LIMITER`, `TRIAL_USAGE_IP_LIMITER`, `TRIAL_DOCS_LIMITER`.

### Security
- `next` 16.3.6 to 16.4.6 and `react`, `react-dom`, `react-server-dom-webpack` 19.2.6 to 19.2.9, clearing two critical advisories.
- Audit fixes: longer placeholder list, per-IP limiter on `/usage`, only `cf-connecting-ip` trusted, CSP and fallback limiter on the docs, stricter CLI input.

### Known gaps at release
- Placeholder D1 database id (replaced afterwards), unmeasured CPU and write counts on the Free plan, the existing `/privacy` page still said trial counters stay on the device, and ten high advisories remain in dev tooling only.

## [0.4.0] - 2026-11-19

Direct commits, no pull request.

### Added
- **`/get-support` page** with a Resend-backed form: name, email, product, subject, description, screenshots (paste supported) and files, a "Get logs" picker for the exported `<Product>_<date-time>_log.zip`, a honeypot field, and delivery to `CONTACT_TO_EMAIL` plus the company mailbox with Reply-To set to the user. Linked from the More menu, footer and sitemap; the privacy policy mentions the form and attachments.
- `/api/get-support` shares the contact limiter (5 a minute per client), rejects oversized uploads early with 413, and the multipart body limit is raised to 22 MB for attachments up to 20 MB.
- 250 px logo assets, a 1920x1080 banner, a "Fit to frame" icon and regenerated light and dark 500-icon sheets, dev launch configuration.

### Changed
- Card content aligned across product and home pages; About card alignment fixed; legal and support layouts left-aligned.

## [0.3.0] - 2026-10-08

### Security
- `next` 16.2.6 to 16.3.6 (`npm audit --omit=dev` reported 0 vulnerabilities after the upgrade). ([#5](https://github.com/technowizsolutionsllp/TWS-Website/pull/5))
- Baseline security headers: nosniff, referrer policy, frame denial, permissions policy, HSTS.
- `/api/contact`: JSON content type required (415), 16 KB body cap (413), non-object bodies rejected, newlines stripped from the subject, and 5 requests a minute per client (429 with `Retry-After`) using the `CONTACT_RATE_LIMITER` binding with an in-memory fallback.
- `<` escaped in all JSON-LD payloads through a shared helper.

### Changed
- Route renamed `/pdf-compressor` to `/pinchpdf`; the old URLs redirect permanently (308).
- `https://technowizsolutions.com` is the single site URL for metadata, robots, sitemap and structured data.

### Not done at release
- No site-wide Content-Security-Policy (inline JSON-LD and styles need a nonce or hash). The rate-limit namespace id `1001` was a placeholder chosen without a real deploy to test against.

## [0.2.1] - 2026-09-10

### Changed
- Legal pages use a two-column layout with a sticky table of contents that follows scroll position (`LegalToc`), collapsing to a scrollable strip on small screens. Footer logo enlarged; the email address and the location line removed. ([#4](https://github.com/technowizsolutionsllp/TWS-Website/pull/4))

### Fixed
- Footer and legal breakpoint overrides sat before their base rules in the stylesheet, so the tablet and mobile collapse never applied. Base rules moved ahead of the media queries.

## [0.2.0] - 2026-09-09

### Added
- `/terms` and `/privacy` for NoDupe and PinchPDF: licence grant and restrictions, anti-piracy, intellectual property and complaints channel, security and vulnerability disclosure, trial and purchase terms with Lemon Squeezy as merchant of record, worldwide privacy rights (GDPR and UK GDPR, India DPDP with a grievance officer, CCPA and CPRA), export control, mandatory consumer-rights carve-outs. ([#3](https://github.com/technowizsolutionsllp/TWS-Website/pull/3))
- Multi-column site footer on every page and a shared "More" navigation menu (About, Privacy Policy, Terms of Service).

### Fixed
- Dropdown menus stayed open too long and two could be open at once; they now close immediately and a small event bus (`navMenuBus.ts`) lets one menu close the other.

## [0.1.1] - 2026-09-02

Direct commits, no pull request.

### Changed
- Product renamed from "PDF Compressor" to **PinchPDF**.
- Contact email sender configured (`CONTACT_FROM_EMAIL`), Cloudflare account id pinned, Resend failures logged, form environment values trimmed.
- `vinext` upgraded (and `@vitejs/plugin-rsc` to 0.5.34).

### Fixed
- Every in-app navigation threw "ee is not a function" in the production bundle only; fixed by the `vinext` upgrade.
- A successful contact submission crashed in the form because `event.currentTarget` was read after an `await`.
- `nodejs_compat` was declared twice and failed deploys with error 10021; it is declared in exactly one place and `wrangler deploy` no longer rebuilds.

## [0.1.0] - 2026-08-28

### Added
- **Technowiz Solutions marketing site** (home, About, product pages for NoDupe and PinchPDF) and brand package: guidelines, logos, design tokens, a 500-icon system, product app icons and marketing copy briefs, from a prototype of 2026-08-24. ([#1](https://github.com/technowizsolutionsllp/TWS-Website/pull/1), [#2](https://github.com/technowizsolutionsllp/TWS-Website/pull/2))
- **Contact popup and `/api/contact`**, sending through Resend (`RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`).
- Cloudflare Workers deploy configuration (`wrangler.json`) and a preview deploy script.

## Interface versions

These change independently of the site version. Change one of them and say so in the entry above.

| Interface | Current | Where it is defined | Notes |
|---|---|---|---|
| Trial protocol | v1 (rev 3) | `PROTOCOL_VERSION` in `lib/trial/config.ts`; vectors `test/trial-protocol-vectors.json` | The app embeds the server public key per `kid` |
| Telemetry protocol | v1 (`proto: 1`) | `lib/telemetry/handler.ts`; vectors `test/telemetry-protocol-vectors.json` | Same sealed envelope; Ed25519 signed events |
| Insights JSON API | v1 | `/api/pinchpdf/insights/v1/` | Read-only, admin login |
| Database schema | migration 0003 | `migrations/` | Applied by hand with `wrangler d1 migrations apply` |
| Trial terms and privacy notices | 2026-11-20 (draft) | `TRIAL_TERMS_VERSION`, `TRIAL_PRIVACY_VERSION` in `wrangler.json`; text in `app/pinchpdf/legal/versions.ts` | `reviewed: false` |
| Placeholder list (signals) | 1 | `lib/trial/signals.ts` | Also in the vectors |

[Unreleased]: https://github.com/technowizsolutionsllp/TWS-Website/compare/ddbd4cb...telemetry-insights
