# Mobile scaffold, component kit, /plan endpoint (gigoshkin, 2026-10-17)

Written from George's cloud session while George was on a break. Branch `main-cx2gcl` (not merged to main yet).

## What's done
- **`packages/shared`**: normalised trip-planner types (`PlanQuery`, `Itinerary`, `PlanLeg`, `PlanResponse`) and a Tbilisi time helper. Types only, no runtime deps; the server runs it with Node type stripping, Metro bundles it for the app.
- **`apps/server`: `GET /plan`** wraps TTC `v2/plan` with `departMode=arriveBy`, validates input, caches identical queries for 60 s and normalises the response. 10 tests pass (`npm test -w @transit/server`). The Dockerfile now copies `packages/shared`.
- **`apps/mobile`**: Expo SDK 58.0.14 (latest on npm), blank TypeScript, inside the npm workspaces. Installed: Reanimated 4.7, Worklets, Gesture Handler, Skia 2.14, FlashList 2, expo-image, MMKV 4 (+ nitro-modules), `@expo/ui`, expo-haptics, expo-font.
  - **Tokens** (`src/theme/tokens.ts`): warm neutrals plus near-black dark mode, one green "go" accent, amber for late, a 5-step type scale, radius, spacing and 3 spring presets.
  - **Fonts:** Google Sans Flex for Latin and numbers. **It has no Georgian glyphs** (checked in the font file), so Georgian text switches to **Noto Sans Georgian**. Its x-height (0.536 em) is close to Google Sans Flex (0.51 em). `Text` picks the font by script automatically.
  - **Components:** `Text`, `RoutePlate` (line colour, black/white text chosen by contrast, metro as a pill), `LeaveByBar` (Skia + Reanimated: the window narrows on a spring, the "now" marker slides), `Card` (spring press, corners and fill morph when urgent, haptic), `ItineraryCard`.
  - **Kit screen** (`src/dev/KitScreen.tsx`) shows them all on **synthetic** data with a 30× clock so the states move. It's a preview, not a product screen (screens are andro's).
  - `lib/api.ts` (calls `/plan` via `EXPO_PUBLIC_API_URL`) and `lib/cache.ts` (MMKV, for instant start) are ready for the first real screen.

## Verified / not verified
- Verified: typecheck (server, shared, mobile), server tests, a full Metro Android bundle (`expo export`).
- **Not verified:** running on a device (needs an EAS dev build; Skia/MMKV/Reanimated aren't in Expo Go), and the Docker image build (no Docker daemon in the cloud sandbox).
- **TTC is blocked from the cloud sandbox** (proxy 403), and so are docs.expo.dev and fonts.google.com. `/plan` was built against the key names in `knowledge-base/ttc-pis-gateway-api.md`. Value types (epoch ms vs ISO, `route` as a string vs an object) are read defensively. **Next step on George's laptop:** save one raw `v2/plan` response and replace the synthetic fixture.

## Left out on purpose
- `@expo/ui` (Jetpack Compose) is installed but not used yet. It fits pickers, switches and dialogs, not the custom-drawn kit pieces.
- No expo-router yet (the stack says expo-router). It gets added with the first real screens.
- Removed the template's MIT `LICENSE` file from `apps/mobile`. Kept the generated `AGENTS.md` and `.claude/settings.json` (enables the official Expo Claude plugin) for George to decide on.
- The leave-by window on the kit screen is a fixed ±2.5 min placeholder. The real window comes from the learning model (05 §8).

## For andro
- The kit follows `06-design-direction.md`. When your screens are ready, the plate, bar and card sizes are easy to change in one place (`tokens.ts`).
- Still needed: 2–3 real demo trips, with their stops added to `HOT_STOPS`.
