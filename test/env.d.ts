/// <reference types="@cloudflare/vitest-plugin/types" />
import type { D1Migration } from '@cloudflare/vitest-plugin';
import type { TrialEnv } from '../lib/trial/config';

declare global {
  namespace Cloudflare {
    interface Env extends TrialEnv {
      NODUPE_DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      TEST_NODUPE_MIGRATIONS: D1Migration[];
    }
  }
}
