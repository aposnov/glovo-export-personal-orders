# glovo-export

**English** · [Русский](README_RU.md)

A local CLI that exports your Glovo and Amazon order history into normalized JSON.

## Why

Glovo's own interface lets you neither filter nor export your order history. The data does sit behind a perfectly ordinary JSON API — it just has to be collected, turned into numbers and added up. The JSON this tool writes is shaped so charts can be built on top of it.

Amazon is the same story with a worse API: there is none for customers, only the order-history pages. So the [Amazon part](#amazon) reads those pages — in your own browser, under your own session — and writes the same JSON shape.

## How it works

The key decision: **every API call runs inside the page**, via `page.evaluate` on `https://glovoapp.com`. Node orchestrates the run but never sees the token.

```
Node (tsx)                     Chromium (Playwright profile)
  |                              |
  |-- page.evaluate(fetch) ----->|  reads the glovo_auth_info cookie
  |                              |  fetch -> api.glovoapp.com
  |<---------- JSON -------------|
  |
  normalize -> validate -> out/*.json
```

That one decision closes four problems at once:

- **CORS.** The API accepts only the exact origin `https://glovoapp.com` — not even `www` passes. A request from a page on that same domain is same-origin by definition.
- **The token lives ~20 minutes.** The cookie is re-read before every request, so there is nothing to expire mid-export.
- **The refresh token is never touched.** `POST /oauth/refresh` is never called; the page handles rotation itself. On a `401` we simply reload the page and retry.
- **Safety.** The token never reaches Node's memory, the disk, or the logs.

**You log in yourself**, by hand, in a visible browser window (the login page carries a reCAPTCHA, and automating it is neither needed nor attempted). The session is kept in a persistent Playwright profile at `~/.glovo-export/profile`, so you don't log in again for every export.

### Collecting orders

1. `GET /v3/customer/orders-list?offset=<cursor>&limit=50` — cursor pagination. Important: `offset` is **the id of the next order**, not a row number.
2. The list is presentational: it carries neither dates nor per-item prices. So every order needs its own `GET /v3/customer/orders/{id}`.
3. Orders come newest-first and ids are monotonic, so details are fetched top-down and the walk stops after **3 consecutive** orders outside the requested range (three, not one, so a single anomaly can't truncate the export).

Pacing: 750 ms between list pages, 1000 ms between orders. At most 5 retries. On `429` back off `min(15000 * 2^attempt, 120000)` ms, on `5xx` `min(1000 * 2^attempt, 30000)` ms.

### Normalization — the part that carries the weight

Every rule below was measured against live data, not taken from documentation:

| Field | Rule |
|---|---|
| Date | Use `currentStatus.creationTime` (epoch ms). The root-level `creationTime` is **always `null`** — never read it |
| Money | `"12,00 €"`, `"8,34 EUR"`, `"No cost"` → number. Comma is the decimal separator, `"No cost"` is 0. Unparseable → `null` **plus a warning**, never a silent `0` |
| Item price | `price` is the **line total, not the unit price**. Do not multiply by quantity. `unitPrice` is derived separately |
| Uncharged items | Lines with `displayStyle === "STRIKETHROUGH"` (out of stock) still carry a non-zero price nobody paid. They are excluded from the totals but kept in the export with `charged: false` |
| Discounts | `price` is already post-promotion. `originalLineTotal` (from `originalPrice`) and `discount` (a negative number) are preserved. If `promotionDescription` holds an amount (`"-2,50 €"`) that is used; otherwise the discount is `price - originalPrice`. Labels like `"-20%"` or `"2x1"` are not amounts and are not parsed |
| Cancellations | Read from `currentStatus.type` (`CanceledStatus`), not only from `recentlyCancelled` — that second field means "cancelled recently" and is empty on old orders. Cancelled orders have no `TOTAL`, so they are marked `excludedFromSpend: "cancelled"` and left out of the sums |
| Refunds | `refunded` is flagged, but the amount **stays in spend**: the API never says how much was returned, and `TOTAL` is what was actually charged. Refunds are reported on their own line rather than silently subtracted |

"Not charged" must be decided strictly by `displayStyle`, never by the `notice` text — that text is localized.

**Personal data is always stripped**: `points[]` (the `DELIVERY` point is your home address, the most sensitive field in the whole response), the `PAYMENT` block (card last-4), and HTML tags in `shortSummary`. None of it is needed for charts.

### Validation

For each order: `sum of charged items ≈ the PRODUCTS line` (1 cent tolerance). The result goes into `validation.productsMatch` and `validation.delta`.

What that means in practice matters. Mismatches are a **normal property of Glovo's data**, not a parser bug: in grocery orders items change after picking, and `notice` names the reasons outright — `"Price change"`, `"Product added"`, `"Not available"`. On a real 168-order export, 36 orders disagreed, from −1.35 € to +8.29 € in both directions. There is no hidden field holding the actually-charged item price — verified against the full field list.

So: **`PRODUCTS` and `TOTAL` are the source of truth**, because they are what was actually charged. Total spend is computed from `totals.total` and is correct. `productsMatch` reads as a data-quality flag for item-level charts.

## Stack

- **TypeScript** + **tsx** (no build step)
- **Playwright** — the only runtime dependency, needed for `launchPersistentContext`
- Argument parsing is the built-in `node:util` `parseArgs`; tests are the built-in `node:test`

Nothing else. The shared core lives in `src/core/` (`normalize.ts` + `types.ts`): zero runtime imports and zero node builtins, so the same code runs in Node and in a browser. The core is pure — fixtures in, objects out, no network — and is tested without a browser.

The Amazon reader lives in `src/amazon/`: `extract.ts` holds the functions that run inside the page, `locale.ts` the Spanish/English label tables, `normalize.ts` the mapping onto the shared order shape. The extractors are tested against synthetic HTML fixtures in a real Chromium; everything else without one.

## Install

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm run login
```

A browser window opens. You log in yourself. Afterwards the command prints the token's claims (`userId`, `grantType`, `role`, expiry) so you can confirm it is the account you meant.

```bash
npm run export -- --from 2025-01-01 --to 2026-12-31
```

Flags: `--out <path>` (default `out/glovo-orders-<year>-<year>.json`), `--expect-user <id>` — refuse to run if the session belongs to a different account.

Checks:

```bash
npm test
npm run typecheck
```

## Amazon

Amazon offers customers no order-history API, so this part is a **page reader**. It opens your order history in its own persistent Chromium, one page at a time, and reads the fields off the rendered HTML. The reading code runs *inside the page* (`page.evaluate`) and returns named fields only — ids, dates, amounts, titles, ASINs, quantities, seller names, status text. Node never receives the page itself.

```bash
npm run amazon:login                                          # sign in yourself in the window that opens
npm run amazon:probe                                          # loads one list page, prints counts only
npm run amazon:export -- --from 2025-01-01 --to 2025-12-31
```

Flags: `--marketplace amazon.es` (default; any `amazon.<tld>`), `--out <path>` (default `out/amazon-orders-<year>-<year>.json`), `--headless` (export only; off by default, see below). Run `amazon:probe` once before the first export: it tells you whether the session is alive, which language the pages come in, and whether every card on the page yielded an id, a date and a total.

### How it reads

- `/your-orders/orders?timeFilter=year-YYYY&page=N` for every year in the range, then `/your-orders/order-details?orderID=…` for every order dated inside it. One tab, sequential: 1 s between list pages, 1.5 s between orders. Three hundred orders take about ten minutes.
- **Headed on purpose.** Amazon may ask you to sign in again or show a check at any moment. After every page load the tool looks for the known challenge markers; on a hit it prints a message and waits up to five minutes for *you* to solve it in the window, then carries on. Nothing is ever solved, proxied or spoofed by the tool. `--headless` is for a session you already trust.
- **Localized pages.** `?language=en_US` is ignored on amazon.es (the site's own language cookie wins), so nothing is matched by position — every label goes through tables for Spanish and English in `src/amazon/locale.ts`: card headers, charge-summary rows (`Subtotal de producto(s)` / `Items`, `Envío` / `Postage`, `Importe total` / `Grand Total`, …), `Vendido por:` / `Sold by:`, cancellation and refund words, month names. Another language yields an `unsupported_locale` warning with the raw strings kept; adding a language is adding a table.
- **Same JSON shape as Glovo.** `store` is the seller (`Amazon` for first-party sales, the seller's id and name otherwise); `items[].asin` is added; `vertical` is `null`; `date` is a plain `YYYY-MM-DD`, because Amazon shows no time of day. `totals.products` / `delivery` / `total` come from the charge summary, `validation.productsMatch` compares `unitPrice × quantity` against the items subtotal with the same 1-cent tolerance.

### Never stored

The order page shows your name, shipping address, payment method, card digits and invoice links. **None of it reaches the export, and none of it reaches Node.** The list extractor skips the `Ship to` block outright; the detail extractor reads the charge rows and the item grid and never enters the box that holds the address, the buyer and the payment widget.

That is not a promise but a test: `test/amazon-extract.test.ts` loads a synthetic detail page that *deliberately contains* a fake name, street, `•••• 4242` and an invoice link, runs the real extractor on it in Chromium, and asserts that none of those strings survive. Verify your own first export without opening it:

```bash
grep -ciE 'enviar a|ship to|calle|street|visa|mastercard|••••|método de pago|payment' out/amazon-orders-*.json
```

Expect `0`.

`~/.glovo-export/amazon-profile` is a live Amazon session — the same rule as for the Glovo profile: never copy it, sync it or hand it over. Deleting the folder ends the session.

### Limitations

- Only what the order pages show. Orders without a detail page (digital purchases, some very old ones) are exported from the list card alone, with a `detail_unavailable` warning and items without prices.
- Archived orders are not read. Returns and refund amounts are unknown — `refunded` is a flag, spend keeps what was charged.
- `status` is the page's own text (`Entregado el 14 de marzo`, `Delivered 14 March`); it is kept as is. An order is `cancelled` only when every shipment says so; a partly cancelled one stays in spend with a `partial_cancellation` warning.
- Amazon changes its markup without notice. When a card yields no id or an unknown header label, the export warns (`missing_order_id`, `unmatched_header_label`) rather than guessing.

## Export format

```json
{
  "meta": {
    "source": "glovo",
    "exportedAt", "accountUserId", "grantType", "accountRole",
    "range", "ordersSeen", "ordersExported", "requestCount", "warnings": []
  },
  "orders": [{
    "id", "date", "store": { "id", "name", "slug" },
    "status", "cancelled", "refunded", "excludedFromSpend", "vertical", "currency", "summary",
    "items": [{
      "name", "quantity", "lineTotal", "originalLineTotal", "discount",
      "unitPrice", "charged", "notice", "customizations", "promotion", "freeProduct"
    }],
    "totals": { "products", "delivery", "total", "lines": [] },
    "validation": { "productsMatch", "delta" }
  }]
}
```

An Amazon export has `"source": "amazon"` and, instead of the account claims and `requestCount`, `marketplace` and `pagesLoaded`; its items carry an extra `asin`. Files without `source` are Glovo exports from before the field existed.

## Limitations

- It exports the history of **the account you logged in as**. If your orders are spread over several accounts (say, a password login and a Google login), export each one separately and merge on `id`.
- `--expect-user` compares the `userId` from the token. In the current token format the top-level claims are `role` / `payload` / `jti`, and `userId` sits inside `payload`, so it is unpacked separately. If no `userId` is found at all, the flag refuses to run rather than pretending it checked.
- A refund is flagged as `refunded`, but the API never reports the refunded amount — so no number is invented: spend keeps what was actually charged (`TOTAL`), and refunds are reported on a separate line.
- `out/` is in `.gitignore` — it is personal data and does not belong in a repository.

## Charts, offline

The repo ships `viewer.html` — a single file, no dependencies, no build.

```bash
open viewer.html      # macOS; xdg-open on Linux; on Windows just double-click
```

Drop your exported JSON onto the window. It computes: spend by month, restaurants vs groceries, top stores by spend, order size, time of day, what you order most, and a rough calorie estimate.

An Amazon export gets the same page with different splits: Amazon vs third-party sellers, top sellers by spend, what you buy most per seller. Time of day and the calorie cards are hidden — Amazon dates carry no time, and the calorie rules are grocery names.

### Calories — a guess, not a measurement

The last three cards estimate kcal, protein/fat/carbs, a better/worse split and a category breakdown. There is **no nutrition database behind it** and none is called: every number comes from keyword rules over the item name (`pollo` → 120 kcal/100 g, `pizza` → 280 kcal per unit, `cerveza` → 45 kcal/100 ml), with grams and millilitres parsed out of the name (`500 g`, `1,5 L`, `33 cl`) and a per-rule default when the name carries no amount.

So: items that match no rule count as **zero**, which is why the card shows how many items were recognised — the totals are a floor, not a total. Non-food lines (cleaning, pet food) are detected and excluded. Restaurant portions vary wildly. Read it as an order of magnitude, nothing more.

The rules are Spanish/Catalan keywords, matching the markets where Glovo operates. They are a plain array at the top of the `<script>` block in `viewer.html` — edit them for your own basket.

The page issues **zero network requests** — the file is read through `FileReader` and everything is computed in the browser. Verify it yourself: open the Network tab in devtools and drop the file.

## Privacy

- **Data never leaves your machine.** Neither the export nor `viewer.html` sends anything anywhere. This tool has no server.
- **The token never enters Node.** All API calls run inside the page via `page.evaluate`; the cookie is read by the browser, not by our process. The token is written neither to disk nor to logs.
- **The refresh token is never touched.**
- **Address and card are stripped during normalization** — `points[]` and the `PAYMENT` block never reach the export.
- **Amazon: name, address and payment method never leave the page.** The extractors return named fields only and skip the blocks that hold them; a test with a fake address and card checks that on every run. See [Never stored](#never-stored).
- **`~/.glovo-export/profile` is a live Glovo session, `~/.glovo-export/amazon-profile` a live Amazon one.** Never copy them, sync them to the cloud, or hand them to anyone: whoever holds that folder holds your account. Deleting the folder kills the session.
- The export (`out/*.json`) is personal data. `.gitignore` already covers it, but mind where you put the file.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

This project is not affiliated with, associated with, or endorsed by Glovo or Amazon. "Glovo", "Amazon" and their logos belong to their respective owners.

The tool runs **on your machine, under your own session**, and reads only your own orders — the same thing you would get by opening your order history in a browser and copying it out by hand. No access is handed to any third party (Glovo's terms §2.2 is about giving third parties access to your account). Using it is your call, and so is the responsibility for that.

The data comes from Glovo's internal API and from Amazon's order pages, both undocumented and free to change at any moment. When they do, the parser breaks — that is an expected property of a tool like this.

Amazon's Conditions of Use disallow automated access to its services without consent. This tool runs in your own browser, under your own session, at a human pace, and reads only your own orders — nothing a third party could not be given by you sitting at the keyboard. Whether that is acceptable to you is your decision, as it is for Glovo.
