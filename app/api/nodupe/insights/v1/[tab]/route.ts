import { handleInsightsApi } from '../../../../../../lib/admin/insights-api';
import type { AdminRuntimeEnv } from '../../../../../../lib/admin/handlers';
import { NODUPE } from '../../../../../../lib/trial/product';
import { getRawEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

// NoDupe's copy of the PinchPDF Insights JSON API: same numbers, read from NoDupe's own database.
export async function GET(request: Request) {
  return handleInsightsApi(request, await getRawEnv<AdminRuntimeEnv>(), undefined, NODUPE);
}
