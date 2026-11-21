import { handleChallenge } from '../../../../../../lib/trial/handlers';
import { withTrialEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withTrialEnv((env) => handleChallenge(request, env));
}
