# Roadmap: backend services and LicenseHub

Where the backend of the website is going, and what may later be replaced by **LicenseHub** (the separate licensing platform in the `Licensing Server` project: a Rust and Postgres server with trial activation, licenses, signed responses and its own admin console). This page records decisions and intent, not promises. Update it when a step is done or a decision changes. Last updated 2026-11-23.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) (how it is built today), [UPDATES_WORKER.md](UPDATES_WORKER.md) (runbook for the update-check Worker), [RELEASES.md](RELEASES.md).

## 1. Where things stand

| Piece | Runs as | State |
|---|---|---|
| Website, legal pages, contact and support forms | Worker `tws-website` | Stays |
| PinchPDF trial service (`/api/pinchpdf/trial/v1`) and app telemetry | Worker `tws-website` | May be replaced by LicenseHub (section 4) |
| Admin area: Insights, Health check, trial admin | Worker `tws-website` | Partly replaceable (section 4) |
| **App update check** (`/api/pinchpdf/updates/v1/check`, `/api/nodupe/updates/v1/check`) | **Worker `tws-updates`** (built, staged cutover) and, until the routes have proved themselves, also `tws-website` | Stays on Cloudflare |
| Release scripts and the signed release lists | Publisher's computer and the public GitHub repositories `app-releases_PinchPDF` and `app-releases_NoDupe` | Stays |

## 2. Principles

1. **Public addresses never change.** The apps already ship with these addresses, and an app cannot be updated through an address that moved. Every split keeps the same paths on the same domain; only the Worker behind a path changes.
2. **Split by "who must not break whom".** The update check can force installs, so a website deploy or bug must not be able to take it down. The trial service holds personal data and keys, so the marketing site must not be able to reach them.
3. **Do not build what LicenseHub will replace.** Until the decision in section 5 is made, the trial service, telemetry and admin get fixes and security and privacy work only, no new features.
4. **Keep the logic in `lib/`.** Routes stay thin wrappers, so a handler can move to another Worker, or be retired, without being rewritten.
5. **One repository.** Each Worker has its own `wrangler.json`; shared code is imported, not copied.
6. **Anything that touches the apps needs an app release first.** Changing a protocol, a key format or an address is never done on the server alone.

## 3. Plan

| Step | What | Status |
|---|---|---|
| 1 | **Updates Worker** (`workers/updates`): same endpoints, own Worker. Staged cutover through two routes, with the website's own copy as the fallback. Runbook: [UPDATES_WORKER.md](UPDATES_WORKER.md) | Built; routes to be added after a first deploy and a check |
| 2 | After the routes have run without problems for a while: remove the website's copy of the update endpoints and move the Health check wording to the new Worker | Later |
| 3 | Freeze new features in the trial service, telemetry and admin (principle 3) | In effect |
| 4 | Decide which parts LicenseHub takes over (section 5) | Open |
| 5 | If trials move: an app release that talks to LicenseHub, a one-time import of existing registrations, and a switch-over with both running side by side for a time | Future |
| 6 | Retire what is replaced; the Health check probes LicenseHub; update the privacy and trial texts if the roles of the parties change | Future |

## 4. Potential replacement with LicenseHub later

What LicenseHub overlaps with, as far as its README shows (the code has not been reviewed for this: it was described there as having no app calling it yet). Nothing here is decided.

| Area | Today in this repository | Possible overlap with LicenseHub | Until then | If it moves |
|---|---|---|---|---|
| **Trial registration and usage** (`/api/pinchpdf/trial/v1/challenge`, `register`, `usage`) | Sealed envelope protocol (X25519, HKDF, AES-256-GCM), proof of work, hashed device signals, D1 tables | **Strong.** LicenseHub has a cloud trial authority (activate, validate, sync usage, status) returning Ed25519-signed snapshots | Fixes and security only. Do not extend the protocol | The app changes protocol (a new app release). Existing registrations (hashes, encrypted contacts) need a one-time import |
| **App telemetry** (`/api/pinchpdf/trial/v1/telemetry`: buy clicks, license events) | Sealed events in D1 with consent rules and 24-month retention | **Unknown.** Not described in LicenseHub's README | Fixes only | Decide first whether telemetry belongs with licensing at all |
| **Insights** (`/admin/insights`, `/api/pinchpdf/insights`) | Dashboards over the trial and telemetry tables | **Unknown**, depends on the row above | Fixes only | Goes with the data it reads |
| **Admin area** (login, trial admin, Health check) | Cloudflare-hosted pages under `/admin` | **Partial.** LicenseHub has an admin console with password, TOTP and Google sign-in | Fixes only | The Health check stays here, since it also checks the website, and gains a probe of LicenseHub |
| **Licenses, activations, webhooks from Dodo and Lemon Squeezy** | Not in this repository | **Yes**, this is LicenseHub's own purpose | Nothing | LicenseHub owns it from the start |
| **Personal data and keys** (`PII_KEY`, `PEPPER`, `PEPPER_EMAIL`, `CHALLENGE_KEY`, `TRIAL_KEY_k1`) | Worker secrets; contact data encrypted with `PII_KEY` | Replaced together with the trial data | **Do not rotate or replace these before the migration**: stored hashes and contact data become unreadable | Keep them until the data is imported, then retire them on a schedule |

**Stays on Cloudflare whatever is decided:** the update check (no database or server needed, it benefits from the edge cache, and it must keep working if LicenseHub is down), the website and legal pages, the contact and support forms, and the release scripts.

## 5. Open questions

1. Which of the rows in section 4 does LicenseHub take over: trials and licensing only, or telemetry and Insights as well? This decides whether the admin area stays at all.
2. Where will LicenseHub run (it is a container plus Postgres), who operates it, and what uptime must the apps be able to rely on? The trial check must not become a single point of failure for people using the app.
3. Will it speak the existing sealed protocol for a transition period, or does the app move straight to its signed snapshots?
4. How are existing registrations and their consent records carried over, and does the Trial Privacy Notice need to change (controller, processors, retention)? Counsel review needed.

## 6. Decisions so far

| Date | Decision |
|---|---|
| 2026-11-23 | The update check is split into its own Worker first, with the same public addresses, because it is the one service that is independent of data and must not share fate with the website. |
| 2026-11-23 | The trial service, telemetry and admin are not split further while LicenseHub may replace them; they are frozen except for fixes, security and privacy work. |
| 2026-11-23 | Public addresses used by the apps never change; a split is done with Cloudflare routes on the same domain. |
