import { getEnv } from '../../../../lib/purchases/env';
import { upsertPurchase } from '../../../../lib/purchases/store';
import { verifyLemonSqueezy } from '../../../../lib/purchases/verify';
import { json, obj, readRawBody, str } from '../../../../lib/purchases/webhook';

// Lemon Squeezy -> Settings -> Webhooks. Subscribe to `order_created` and
// `license_key_created`; the signing secret goes in LEMONSQUEEZY_WEBHOOK_SECRET.
export async function POST(request: Request) {
  const secret = await getEnv('LEMONSQUEEZY_WEBHOOK_SECRET');
  if (!secret) return json({ message: 'Webhook not configured.' }, 503);

  const raw = await readRawBody(request);
  if (raw === null) return json({ message: 'Request body is too large.' }, 413);

  if (!(await verifyLemonSqueezy(raw, request.headers.get('x-signature'), secret))) {
    return json({ message: 'Invalid signature.' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = obj(JSON.parse(raw));
  } catch {
    return json({ message: 'Invalid request body.' }, 400);
  }

  const event = request.headers.get('x-event-name') ?? str(obj(payload.meta).event_name);
  const data = obj(payload.data);
  const attrs = obj(data.attributes);

  try {
    if (event === 'license_key_created') {
      const orderRef = str(attrs.order_id, 100) ?? str(data.id, 100);
      if (!orderRef) return json({ message: 'Missing order id.' }, 400);
      await upsertPurchase({
        provider: 'lemonsqueezy',
        orderRef,
        name: str(attrs.user_name, 200),
        email: str(attrs.user_email, 320),
        licenseKey: str(attrs.key, 200),
      });
    } else if (event === 'order_created') {
      const orderRef = str(data.id, 100);
      if (!orderRef) return json({ message: 'Missing order id.' }, 400);
      await upsertPurchase({
        provider: 'lemonsqueezy',
        orderRef,
        name: str(attrs.user_name, 200),
        email: str(attrs.user_email, 320),
        product: str(obj(attrs.first_order_item).product_name, 200),
      });
    }
  } catch (error) {
    console.error('lemonsqueezy webhook store error', error);
    return json({ message: 'Could not store purchase.' }, 500); // provider retries
  }

  return json({ ok: true }, 200);
}
