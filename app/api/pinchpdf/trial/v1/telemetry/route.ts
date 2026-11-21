import { handleTelemetry } from '../../../../../../lib/telemetry/handler';
import { withTrialEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withTrialEnv((env) => handleTelemetry(request, env));
}
