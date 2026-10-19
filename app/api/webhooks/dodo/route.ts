import { getEnv } from '../../../../lib/purchases/env';
import { upsertPurchase } from '../../../../lib/purchases/store';
import { verifyDodo } from '../../../../lib/purchases/verify';
import { json, obj, readRawBody, str } from '../../../../lib/purchases/webhook';

// Dodo Payments -> Developer -> Webhooks. Subscribe to `payment.succeeded` and
// `license_key.created`; the signing secret goes in DODO_WEBHOOK_SECRET.
export async function POST(request: Request) {
  const secret = await getEnv('DODO_WEBHOOK_SECRET');
  if (!secret) return json({ message: 'Webhook not configured.' }, 503);

  const raw = await readRawBody(request);
  if (raw === null) return json({ message: 'Request body is too large.' }, 413);

  if (!(await verifyDodo(raw, request.headers, secret))) {
    return json({ message: 'Invalid signature.' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = obj(JSON.parse(raw));
  } catch {
    return json({ message: 'Invalid request body.' }, 400);
  }

  const type = str(payload.type);
  const data = obj(payload.data);

  try {
    if (type === 'payment.succeeded') {
      const orderRef = str(data.payment_id, 100);
      if (!orderRef) return json({ message: 'Missing payment id.' }, 400);
      const customer = obj(data.customer);
      const firstProduct = obj(Array.isArray(data.product_cart) ? data.product_cart[0] : null);
      await upsertPurchase({
        provider: 'dodo',
        orderRef,
        name: str(customer.name, 200),
        email: str(customer.email, 320),
        product: str(firstProduct.product_id, 200),
      });
    } else if (type === 'license_key.created') {
      // Linked to the payment when Dodo includes payment_id; otherwise the
      // license key id is used and the row stays separate.
      const orderRef = str(data.payment_id, 100) ?? str(data.id, 100);
      if (!orderRef) return json({ message: 'Missing license key id.' }, 400);
      const customer = obj(data.customer);
      await upsertPurchase({
        provider: 'dodo',
        orderRef,
        name: str(customer.name, 200),
        email: str(customer.email, 320),
        licenseKey: str(data.key, 200),
        product: str(data.product_id, 200),
      });
    }
  } catch (error) {
    console.error('dodo webhook store error', error);
    return json({ message: 'Could not store purchase.' }, 500);
  }

  return json({ ok: true }, 200);
}
