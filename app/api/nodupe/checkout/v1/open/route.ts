import { handleCheckoutOpen, type CheckoutEnv } from '../../../../../../lib/checkout/handler';
import { NODUPE } from '../../../../../../lib/trial/product';
import { getRawEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleCheckoutOpen(request, await getRawEnv<CheckoutEnv>(), NODUPE);
}
