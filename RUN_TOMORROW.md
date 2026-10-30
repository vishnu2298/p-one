# Run it tomorrow: step by step

## Fastest way: just look at it

```bash
cd backend && npm install && npm run demo      # then open http://localhost:4000
```

One process serves the app and the API with demo data (see README, docs/screens and docs/APK.md). The rest of this page is the full three-terminal setup.

## What you need open (3 terminals)

```bash
# 1. Python service (scam and prohibited-content checks, price hints)
cd services/insights && pip install -r requirements.txt && python -m uvicorn app:app --port 5000

# 2. API (loads backend/.env automatically; seeds demo data the first time)
cd backend && npm install && npm start            # http://localhost:4000

# 3. App
cd mobile && npm install && npx expo start --web   # opens in the browser
```

Phone instead of browser: run `npx expo start`, install **Expo Go**, scan the QR code, and set the API address first:
`EXPO_PUBLIC_API_URL=http://<your-computer-ip>:4000 npx expo start`. In Expo Go, phone OTP and Google use the **demo mode** below
(real Firebase phone/Google/push need a development build: `npx expo prebuild && npx expo run:android`, see README).

## Logins and demo mode

`backend/.env` has `FIREBASE_DEV_MODE=1`, so you can try everything without Firebase client setup:
- Phone: any number, code **123456**. Google: type any Gmail address (demo stand-in).
- Email demo account: `demo@connectly.app` / `demo1234` (also rohit@, sneha@ (a brand), arun@, divya@, priya@ ... same password).

To use **real** Firebase: delete `FIREBASE_DEV_MODE=1`, enable Phone and Google in the Firebase console, add `EXPO_PUBLIC_FIREBASE_*` (web) to `mobile/.env`
(see `mobile/.env.example`) and the Android/iOS config files. Rotate the keys you shared in chat first.

## New: business, auctions and local shops

Demo data now includes **Lakshmi Provision Stores** (owner: `demo@connectly.app`; cashier `arun@connectly.app`; inventory `priya@connectly.app`), **Care Family Clinic** (owner priya, doctor divya) and three auctions (one live now). Set `AUCTION_AUTO_APPROVE=1` to skip operator approval for auctions you create.
- Profile > **My business**: dashboard, billing (POS), products, stock, purchases, customers, reports, team, online shop, appointments. Sign in as `arun@` to see the cashier's reduced menu.
- Home > **Auctions**: open the live Canon auction, register for the teak table (test payment, no real money), place bids.
- Home > **Local shops**: order from Lakshmi (pay now uses the test provider) and watch it appear under My business > Online shop.
API reference: `docs/API.md`. What is done and what needs outside parties: `docs/BUSINESS_STATUS.md`.

## Ten-minute test tour

1. First launch is a single **welcome** screen. Tick the **consent** box, choose phone, enter code 123456, then your name and city (try typing "madu").
2. Notice the glass look: aurora background, translucent cards, blurred headers, floating tab bar.
3. Home: rotating hero banner, **Today's deals** (sample products until SearchAPI is reachable), a **Sponsored** card.
4. Buy: open an item, **Buy Now**, use the **-10%** offer chip, send. Log in as the seller (demo@...) in a second browser window, Orders, **Accept**.
   Back as the buyer: Orders now shows **Call, WhatsApp and Pay with UPI**. Seller taps **Item handed over** for confetti and a review prompt.
5. Sell: the orange + button, add a photo, price (a price hint appears), **List item**; try "pistol" in the title to see the safety block.
6. Connect: People, Connected and **Groups** (join "Chennai Bike Riders" and post). Chat supports photos and location.
7. Profile: Invite friends and family, **Selling as a business?** (brand hub with GST), Settings (text size, **Download my data**, Terms and policies).
8. Turn your Wi-Fi off briefly: the **offline banner** slides in and leaves by itself.

## Operator tools (uses AFFILIATE_POSTBACK_SECRET from backend/.env)

```bash
KEY=$(grep AFFILIATE_POSTBACK_SECRET backend/.env | cut -d= -f2)
curl -H "x-postback-key: $KEY" localhost:4000/admin/revenue          # ads + affiliate + brokerage totals
curl -H "x-postback-key: $KEY" localhost:4000/admin/reports          # open user reports
curl -X POST -H "x-postback-key: $KEY" -H 'content-type: application/json' \
  -d '{"action":"remove_listing"}' localhost:4000/admin/reports/1/resolve   # or dismiss / suspend_user
curl -H "x-postback-key: $KEY" localhost:4000/affiliate/report       # clicks and conversions
```

## Known limits tonight

- Live deals need `www.searchapi.io` reachable from where the API runs (it was blocked in the build sandbox).
- Real SMS OTP, Google and push need your Firebase console setup and a development build.
- Legal text is a template: have a lawyer review it, and set the `COMPANY_*` and `GRIEVANCE_*` values in `backend/.env`.
