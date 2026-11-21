import { handleInsightsApi } from '../../../../../../lib/admin/insights-api';
import type { AdminRuntimeEnv } from '../../../../../../lib/admin/handlers';
import { getRawEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleInsightsApi(request, await getRawEnv<AdminRuntimeEnv>());
}
