# Taxi-style route builder: stage 1 done, stage 2 not started (gigoshkin, 2026-10-17, updated late evening)

Written so a fresh session (e.g. a cloud session) can pick this up with no other context. Branch: `wip/route-builder`. Read this file first, then the code it points to.

## What George asked for (his words, lightly trimmed)
- Add trip start/end **via a map**: select stops directly or drop a pin. Typing is too hard.
- **Place search like Google Maps**: typing "Free university" lists it. Typing a street address like "7B Archil Mefe st" showed nothing (fixed, see below).
- Taxi-app behaviour: choosing a location opens a **search bar**. Either search a street and tap it, or tap a **"select on the map" button**, then a **pin** appears and you place it.
- The current Add-trip screen is "too blind": you set two points and it saves without showing the route. He wants to **see the map while building a route**, and **see the planned route**.
- Eventually build the **whole route by hand**: start point → board at stop 1 → get off at stop → board next → ... Think carefully about the interface; take inspiration from taxi apps.
- New trip screen like a taxi app: opens with a map and **From / To at the bottom**. Pressing From or To expands the bottom part over the map to show search. "Select on map" brings the map back with a pin. The whole route is clearly visible on the map. After confirming, **arrive-by and days** appear, maybe a **title**.
- His suggested shape: the trip path is **a separate form element, a rectangle with a map**. Pressing it expands into the path builder. On submit it returns to the main form as the rectangle showing the **zoomed-out route**; below it are arrive-by etc.
- "The current app looks very good and works nice, so be careful not to break things." No visual bugs, smooth animations.
- Esri tiles are fine ("if it does the task I'm all in").

## Done in this branch
### Server (`apps/server`) — tested, 46 tests pass
- `src/ttc/photon.ts` (new): street and house-number search and reverse geocoding via Photon (komoot, OSM data), Tbilisi bbox, English names, 10-minute in-memory cache, 4 s timeout, failures return nothing. Only the query text leaves the server. `StreetGeo` interface lets tests inject a stub (tests stay offline).
- `GET /places` now merges TTC's geocoder (landmarks) with Photon (streets, house numbers), TTC first, duplicates within ~40 m dropped. Throws only if TTC failed and Photon found nothing.
- `GET /places/reverse?lat=&lon=` → `{ place: PlaceHit | null }` (type `ReversePlaceResponse` in `packages/shared/src/stops.ts`). 400 outside Tbilisi.
- `README` / route comments updated. **Not yet added:** a line in `knowledge-base/data-and-privacy.md` saying place-search text goes to TTC and Photon.
- Daily chat quotas (earlier today, already on main): `CHAT_DAILY_LIMIT` 40 per IP and per `x-device-id`, `CHAT_DAILY_LIMIT_TOTAL` 1000.

### Mobile (`apps/mobile`) — typechecks (`npx tsc --noEmit`), **not yet run on a phone**
- `src/lib/mapMath.ts` (new): web-mercator helpers (normalised 0..1 coordinates, `fitView`, `decodePolyline`, `TILE = 128`, Esri `tileUrl`).
- `src/ui/MapCanvas.tsx` (new): interactive map. Drag, pinch, momentum, centre pin that lifts while moving, `flyTo` / `fit` handle, `routes` (polylines), `markers`, `inset` (space covered by a sheet; the pin and `fit` use the free area), `onIdle(center, zoom)`.
  - View = shared values `nx, ny, zoom` changed on the UI thread. Tiles and route live in one layer at a whole "anchor" zoom, positioned relative to an anchor point; the layer transform is derived each frame. React re-anchors only when the view drifts (`checkDrift`) or at rest (`idle`).
  - Uses **react-native-gesture-handler v3 hook API** (`usePanGesture`, `usePinchGesture`, `useSimultaneousGestures`, `GestureDetector`) and Reanimated 4 `runOnJS`.
  - Risks to check on a device: smoothness of pan/pinch, any one-frame jump when it re-anchors, blank edges after a fast fling, marker alignment with the route, pin tip exactly on the chosen point.
- `src/ui/StaticMap.tsx`: now takes `itinerary?` or `endpoints?` (plain from/to), uses `mapMath`.
- `src/app/pick-place.tsx` (rewritten): **search mode** (rows: "Select on map", Home, Current location; typed results = places + stops; "Select on map" stays as last row while typing) and **map mode** (full-screen `MapCanvas` with pin, back button to search, bottom card with the address under the pin from `/places/reverse`, nearby-stop chips from `/stops/near` that snap the pin to a stop, locate button, Confirm). Android back from the map returns to search.
- `src/lib/handoff.ts`: `pickPlace(kind, { near })`, `pickOptions()`.
- `src/lib/api.ts`: `reversePlace`.
- `src/ui/kit.tsx`: `MapButton` (round white floating button).
- Icons: `map`, `swap` added in `assets/icons`, regenerated with `node scripts/icons.mjs`.

## Stage 1 status: built and checked in a browser, **not yet tried on a phone**
Added since the first push: `src/app/trip/route.tsx` (builder), the route card + Name field in `src/app/trip/edit.tsx`, `src/ui/MapMarks.tsx`, `buildRoute`/`routeDraft`/`finishRoute` in `src/lib/handoff.ts`, README and privacy notes. Checked with headless Chromium (sample plan): form with the map thumbnail, builder with the route and markers drawn on tiles, picker, map mode with the pin. Gestures, momentum, keyboard and real data are untested.
Bug found and fixed while testing: a style key that disappears from a Reanimated `useAnimatedStyle` is not reset, so the layer's first `opacity: 0` stuck; now `opacity: 1` is returned every time (see the comment in `MapCanvas`).

**Next, on the phone (Expo Go):** drag/pinch smoothness, any one-frame jump at re-anchoring, blank edges after a fast fling, pin tip on the chosen point, marker alignment with the route line, the keyboard in the picker, "Select on map" → Confirm → back in the builder → Done → form shows the map thumbnail, saving a trip, street search ("Archil Mepe", "7 Archil Mepe"), reverse address under the pin.
Known gaps in stage 1: the builder shows the route the app will plan (best option) but you can't choose another option or pin a route yet; that is stage 2. The picker's "Current location" uses the device geocoder; the map pin uses the server's.
Because this changes andro's Add-trip flow, write a request or an inbox note to andro before merging to main.

## Stage 2: build the route by hand (not started, needs design decisions)
Goal: user picks start, then boarding stop + route, alighting stop, next boarding stop, …, end. Data TTC offers (see `knowledge-base/ttc-pis-gateway-api.md`): `v2/stops/{id}/routes` (routes at a stop), `v3/routes/{id}` (patterns), `v3/routes/{id}/stops?patternSuffix=` (ordered stops), `v3/routes/{id}/polylines`, `v3/routes/{id}/schedule` (per-stop timetable), `v2/stops/{id}/arrival-times?routeId=` (live). Ride duration = timetable difference between the two stops; next departure = live arrivals for that route at the boarding stop.
Open design questions:
- Data model: `SavedTrip` needs `legs?: { routeId, patternSuffix, boardStopId, alightStopId }[]`; Today / trip detail / countdown must compute leave time from live arrivals instead of `/plan`.
- Server alerts: `StoredTrip` is stop-to-stop and the server re-plans with TTC, so it can pick a different route than the hand-built one. Either extend `StoredTrip` with the pinned legs (server change, George's area) or accept that hand-built trips only get on-phone backup notifications at first.
- UI idea: in the builder sheet, a "Build by hand" row. Map shows stops around the last point as tappable dots; tap a stop → list of routes serving it; pick a route → its stops light up along the polyline; tap the alighting stop → "next" or "Finish with a walk to <To>".

## Environment on George's VPS (a cloud session cannot touch these)
- Expo Go dev server: `REACT_NATIVE_PACKAGER_HOSTNAME=100.113.90.98 npx expo start --go --clear` in `apps/mobile`, port 8081 (started in the background by the last session; log in the session scratchpad). George uses Expo Go over Tailscale. Never kill it without being asked.
- API server: `npm run dev -w @transit/server` from the repo root, port 8080, reads the repo-root `.env` (gitignored; has a generated `TRIPS_KEY`, **no `ANTHROPIC_API_KEY` yet**, so `/chat` answers 503 until George adds one). It reaches live TTC fine from the VPS.
- `apps/mobile/.env` (gitignored): `EXPO_PUBLIC_API_URL=http://100.113.90.98:8080`. Restart Expo after changing it.
- A cloud sandbox is blocked from TTC and can't serve a phone, so it can write code and run `tsc` and server tests, but the live checks happen on the VPS.

## Standing rules (from CLAUDE.md and George)
No AI attribution in commits, docs or code. English-only app. Don't commit secrets. Palette: andro's Figma (see `inbox/2026-10-17-gigoshkin-screens-built.md`). Changes to andro's area (features, screens, flows in the spec) need a request in `requests/`; this route builder changes the Add-trip flow, so **write a request to andro (or at least tell them in an inbox note)** before merging to main. Ask George one question at a time. Check `grep -l "to: george" requests/*.md | xargs grep -l "status: pending"` before pushing.

## Update: first phone test and what happens next (late 17 Oct)
George tried stage 1 on his Android phone in Expo Go. Results and fixes (all pushed on `wip/route-builder`):
- Red screen "Tried to synchronously call a Remote Function: scaleAt". `scaleAt` and `clamp` in `src/lib/mapMath.ts` are called inside gesture/animated-style worklets and now carry `'worklet'`. **Rule for this codebase: any helper called from a worklet must have the directive; the browser preview cannot show this error.**
- Map jumped to a wrong place when the finger left the screen, flickered, and loaded tiles ugly. Cause: React re-laid the tiles one frame before the animated transform picked up the new anchor. `MapCanvas` now renders one `TileLayer` per layout (its transform inputs never change), keeps the previous layer underneath until the new tiles have loaded, fades tiles in, checks drift every frame (also while coasting), and only re-anchors at rest when the view moved off its layout. **Not yet re-tested on the phone.**
- Search showed nothing while waiting (`/places` takes about 2 s when Photon is cold, so "7B Archil Mefe st" looked empty). Added `src/ui/SearchLoading.tsx` (a bus glides along four stops, skeleton rows under it). The server does return the Archil Mepe streets for that query; exact house numbers are mostly missing in OSM.
- George's complaints that remain: zoom stops at 16 (Esri tiles), no bus stops on the map, and he cannot edit the planned route or choose between several buses; **the by-hand builder and the route options are not built** (stage 2). The builder only shows the single best itinerary (`plan.itineraries[0]` or the chosen one); the planner returns several, none of them are shown.

### Decision in progress: Google map
Read `knowledge-base/map-provider-options.md` first. Short version: `react-native-maps` is inside Expo Go and shows real Google Maps on Android, so no dev build is needed for the map. George leans towards trying it. **Before committing to Google, George will send a screenshot of TTC's phone app (not the website) so we can tell which map it uses (the website uses Mapbox GL JS). Do not merge a Google map to `main` until George says so.** Work on it on a separate branch (`wip/google-map`), keep `MapCanvas`'s props (`start`, `routes`, `markers`, `pin`, `inset`, `onIdle`, `flyTo`, `fit`) so the screens above it don't change.

Key facts for that work:
- Expo Go needs **no Google key** (it ships its own). A key is only needed for a development or store build: `apps/mobile/app.json` → `expo.android.config.googleMaps.apiKey`, read from the environment at build time, never committed.
- Billing safeguards George asked for (he does not want a surprise bill; Google asks for a card authorisation when billing is enabled):
  1. The map itself (Maps SDK for Android) is free and unlimited **[unverified: check Google's page]**, so it cannot run up a bill.
  2. Anything that costs money (Places Autocomplete/Details, Geocoding, Static Maps) must only be called from our server, behind a **hard daily cap in our own code** (like the chat quotas in `apps/server/src/ratelimit.ts`), default small, in `.env`, and off unless a key is set.
  3. In Google Cloud: restrict the key to one API and to our app/IP, and set per-API **daily quota caps** (Quotas page); a budget alert alone only sends mail, it does not stop spending.
  4. Do not enable billing at all until a paid API is actually needed.
- Where each key goes: Android map key in the build config above (not needed in Expo Go); Places/Geocoding key on the server only, `GOOGLE_PLACES_API_KEY` in the repo-root `.env` (gitignored), read in `apps/server/src/config.ts`.
- Keep Esri `StaticMap` for the small route card (no Static Maps cost). Draw TTC stops ourselves as markers if Google's own stops are too faint (`/stops/near` exists).

### What a cloud session can and cannot do
It can edit code, run `npx tsc --noEmit` in `apps/mobile` and `npm test -w @transit/server`. It cannot reach TTC or serve George's phone. George's VPS session keeps Expo Go (8081) and the API server (8080) running; he pulls the branch there and Expo reloads. Never kill his Expo server.

### Order of work after the Google decision
1. Google map behind the same `MapCanvas` props, on `wip/google-map` (or stay on Esri and add TTC stop dots if George decides against).
2. Route options in the builder (cards for each itinerary from `useTripPlan`, tap to choose, keep the choice in the draft).
3. Stage 2, build by hand (see above). Blocked on George's answer: do hand-built trips need server alerts now (extend `StoredTrip`, his area) or phone-only reminders first.
4. Request or inbox note to andro before anything reaches `main`.

## Update: Google map trial is ready on `wip/google-map` (18 Oct, cloud session)
- Branch `wip/google-map`, cut from `wip/route-builder`. **Not merged, production flow untouched.** Typechecks (`npx tsc --noEmit` in `apps/mobile`); **not run on a phone** (the cloud cannot reach your phone or TTC).
- `MapCanvas.tsx` was rewritten on `react-native-maps` 1.29.11 (SDK 58's pinned version). Same props and handle, so `pick-place.tsx` and `trip/route.tsx` did not change. Details and the phone checklist are in `knowledge-base/map-provider-options.md` (section "Trial on wip/google-map").
- No Google key anywhere in the code; nothing paid is called from the app. Billing safeguards and where each key goes are now written in the same note.
- No TTC stop dots yet (only if Google's stops are too faint). Esri `StaticMap` kept for the route card.
- Still open: your TTC phone-app screenshot (which map does it use?) and your go/no-go on Google. Until then do not merge.
- **To try it on the VPS:** `git fetch && git switch wip/google-map && npm install` (repo root), then Expo reloads; Android only for Google tiles (iPhone Expo Go shows Apple Maps). Switch back with `git switch wip/route-builder`. Don't kill the running Expo server.
