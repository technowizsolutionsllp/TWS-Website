# Rules for this repository

## Swagger must always match the API

Whenever an API endpoint is **created, modified or removed**, update the Swagger (OpenAPI) spec in the **same change**. This includes a change to the endpoint's request or response **schema**: a new, renamed, removed or retyped field, a new event type or enum value, a new status code or error, a changed limit, or a change to the signed message.

- The spec is `lib/trial/openapi.ts`. It is served, behind a login, at `/api/pinchpdf/trial/docs`.
- Update, as they apply: the path and operation (summary, description, tags, responses), the `components/schemas` entries, the intro in `info.description`, and the `NoDupe` or other product tag.
- Update the matching prose docs too: `docs/PINCHPDF_TELEMETRY.md`, `docs/NODUPE_APP_LINKS.md`, `docs/RELEASES.md` or `docs/UPDATES_WORKER.md`.
- `test/docs.test.ts` enforces the part a machine can check: every `app/api/**/route.ts` must have a spec path (or be listed in `NOT_IN_SPEC` with a reason), and no spec path may lack a route file. It cannot see schema changes, so check those yourself.
- Do not call an API change finished, or open a PR for it, until the Swagger is updated and `npx vitest run test/docs.test.ts` passes.
