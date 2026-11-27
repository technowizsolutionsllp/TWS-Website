# Checkout links: reference for the app teams

For the PinchPDF and NoDupe app teams. A short page for building the app side; the full design is in [CHECKOUT_LINKS.md](CHECKOUT_LINKS.md). Base URL: `https://technowizsolutions.com`. Both products work the same way; only the path, the Dodo product ids and the Lemon Squeezy store differ.

## What changed on the site

- The owner now sets on `/admin/checkout` where the Buy buttons send buyers, per product and mode (Live, Test):
  - the **primary provider** (Dodo Payments or Lemon Squeezy), and **Force** (use the primary only, never fall back);
  - one link per license (Individual, Business) and provider;
  - **promotions**: other link sets that run between a start and an end date (UTC), usually the same products with a discount code.
- Each link is checked against the provider's real checkout page before it is saved.
- A public endpoint serves the set buyers get now. Until the owner saves something, it serves the links built into today's apps, so nothing changes for buyers.
- The privacy policy now describes the request (`/privacy#checkout-links`, section 2.8), and the license terms say that the price on the checkout page applies and that promotions can change without an app update (`/terms#fees`, section 7.2).

## Endpoints

| | PinchPDF | NoDupe |
|---|---|---|
| Links for the app | `GET /api/pinchpdf/checkout/v1/links?mode=live` | `GET /api/nodupe/checkout/v1/links?mode=live` |
| Redirect to the checkout (website buttons, not for the app) | `GET /api/pinchpdf/checkout/v1/open?tier=individual&mode=live` | `GET /api/nodupe/checkout/v1/open?tier=individual&mode=live` |

- Plain `GET`, no login, no body, no headers needed, no personal data. Debug builds use `mode=test`; `mode` defaults to `live`.
- Rate limit: 60 requests a minute per IP (`CHECKOUT_IP_LIMITER`), shared by both endpoints.
- Swagger: `/api/pinchpdf/trial/docs` (choose the product at the top; the two paths are under the product's tag).

### `links` answers

| Status | Body | Meaning |
|---|---|---|
| `200` | JSON below. `Cache-Control: public, max-age=60` | The set buyers get now |
| `400` | `{"error":"bad_request","message":"…"}` | `mode` is not `live` or `test` |
| `429` | `{"error":"rate_limited"}`, `Retry-After: 60` | Too many requests from this IP. Use the saved or built-in links |
| `503` | `{"error":"unavailable"}`, `Retry-After: 60` | The database cannot be read. Use the saved or built-in links |

```json
{
  "product": "pinchpdf",
  "mode": "live",
  "set": { "number": 2, "name": "Black Friday 2026", "ends_at": "2026-12-02T23:59:00.000Z" },
  "primary": "dodo",
  "force": false,
  "links": {
    "individual": { "dodo": "https://checkout.dodopayments.com/buy/pdt_0Nplqin1uobNhVKSJLImM?quantity=1&discount_code=BF2026", "lemon_squeezy": "https://technowizsolutions.lemonsqueezy.com/checkout/buy/584d4694-bd36-4e04-979c-2b4ffbaa3f68" },
    "business": { "dodo": "https://checkout.dodopayments.com/buy/pdt_0NplrzQavP5dhhEM7juVK?quantity=1&discount_code=BF2026", "lemon_squeezy": "https://technowizsolutions.lemonsqueezy.com/checkout/buy/ddf7f467-5c26-4551-a38e-48f990355519" }
  },
  "updated_at": "2026-11-27T08:45:00.000Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `product` | `"pinchpdf"` or `"nodupe"` | Check that it is your product |
| `mode` | `"live"` or `"test"` | Check that it is the mode you asked for |
| `set.number`, `set.name` | 1 to 4, text | For logs only. Set 1 is "Standard" |
| `set.ends_at` | ISO 8601 UTC or `null` | When this set stops. `null` for a set with no end |
| `primary` | `"dodo"` or `"lemon_squeezy"` | Open this provider first |
| `force` | boolean | `true`: never fall back to the other provider |
| `links.<license>.<provider>` | URL or `null` | `license` is `individual` or `business`. `null` means no link: keep the built-in one |
| `updated_at` | ISO 8601 UTC or `null` | When the owner last saved. `null` while the built-in links are served |

Unknown fields may be added later; ignore them.

## What the app must do

1. When the Upgrade window opens, fetch `links` for the build's mode, with a short timeout (a few seconds). Do not block the window on it.
2. Check every link with the app's own rules (below). A link that passes replaces the built-in link in the same slot (license and provider). A link that fails, or `null`, is ignored, and the built-in link stays in that slot.
3. Save the answer on the device and keep it until the next successful fetch. Check saved links again every time they are loaded. Ignore a saved answer whose `set.ends_at` has passed.
4. Use the links in this order: a fresh fetch, then the saved answer, then the built-in links.
5. Open `primary` first. Fall back to the other provider only if `force` is `false`. A debug build's force-provider setting overrides both.
6. Activation does not change: keys from both providers still activate, whatever `primary` and `force` say.
7. The Buy click event (`buy_clicked`) keeps the same fields; the provider and set are not part of it.

## The app's own rules for a link

The server enforces the same rules, but the app must not trust the answer on its own.

- `https` only, no user name, password, port or `#`, at most 512 characters.
- **Dodo Payments**
  - Host `checkout.dodopayments.com` in Live, `test.checkout.dodopayments.com` in Test.
  - Path `/buy/<product id>`, and the product id must be the app's own product for that license:

    | | Live Individual | Live Business | Test Individual | Test Business |
    |---|---|---|---|---|
    | PinchPDF | `pdt_0Nplqin1uobNhVKSJLImM` | `pdt_0NplrzQavP5dhhEM7juVK` | `pdt_0NpH4a2Ken4XQYwdqsupO` | `pdt_0NplruuBGvxKzjtN7cqFu` |
    | NoDupe | `pdt_0Nspl8zc3NQ4lVqcDfd1V` | `pdt_0NspmmDgbLHobIoeUvOZC` | none | none |

  - Only `quantity=1` and `discount_code=<code>` may follow.
- **Lemon Squeezy**
  - Host `<store>.lemonsqueezy.com`, with store `technowizsolutions` for PinchPDF and `anshul` for NoDupe.
  - Path `/checkout/buy/<uuid>` (lowercase hex UUID).
  - Only `checkout[discount_code]=<code>` may follow.
- A discount code is 1 to 40 letters, digits, `-` or `_`.

A new Dodo product needs an app release that accepts its keys before the site can link to it; the site refuses such a link until `DODO_PRODUCTS` in `lib/checkout/config.ts` is changed. Promotions therefore use discount codes on the existing products.

## Before an app release uses it

- The privacy policy (section 2.8, `#checkout-links`) and the license terms (section 7.2) now describe the request and promotions. They are drafts for counsel, like the rest of the legal text. Remove the `TODO(owner)` note under section 2.8 in `app/privacy/page.tsx` when the first app release with the fetch ships.
- Check that the store listings and in-app privacy text do not say that the app contacts no server before purchase.
- NoDupe has no Test links yet (no Dodo test products, and no Lemon Squeezy test links saved). Debug builds of NoDupe keep their built-in links until the owner saves some.
- The owner applies the migrations before the site serves saved links: `npx wrangler d1 migrations apply pinchpdf --remote` and `npx wrangler d1 migrations apply nodupe --remote`. Until then `links` answers `503`, and the app uses its saved or built-in links.
