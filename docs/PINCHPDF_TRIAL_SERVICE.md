# PinchPDF trial service: setup, operations and implementation notes

Implements the website side of the shared protocol (`TRIAL_REGISTRATION_PROTOCOL.md`, version 1, revision 3) and the website plan.
Code: `lib/trial/*` (logic), `app/api/pinchpdf/trial/v1/*` (routes), `migrations/0001_trials.sql`, `scripts/trial-admin.mjs` (operator), `app/pinchpdf/legal/*` (versioned legal pages), `test/*` (tests and shared vectors).

## Before the first deploy (one-time, needs your Cloudflare account)

`wrangler.json` currently holds a **placeholder D1 `database_id`** (`00000000-0000-4000-8000-000000000000`). `npm run deploy` fails until you replace it.

1. Create the databases: `npx wrangler d1 create pinchpdf-trial-prod` and `pinchpdf-trial-staging`. Put the production id into `wrangler.json`.
2. Apply the migration: `npx wrangler d1 migrations apply pinchpdf-trial-prod --remote` (and staging).
3. Generate secrets (different values for staging and production), then `npx wrangler secret put <NAME>`:
   `PEPPER`, `PEPPER_EMAIL`, `PII_KEY`, `CHALLENGE_KEY` (each 32 random bytes, base64url) and `TRIAL_KEY_k1` (X25519 private key, raw 32 bytes, base64url).
   For the API docs also set `DOCS_USER` and `DOCS_PASSWORD` (a long random password; see below).
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` makes a value. **Losing `PEPPER` or `PII_KEY` makes stored hashes and contact data unreadable: keep an offline backup.**
4. `node scripts/trial-keygen.mjs k1` prints a key pair: set the private value as `TRIAL_KEY_k1`, and give the **public** value (with the kid) to the app.
5. Staging needs its own Worker environment or a separate deploy so it can use its own D1 database, secrets and key pair (the plan requires different keys per environment).
6. Add the WAF rate-limiting rule (Free plan: one rule): path starts with `/api/pinchpdf/trial/`, block above 10 requests per 10 s per IP for 10 s.
7. Add a dashboard notification at 70 percent of the daily Worker request and D1 write quotas.
8. Run `node scripts/trial-smoke.mjs https://<staging host>` with `TRIAL_SERVER_PUBLIC` and `TRIAL_KID` set.

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
- Protected by HTTP Basic authentication against the `DOCS_USER` and `DOCS_PASSWORD` Worker secrets (`npx wrangler secret put DOCS_USER`, same for the password). **If either secret is unset the routes answer 404**, so the docs are off by default.
- Requests are limited per IP (`TRIAL_DOCS_LIMITER`, 20 per minute) before credentials are checked, and the path sits under `/api/pinchpdf/trial/`, so the WAF rule also covers it. Use a long random password: Basic auth over TLS is only as strong as the password.
- Swagger UI is loaded from jsDelivr at a pinned version with Subresource Integrity hashes (`lib/trial/docs.ts`); update the version and both hashes together.
- "Try it out" is disabled because `/register` and `/usage` need sealed envelopes that a browser form cannot build. `scripts/trial-smoke.mjs` is the working client.
- Do not put the credentials in the URL (`user:pass@host`): browsers then refuse the spec request. Let the browser prompt.
- Keep the spec in step with the protocol; `test/docs.test.ts` checks the paths, the results and that no `$ref` dangles.

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
