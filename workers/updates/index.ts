// The app update check as a Worker of its own (tws-updates).
//
// The endpoints and their answers are exactly the website's (app/api/<product>/updates/v1/check): the same handler,
// the same code, the same addresses. Cloudflare routes those two paths here instead of to the website Worker, so a
// website deploy or fault can no longer take the update check down (and the other way round). The website Worker keeps its
// own copy of the endpoints as a fallback until the routes have proved themselves; removing a route sends the traffic back.
// Background and the staged move: docs/ROADMAP.md and docs/ARCHITECTURE.md.
//
// This Worker holds no secrets and no personal data: bindings are the public settings (RELEASES_REPO,
// RELEASE_PUBLIC_KEY), the per-address rate limiter and the database that receives the daily counts.

import { handleUpdateCheck } from '../../lib/updates/handler';
import type { Product } from '../../lib/updates/releases';
import type { UpdatesEnv } from '../../lib/updates/store';

/** The only addresses this Worker answers. They must stay exactly as the apps know them. */
export const UPDATE_PATHS: Readonly<Record<string, Product>> = {
  '/api/pinchpdf/updates/v1/check': 'PinchPDF',
  '/api/nodupe/updates/v1/check': 'NoDupe',
};

/** Which Worker answered. Added so the cutover can be checked from outside (curl -I); the answer itself is the website's. */
export const SERVED_BY = 'tws-updates';

const mark = (response: Response, body: BodyInit | null = response.body): Response => {
  const marked = new Response(body, response);
  marked.headers.set('x-served-by', SERVED_BY);
  return marked;
};

const text = (status: number, body: string, headers: Record<string, string> = {}) =>
  mark(new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers } }));

export default {
  async fetch(request: Request, env: UpdatesEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    const product = UPDATE_PATHS[pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname];
    if (!product) return text(404, 'Not found');
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed', { allow: 'GET, HEAD' });
    const response = await handleUpdateCheck(request, env, product);
    // HEAD answers like GET without the body (what the website's route does too).
    return mark(response, request.method === 'HEAD' ? null : response.body);
  },
} satisfies ExportedHandler<UpdatesEnv>;
