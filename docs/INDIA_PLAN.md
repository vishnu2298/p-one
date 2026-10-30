# Connectly for India: plan

Goal: a buy, sell and connect app that an 65-year-old in Madurai and a 22-year-old in Pune can both use without help, that earns only from brands, ads and affiliates, and that is legal to run in India.

## 1. What works in India (and what we do about it)

| Reality | Decision | Status |
| --- | --- | --- |
| Phone number is the identity; many users have no email | Phone OTP first (+91 default), Google second, email last | done |
| Regional languages matter for older users | Deferred by decision: the app ships **English only**. Hindi and Tamil dictionaries are written and parked in `mobile/src/locales`; enabling them is a small change | later |
| Bargaining is normal | **Make an offer** on any item; seller accepts or declines | this round |
| Cash and **UPI** settle almost every local deal | Seller adds a UPI ID; after the seller accepts, buyer gets a **Pay with UPI** button (opens GPay/PhonePe/Paytm). Money goes buyer to seller directly; Connectly never holds funds, so no payment licence is needed | this round |
| People want to call before meeting | After a deal is accepted both sides see each other's phone with **Call** and **WhatsApp** buttons. Numbers stay hidden until then | this round |
| WhatsApp is the sharing network | Share any item to WhatsApp via a rich link page (`/l/:id`); invites already use WhatsApp | this round |
| Price words: lakh and crore | ₹1.2 Lakh / ₹2.5 Cr on cards, full amount on details | this round |
| Patchy 3G/4G | Compressed photos, skeleton loaders, request timeouts with retry, offline banner, cached deals | this round |
| 2 to 4 GB phones | No heavy native animation libraries; motion is GPU-friendly opacity/transform only | this round |
| Families share phones and help each other | Large text setting, big targets, plain words, family invites with auto-connect | done |
| Local communities (RWA, hobby, city) | **Groups** with group chat; seeded city and interest groups | this round |
| Photos in chat (WhatsApp habit) | Image messages | this round |

## 2. Legal and compliance (India)

| Law / rule | What we do | Status |
| --- | --- | --- |
| **DPDP Act 2023** (consent, access, erasure) | Explicit consent checkbox at sign-up (stored with version and time), Privacy Policy screen, **data export** (`GET /me/export`), account deletion, contacts never uploaded | this round |
| **IT Rules 2021** (intermediary) | Terms, Grievance Officer page (name and email from env), report flow, **operator takedown tools** (review reports, remove listing, suspend user), prohibited-items filter | this round |
| **Consumer Protection (E-Commerce) Rules 2020** | Seller name and city shown, clear price, no hidden fees, grievance contact | this round |
| **ASCI** advertising disclosure | "Ad" and "Sponsored" labels, commission note | done |
| **GST** | Brand invoices show 18% GST on ad spend and brokerage; optional brand GSTIN (validated) | this round |
| Payments (RBI) | No wallets or escrow; direct UPI only | by design |
| Aadhaar | Never collected or stored | by design |

Legal text is a good-faith template. **Have a lawyer review it before launch.** Company name, address and grievance officer are placeholders set by env vars.

## 3. Motion and feel

One motion language, all on opacity and transform so it stays smooth on cheap phones:
- **Enter**: content fades and rises (staggered), screens slide natively.
- **Press**: 3% scale-down with haptic tick on key actions.
- **Delight**: heart pops with a spring, tab icons bounce, confetti when a listing goes live or a deal completes.
- **Continuity**: segmented controls slide a pill, parallax on item photos, rotating search suggestions, animated splash.
- **Calm**: skeletons not spinners, toasts not pop-ups, no motion when the phone asks for reduced motion.

## 4. Remaining and later (not in this round)
Web push, wallet or escrow, video listings, delivery partners, more languages (Telugu, Kannada, Malayalam, Bengali, Marathi: add one file each), saved searches, Aadhaar-based or DigiLocker verification (needs a licensed provider), GST invoicing PDFs.

## 5. Launch checklist
1. Firebase: enable Phone and Google, add Android SHA-1/SHA-256, add configs, rotate the shared keys.
2. Allow `www.searchapi.io` and confirm live deals.
3. Set `GRIEVANCE_*`, `COMPANY_*`, `PUBLIC_URL`, `INVITE_BASE_URL`, store links.
4. Lawyer review of Terms and Privacy.
5. Move SQLite to PostgreSQL when you run more than one API instance.
6. Build with EAS (`eas.json` included), test on a real low-end Android.
