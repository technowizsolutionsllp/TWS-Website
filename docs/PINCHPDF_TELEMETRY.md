# PinchPDF app telemetry and Insights

The app reports buy clicks and license events to this site. They are stored in the same D1 database as the trial (`TRIAL_DB`) and shown as tabs of the existing admin **Insights** page (`/admin/insights`). Consent is collected in the app; the server accepts what the app sends.

Code: `lib/telemetry/*` (ingest handler, database layer, calculations, data), `lib/admin/telemetry-pages.ts` and `lib/admin/tabs.ts` (the tabs), `lib/admin/insights-api.ts` (JSON), `app/api/pinchpdf/trial/v1/telemetry/route.ts` (ingest), `app/api/pinchpdf/insights/v1/[tab]/route.ts` (JSON), `migrations/0003_telemetry.sql`, tests in `test/telemetry.test.ts` and `test/insights.test.ts`. The two endpoints are described in the Swagger docs (`/api/pinchpdf/trial/docs`).

## What is stored

| Table | Holds |
|---|---|
| `telemetry_customers` | `customer_uuid` (minted by the app), the install's Ed25519 public key (bound on first event), optional `trial_id` |
| `telemetry_devices` | a random `device_id` per machine and the three **peppered** device hashes (same scheme and matching policy as the trial) |
| `telemetry_events` | event id, customer, type, plan, license fingerprint, device id, app and server time, app version, OS build |

Never stored: name, email, raw license key, raw device values. The license key arrives as `SHA-256("pinchpdf-telemetry-license-v1|" || normalized key)` and is keyed again with `PEPPER` before storage, so a stored value cannot be reversed or matched without the secret. Losing `PEPPER` makes the stored fingerprints unusable.

## App contract: `POST /api/pinchpdf/trial/v1/telemetry`

Same sealed envelope, `kid` keys and error handling as `/register` and `/usage` (AAD is `POST /api/pinchpdf/trial/v1/telemetry|<kid>`). One event per request, sent in the background, retried with the **same** `event_id` until answered. Plaintext answer: `{"result":"ok"}` (a repeated `event_id` is ignored and also answers `ok`). Anything malformed is a plain HTTP 400, rate limiting is 429, an unavailable service is 503; treat all of them as "try later".

```jsonc
{
  "proto": 1,
  "event_id": "<uuid, new per event>",
  "customer_uuid": "<uuid, minted at first launch, kept on the device>",
  "type": "buy_clicked | license_activated | license_deactivated | license_key_changed",
  "occurred_at": 1800000000,            // app clock, Unix seconds (server clamps to the last 90 days, never the future)
  "plan": "individual | business",      // required for license_activated and license_key_changed
  "license": "<b64url 32-byte license hash>",       // required except buy_clicked
  "prev_license": "<b64url 32-byte hash>",          // license_key_changed only, must differ from license
  "pubkey": "<b64url Ed25519 install public key>",
  "sig": "<b64url Ed25519 signature>",
  "signals": { "guid": "...", "smbios": "...", "board": "..." },   // same hashes as the trial; null when unavailable
  "trial_id": "<optional, links to the trial>",
  "app_version": "1.3.0",
  "os_build": "10.0.26200"
}
```

**Signature**: over the UTF-8 bytes of
`pinchpdf-telemetry-v1|<event_id>|<customer_uuid>|<type>|<occurred_at>|<plan>|<license>|<prev_license>`
using the strings exactly as sent, with an empty string for any field not sent. For `buy_clicked`, plan and license are always empty; `prev_license` is only filled for `license_key_changed`. The install key is bound to `customer_uuid` on the first event; later events from another key are refused, and nothing is written before the signature verifies.

When to send: `buy_clicked` when the user clicks Buy in the app; `license_activated` after a successful activation; `license_deactivated` when the user frees the license on this device; `license_key_changed` when the user replaces the key on this device (instead of a deactivate plus an activate). Send `trial_id` on every event if the install has registered a trial. Keep `customer_uuid` and the install key together: a reinstall that loses them is a new customer.

## Definitions used by Insights

- **Seat**: one license on one machine (the machine is resolved with the trial matching policy; without a usable signal the customer stands in). A license is **active** while at least one seat is active.
- **Deactivation is not churn.** It is classed by what happened next: `moved` (activated on a different device afterwards), `same_device`, or `unused` (not in use since). A license that moved computers stays active throughout.
- **Buy attempt**: a buy click. Further clicks by the same install inside the window are the same attempt. It is **converted** if that install activates a license (or changes key) within the window, **pending** while the window is open, otherwise **abandoned**. The window is `INSIGHTS_ABANDON_DAYS` (7) and can be changed per view (1 to 90 days); history is re-sliced, not recomputed on write.
- Abandoned is an **upper bound**: someone who bought and activated on another install, or has not opened the app online yet, looks abandoned until their activation arrives.
- All times are UTC; weeks start Monday.

## Insights

- **Tabs of `/admin/insights`**: Trials (the original page), **Buying**, **Licenses**, **Devices**. They share the page's login (`ADMIN_USER` / `ADMIN_PASSWORD`), date range (`from`, `to`, UTC days, up to 366) and day-or-week bucketing. The Buying tab adds `window` (days). Telemetry is PinchPDF only for now.
- **Buying**: attempts per bucket as activated in time, abandoned or still open. **Licenses**: active licenses over time, and Individual vs Business. **Devices**: deactivations by what happened next, and key changes.
- **JSON**: `GET /api/pinchpdf/insights/v1/{buying|licenses|devices}?from=&to=&window=` returns the same numbers (counts only, no identifiers), behind the same login. A bad range answers 400. Documented in Swagger.
- The tabs open before migration 0003 is applied, with a notice instead of an error.
- Each view reads all events (they are small rows). If the table grows into the hundreds of thousands, add a daily roll-up table.
- Telemetry requests are counted in the Trials tab's "Requests per day" chart like the trial endpoints (`telemetry` series), and the admin **Health check** page checks the three telemetry tables, the two new rate limiters and probes `/api/pinchpdf/trial/v1/telemetry` (expects 405 to a GET) and the Insights JSON API (expects 401).

## Testing

Everything runs with `npm test` (Vitest inside workerd with a real local D1) and in CI on every pull request.

| Layer | File | Catches |
|---|---|---|
| Endpoint behaviour | `test/telemetry.test.ts` | validation per event type, signatures, idempotent retries, device matching, key binding, rate limits |
| Edge cases | `test/telemetry-edge.test.ts` | simultaneous retries and first-event races, out-of-order delivery, shared PCs, oversize and junk bodies, 421/503 paths, stray fields (name, email) never stored, nothing identifying in logs, health probes not counted |
| Calculations | `test/insights.test.ts`, `test/insights-properties.test.ts` | the definitions (abandoned, active, moved) against an independent reference model over 300 random histories, plus rules for any history: counts add up, order of arrival does not matter, no NaN, every page renders |
| Admin pages and API | `test/insights.test.ts` | login, tabs, date range and window, notices before migration 0003, JSON shape, 400/401/404/503 |
| Protocol vectors | `test/telemetry-vectors.test.ts`, `scripts/generate-telemetry-vectors.mjs` | the license hash, the signed message and the stored fingerprint, produced by an **independent** implementation. CI fails if the committed vectors differ from the generator's output. Give `test/telemetry-protocol-vectors.json` to the app team byte-identically and have them pass the same vectors. |
| Deploy guards | `test/deploy-config.test.ts` | a limiter used in code but not declared in `wrangler.json`, duplicate namespace ids, a secret in a plain variable, a settings version with no legal text, migrations renumbered or with a gap, schema drift, an API route missing from Swagger or from the health page |
| Health page | `test/telemetry-health.test.ts` | telemetry tables, limiters and probes are checked, and checks never write telemetry |

The calculation tests were mutation-checked: deliberately breaking deactivation handling, the abandoned window and the moved-or-same-device rule each made them fail.

### After every deploy: the smoke test

```
node scripts/telemetry-smoke.mjs https://<staging host>
```

It plays the app over real HTTP (sealed, signed events: buy click, activation, a retry, deactivation, key change), checks the refusals (tampered event 400, unknown key id 421, GET 405, no login 401) and, with `ADMIN_USER` and `ADMIN_PASSWORD` set, that the Insights JSON API counts them. It exits non-zero on any failure and prints the SQL that removes its rows (they are marked `app_version = 'smoke-test'`). It refuses to run against production unless `--yes-production` is passed, because it writes real rows. Server key: `TRIAL_SERVER_PUBLIC` and `TRIAL_KID`, or `TRIAL_KEY_<kid>` in `.dev.vars` for local runs. Then open **Admin, Health check** and confirm everything is green.

## Deploy checklist

1. `npx wrangler d1 migrations apply pinchpdf --remote` (applies `0003_telemetry.sql` after `0002_admin_metrics.sql`; staging too). Until then the tabs show a notice and the Health check page reports the missing tables.
2. No new secrets: the tabs and the JSON API use the existing admin login.
3. `wrangler.json` now declares the rate limiters `TELEMETRY_IP_LIMITER` (60 per minute per IP) and `TELEMETRY_CUSTOMER_LIMITER` (30 per minute per customer), and the variable `INSIGHTS_ABANDON_DAYS` (default window, 7). The ingest path sits under `/api/pinchpdf/trial/`, so the existing WAF rule covers it.
4. Update the privacy text and legal versions for telemetry from licensed installs before the app ships it (the current text says licensed users send nothing to this service).
5. Run the smoke test above against staging, then the Health check page. Give the app team this file, the Swagger spec and the shared vectors. Telemetry reuses the existing server key (`kid`), so no new key is needed.

## Privacy and legal status

Telemetry from licensed installs contradicts the published statement that licensed users send nothing, has no retention period or purge yet, and stores no consent evidence. Describe the device and license values as pseudonymised, not anonymous. The open items, with how they meet this code, are listed in the [README](../README.md#privacy-and-legal-status-open-items).

## Known limits

- Anyone with the public server key can send a **first** event for a new random `customer_uuid` (as with `/register`, the sealed channel is not authentication). Per-IP and per-customer limits bound the noise; the signature stops anyone from adding events to an existing customer.
- Two simultaneous first events from one machine can create two device ids; the effect is a slightly higher device count for that machine.
- To delete one customer's telemetry on request: `DELETE FROM telemetry_events WHERE customer_uuid = ?`, then `telemetry_customers`. Devices are shared by matching and hold only hashes.
