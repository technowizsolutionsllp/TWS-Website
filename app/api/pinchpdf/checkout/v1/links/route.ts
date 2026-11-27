import { handleCheckoutLinks, type CheckoutEnv } from '../../../../../../lib/checkout/handler';
import { PINCHPDF } from '../../../../../../lib/trial/product';
import { getRawEnv } from '../../../../../../lib/trial/runtime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handleCheckoutLinks(request, await getRawEnv<CheckoutEnv>(), PINCHPDF);
}
