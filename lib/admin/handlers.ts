// Request handlers for the /admin pages. They take the environment and the clock as arguments
// so tests can drive them directly; the Next route files only supply the real ones.

import { products } from '../../app/products/data';
import { legalVersions } from '../../app/pinchpdf/legal/versions';
import { b64urlEncode, randomBytes } from '../trial/bytes';
import { ADMIN_HEADERS, guardAdmin, type AdminEnv } from './auth';
import { runServerChecks, type HealthEnv } from './health-checks';
import { healthCsp, renderHealth } from './health-page';
import { buildProbes } from './health-targets';
import { loadInsights } from './insights';
import { ADMIN_CSP, renderHome, renderInsights } from './pages';
import { parseQuery } from './range';

export type AdminRuntimeEnv = AdminEnv & { TRIAL_DB?: D1Database };

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

  const { product, range, error } = parseQuery(new URL(request.url).searchParams, nowMs);
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
  const probes = buildProbes({
    products,
    legal: { terms: Object.keys(legalVersions.terms), privacy: Object.keys(legalVersions.privacy) },
  });
  return new Response(renderHealth({ checks, probes, generatedAt }, nonce), {
    status: 200,
    headers: { ...ADMIN_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': healthCsp(nonce) },
  });
}
