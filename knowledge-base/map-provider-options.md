# Map and address search: options and cost (gigoshkin session, 2026-10-17)

Status: **thinking, not decided.** The code owner decides (George). A trial implementation of option B exists on branch `wip/google-map` (not merged; see the end of this note). Figures below come from third-party blogs and Expo docs found on 17 Oct; check Google's own pricing page before relying on any number. Marked **[unverified]** where it is memory or a blog only.

## Where we are
- The app draws its own map (`apps/mobile/src/ui/MapCanvas.tsx`) from Esri "Light Gray Canvas" tiles. No key, free for a demo. Limits found on the phone on 17 Oct:
  - Tiles stop at zoom 16, so you cannot zoom in close.
  - The light-gray style shows no bus stops.
  - Our own gesture code had bugs (jump after a fling, flicker, ugly tile loading).
- Address search is our server: TTC geocoder (landmarks, stops) plus Photon (OpenStreetMap streets). OSM has few house numbers in Tbilisi.

## What TTC itself uses
Its web app (transit.ttc.com.ge) bundles **Mapbox GL JS** (checked in the JS bundle, 17 Oct). It is not Google. Its tile style and key are its own, not ours to use.

## Is it Expo Go that limits us?
- **`react-native-maps` is included in Expo Go.** On Android it is the real Google Maps, no setup for testing (Expo docs, SDK 58 "map view" page). So a native, smooth, deep-zoom Google map is possible **without leaving Expo Go**. On iPhone, Expo Go uses Apple Maps; Google on iOS needs a development build.
- `expo-maps` and anything with its own native code (MapLibre, Mapbox native, `expo-osm-sdk`) need a **development build** (EAS), not Expo Go.
- A store build with Google Maps needs a Google Maps API key in `app.json`.
- Dev builds also bring real push notifications, which Expo Go cannot do.

## Options
| Option | Map quality | Stops visible | Cost | Needs dev build |
|---|---|---|---|---|
| A. Keep own Esri map | tiles to zoom 16, gray | no (we can draw TTC stops ourselves) | free | no |
| B. `react-native-maps` (Google on Android) | native, smooth, zoom ~21, shows POIs and transit stops at high zoom | yes (Google's) | Maps SDK for mobile is free and unlimited **[unverified]**; needs a key for store builds | no (Android); iOS Google yes |
| C. MapLibre / Mapbox native | vector, smooth, any style | only if we draw them | Mapbox has a free tier **[unverified]**; MapLibre needs a tile source | yes |
| D. Static Maps (Google) for previews | picture only | yes | about $2 per 1,000 after a free monthly allowance **[unverified]**; the card on the trip form is the only place needed | no |

Address search with Google (Places Autocomplete): about $2.83 per 1,000 requests, cheaper when a session ends with a Place Details call; Place Details about $17 per 1,000 **[unverified, blogs disagree]**. For a demo this is cents. It finds house numbers in Tbilisi far better than OSM. It must be called from our server (key stays secret) and the privacy note must say place text goes to Google.

## Recommendation (for George to decide)
1. **Keep Photon + TTC search now**; add a Google Places call behind a server env key later if house numbers still disappoint.
2. **Try B for the picker and builder map** (it also fixes zoom, stops and gesture smoothness in one step, and stays in Expo Go on Android). Keep our `StaticMap` (Esri) for the small thumbnail so there is no Static Maps bill. We draw TTC stop dots and the route as `Marker` / `Polyline`.
3. Move to a dev build when push and the demo polish need it, not for the map.
4. Whatever we pick, the map provider sees the phone's IP and the map area; update `data-and-privacy.md` when decided.

## Trial on `wip/google-map` (18 Oct, cloud session; not tested on a phone)
- `apps/mobile/src/ui/MapCanvas.tsx` now renders `react-native-maps` 1.29.11 (the version Expo SDK 58 pins in `expo/bundledNativeModules.json`; `npx expo install` could not reach Expo's API from the cloud, so it was installed by that exact pin). Props and handle are unchanged, so `pick-place.tsx` and `trip/route.tsx` are untouched.
- Android uses `PROVIDER_GOOGLE` (inside Expo Go, no key). iPhone Expo Go shows Apple Maps. Web preview shows a plain gray box.
- The pin is our own overlay; the point under it comes from `onRegionChangeComplete` (Google zoom is worked out from the longitude span). `zoom` props keep the old Esri scale; Google zoom = that + 1.
- Polylines and markers are the library's `Polyline` / `Marker`. Shop and restaurant pins are hidden by a small map style; transit stops stay. **No TTC stop dots yet:** add them only if Google's stops are too faint on the phone.
- Esri `StaticMap` stays for the small route card.
- To check on the phone: drag/pinch feel, pin tip on the chosen point (the free-area offset is computed by us, not by `mapPadding`), address under the pin, the sheet resizing without the pin drifting, `fit` framing, markers (start, end, bus badges) in the right place, how visible Google's stops are.

## Billing safeguards (George, 17 Oct: no surprise bill)
1. **The map costs nothing.** Maps SDK for Android (native map) is free and unlimited **[unverified: check Google's pricing page]**, and Expo Go uses Expo's own key. The app code contains no Google key and calls no Google web API.
2. **Anything that costs money goes through our server only**, behind a **hard daily cap in our own code** (same pattern as the chat quotas in `apps/server/src/ratelimit.ts`): Places Autocomplete/Details, Geocoding, Static Maps. Default cap small, set in `.env`; the feature is off unless its key is set.
3. **Google Cloud side:** restrict each key to one API and to our app or server IP; set per-API **daily quota caps** (APIs & Services → Quotas). A budget alert only sends e-mail, it does not stop spending, so it is a warning and not a safeguard.
4. **Do not enable billing until a paid API is really needed.** Google asks for a card authorisation when billing is switched on.

### Where each key goes
| Key | Used by | Where it lives |
|---|---|---|
| none | Map in Expo Go (Android) | nothing to set |
| Maps SDK for Android key | development or store build only | `expo.android.config.googleMaps.apiKey`, filled from the environment at build time (e.g. an `app.config.js`), never committed |
| Places / Geocoding key | server only | `GOOGLE_PLACES_API_KEY` in the repo-root `.env` (gitignored), read in `apps/server/src/config.ts` |
| Static Maps | not used | the route card stays on Esri |

Never put the server key in the app, and never reuse one key for both.
