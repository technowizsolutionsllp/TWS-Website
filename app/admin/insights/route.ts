import { handleAdminInsights, type AdminRuntimeEnv } from '../../../lib/admin/handlers';
import { getRawEnv } from '../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleAdminInsights(request, await getRawEnv<AdminRuntimeEnv>());
}
