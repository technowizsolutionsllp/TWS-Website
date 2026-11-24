// GET /api/<product>/insights/v1/{buying|licenses|devices|installs|scans}: the numbers behind the matching
// /admin/insights tab, as JSON, for one product (PinchPDF: /api/pinchpdf/insights/v1, NoDupe: /api/nodupe/insights/v1).
// `scans` is NoDupe only. Same login as the admin pages (ADMIN_USER / ADMIN_PASSWORD), same date range and window
// parameters. Counts only: no identifiers of people, licenses or machines.

import { INSIGHTS_API_BASE, DEFAULT_WINDOW_DAYS, TELEMETRY_TABS, installsData, parseWindow, scansData, tabData, type TelemetryTab } from '../telemetry/data';
import { loadScanStats } from '../telemetry/scans';
import { PINCHPDF, type ProductSpec } from '../trial/product';
import { plain } from '../trial/responses';
import { ADMIN_HEADERS, guardAdmin } from './auth';
import type { AdminRuntimeEnv } from './handlers';
import { parseQuery } from './range';
import { loadEventsFor, loadInstallRowsFor, sourcesFor } from './sources';

export { INSIGHTS_API_BASE };

export async function handleInsightsApi(request: Request, env: AdminRuntimeEnv, nowMs: number = Date.now(), product: ProductSpec = PINCHPDF): Promise<Response> {
  const blocked = await guardAdmin(request, env);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const tab = url.pathname.replace(/\/+$/, '').split('/').pop() as TelemetryTab;
  if (!(TELEMETRY_TABS as readonly string[]).includes(tab) || (tab === 'scans' && product === PINCHPDF)) return plain(404, { error: 'not_found' }, ADMIN_HEADERS);
  const sources = sourcesFor(env, product.id);
  if (sources.length === 0) return plain(503, { error: 'unavailable' }, { ...ADMIN_HEADERS, 'Retry-After': '30' });

  const { range, error } = parseQuery(url.searchParams, nowMs);
  if (error) return plain(400, { error: 'bad_range', message: error }, ADMIN_HEADERS);
  const windowDays = parseWindow(url.searchParams.get('window'), parseWindow(env.INSIGHTS_ABANDON_DAYS, DEFAULT_WINDOW_DAYS));

  try {
    const nowSeconds = Math.floor(nowMs / 1000);
    const head = { product: product.id, tab, generated_at: nowSeconds };
    if (tab === 'scans') return plain(200, { ...head, ...scansData(await loadScanStats(sources[0].db, range), range) }, ADMIN_HEADERS);
    if (tab === 'installs') return plain(200, { ...head, ...installsData(await loadInstallRowsFor(env, product.id), range) }, ADMIN_HEADERS);
    return plain(200, { ...head, ...tabData(tab, await loadEventsFor(env, product.id), range, windowDays, nowSeconds) }, ADMIN_HEADERS);
  } catch (cause) {
    console.error(JSON.stringify({ svc: 'admin', endpoint: 'insights_api', result: 'db_error', message: String((cause as Error)?.message).slice(0, 120) }));
    return plain(503, { error: 'unavailable' }, { ...ADMIN_HEADERS, 'Retry-After': '30' });
  }
}
