# Testing the app on an iPhone (written by the gigoshkin session, 18 Oct 2026; steps not yet run on iOS)

Nobody has run the app on iOS yet. The app is plain Expo (SDK 58), so the first test needs no Xcode and no Apple developer account: **Expo Go** on an iPhone, code on a Mac.

## Steps (Mac + iPhone, 15 min)
1. iPhone: install **Expo Go** from the App Store (it must support SDK 58; if the app says the project is incompatible, update Expo Go or tell George).
2. Mac: install Node 22+ (`brew install node`), then
   ```bash
   git clone <repo> && cd hacktoberfest
   git fetch && git switch wip/builder-redesign      # or the branch George names
   npm install
   cd apps/mobile
   echo "EXPO_PUBLIC_API_URL=https://<George's VPS domain>" > .env   # ask George for the URL
   npx expo start --go --tunnel                       # QR code in the terminal
   ```
3. iPhone: open the Camera app, scan the QR code, tap the banner. Expo Go opens the app. (`--tunnel` works through any Wi-Fi; without it the phone and the Mac must be on the same network. Expo may ask to install `@expo/ngrok`; say yes.)
4. Shake the phone for the dev menu; the terminal shows red screens and logs.

## What to check and report (inbox note or a message to George)
Everything on Today, Week, Chat, Settings; adding a trip; the map; the route builder; chat with a photo; text sizes and cut-off text under the notch; keyboard covering inputs; back-swipe from the left edge on map screens; shadows on cards. Take screenshots of anything that looks wrong.

## What Expo Go on iOS cannot show (needs a dev build, Apple account and a Mac with Xcode)
Push notifications, home-screen widgets, `app.json` permission strings (Expo Go has its own), custom Google Maps on iOS. A dev build is `npx eas-cli build --profile development --platform ios` (Apple developer account, $99/yr, or a simulator build on the Mac).

## Known iOS risks (from a code read, nothing verified; details in `inbox/2026-10-18-gigoshkin-ios-audit.md`)
- `app.json` has no camera/location/photo usage strings or plugins for `expo-image-picker`/`expo-location`: a real iOS build would crash or never ask.
- The documented API URL `http://<LAN-IP>` is blocked by iOS (ATS); use https.
- iOS shows Apple Maps unless a Google key is set for iOS; the map style differs.
- "Other time" in chat uses an Android-only picker.
- Some shadows disappear on iOS (`overflow: hidden` with shadow props).
