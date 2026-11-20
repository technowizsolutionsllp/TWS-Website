import { handleDocsPage, type DocsEnv } from '../../../../../lib/trial/docs';
import { getRawEnv } from '../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleDocsPage(request, await getRawEnv<DocsEnv>());
}
