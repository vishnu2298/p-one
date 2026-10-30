# Getting an Android APK

An APK needs the Android toolchain or Expo's build service, neither of which was reachable from the build sandbox, so no APK is bundled. Two ways to get one:

**Cloud build (easiest, free Expo account)**
```bash
cd mobile
npm install
npx eas-cli login
EXPO_PUBLIC_API_URL=https://YOUR-API-HOST npx eas-cli build -p android --profile preview   # outputs an installable .apk link
```
The app needs to reach your API, so point `EXPO_PUBLIC_API_URL` at a public URL (for example a tunnel such as `cloudflared tunnel --url http://localhost:4000`) or your computer's Wi-Fi address (`http://192.168.x.x:4000`). Real phone OTP, Google sign-in and push also need the Firebase files described in the README; without them the build still works in demo mode.

**Local build** (needs Android Studio and JDK 17): `cd mobile && npx expo prebuild && npx expo run:android --variant release`.

This path is configured (`eas.json`, `app.config.js`, icons) but has **not** been built or run on a device.

**No install at all:** `cd backend && npm install && npm run demo`, then open the printed address on your phone's browser (same Wi-Fi) and use "Add to Home screen". It opens full screen with the Connectly icon.
