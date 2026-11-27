# Architecture

How the Technowiz Solutions site and its backend services fit together. This is the map: it says what lives where and why, and points to the detailed documents for contracts and operations. For setup commands see the [README](../README.md); for what changed and when see the [CHANGELOG](../CHANGELOG.md).

Keep this file true. [README, "Keeping the documents current"](../README.md#keeping-the-documents-current) lists which change needs which update.

## 1. Shape of the system

One Cloudflare Worker (`tws-website`) serves the public website, the PinchPDF and NoDupe apps' trial and telemetry APIs and the admin area. A second small Worker, `tws-updates` (`workers/updates`, see [UPDATES_WORKER.md](UPDATES_WORKER.md)), serves the app update check on the same addresses, so a website deploy or fault cannot take the update check down; until its routes are switched on, `tws-website` answers those addresses as well. A third small Worker, `tws-retention` (`workers/retention`, see [RETENTION.md](RETENTION.md)), runs daily on a Cron Trigger and applies the retention periods in the privacy notices. There are two D1 databases, one per product (`pinchpdf`, `nodupe`); the website and the retention Worker bind both. There is no separate backend server. Where this is going, including what LicenseHub may later replace: [ROADMAP.md](ROADMAP.md).

```
 Visitors ──────────────► website pages (app/*)          static + server-rendered, vinext
 PinchPDF app ──sealed──► /api/pinchpdf/trial/v1/*       challenge, register, usage, telemetry
 NoDupe app ────sealed──► /api/nodupe/trial/v1/*         the same, own database
 Operator (Basic login) ► /admin, /admin/insights,        Insights, Records, Health check
                          /admin/records, /admin/checkout, /admin/health
 Operator (Basic login) ► /api/{product}/records/v1/*     find and delete trial records (POST)
 Apps and website ──────► /api/{product}/checkout/v1/*    which checkout the Buy buttons open (public GET)
 Cron (daily) ──────────► tws-retention Worker            erase name and email after 24 months, delete records after 5 years
 Operator (Basic login) ► /api/pinchpdf/trial/docs        Swagger UI + OpenAPI spec
 Operator (Basic login) ► /api/pinchpdf/insights/v1/{tab} read-only JSON of the Insights tabs
 Visitors ──────────────► /api/contact, /api/get-support  email via Resend
                                   │
                                   ▼
                     Worker bindings: TRIAL_DB (D1 "pinchpdf"),
                     rate limiters, secrets and plain vars (wrangler.json)
```

| Layer | Choice | Why |
|---|---|---|
| Framework | vinext (Next.js App Router on Vite) with React 19 | Next route handlers and server components, built for Workers |
| Host | Cloudflare Workers, static assets from `dist/client` | One deployable, close to users, no servers to run |
| Database | Cloudflare D1 (SQLite), binding `TRIAL_DB`, database `pinchpdf` | Small relational data, migrations in `migrations/` |
| Email | Resend (`RESEND_API_KEY`) | Contact and support forms |
| Abuse control | Workers rate-limit bindings, per-endpoint, plus proof of work on trial registration | See section 5 |
| Tests | Vitest inside workerd with a real local D1 | The same runtime as production |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | Typecheck, lint, tests, vectors, build, deploy dry run, dependency audit |

`wrangler.json` is the source of truth for bindings, plain variables and rate limiters. A deploy overwrites dashboard-only variables and bindings, which is why secrets must be type **Secret** and everything else lives in that file.

## 2. Code layout

```
app/                    Next App Router
  page.tsx, about/, nodupe/, pinchpdf/, products/    marketing pages (data in products/data.ts, company-data.ts)
  privacy/, terms/, legal/, pinchpdf/legal/           /privacy (policy + Annex A), /terms (Part A website, Part B license) and the /legal index; trial texts in pinchpdf/legal/
  get-support/, api/contact, api/get-support          support and contact forms
  api/pinchpdf/trial/v1/{challenge,register,usage,telemetry}/route.ts    thin route files, no logic
  api/pinchpdf/trial/docs/…                           Swagger UI, spec, docs health
  api/pinchpdf/insights/v1/[tab]/route.ts             Insights JSON
  api/nodupe/…                                        the same trial, Insights and update routes for NoDupe
  api/{pinchpdf,nodupe}/records/v1/{search,delete}/route.ts   admin JSON API to find and delete trial records
  api/{pinchpdf,nodupe}/checkout/v1/{links,open}/route.ts      public checkout links for the Buy buttons
  admin/{route,insights/route,records/route,checkout/route,health/route}.ts  admin pages (HTML responses built in lib/admin)
workers/
  updates/{index.ts,wrangler.json}                    the update check as its own Worker (tws-updates): same handler as app/api/*/updates
  retention/{index.ts,wrangler.json}                  the daily retention job (tws-retention, Cron Trigger): lib/retention, scripts/*-sql.mjs
lib/
  trial/                the trial service: handlers, sealed envelope, crypto, matching, config, OpenAPI
  telemetry/            the telemetry service: handler, db, compute, data
  admin/                admin auth, pages, charts, health checks, Insights tabs, JSON API
  checkout/             checkout links: rules, defaults, store, live check against the provider pages, public handler
  brand-system.ts       brand tokens used by the site
migrations/             0001 trials, 0002 admin metrics, 0003 telemetry
scripts/                operator CLI, key tools, release publishing (release-publish-lib, release-cli), smoke tests, vector generators, icon generators
(in each product repo) scripts/release/   copies of release-lib, release-publish-lib, release-cli and the vectors (kept in step by scripts/sync-release-scripts.mjs) plus the product's publish.mjs and update.mjs; RELEASE_MANAGEMENT.md at the product repo root
test/                   Vitest suites, shared protocol vectors
docs/                   documentation (see the README index)
```

Rules the code follows:

- **Route files are thin.** They resolve the Workers environment (`lib/trial/runtime.ts`) and call a handler. Handlers take `env` and a clock as arguments, so tests drive them directly without HTTP.
- **Pure logic is separate from I/O.** Device matching (`lib/trial/matching.ts`), telemetry statistics (`lib/telemetry/compute.ts`), bucketing (`lib/admin/range.ts`) and chart drawing (`lib/admin/charts.ts`) have no database or request access, so they are property-tested.
- **No page script unless needed.** Admin pages are server-rendered HTML with SVG charts and a strict CSP. Only the health page runs a script, under a per-response nonce.

## 3. The app APIs (PinchPDF and NoDupe)

PinchPDF's are under `/api/pinchpdf/trial/v1/`; NoDupe's are the same endpoints under `/api/nodupe/trial/v1/` (same code, its own database, signing prefix and trial counters, see [PINCHPDF_TRIAL_SERVICE.md](PINCHPDF_TRIAL_SERVICE.md#nodupe-the-same-service)). Protocol version 1 (`PROTOCOL_VERSION`). The app embeds the server's public key per key id (`kid`); the Health check page shows the keys to embed.

| Endpoint | Sealed | Purpose |
|---|---|---|
| `challenge` | no | Stateless proof-of-work challenge (HMAC-authenticated, no storage) |
| `register` | yes | Create a trial (one per computer), store encrypted contact and hashed device signals |
| `usage` | yes | Report and read trial use; the server holds the count and limit |
| `telemetry` | yes | Buy clicks, license events (activate, deactivate, key change) and the installer's install and uninstall events |
| `checkout/v1/links`, `checkout/v1/open` (per product) | no | `GET`: which checkout the Buy buttons open (per license and provider, primary and Force), set on `/admin/checkout`. No personal data (`lib/checkout/`, see [CHECKOUT_LINKS.md](CHECKOUT_LINKS.md)) |
| `updates/v1/check` (per product) | no | `GET`: is there a newer PinchPDF or NoDupe, what changed, where to download it. No personal data; answered from a signed release list in a public GitHub repository (`lib/updates/`, see [RELEASES.md](RELEASES.md)) |

**Sealed envelope** (`lib/trial/envelope.ts`): the app generates an ephemeral X25519 key, derives a shared secret with the server key for `kid`, runs HKDF-SHA256, and encrypts with AES-256-GCM. The AAD binds the request to its method, path and `kid`. The response is sealed under a second derived key with the request nonce in its AAD. Only the server's private key (`TRIAL_KEY_<kid>`) can read requests; nothing travels in the clear except the envelope fields.

**Install identity.** Each install has an Ed25519 key. Trial `usage` and every telemetry event are signed with it. A telemetry customer is bound to the first public key it presents (trust on first use) and later events with another key are refused.

**Idempotency.** Telemetry events carry an `event_id` and are stored once; a retry is a no-op. Trial registration is idempotent on the install key.

Contracts, field lists and error codes: [PINCHPDF_TRIAL_SERVICE.md](PINCHPDF_TRIAL_SERVICE.md) and [PINCHPDF_TELEMETRY.md](PINCHPDF_TELEMETRY.md). The OpenAPI spec (`lib/trial/openapi.ts`) is served at `/api/pinchpdf/trial/docs`; a test fails if a route exists that the spec does not describe.

## 4. Data

Migrations are applied with `wrangler d1 migrations apply` and numbered in order. The numbering is checked by a test.

| Migration | Tables | Holds |
|---|---|---|
| `0001_trials.sql` | `trials`, `trial_audit` | One row per trial: install key, keyed hashes of device signals, encrypted name and email, usage count and limit, notice versions. `trial_audit` is an append-only log of operator actions |
| `0002_admin_metrics.sql` | `metrics_daily`, `trials.product` | Per-day request counters by product, endpoint and outcome; the product column |
| `0003_telemetry.sql` | `telemetry_customers`, `telemetry_devices`, `telemetry_events` | Customer (UUID, install key), device (random id plus keyed hashes), event log (type, plan, keyed license fingerprints, times, app and OS version) |

What is and is not stored:

- **Never stored:** raw device identifiers, raw license keys, plaintext names or emails.
- **Keyed hashes:** device signals and license values are HMAC'd with `PEPPER` before storage. They are pseudonymous, not anonymous.
- **Encrypted:** contact name and email (AES-256-GCM with `PII_KEY`; the email also has a keyed blind index for support lookup).
- **Counters:** `metrics_daily` is approximate (batched in memory, at most one D1 write per instance every 10 seconds) and holds counts only. The update check records `update_check` counts by product and outcome (no chart yet) and nothing about who asked.

## 5. Security model

- **Secrets** (`PEPPER`, `PEPPER_EMAIL`, `PII_KEY`, `CHALLENGE_KEY`, `TRIAL_KEY_<kid>`, `ADMIN_*`, `DOCS_*`, `RESEND_API_KEY`) are Worker Secrets, validated at start. A missing or malformed one makes the trial and telemetry endpoints answer 503 with a log line naming what is wrong (never a value).
- **Rate limits** are Workers bindings, per IP and, for usage and telemetry, per trial id or customer. They are optional in code (skipped if the binding is absent) and the Health check warns when one is missing. The binding supports only 10 or 60 second periods.
- **Device matching** (`lib/trial/matching.ts`): signal types never cross; a stored row blocks a request when at least one signal is usable in both and at least `min(2, usable)` are equal. Telemetry reuses the same policy to decide whether two events come from the same machine.
- **Admin and docs** use HTTP Basic against Worker secrets, answer 404 until configured, and are throttled per IP before credentials are compared. Responses are `no-store` and `noindex`.
- **Operator actions** on trials go through `scripts/trial-admin.mjs` and are written to `trial_audit`.
- **Site headers** (`next.config.ts`): nosniff, referrer policy, frame denial, permissions policy, HSTS. Not yet set: a site-wide Content-Security-Policy (inline JSON-LD and styles need a nonce or hash). The docs and admin pages set their own CSP.

## 6. Admin area

`/admin` is a home page with cards. **Insights** (`/admin/insights?tab=…&product=…&from=…&to=…`) has six tabs (Installs and Scans are in [ADMIN.md](ADMIN.md); Scans is NoDupe only):

| Tab | Source | Shows |
|---|---|---|
| Trials | `trials`, `metrics_daily` | New trials, requests by endpoint, lifecycle, outcomes, app and Windows versions |
| Buying | `telemetry_events` | Buy attempts converted, pending or abandoned within a configurable window |
| Licenses | `telemetry_events` | Active licenses over time, by plan (Individual, Business) |
| Devices | `telemetry_events` | Deactivations (moved, same device, unused) and key changes. A deactivation is not churn: people move licenses between machines |

The same data is available as JSON at `/api/pinchpdf/insights/v1/{tab}`. Buckets are per UTC day, or per week when the range exceeds 120 days. Definitions: [PINCHPDF_TELEMETRY.md](PINCHPDF_TELEMETRY.md#definitions-used-by-insights).

**Records** (`/admin/records`, and `POST /api/{pinchpdf,nodupe}/records/v1/{search,delete}`) finds a trial record by name, email, support reference or trial id and erases its name and email or deletes it, for deletion requests. It is the one admin page that shows personal data, so every record shown and every deletion is written to `trial_audit`, searches are POST so nothing personal is in a URL, and requests from another site are refused. Details: [ADMIN.md](ADMIN.md#records-adminrecords).

The operator guide is [ADMIN.md](ADMIN.md).

**Health check** (`/admin/health`): server checks (D1, tables and migrations, secrets, limiters, email settings, docs login), a trial API self-test that seals real requests to the server's own handlers without writing, app updates (settings set, release lists readable and valid), trial and telemetry retention (warns when the daily job is overdue), and browser probes of every public route. Probes send a header the request counters skip. The set of probes is generated from product and legal data, and a test fails when a route is not covered.

## 7. Build, test and deploy

```
 edit ─► npm run typecheck / lint / test ─► PR ─► CI ─► merge to the base branch ─► Cloudflare build and deploy
                                                │
              typecheck, lint, vitest (workerd + local D1), vector freshness,
              vite build, `wrangler deploy --dry-run`, `npm audit` (production, critical)
```

- The base branch is `launch-marketing-site-contact-email` (not `main`).
- **Shared protocol vectors** (`test/*-protocol-vectors.json`) are produced by independent generator scripts, checked against a recorded SHA-256, and copied byte-identically into the app repository. Changing the wire format means regenerating them and telling the app team.
- **Deploy guards** (`test/deploy-config.test.ts`): bindings used in code but missing from `wrangler.json`, duplicate rate-limit ids, migration numbering, schema drift, routes missing from Swagger or the health page.
- **Smoke tests** (`scripts/trial-smoke.mjs`, `scripts/telemetry-smoke.mjs`) run the real protocol over HTTP against a local or staging server. They write rows and refuse production without a flag.
- Migrations are applied by hand before the code that needs them ships; the pages and endpoints degrade rather than crash when a migration is missing, and the Health check names the command.

## 8. Products and what is not built

- **PinchPDF**: the trial service and telemetry above, and the app update check (`/api/pinchpdf/updates/v1/check`).
- **NoDupe**: marketing page, the app update check (`/api/nodupe/updates/v1/check`, same code and release process as PinchPDF's), and the same trial service, telemetry and Insights as PinchPDF under `/api/nodupe/...`, in its own D1 database (`nodupe`). The free trial counts scans per mode (5 Basic, 3 Similar, 1 Deep). The NoDupe app side (registration screen, usage reports, installer events) is not built yet: see [NODUPE_APP_LINKS.md](NODUPE_APP_LINKS.md).
- **LicenseHub**: a separate project, not part of this repository. What it may later replace here is recorded in [ROADMAP.md](ROADMAP.md).
- **Dodo Payments and Lemon Squeezy** are the payment and licensing providers named in the terms and privacy pages (the app contacts them for activation). This repository calls them only to check a checkout link before `/admin/checkout` saves it: it opens the public checkout page, as a buyer's click would, and reads which product it sells. It holds no provider API key.

## 9. Decisions worth remembering

| Decision | Reason |
|---|---|
| One Worker and one D1 database for site, APIs and admin | Small team and scale; fewer moving parts |
| Sealed envelope instead of plain TLS JSON | The app is a desktop client and the payload carries contact data and identifiers; the envelope adds replay-safe binding and a server-key pin |
| Keyed hashes of device signals, never raw values | Detect repeat trials without holding identifiers that identify a person on their own |
| Seat-based license model for telemetry (license plus device) | A license moving between machines is normal, so deactivation is not churn |
| Server-rendered SVG charts, no chart library, no page script | Smaller attack surface and a strict CSP |
| Request counters batched in memory | A flood of bad requests must not use up D1 write allowance; counts are approximate by design |
| Rate limiters and the health header are not security controls on their own | The envelope, signatures and proof of work do the real gating |
| `wrangler.json` as the only place for non-secret configuration | Dashboard-only variables are removed by a deploy |
| App installers and release lists on a separate public GitHub repository per product (`technowizsolutionsllp/app-releases_PinchPDF` and `app-releases_NoDupe`), not R2 and not this private repository | R2 needs a payment method; a release takes its repository's visibility, so public downloads cannot sit in the private code repository |
| Release listings signed by an offline Ed25519 key, with a primary and a backup, and the website and apps trusting a list of public keys (`RELEASE_PUBLIC_KEY`, comma-separated) | The key is built into installed apps, so it cannot be swapped later without a trusted backup. The seed is never in Cloudflare or GitHub, so a compromised account still cannot offer an unsigned installer. Details: [RELEASES.md](RELEASES.md) |
