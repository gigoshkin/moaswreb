# Route engine review (19 Oct 2026)

Why route search was slow, why routes changed between refreshes, why hand-built trips stopped predicting, and what changed on branch `wip/engine`. Timings come from real TTC requests made from the dev sandbox on 19 Oct around 12:20 Tbilisi time. The trip was Archil Mepe St (Dighomi) to M/S State University, arriving about 90 minutes later.

## 1. How a plan was made before (origin/main 83d5ae8)

A plan request (`GET /plan`, chat `plan_trip`, the alert watcher) went to `PlanService.plan` and ran three sources side by side:

| Source | What it does | Cost |
|---|---|---|
| **TTC's planner** (`v2/plan`) | Itineraries with changes. It returns at most 3 per request. | Asked twice: at the arrive-by time and 15 min earlier. |
| **Our engine** (`journey/engine.ts`) | Direct lines only, from 14 stops near the start to 14 stops near the end. Times them from timetables and live data. | Per stop: `stops/{id}/routes`, then per route `routes/{id}`, then per pattern `routes/{id}/stops` and `schedule`, then per line `arrival-times`, plus one TTC walking request per walk. |
| **Google Routes** | Up to 4 line chains, resolved to TTC stops and timed by our engine. | 1 Google call, plus engine lookups. |

The results were merged: one itinerary per line chain, at most 10.

Every TTC request, including the research logger and the alert watcher, went through **one queue that starts at most one request every 700 ms** and waits for each to finish. The plan waited for our engine at most 25 s, then answered with whatever had come back.

Hand-built routes (`POST /plan/journey`, steps) used only our engine.

## 2. Measurements

| Case | Time | TTC requests | Result |
|---|---|---|---|
| Auto plan, cold cache | **25.0 s** (budget hit) | 32 | Only TTC's itineraries. Our engine didn't finish. |
| Hand-built 321\|335\|518 → M1 → M2, cold | **25.0 s** | 40 | **0 itineraries**, returned as a successful answer |
| Same, warm disk cache | 3.5 s | 5 (live) | 321 / 335 / 518 → metro, correct |
| Auto plan, warm, arrive-by 1 min later | 1.7–14 s | 2–18 | A **different set of ways** |
| TTC `v2/plan` alone | 0.5–1.3 s | 1 | Same query, same answer; a different set for 1 min later |
| TTC walking request | 0.25 s | 1 | 180 s for 225 m (180 m straight) |

## 3. Root causes

1. **Slowness is our own queue, not TTC or Google.** TTC answers in about 0.5–1.3 s. A cold plan needs 30–40 lookups, and the queue starts at most 1.4 a second. On the server the research logger's city-wide sweep (`SWEEP_INTERVAL_MS=1500`) also takes about every other slot. Riders waited behind data logging, and past 40 waiting requests they got a 503.
2. **Routes jump because the list is a race between sources.**
   - TTC's planner keeps only its top 3, and they change completely from one minute to the next (13:52 and 13:53 above share only line 302).
   - Our engine shows up only when its cache happens to be warm before the 25 s budget runs out.
   - Google adds chains only when it answers within 3 s.
   - So the same trip gets a different list on each refresh, and the chosen option moves with it.
3. **Hand-built trips "stop predicting".** With a cold cache, or with the queue full of the route screen's every-line search, our engine ran past 25 s. The server then answered **200 with no itineraries**. The phone cached that over the last good plan. Saving the trip again then lost its stop ids, and with them server alerts. (The builder agent found this independently: commit `c97269d`.)
4. **Changes between rides came only from TTC's top 3.** Our engine planned direct lines only. A route like bus → metro existed only when TTC's top 3 included it, and Google chains only when TTC stop matching succeeded within 120 m.
5. **Walking.**
   - The server asked TTC's street router for every walk: about 0.7 s each in the queue, and its numbers are fine.
   - When that failed, the fallback assumed 0.9 m/s. TTC actually walks about 1.3 m/s on streets 1.3x the straight line, so the fallback overstated walks by about 45%.
   - The hand builder's rail shows *its own* straight-line estimate: metres × 1.25 at 75 m/min.
   - **17 min to stop 3316 means the walk started about 1 km from that stop.** From a point near 7B Archil Mepe St, TTC's router says 3 min. So check where the trip's Start or home pin actually is.
6. **Live data cost one TTC call per line and stop** for every ride of every option, including later rides whose live data the leave time doesn't use.
7. **The hand builder** (agent report, commits `4c2047b`, `c97269d`):
   - The pin snapped on and off between a bus stop and a metro station because the sheet height changed and the map re-centred.
   - The route screen's every-line plan pushed out the kept one.
   - Re-saving a trip dropped its stop ids.

## 4. How a plan is made now (`wip/engine`)

1. **The network in memory.** `TtcSource.warm()` loads every line, pattern, stop list and timetable: 282 routes, about 1,400 requests. It loads in the background behind riders, keeps the data on disk (`transit-cache.json`), and refreshes every 6 h while serving stale data. `patternsAt` is then a map lookup.
2. **Our own planner with changes** (`journey/raptor.ts`). A backward RAPTOR search over that network finds, for 1–4 rides, the journey that leaves latest and still arrives by the deadline. It then searches again with each found first line left out, to get alternatives. It returns structures (line, boarding stop, alighting stop), and `Engine.solve` times them like a hand-built route.
   - **Same network and deadline give the same ways.** The list no longer jumps.
   - When this finds 2 or more ways, TTC's planner and Google are not asked. They remain the fallback while the network loads, or when it finds little.
3. **Queue priority.** Riders' requests go first. Network refresh and the logger run inside `ttc.background()`. The logger is off unless `LOGGER=on`.
4. **Walks.**
   - Changes between stops are estimated at about 1 s per straight-line metre, calibrated on TTC's router.
   - Start and end walks use TTC's router, cached for a week, only when riders aren't waiting. Otherwise the estimate answers and the router is asked in the background.
5. **Live data for the first ride only.** It comes from the stop's board: one call per stop, shared for 15 s. That is the bus the leave time depends on.
6. **No empty answers from a planner that ran out of time.** A hand-built plan that fails or times out is a 503, so the phone keeps its last plan.
7. **Concurrent identical plans are shared.** Once the network is loaded, the quick part (`part=ttc`) is the full plan.
8. **`build_route` (AI and MCP).** It turns "321|335|518 to Sarajishvili, then metro" into a route: exactly those rides from the network, with a metro line change added when needed. The prompt now says which tool to use for what.

Measured after the change, on the same trip with the network loaded from disk (1.4 s at startup):

| Case | Time | TTC requests |
|---|---|---|
| Auto plan, first ask | 5.5 s | 7 (start/end walks, stop boards) |
| Same trip, next minute | 0.2 s | 0 |
| Three other trips across the city | 3.5–7 s | 5–10 |
| `build_route` 321\|335\|518 → metro | 0.7 s | 0 |

The automatic plan now lists 321 / 518 / 335 → metro 1 → metro 2 next to direct 302 and the bus + metro 2 ways. The rider's own route no longer needs building by hand.

Loading the whole network from TTC takes 14.5 min (1,085 requests, 425 patterns). It must persist in `DATA_DIR` (`/data`), so a redeploy doesn't start cold.

## 5. UX gaps (not fixed yet)

What a commuter wants: "I always take 321, 335 or 518 to the metro, then the metro. Tell me when to leave, and tell me when another way is faster today."

- **Saying a route should be enough.** Typing "321|335|518 → M" anywhere (trip form, chat) should build it. Chat can now do this with `build_route`; the trip form still needs the map builder.
- **Hand-built ways need a visible label** ("your route") and a clear state when they have no plan right now ("can't plan your route right now, showing the last known"), never a silent switch to automatic.
- **Tapping a row on the route screen ticks it.** Browsing changes what the trip uses. Show-on-map and keep should be separate.
- **Same-name stops across modes** (bus "M/S Sarajishvili" vs metro "Sarajisvhili") are not linked in the builder. The metro shortcut looks only 250 m around.
- **Save with no plan** should warn.
- **Home location.** The address search now uses Google Autocomplete (`wip/autocomplete`, merged here). Still, show the pin on a map when saving home, because a wrong home point makes every walk wrong.

## 6. Open items

- The first deploy loads the network in about 15 min of background TTC requests. Until then plans work as before, TTC first. On CapRover, `/data` must be a persistent directory, or every deploy starts cold.
- One TTC line (`1:minibusR25222`) answers 500. It stays out of the network until a later refresh loads it.
- `build_route` and the new prompt have not been run against the real Claude API from here.
- The new planner returns at most 4 rides and 400 m change walks. Tune after real use.
