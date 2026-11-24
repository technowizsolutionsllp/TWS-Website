import { handleAdminRecords, type RecordsRuntimeEnv } from '../../../lib/admin/records-handlers';
import { getRawEnv } from '../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleAdminRecords(request, await getRawEnv<RecordsRuntimeEnv>());
}

export async function POST(request: Request) {
  return handleAdminRecords(request, await getRawEnv<RecordsRuntimeEnv>());
}
