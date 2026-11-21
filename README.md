# Technowiz Solutions website

The marketing site for Technowiz Solutions (products: PinchPDF, NoDupe) and the backend services the PinchPDF app talks to. It is a vinext (Next.js on Cloudflare Workers) app with a D1 database.

| Area | What it is | Docs |
|---|---|---|
| Website | Marketing pages, contact and support forms, legal pages | `app/` |
| Trial service | PinchPDF free-trial registration: sealed, rate-limited API with one trial per computer | [docs/PINCHPDF_TRIAL_SERVICE.md](docs/PINCHPDF_TRIAL_SERVICE.md) |
| App telemetry | Buy clicks and license events reported by the app (activate, deactivate, change key) | [docs/PINCHPDF_TELEMETRY.md](docs/PINCHPDF_TELEMETRY.md) |
| Admin | `/admin`: Insights (Trials, Buying, Licenses, Devices tabs), Health check, API docs link | [trial service doc](docs/PINCHPDF_TRIAL_SERVICE.md), [telemetry doc](docs/PINCHPDF_TELEMETRY.md) |
| API docs | Swagger at `/api/pinchpdf/trial/docs` (own login) covering the trial, telemetry and Insights JSON endpoints | |
| Brand | Guidelines, logos, icons | [docs/TECHNOWIZ_BRAND_GUIDELINES.md](docs/TECHNOWIZ_BRAND_GUIDELINES.md) |

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

## Privacy and legal status (open items)

The privacy and terms pages and the trial notices are drafts (`reviewed: false` in `app/pinchpdf/legal/versions.ts`). A counsel-style review prepared by an AI model, not a lawyer, lists what must be settled before the trial registration ships (see `docs/LEGAL_COUNSEL_MEMO.md` if present; its points are marked for verification by a licensed advocate). Where it meets the code in this repository:

- **Telemetry changes a promise.** The legal text and the PinchPDF README say licensed users send nothing to a server. Telemetry sends license events from licensed installs, so those statements, the store listings and in-app text must change before the app ships it.
- **Consent is collected in the app.** The review recommends a separate, unticked, specific consent for device identifiers, with nothing read before consent and a way to withdraw in the app. The server currently trusts the app on this and stores no consent evidence (notice version and time) for telemetry, unlike the trial registration.
- **Retention.** Telemetry events and device hashes have no retention period or purge job yet. Erasing one customer is a manual SQL delete (documented). A period has to be chosen and made true in code before it is promised in a notice.
- **Pseudonymised, not anonymous.** Device and license values are keyed hashes of persistent identifiers. Describe them that way. If the app sends `trial_id`, telemetry can be linked to the trial's encrypted name and email.
- **Records.** The processing register, the balancing test and impact assessment, processor agreements and an incident runbook should cover telemetry as well as the trial.
- **Translations.** The notices must exist in the product's languages, with English controlling.
- **What already fits.** No names, emails, raw license keys or raw device values are stored; logs hold result codes only; both are covered by tests.

Nothing here is legal advice. Decisions on wording, retention periods and consent design are for the owner and a licensed advocate.
