/// <reference types="@cloudflare/vitest-plugin/types" />
import type { D1Migration } from '@cloudflare/vitest-plugin';
import type { TrialEnv } from '../lib/trial/config';

declare global {
  namespace Cloudflare {
    interface Env extends TrialEnv {
      TEST_MIGRATIONS: D1Migration[];
      RELEASES_BUCKET: R2Bucket;
    }
  }
}
