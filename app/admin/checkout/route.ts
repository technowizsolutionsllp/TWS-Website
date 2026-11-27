import { handleAdminCheckout, type CheckoutAdminEnv } from '../../../lib/admin/checkout-handlers';
import { getRawEnv } from '../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleAdminCheckout(request, await getRawEnv<CheckoutAdminEnv>());
}

export async function POST(request: Request) {
  return handleAdminCheckout(request, await getRawEnv<CheckoutAdminEnv>());
}
