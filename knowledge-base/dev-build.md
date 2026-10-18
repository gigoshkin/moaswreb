# Development build (Android) and the leave card

Written 18 Oct 2026 by George's session. [U] = unverified: nothing here has run on a real Android phone yet.

## Why a dev build
Expo Go only has Expo's bundled native modules. These features need a development build of our own app:

| Feature | Expo Go | Dev build |
|---|---|---|
| Leave card: the lock-screen countdown (`src/lib/leaveCard.ts`) | off (does nothing) | yes, Android only |
| Push alerts and local backups (`src/lib/alerts.ts`, expo-notifications 58.1) | off: Expo Go 58.0.4 lacks the native module, and Expo Go has no remote push on Android | yes |
| MMKV storage (`src/lib/kv.ts`) | falls back to `expo-sqlite/kv-store` | MMKV |

After one native build, JS changes still reload from Metro. Rebuild only when a native package or `app.json` plugin changes.

## Build and run
```bash
cd apps/mobile
npx eas-cli@latest login                          # Expo account
npx eas-cli@latest init                           # first time only: creates the EAS project, writes extra.eas.projectId into app.json (commit it)
npx eas-cli@latest build --profile development --platform android
# EAS prints a URL / QR when it is done: open it on the phone and install the APK
# (allow "Install unknown apps" for the browser). Takes ~15–30 min plus the free-tier queue [U].
REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) npx expo start --dev-client
# open the installed "Tbilisi Transit" app (not Expo Go); it finds Metro, or scan the QR
```
Profiles are in `apps/mobile/eas.json`: `development` (dev client, internal APK) and `preview` (standalone APK, no Metro: use it for the demo on stage).
Without an Android SDK there is no local `npx expo run:android`; EAS builds in the cloud.

## Leave card: what it is
An ongoing notification for the next trip (same rule as Today: `plans.choose`, `leaveAt`, buffer):
- appears **30 min before the leave time**, title "Work: Leave at 08:14", body "Bus 539 scheduled 07:58 · Rustaveli Ave · arrive 08:40";
- the system **chronometer counts down** to the leave time in the notification header, with no app wake-ups (`setUsesChronometer` + `setChronometerCountDown` + `setWhen`);
- at the leave time a second notification "Work: Leave now" appears (counts up), and the countdown one times out;
- gone 10 min after the leave time (`timeoutAfter`); no card for a later bus on that trip and day;
- replaced when the plan changes (while the app runs: every minute, on trip/settings changes, on return to the app), removed when the trip is deleted or Notifications is switched off.
Both parts are AlarmManager triggers, so they fire with the app closed. The title itself cannot tick: Android has no self-updating text, only the chronometer.

Library: **`react-native-notify-kit@10.8.1`** (exact), a maintained New-Architecture fork of Notifee. Notifee itself (`@notifee/react-native` 9.1.8, Dec 2024) was archived on 7 Apr 2026 and predates bridgeless RN, so it was not used. expo-notifications 58.1.5 has no chronometer, `setWhen` or `timeoutAfter` (checked in its `ExpoNotificationBuilder.kt`), so it cannot do the countdown. Choice by George's session, 18 Oct; George owns the stack.
Config plugin in `app.json`: `["react-native-notify-kit", { "android": { "icons": [{ "name": "ic_leave_card", "path": "./assets/android-icon-monochrome.png", "type": "small" }] } }]` (generates the small icon; checked with `expo prebuild` on a copy).

### Test it on the phone
Settings → **"Test leave card (dev)"** (only in `__DEV__` builds). Card at +1 min, "Leave now" at +3 min, gone at +5 min. Lock the phone to see it on the lock screen.

### Permissions
- **Notifications** (`POST_NOTIFICATIONS`, Android 13+): asked by the intro / Settings toggle (`setUpAlerts`). The leave card starts only after it is granted.
- **Exact alarms** (`SCHEDULE_EXACT_ALARM`, declared by notify-kit's manifest): Android 14+ denies it by default for new installs. Without it the card still comes, through an inexact alarm that Doze can delay by minutes [U how much]. Allow it: Settings → Apps → Tbilisi Transit → **Alarms & reminders**. The dev test row offers to open that page.
- Battery: some OEMs (Xiaomi, Samsung "sleeping apps") kill alarms of apps that are swiped away [U]. For the demo, set the app's battery use to "Unrestricted".

### Known limits [U]
- Not run on a device yet: RN 0.88 / Expo SDK 58 is newer than notify-kit's development target (RN 0.85.3).
- Android 14+ lets the user swipe away an ongoing notification (it stays on the lock screen until unlocked).
- Plan changes while the app is closed don't reach the card. The server's push (`apps/server/src/alerts/watcher.ts`, `plan_changed`) shows a normal notification. To also move the card, the server would send a data-only push and the app would re-post the card from a background task (expo-notifications `registerTaskAsync` + `expo-task-manager`, not installed). Not built.
- Server push "Leave in 10 min" still arrives as well, as a separate notification.
- iOS: nothing yet. A Live Activity (`expo-widgets` Live Activities, needs a Mac build and an Apple team) would be the iOS equivalent.
- Android 16 "Live Updates" (status-bar chip with the countdown) need `setRequestPromotedOngoing(true)` and the `POST_PROMOTED_NOTIFICATIONS` permission (source: developer.android.com/develop/ui/views/notifications/live-update). The card already meets the other rules (ongoing, title, BigText, not colorized), but notify-kit 10.8.1 has no option for the extra, so it needs a small native patch. Not built.
