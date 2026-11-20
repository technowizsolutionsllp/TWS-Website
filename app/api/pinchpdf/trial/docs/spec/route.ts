import { handleDocsSpec, type DocsEnv } from '../../../../../../lib/trial/docs';
import { getRawEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleDocsSpec(request, await getRawEnv<DocsEnv>());
}
