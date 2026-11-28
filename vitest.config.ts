import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Trial-service tests run inside workerd with a real (local) D1 database.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  const nodupeMigrations = await readD1Migrations('./migrations-nodupe');
  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          compatibilityDate: '2026-05-15',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['TRIAL_DB', 'NODUPE_DB'],
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_NODUPE_MIGRATIONS: nodupeMigrations,
            // TEST-ONLY secrets, deliberately public in this repo. NEVER use these values as real secrets.
            PEPPER: 'cGVwcGVyLXRlc3Qta2V5LTAxMjM0NTY3ODkwMTIzNDU',
            PEPPER_EMAIL: 'cGVwcGVyLWVtYWlsLXRlc3Qta2V5LTAxMjM0NTY',
            PII_KEY: 'cGlpLXRlc3Qta2V5LTAxMjM0NTY3ODkwMTIzNDU2Nzg',
            CHALLENGE_KEY: 'Y2hhbGxlbmdlLXRlc3Qta2V5LTAxMjM0NTY3ODkwMQ',
            ACCEPTED_KIDS: 'k1,k0',
            TRIAL_KEY_k1: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
            TRIAL_KEY_k0: 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8',
            TRIAL_TERMS_VERSION: '2026-11-28',
            TRIAL_PRIVACY_VERSION: '2026-11-28',
            NODUPE_TRIAL_TERMS_VERSION: '2026-11-28',
            NODUPE_TRIAL_PRIVACY_VERSION: '2026-11-28',
            TRIAL_DIFFICULTY: '8',
            TRIAL_DIFFICULTY_MIN: '4',
            TRIAL_DIFFICULTY_MAX: '28',
            TRIAL_LIMIT: '5',
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
    },
  };
});
