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
Trip detail "All ways to get there" (every option, "Never use N", "Skip minibuses"), the same list in the route builder ("Compare all ways"), and `trip/build` ("Build by hand": board stop → lines at it (untick any) → stops to get off at, closest to the end first → another ride or done).
