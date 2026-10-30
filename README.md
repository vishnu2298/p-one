# Connectly: Buy • Sell • Connect

A marketplace and community app for buying and selling locally and connecting with people nearby.
Designed to be **simple enough for older users**: large text, high contrast, 56 px tap targets,
labelled icons, plain language, and a built-in text-size setting (Normal / Large / Extra large).

| Part | Stack | Path |
| --- | --- | --- |
| Mobile app (iOS, Android, web) | React Native (Expo SDK 58), TypeScript, React Navigation | [`mobile/`](mobile) |
| Primary API | Node.js, Express, SQLite (`node:sqlite`), JWT auth | [`backend/`](backend) |
| Supporting service | Python, FastAPI (scam moderation and price guidance) | [`services/insights/`](services/insights) |

## Features

- **Accounts**: register, log in, change password, delete account (app-store requirement), profile with photo, bio, interests, city.
- **Buy**: category browsing, search, filters (category, city, price band), sorting (newest, nearest, price), pagination, saved items, item details with photo gallery, **Buy Now** requests.
- **Sell**: photo upload (gallery or camera), category, condition, price with **price guidance** from the Python service, edit, mark sold or relist, delete.
- **Orders**: buyer request → seller accepts or declines → handover → completed → two-way ratings and reviews. Payment is in person at handover; nothing is charged in the app.
- **Messaging**: item-linked chats, quick replies, share location, unread badges, message requests via connections.
- **Connect**: people nearby (sorted by distance), interest filters, connection requests, my connections.
- **Trust and safety**: verified badges, ratings, report listing or person, block, safety tips, scam detection (advance payment, OTP requests, gift cards and similar) that blocks risky listings and warns in chat.
- **Phone OTP and Google sign-in** (Firebase), alongside email. First-time phone users finish a one-step profile.
- **Push notifications** (FCM) plus an in-app inbox: messages, buy requests, order updates, connection requests, reviews, invites. Per-user on/off.
- **Deals by default**: Home and a Deals screen show affiliate products from Google Shopping (SearchAPI), cached and clearly marked as ads.
- **Affiliate tracking**: every "View deal" tap creates a tracked click, redirects with your affiliate tag, and conversions come back through a postback.
- **Invite friends and family**: personal code and link, WhatsApp, SMS to contacts picked on the phone, share sheet. Invitees who join are auto-connected.
- **Brand partners**: sponsored placements and a brand dashboard. See *Business model*.
- **Smooth feel**: skeleton loaders, gentle fade-ins, friendly toasts instead of pop-ups, warm colours and plain wording.
- **Accessibility**: adjustable text size, high contrast palette, screen-reader labels, large touch targets, no gesture-only actions.

## Quick start

Requirements: Node 22.13+, Python 3.10+.

```bash
./dev.sh                                  # API on :4000, insights service on :5000 (seeds demo data on first run)
cd mobile && npm install && npx expo start  # press w (web), a (Android) or i (iOS), or scan with Expo Go
```

Demo login: `demo@connectly.app` / `demo1234`. Other seeded users: `rohit@`, `sneha@`, `arun@`, `divya@` … `@connectly.app`, same password.

The app finds the API automatically (`localhost:4000` on web/iOS simulator, `10.0.2.2:4000` on the Android emulator).
On a physical phone set your computer's address: `EXPO_PUBLIC_API_URL=http://192.168.x.x:4000 npx expo start`.

### Docker

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build   # API :4000, insights :5000
```

## Tests

```bash
cd backend && npm test                          # 23 end-to-end API tests (in-memory DB)
cd services/insights && python -m pytest -q     # moderation and price-hint tests
cd mobile && npx tsc --noEmit                   # type check
```

## API overview

`POST /auth/register|login` · `GET|PATCH|DELETE /me` · `GET /categories` · `GET|POST /listings` · `GET|PATCH|DELETE /listings/:id` ·
`POST /listings/:id/status|favorite` · `GET /search` · `GET|POST /orders` · `POST /orders/:id/accept|decline|cancel|complete|review` ·
`GET|POST /conversations` · `GET|POST /conversations/:id/messages` · `GET /people` · `POST /connections` ·
`GET /connections/requests` · `POST /connections/:id/respond` · `GET /users/:id` · `POST /reports` · `POST|DELETE /blocks/:userId` · `POST /uploads`.

## Business model

Connectly is a **mediator and is free for individuals**: buying, selling, chatting and connecting never cost a person anything.
Revenue comes only from businesses and partners, in three streams, all recorded in one `revenue_events` ledger:

| Stream | How it works | Who pays |
| --- | --- | --- |
| **Ads** | Brand partners run *Sponsored* cards on Home and Deals. Cost per click with a daily budget cap; repeat taps within 10 minutes and a brand tapping its own ad are not charged. | Brands |
| **Affiliate** | "View deal" goes through `/go/:clickId`, which adds your affiliate tag. Networks report sales to `/affiliate/postback`. | The merchant network, not the shopper |
| **Brokerage** | A commission (default 5%, per-brand `commission_rate`) on deals a **brand** seller completes. Individuals are charged 0, enforced in code and tested. | Brands |

Operators read totals with `GET /admin/revenue` (header `x-postback-key: $AFFILIATE_POSTBACK_SECRET`). Brands see their own spend and fees in the app (Profile → Brand hub). Invoicing and payment collection are not built; amounts are tracked so you can bill them.
Sponsored and affiliate items are always labelled ("Sponsored", "Ad") with a commission disclosure.

## Setup: Firebase (phone OTP, Google, push)

Without Firebase the app runs in **demo mode** when the API has `FIREBASE_DEV_MODE=1` (phone code is always `123456`, a stand-in replaces the Google picker). Real setup:

1. Create a Firebase project; enable **Authentication → Phone** and **Google**. Add Android/iOS/Web apps.
2. **API**: set `FIREBASE_PROJECT_ID` (verifies sign-in tokens) and `FIREBASE_SERVICE_ACCOUNT_JSON` (sends push). Remove `FIREBASE_DEV_MODE`.
3. **Web**: put the web config in `mobile/.env` (`EXPO_PUBLIC_FIREBASE_*`, see `.env.example`). Add your domain under Authentication → Authorized domains.
4. **Android / iOS**: download `google-services.json` / `GoogleService-Info.plist` into `mobile/`, set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, add your SHA-1/SHA-256 fingerprints, then build a development client (`npx expo prebuild && npx expo run:android`, or EAS). **Phone auth, Google sign-in and push do not work in Expo Go** because they need native modules.
5. iOS push also needs an APNs key uploaded in Firebase → Cloud Messaging.

## Setup: affiliate products and tracking

- `SEARCHAPI_KEY` enables live products from SearchAPI's `google_shopping` engine. Results are cached (`PRODUCT_CACHE_HOURS`, default 12) and the default feed rotates through a few queries per day, so credit use stays small. Without a key, non-production servers show clearly flagged sample products.
- Merchant URLs are never sent to the app; the app asks the API for a tracked link. Tags: `AMAZON_TAG`, `FLIPKART_AFFID`, or any network via `AFFILIATE_NETWORKS` (query-param rules or deep-link wrapper templates such as Cuelinks/Skimlinks style).
- **Conversions**: the tracker is built in and self-hosted (click log, sub-id pass-through, idempotent postback). Point a network's postback at
  `GET /affiliate/postback?key=SECRET&click_id={sub_id}&order_id={order}&amount={sale}&commission={payout}&status=approved`.
  `GET /affiliate/report` gives clicks, conversions and rate by merchant. If you prefer a dedicated open-source tracker (for example Prosper202 or refearnapp), run it and have it forward conversions to this postback URL.
- Google Shopping often returns Google product pages rather than merchant pages; tags only apply to links that point at the merchant, so use a deep-link wrapper network for those.

## Invites

`GET /invites` returns the user's code, share link (`/i/CODE` landing page that opens `connectly://invite/CODE`) and message. New users enter or auto-receive the code at sign-up (phone, Google or email). Contact numbers are read on the phone to open the SMS composer and are never uploaded; the server only counts invites sent.

## Design notes and known limits

- **Not verified against live services from this build environment**: real Firebase tokens/FCM, SearchAPI responses (the parser tolerates field-name variants but was tested against a stub), and native iOS/Android builds. The dev-mode path, the Android JS bundle and all server logic are tested.
- Web push is not implemented (the in-app inbox works on web).

- The API degrades gracefully: if the Python service is down, moderation and price hints are skipped rather than failing requests.
- Chat uses 3-second polling, which keeps the backend stateless and simple. WebSockets (or push via FCM/APNs) are the next step for scale.
- SQLite suits a single instance. For multiple instances, move to PostgreSQL (the SQL is portable) and object storage for uploads.
- Phone and Google sign-in mark an account verified (a phone number was proven). Government-ID verification is not built.
- No online payments: deals are settled in person. A payment gateway would need merchant credentials.
- Set `JWT_SECRET` in production; the API refuses to start with the default secret, or with `FIREBASE_DEV_MODE=1`, when `NODE_ENV=production`.
