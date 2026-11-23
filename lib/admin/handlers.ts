// Request handlers for the /admin pages. They take the environment and the clock as arguments
// so tests can drive them directly; the Next route files only supply the real ones.

import { products } from '../../app/products/data';
import { b64urlEncode, randomBytes } from '../trial/bytes';
import { ADMIN_HEADERS, guardAdmin, type AdminEnv } from './auth';
import { runServerChecks, type HealthEnv } from './health-checks';
import { healthCsp, renderHealth } from './health-page';
import { buildProbes } from './health-targets';
import { loadEvents, type EventRow } from '../telemetry/db';
import { loadScanReports, type ScanReportRow } from '../telemetry/nodupe';
import { DEFAULT_WINDOW_DAYS, parseWindow, type TelemetryTab } from '../telemetry/data';
import { loadInsights } from './insights';
import { ADMIN_CSP, renderHome, renderInsights } from './pages';
import { parseQuery } from './range';
import { renderTelemetryTab } from './telemetry-pages';
import { isInsightTab } from './tabs';

export type AdminRuntimeEnv = AdminEnv & { TRIAL_DB?: D1Database; NODUPE_DB?: D1Database; INSIGHTS_ABANDON_DAYS?: string };

function page(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { ...ADMIN_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': ADMIN_CSP },
  });
}

export async function handleAdminHome(request: Request, env: AdminRuntimeEnv): Promise<Response> {
  const blocked = await guardAdmin(request, env);
  if (blocked) return blocked;
  return page(renderHome());
}

export async function handleAdminInsights(request: Request, env: AdminRuntimeEnv, nowMs: number = Date.now()): Promise<Response> {
  const blocked = await guardAdmin(request, env);
  if (blocked) return blocked;
  if (!env.TRIAL_DB) return page('<!doctype html><title>Unavailable</title><p>The trial database is not configured here.</p>', 503);

  const params = new URL(request.url).searchParams;
  const { product, range, error } = parseQuery(params, nowMs);
  const rawTab = params.get('tab');
  if (isInsightTab(rawTab) && rawTab !== 'trials') {
    // App telemetry tabs. They open even before migration 0003 is applied, with a notice.
    const windowDays = parseWindow(params.get('window'), parseWindow(env.INSIGHTS_ABANDON_DAYS, DEFAULT_WINDOW_DAYS));
    let events: EventRow[] = [];
    let scanReports: ScanReportRow[] = [];
    let available = true;
    try {
      if (rawTab === 'scans') {
        // NoDupe scan reports live in their own database, so that tab does not read the PinchPDF events.
        if (env.NODUPE_DB) scanReports = await loadScanReports(env.NODUPE_DB);
        else available = false;
      } else {
        events = await loadEvents(env.TRIAL_DB);
      }
    } catch {
      available = false;
    }
    return page(renderTelemetryTab({ tab: rawTab as TelemetryTab, product, range, windowDays, error, available }, events, nowMs, scanReports));
  }
  try {
    return page(renderInsights(await loadInsights(env.TRIAL_DB, range, product, nowMs), nowMs, error));
  } catch (cause) {
    console.error(JSON.stringify({ svc: 'admin', result: 'insights_failed', message: String((cause as Error)?.message).slice(0, 120) }));
    return page('<!doctype html><title>Unavailable</title><p>Insights could not be loaded. Check that the database migrations are applied.</p>', 503);
  }
}

/**
 * The health page, and the same server checks as JSON (?format=json) so the page can refresh them
 * without reloading. Checks answer with names, statuses and short reasons, never secret values.
 */
export async function handleAdminHealth(request: Request, env: HealthEnv, nowMs: number = Date.now()): Promise<Response> {
  const blocked = await guardAdmin(request, env);
  if (blocked) return blocked;

  const generatedAt = new Date(nowMs).toISOString();
  let checks;
  try {
    checks = await runServerChecks(env);
  } catch (cause) {
    console.error(JSON.stringify({ svc: 'admin', result: 'health_failed', message: String((cause as Error)?.message).slice(0, 120) }));
    return new Response('<!doctype html><title>Unavailable</title><p>The health checks could not run.</p>', {
      status: 503,
      headers: { ...ADMIN_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': healthCsp('none') },
    });
  }

  if (new URL(request.url).searchParams.get('format') === 'json') {
    return new Response(JSON.stringify({ generatedAt, checks }), { status: 200, headers: { ...ADMIN_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const nonce = b64urlEncode(randomBytes(16));
  const probes = buildProbes({ products });
  return new Response(renderHealth({ checks, probes, generatedAt }, nonce), {
    status: 200,
    headers: { ...ADMIN_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': healthCsp(nonce) },
  });
}
