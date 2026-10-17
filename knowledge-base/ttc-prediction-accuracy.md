# How accurate are TTC's live arrival predictions?

Measured 17 Oct 2026 by George's session from the logger's own recording. Script: `apps/server/scripts/prediction-accuracy.mjs` (re-run it on newer data).

## Short answer
On a Saturday evening, TTC's live predictions miss by about 1–1.5 min when the bus is up to 10 min away, and they're off in both directions, not mostly one. At the end of a line, where buses wait, TTC is consistently optimistic: the bus leaves 2–5 min later than it says. Weekday rush hour is **not measured yet**.

## Data
- Sat 17 Oct, 15:30–20:30 Tbilisi time. Two recording gaps (30 and 22 min) are left out.
- Hot stops `1:1405` (Nutsubidze I M/D #33), `1:1406` (Ermile Bedia St #17), `1:1408` (Ermile Bedia St #14), all within 140 m of each other. Lines 347 (bus) and 558 (minibus).
- `arrival-times` every 30 s gives "route X in N min", for the next bus per route only. `positions` every 30 s gives where each vehicle is.
- **Ground truth:** the time a bus of that line and direction was last seen within 40 m of the stop, or, with no sample that close, when its `nextStopId` moved past the stop. With 30 s samples, each time is good to about ±0.5 min.
- Only one prediction per route is shown, so each prediction is matched to the first departure after it.

## Results
**Miss** = actual departure − predicted time (+ = later than TTC said). Each bus is counted once per 30 s prediction, so rows weigh buses unevenly; the "buses" column is the real sample size.

Bus passing through the stop:

| TTC said | Predictions | Buses | Median miss | 80% within | ≥2 min early | ≥2 min late |
|---|---|---|---|---|---|---|
| 0–2 min | 209 | 37 | +0.6 | 2.8 min | 0% | 29% |
| 3–5 min | 123 | 29 | +0.5 | 4.0 min | 7% | 27% |
| 6–10 min | 315 | 32 | 0.0 | 5.0 min | 17% | 23% |
| 11–15 min | 312 | 31 | +0.5 | 8.0 min | 30% | 35% |
| 16–20 min | 143 | 19 | +0.5 | 7.5 min | 31% | 46% |

Bus waited 3+ min at the stop (end of line; 1405 for these lines, waits of 5–27 min seen):

| TTC said | Buses | Median miss | ≥2 min late |
|---|---|---|---|
| 0–2 min | 6 | +2.0 | 55% |
| 3–5 min | 5 | +4.5 | 74% |
| 6–10 min | 6 | +3.6 | 69% |
| 11–15 min | 4 | +4.5 | 83% |

Predictions of 21+ min matched badly (median −17 min). The feed probably skips buses still parked at the end of the line, so those rows are left out.

## What it means for the app
- **Mid-route errors go both ways.** History-based correction (learning that "line X runs N min late") would add little there.
- **End-of-line stops lean one way** (late). That could be learned per stop, but needs more than 6 buses.
- **Margin on the leave time** covers the costly case, a bus that comes early: with TTC saying 6–10 min, the bus came 2+ min early 17% of the time; at 11–15 min, 30%. **In use since 17 Oct:** leave time = departure − walk − 20% of the walk (1–4 min), `leaveMarginMin` in `packages/shared/src/leave.ts`. The bus is about one walk away when you leave, and research finds error grows with the horizon ([Cats & Loutos 2013](https://swopec.hhs.se/ctswps/abs/ctswps2013_025.htm), [Dublin study](https://ceur-ws.org/Vol-1392/paper-13.pdf)). It's a rule of thumb; check it against more data. End-of-line stops don't need it (buses leave late there), but we can't tell those apart yet.
- **Predictions 15+ min out are rough** (80% within 7.5–8 min). Alerts re-plan every minute, so their times sharpen as the bus gets closer.
- Not measured: weekday rush, other lines, mid-route stops away from a terminus. All are needed before deciding on a history model.
