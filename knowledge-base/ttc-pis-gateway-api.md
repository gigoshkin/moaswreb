# TTC PIS gateway API (what transit.ttc.com.ge uses)

Mapped 2026-10-17 from TTC's own web app JS bundle (`https://transit.ttc.com.ge/assets/indexHtmlPath-*.js`) and checked with live calls the same day. No third-party code used. Status: **[V]** = called live and got 200, **[B]** = seen in the bundle only.

## Access

- Base: `https://transit.ttc.com.ge/pis-gateway/api` + `/v2` or `/v3`.
- Header: `X-Api-Key: <PIS_GATEWAY_KEY>`. Without it, every call returns `400 Bad Request`.
- The key is shipped to every visitor in `https://transit.ttc.com.ge/` inside `<script>__PROFILE = {...}` → `firebaseRemoteConfigDefaults.PIS_GATEWAY_KEY`. **Don't hard-code or commit it.** Read it at backend startup (regex on the HTML) and re-read it on a 401. TTC's own client does the same retry on 401.
- `locale`: `ka` or `en` (TTC maps `ru` to `en`).
- No CORS for third-party origins **[?]**, so call it from the backend.
- Unofficial. Poll gently (≈1 req/s total), cache hard, and identify yourself with a User-Agent.
- Reference only, **don't reuse** (George's decision): George's old local Symfony client `~/Projects/web/moaswreb/moaswreb-api/src/Services/TtcClient.php` (Dec 2025). It's useful for seeing how the API behaved then; the API may have changed since. This file is the current source of truth.

## Endpoints

### Stops (v2)
| Call | Params | Returns | |
|---|---|---|---|
| `GET v2/stops` | `locale` | 2,758 stops `{id:"1:1000", code, name, lat, lon, vehicleMode}` (419 KB) | [V] |
| `GET v2/stops/{id}` | `locale` | one stop | [B] |
| `GET v2/stops/{id}/routes` | `locale` | routes serving the stop | [B] |
| `GET v2/stops/{id}/arrival-times` | `locale`, `ignoreScheduledArrivalTimes=false`, optional `routeId`, `maxNumberOfArrivalTimes` | `[{shortName, color, headsign, patternSuffix, vehicleMode, realtime, realtimeArrivalMinutes, scheduledArrivalMinutes}]` | [V] |

TTC's web app refreshes arrival times every 30 s. `scheduledArrivalMinutes` came back as odd values (67, -35) next to `realtimeArrivalMinutes` 2–3, so don't treat it as delay = realtime − scheduled until it's understood **[?]**.

### Routes (v3)
| Call | Params | Returns | |
|---|---|---|---|
| `GET v3/routes` | `modes` (comma list, e.g. `BUS`), `locale` | `modes=BUS` → 277 routes `{id:"1:R216088", shortName, longName, color, mode}` | [V] |
| `GET v3/routes/{id}` | `locale`, optional `forEntireCurrentWeek` | route plus `patterns[] {patternSuffix:"0:01", directionId, firstStop, lastStop, headsign}`, `defaultPatternSuffix` | [V] |
| `GET v3/routes/{id}/positions` | `patternSuffixes=0:01,1:01` | `{ "1:01": [{vehicleId, lat, lon, heading, nextStopId}] }`. Live vehicles; `heading`/`nextStopId` null at the terminus | [V] |
| `GET v3/routes/{id}/polylines` | `patternSuffixes` | `{ "0:01": {encodedValue} }` (Google encoded polyline) | [V] |
| `GET v3/routes/{id}/stops` | `patternSuffix`, `locale` | ordered stops of the pattern | [V] |
| `GET v3/routes/{id}/stops-of-patterns` | `patternSuffixes`, `locale` | stops of several patterns | [B] |
| `GET v3/routes/{id}/schedule` | `patternSuffix`, `locale` | `[{fromDay, toDay, serviceDates[], stops:[{id, name, position, arrivalTimes:"7:06,7:18,..."}]}]`: the full timetable per stop (route 306 = 107 KB) | [V] |
| `GET v3/routes/{id}/scheme` | `patternSuffix`, `locale` | route diagram | [B] |
| `GET v3/routes/{id}/transfers` | `patternSuffix`, `locale` | `[{transferStops:[]}]` per stop | [V] |

The pattern-based calls return **500** when `patternSuffix` is missing or empty.

### Geocode (v2)
| Call | Params | |
|---|---|---|
| `GET v2/geocode` | `query`, `locale`, **`bbox` required** (`44.66221063,41.84319686,45.050854455,41.59149226`) → GeoJSON features from OSM data | [V] |
| `GET v2/geocode/reverse` | `lat`, `lon`, `locale` | [B] |

### Trip planner (v2)
`GET v2/plan?fromPlace=lat,lon&toPlace=lat,lon&departMode=arriveBy&date=YYYY-MM-DD&time=HH:mm&modes=BUS,SUBWAY&optimize=quick&locale=en` **[V]**

- `departMode` (required): `leaveNow` | `departAt` | `arriveBy`. `optimize`: `quick` | `lessWalking` | `fewerTransfers`. Modes seen in the UI: bus, subway, gondola.
- Response is OpenTripPlanner-shaped: `itineraries[] {startTime, endTime (UTC ISO), duration, walkTime, walkDistance, legs[]}`; leg keys: `mode, from, to, startTime, endTime, duration, distance, route, realTime, arrivalDelay, intermediateStops, legPolyline, steps`.
- Test: Mon 19 Oct, arrive by 09:00 → 3 itineraries ending 08:57–08:58 local time (UTC+4) with 2–3 bus legs each, all `realTime:false` (the date is in the future).

## Not in this API
- No disruption or notice feed found in the bundle **[?]**, so notices still have to be pasted or scraped.
- Minibuses (marshrutkas) are in it: the 277 "BUS" routes include minibus lines with ids like `1:minibusR33069` (558), and these have live `positions` and `realtime` arrivals **[V]** (17 Oct logger recording).
- No historical data. We have to log it ourselves.

## Polling budget for the logger
Fetching positions for all 277 routes means 277 calls per cycle, which is too much. Instead poll `arrival-times` for the ~20 stops in the demo trips and `positions` for the ~10 routes on them, every 30 s. That's under 1 req/s. Store raw JSON snapshots so they can be replayed.
