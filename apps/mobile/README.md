# Mobile app

Expo SDK 58, expo-router (routes in `src/app/`), TypeScript.
**No screens yet:** the placeholder UI was removed on 17 Oct for andro's redesign. The MVP look is prototype Today v3 (`knowledge-base/ideas/tbilisi-transit/06-design-direction.md` §0).

## Run
**Expo Go (SDK 58, 58.0.4+; install the APK from expo.dev if the Play Store build is older):**
```bash
REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) npx expo start --go   # open exp://<ip>:8081 in Expo Go
```
In Expo Go, storage falls back from MMKV to `expo-sqlite/kv-store` (`src/lib/kv.ts`) and alerts are off (`src/lib/alerts.ts`).
Real push needs a **development build**: `npx eas-cli@latest build --profile development --platform android`.

## Server
Set `EXPO_PUBLIC_API_URL` (e.g. in `apps/mobile/.env`) to the server, e.g. `https://<DOMAIN>` on the VPS or `http://<laptop-LAN-IP>:8080`.
Without it the app shows synthetic sample trips.
Note: `docker-compose.yml` binds the server to `127.0.0.1`, so a phone can't reach the laptop's Docker server; use the VPS (Caddy), or run `npm run dev -w @transit/server` directly.

## Layout
- `src/app/`: routes. `_layout` (stack + alert setup), `index` (empty)
- `src/lib/`: `api` (client for `/plan`, stops, places, arrivals, chat, `/me`; plans cached), `usePlan` (cache first, then network), `trips` (saved trips, phone only), `kv` (MMKV or Expo Go fallback), `alerts`, `strings` (English copy; the app is English-only), `time`
- `src/dev/samplePlan.ts`: synthetic plan used when `EXPO_PUBLIC_API_URL` is unset
