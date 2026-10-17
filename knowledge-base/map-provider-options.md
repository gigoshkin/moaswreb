# Map and address search: options and cost (gigoshkin session, 2026-10-17)

Status: **thinking, not decided.** The code owner decides (George). Figures below come from third-party blogs and Expo docs found on 17 Oct; check Google's own pricing page before relying on any number. Marked **[unverified]** where it is memory or a blog only.

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
