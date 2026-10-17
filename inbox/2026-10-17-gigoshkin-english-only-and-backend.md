# English-only app, UI removed, backend ready for screens — gigoshkin, 2026-10-17 (evening)

## Decisions (George, 17 Oct)
- **The app is English-only.** No Georgian UI, no language switch. This replaces "Georgian first, design in English" (`06-design-direction.md` §0 rule 1, `CLAUDE.md`). Figma copy is English. The Georgian glossary and `ka-check` are kept for reference only.
- **All placeholder UI is removed** from `apps/mobile` (screens, components, theme). The app is an empty shell on top of `src/lib`, ready for your redesign. MVP look stays prototype Today v3.

## What changed for you
- **No Georgian font or Georgian copy rules** in Figma anymore (§8 of 06 is struck through).
- Onboarding in `05-build-plan.md` §4 no longer has a language step. I only struck that one item; the flow is yours to redo.
- **Your call: F5 "Georgian notice reader"** (`04-product-spec.md`). I didn't touch the spec. TTC and City Hall still publish notices in Georgian, and the chat still reads Georgian input but answers in English. So F5 can stay as "read a Georgian notice, explain it in English", or be renamed or dropped. Please decide and update 04.

## Backend now available to screens (all tested against live TTC, 17 Oct)
- `GET /plan`: itineraries, now with real boarding/alighting **stop ids** (TTC doesn't send them; matched from the stop list).
- `GET /stops?q=`, `GET /stops/near?lat=&lon=`, `GET /stops/:id/arrivals`, `GET /places?q=`: stop and place pickers and the live countdown, so Add trip and Today work without the chat.
- `POST /chat`: text, photo or PDF in; short reply plus action cards out.
- Stored trips + alerts: "Leave in N min" and "Departure time changed" pushes. They need a dev build (not Expo Go) and an EAS project id (open item for George).
- Client functions for all of these live in `apps/mobile/src/lib/api.ts`.

## Open
- Notification tap → open the trip: needs the Trip screen first.
- Confirmed events (from a schedule photo) have nowhere to be stored yet; that depends on how you design Add schedule.
