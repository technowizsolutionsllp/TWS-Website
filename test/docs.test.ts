// The Swagger docs and OpenAPI spec are served only behind a user ID and password.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_DOCS_PASSWORD_LENGTH, handleDocsPage, handleDocsSpec, resetDocsFallbackLimiter, type DocsEnv } from '../lib/trial/docs';
import { buildOpenApiSpec } from '../lib/trial/openapi';
import { BASE_PATH, configStatus } from '../lib/trial/config';

const env: DocsEnv = { DOCS_USER: 'docs-user', DOCS_PASSWORD: 'p:ass word/with:colons' };
const basic = (user: string, password: string) => `Basic ${btoa(`${user}:${password}`)}`;
const get = (authorization?: string) =>
  new Request('https://technowizsolutions.com/api/pinchpdf/trial/docs', {
    headers: authorization ? { authorization } : {},
  });

beforeEach(() => resetDocsFallbackLimiter());

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

  it('stays off while the password is short (fail closed)', async () => {
    const weak = { DOCS_USER: 'docs-user', DOCS_PASSWORD: 'x'.repeat(MIN_DOCS_PASSWORD_LENGTH - 1) };
    expect((await handleDocsPage(get(basic(weak.DOCS_USER, weak.DOCS_PASSWORD)), weak)).status).toBe(404);
    const longEnough = { ...weak, DOCS_PASSWORD: 'x'.repeat(MIN_DOCS_PASSWORD_LENGTH) };
    expect((await handleDocsPage(get(basic(longEnough.DOCS_USER, longEnough.DOCS_PASSWORD)), longEnough)).status).toBe(200);
  });

  it('sends a CSP whose nonce matches the one inline script, and allows nothing else', async () => {
    const page = await handleDocsPage(get(basic(env.DOCS_USER!, env.DOCS_PASSWORD!)), env);
    const csp = page.headers.get('content-security-policy')!;
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)![1];
    const html = await page.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain('unsafe-eval');
    // a fresh nonce for every response
    const second = await handleDocsPage(get(basic(env.DOCS_USER!, env.DOCS_PASSWORD!)), env);
    expect(second.headers.get('content-security-policy')).not.toBe(csp);
  });

  it('still throttles guessing when the rate-limit binding is missing (in-memory fallback, per IP)', async () => {
    const guess = (ip: string) => handleDocsPage(new Request('https://x/docs', { headers: { 'cf-connecting-ip': ip, authorization: basic('docs-user', 'wrong') } }), env);
    for (let i = 0; i < 20; i += 1) expect((await guess('203.0.113.7')).status).toBe(401);
    expect((await guess('203.0.113.7')).status).toBe(429);
    expect((await guess('203.0.113.8')).status).toBe(401); // another IP is unaffected
  });

  it('ignores a spoofed X-Forwarded-For when choosing the limiter key', async () => {
    const keys: string[] = [];
    const spy = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true }; } };
    const withSpy = { ...env, TRIAL_DOCS_LIMITER: spy };
    await handleDocsPage(new Request('https://x', { headers: { 'x-forwarded-for': '6.6.6.6' } }), withSpy);
    await handleDocsPage(new Request('https://x', { headers: { 'x-forwarded-for': '6.6.6.6', 'cf-connecting-ip': '198.51.100.4' } }), withSpy);
    expect(keys).toEqual(['unknown', '198.51.100.4']);
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

describe('diagnostics', () => {
  it('logs which docs settings are missing, by name only, once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const secret = 'super-secret-password-value-123';
    await handleDocsPage(get(), { DOCS_PASSWORD: secret });
    await handleDocsPage(get(), { DOCS_PASSWORD: secret });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ result: 'disabled', DOCS_USER: false, DOCS_PASSWORD: true, password_long_enough: true });
    expect(line).not.toContain(secret);
    warn.mockRestore();
  });

  it('reports which trial secrets are present or missing without exposing values', () => {
    const status = configStatus({ PEPPER: 'a-pepper-value', PII_KEY: 'k', ACCEPTED_KIDS: 'k1', TRIAL_TERMS_VERSION: 'v', TRIAL_PRIVACY_VERSION: 'v' } as never);
    expect(status.present).toEqual(['PEPPER', 'PII_KEY', 'ACCEPTED_KIDS', 'TRIAL_TERMS_VERSION', 'TRIAL_PRIVACY_VERSION']);
    expect(status.missing).toEqual(['PEPPER_EMAIL', 'CHALLENGE_KEY', 'TRIAL_KEY_k1']);
    expect(JSON.stringify(status)).not.toContain('a-pepper-value');
  });
});
