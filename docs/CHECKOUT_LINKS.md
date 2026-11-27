# Checkout links

Where the Buy buttons in PinchPDF and NoDupe send buyers, set on `/admin/checkout` and served to the apps by a public endpoint. The two products work the same way; each keeps its setting in its own database.

## What can be set

There is one setting per product and mode (Live, and Test for the sandbox links that debug builds use).

- **Primary provider:** Dodo Payments or Lemon Squeezy. The primary opens first. The other provider is the backup and opens when the primary has no link.
- **Force the primary provider:** if this is on, buyers get only the primary, never the backup, even when its checkout is down. This affects checkout only. Keys from both providers still activate. A debug build's own "force provider" setting in the app still wins.
- **Link sets:** there can be 1 to 4 sets.
  - Set 1, "Standard", holds the standard links. It cannot be renamed, given dates or removed.
  - Sets 2 to 4 are for a promotion or a short-term change. An empty link in sets 2 to 4 uses set 1's link of the same license type.
- **Links:** in every set, each provider has two links, and you choose each link's **license type** (Individual or Business). A set needs one link of each type per provider. The app puts each link behind the Buy button of its license type.
- **Default set:** the set buyers get when no promotion is running. It must be a set without dates.
- **Promotions:** give a set a start date, an end date or both. Dates are in UTC and both are optional.
  - The set runs by itself between its dates. With no start date it runs from when it is saved; with no end date it runs until you change it.
  - Several promotions can be scheduled, but their dates cannot overlap.
  - Which set is live is worked out on every request, so a promotion starts and ends on time without any scheduled job.
- **Discount codes:** a link may carry one discount code: `discount_code=<code>` for Dodo, `checkout[discount_code]=<code>` for Lemon Squeezy. A code is 1 to 40 letters, digits, `-` or `_`. Use a code for a promotion: a new Dodo product would need an app release, because the app refuses keys from Dodo products it does not know.

## The rules a link must pass

These run on every save, and on every read of the stored setting. A setting stored in the database that breaks them is never served: the built-in links are served instead, and the Health check shows the problem.

- The link must use `https`, with no user name, password, port or `#` part, and be at most 512 characters long.
- **Dodo:**
  - The host must be `checkout.dodopayments.com` in Live and `test.checkout.dodopayments.com` in Test.
  - The path must be `/buy/pdt_…`, and only `quantity=1` and the discount code may follow.
  - The product id must be the one the app accepts for that mode and license type (`DODO_PRODUCTS` in `lib/checkout/config.ts`). NoDupe has no Dodo test products.
- **Lemon Squeezy:**
  - The host must be `<store>.lemonsqueezy.com`, with a store from the product's own list: `technowizsolutions` for PinchPDF, `anshul` for NoDupe.
  - The path must be `/checkout/buy/<uuid>`, and only the discount code may follow.
- Individual and Business may not share a link, and a link may not be saved on both the Live and the Test tab.
- Every set buyers can get (the default set, and every promotion that is running or still to come) needs both of the primary's links, after set 1's links are filled in.

## The live check

Before anything is saved, the server opens each new or changed link in any set. Changing only a link's license type counts as a change. When the default set, a promotion's dates, the primary or Force changes, it also opens the links buyers will get. A promotion is checked when it is scheduled, not when it starts, because nobody is there to approve it then.

Each check:

- uses an 8-second timeout;
- sends no cookies and a fixed user agent;
- follows at most 3 redirects, each on the provider's own host.

The check confirms that the page is a real checkout for this product and license type:

| | Dodo Payments | Lemon Squeezy |
|---|---|---|
| Same product and license | The cart's `product_id` is the link's product, and that product is the license type's | The store matches, the cart holds the link's variant, and the product or variant name says the license type (and not the other one) |
| Price | A one-time price above 0 | A price above 0 and a currency |
| Mode | Implied by the host | `cart.test_mode` matches the tab |
| Discount code | `discount_amount` is not null | `cart.discount_id` is set |

- **Live:** a failed check blocks the save. There is no override.
- **Test:** a failed check is only a warning.

What the check found is written to the change history with each link change. Opening a link creates a checkout session or cart at the provider, as a buyer's click would. Nothing is bought.

The page markers above were read from the sandbox links in November 2026. **Not yet seen with a real discount code:** the Dodo `discount_amount` and Lemon `discount_id` markers, and the Dodo `discount_code` parameter name. Confirm them with one real code before relying on promotions. If a provider starts blocking checks from Cloudflare, every Live save will fail, and this needs revisiting.

## Saving

"Review and save" answers with a review page. It shows:

- every change, before and after, next to its check result;
- the other links buyers will get that were also checked;
- what buyers get now, and after the save.

Saving needs a reason (3 to 500 characters). In Live, when what buyers get changes, it also needs a tick saying "I opened these checkout pages and they work", with a link to each page.

The review page carries the draft and the check results in hidden fields under an HMAC keyed from `ADMIN_PASSWORD`. This means Save cannot skip the check or change the draft. A review expires after 30 minutes.

Each save raises the version. A save made from an older version is refused, and the page then shows your changes so you can review them again.

## Where it is stored

- `checkout_config` holds one JSON row per mode: `migrations/0005_checkout_links.sql` for PinchPDF, `migrations-nodupe/0003_checkout_links.sql` for NoDupe. With no row, the links built into today's apps are used (`lib/checkout/defaults.ts`), so the feature changes nothing until something is saved.
- `checkout_audit` holds every change, with operator `admin-ui`. When the admin page next loads, it adds `auto-start` and `auto-end` rows for each promotion that started or ended on its own, dated when that happened. The table contains public URLs only, no personal data.

## Endpoints

These are public, with no login, and are documented in Swagger.

- `GET /api/{pinchpdf,nodupe}/checkout/v1/links?mode=live|test` returns JSON for the app (example below). It may be cached for 60 seconds. It answers `503` when the database cannot be read.
- `GET /api/{pinchpdf,nodupe}/checkout/v1/open?tier=individual|business&mode=live|test` answers `302` to the checkout: the primary's link, or the backup's unless Force is on. It is for website Buy buttons, which are not built yet. It answers `404 no_link` when nothing is set.
- Both are rate limited per IP by `CHECKOUT_IP_LIMITER` (60 a minute).

Example `links` answer while a promotion runs:

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

## What the apps must do (not built yet)

1. When the Upgrade window opens, fetch `links` for the build's mode (debug builds use `test`).
2. Check each link against the app's own rules: provider host, Dodo product ids the app accepts, and Lemon Squeezy store. Any fetched link that passes replaces the built-in link in the same slot (license and provider). Any link that fails is ignored, and the built-in link is used for that slot.
3. Keep the answer until the next successful fetch, so a fetched link stays in use when the site cannot be reached. Check saved links again every time they are loaded. Ignore a saved answer whose `set.ends_at` has passed.
4. Use the links in this order: a fresh fetch, then the saved answer, then the built-in links.
5. Open `primary` first, and fall back to the other provider only if `force` is false. A debug build's force-provider setting overrides both.

## Legal text

The legal text covers both products (updated November 27, 2026):

- **Privacy Policy, section 2.8** (`/privacy#checkout-links`): the app may ask our server which checkout pages to open. The request names only the App and whether it is a test build, with no key, name, email, or device or installation identifier. The IP address is used only for security and rate limiting and appears only in the hosting provider's short request logs. The app keeps the answer on the device.
- **Terms, Part B section 7.2** (`/terms#fees`): the price, edition and discount shown on the provider's checkout page apply. We may change prices, run promotions and choose the provider without updating the App. A promotion does not change the price of a license already bought.

The trial notices and trial terms (`app/*/legal/versions.ts`) are not changed: the request is not part of the trial, so no new consent version is needed. A `TODO(owner)` under section 2.8 stays until the first app release with the fetch ships. The text is a draft for counsel, like the rest.

For the app teams, the short version of this page is [CHECKOUT_LINKS_APP_REFERENCE.md](CHECKOUT_LINKS_APP_REFERENCE.md).
