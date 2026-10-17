# Taxi-style route builder: work in progress (gigoshkin, 2026-10-17)

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

## Still to build (in this order)
1. **Route builder screen** `src/app/trip/route.tsx` (register in `src/app/_layout.tsx`, default push animation). Reads a draft `{ from, to, arriveBy, days }` from `handoff` (add `buildRoute(draft): Promise<{from, to} | null>`, `routeDraft()`, `finishRoute()` next to `pickPlace`).
   - Full-screen `MapCanvas`, `start = { fit: [from, to] }` when both set. Floating `MapButton` back (cancel).
   - Bottom sheet (white, top radius 24, `shadow.bar`), measured with `onLayout` and passed as `inset.bottom`: From row and To row (dot, dashed connector, pin icon; tap opens `pickPlace(kind, { near: otherEnd })`), a swap button when both are set, then a route summary, then **Done** (returns `{from, to}` and `router.back()`).
   - Plan: `useTripPlan({ id: 'draft', name: '', from, to, arriveBy, days }, nextArriveBy(arriveBy, days, now).slice(0, 10), now)`. Show the chosen itinerary (`choice.it`, else `itineraries[0]`) on the map: legs from `decodePolyline(leg.polyline)` (walk = dashed), start dot, end ring, a ride badge (bus/metro icon in an ink circle) at each boarding stop. Summary: route plates, "Leave HH:MM" (`leaveAt(it, settings.bufferMin)`), "Arrive HH:MM · N min". States: loading skeleton, "Can't reach the planner", "No route found".
   - On mount: if `from` is empty open the From picker; else if `to` is empty open the To picker (taxi "Where to?" feel).
   - Re-`fit` the map when from, to or the itinerary id changes.
2. **Add-trip form** `src/app/trip/edit.tsx`: replace the two `Field` rows with a **route card**: when both ends are set a `StaticMap` thumbnail (itinerary, else `endpoints`; zoomed-out route) with From → To lines and "Leave around HH:MM + plates" inside the card; when empty the current sky card. The whole card opens the builder. Remove the separate preview line at the bottom. Add a **Name** card (TextInput, placeholder = destination label, blank = auto name) above Save. Keep arrive-by, Days, Save, Delete as they are. Make `StaticMap`'s gradient start `${fadeTo}00` so it fades cleanly into a white card.
3. **Check screens in a browser** (layout only; gestures need a phone): `npx expo start --web --port 8082` in `apps/mobile`, headless Chromium (Playwright is preinstalled; see README Preview). Also run on a phone through Expo Go.
4. **Docs:** `knowledge-base/data-and-privacy.md` (Photon), `apps/mobile/README.md` (map pieces), and this note → delete or update when done.

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
