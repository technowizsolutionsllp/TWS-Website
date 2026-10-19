# Purchases service (webhooks + /admin)

Stores name, email and license key for each successful purchase in Cloudflare D1
(`DB` binding, table `purchases`), fed by Lemon Squeezy and Dodo Payments webhooks.

## One-time setup
1. `npx wrangler d1 create tws-purchases` and paste the `database_id` into `wrangler.json`.
2. `npx wrangler d1 migrations apply tws-purchases --remote`
3. Secrets (`npx wrangler secret put <NAME>`):
   - `LEMONSQUEEZY_WEBHOOK_SECRET` – signing secret set on the Lemon Squeezy webhook
   - `DODO_WEBHOOK_SECRET` – `whsec_...` secret from the Dodo webhook
   - `ADMIN_SECRET` – long random string used to sign in at `/admin`
4. Webhook URLs and events:
   - Lemon Squeezy: `https://technowizsolutions.com/api/webhooks/lemonsqueezy` – `order_created`, `license_key_created`
   - Dodo: `https://technowizsolutions.com/api/webhooks/dodo` – `payment.succeeded`, `license_key.created`

## Behaviour
- Signatures are verified (LS: HMAC-SHA256 hex in `X-Signature`; Dodo: Standard Webhooks headers). Bad signature -> 401.
- Name/email and the key can arrive in separate events; rows are merged by (provider, order/payment id).
- DB failure returns 500 so the provider retries; duplicates are idempotent.
- `/admin` takes `ADMIN_SECRET`, sets an 8h HttpOnly cookie. `/api/admin/export?format=xlsx|csv` also accepts `Authorization: Bearer <ADMIN_SECRET>`.
- Exports prefix cells starting with `= + - @` with `'` to block spreadsheet formula injection.
