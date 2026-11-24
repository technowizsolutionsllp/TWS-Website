// Server-side checks for the admin health page. They run on every page load and every refresh,
// inside the Worker, so they can see what a browser cannot: the database, the secrets and
// bindings, and the trial API's own handlers. Output is names, statuses and short reasons only;
// never a secret value.

import { acceptedKids, configStatus, type TrialEnv } from '../trial/config';
import type { AdminEnv } from './auth';
import { retentionStatus } from '../telemetry/retention';
import { readTrialRetention, trialRetentionStatus } from '../trial/retention';
import { PRODUCTS } from '../updates/releases';
import { loadReleases, updatesConfig, type UpdatesEnv } from '../updates/store';
import { NODUPE, PINCHPDF, productDb, type ProductSpec } from '../trial/product';
import { runTrialSelfTest, serverPublicKey } from './selftest';

export type CheckStatus = 'ok' | 'warn' | 'fail';
export type CheckCategoryId = 'platform' | 'trial-selftest';
export type Check = { id: string; category: CheckCategoryId; label: string; status: CheckStatus; detail: string; ms?: number };

export const CHECK_CATEGORIES: { id: CheckCategoryId; title: string; description: string }[] = [
  { id: 'platform', title: 'Configuration and services', description: 'Database, secrets, rate limiters, email and logins. Checked on the server.' },
  { id: 'trial-selftest', title: 'Trial API self-test', description: 'The server plays the PinchPDF app and the NoDupe app against their own endpoints, including a sealed request and answer. Nothing is written.' },
];

export type HealthEnv = AdminEnv &
  Partial<TrialEnv> &
  UpdatesEnv & {
    DOCS_USER?: string;
    DOCS_PASSWORD?: string;
    RESEND_API_KEY?: string;
    CONTACT_FROM_EMAIL?: string;
    CONTACT_RATE_LIMITER?: unknown;
    TRIAL_DOCS_LIMITER?: unknown;
  };

const REQUIRED_TABLES = ['trials', 'trial_audit', 'metrics_daily', 'telemetry_customers', 'telemetry_devices', 'telemetry_events'];
const migrateHint = (product: ProductSpec) => `Run: npx wrangler d1 migrations apply ${product.dbName} --remote`;

const LIMITERS = [
  'TRIAL_CHALLENGE_LIMITER',
  'TRIAL_REGISTER_LIMITER',
  'TRIAL_USAGE_LIMITER',
  'TRIAL_USAGE_IP_LIMITER',
  'TRIAL_DOCS_LIMITER',
  'TRIAL_ADMIN_LIMITER',
  'TELEMETRY_IP_LIMITER',
  'TELEMETRY_CUSTOMER_LIMITER',
  'UPDATES_IP_LIMITER',
  'CONTACT_RATE_LIMITER',
] as const;

const short = (error: unknown) => String((error as Error)?.message ?? error).slice(0, 160);

async function timed(id: string, label: string, run: () => Promise<{ status: CheckStatus; detail: string }>): Promise<Check> {
  const started = Date.now();
  try {
    const { status, detail } = await run();
    return { id, category: 'platform', label, status, detail, ms: Date.now() - started };
  } catch (error) {
    return { id, category: 'platform', label, status: 'fail', detail: short(error), ms: Date.now() - started };
  }
}

// PinchPDF keeps its original check ids; NoDupe's are prefixed so both can be shown side by side.
const idOf = (product: ProductSpec, id: string) => (product === PINCHPDF ? id : `${product.id}-${id}`);
const labelOf = (product: ProductSpec, label: string) => (product === PINCHPDF ? label : `${product.name}: ${label}`);

function checkDatabase(env: HealthEnv, product: ProductSpec = PINCHPDF): Promise<Check> {
  return timed(idOf(product, 'db'), labelOf(product, 'Trial database (D1)'), async () => {
    const db = productDb(env as TrialEnv, product);
    if (!db) return { status: 'fail', detail: `The ${product.dbBinding} binding is missing from this deployment. Declare it in wrangler.json (the production database is named ${product.dbName}).` };
    await db.prepare('SELECT 1').first();
    return { status: 'ok', detail: 'Answers queries.' };
  });
}

function checkSchema(env: HealthEnv, product: ProductSpec = PINCHPDF): Promise<Check> {
  return timed(idOf(product, 'schema'), labelOf(product, 'Database tables and migrations'), async () => {
    const db = productDb(env as TrialEnv, product);
    if (!db) return { status: 'fail', detail: 'No database to check.' };
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const present = new Set((tables.results ?? []).map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
    if (missing.length > 0) return { status: 'fail', detail: `Missing tables: ${missing.join(', ')}. ${migrateHint(product)}` };
    const columns = (await db.prepare("SELECT name FROM pragma_table_info('trials')").all<{ name: string }>()).results ?? [];
    if (!columns.some((row) => row.name === 'product')) return { status: 'fail', detail: `trials has no "product" column (migration 0002 is not applied). ${migrateHint(product)}` };
    if (product.perMode && !columns.some((row) => row.name === 'used_deep')) return { status: 'fail', detail: `trials has no per-mode counters. ${migrateHint(product)}` };
    const events = ((await db.prepare("SELECT name FROM pragma_table_info('telemetry_events')").all<{ name: string }>()).results ?? []).map((row) => row.name);
    if (!events.includes('install_kind')) return { status: 'warn', detail: `telemetry_events has no install_kind column (the install and uninstall migration is not applied): install events are refused until it is. ${migrateHint(product)}` };
    return { status: 'ok', detail: `All ${REQUIRED_TABLES.length} tables present (${REQUIRED_TABLES.join(', ')}); migrations applied.` };
  });
}

function checkSecrets(env: HealthEnv, product: ProductSpec = PINCHPDF): Promise<Check> {
  return timed(idOf(product, 'secrets'), labelOf(product, 'Trial secrets and settings'), async () => {
    const { present, missing, invalid } = configStatus(env, product);
    if (missing.length === 0 && invalid.length === 0) return { status: 'ok', detail: `All ${present.length} required settings are present and well formed. Until this is green the trial endpoints answer 503.` };
    const lines = [
      ...missing.map((name) => `${name}: missing`),
      ...invalid.map((item) => `${item.name}: ${item.problem}`),
    ];
    return { status: 'fail', detail: `The trial endpoints answer 503 until this is fixed.\n${lines.join('\n')}` };
  });
}

function checkTelemetryRetention(env: HealthEnv, product: ProductSpec = PINCHPDF): Promise<Check> {
  return timed(idOf(product, 'telemetry-retention'), labelOf(product, 'Telemetry retention'), async () => {
    const db = productDb(env as TrialEnv, product);
    if (!db) return { status: 'warn', detail: 'No database to check.' };
    try {
      const row = await db.prepare('SELECT MIN(received_at) AS oldest, COUNT(*) AS events FROM telemetry_events').first<{ oldest: number | null; events: number }>();
      return retentionStatus({ oldest: row?.oldest ?? null, events: row?.events ?? 0 }, Math.floor(Date.now() / 1000));
    } catch {
      // The tables are reported by the schema check; do not fail twice for the same cause.
      return { status: 'warn', detail: 'Telemetry tables are not readable yet (see the database check).' };
    }
  });
}

function checkTrialRetention(env: HealthEnv, product: ProductSpec = PINCHPDF): Promise<Check> {
  return timed(idOf(product, 'trial-retention'), labelOf(product, 'Trial retention'), async () => {
    const db = productDb(env as TrialEnv, product);
    if (!db) return { status: 'warn', detail: 'No database to check.' };
    try {
      return trialRetentionStatus(await readTrialRetention(db), Math.floor(Date.now() / 1000));
    } catch {
      return { status: 'warn', detail: 'The trials table is not readable yet (see the database check).' };
    }
  });
}

function checkReleases(env: HealthEnv): Promise<Check> {
  return timed('releases', 'App updates (release lists on GitHub)', async () => {
    const lines: string[] = [];
    let worst: CheckStatus = 'ok';
    for (const product of PRODUCTS) {
      const config = updatesConfig(env, product);
      if (!config.ok) {
        worst = 'warn';
        lines.push(`${product}: update checks answer 503 until this is set up. Missing: ${config.missing.join(', ')}. See docs/RELEASES.md.`);
        continue;
      }
      const loaded = await loadReleases(config, product);
      if (!loaded.ok) {
        worst = 'warn';
        lines.push(`${product}: ${loaded.reason}`);
        continue;
      }
      const { releases, problems } = loaded.value;
      const live = releases.filter((r) => r.enabled).length;
      lines.push(`${product}: ${releases.length} valid release(s), ${live} enabled${loaded.value.stale ? ' (stale list)' : ''}`);
      for (const problem of problems.slice(0, 5)) lines.push(`  ${problem}`);
      if (problems.length > 0) worst = 'warn';
    }
    return { status: worst, detail: lines.join('\n') };
  });
}

function checkLimiters(env: HealthEnv): Promise<Check> {
  return timed('limiters', 'Rate limiters', async () => {
    const record = env as Record<string, unknown>;
    const missing = LIMITERS.filter((name) => !record[name]);
    if (missing.length === 0) return { status: 'ok', detail: `All ${LIMITERS.length} rate-limit bindings are present.` };
    return { status: 'warn', detail: `Missing: ${missing.join(', ')}. Requests are still served, with weaker flood protection (in-memory fallback). Declare them under "ratelimits" in wrangler.json.` };
  });
}

function checkEmail(env: HealthEnv): Promise<Check> {
  return timed('email', 'Email delivery (contact and support forms)', async () => {
    const processEnv = typeof process === 'undefined' ? {} : (process.env as Record<string, string | undefined>);
    const has = (name: 'RESEND_API_KEY' | 'CONTACT_FROM_EMAIL') => Boolean((env[name] ?? processEnv[name])?.trim());
    const missing = (['RESEND_API_KEY', 'CONTACT_FROM_EMAIL'] as const).filter((name) => !has(name));
    if (missing.length === 0) return { status: 'ok', detail: 'RESEND_API_KEY and CONTACT_FROM_EMAIL are set. Sending itself is not tested, so no email is sent.' };
    return { status: 'fail', detail: `Missing: ${missing.join(', ')}. The contact and support forms cannot send email.` };
  });
}

function checkDocsLogin(env: HealthEnv): Promise<Check> {
  return timed('docs-login', 'API docs login', async () => {
    const on = Boolean(env.DOCS_USER && env.DOCS_PASSWORD);
    return on
      ? { status: 'ok', detail: 'DOCS_USER and DOCS_PASSWORD are set.' }
      : { status: 'warn', detail: 'The API docs and their configuration check are switched off (404). Set DOCS_USER and DOCS_PASSWORD to turn them on.' };
  });
}

async function publicKeyChecks(env: HealthEnv): Promise<Check[]> {
  const kids = acceptedKids(env as TrialEnv);
  if (kids.length === 0) return [{ id: 'pubkey', category: 'trial-selftest', label: 'Server public key', status: 'fail', detail: 'No accepted key id (ACCEPTED_KIDS).' }];
  return Promise.all(
    kids.map(async (kid): Promise<Check> => {
      const key = await serverPublicKey(env, kid);
      return key
        ? { id: `pubkey-${kid}`, category: 'trial-selftest', label: `Server public key (key ${kid})`, status: 'ok', detail: `${key}\nThe PinchPDF and NoDupe apps must both embed exactly this public key for key id ${kid} (the two products share the server keys). If it differs, every register and usage request fails with a 400.` }
        : { id: `pubkey-${kid}`, category: 'trial-selftest', label: `Server public key (key ${kid})`, status: 'fail', detail: `TRIAL_KEY_${kid} cannot be turned into a public key: it must be exactly 32 bytes of base64url.` };
    }),
  );
}

export async function runServerChecks(env: HealthEnv): Promise<Check[]> {
  const platform = await Promise.all([
    checkDatabase(env), checkSchema(env), checkSecrets(env), checkLimiters(env), checkTelemetryRetention(env), checkTrialRetention(env),
    checkDatabase(env, NODUPE), checkSchema(env, NODUPE), checkSecrets(env, NODUPE), checkTelemetryRetention(env, NODUPE), checkTrialRetention(env, NODUPE),
    checkReleases(env), checkEmail(env), checkDocsLogin(env),
  ]);
  const steps = [...(await runTrialSelfTest(env as TrialEnv)), ...(await runTrialSelfTest(env as TrialEnv, NODUPE))];
  const selftest: Check[] = steps.map((step) => ({ id: step.id, category: 'trial-selftest', label: step.label, status: step.status, detail: step.detail, ms: step.ms }));
  return [...platform, ...selftest, ...(await publicKeyChecks(env))];
}
