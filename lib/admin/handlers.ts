// Request handlers for the /admin pages. They take the environment and the clock as arguments
// so tests can drive them directly; the Next route files only supply the real ones.

import { ADMIN_HEADERS, guardAdmin, type AdminEnv } from './auth';
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
