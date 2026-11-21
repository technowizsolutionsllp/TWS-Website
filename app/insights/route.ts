import { handleInsights, type InsightsEnv } from '../../lib/telemetry/page';
import { getRawEnv } from '../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleInsights(request, await getRawEnv<InsightsEnv>());
}
