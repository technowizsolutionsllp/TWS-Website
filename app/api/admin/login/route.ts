import { NextResponse } from 'next/server';
import { adminCookieName, checkAdminSecret, issueAdminToken } from '../../../../lib/purchases/admin-auth';
import { isRateLimited } from '../../contact/rate-limit';

export async function POST(request: Request) {
  const redirect = (path: string) =>
    new NextResponse(null, { status: 303, headers: { Location: path } });

  if (await isRateLimited(request)) return redirect('/admin?error=rate');

  const form = await request.formData().catch(() => null);
  const secret = form?.get('secret');
  if (typeof secret !== 'string' || !(await checkAdminSecret(secret))) {
    return redirect('/admin?error=1');
  }

  const token = await issueAdminToken();
  if (!token) return redirect('/admin?error=1');

  const response = redirect('/admin');
  response.cookies.set(adminCookieName, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return response;
}
