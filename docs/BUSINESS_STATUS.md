# Business and auction modules: what is done, what needs outside help

Verified by `cd backend && npm test` (68 tests) and by driving the real app in a browser against the seeded demo (`npm run demo`).

## Done and tested
- **One identity, three systems**: marketplace, scheduled auctions, business management; one login, a workspace switcher driven by `/me/businesses`.
- **Business**: onboarding, roles and permission matrix, branches, invites claimed at sign-up, audit log, feature flags.
- **Inventory**: immutable stock ledger, weighted-average cost, batches with expiry (FEFO), serials, reservations, transfers, adjustments, reconciliation, valuation that always equals the books.
- **Purchasing**: suppliers, purchase orders, goods receipts (idempotent), supplier payments, purchase returns.
- **POS and sales**: tax-inclusive GST invoices, split / part / credit payments, returns with exact rounding, customer khata, shareable invoice link, **offline bill queue** that replays with idempotency keys.
- **Accounting**: double-entry with idempotent posting, trial balance, P&L, balance sheet, cash flow, GST summary, ledger, outstanding, expenses, capital, reversals, period close. Trial balance and balance sheet are asserted balanced in tests.
- **Online shop**: public stores, reservation-based orders, verified-webhook payment → one invoice, pay-at-store with hold expiry, refunds on late payment, reviews.
- **Appointments / clinic**: services, staff availability (IST), conflict-free booking, completion billing with consumables, encrypted clinical notes with consent and audited reads.
- **Auctions**: state machine, registration fee + refundable deposit via verified payments, race-free bidding (one winner under concurrent bids, gapless sequence), anti-sniping with cap, buy-now, reserve, settlement, runner-up offer, default handling, refunds, amendments needing bidder consent, disputes, separate conserving ledger, SSE + catch-up polling.
- **Scenarios A–F** (auction purchase, auction default, retail shop, marketplace→POS, clinic, multi-employee) are automated tests.
- **App screens (real APIs, with loading / empty / error / offline states)**: business hub and dashboard, products, stock, POS, sales and invoice, customers, purchases, reports, expenses, team, online-shop settings and orders, appointments, auctions (list, detail, registration payment, live bidding room, checkout, delivery, dispute, create, manage), local shops (browse, cart, checkout, booking), my shop orders. A "Create" menu on the centre tab offers sell, auction or business.

- **Dynamic modules**: categories map to module sets and custom record types; owners can describe their business to get suggestions (Claude-designed when `ANTHROPIC_API_KEY` is set, templates otherwise), build record types by hand, switch built-in modules on/off. Records are validated server-side, tenant-isolated and role-gated (6 tests).
- **Business web app** (`business-web/`): login, onboarding, dashboard, billing with offline queue, sales and invoices, products, stock, purchases, customers, reports with date range and print, expenses, team, online shop, appointments, generic record pages and the Modules designer. Checked in a real browser at desktop and phone width.

## Needs credentials, approval or legal review (cannot be done from here)
| Item | Why |
|---|---|
| **Razorpay (or another gateway) live keys and webhook secret** | Needs a merchant account and KYC. The adapter and signature check are written; the `test` provider stands in. |
| **Payouts to sellers / refunds to bank** | Needs RazorpayX or bank API onboarding. Payouts are recorded in the ledger as `seller_payout` but no money moves. |
| **Legal review of auction terms** | Forfeiting deposits, registration fees, and consent to amendments must be reviewed by counsel. Forfeit is **off** unless `AUCTION_ALLOW_FORFEIT` is set. |
| **GST e-invoicing / e-way bill** | Needs GSP credentials and the government sandbox. Invoices carry GSTIN, HSN and tax splits ready for it. |
| **Medical data compliance** | Clinical notes are encrypted and audited, but certification (DPDP, clinic regulations) needs a compliance review. Set a real `CLINICAL_KEY` (env) in production. |
| **WhatsApp / SMS delivery** | Share links use the `wa.me` deep link; automated messages need an approved Business API account. |

## Known gaps (honest list)
- Rentals ("Book Now") from the reference design are not built.
- FIFO costing (weighted average only). Product variants are modelled by `parent_id` but there is no variant editor.
- Offline queue covers POS bills only (not stock adjustments or expenses), and there is no conflict-resolution screen.
- No admin web UI: operators use the `/admin/*` routes.
- Auctions poll every 1.5 s in the app (SSE is available on the API for web clients).
- The mobile app's reports have no date picker (the web app does). The mobile app does not yet render custom record types; the web app does.
- Custom record types have no relations between them (a booking stores the item name, not a link), no formulas or automations, and no per-type permissions.
- The Connectly (buy/sell) web build keeps the phone-width frame on desktop.
