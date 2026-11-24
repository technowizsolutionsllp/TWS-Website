// The update check as a Worker of its own (workers/updates): the addresses never change, the answer is exactly the website's,
// everything else is refused, and the two Cloudflare configurations cannot drift apart.

/// <reference types="vite/client" />

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import vectors from './release-vectors.json';
import wranglerText from '../wrangler.json?raw';
import updatesWranglerText from '../workers/updates/wrangler.json?raw';
import worker, { SERVED_BY, UPDATE_PATHS } from '../workers/updates/index';
import { buildProbes } from '../lib/admin/health-targets';
import { DEFAULT_REPOS } from '../scripts/release-publish-lib.mjs';
import { handleUpdateCheck, resetUpdatesLog } from '../lib/updates/handler';
import { resetReleaseCache, type UpdatesEnv } from '../lib/updates/store';
import { products } from '../app/products/data';

const REPOS = { PinchPDF: 'technowizsolutionsllp/app-releases_PinchPDF', NoDupe: 'technowizsolutionsllp/app-releases_NoDupe' };
const ip = { 'cf-connecting-ip': '203.0.113.9' };
const config = (over: Partial<UpdatesEnv> = {}): UpdatesEnv => ({ PINCHPDF_RELEASES_REPO: REPOS.PinchPDF, NODUPE_RELEASES_REPO: REPOS.NoDupe, RELEASE_PUBLIC_KEY: vectors.public_key, TRIAL_DB: env.TRIAL_DB, ...over });
const ask = (path: string, init: RequestInit = {}, over: Partial<UpdatesEnv> = {}) =>
  worker.fetch(new Request(`https://technowizsolutions.com${path}`, { headers: ip, ...init }), config(over));

beforeEach(() => {
  resetReleaseCache();
  resetUpdatesLog();
  // GitHub is replaced by the signed lists of the shared test vectors (no network in tests).
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    const m = /\/(PinchPDF|NoDupe)\/index\.json$/.exec(url);
    if (!m || !url.startsWith(`https://raw.githubusercontent.com/${REPOS[m[1] as keyof typeof REPOS]}/main/`)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify((vectors.indexes as Record<string, unknown>)[m[1]]), { status: 200 });
  });
});

const wrangler = JSON.parse(wranglerText) as {
  name: string;
  account_id: string;
  compatibility_date: string;
  vars: Record<string, string>;
  ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
  d1_databases: { binding: string; database_name: string; database_id: string; migrations_dir?: string }[];
};
const updates = JSON.parse(updatesWranglerText) as typeof wrangler & { main: string; routes?: unknown[]; secrets?: unknown };

const routeFiles = Object.keys(import.meta.glob(['../app/api/pinchpdf/updates/**/route.ts', '../app/api/nodupe/updates/**/route.ts']));

describe('one releases repository per product', () => {
  it('reads each product list from that product own repository and never from the other one', async () => {
    const asked: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      asked.push(url);
      const m = /\/(PinchPDF|NoDupe)\/index\.json$/.exec(url);
      return m && url.startsWith(`https://raw.githubusercontent.com/${REPOS[m[1] as keyof typeof REPOS]}/main/`)
        ? new Response(JSON.stringify((vectors.indexes as Record<string, unknown>)[m[1]]), { status: 200 })
        : new Response('not found', { status: 404 });
    });
    for (const path of Object.keys(UPDATE_PATHS)) await worker.fetch(new Request(`https://technowizsolutions.com${path}?v=0.0.1`), config());
    expect(asked.sort()).toEqual([
      'https://raw.githubusercontent.com/technowizsolutionsllp/app-releases_NoDupe/main/NoDupe/index.json',
      'https://raw.githubusercontent.com/technowizsolutionsllp/app-releases_PinchPDF/main/PinchPDF/index.json',
    ]);
  });

  it('is the same pair of repositories the release scripts publish to by default', () => {
    expect(DEFAULT_REPOS).toEqual({ PinchPDF: wrangler.vars.PINCHPDF_RELEASES_REPO, NoDupe: wrangler.vars.NODUPE_RELEASES_REPO });
  });
});

describe('the addresses never change', () => {
  it('serves exactly the paths the website serves, the apps use and the Health check probes', () => {
    const fromRoutes = routeFiles.map((f) => f.replace('../app', '').replace('/route.ts', '')).sort();
    expect(Object.keys(UPDATE_PATHS).sort()).toEqual(fromRoutes);
    expect(Object.keys(UPDATE_PATHS).sort()).toEqual(['/api/nodupe/updates/v1/check', '/api/pinchpdf/updates/v1/check']);
    const probed = buildProbes({ products })
      .filter((p) => p.path.includes('/updates/'))
      .map((p) => p.path.split('?')[0])
      .sort();
    expect(probed).toEqual(Object.keys(UPDATE_PATHS).sort());
  });

  it('answers exactly what the website answers, for both products', async () => {
    for (const [path, product] of Object.entries(UPDATE_PATHS)) {
      resetReleaseCache();
      const mine = await ask(`${path}?v=0.0.1&channel=stable&os=win11&arch=x64`);
      resetReleaseCache();
      const site = await handleUpdateCheck(new Request(`https://technowizsolutions.com${path}?v=0.0.1&channel=stable&os=win11&arch=x64`, { headers: ip }), config(), product);
      expect(mine.status, path).toBe(200);
      expect(await mine.json(), path).toEqual(await site.json());
      expect(mine.headers.get('cache-control'), path).toBe(site.headers.get('cache-control'));
      expect(mine.headers.get('content-type'), path).toBe(site.headers.get('content-type'));
    }
    // The only visible difference: a header that says which Worker answered, so a cutover can be checked from outside.
    expect((await ask('/api/pinchpdf/updates/v1/check?v=0.0.1')).headers.get('x-served-by')).toBe(SERVED_BY);
    expect((await ask('/api/pinchpdf/updates/v1/check?v=banana')).headers.get('x-served-by')).toBe(SERVED_BY);
    expect((await ask('/nope')).headers.get('x-served-by')).toBe(SERVED_BY);
    const pinch = (await (await ask('/api/pinchpdf/updates/v1/check?v=0.0.1')).json()) as { product?: string };
    const nodupe = (await (await ask('/api/nodupe/updates/v1/check?v=0.0.1')).json()) as { product?: string };
    expect([pinch.product, nodupe.product]).toEqual(['PinchPDF', 'NoDupe']);
  });

  it('keeps the website\'s refusals: a bad request is 400, and missing settings are 503', async () => {
    expect((await ask('/api/pinchpdf/updates/v1/check?v=banana')).status).toBe(400);
    expect((await ask('/api/pinchpdf/updates/v1/check?v=0.0.1', {}, { PINCHPDF_RELEASES_REPO: undefined })).status).toBe(503);
  });
});

describe('everything else is refused', () => {
  it('answers 404 for any other path (the Worker is never a general entry point)', async () => {
    for (const path of ['/', '/api/pinchpdf/trial/v1/challenge', '/api/pinchpdf/updates/v1/check/extra', '/api/pinchpdf/updates/v2/check', '/api/other/updates/v1/check', '/admin/health', '/privacy']) {
      expect((await ask(path)).status, path).toBe(404);
    }
  });

  it('allows GET and HEAD only', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await ask('/api/pinchpdf/updates/v1/check?v=0.0.1', { method, body: method === 'DELETE' ? undefined : '{}' });
      expect(r.status, method).toBe(405);
      expect(r.headers.get('allow'), method).toBe('GET, HEAD');
    }
    const get = await ask('/api/pinchpdf/updates/v1/check?v=0.0.1');
    const head = await ask('/api/pinchpdf/updates/v1/check?v=0.0.1', { method: 'HEAD' });
    expect(head.status).toBe(get.status);
    expect(await head.text()).toBe('');
    expect(head.headers.get('cache-control')).toBe(get.headers.get('cache-control'));
  });

  it('accepts a trailing slash, as the website does', async () => {
    expect((await ask('/api/nodupe/updates/v1/check/?v=0.0.1')).status).toBe(200);
  });
});

describe('the two Cloudflare configurations stay in step', () => {
  it('is a Worker of its own in the same account and database, with the same public settings', () => {
    expect(updates.name).toBe('tws-updates');
    expect(updates.name).not.toBe(wrangler.name);
    expect(updates.account_id).toBe(wrangler.account_id);
    expect(updates.compatibility_date).toBe(wrangler.compatibility_date);
    // The public settings must be identical: the two Workers must never offer different releases.
    expect(updates.vars).toEqual({
      PINCHPDF_RELEASES_REPO: wrangler.vars.PINCHPDF_RELEASES_REPO,
      NODUPE_RELEASES_REPO: wrangler.vars.NODUPE_RELEASES_REPO,
      RELEASE_PUBLIC_KEY: wrangler.vars.RELEASE_PUBLIC_KEY,
    });
    // One repository per product: a product's archive and releases page never hold the other's files.
    expect(wrangler.vars.PINCHPDF_RELEASES_REPO).not.toBe(wrangler.vars.NODUPE_RELEASES_REPO);
    expect(wrangler.vars.PINCHPDF_RELEASES_REPO).toBe('technowizsolutionsllp/app-releases_PinchPDF');
    expect(wrangler.vars.NODUPE_RELEASES_REPO).toBe('technowizsolutionsllp/app-releases_NoDupe');
  });

  it('writes the daily counts to the same database, and does not manage its migrations', () => {
    expect(updates.d1_databases).toEqual([{ binding: 'TRIAL_DB', database_name: wrangler.d1_databases[0].database_name, database_id: wrangler.d1_databases[0].database_id }]);
  });

  it('uses the same address limiter (shared count) and declares nothing else', () => {
    const main = wrangler.ratelimits.find((r) => r.name === 'UPDATES_IP_LIMITER');
    expect(main).toBeDefined();
    expect(updates.ratelimits).toEqual([main]);
  });

  it('holds no secret, and any route it carries is one of the two update paths', () => {
    expect(updates.secrets).toBeUndefined();
    for (const name of Object.keys(updates.vars)) expect(name).not.toMatch(/KEY_SEED|PEPPER|PII_KEY|CHALLENGE_KEY|TRIAL_KEY_|PASSWORD|SECRET|API_KEY/);
    for (const route of updates.routes ?? []) {
      const pattern = typeof route === 'string' ? route : (route as { pattern: string }).pattern;
      expect(Object.keys(UPDATE_PATHS).some((p) => pattern === `technowizsolutions.com${p}` || pattern === `technowizsolutions.com${p}*`)).toBe(true);
    }
  });
});
