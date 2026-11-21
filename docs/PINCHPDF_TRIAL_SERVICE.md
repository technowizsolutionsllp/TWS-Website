# PinchPDF trial service: setup, operations and implementation notes

Implements the website side of the shared protocol (`TRIAL_REGISTRATION_PROTOCOL.md`, version 1, revision 3) and the website plan.
Code: `lib/trial/*` (logic), `app/api/pinchpdf/trial/v1/*` (routes), `migrations/0001_trials.sql`, `scripts/trial-admin.mjs` (operator), `app/pinchpdf/legal/*` (versioned legal pages), `test/*` (tests and shared vectors).

## Before the first deploy (one-time, needs your Cloudflare account)

`wrangler.json` holds the production D1 database (`pinchpdf`) and `migrations/` must be applied to it once: `npx wrangler d1 migrations apply pinchpdf --remote`.

1. Create the databases. Production is the D1 database `pinchpdf` (its id is already in `wrangler.json`); create a separate staging one, for example `npx wrangler d1 create pinchpdf-trial-staging`.
2. Apply the migration: `npx wrangler d1 migrations apply pinchpdf --remote` (and staging). **Not done yet for production**: until it runs, the trial endpoints answer 503.
3. Generate secrets (different values for staging and production), then `npx wrangler secret put <NAME>`:
   `PEPPER`, `PEPPER_EMAIL`, `PII_KEY`, `CHALLENGE_KEY` (each 32 random bytes, base64url) and `TRIAL_KEY_k1` (X25519 private key, raw 32 bytes, base64url).
   For the API docs also set `DOCS_USER` and `DOCS_PASSWORD` (a long random password; see below).
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` makes a value. **Losing `PEPPER` or `PII_KEY` makes stored hashes and contact data unreadable: keep an offline backup.**
4. `node scripts/trial-keygen.mjs k1` prints a key pair: set the private value as `TRIAL_KEY_k1`, and give the **public** value (with the kid) to the app.
5. Staging needs its own Worker environment or a separate deploy so it can use its own D1 database, secrets and key pair (the plan requires different keys per environment).
6. Add the WAF rate-limiting rule (Free plan: one rule): path starts with `/api/pinchpdf/trial/`, block above 10 requests per 10 s per IP for 10 s.
7. Add a dashboard notification at 70 percent of the daily Worker request and D1 write quotas.
8. Run `node scripts/trial-smoke.mjs https://<staging host>` with `TRIAL_SERVER_PUBLIC` and `TRIAL_KID` set.

### Doing the setup in the Cloudflare dashboard instead of the CLI

Yes, this works. Menu names move around, so check the current dashboard.

- **Secrets** (`PEPPER`, `PEPPER_EMAIL`, `PII_KEY`, `CHALLENGE_KEY`, `TRIAL_KEY_k1`, `DOCS_USER`, `DOCS_PASSWORD`): Workers & Pages, the `tws-website` Worker, Settings, Variables and Secrets, Add, and choose type **Secret** (not Text). They are encrypted, cannot be read back, and survive `wrangler deploy`. Set them on whichever Worker actually serves the site. **Never add one as a plain Variable (Text):** `wrangler.json` is the source of truth, so a deploy deletes dashboard-only variables, and the docs and endpoints then quietly switch off. If something stops working after a deploy, check the logs for a `config_incomplete` or `disabled` line: they list which names are present or missing (names only, never values).
- **Plain variables** (`ACCEPTED_KIDS`, versions, difficulty, limit): keep them in `wrangler.json`. `wrangler.json` is the source of truth, so a text variable added only in the dashboard is overwritten on the next deploy.
- **The database has no credentials.** D1 is a binding plus a database id, not a user and password. Create it in the dashboard (Storage and Databases, D1), copy its **Database ID** into `d1_databases[0].database_id` in `wrangler.json`, and commit that (the id is not a secret). Keep the binding in `wrangler.json` too, because bindings that exist only in the dashboard are removed by a deploy.
- **Apply the migration with `wrangler d1 migrations apply`**, not by pasting SQL into the dashboard console: the console does not record the migration, so a later `wrangler` run would try to create the tables again and fail.
- Production and staging need separate databases, secrets and key pairs.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to the default branch: typecheck, lint, the Vitest suite (workerd with a local D1), a check that the committed vectors equal what `scripts/generate-trial-vectors.mjs` produces, and a production build. A second job fails on a critical advisory in production dependencies. CI needs no secrets (tests use the public test-only values in `vitest.config.ts`) and has a read-only token. Actions are pinned to commit SHAs. To make the checks block merging, turn on branch protection for the default branch and require the two jobs.

## Local development

```
copy .dev.vars.example .dev.vars        # fill with random values
npx wrangler d1 migrations apply TRIAL_DB --local --config wrangler.json
npm run dev
node scripts/trial-smoke.mjs            # full register / usage flow against localhost
npm test                                # Vitest in workerd with a local D1
```

## API documentation (Swagger)

- Page: `/api/pinchpdf/trial/docs` (Swagger UI). Spec: `/api/pinchpdf/trial/docs/spec` (OpenAPI 3.1 JSON, built in `lib/trial/openapi.ts`).
- Protected by HTTP Basic authentication against the `DOCS_USER` and `DOCS_PASSWORD` Worker secrets (`npx wrangler secret put DOCS_USER`, same for the password). **If either secret is unset, or the password is shorter than 16 characters, the routes answer 404**, so the docs are off until a strong password is set.
- Requests are limited per IP (`TRIAL_DOCS_LIMITER`, 20 per minute) before credentials are checked; if that binding is unavailable an in-memory per-isolate limiter with the same numbers takes over. The path sits under `/api/pinchpdf/trial/`, so the WAF rule also covers it. The page is sent with a Content-Security-Policy (per-response nonce; only the pinned Swagger files may load). Use a long random password: Basic auth over TLS is only as strong as the password.
- Swagger UI is loaded from jsDelivr at a pinned version with Subresource Integrity hashes (`lib/trial/docs.ts`); update the version and both hashes together.
- "Try it out" is disabled because `/register` and `/usage` need sealed envelopes that a browser form cannot build. `scripts/trial-smoke.mjs` is the working client.
- Do not put the credentials in the URL (`user:pass@host`): browsers then refuse the spec request. Let the browser prompt.
- Keep the spec in step with the protocol; `test/docs.test.ts` checks the paths, the results and that no `$ref` dangles.

## Security notes (from the audit)

- **Support references are identifiers, not proof of ownership.** `already_used` returns the blocking trial's `support_ref` to anyone whose device signals match. Before `reset-device` or `adjust-limit`, support must verify the requester (for example, the email address on the trial, via `find --email`), never act on the reference alone.
- **Rate limiting trusts only `cf-connecting-ip`.** `X-Forwarded-For` is client-controlled and is ignored. `/usage` has a per-IP limiter (`TRIAL_USAGE_IP_LIMITER`, 60 per minute) that runs before the envelope is opened, plus the per-trial limiter.
- **Placeholder list.** The server treats the hashes of an exact list of junk values (OEM defaults, common shared UUIDs and serials) as unusable, so nobody can pre-register a shared value to block honest users. Extend `PLACEHOLDER_VALUES` and the generator list together when new shared values are seen in the field, then regenerate the vectors. Requiring two usable signals instead of one is a product decision not taken here.
- **Test secrets.** `vitest.config.ts` contains fixed test-only secrets. Never use them as real secrets.
- **Dependencies.** Run `npm audit` before each release.

## Operator actions

`node scripts/trial-admin.mjs <command> --env local|staging|prod ...` (header of the script lists them). Each change needs `--reason`, writes an audit row in the same batch, and on staging and prod prints a dry run unless `--yes` is given. Secrets come from `.dev.vars`, `.dev.vars.staging`, `.dev.vars.prod` (git-ignored). Only `export-contact` prints name and email.

Reset procedure (protocol 3.4): ask the user to open PinchPDF online first so unreported usage is sent, run `reset-device`, then run `adjust-limit` on the **new** trial for the unused remainder (decision D8). The server count is a lower bound if the machine was offline.

## Key rotation and emergency

Follow protocol section 7. The allowlist is `ACCEPTED_KIDS` in `wrangler.json` (comma separated); a new key is a new `TRIAL_KEY_<kid>` secret plus an entry in that list. Emergency: remove the kid from `ACCEPTED_KIDS` and redeploy; requests for it get HTTP 421 immediately even though the secret still exists.

## Deviations and gaps against the plan (please review)

1. **Hosting.** The repo is a vinext (Next.js on Workers) app, not Pages. Endpoints are Next route handlers; the logic is host-independent (`lib/trial/handlers.ts` takes `env` and a clock).
2. **Register rate limit.** The plan says 3 per hour per IP; the Workers rate-limit binding only supports 10 s or 60 s periods, so it is 3 per minute. The binding is optional in code (skipped if absent); confirm it enforces on your Free plan.
3. **No index on `support_ref`.** Adds a write per registration; operator lookups by reference scan the table, which is fine at this scale. Add `CREATE INDEX` if the table grows large.
4. **Placeholder rejection.** The server only sees hashes, so it rejects hashes of an **exact** list of normalized placeholder strings (`lib/trial/signals.ts`, version `1`, also in the vectors). The app filters by "contains". The app's MachineGuid fallback constant is not known here: add it to the list (and bump the version) once the app fixes it.
5. **Details the protocol text leaves open, now pinned by the vectors** (the app must match): the server HMAC input is `"<name>|"` followed by the **raw 32 bytes** of the client hash (not its base64url text); the AES-GCM ciphertext carries the 16-byte tag appended (Web Crypto convention); X25519 private keys are stored as raw 32 bytes and wrapped into PKCS#8 internally.
6. **Results not in the protocol table.** A malformed or wrongly signed challenge, an invalid proof of work, a challenge from more than 30 s in the future, a bad usage signature and an unreadable usage request all return plain `HTTP 400 bad_request` (a real client never sends them). A challenge issued at a difficulty the server no longer issues returns the sealed `challenge_expired`, so the app refetches once. An unconfigured or failing service returns `HTTP 503`.
7. **Registration race.** D1 has no interactive transactions, so after the insert the service re-checks for an earlier row from the same machine; the earlier insert wins and the later one withdraws (`already_used`). Covered by a concurrency test.
8. **Revoked trials.** `/usage` on a revoked trial still records usage and answers `state: "revoked"`.
9. **Not measured here.** The 10 ms CPU limit and the real rows-written count need a staging run (spike S0). The local D1 reports the rows written for one registration insert; a usage update adds one more write.
10. **Legal text is a draft.** `app/pinchpdf/legal/versions.ts` has `reviewed: false`, which shows a draft notice and keeps the pages out of search. Have the text reviewed (D6) before release. The existing `/privacy` page says trial counters stay on the device; it must be updated in the same release because registered trials now send data to this service.
11. **Shared vectors.** `test/trial-protocol-vectors.json` is generated by `scripts/generate-trial-vectors.mjs` (independent of `lib/trial`); its SHA-256 is in `test/trial-protocol-vectors.sha256` and checked by a test. Per D9, copy the JSON byte-identically into the app repository and record the hash in the protocol header. `.gitattributes` keeps the bytes stable on Windows.

## Admin pages (`/admin`)

- `/admin` is a home page with a card for each sub-page. `/admin/insights` shows trial and request statistics, with a product selector (PinchPDF, NoDupe, all) and any date range up to 366 days (`?product=all&from=2026-10-01&to=2026-10-31`). Ranges over 120 days are shown as weekly totals. All days are UTC.
- Protected by HTTP Basic authentication against the `ADMIN_USER` and `ADMIN_PASSWORD` Worker secrets. Add them as type **Secret**, never as a plain Variable (a deploy removes dashboard-only variables). **If either is unset, or the password is shorter than 8 characters, the pages answer 404.** A longer password is better. Logins are throttled per IP by `TRIAL_ADMIN_LIMITER`.
- Only aggregate numbers are shown: no names, emails, device hashes or trial ids. The pages run no scripts and are served with `no-store`, `noindex` and a strict CSP.
- **Migration 0002 must be applied** (`npx wrangler d1 migrations apply pinchpdf --remote`). It adds `trials.product` (existing rows become `pinchpdf`) and the `metrics_daily` counters. Until it is applied the pages still load and say request counts are unavailable, and counting is skipped quietly.
- **Request counts are approximate and start when this version goes live.** Handlers tag each response with the result code they already log; `lib/trial/metrics.ts` keeps counts in memory and writes them in small batches (at most one batch per instance every 10 seconds), so a flood of bad requests cannot use up the D1 write allowance and a metrics failure never fails a trial request. A few counts can be lost when an instance restarts.
- **Adding a product.** NoDupe appears in the selector but has no data until its own trial service records rows with `product = 'nodupe'` and counts its requests. That service, its endpoints and its per-product trial limit are not built yet.
