import { handleTelemetry } from '../../../../../../lib/telemetry/handler';
import { NODUPE } from '../../../../../../lib/trial/product';
import { withTrialEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

// NoDupe's copy of the PinchPDF endpoint: same code, NoDupe's database, paths and signing prefix.
export async function POST(request: Request) {
  return withTrialEnv((env) => handleTelemetry(request, env, undefined, NODUPE), NODUPE);
}
