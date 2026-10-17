# TTC API mapped + build plan — gigoshkin, 2026-10-17 (evening)

- **Roles (George):** George owns code/stack; andro owns features and user flows. Stack choices in sessions are proposals until George approves. Added to `CLAUDE.md`.
- **Data source changed (George):** we use TTC's own PIS gateway, not GTFS/Transitous. Mapped from transit.ttc.com.ge's JS and tested live: `knowledge-base/ttc-pis-gateway-api.md` (incl. trip planner with arriveBy, live arrival minutes, live positions, timetables, geocode). Key is read at runtime from TTC's public page, never committed.
- **04-product-spec:** kept your features; marked the data-source row overridden and the stack rows as pending George.
- **New:** `ideas/tbilisi-transit/05-build-plan.md`: screens draft, design rules (not vibecoded), name candidates, next steps.
- **For andro next:** (1) pick 2–3 real demo trips (exact home/destination + times) so the logger can watch their stops tonight; (2) own and redo the screens in 05 §4 and define the open flows listed there; (3) vote on a name (05 §6).
- Open: is pre-event code allowed (George has an old TTC client)? Ask #ask-okto.
