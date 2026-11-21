// GET /api/pinchpdf/insights/v1/{buying|licenses|devices}: the telemetry numbers behind the matching
// /admin/insights tab, as JSON. Same login as the admin pages (ADMIN_USER / ADMIN_PASSWORD), same date
// range and window parameters. Counts only: no identifiers of people, licenses or machines.

import { INSIGHTS_API_BASE, DEFAULT_WINDOW_DAYS, TELEMETRY_TABS, parseWindow, tabData, type TelemetryTab } from '../telemetry/data';
import { loadEvents } from '../telemetry/db';
import { plain } from '../trial/responses';
import { ADMIN_HEADERS, guardAdmin } from './auth';
import type { AdminRuntimeEnv } from './handlers';
import { parseQuery } from './range';

export { INSIGHTS_API_BASE };

export async function handleInsightsApi(request: Request, env: AdminRuntimeEnv, nowMs: number = Date.now()): Promise<Response> {
  const blocked = await guardAdmin(request, env);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const tab = url.pathname.replace(/\/+$/, '').split('/').pop() as TelemetryTab;
  if (!(TELEMETRY_TABS as readonly string[]).includes(tab)) return plain(404, { error: 'not_found' }, ADMIN_HEADERS);
  if (!env.TRIAL_DB) return plain(503, { error: 'unavailable' }, { ...ADMIN_HEADERS, 'Retry-After': '30' });

  const { range, error } = parseQuery(url.searchParams, nowMs);
  if (error) return plain(400, { error: 'bad_range', message: error }, ADMIN_HEADERS);
  const windowDays = parseWindow(url.searchParams.get('window'), parseWindow(env.INSIGHTS_ABANDON_DAYS, DEFAULT_WINDOW_DAYS));

  try {
    const events = await loadEvents(env.TRIAL_DB);
    return plain(200, { tab, generated_at: Math.floor(nowMs / 1000), ...tabData(tab, events, range, windowDays, Math.floor(nowMs / 1000)) }, ADMIN_HEADERS);
  } catch (cause) {
    console.error(JSON.stringify({ svc: 'admin', endpoint: 'insights_api', result: 'db_error', message: String((cause as Error)?.message).slice(0, 120) }));
    return plain(503, { error: 'unavailable' }, { ...ADMIN_HEADERS, 'Retry-After': '30' });
  }
}
