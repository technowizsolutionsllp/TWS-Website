import { handleRegister } from '../../../../../../lib/trial/handlers';
import { NODUPE } from '../../../../../../lib/trial/product';
import { withTrialEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

// NoDupe's copy of the PinchPDF endpoint: same code, NoDupe's database, paths and signing prefix.
export async function POST(request: Request) {
  return withTrialEnv((env) => handleRegister(request, env, undefined, NODUPE), NODUPE);
}
