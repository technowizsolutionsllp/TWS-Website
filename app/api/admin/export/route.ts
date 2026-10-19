import { cookies } from 'next/headers';
import { adminCookieName, isAdmin } from '../../../../lib/purchases/admin-auth';
import { toCsv, toXlsx } from '../../../../lib/purchases/export';
import { listPurchases } from '../../../../lib/purchases/store';

export async function GET(request: Request) {
  const cookie = (await cookies()).get(adminCookieName)?.value;
  if (!(await isAdmin(cookie, request.headers.get('authorization')))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const purchases = await listPurchases();
  const stamp = new Date().toISOString().slice(0, 10);
  const common = {
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="purchases-${stamp}.${format}"`,
  };

  if (format === 'csv') {
    return new Response(toCsv(purchases), {
      headers: { ...common, 'Content-Type': 'text/csv; charset=utf-8' },
    });
  }
  return new Response(toXlsx(purchases) as BodyInit, {
    headers: {
      ...common,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  });
}
