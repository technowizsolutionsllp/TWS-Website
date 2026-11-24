# NoDupe: endpoints and legal links

For the NoDupe app team. Base URL: `https://technowizsolutions.com`.

## Endpoints

| What | Method and address | Notes |
|---|---|---|
| Scan report | `POST /api/pinchpdf/trial/v1/telemetry` | Event `scan_summary`. Sealed and signed envelope, same as PinchPDF. |
| Update check | `GET /api/nodupe/updates/v1/check?v=1.2.3&channel=stable&os=win11&arch=x64` | `v` is required. `channel` defaults to `stable`. `os` and `arch` are optional and not stored. |
| API docs (Swagger) | `/api/pinchpdf/trial/docs` | Password protected. |

NoDupe does not use `challenge`, `register` or `usage` (those are for the PinchPDF trial). It needs no proof of work and no registration.

Full contract, signing format and test vectors: [PINCHPDF_TELEMETRY.md](PINCHPDF_TELEMETRY.md). Update check details: [RELEASES.md](RELEASES.md) and [UPDATES_WORKER.md](UPDATES_WORKER.md).

### `scan_summary` in short

- Send only this event from NoDupe. Send `scans` as running totals: `{ "basic": 0, "similar": 0, "deep": 0 }`. Each value is 0 to 1,000,000.
- Free trial allowance: 5 Basic, 3 Similar, 1 Deep. The app enforces it. The server only records what it is told.
- Signed message: `pinchpdf-telemetry-v1|event_id|customer_uuid|type|occurred_at|plan|license|prev_license`, then `|<basic>|<similar>|<deep>`. For `scan_summary`, plan, license and prev_license are empty.
- It is anonymous. Do not send a name, email, device hash, license key or trial id. The server ignores them and stores none.
- Data goes to a separate database (`nodupe`). `503` means the service is not set up yet. Retry later.

## Insights (for our team, not the app)

Read-only, behind the admin login (HTTP Basic, `ADMIN_USER` / `ADMIN_PASSWORD`). The app never calls these.

| What | Address |
|---|---|
| Dashboard, NoDupe scans | `/admin/insights?product=nodupe&tab=scans` |
| Dashboard, all tabs | `/admin/insights` |
| JSON, NoDupe scans | `GET /api/pinchpdf/insights/v1/scans` |

- Optional date range: `?from=2026-11-01&to=2026-11-24` (`YYYY-MM-DD`). The default is the last 30 days. The maximum is 366 days, and the end date can't be in the future.
- The JSON returns counts only: installs reporting, scan totals per mode, installs at or over the free allowance (5/3/1), new scans in the range, and a daily or weekly series.
- It reads the `nodupe` database. If that database isn't bound yet, the page shows a notice and the JSON returns `503`.
- The Scans tab doesn't use the `product` filter. The JSON is NoDupe-only, so the filter has no effect on it.
- Response schema: `InsightsScans` in Swagger (`/api/pinchpdf/trial/docs`).

## Links to put in the app, installer and store listings

| Link | Address |
|---|---|
| Privacy Policy | https://technowizsolutions.com/privacy |
| Terms of Service | https://technowizsolutions.com/terms |
| NoDupe scan-count report (Privacy 2.11). Use this where the app tells the user about the report. | https://technowizsolutions.com/privacy#nodupe-scan-report |
| Retention (Privacy 7) | https://technowizsolutions.com/privacy#retention |
| International transfers (Privacy 8) | https://technowizsolutions.com/privacy#international-transfers |
| Exercise your rights (Privacy 10.6) | https://technowizsolutions.com/privacy#exercise-rights |
| Software License (Terms, Part B) | https://technowizsolutions.com/terms#software-license |
| NoDupe license terms (Terms, Schedule B) | https://technowizsolutions.com/terms#schedule-b |
| NoDupe free trial (Terms, Schedule B) | https://technowizsolutions.com/terms#schedule-b-trial |
| All legal documents | https://technowizsolutions.com/legal |

These are anchors inside the two main pages. There are no separate NoDupe legal pages.

## What the app must do

1. Tell the user about the scan report, and link to `/privacy#nodupe-scan-report`. Counsel still has to decide whether this is a notice or a consent, and whether there is an off switch.
2. Show the user their install identifier (`customer_uuid`). We can only find, correct or delete their reports if they give us this value (Privacy 10.6).
3. Show the free allowance in the app as 5 Basic, 3 Similar, 1 Deep, to match Terms Schedule B.

## Retention

Scan reports are kept for 24 months after the last report from an install, then deleted.

## For us (internal)

- Dashboard: `/admin/insights?tab=scans`. JSON: `GET /api/pinchpdf/insights/v1/scans` (admin login).
- Before NoDupe ships the report, deploy the Worker so it has the `NODUPE_DB` binding. The `nodupe` D1 migration is already applied.
