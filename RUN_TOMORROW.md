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

## Ten-minute test tour

1. First launch asks for a **language** (English, हिन्दी, தமிழ்). Change it later in Settings.
2. Welcome: tick the **consent** box, then phone sign-up with code 123456, then pick your city (try typing "madu").
3. Home: rotating hero banner, **Today's deals** (sample products until SearchAPI is reachable), a **Sponsored** card.
4. Buy: open an item, **Buy Now**, use the **-10%** offer chip, send. Log in as the seller (demo@...) in a second browser window, Orders, **Accept**.
   Back as the buyer: Orders now shows **Call, WhatsApp and Pay with UPI**. Seller taps **Item handed over** for confetti and a review prompt.
5. Sell: the orange + button, add a photo, price (a price hint appears), **List item**; try "pistol" in the title to see the safety block.
6. Connect: People, Connected and **Groups** (join "Chennai Bike Riders" and post). Chat supports photos and location.
7. Profile: Invite friends and family, **Selling as a business?** (brand hub with GST), Settings (text size, language, **Download my data**, Terms and policies).
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
