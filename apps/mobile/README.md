# Mobile app

Expo SDK 58, expo-router (routes in `src/app/`), TypeScript.
Screens follow andro's Figma ("Moaswreb App", page *Screens v2*), built 17 Oct. Tokens live in `src/ui/theme.ts`.

## Run
**Expo Go (SDK 58, 58.0.4+; install the APK from expo.dev if the Play Store build is older):**
```bash
REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) npx expo start --go   # open exp://<ip>:8081 in Expo Go
```
In Expo Go, storage falls back from MMKV to `expo-sqlite/kv-store` (`src/lib/kv.ts`) and alerts are off (`src/lib/alerts.ts`).
Real push needs a **development build**: `npx eas-cli@latest build --profile development --platform android`.

## Server
Set `EXPO_PUBLIC_API_URL` (e.g. in `apps/mobile/.env`) to the server, e.g. `https://<DOMAIN>` on the VPS or `http://<laptop-LAN-IP>:8080`. iOS dev/prod builds block plain `http://` (App Transport Security) except local-network addresses (`NSAllowsLocalNetworking` is set in app.json); real iOS builds must use `https://`.
Without it the app shows synthetic sample trips.
Note: `docker-compose.yml` binds the server to `127.0.0.1`, so a phone can't reach the laptop's Docker server; use the VPS (Caddy), or run `npm run dev -w @transit/server` directly.

## Preview in a browser
`npx expo start --web` renders the screens in a browser: good for checking layout, not motion. Without `EXPO_PUBLIC_API_URL` it uses the sample plan.

## Layout
- `src/app/`: routes.
  - `(tabs)/`: Today (`index`), Week, Chat, Settings, with the custom tab bar.
  - `trip/[id]`: trip detail (saved trip, or a chat plan with `?preview=1`).
  - `trip/edit`: add or edit a trip (route card with a map thumbnail, arrive-by, days, name).
  - `trip/route`: taxi-style route builder: the map with From / To at the bottom and the planned route drawn on it.
  - `pick-place`: search a street, place or stop, or "Select on map" and drop a pin (address under the pin, nearby stops as shortcuts).
  - `buffer`, `privacy`.
- `src/ui/`: design system.
  - `theme`: colours, type scale, springs. `Text`, `Icon`, `Tap` (press feedback + haptics), `Button`, `RoutePlate`.
  - Motion: `LeaveByBar`, `Countdown` (rolling number), `TabBar` (stretching pill), `StaticMap` (still map), `MapCanvas` (drag/pinch map with a centre pin and route overlay), `MapMarks`, `ChatCards`, `kit` (top bar, cards, switch, chips, rows).
- `src/lib/`:
  - Server and storage: `api` (client for the server, plans cached), `kv`, `store` (subscribable values), `trips` (saved trips, synced to the server for alerts), `settings` (home, buffer, alerts).
  - Planning: `plans` (best option and leave time, same rule as the server), `usePlan` / `useTripPlan`.
  - Screen glue: `chat`, `handoff` (results passed between screens), `alerts`, `time`.
- `src/dev/samplePlan.ts`: synthetic plan used when `EXPO_PUBLIC_API_URL` is unset.
- `assets/fonts`: Metropolis (public domain), a free stand-in for the Figma's Gilroy, which is a paid font. To use Gilroy, drop in licensed files and change `font`/`fontFiles` in `src/ui/theme.ts`.
- `assets/icons`: SVGs exported from the Figma, plus a few drawn in the same style. Run `node scripts/icons.mjs` after adding one.
- Map tiles: Esri Light Gray Canvas. No key needed, attribution shown on the map. CARTO's light tiles now require a key.
