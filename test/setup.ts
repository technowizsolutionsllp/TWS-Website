import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach, vi } from 'vitest';

await applyD1Migrations(env.TRIAL_DB, env.TEST_MIGRATIONS);

// Storage is shared between tests in a file; start each one from empty tables.
beforeEach(async () => {
  await env.TRIAL_DB.batch([env.TRIAL_DB.prepare('DELETE FROM trials'), env.TRIAL_DB.prepare('DELETE FROM trial_audit')]);
});

// The service logs one JSON line per request; keep test output readable.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
