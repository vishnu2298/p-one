# Running Connectly on Cloudflare

Short version: **the two web apps go on Cloudflare Pages today, the API stays a Node process behind a Cloudflare Tunnel, and the database is backed up to R2.** Moving the API itself onto Workers is possible but is a rewrite, and I would not do it before launch (reasons below).

## Startup credits
Cloudflare runs a startup programme with credits, applied for at <https://www.cloudflare.com/forstartups/>. Eligibility, amounts and which products the credits cover change, so check the page and the terms when you apply. Nothing in this repo depends on the credits.

## Layout
| Piece | Where | Why |
|---|---|---|
| Connectly app (buy, sell, connect), web build | **Pages** project `connectly-app` | static files |
| Connectly Business web app | **Pages** project `connectly-business` | static files |
| API (Express + SQLite, scheduled jobs, SSE) | any Docker host, exposed with **Cloudflare Tunnel** | needs a long-running process and a disk |
| Database backups | **R2** via Litestream (`deploy/litestream.yml`) | cheap, S3-compatible |
| DNS, TLS, WAF, rate limiting in front of the API | Cloudflare proxy | free tier |

## Steps
1. **API.** Build `backend/Dockerfile`, run it with a persistent volume on `/data` and set `JWT_SECRET`, `AFFILIATE_POSTBACK_SECRET`, Firebase and SearchAPI keys as environment variables (never in git). Set `CORS_ORIGINS=https://app.example.com,https://business.example.com`.
2. **Tunnel.** On that host: `cloudflared tunnel create connectly`, route `api.example.com` to `http://localhost:4000`. No inbound ports are opened.
3. **Pages.** `export CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=…` then `API_URL=https://api.example.com ./deploy/cloudflare/deploy.sh`. It builds both apps against your API address and deploys them. Attach your own domains in the Pages dashboard.
4. **Backups.** Create an R2 bucket and an R2 API token, then run the API under Litestream with `deploy/litestream.yml`. Test a restore once.
5. **Edge protection.** Add a rate-limiting rule for `/auth/*` and `/api/v1/auctions/*/bids`, and turn on Bot Fight Mode. The API already rate-limits, this is a second layer.

## Why not move the API to Workers + D1 now
- The API uses synchronous `node:sqlite` in hundreds of places and relies on **real transactions** for money: stock moves, double-entry posting, and the auction bid (`BEGIN IMMEDIATE`, gapless sequence). D1 does not offer interactive transactions across statements, so those guarantees would have to be rebuilt.
- Scheduled jobs, SSE streams and webhooks would need Queues, Cron Triggers and Durable Objects.
- **The path I would take later:** one **Durable Object with SQLite storage per business** (tenant isolation for free, serial access, synchronous `transactionSync`) and one per auction (the bid sequencer). It fits this design well, but it is a multi-week port and the test suite (74 tests) is what makes it safe. Do it after you have users, not before.
- **Cloudflare Containers** can run the existing Docker image unchanged, but check its current status and pricing, and note container disks are ephemeral, so you would still need Litestream to R2 for the database.

## Images (R2)
Uploads currently go to local disk (`UPLOAD_DIR`). On a single host that is fine with the volume above. If you scale to several API instances, switch uploads to R2 (S3-compatible API); that is a small change in `routes/upload` and not needed for one instance.
