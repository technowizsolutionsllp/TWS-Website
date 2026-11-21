# PinchPDF app telemetry and Insights

The app reports buy clicks and license events to this site. They are stored in the same D1 database as the trial (`TRIAL_DB`) and shown in a private **Insights** dashboard. Consent is collected in the app; the server accepts what the app sends.

Code: `lib/telemetry/*`, `app/api/pinchpdf/trial/v1/telemetry/route.ts` (ingest), `app/insights/route.ts` (dashboard), `app/api/pinchpdf/insights/v1/[tab]/route.ts` (JSON), `migrations/0002_telemetry.sql`, tests in `test/telemetry.test.ts` and `test/insights.test.ts`. Both are described in the Swagger docs (`/api/pinchpdf/trial/docs`).

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

- Dashboard: `/insights` with tabs `?tab=overview|buying|licenses|devices&window=<days>`. Server-rendered, no scripts, strict CSP, `noindex`.
- JSON: `GET /api/pinchpdf/insights/v1/{overview|buying|licenses|devices}?window=<days>` returns the same numbers (counts only, no identifiers). Documented in Swagger.
- Both use HTTP Basic authentication against the **`INSIGHTS_USER`** and **`INSIGHTS_PASSWORD`** Worker secrets (separate from the docs login; password at least 16 characters). If either is missing or short they answer 404. Throttled per IP by `INSIGHTS_LIMITER` (in-memory fallback if the binding is absent).
- Each view reads all events (they are small rows). If the table grows into the hundreds of thousands, add a daily roll-up table.

## Deploy checklist

1. `npx wrangler d1 migrations apply pinchpdf --remote` (applies `0002_telemetry.sql`; staging too).
2. Set the secrets `INSIGHTS_USER` and `INSIGHTS_PASSWORD` (Settings, Variables and Secrets, type **Secret**, as for the docs). Without them `/insights` and its API answer 404.
3. `wrangler.json` now declares the rate limiters `TELEMETRY_IP_LIMITER` (60 per minute per IP), `TELEMETRY_CUSTOMER_LIMITER` (30 per minute per customer) and `INSIGHTS_LIMITER`, and the variable `INSIGHTS_ABANDON_DAYS`. The ingest path sits under `/api/pinchpdf/trial/`, so the existing WAF rule covers it.
4. Update the privacy text and legal versions for telemetry from licensed installs before the app ships it (the current text says licensed users send nothing to this service).
5. Give the app team this file and the Swagger spec. Telemetry reuses the existing server key (`kid`), so no new key is needed.

## Known limits

- Anyone with the public server key can send a **first** event for a new random `customer_uuid` (as with `/register`, the sealed channel is not authentication). Per-IP and per-customer limits bound the noise; the signature stops anyone from adding events to an existing customer.
- Two simultaneous first events from one machine can create two device ids; the effect is a slightly higher device count for that machine.
- To delete one customer's telemetry on request: `DELETE FROM telemetry_events WHERE customer_uuid = ?`, then `telemetry_customers`. Devices are shared by matching and hold only hashes.
