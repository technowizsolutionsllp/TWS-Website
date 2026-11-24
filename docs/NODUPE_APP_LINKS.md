# NoDupe: endpoints, contract and legal links

For the NoDupe app team. Base URL: `https://technowizsolutions.com`.

NoDupe uses **the same service as PinchPDF**: the same sealed protocol, trial registration, usage reports, telemetry and update check. Only these differ: the paths (`/api/nodupe/...`), the signing and hashing prefix (`nodupe-`), the database (separate), the trial terms and privacy versions, and the free trial itself, which counts scans in three modes. The server keys (`kid` and public keys) are the same as PinchPDF's.

## Endpoints used by the NoDupe app

- **Challenge:** `POST /api/nodupe/trial/v1/challenge`. Plain JSON `{ "proto": 1, "pubkey": "<b64url Ed25519 install public key>" }`. Answer: a 57-byte challenge to solve (proof of work).
- **Register the free trial:** `POST /api/nodupe/trial/v1/register`. Sealed envelope.
- **Report trial usage:** `POST /api/nodupe/trial/v1/usage`. Sealed envelope.
- **Telemetry:** `POST /api/nodupe/trial/v1/telemetry`. Sealed envelope. Events: `buy_clicked`, `license_activated`, `license_deactivated`, `license_key_changed`, and, from the installer, `install` and `uninstall`.
- **Update check:** `GET /api/nodupe/updates/v1/check?v=1.2.3&channel=stable&os=win11&arch=x64`. `v` is required. `channel` defaults to `stable`. `os` and `arch` are optional and not stored.

## Endpoints for our team (admin login)

- **Insights dashboard:** `/admin/insights?product=nodupe` (tabs: Trials, Buying, Licenses, Devices, Installs, Scans).
- **Insights JSON:** `GET /api/nodupe/insights/v1/{buying|licenses|devices|installs|scans}`.
- **API docs (Swagger):** `/api/pinchpdf/trial/docs?product=nodupe` (password protected; the Product dropdown at the top switches between PinchPDF, NoDupe and All).

## The contract in short

Everything follows PinchPDF's protocol (see `TRIAL_REGISTRATION_PROTOCOL.md` in the PinchPDF repository and [PINCHPDF_TRIAL_SERVICE.md](PINCHPDF_TRIAL_SERVICE.md)); this is what is different for NoDupe. Full detail: [PINCHPDF_TELEMETRY.md](PINCHPDF_TELEMETRY.md) and the NoDupe Swagger.

- **Domain strings** (all prefixed `nodupe-`):
  - envelope: HKDF info `nodupe-trial-v1 req` and `nodupe-trial-v1 resp`; request AAD `POST /api/nodupe/trial/v1/<endpoint>|<kid>`
  - signal hash: `SHA-256("nodupe-trial-signal-v1|<name>|" || normalized value)`
  - challenge MAC: `nodupe-trial-challenge-v1`
  - usage signature: `nodupe-trial-usage-v1|<trial_id>|<basic>|<similar>|<deep>`
  - telemetry signature: `nodupe-telemetry-v1|<event_id>|<customer_uuid>|<type>|<occurred_at>|<plan>|<license>|<prev_license>`, plus `|<install_kind>` for `install` and `uninstall`
  - license hash: `SHA-256("nodupe-telemetry-license-v1|" || normalized key)`
- **Free trial:** 5 Basic, 3 Similar and 1 Deep scan, each counted when the scan completes. `usage` sends `used: {basic, similar, deep}` (running totals, never deltas); the server keeps the highest value per mode, capped at its limit, and answers `used` and `limit` per mode. The trial is `exhausted` only when all three modes are at their limit.
- **Register** takes the same fields as PinchPDF, plus an optional `used: {basic, similar, deep}`: an install that already used free scans before registering sends them, so registering never gives it a fresh trial.
- **Plans:** `individual` or `business` (NoDupe Individual, NoDupe Business).
- **Terms and privacy versions** to send in `consent`: `terms_version` and `privacy_version` must both be `2026-11-24` (NoDupe's trial texts; any other value answers `terms_outdated` with the current ones).
- **Placeholder values:** NoDupe's "no MachineGuid" fallback (`duplicate-cleaner-fallback-machine-id`) is treated as unusable, as the app plan requires.
- **Shared vectors** (copy byte-identically with the `.sha256` files and pass them in Rust tests): `test/nodupe-trial-protocol-vectors.json` and `test/nodupe-telemetry-protocol-vectors.json`.
- **Installer events:** the installer and uninstaller use the **same install id (`customer_uuid`) and install key** as the app, and send only `install` (with `install_kind`: `new`, `upgrade` or `reinstall`) and `uninstall`. The server ignores and does not store any license, plan, device signals or trial id sent with them. See privacy section 2.12.

## Links to put in the app, installer and store listings

- Privacy Policy: https://technowizsolutions.com/privacy
- Terms of Service: https://technowizsolutions.com/terms
- NoDupe free-trial privacy notice (Annex B), for the registration screen: https://technowizsolutions.com/privacy#nodupe-trial
- NoDupe free-trial terms (Schedule B, Part 2), for the registration screen: https://technowizsolutions.com/terms#schedule-b-trial
- NoDupe license and purchase events (Privacy 2.11): https://technowizsolutions.com/privacy#nodupe-license-events
- Install and uninstall events (Privacy 2.12), for the installer and uninstaller: https://technowizsolutions.com/privacy#install-events
- Retention (Privacy 7): https://technowizsolutions.com/privacy#retention
- International transfers (Privacy 8): https://technowizsolutions.com/privacy#international-transfers
- Exercise your rights (Privacy 10.6): https://technowizsolutions.com/privacy#exercise-rights
- Software License (Terms, Part B): https://technowizsolutions.com/terms#software-license
- NoDupe license terms (Terms, Schedule B): https://technowizsolutions.com/terms#schedule-b
- All legal documents: https://technowizsolutions.com/legal

These are anchors inside the two main pages. There are no separate NoDupe legal pages. The legal text is a draft for counsel (the same status as PinchPDF's).

## What the app must do

1. Register before the first scan, with name, email, the 18+ confirmation, acceptance of the trial terms and privacy notice (link them), and the three device hashes, exactly as PinchPDF does. Send the scans already used by an existing install in `used`.
2. Report usage after each completed scan (cumulative per mode), and the telemetry events above. Debug builds send nothing.
3. Show the user their support reference (from `register`) and, if it shows one, their install identifier, so we can answer deletion requests (Privacy 10.6).
4. Show the free allowance as 5 Basic, 3 Similar, 1 Deep, to match Terms Schedule B.
5. The installer and uninstaller tell the user about the install and uninstall reports and link to `/privacy#install-events`. Counsel still has to confirm that a notice (no tick box) is enough.

## Retention

Trial data and telemetry are kept as stated in the privacy notice: name and email erased 24 months after the last contact, device hashes, counts and the support reference up to 5 years, events 24 months.

## For us (internal)

- Before NoDupe ships registration, deploy the Worker (it needs the `NODUPE_DB` binding and the two new version settings, both in `wrangler.json`) and apply `npx wrangler d1 migrations apply nodupe --remote`. Then run the smoke tests with `--product nodupe`, and extend the WAF rule to `/api/nodupe/trial/`.
- Add `NODUPE_TRIAL_*` versions to the vectors and the app together if the trial text changes (a new text is a new version key).
