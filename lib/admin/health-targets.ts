// What the health page probes over HTTP, and what each probe should answer. The probes are sent
// by the browser that has the page open, so they travel the same public path a visitor or the
// PinchPDF app uses (DNS, Cloudflare, WAF, the Worker). Nothing here changes any data:
//
//   * the trial `challenge` endpoint is stateless, so it gets a real POST;
//   * every other API is probed with GET, which the routes answer 405 (they only accept POST).
//     A 405 proves the route is deployed and reachable without touching a rate limiter, the
//     database or the mailer;
//   * admin and docs pages are probed WITHOUT credentials and must answer 401 (or 404 when
//     switched off), which proves the route and its login guard are alive;
//   * pages and site files must answer 200.
//
// The full request path is covered by the server-side checks (health-checks.ts), which exercise
// the trial handlers in-process, including the sealed request and response.

export type ProbeCategoryId = 'trial-api' | 'site-api' | 'protected' | 'pages' | 'files';

export const PROBE_CATEGORIES: { id: ProbeCategoryId; title: string; description: string }[] = [
  { id: 'trial-api', title: 'Trial API', description: 'Public endpoints the PinchPDF app calls.' },
  { id: 'site-api', title: 'Website APIs', description: 'Contact and support forms.' },
  { id: 'protected', title: 'Admin and API docs', description: 'Must ask for a login. A login prompt (401) means the page is up and protected.' },
  { id: 'pages', title: 'Website pages', description: 'Public pages.' },
  { id: 'files', title: 'Site files', description: 'Files that search engines and browsers fetch.' },
];

export type Probe = {
  id: string;
  category: ProbeCategoryId;
  label: string;
  path: string;
  method: 'GET' | 'POST';
  /** 'challenge' sends a throwaway public key to the stateless challenge endpoint. */
  body?: 'challenge';
  /** Statuses that mean healthy. */
  ok: number[];
  /** Statuses that mean reachable but worth a look (shown amber). 429 is always amber. */
  warn?: number[];
  /** Shown next to a warning or failure. */
  note?: string;
};

export type ProbeInputs = {
  products: { name: string; path: string }[];
  legal: { terms: string[]; privacy: string[] };
};

const TRIAL = '/api/pinchpdf/trial';
const POST_ONLY = 'Expected 405: the route only accepts POST. Any other answer means the route is missing or blocked.';

export function buildProbes({ products, legal }: ProbeInputs): Probe[] {
  const probes: Probe[] = [
    { id: 'api-challenge', category: 'trial-api', label: 'Challenge', path: `${TRIAL}/v1/challenge`, method: 'POST', body: 'challenge', ok: [200], note: 'The challenge endpoint should answer 200. A 503 usually means a missing or malformed secret: see the server checks above.' },
    { id: 'api-register', category: 'trial-api', label: 'Register', path: `${TRIAL}/v1/register`, method: 'GET', ok: [405], note: POST_ONLY },
    { id: 'api-usage', category: 'trial-api', label: 'Usage', path: `${TRIAL}/v1/usage`, method: 'GET', ok: [405], note: POST_ONLY },
    { id: 'api-updates-pinchpdf', category: 'trial-api', label: 'PinchPDF update check', path: '/api/pinchpdf/updates/v1/check?v=0.0.1', method: 'GET', ok: [200], warn: [503], note: '503 means update checks are not set up yet (R2 bucket, base URL and release key: see docs/RELEASES.md).' },
    { id: 'api-updates-nodupe', category: 'trial-api', label: 'NoDupe update check', path: '/api/nodupe/updates/v1/check?v=0.0.1', method: 'GET', ok: [200], warn: [503], note: '503 means update checks are not set up yet (R2 bucket, base URL and release key: see docs/RELEASES.md).' },
    { id: 'api-telemetry', category: 'trial-api', label: 'Telemetry (buy clicks and license events)', path: `${TRIAL}/v1/telemetry`, method: 'GET', ok: [405], note: POST_ONLY },

    { id: 'api-contact', category: 'site-api', label: 'Contact form', path: '/api/contact', method: 'GET', ok: [405], note: POST_ONLY },
    { id: 'api-support', category: 'site-api', label: 'Support form', path: '/api/get-support', method: 'GET', ok: [405], note: POST_ONLY },

    { id: 'admin-home', category: 'protected', label: 'Admin home', path: '/admin', method: 'GET', ok: [401], note: 'Expected a login prompt (401). 404 means the admin login is not configured.' },
    { id: 'admin-insights', category: 'protected', label: 'Admin insights', path: '/admin/insights', method: 'GET', ok: [401], note: 'Expected a login prompt (401).' },
    { id: 'admin-insights-api', category: 'protected', label: 'Insights JSON API', path: '/api/pinchpdf/insights/v1/buying', method: 'GET', ok: [401], note: 'Expected a login prompt (401). 404 means the admin login is not configured.' },
    { id: 'admin-health', category: 'protected', label: 'Admin health check', path: '/admin/health', method: 'GET', ok: [401], note: 'Expected a login prompt (401).' },
    { id: 'docs-page', category: 'protected', label: 'API docs (Swagger)', path: `${TRIAL}/docs`, method: 'GET', ok: [401], warn: [404], note: '404 means the docs are switched off: set DOCS_USER and DOCS_PASSWORD.' },
    { id: 'docs-spec', category: 'protected', label: 'API docs spec', path: `${TRIAL}/docs/spec`, method: 'GET', ok: [401], warn: [404], note: '404 means the docs are switched off: set DOCS_USER and DOCS_PASSWORD.' },
    { id: 'docs-health', category: 'protected', label: 'API docs configuration check', path: `${TRIAL}/docs/health`, method: 'GET', ok: [401], warn: [404], note: '404 means the docs are switched off: set DOCS_USER and DOCS_PASSWORD.' },

    { id: 'page-home', category: 'pages', label: 'Home', path: '/', method: 'GET', ok: [200] },
    { id: 'page-about', category: 'pages', label: 'About', path: '/about', method: 'GET', ok: [200] },
    { id: 'page-support', category: 'pages', label: 'Get support', path: '/get-support', method: 'GET', ok: [200] },
    ...products.map((product) => ({
      id: `page-product-${product.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`,
      category: 'pages' as const,
      label: `${product.name} product page`,
      path: product.path,
      method: 'GET' as const,
      ok: [200],
    })),
    { id: 'page-terms', category: 'pages', label: 'Terms of Service', path: '/terms', method: 'GET', ok: [200] },
    { id: 'page-legal-index', category: 'pages', label: 'Legal documents index', path: '/legal', method: 'GET', ok: [200] },
    { id: 'page-privacy', category: 'pages', label: 'Privacy Policy', path: '/privacy', method: 'GET', ok: [200] },
    { id: 'page-trial-terms-latest', category: 'pages' as const, label: 'PinchPDF trial terms (app link, redirects)', path: '/pinchpdf/legal/trial-terms', method: 'GET' as const, ok: [200] },
    { id: 'page-trial-privacy-latest', category: 'pages' as const, label: 'PinchPDF trial privacy notice (app link, redirects)', path: '/pinchpdf/legal/privacy', method: 'GET' as const, ok: [200] },
    ...legal.terms.map((version) => ({ id: `page-trial-terms-${version}`, category: 'pages' as const, label: `PinchPDF trial terms (${version}, redirects to latest)`, path: `/pinchpdf/legal/trial-terms/${version}`, method: 'GET' as const, ok: [200] })),
    ...legal.privacy.map((version) => ({ id: `page-trial-privacy-${version}`, category: 'pages' as const, label: `PinchPDF trial privacy notice (${version}, redirects to latest)`, path: `/pinchpdf/legal/privacy/${version}`, method: 'GET' as const, ok: [200] })),

    { id: 'file-robots', category: 'files', label: 'robots.txt', path: '/robots.txt', method: 'GET', ok: [200] },
    { id: 'file-sitemap', category: 'files', label: 'sitemap.xml', path: '/sitemap.xml', method: 'GET', ok: [200] },
    { id: 'file-manifest', category: 'files', label: 'Web app manifest', path: '/manifest.webmanifest', method: 'GET', ok: [200] },
  ];
  return probes;
}

/** Result for a probe that answered with `status` (0 means no answer at all). */
export function classifyProbe(probe: Pick<Probe, 'ok' | 'warn'>, status: number): 'ok' | 'warn' | 'fail' {
  if (probe.ok.includes(status)) return 'ok';
  if (status === 429 || probe.warn?.includes(status)) return 'warn';
  return 'fail';
}
