# App telemetry and Insights (PinchPDF and NoDupe)

PinchPDF and NoDupe report to this site in the same way: buy clicks, license events, and, from the installer, install and uninstall events. The two products run the **same code** (`lib/telemetry/*`, `lib/trial/*`); only the paths, the database, the signing prefix and what the free trial counts differ. PinchPDF's data is in the D1 database `pinchpdf` (binding `TRIAL_DB`, migrations in `migrations/`); NoDupe's is in the separate D1 database `nodupe` (binding `NODUPE_DB`, migrations in `migrations-nodupe/`). Both are shown on the admin **Insights** page (`/admin/insights`), with a product selector. Consent is collected in the app; the server accepts what the app sends.

| | PinchPDF | NoDupe |
|---|---|---|
| Ingest | `POST /api/pinchpdf/trial/v1/telemetry` | `POST /api/nodupe/trial/v1/telemetry` |
| Insights JSON | `GET /api/pinchpdf/insights/v1/{tab}` | `GET /api/nodupe/insights/v1/{tab}` |
| Database | `pinchpdf` (`TRIAL_DB`) | `nodupe` (`NODUPE_DB`) |
| Signing prefix | `pinchpdf-telemetry-v1`, `pinchpdf-telemetry-license-v1\|` | `nodupe-telemetry-v1`, `nodupe-telemetry-license-v1\|` |
| Licenses | Individual, Business (`plan`: `individual`, `business`) | NoDupe Individual, NoDupe Business (`plan`: `individual`, `business`) |
| Trial counts | one counter (5) | one counter per scan mode: 5 Basic, 3 Similar, 1 Deep |

The server keys (`kid`) and the secrets (`PEPPER`, `PII_KEY`, ...) are shared by the two products. Nothing made for one product is valid for the other, because every signature, hash and key derivation carries the product prefix.

Code: `lib/telemetry/*` (ingest handler, database layer, calculations, data), `lib/trial/product.ts` (the per-product settings), `lib/admin/sources.ts` (which database each Insights view reads), `lib/admin/telemetry-pages.ts` and `lib/admin/tabs.ts` (the tabs), `lib/admin/insights-api.ts` (JSON), `app/api/<product>/trial/v1/telemetry/route.ts` (ingest), `app/api/<product>/insights/v1/[tab]/route.ts` (JSON), `migrations/0003_telemetry.sql` and `0004_install_events.sql` (PinchPDF), `migrations-nodupe/0002_trials_and_telemetry.sql` (NoDupe), tests in `test/telemetry.test.ts`, `test/insights.test.ts`, `test/nodupe-trial.test.ts` and `test/nodupe-vectors.test.ts`. The endpoints are described in the Swagger docs (`/api/pinchpdf/trial/docs`, product filter at the top).

## What is stored

In each product's own database:

| Table | Holds |
|---|---|
| `telemetry_customers` | `customer_uuid` (the install id, minted by the app or installer), the install's Ed25519 public key (bound on first event), optional `trial_id` |
| `telemetry_devices` | a random `device_id` per machine and the three **peppered** device hashes (same scheme and matching policy as the trial) |
| `telemetry_events` | event id, customer, type, plan, license fingerprint, device id, app and server time, app version, OS build, and `install_kind` (install events only) |

Never stored: name, email, raw license key, raw device values. The license key arrives as `SHA-256("<product>-telemetry-license-v1|" || normalized key)` and is keyed again with `PEPPER` before storage, so a stored value cannot be reversed or matched without the secret. Losing `PEPPER` makes the stored fingerprints unusable.

## App contract: `POST <base>/telemetry`

`<base>` is `/api/pinchpdf/trial/v1` or `/api/nodupe/trial/v1`. Same sealed envelope, `kid` keys and error handling as `/register` and `/usage` (AAD is `POST <base>/telemetry|<kid>`, and the HKDF labels are `<product>-trial-v1 req` and `... resp`). One event per request, sent in the background, retried with the **same** `event_id` until answered. Plaintext answer: `{"result":"ok"}` (a repeated `event_id` is ignored and also answers `ok`). Anything malformed is a plain HTTP 400, rate limiting is 429, an unavailable service is 503; treat all of them as "try later".

```jsonc
{
  "proto": 1,
  "event_id": "<uuid, new per event>",
  "customer_uuid": "<uuid, the install id, kept on the device>",
  "type": "buy_clicked | license_activated | license_deactivated | license_key_changed | install | uninstall",
  "occurred_at": 1800000000,            // app clock, Unix seconds (server clamps to the last 90 days, never the future)
  "plan": "individual | business",      // required for license_activated and license_key_changed
  "license": "<b64url 32-byte license hash>",       // required except buy_clicked, install and uninstall
  "prev_license": "<b64url 32-byte hash>",          // license_key_changed only, must differ from license
  "install_kind": "new | upgrade | reinstall",      // install only, and required there
  "pubkey": "<b64url Ed25519 install public key>",
  "sig": "<b64url Ed25519 signature>",
  "signals": { "guid": "...", "smbios": "...", "board": "..." },   // same hashes as the trial; null when unavailable; not for install and uninstall
  "trial_id": "<optional, links to the trial>",
  "app_version": "1.3.0",
  "os_build": "10.0.26200"
}
```

**Signature**: over the UTF-8 bytes of
`<product>-telemetry-v1|<event_id>|<customer_uuid>|<type>|<occurred_at>|<plan>|<license>|<prev_license>`
using the strings exactly as sent, with an empty string for any field not sent. For `buy_clicked`, `install` and `uninstall`, plan and license are always empty; `prev_license` is only filled for `license_key_changed`. `install` and `uninstall` add one more field at the end: `|<install_kind>` (`new`, `upgrade` or `reinstall` for an install, empty for an uninstall, so the message ends with a `|`). The install key is bound to `customer_uuid` on the first event; later events from another key are refused, and nothing is written before the signature verifies.

When to send: `buy_clicked` when the user clicks Buy in the app; `license_activated` after a successful activation; `license_deactivated` when the user frees the license on this device; `license_key_changed` when the user replaces the key on this device (instead of a deactivate plus an activate). Send `trial_id` on every app event if the install has registered a trial. Keep `customer_uuid` and the install key together: a reinstall that loses them is a new customer.

### Installer events: `install` and `uninstall`

The installer reports an install (and what kind: a first install, an upgrade over an older version, or a reinstall) and the uninstaller reports an uninstall. **Same install id and install key as the app**, so the installer must create them if the app has not yet (the key is bound to the id on the first event, whoever sends it) and the app must then reuse them. These events are anonymous: the server ignores any `plan`, `license`, `signals` and `trial_id` sent with them, stores none, and stores no device id. An uninstall on a computer with no connection is not reported, so uninstalls are a lower bound. The privacy policy (section 2.12, `#install-events`) describes them; the installers must show that notice.

## Not telemetry: the update check

The app's update check (`GET /api/<product>/updates/v1/check`, see [RELEASES.md](RELEASES.md), section B) is a separate, plain request. It carries only the app version, channel, OS and architecture, no installation id, license key or customer id, so it is **not linked** to anything in this document and needs no consent rule beyond the privacy policy's section 2.8. The site only counts requests (`update_check` in the request counters, kept in the PinchPDF database for both products because the update Worker binds only that one).

## Consent rules for the apps (owner decision)

- `buy_clicked` is sent **only if the user has opted in**. For PinchPDF the choice is in the installer; for NoDupe it is on the trial registration screen (the NoDupe app plan has no choice in the installer). It is optional: declining must not block installing, activating or using the app, and the user can withdraw it in the app at any time. The server cannot check this, so the app must not send the event without consent.
- `license_activated`, `license_deactivated` and `license_key_changed` are sent under legitimate interest (validating licenses, supporting activations, detecting use beyond what was purchased). They are covered by the privacy notice and the user may object by contacting us.
- `install` and `uninstall` are sent under legitimate interest, with a notice in the installer and uninstaller (decision: notice, no tick box). Counsel still has to confirm that is enough.
- The free trial's computer check is covered by the required consent at trial acceptance (the user can buy a license instead).
- A server-side gate (an explicit consent field on `buy_clicked`, covered by the signature) can be added as a protocol change if you want the server to refuse the event without it.

## Definitions used by Insights

- **Seat**: one license on one machine (the machine is resolved with the trial matching policy; without a usable signal the customer stands in). A license is **active** while at least one seat is active.
- **Deactivation is not churn.** It is classed by what happened next: `moved` (activated on a different device afterwards), `same_device`, or `unused` (not in use since). A license that moved computers stays active throughout.
- **Buy attempt**: a buy click. Further clicks by the same install inside the window are the same attempt. It is **converted** if that install activates a license (or changes key) within the window, **pending** while the window is open, otherwise **abandoned**. The window is `INSIGHTS_ABANDON_DAYS` (7) and can be changed per view (1 to 90 days); history is re-sliced, not recomputed on write.
- Abandoned is an **upper bound**: someone who bought and activated on another install, or has not opened the app online yet, looks abandoned until their activation arrives.
- **Installs**: the number of `install` events (by kind) and `uninstall` events in the range. Counts of events, not of people; the distinct install ids are shown too.
- All times are UTC; weeks start Monday.

## Insights

- **Tabs of `/admin/insights`**: Trials (the original page), **Buying**, **Licenses**, **Devices**, **Installs** and **Scans**. A **Product** selector (PinchPDF, NoDupe, All products) at the top picks the database: a product reads its own database, All products reads both and combines the numbers. All tabs share the page's login (`ADMIN_USER` / `ADMIN_PASSWORD`), date range (`from`, `to`, UTC days, up to 366) and day-or-week bucketing. The Buying tab adds `window` (days).
- **Buying**: attempts per bucket as activated in time, abandoned or still open. **Licenses**: active licenses over time, and Individual vs Business. **Devices**: deactivations by what happened next, and key changes. **Installs**: installs by kind, uninstalls, and uninstalls per install.
- **Scans** is NoDupe only (the tab always shows NoDupe, whatever product is selected). It reads NoDupe's trials: for the trials registered in the range, the scans used per mode (Basic, Similar, Deep), how many trials used their whole allowance in each mode and in all three, and, per mode, how many trials sit at each count. The counts are the highest value each trial has reported, never lowered. Reads `NODUPE_DB`; without the binding the tab opens with a notice.
- **JSON**: `GET /api/pinchpdf/insights/v1/{buying|licenses|devices|installs}` and `GET /api/nodupe/insights/v1/{buying|licenses|devices|installs|scans}` (`?from=&to=&window=`) return the same numbers (counts only, no identifiers), behind the same login. A bad range answers 400. Documented in Swagger.
- The tabs open before a migration is applied, with a notice instead of an error. When one product's database is not bound, a product view answers 503 and All products shows the other with a notice.
- Each view reads all events (they are small rows). If the table grows into the hundreds of thousands, add a daily roll-up table.
- Telemetry requests are counted in the Trials tab's "Requests per day" chart like the trial endpoints (`telemetry` series), and the admin **Health check** page checks each product's database, tables, secrets and settings, runs a self-test of each product's endpoints, and probes `/api/<product>/trial/v1/telemetry` (expects 405 to a GET) and the Insights JSON API (expects 401).

## Testing

Everything runs with `npm test` (Vitest inside workerd with a real local D1) and in CI on every pull request.

| Layer | File | Catches |
|---|---|---|
| Endpoint behaviour | `test/telemetry.test.ts` | validation per event type, signatures, idempotent retries, device matching, key binding, rate limits, installer events, NoDupe's own database and prefix |
| NoDupe trial | `test/nodupe-trial.test.ts` | register, replay, one trial per computer per product, initial counts, usage per mode, signatures, terms versions, cross-product refusals |
| Edge cases | `test/telemetry-edge.test.ts` | simultaneous retries and first-event races, out-of-order delivery, shared PCs, oversize and junk bodies, 421/503 paths, stray fields (name, email) never stored, nothing identifying in logs, health probes not counted |
| Calculations | `test/insights.test.ts`, `test/insights-properties.test.ts` | the definitions (abandoned, active, moved) against an independent reference model over 300 random histories, plus rules for any history: counts add up, order of arrival does not matter, no NaN, every page renders |
| Admin pages and API | `test/insights.test.ts`, `test/admin.test.ts` | login, tabs, product selector, date range and window, notices before a migration, JSON shape, 400/401/404/503, two databases |
| Protocol vectors | `test/telemetry-vectors.test.ts`, `test/nodupe-vectors.test.ts`, `scripts/generate-telemetry-vectors.mjs [nodupe]` | the license hash, the signed message (including install and uninstall) and the stored fingerprint, produced by an **independent** implementation. CI fails if the committed vectors differ from the generator's output. Give each product's `test/*telemetry-protocol-vectors.json` to its app team byte-identically and have them pass the same vectors. |
| Deploy guards | `test/deploy-config.test.ts` | a limiter used in code but not declared in `wrangler.json`, duplicate namespace ids, a secret in a plain variable, a settings version with no legal text (both products), migrations renumbered or with a gap, schema drift, an API route missing from Swagger or from the health page |
| Health page | `test/telemetry-health.test.ts`, `test/health.test.ts` | databases, tables, limiters and probes are checked, and checks never write telemetry |

### After every deploy: the smoke test

```
node scripts/telemetry-smoke.mjs https://<staging host> [--product nodupe]
node scripts/trial-smoke.mjs https://<staging host> [--product nodupe]
```

`telemetry-smoke` plays the app over real HTTP (sealed, signed events: buy click, activation, a retry, deactivation, key change, install, uninstall), checks the refusals (tampered event 400, unknown key id 421, GET 405, no login 401) and, with `ADMIN_USER` and `ADMIN_PASSWORD` set, that the Insights JSON API counts them. It exits non-zero on any failure and prints the SQL that removes its rows (they are marked `app_version = 'smoke-test'`). It refuses to run against production unless `--yes-production` is passed, because it writes real rows. Server key: `TRIAL_SERVER_PUBLIC` and `TRIAL_KID`, or `TRIAL_KEY_<kid>` in `.dev.vars` for local runs. Then open **Admin, Health check** and confirm everything is green.

## Deploy checklist

1. `npx wrangler d1 migrations apply pinchpdf --remote` (applies `0004_install_events.sql`, after `0003_telemetry.sql` and `0002_admin_metrics.sql`; staging too). Then `npx wrangler d1 migrations apply nodupe --remote` (applies `migrations-nodupe/0002_trials_and_telemetry.sql`, which replaces the unused anonymous scan-report tables of `0001` with the same tables as PinchPDF's). `wrangler.json` binds the second database as `NODUPE_DB`. Until the migrations are applied the tabs show a notice and the Health check page reports it.
2. New settings in `wrangler.json`: `NODUPE_TRIAL_TERMS_VERSION` and `NODUPE_TRIAL_PRIVACY_VERSION` (now `2026-11-28`, the effective date of NoDupe's current trial texts; it was `2026-11-24` before trial protocol revision 5). No new secrets: the two products share them.
3. The rate limiters (`TELEMETRY_IP_LIMITER`, `TELEMETRY_CUSTOMER_LIMITER`, and the trial ones) are shared; NoDupe's requests are counted under keys prefixed `nodupe|`, so the two products do not share a bucket. **WAF rule** (Free plan: one rule): extend the existing path match so it also covers `/api/nodupe/trial/` (path starts with `/api/pinchpdf/trial/` **or** `/api/nodupe/trial/`).
4. Update the app's privacy notice and installer text for the installer events (privacy section 2.12) before an installer ships them.
5. Run the smoke tests above against staging, then the Health check page. Give the app teams this file, the Swagger spec and the shared vectors. Telemetry reuses the existing server key (`kid`), so no new key is needed.

## Privacy and legal status

The server stores no consent evidence for telemetry. The retention period (24 months) and the purge exist; the purge runs daily in the `tws-retention` Worker ([RETENTION.md](RETENTION.md)). Describe the device and license values as pseudonymised, not anonymous. The open items, with how they meet this code, are listed in the [README](../README.md#privacy-and-legal-status-open-items) and in `docs/legal/STRUCTURE.md`.

## Known limits

- Anyone with the public server key can send a **first** event for a new random `customer_uuid` (as with `/register`, the sealed channel is not authentication). Per-IP and per-customer limits bound the noise; the signature stops anyone from adding events to an existing customer.
- Two simultaneous first events from one machine can create two device ids; the effect is a slightly higher device count for that machine.
- **Retention: 730 days (24 months).** The GDPR sets no fixed period, only that data is kept no longer than the purpose needs, so the period is a documented choice, stated in the privacy policy. `node scripts/telemetry-purge.mjs --run --remote [--nodupe]` deletes events received more than 730 days ago, and customers and devices nothing refers to any more (dry run without `--run`; `--nodupe` acts on the `nodupe` database, with the same statements). It is a manual job: run it monthly for each product. The Health check (`Telemetry retention`, one per product) warns when an event is more than 760 days old. Code: `lib/telemetry/retention.ts`; SQL: `scripts/telemetry-purge-sql.mjs`; tests: `test/telemetry-retention.test.ts`. D1 backups age out on their own schedule. Scheduling the purge (a Cloudflare cron trigger) is not set up yet.
- **Erase one customer on request:** `node scripts/telemetry-purge.mjs --erase <customer-uuid> --run --remote [--nodupe]` deletes their events, the customer record and any device record nothing else uses. Devices are shared by matching and hold only hashes.
- The trial's own retention (name and email erased 24 months after the last contact, device hashes kept 5 years) is described in the trial notices; the daily `tws-retention` job applies it for both products ([RETENTION.md](RETENTION.md)).
