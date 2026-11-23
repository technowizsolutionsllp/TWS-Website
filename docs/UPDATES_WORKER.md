# The update-check Worker (`tws-updates`)

The app update check runs as a Worker of its own, so a website deploy or fault cannot take it down. **The addresses do not change.** Why it exists and what comes next: [ROADMAP.md](ROADMAP.md).

| Address (unchanged) | Answers |
|---|---|
| `GET https://technowizsolutions.com/api/pinchpdf/updates/v1/check?v=&channel=&os=&arch=` | PinchPDF |
| `GET https://technowizsolutions.com/api/nodupe/updates/v1/check?v=&channel=&os=&arch=` | NoDupe |

The Worker uses the same handler (`lib/updates/handler.ts`) as the website's route, so the answer is identical: the same JSON, status codes, cache headers and rate limit. The one visible difference is an extra response header, `x-served-by: tws-updates`, which lets you check from outside which Worker answered. Any other path answers 404 and any method except GET and HEAD answers 405.

**What it holds:** no secrets and no personal data. Its configuration is `workers/updates/wrangler.json`: the two public settings (`RELEASES_REPO`, `RELEASE_PUBLIC_KEY`), the address rate limiter `UPDATES_IP_LIMITER` (the same limiter as the website's, so the count is shared), and the database binding `TRIAL_DB`, used only to add to the daily `update_check` counters. It does not manage migrations; the website's deploy does.

## First deploy and cutover (once)

The website Worker keeps its own copy of the endpoints during all of this, so nothing breaks if a step is undone.

1. **Deploy the Worker.** Either from a computer signed in to Cloudflare:
   ```powershell
   npm run deploy:updates
   ```
   or as a second Workers Builds project in the Cloudflare dashboard (Workers & Pages, Create, import this repository, name `tws-updates`) with the deploy command `npx wrangler deploy --config workers/updates/wrangler.json` (and `npx wrangler versions upload --config workers/updates/wrangler.json` for branches that are not the production branch). The dashboard labels may differ slightly.
2. **Check it on its own address** (the `workers.dev` address of `tws-updates` that the deploy prints) and compare it with the live site:
   ```powershell
   curl.exe -i "https://tws-updates.<your-subdomain>.workers.dev/api/pinchpdf/updates/v1/check?v=0.0.1&channel=stable"
   curl.exe -s "https://technowizsolutions.com/api/pinchpdf/updates/v1/check?v=0.0.1&channel=stable"
   ```
   Expect status 200, the header `x-served-by: tws-updates`, and the same JSON body from both.
3. **Add the two routes** (dashboard: the `tws-updates` Worker, Settings, Domains & Routes, Add, Route), zone `technowizsolutions.com`:
   - `technowizsolutions.com/api/pinchpdf/updates/*`
   - `technowizsolutions.com/api/nodupe/updates/*`
4. **Verify on the real address:**
   ```powershell
   curl.exe -I "https://technowizsolutions.com/api/pinchpdf/updates/v1/check?v=0.0.1&channel=stable"
   ```
   The header `x-served-by: tws-updates` must be there. Then open **Admin, Health check**: its two update-check probes run from your browser against the same public addresses and must be green.

If the header is missing after adding the routes, the routes are not taking effect (this depends on how the domain is attached to `tws-website`). Delete them: nothing else was changed.

## Rolling back

Delete the two routes. Traffic returns to `tws-website`, which still answers both addresses with the same code.

## Day to day

- **Settings live in two files.** `RELEASES_REPO` and `RELEASE_PUBLIC_KEY` are in both `wrangler.json` and `workers/updates/wrangler.json`. A test fails if they differ. After changing one (for example adding a release key), deploy **both** Workers: the website on merge as usual, and the updates Worker with `npm run deploy:updates` (or its Workers Builds project). See "Rotate or add a release key" in [RELEASES.md](RELEASES.md).
- **CI** validates the updates Worker with `wrangler deploy --dry-run` and the tests in `test/updates-worker.test.ts` (paths, answers equal to the website's, refusals, configuration parity).
- **Counts:** both Workers add to the same daily counters in the database, and share one rate-limit count per address.

## Later

Once the routes have run without problems for a while, the website's copy of the two endpoints (`app/api/*/updates`) is removed in a separate change, and this page loses the "both" wording. See step 2 of the plan in [ROADMAP.md](ROADMAP.md).
