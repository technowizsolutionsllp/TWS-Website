import { handleAdminHealth } from '../../../lib/admin/handlers';
import type { HealthEnv } from '../../../lib/admin/health-checks';
import { getRawEnv } from '../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleAdminHealth(request, await getRawEnv<HealthEnv>());
}
