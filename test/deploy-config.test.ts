// Deploy guards: the things that pass locally and then fail (or quietly misbehave) once deployed.
// Each test below corresponds to a way a deploy has gone wrong or easily could:
//   * code uses a rate limiter / binding that wrangler.json does not declare
//   * two limiters share a namespace id, or a plain variable holds a secret
//   * a settings version points at legal text that does not exist
//   * migrations are renumbered, duplicated, or skip a number
//   * an API route exists that Swagger or the health page does not know about
//   * the schema the code reads is not the schema the migrations create

/// <reference types="vite/client" />

import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import wranglerText from '../wrangler.json?raw';
import { legalVersions } from '../app/pinchpdf/legal/versions';
import { buildProbes } from '../lib/admin/health-targets';
import { BASE_PATH } from '../lib/trial/config';
import { buildOpenApiSpec } from '../lib/trial/openapi';
import { INSIGHTS_API_BASE } from '../lib/telemetry/data';
import { products } from '../app/products/data';

const wrangler = JSON.parse(wranglerText) as {
  vars: Record<string, string>;
  ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
  d1_databases: { binding: string; database_id: string; migrations_dir: string }[];
};

// Every source file of the Worker, as text.
const sources = import.meta.glob(['../lib/**/*.ts', '../app/**/*.ts', '../app/**/*.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const routeFiles = Object.keys(import.meta.glob(['../app/api/pinchpdf/**/route.ts', '../app/api/nodupe/**/route.ts']));

describe('wrangler.json', () => {
  it('declares every rate limiter the code uses (an undeclared one silently disappears in production)', () => {
    const declared = new Set(wrangler.ratelimits.map((r) => r.name));
    const used = new Set<string>();
    for (const [file, text] of Object.entries(sources)) {
      if (file.includes('/test/')) continue;
      for (const match of text.matchAll(/\b([A-Z][A-Z_]*_LIMITER)\b/g)) used.add(match[1]);
    }
    expect(used.size, 'the scan found limiter names').toBeGreaterThan(5);
    expect([...used].filter((name) => !declared.has(name)), 'used in code but not declared in wrangler.json').toEqual([]);
    expect([...declared].filter((name) => !used.has(name)), 'declared but never used').toEqual([]);
  });

  it('gives every limiter its own namespace id, a valid period and a sensible limit', () => {
    const ids = wrangler.ratelimits.map((r) => r.namespace_id);
    expect(new Set(ids).size, 'duplicate namespace_id').toBe(ids.length);
    expect(new Set(wrangler.ratelimits.map((r) => r.name)).size, 'duplicate name').toBe(wrangler.ratelimits.length);
    for (const r of wrangler.ratelimits) {
      expect(r.namespace_id, r.name).toMatch(/^\d+$/);
      expect([10, 60], `${r.name}: the Workers rate-limit binding only supports 10 or 60 second periods`).toContain(r.simple.period);
      expect(r.simple.limit, r.name).toBeGreaterThan(0);
    }
  });

  it('keeps secrets out of plain variables (a deploy would publish or delete them)', () => {
    for (const name of Object.keys(wrangler.vars)) {
      expect(name, `${name} looks like a secret`).not.toMatch(/PEPPER|PII_KEY|CHALLENGE_KEY|TRIAL_KEY_|PASSWORD|SECRET|API_KEY|ADMIN_USER|DOCS_USER/);
    }
  });

  it('points the settings versions at legal text that exists', () => {
    expect(Object.keys(legalVersions.terms), 'TRIAL_TERMS_VERSION').toContain(wrangler.vars.TRIAL_TERMS_VERSION);
    expect(Object.keys(legalVersions.privacy), 'TRIAL_PRIVACY_VERSION').toContain(wrangler.vars.TRIAL_PRIVACY_VERSION);
  });

  it('has well-formed telemetry and trial settings', () => {
    const days = Number(wrangler.vars.INSIGHTS_ABANDON_DAYS);
    expect(Number.isInteger(days) && days >= 1 && days <= 90, 'INSIGHTS_ABANDON_DAYS is a whole number of days from 1 to 90').toBe(true);
    expect(wrangler.vars.ACCEPTED_KIDS).toMatch(/^[A-Za-z0-9]{1,16}(,[A-Za-z0-9]{1,16})*$/);
    expect(Number(wrangler.vars.TRIAL_DIFFICULTY)).toBeGreaterThanOrEqual(16);
    expect(Number(wrangler.vars.TRIAL_LIMIT)).toBeGreaterThanOrEqual(1);
  });

  it('declares the production database once, as TRIAL_DB, with the migrations folder', () => {
    expect(wrangler.d1_databases).toHaveLength(1);
    expect(wrangler.d1_databases[0]).toMatchObject({ binding: 'TRIAL_DB', migrations_dir: 'migrations' });
    expect(wrangler.d1_databases[0].database_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('migrations', () => {
  const migrations = (env as unknown as { TEST_MIGRATIONS: { name: string }[] }).TEST_MIGRATIONS;

  it('are numbered 0001, 0002, ... with no gap, no duplicate and no renumbering', () => {
    const numbers = migrations.map((m) => m.name.match(/^(\d{4})_[a-z0-9_]+\.sql$/)?.[1]);
    expect(numbers.every(Boolean), `file names: ${migrations.map((m) => m.name).join(', ')}`).toBe(true);
    expect(numbers).toEqual(numbers.map((_, i) => String(i + 1).padStart(4, '0')));
    // Published migrations must keep their names: wrangler records applied migrations by name.
    expect(migrations.map((m) => m.name).slice(0, 3)).toEqual(['0001_trials.sql', '0002_admin_metrics.sql', '0003_telemetry.sql']);
  });

  it('applying them again changes nothing (re-running a deploy is safe)', async () => {
    await expect(applyD1Migrations(env.TRIAL_DB, (env as unknown as { TEST_MIGRATIONS: never }).TEST_MIGRATIONS)).resolves.not.toThrow();
  });

  it('create exactly the tables, columns and indexes the code reads', async () => {
    const tables = (await env.TRIAL_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>()).results.map((r) => r.name).sort();
    expect(tables).toEqual(['metrics_daily', 'telemetry_customers', 'telemetry_devices', 'telemetry_events', 'trial_audit', 'trials']);

    const columns = async (table: string) => (await env.TRIAL_DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((r) => r.name);
    expect(await columns('telemetry_events')).toEqual(['seq', 'event_id', 'customer_uuid', 'type', 'plan', 'license_fp', 'prev_license_fp', 'device_id', 'occurred_at', 'received_at', 'app_version', 'os_build']);
    expect(await columns('telemetry_customers')).toEqual(['customer_uuid', 'pubkey', 'trial_id', 'first_seen_at']);
    expect(await columns('telemetry_devices')).toEqual(['device_id', 'h_guid', 'h_smbios', 'h_board', 'first_seen_at']);
    expect(await columns('trials')).toContain('product'); // from 0002, untouched by 0003

    const indexes = (await env.TRIAL_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_telemetry%'").all<{ name: string }>()).results.map((r) => r.name).sort();
    expect(indexes).toEqual(['idx_telemetry_devices_board', 'idx_telemetry_devices_guid', 'idx_telemetry_devices_smbios', 'idx_telemetry_events_customer', 'idx_telemetry_events_license', 'idx_telemetry_events_type_time']);
  });

  it('enforce the guarantees the handler relies on: unique event_id, unique customer_uuid', async () => {
    const insertEvent = () =>
      env.TRIAL_DB.prepare("INSERT INTO telemetry_events (event_id, customer_uuid, type, occurred_at, received_at) VALUES ('e1', 'c1', 'buy_clicked', 1, 1)").run();
    await insertEvent();
    await expect(insertEvent()).rejects.toThrow(/UNIQUE/i);
    const insertCustomer = () => env.TRIAL_DB.prepare("INSERT INTO telemetry_customers (customer_uuid, pubkey, first_seen_at) VALUES ('c1', 'pk', 1)").run();
    await insertCustomer();
    await expect(insertCustomer()).rejects.toThrow(/UNIQUE/i);
  });
});

describe('API routes, Swagger and the health page stay in step', () => {
  const routePath = (file: string) =>
    file
      .replace('../app', '')
      .replace('/route.ts', '')
      .replace(/\[(\w+)\]/g, '{$1}');
  const paths = routeFiles.map(routePath);

  it('finds the routes it is meant to check', () => {
    expect(paths).toContain(`${BASE_PATH}telemetry`.replace(/\/$/, ''));
    expect(paths).toContain(`${INSIGHTS_API_BASE}{tab}`);
  });

  it('documents every API route in Swagger (except the docs themselves), and nothing else', () => {
    const documented = Object.keys(buildOpenApiSpec().paths).sort();
    const code = paths.filter((p) => !p.startsWith('/api/pinchpdf/trial/docs')).sort();
    expect(code, 'both update-check routes exist').toEqual(expect.arrayContaining(['/api/pinchpdf/updates/v1/check', '/api/nodupe/updates/v1/check']));
    expect(documented).toEqual(code);
  });

  it('probes every public trial endpoint on the health page', () => {
    const probes = buildProbes({ products: products.map((p) => ({ name: p.name, path: p.path })) }).map((p) => p.path);
    for (const path of paths.filter((p) => p.startsWith('/api/pinchpdf/trial/v1/'))) expect(probes, path).toContain(path);
    expect(probes).toContain('/api/pinchpdf/insights/v1/buying');
  });

  it('only ever allows POST on the sealed endpoints and GET on Insights (a stray method would be an open door)', () => {
    for (const file of routeFiles) {
      const text = sources[file.replace('../app', '../app')] ?? '';
      const methods = [...text.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
      const path = routePath(file);
      if (path.startsWith('/api/pinchpdf/trial/v1/')) expect(methods, path).toEqual(['POST']);
      if (path.startsWith('/api/pinchpdf/insights/')) expect(methods, path).toEqual(['GET']);
      if (/\/updates\//.test(path)) expect(methods, path).toEqual(['GET']);
    }
  });
});
