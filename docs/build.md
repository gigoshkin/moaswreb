# Build and run guide

Three ways to run the app, from quickest to most complete. Anything not yet run on a real device is marked **unverified**.

## 1. Expo Go (quickest, no build)

Works on Android and iPhone. Install **Expo Go** (SDK 58) from the store, then on a computer with Node 24:

```bash
git clone https://github.com/gigoshkin/hacktoberfest.git && cd hacktoberfest
npm install
cd apps/mobile
printf 'EXPO_PUBLIC_API_URL=https://<server address>\nEXPO_PUBLIC_API_KEY=<server API_KEY>\n' > .env
npx expo start --go --tunnel     # scan the QR code with Expo Go (Android) or the Camera app (iPhone)
```

Without `EXPO_PUBLIC_API_URL` the app shows sample trips. The server address must be `https://` for iPhones (iOS blocks plain `http://` except on the local network).

In Expo Go, push alerts and the lock-screen leave card are off (they need native code Expo Go does not have). Everything else works. On Android the photo strip in the attach sheet is hidden in Expo Go (Google removed full media access there); the Camera, Photos and PDF buttons still work.

## 2. Android development build or APK (alerts and the leave card)

Needs a free Expo account. In `apps/mobile`:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
# the build must know the server:
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_URL --value https://<server address> --environment preview --visibility plaintext
npx eas-cli@latest env:create --name EXPO_PUBLIC_API_KEY --value <server API_KEY> --environment preview --visibility secret
npx eas-cli@latest build --profile preview --platform android        # an installable APK
# or, for live JavaScript reloads on the phone:
npx eas-cli@latest build --profile development --platform android && npx expo start --dev-client
```

EAS prints a download link and QR code (queue plus build: about 15 to 60 minutes). On the phone allow notifications. On Android 14+ also turn on *Settings -> Apps -> this app -> Alarms & reminders*, and set battery use to Unrestricted, or the leave card can be late. A Google Maps key is needed for the map in an installed build (Expo Go supplies its own): `npx eas-cli@latest env:create --name GOOGLE_MAPS_ANDROID_KEY --value <key> --environment preview --visibility sensitive`. `app.config.js` reads it, so the key is never committed. **Unverified:** no APK has been built yet.

The leave card (`src/lib/leaveCard.ts`) is an ongoing notification that appears 30 minutes before the leave time and counts down with the system timer while the app is closed. It uses `react-native-notify-kit` (a maintained fork of Notifee).

The card is live: the alarm at 30 minutes before the leave time starts it as a foreground service (type `dataSync`, declared through the `react-native-notify-kit` plugin option `android.foregroundService` in `app.json`, which adds the `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_DATA_SYNC` permissions). Every 30 seconds the service looks at the plan again and updates the card in place: the leave time, the progress bar, and "Leave now · switch to 17" when the planned line runs 3+ minutes late and another arrives 3+ minutes earlier (the same rule as the server's push). It stops 10 minutes after the leave time, or when the card is swiped away. The service runner is registered in `index.ts` (the app's entry), because with the app closed only the entry file runs. Changing the plugin options or the entry needs a new EAS build.

Android 12+ only lets an app start a foreground service from the background in a few cases; an exact alarm is one, so "Alarms & reminders" must stay on. If the service cannot start, a plain countdown card (a second trigger, one minute later) shows instead, and the static "Leave now" part still fires. **Unverified:** the service has not been run on a device.

## 3. iPhone

Expo Go on an iPhone works as in section 1 (Apple Maps is used instead of Google Maps). Push, widgets and the permission texts in `app.json` need a development build with an Apple developer account (`eas build --platform ios`). **Unverified:** the app has been checked by reading the code for iOS issues (fixed: usage strings, shadows, time picker, swipe-back, photo access), not run on an iPhone yet.

## Server

See the root `README.md` and `apps/server/README.md`. The server runs as a container (`apps/server/Dockerfile`, `captain-definition` for CapRover, `docker-compose.yml` with Caddy for a plain VPS). Set the container's `PORT` to the port your proxy forwards to.
