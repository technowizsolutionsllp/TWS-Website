import { handleUpdateCheck } from '../../../../../../lib/updates/handler';
import { withUpdatesEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withUpdatesEnv((env) => handleUpdateCheck(request, env, 'PinchPDF'));
}
