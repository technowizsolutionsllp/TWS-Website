import { handleRecordsSearchApi, type RecordsRuntimeEnv } from '../../../../../../lib/admin/records-handlers';
import { PINCHPDF } from '../../../../../../lib/trial/product';
import { getRawEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

// Find PinchPDF trial records (admin login). POST only, so a name or email never appears in a URL.
export async function POST(request: Request) {
  return handleRecordsSearchApi(request, await getRawEnv<RecordsRuntimeEnv>(), undefined, PINCHPDF);
}
