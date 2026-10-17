# Mobile app

Expo SDK 58, expo-router (routes in `src/app/`), TypeScript. Georgian first, light theme.
Screens are **placeholders** until andro's Figma designs land (see `knowledge-base/ideas/tbilisi-transit/06-design-direction.md` §8).

## Run
Reanimated, Skia and MMKV need a **development build** (Expo Go won't work):
```bash
npx eas-cli@latest build --profile development --platform android   # once, in the cloud
npm start -w @transit/mobile                                        # then scan with the dev build
```

## Server
Set `EXPO_PUBLIC_API_URL` (e.g. in `apps/mobile/.env`) to the server, e.g. `https://<DOMAIN>` on the VPS or `http://<laptop-LAN-IP>:8080`.
Without it the app shows synthetic sample trips.
Note: `docker-compose.yml` binds the server to `127.0.0.1`, so a phone can't reach the laptop's Docker server; use the VPS (Caddy), or run `npm run dev -w @transit/server` directly.

## Layout
- `src/app/`: routes: `index` (saved trips), `trip/[id]` (options from `/plan`), `kit` (component preview, dev only)
- `src/components/`: design kit (placeholder look)
- `src/lib/`: `api` (`/plan` client + cache), `usePlan` (cache first, then network), `trips` (saved trips in MMKV, phone only), `strings` (ka/en copy), `time`
- `src/theme/`: tokens, fonts
