# Connectly Business and Auctions: implementation plan

Inspection result: the repo is a monolith. API = Node/Express + SQLite (`node:sqlite`) in `backend/`, Python FastAPI helper in `services/insights`, React Native (Expo) app in `mobile/` with React Navigation, auth via JWT (+Firebase), notifications/push, brand ads, orders, chat, groups. All of that stays. New work is added as **modules** next to it and mounted under `/api/v1`.

## Decisions
| Topic | Decision |
| --- | --- |
| Architecture | Modular monolith: `backend/src/modules/{schema,core,perms,jobs,payments,accounting,business,inventory,purchasing,sales,storefront,services,auctions}.js`, each with a service layer (pure functions over `db`) and a thin router. Domains can be split later. |
| Database | Stays SQLite. Money in new modules is **integer paise** (`*_paise`), tax in basis points. Writes are serialised with `BEGIN IMMEDIATE` transactions (nested via savepoints), which is what makes bid ordering and stock deduction race-free. Moving to PostgreSQL later means swapping `core.tx` and the SQL dialect; the invariants are expressed in transactions and unique keys, not in SQLite quirks. |
| Tenancy | Every business table carries `business_id`; one middleware (`requireBiz(permission)`) resolves membership + role and every query filters by it. |
| Ledgers | Stock: immutable `biz_stock_movements` + projected `biz_stock_balance`. Accounting: double-entry `biz_journal_entries/lines`, never edited, corrected by reversal entries. Auctions: append-only `auction_ledger`, refundable deposits kept apart from revenue. |
| Idempotency | Unique idempotency keys on bids, sales, receipts, supplier payments, store orders, webhooks; retried requests return the original result and never double-deduct stock or double-post. |
| Payments | Provider adapter. `razorpay` (orders, HMAC-verified webhooks, refunds, reconciliation) when keys are set; `test` provider otherwise, whose "success" still travels through the same signed-webhook code path (never frontend-reported). No card data touches our servers. |
| Real-time | Server-sent events per auction (`/api/v1/auctions/:id/stream`) plus an `after=seq` catch-up endpoint; the mobile app polls that endpoint because React Native has no `EventSource`. |
| Jobs | Durable `jobs` table + in-process worker (claim, run, retry with backoff, dedupe keys), plus a sweeper that re-derives overdue auction transitions, so a missed job self-heals. Handlers are idempotent. A queue (BullMQ/SQS) can replace the worker without changing handlers. |
| Costing | Weighted-average inventory costing. FIFO is **not** implemented (config key reserved). |
| Feature flags | `FEATURES` env (`business,auctions,storefront,services`), all on by default in dev. |

## Phases (all four are implemented to the depth noted in docs/BUSINESS_STATUS.md)
1. Core: business onboarding, roles, products, inventory ledger, purchases, POS, invoices.
2. Finance: expenses, balances, double-entry accounting, P&L, balance sheet, trial balance, cash flow, GL, tax and aging reports.
3. Auctions: lifecycle state machine, registration with verified payments, authoritative bidding, anti-sniping, settlement, default handling, refunds, ledger.
4. Ecosystem: staff permissions, branches, public storefront with stock reservation, appointments and clinic billing with isolated encrypted notes, offline POS queue.

## Out of scope or needing external parties
Live Razorpay credentials and approval, bank payouts to sellers (payout is recorded, transfer needs a payout provider), real GST e-invoicing, FIFO costing, rentals, legal review of auction terms and deposit forfeiture, medical-data compliance sign-off.
