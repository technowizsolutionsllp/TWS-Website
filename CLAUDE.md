# Rules for this repository

## Swagger must always match the API

Whenever an API endpoint is **created, modified or removed**, update the Swagger (OpenAPI) spec in the **same change**. This includes a change to the endpoint's request or response **schema**: a new, renamed, removed or retyped field, a new event type or enum value, a new status code or error, a changed limit, or a change to the signed message.

- The spec is `lib/trial/openapi.ts`. It is served, behind a login, at `/api/pinchpdf/trial/docs`.
- Update, as they apply: the path and operation (summary, description, tags, responses), the `components/schemas` entries, the intro in `info.description`, and the `NoDupe` or other product tag.
- Update the matching prose docs too: `docs/PINCHPDF_TELEMETRY.md`, `docs/NODUPE_APP_LINKS.md`, `docs/RELEASES.md` or `docs/UPDATES_WORKER.md`.
- `test/docs.test.ts` enforces the part a machine can check: every `app/api/**/route.ts` must have a spec path (or be listed in `NOT_IN_SPEC` with a reason), and no spec path may lack a route file. It cannot see schema changes, so check those yourself.
- Do not call an API change finished, or open a PR for it, until the Swagger is updated and `npx vitest run test/docs.test.ts` passes.

## NoDupe mirrors PinchPDF

NoDupe has the same trial service, telemetry, Insights, Swagger, scripts and legal text as PinchPDF. The only intended difference is the free-trial variables (NoDupe counts scans in three modes: 5 Basic, 3 Similar, 1 Deep; PinchPDF has one counter), plus the product name, paths (`/api/nodupe/...`), database (`nodupe`) and signing prefix (`nodupe-`).

- The two products share code through `lib/trial/product.ts` (a product setting). When you change the trial, telemetry, Insights, health checks, scripts or the trial and privacy text for one product, make the same change for the other in the same change, or say why it is not needed.
- Do not assume how NoDupe differs. Ask, or read the NoDupe app repository (`Duplicate Cleaner`, plan in `docs/plans/UPDATES_TELEMETRY_SIGNING_PLAN.md`, limits in `src-tauri/src/usage_guard.rs`).
- `test/nodupe-trial.test.ts`, `test/nodupe-vectors.test.ts` and the NoDupe parts of the legal tests keep the two in step.
