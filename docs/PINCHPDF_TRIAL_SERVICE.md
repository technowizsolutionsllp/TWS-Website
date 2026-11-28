# PinchPDF trial service: setup, operations and implementation notes

> NoDupe runs the **same** service (same code, its own paths, database and signing prefix, and one counter per scan mode). Everything below describes PinchPDF; the section [NoDupe: the same service](#nodupe-the-same-service) says what differs and how to deploy it.

Implements the website side of the shared protocol (`TRIAL_REGISTRATION_PROTOCOL.md`, version 1, revision 5: revision 5 adds `/lookup` and continuing a trial on a recognised computer, see [below](#continuing-a-trial-on-a-recognised-computer-revision-5)) and the website plan.
Code: `lib/trial/*` (logic), `app/api/pinchpdf/trial/v1/*` (routes), `migrations/*` (0001 trials, 0002 admin metrics, 0003 telemetry), `scripts/trial-admin.mjs` (operator), `lib/telemetry/*` and `docs/PINCHPDF_TELEMETRY.md` (app telemetry: buy clicks and license events, shown in the Insights tabs), `app/pinchpdf/legal/*` (trial terms and privacy notice; the stable addresses always show the latest text), `test/*` (tests and shared vectors).

## Before the first deploy (one-time, needs your Cloudflare account)

`wrangler.json` holds the production D1 database (`pinchpdf`) and `migrations/` must be applied to it once: `npx wrangler d1 migrations apply pinchpdf --remote`.

1. Create the databases. Production is the D1 database `pinchpdf` (its id is already in `wrangler.json`); create a separate staging one, for example `npx wrangler d1 create pinchpdf-trial-staging`.
2. Apply the migration: `npx wrangler d1 migrations apply pinchpdf --remote` (and staging). **Not done yet for production**: until it runs, the trial endpoints answer 503.
3. Generate secrets (different values for staging and production), then `npx wrangler secret put <NAME>`:
   `PEPPER`, `PEPPER_EMAIL`, `PII_KEY`, `CHALLENGE_KEY` (each 32 random bytes, base64url) and `TRIAL_KEY_k1` (X25519 private key, raw 32 bytes, base64url).
   For the API docs also set `DOCS_USER` and `DOCS_PASSWORD` (a long random password; see below).
   **Format: base64url, not hex.** Only A-Z a-z 0-9 - _ ; no `=` padding, no `/` or `+`, no quotes or spaces. 32 bytes is **43 characters**. `PII_KEY` and `TRIAL_KEY_<kid>` must be **exactly** 32 bytes; the other three need at least 16. A 64-character hex string decodes to 48 bytes and is rejected for `PII_KEY` and `TRIAL_KEY_<kid>` (every request then fails). For `TRIAL_KEY_<kid>` use `node scripts/trial-keygen.mjs <kid>`, which also prints the public key for the app; `scripts/trial-pubkey.mjs` derives the public key from an existing private one (header of the script shows how; it reads the value from the `TRIAL_PRIVATE` environment variable).
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

`.github/workflows/ci.yml` runs on every pull request and on pushes to the default branch: typecheck, lint, the Vitest suite (workerd with a local D1), a check that the committed vectors equal what `scripts/generate-trial-vectors.mjs` (trial) and `scripts/generate-telemetry-vectors.mjs` (telemetry) produce, a production build, and a `wrangler deploy --dry-run` that validates `wrangler.json` and its bindings without uploading anything. A second job fails on a critical advisory in production dependencies. CI needs no secrets (tests use the public test-only values in `vitest.config.ts`) and has a read-only token. Actions are pinned to commit SHAs. To make the checks block merging, turn on branch protection for the default branch and require the two jobs.

## Local development

```
copy .dev.vars.example .dev.vars        # fill with random values
npx wrangler d1 migrations apply TRIAL_DB --local --config wrangler.json
npm run dev
node scripts/trial-smoke.mjs            # full register / usage flow against localhost
node scripts/telemetry-smoke.mjs        # telemetry events and the Insights JSON API (writes rows: staging or local only)
npm test                                # Vitest in workerd with a local D1
```

## API documentation (Swagger)

- Page: `/api/pinchpdf/trial/docs` (Swagger UI). It documents the trial endpoints (`challenge`, `register`, `usage`), the sealed `telemetry` endpoint and the read-only Insights JSON API (`/api/pinchpdf/insights/v1/{tab}`, behind the admin login). `test/deploy-config.test.ts` fails if an API route exists that Swagger does not describe. Spec: `/api/pinchpdf/trial/docs/spec` (OpenAPI 3.1 JSON, built in `lib/trial/openapi.ts`).
- **Configuration check:** `/api/pinchpdf/trial/docs/health` (same user ID and password). `200 {"ok":true}` means the trial endpoints will run. `503` lists each missing or malformed secret by name with the reason (for example `PII_KEY: decodes to 48 bytes, expected exactly 32 ... This looks like HEX`), never a value. The admin health page (below) shows the same and more.
- **When the configuration is wrong the three trial endpoints answer 503 `{"error":"unavailable"}`** (the app shows "service unavailable") and log one `config_invalid` line (at most once a minute) with the same names and reasons. A refused sealed request logs `envelope_rejected` with a `reason` and the `kid` (at most 5 a minute); `decrypt_failed` means the app encrypted to a public key that is not the pair of this server's `TRIAL_KEY_<kid>`. Responses to the app stay opaque (400, 421, 503) on purpose.
- Protected by HTTP Basic authentication against the `DOCS_USER` and `DOCS_PASSWORD` Worker secrets (`npx wrangler secret put DOCS_USER`, same for the password). **If either secret is unset, or the password is shorter than 8 characters, the routes answer 404**, so the docs are off until a strong password is set.
- Requests are limited per IP (`TRIAL_DOCS_LIMITER`, 20 per minute) before credentials are checked; if that binding is unavailable an in-memory per-isolate limiter with the same numbers takes over. The path sits under `/api/pinchpdf/trial/`, so the WAF rule also covers it. The page is sent with a Content-Security-Policy (per-response nonce; only the pinned Swagger files may load). Use a long random password: Basic auth over TLS is only as strong as the password.
- Swagger UI is loaded from jsDelivr at a pinned version with Subresource Integrity hashes (`lib/trial/docs.ts`); update the version and both hashes together.
- "Try it out" is disabled because `/register` and `/usage` need sealed envelopes that a browser form cannot build. `scripts/trial-smoke.mjs` is the working client.
- Do not put the credentials in the URL (`user:pass@host`): browsers then refuse the spec request. Let the browser prompt.
- Keep the spec in step with the protocol; `test/docs.test.ts` checks the paths, the results and that no `$ref` dangles.

## Security notes (from the audit)

- **Support references are identifiers, not proof of ownership.** `already_used` and `/lookup` return the matching trial's `support_ref` to anyone whose device signals match, and `/register` with that reference as `resume` moves the trial to a new install key. That is the intended behaviour for the computer itself (a reinstall), and the device signals are the same check that already decides one trial per computer; a forged set of another computer's hashes would at most continue that computer's trial (count unchanged) and show its masked email and name. The old key then stops reporting usage, and the audit row records it. Before `reset-device` or `adjust-limit`, support must verify the requester (for example, the email address on the trial, via `find --email`), never act on the reference alone.
- **Rate limiting trusts only `cf-connecting-ip`.** `X-Forwarded-For` is client-controlled and is ignored. `/usage` has a per-IP limiter (`TRIAL_USAGE_IP_LIMITER`, 60 per minute) that runs before the envelope is opened, plus the per-trial limiter.
- **Placeholder list.** The server treats the hashes of an exact list of junk values (OEM defaults, common shared UUIDs and serials) as unusable, so nobody can pre-register a shared value to block honest users. Extend `PLACEHOLDER_VALUES` and the generator list together when new shared values are seen in the field, then regenerate the vectors. Requiring two usable signals instead of one is a product decision not taken here.
- **Test secrets.** `vitest.config.ts` contains fixed test-only secrets. Never use them as real secrets.
- **Dependencies.** Run `npm audit` before each release.

## Continuing a trial on a recognised computer (revision 5)

A computer that already holds a trial gets that trial back, with the count the service already has, when the app is reinstalled or its data (and so its install key) is lost. It is never given a fresh trial.

1. Before the registration form, the app sends a sealed `POST .../lookup` with `{ proto: 1, signals }`. It uses the same matching policy as `/register` step 7 and writes nothing; no proof of work. Answers:
   - `found` with `state` (`active` or `exhausted`), `used`, `limit`, `registered_at`, `email_hint` (masked, `j•••@example.com`; `null` after an erase) and `support_ref`;
   - `already_used` with the `support_ref` only, for a revoked trial;
   - `none` (show the registration form) or `unsupported_device`.
2. On `found` the app offers "Continue your trial". Continuing is a normal `/register` (challenge, proof of work, new install key, the **current** consent) with `resume: <support_ref>`. With `resume`, `name` and `email` may be left out (the stored ones are kept); one that is sent replaces the stored one.
3. `/register` step 7, when a stored trial matches the computer:
   - revoked: `already_used` with the support reference only;
   - `resume` equals that trial's `support_ref`, or the email matches the stored one (blind index, case-insensitive): the trial **continues**. The answer is `registered` with the original `trial_id`, `registered_at` and `support_ref`, the current `state`, `used` and `limit`, and `restored: true`. A used-up trial comes back `exhausted`;
   - anything else (another email on the same computer, whatever the name): `already_used` with `support_ref`, `registered_at` and `name_hint` (masked, `J••• D•••`; `null` after an erase).
4. What a continue writes (`restoreTrial` in `lib/trial/db.ts`, one D1 batch): the new key becomes `pubkey` and the old one moves to `pubkey_retired`; the new consent versions, `accepted_at`, `received_at`, `last_server_contact_at`, app and Windows versions; a name or email that was sent (encrypted, and the email's blind index); for NoDupe, a reported `used` merged per mode (never lowering a count, never above the limit); and a `trial_audit` row (`action` `restore`, `reason` `resume` or `email`, `operator` `service`, `details` the counts before and the replaced install key as `previous_key`, no name or email). The row keeps only the latest replaced key in `pubkey_retired`; the audit keeps every one. `created_at` is never changed: it is the `registered_at` every answer shows.
5. **Races.** The write only applies to an `active` row that does not already have the new key. If it writes nothing, the handler decides again: an identical request that already moved the trial gets the plain replay answer (no second audit row, and `pubkey_retired` keeps the old key); a trial revoked meanwhile is refused with its support reference; a trial reset or deleted meanwhile no longer blocks, so a new trial is registered (when a name and email were sent). Two different new keys continuing at the same moment: the later write wins, and the other install gets `400` on its next usage report.
6. The old install's key stops working: its `/usage` reports get `400`, which the app treats as "service unavailable", so it keeps its local count. A replay of the new key is plain idempotency (step 5) and does not carry `restored`.

The admin Records page shows each continued trial ("Continued N times", the last date and how it was recognised), see [ADMIN.md](ADMIN.md#records-adminrecords). Tests: `test/service.test.ts`, `test/nodupe-trial.test.ts` and `test/trial-restore.test.ts` (races, a repeated continue, counters, the rate limiter, the route files, Records).

The rules are pure functions in `lib/trial/restore.ts` (`restoreDecision`, `maskEmail`, `maskName`, `mergeCounts`), checked against the `restore` section of the shared vectors. Insights counts `/lookup` as its own endpoint and a continue as the register outcome `restored`. The trial terms and privacy notice describing this are the `2026-11-28` versions.

## Operator actions

`node scripts/trial-admin.mjs <command> --env local|staging|prod ...` (header of the script lists them). Each change needs `--reason`, writes an audit row in the same batch, and on staging and prod prints a dry run unless `--yes` is given. Secrets come from `.dev.vars`, `.dev.vars.staging`, `.dev.vars.prod` (git-ignored). Only `export-contact` prints name and email. The same erase and delete actions are also on the admin Records page and its JSON API (`/admin/records`, see [ADMIN.md](ADMIN.md#records-adminrecords)), audited the same way. Retention (name and email after 24 months, records after 5 years) is applied by the daily `tws-retention` Worker: [RETENTION.md](RETENTION.md).

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
10. **Legal text is a draft.** `app/pinchpdf/legal/versions.ts` has `reviewed: false` until someone qualified has reviewed the text. Since November 27, 2026 the pages no longer show a draft notice (owner decision). The trial notice is Annex A of `/privacy` and the trial terms are Schedule A, Part 2 of `/terms`; the app links to `/privacy#pinchpdf-trial` and `/terms#schedule-a-trial` directly (the old `/pinchpdf/legal/...` addresses were removed and now show a 404). The text always shows the latest version; the version key is the effective date and is what the server records as consent evidence. The open privacy and legal items, including the stale `/privacy` text, are listed once, in the [README](../README.md#privacy-and-legal-status-open-items).
11. **Shared vectors.** `test/trial-protocol-vectors.json` is generated by `scripts/generate-trial-vectors.mjs` (independent of `lib/trial`); its SHA-256 is in `test/trial-protocol-vectors.sha256` and checked by a test. Per D9, copy the JSON byte-identically into the app repository and record the hash in the protocol header. `.gitattributes` keeps the bytes stable on Windows.

## NoDupe: the same service

NoDupe has the same trial registration, usage reports, telemetry and Insights as PinchPDF. The code is shared; `lib/trial/product.ts` holds the per-product settings and every handler takes a `product`. The only intended difference is the free trial: PinchPDF has one counter (5 uses), NoDupe one counter per scan mode (5 Basic, 3 Similar, 1 Deep), counted when a scan completes (confirmed in the NoDupe app, `usage_guard.rs`).

| | PinchPDF | NoDupe |
|---|---|---|
| Endpoints | `/api/pinchpdf/trial/v1/{challenge,lookup,register,usage,telemetry}` | `/api/nodupe/trial/v1/{challenge,lookup,register,usage,telemetry}` |
| Database | D1 `pinchpdf`, binding `TRIAL_DB`, `migrations/` | D1 `nodupe`, binding `NODUPE_DB`, `migrations-nodupe/` |
| Signing and hashing prefix | `pinchpdf-` | `nodupe-` (HKDF labels `nodupe-trial-v1 req` and `resp`, signal hash `nodupe-trial-signal-v1`, challenge `nodupe-trial-challenge-v1`, usage `nodupe-trial-usage-v1`, telemetry `nodupe-telemetry-v1`) |
| Trial terms and privacy versions | `TRIAL_TERMS_VERSION`, `TRIAL_PRIVACY_VERSION` | `NODUPE_TRIAL_TERMS_VERSION`, `NODUPE_TRIAL_PRIVACY_VERSION` (both products `2026-11-28`) |
| Usage report | `used: <number>`, signed `pinchpdf-trial-usage-v1\|<trial_id>\|<used>` | `used: {basic, similar, deep}`, signed `nodupe-trial-usage-v1\|<trial_id>\|<basic>\|<similar>\|<deep>` |
| Register | as documented | the same, plus an optional `used: {basic, similar, deep}` for an install that already used some free scans before registering (clamped to 5 / 3 / 1; registering never gives a fresh trial); when it continues a trial (revision 5) the reported counts are merged per mode |
| State | `exhausted` when used reaches the limit | `exhausted` only when **all three** modes are at their limit |
| One trial per computer | per product (a PinchPDF trial never blocks a NoDupe trial on the same computer, and the reverse) | per product |

Shared by both products: the server key pairs (`TRIAL_KEY_<kid>`, `ACCEPTED_KIDS`) and the secrets (`PEPPER`, `PEPPER_EMAIL`, `PII_KEY`, `CHALLENGE_KEY`), the rate-limiter bindings (NoDupe's requests use keys prefixed `nodupe|`, so the two never share a bucket) and the Swagger page (`/api/pinchpdf/trial/docs`, product filter at the top). Losing a shared secret affects both products.

**Deploy for NoDupe**

1. `npx wrangler d1 migrations apply nodupe --remote` (applies `0002_trials_and_telemetry.sql`, which creates the trial and telemetry tables and drops the unused anonymous scan-report tables of `0001`). The `nodupe` database already exists and is bound as `NODUPE_DB` in `wrangler.json`.
2. Deploy the Worker. The new settings `NODUPE_TRIAL_TERMS_VERSION` and `NODUPE_TRIAL_PRIVACY_VERSION` are in `wrangler.json`; there are no new secrets. Until the migration is applied the NoDupe endpoints answer 503 and PinchPDF is unaffected (and the other way round).
3. Extend the one Free-plan WAF rule to also match paths that start with `/api/nodupe/trial/`.
4. `node scripts/trial-smoke.mjs https://<staging host> --product nodupe`, then `node scripts/telemetry-smoke.mjs https://<staging host> --product nodupe`, then the admin Health check page (each product has its own checks and self-test).
5. Give the NoDupe app team `docs/NODUPE_APP_LINKS.md` (the contract and links), the Swagger spec for NoDupe (`?product=nodupe`), and `test/nodupe-trial-protocol-vectors.json` and `test/nodupe-telemetry-protocol-vectors.json` with their `.sha256` files, byte-identically.

**Operator tool**: `node scripts/trial-admin.mjs <command> --product nodupe ...` (NoDupe's database; `adjust-limit` needs `--mode basic|similar|deep`). NoDupe has no staging database; to use one, create it and pass `--staging-db <name>`.

**Placeholder list**: NoDupe also treats its "no MachineGuid" fallback constant (`duplicate-cleaner-fallback-machine-id`) as unusable. PinchPDF's list and vectors are unchanged.

## Admin pages and health check

Moved to [ADMIN.md](ADMIN.md).
