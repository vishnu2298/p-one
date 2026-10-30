# Business, store and auction API (v1)

Base path `/api/v1`. JSON. Auth: `Authorization: Bearer <jwt>` (same login as the rest of the app). Money is **integer paise**.
Mutations that create money or stock records require an **idempotency key** (`Idempotency-Key` header or `idempotencyKey` field): replaying the same key returns the first result and changes nothing.
Errors: `{ "error": "plain-language message" }` with 400 validation, 401 auth, 403 role, 404 not found **or not your business** (tenants are indistinguishable from missing), 409 conflict, 429 rate limit.

Admin/operator routes use the header `x-postback-key: $AFFILIATE_POSTBACK_SECRET`.

## Workspaces and roles
| | |
|---|---|
| `GET /business-categories` | Categories for onboarding |
| `POST /businesses` | Create workspace (caller becomes **owner**; chart of accounts and main branch are seeded) |
| `GET /me/businesses` | Every workspace the user belongs to, with `role` and `permissions` (drives the app switcher) |
| `GET/PATCH /businesses/:id` | Read / update (owner, manager) |
| `GET/POST /businesses/:id/members`, `PATCH/DELETE …/members/:mid` | Team. Roles: manager, cashier, inventory, accountant, doctor, receptionist. Unknown phone/email → pending invite, claimed at sign-up |
| `GET/POST /businesses/:id/branches` | Branches |
| `GET /businesses/:id/dashboard` | Real KPIs (sales, profit, receivables, payables, stock value, low stock, expiring). Financial fields are omitted for roles without `reports.read` |
| `GET /businesses/:id/audit` | Audit trail |

Permission matrix: `backend/src/modules/perms.js`. `clinical.*` is owner + doctor only.

## Dynamic modules (the workspace builds itself)
Every business gets modules and custom record types from its category at creation (`gym` → Members + Enquiries; `repair` → Job cards; `rental` → Rental items + Bookings; `restaurant` → Tables + Reservations …). Older businesses get theirs lazily on first read.  
`GET /businesses/:id/modules` — built-in modules (`enabled`, `allowed` for this role) plus custom record types with their field definitions; this is what the sidebar renders  
`PUT /businesses/:id/modules/:key` `{enabled}` — switch a built-in module on/off (team stays on)  
`POST /businesses/:id/modules/suggest` `{description}` — proposes record types from a plain-language description. With `ANTHROPIC_API_KEY` set, Claude designs them (model `AI_MODULE_MODEL`, default `claude-haiku-5-5`); otherwise keyword templates. Output is untrusted and always normalised by `cleanEntity`. Creates nothing  
`POST /businesses/:id/entities` (one definition, or `{entities:[…]}`), `PATCH/DELETE …/entities/:key` — define, change, archive record types (≤20 per business, ≤30 fields). Field types: text, longtext, number, money (paise), date, select, checkbox, phone, email. A select named `status` becomes the workflow field  
`GET/POST …/entities/:key/records`, `GET/PATCH/DELETE …/records/:id`, `GET …/entities/:key/summary` — validated CRUD, search (`q`), status filter, counts and money totals. Permissions `records.read` / `records.write` (structure changes need `modules.manage`: owner only)

## Catalogue, stock, purchasing
`POST/GET /businesses/:id/products`, `PATCH …/products/:pid` (price, GST bps, HSN, batches, serials, reorder level, `published` for the storefront)  
`GET …/inventory`, `…/inventory/low-stock`, `…/inventory/expiring`, `…/inventory/valuation`, `…/inventory/movements`  
`POST …/inventory/adjust` (damage, loss, found, count) · `POST …/inventory/transfer` · `POST …/inventory/reconcile`  
`POST/GET …/suppliers`, `POST …/suppliers/:sid/payments` · `POST/GET …/purchase-orders` · `POST/GET …/goods-receipts` (GRN: updates stock and weighted-average cost, books payable) · `POST …/purchase-returns`  
Every stock change goes through one function that writes an immutable movement row; stock value always equals the inventory account.

## Sales (POS)
`POST …/sales` — tax-inclusive invoice, split / part / credit payments, stock deduction, COGS and journal entries in one transaction. Requires an idempotency key (the app queues offline bills and replays them).  
`GET …/sales`, `GET …/sales/:iid` · `POST …/sales/:iid/payments` · `POST …/sales/:iid/returns` · `GET …/customers`, `POST …/customers`, `…/customers/:cid/payments` (khata)  
`GET /invoices/public/:token` — shareable read-only invoice page (WhatsApp / print to PDF).

## Accounting
Double-entry, `source_key`-idempotent, never edited (corrections are reversals).  
`GET …/reports/{profit-loss,balance-sheet,trial-balance,cash-flow,tax,general-ledger,outstanding}` · `GET/POST …/expenses` · `POST …/capital` · `POST …/journal-entries/:id/reverse` · `POST …/periods/:yyyy-mm/close`

## Online shop and appointments
Public: `GET /stores`, `GET /stores/:slug`, `GET /stores/:slug/slots?serviceId&date`  
Buyer: `POST /stores/:slug/orders` (stock is **reserved**; online payment confirms through the verified webhook and creates the invoice once), `GET /me/store-orders`, `POST /me/store-orders/:id/cancel`, `POST /stores/:slug/appointments`, `GET /me/appointments`, `POST /me/appointments/:id/cancel`, `POST /stores/:slug/reviews`  
Owner: `PATCH …/storefront`, `GET …/store-orders`, `POST …/store-orders/:id/status`, services and staff availability (`…/services`, `…/staff-availability/:memberId`), `GET/PATCH …/appointments`, `POST …/appointments/:id/complete` (bills the visit, deducts consumables)  
Clinical notes: `POST/GET …/customers/:cid/clinical-notes` — AES-256-GCM at rest, consent required, every read audited, doctor/owner only.

## Auctions
Lifecycle: `DRAFT → PENDING_APPROVAL → SCHEDULED → REGISTRATION_OPEN → REGISTRATION_CLOSED → LIVE → ENDED → PAYMENT_PENDING → SOLD → SETTLED`, plus `UNSOLD`, `CANCELLED`, `DISPUTED`, `PAYMENT_DEFAULTED`. Transitions are enforced by one table; time-driven ones run from durable idempotent jobs and lazily on read.

Seller: `POST /auctions` · `PATCH /auctions/:id` (only while DRAFT) · `POST …/submit` · `…/pause` · `…/cancel` · `POST …/amendments` + `…/amendments/:aid/vote` (every registered bidder must consent, silence is refunded) · `POST …/ship`  
Bidder: `GET /auctions?tab=live|upcoming|ended` · `GET /auctions/:id` · `POST …/register` (fee + deposit intent) · `DELETE …/register` · `POST …/bids` · `POST …/buy-now` · `GET …/state?after=<seq>` (poll + catch-up) · `GET …/stream` (SSE) · `POST …/pay` · `POST …/confirm-delivery` · `POST …/dispute` · `GET /me/auctions`, `/me/auction-registrations` · `GET …/ledger`  
Admin: `GET /admin/auctions`, `POST /admin/auctions/:id/{approve,reject,cancel,resolve}`, `GET /admin/auctions/:id/ledger`

Bidding is authoritative on the server: a bid is accepted inside one `BEGIN IMMEDIATE` transaction with a gapless sequence number; a bid placed in the last `antiSnipe.windowS` seconds extends the end (capped). Bidders are masked (`Bidder 3`). The auction ledger (registration fees, deposits held/released/forfeited/applied, winner payment, refunds, seller payout, commission, gateway fees) is separate from the business books and `ledgerSummary.balanced` must hold.

## Payments and webhooks
`POST /webhooks/:provider` — raw body, **HMAC verified**, replay-safe (event id stored). `POST /payments/:id/simulate` exists only with the `test` provider and drives a *signed* webhook through the real path. Razorpay is enabled by setting `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.  
`GET /admin/jobs` — job stats and failures.

## Configuration
`AUCTION_COMMISSION_BPS` (default 500), `AUCTION_GATEWAY_FEE_BPS`, `AUCTION_ALLOW_FORFEIT`, `AUCTION_AUTO_APPROVE=1` (demo/tests; otherwise an operator approves), `FEATURES` (comma list to switch modules off), `DB_FILE`.
