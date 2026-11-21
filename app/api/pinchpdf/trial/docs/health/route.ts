import { handleDocsHealth, type DocsEnv } from '../../../../../../lib/trial/docs';
import type { TrialEnv } from '../../../../../../lib/trial/config';
import { getRawEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleDocsHealth(request, await getRawEnv<DocsEnv & Partial<TrialEnv>>());
}
