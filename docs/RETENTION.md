# Data retention: what is deleted, when, and what does it

The retention periods promised in the privacy notices (`/privacy`, Annex A PinchPDF and Annex B NoDupe) are applied by a job, not by hand. This page says what the job does, how to deploy and check it, and how to run it manually.

## What is kept, and for how long

All periods are counted from the **last time the app contacted our server** (`trials.last_server_contact_at`), except where a row says otherwise. They apply to both products, each in its own database.

| Data | Period | What happens |
|---|---|---|
| Trial name and email (and the email index used for support lookup) | 24 months (730 days) | Erased (set to NULL). The row stays, so the one-trial-per-computer rule and the usage counts keep working. |
| The whole trial record (device hashes, counts, support reference) | 5 years (1826 days) | The row is deleted. That computer can then register a new free trial. |
| Operator audit rows (`trial_audit`: who did what and why; no name, email or hash) | 5 years after they were written | Deleted. |
| Telemetry events (buy clicks, license events, installs, uninstalls), and the customer and device rows only they used | 24 months (730 days) after receipt | Deleted. |

Every erasure and deletion done by the job is written to `trial_audit` first (`retention-erase-contact`, `retention-delete-record`, operator `retention-job`), holding the support reference only (never a name, email or hash). Those audit rows age out after 5 years like the others.

Not covered here: request logs kept by Cloudflare (about 7 days), database backups and exports (see the privacy notice), and the contact-form mailbox.

## How it runs

- **The `tws-retention` Worker** (`workers/retention`) runs every day at 03:17 UTC (Cron Trigger). It holds no secrets and reads no personal data: the statements only compare timestamps. It has the two D1 bindings (`TRIAL_DB` = `pinchpdf`, `NODUPE_DB` = `nodupe`) and answers no HTTP requests (404).
- If a run fails for either product (database missing or a statement error) the Cron run **fails** and shows as failed in the Cloudflare dashboard. A failure for one product does not stop the other.
- The SQL is in `scripts/trial-retention-sql.mjs` (trials) and `scripts/telemetry-purge-sql.mjs` (telemetry), shared by the Worker, the manual scripts and the tests. The orchestration is `lib/retention/run.ts`.
- **The Health check** (`/admin/health`) has a "Trial retention" and a "Telemetry retention" item per product. They warn when a name or email is held more than 3 days beyond 24 months, a record more than 3 days beyond 5 years (telemetry: 30 days of slack), which means the job is not running.

## Deploy (once)

The Worker is separate from the website, like `tws-updates`.

```powershell
npm run deploy:retention:dry-run
npm run deploy:retention
```

or as another Workers Builds project (name `tws-retention`, deploy command `npx wrangler deploy --config workers/retention/wrangler.json`). Cron Triggers are available on the Free plan. CI validates `workers/retention/wrangler.json` with a dry run.

After the first deploy, check **Triggers** on the Worker in the Cloudflare dashboard, and the Health check the next day. To test without waiting: `npx wrangler dev --config workers/retention/wrangler.json --test-scheduled`, then request `/__scheduled`.

The database bindings in `workers/retention/wrangler.json` must match the website's (a deploy test covers the names).

## Run it by hand

Dry run (prints the statements, changes nothing), then run:

```powershell
node scripts/trial-retention.mjs
node scripts/trial-retention.mjs --run --remote
node scripts/trial-retention.mjs --run --remote --nodupe
node scripts/telemetry-purge.mjs --run --remote
node scripts/telemetry-purge.mjs --run --remote --nodupe
```

Deletion is permanent. Use `--local` instead of `--remote` for the local database.

## Changing a period

1. Change the constant in `scripts/trial-retention-sql.mjs` (and `lib/trial/retention.ts` re-exports it) or `scripts/telemetry-purge-sql.mjs` (and `lib/telemetry/retention.ts`). Tests fail if the copies disagree.
2. Change the privacy notice (`app/pinchpdf/legal/versions.ts`, `app/nodupe/legal/versions.ts`, `app/privacy/page.tsx`) in the same change. Once any user has accepted a notice version, publish the new text under a new version key.

## Open items

- Counsel is to decide whether 5 years for device hashes can be defended (`docs/legal/PRIVACY_LEGAL_REVIEW.md`, C1). Shortening it is a one-constant change plus the notice.
- The notices also mention weekly exports aged out after 90 days. No export job exists in this repository; confirm what the export is, or remove the sentence.
