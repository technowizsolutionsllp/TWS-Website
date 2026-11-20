// The Swagger docs and OpenAPI spec are served only behind a user ID and password.

import { describe, expect, it } from 'vitest';
import { handleDocsPage, handleDocsSpec, type DocsEnv } from '../lib/trial/docs';
import { buildOpenApiSpec } from '../lib/trial/openapi';
import { BASE_PATH } from '../lib/trial/config';

const env: DocsEnv = { DOCS_USER: 'docs-user', DOCS_PASSWORD: 'p:ass word/with:colons' };
const basic = (user: string, password: string) => `Basic ${btoa(`${user}:${password}`)}`;
const get = (authorization?: string) =>
  new Request('https://technowizsolutions.com/api/pinchpdf/trial/docs', {
    headers: authorization ? { authorization } : {},
  });

describe('docs authentication', () => {
  it('asks for credentials when none are sent', async () => {
    for (const handler of [handleDocsPage, handleDocsSpec]) {
      const response = await handler(get(), env);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(/^Basic realm=/);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).not.toContain('swagger');
    }
  });

  it('refuses a wrong user, a wrong password and malformed headers', async () => {
    const attempts = [
      basic('someone', env.DOCS_PASSWORD!),
      basic(env.DOCS_USER!, 'wrong'),
      basic(env.DOCS_USER!, ''),
      basic('', ''),
      `Basic ${btoa('no-colon-here')}`,
      'Basic !!!not-base64!!!',
      'Bearer token',
      `Basic ${btoa(env.DOCS_USER!)}`,
    ];
    for (const header of attempts) {
      expect((await handleDocsPage(get(header), env)).status, header).toBe(401);
      expect((await handleDocsSpec(get(header), env)).status, header).toBe(401);
    }
  });

  it('accepts the right credentials, including a password that contains colons', async () => {
    const page = await handleDocsPage(get(basic(env.DOCS_USER!, env.DOCS_PASSWORD!)), env);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    const html = await page.text();
    expect(html).toContain('swagger-ui-dist@5.17.14');
    expect(html).toMatch(/integrity="sha384-/);
    expect(html).toContain('supportedSubmitMethods: []');
    expect(html).toContain("url: '/api/pinchpdf/trial/docs/spec'");
  });

  it('fails closed: with no credentials configured the routes answer 404', async () => {
    for (const partial of [{}, { DOCS_USER: 'a' }, { DOCS_PASSWORD: 'b' }, { DOCS_USER: '', DOCS_PASSWORD: '' }]) {
      const response = await handleDocsPage(get(basic('a', 'b')), partial);
      expect(response.status).toBe(404);
    }
  });

  it('throttles per IP, before looking at credentials', async () => {
    const limiter = { limit: async () => ({ success: false }) };
    const response = await handleDocsPage(get(basic(env.DOCS_USER!, env.DOCS_PASSWORD!)), { ...env, TRIAL_DOCS_LIMITER: limiter });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('does not lock the owner out when the limiter itself fails', async () => {
    const broken = { limit: async () => { throw new Error('limiter down'); } };
    const response = await handleDocsSpec(get(basic(env.DOCS_USER!, env.DOCS_PASSWORD!)), { ...env, TRIAL_DOCS_LIMITER: broken });
    expect(response.status).toBe(200);
  });
});

describe('OpenAPI spec', () => {
  it('is served as JSON to an authorised caller', async () => {
    const response = await handleDocsSpec(get(basic(env.DOCS_USER!, env.DOCS_PASSWORD!)), env);
    expect(response.status).toBe(200);
    const spec = (await response.json()) as ReturnType<typeof buildOpenApiSpec>;
    expect(spec.openapi).toBe('3.1.0');
  });

  it('describes exactly the three endpoints the service implements', () => {
    const spec = buildOpenApiSpec();
    expect(Object.keys(spec.paths).sort()).toEqual([`${BASE_PATH}challenge`, `${BASE_PATH}register`, `${BASE_PATH}usage`]);
    for (const path of Object.values(spec.paths)) expect(Object.keys(path)).toEqual(['post']);
  });

  it('has no dangling $ref', () => {
    const spec = buildOpenApiSpec();
    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === '$ref' && typeof value === 'string') refs.push(value);
          else walk(value);
        }
      }
    };
    walk(spec);
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      const target = ref.replace(/^#\//, '').split('/').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], spec);
      expect(target, ref).toBeDefined();
    }
  });

  it('documents every result the register and usage handlers can return', () => {
    const { schemas } = buildOpenApiSpec().components;
    const titles = (schema: { oneOf: { title: string }[] }) => schema.oneOf.map((variant) => variant.title).sort();
    expect(titles(schemas.RegisterResult as never)).toEqual(
      ['already_used', 'challenge_expired', 'invalid', 'registered', 'terms_outdated', 'unsupported_device'],
    );
    expect(titles(schemas.UsageResult as never)).toEqual(['ok', 'unknown_trial']);
    expect(schemas.TrialState.enum).toEqual(['active', 'exhausted', 'revoked']);
  });
});
