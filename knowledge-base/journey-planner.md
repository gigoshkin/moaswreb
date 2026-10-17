# Journey planner: every line, link by link (gigoshkin session, 17 Oct 2026)

Why: TTC's planner returns about 3 options, each with one line, and cannot exclude a line. George wants "home → stop 1 (321, 335, 518) → stop 2 → 10 m walk → metro" with **all** lines compared at once and a per-trip "never 518" / "no minibuses". Code: `apps/server/src/journey/`, used by `PlanService` (`apps/server/src/plan/service.ts`).

## Model
A trip is walk, ride, (walk, ride)…, walk. A **ride** is `{ fromStops, toStops, routes? }`: any line that visits a boarding stop and then an alighting stop. With no `steps` the server uses the stops within 900 m of the start and end (14 each) and finds every line between them. Hand-built routes send `steps`.

"Arrive by T" is solved **backwards**: the last ride is the latest one that arrives in time (after the walk to the end), the walk and a 2 min margin before it give the time to be at the earlier stop, and so on. Taking the latest option at each link is optimal for a chain, so all lines are compared against the same deadline. "Leave now" (deadline within 12 h) is the same walk forwards from the current time. A deadline further away is planned from timetables only.

## Where each number comes from
- **Ride time:** timetable difference between the boarding and alighting stop on the same trip (`v3/routes/{id}/schedule`). Exact service dates are matched first (holidays), else the weekday range. Times pass 24:00 ("25:01") and are read as the same service day.
- **Wait:** live vehicles at the boarding stop (`v2/stops/{id}/arrival-times?routeId=`, realtime only, up to 4) replace the timetable while TTC reports them; the timetable takes over after the last live vehicle. Live ride time still comes from the timetable.
- **Walking:** TTC's own router (`v2/plan` with `modes=WALK`), cached 7 days; a straight-line estimate if that fails (not cached).
- **Transfers / lines the engine can't build:** TTC's planner, minus anything the trip avoids; with an avoid list it is asked again with `lessWalking` and `fewerTransfers` so it isn't left with nothing.
- Minibus = route id contains `minibus` (166 of 277 routes). `PlanAvoid = { routes?: ["518"], minibus?: true }`, **per trip**.

## Checked against TTC (live data, Mon 19 Oct, arrive by 09:00, 5 trip pairs)
`npx node apps/server/scripts/compare-plan.ts` asks our planner for exactly TTC's stops and line. 11 single-line trips: ride time differs by 0.3 min on average (max 1), departure by 0.6 min (max 3). This also caught a bug: the timetable's `position` is not always 0-based, so stops are now lined up with the pattern in order. Not yet measured: live-estimate accuracy during the day (see `ttc-prediction-accuracy.md`), holidays, trips needing transfers (those are TTC's numbers).

## Limits and costs
- TTC allows ~1.4 requests/s through our queue. A new area loads lines and timetables once (about 40 s, up to 25 s waited for by a request; the rest finishes in the background and the next request is fast). Static data is kept on disk (`DATA_DIR/transit-cache.json`), so a restart does not start cold. Repeat requests are served from memory.
- The engine keeps the 2 stop pairs with the least walking per line.
- Metro is a normal route (`Metro_Metro_1`, timetable every ~8 min, no live data), so it works as a ride.

## API
- `GET /plan?…&avoid=518,321&avoidMinibus=true`
- `POST /plan/journey { from, to, arriveBy, steps[], avoid? }`
- `GET /stops/:id/lines`: lines at a stop and the stops each visits next
- `PUT /me/trips`: `avoid` and `steps` are stored with the trip, so the alert watcher plans the same way as the phone.

## App (branch `wip/google-map`, untested on a phone)
Plates are coloured by type (bus green, minibus blue, metro red). Rides are drawn like Google Maps: an arrow between rides means you change; numbers stacked on each other are alternatives for the same ride (same stops). Trip detail "All ways to get there" and the route builder's "All ways" group the options that way; tap one to open it, see it on the map, or say this trip never uses a line. `trip/build` ("Pick stops on map"): every stop is a tappable dot (or move the pin and use the nearest) → the lines at it are drawn on the map (tap one to leave it out) → tap the stop to get off → another ride or done.

## Builder rail and road shapes (branch `wip/builder-redesign`, untested on a phone, 18 Oct)
- The by-hand builder keeps one list of rides (`apps/mobile/src/lib/chain.ts`: insert, replace, remove, per-ride line switches, Undo up to 20 steps). The sheet is a rail: start, walk, ride, walk, ride, destination. "Get off" adds the ride straight away. A metro station within 250 m is offered as a button, never chosen for you.
- Pick rule (app `choose()` and server `bestItinerary`): among options within 5 min of the latest leave, least walking minutes plus 8 per change wins, then the later leave.
- Road shapes: TTC has no line geometry, but its planner draws legs along roads. `GET /stops/shape?from&to&route` asks the planner for exactly that ride once (midday tomorrow, mode of the boarding stop), keeps the leg's polyline if it is the same line and starts/ends within 200 m of the stops, and caches it for good (memory plus `DATA_DIR/shapes.json`; a miss is retried after a day). The phone keeps shapes too (`lib/shapes.ts`) and draws a ride along the road once known, otherwise straight between stops. The black "every line from here" preview is still straight. Live check: 347 from 1:1405 returned a shape in 0.85 s, 7 ms the second time.
