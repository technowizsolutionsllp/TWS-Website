import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach, vi } from 'vitest';
import { resetMetrics } from '../lib/trial/metrics';

await applyD1Migrations(env.TRIAL_DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.NODUPE_DB, env.TEST_NODUPE_MIGRATIONS);

// Storage is shared between tests in a file; start each one from empty tables.
beforeEach(async () => {
  await env.TRIAL_DB.batch(
    ['trials', 'trial_audit', 'metrics_daily', 'telemetry_events', 'telemetry_devices', 'telemetry_customers', 'checkout_config', 'checkout_audit'].map((table) => env.TRIAL_DB.prepare(`DELETE FROM ${table}`)),
  );
  await env.NODUPE_DB.batch(
    ['trials', 'trial_audit', 'metrics_daily', 'telemetry_events', 'telemetry_devices', 'telemetry_customers', 'checkout_config', 'checkout_audit'].map((table) => env.NODUPE_DB.prepare(`DELETE FROM ${table}`)),
  );
  resetMetrics();
});

// The service logs one JSON line per request; keep test output readable.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
