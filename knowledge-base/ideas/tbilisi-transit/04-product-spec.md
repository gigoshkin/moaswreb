# Tbilisi transit: agreed product spec

Written Sat 17 Oct 2026, ~15:00 Tbilisi time. Supersedes the open questions in reports 01 to 03 where they conflict. Status labels: **[decided]** = team decision today; **[V]** = verified by fetching the source; **[?]** = still to check.

## 1. One-liner

**Upload your work / uni schedule once; the app builds every trip from your home, tells you when to leave, and warns you, with a reason, when something changes.** No chat box: the AI works under the features.

## 2. Decisions

| Topic | Decision | Notes |
|---|---|---|
| Platform | **Expo (React Native) Android app** [decided] | Real native app for Track 03. Needs a dev build (not Expo Go) for remote push. iOS out of scope. Demo on a real Android phone. |
| Track | **Track 03 Mobile native**, Track 01 language in the pitch | Per reports 01 to 03. |
| Transit data | **Public TTC feeds, no key** [decided] | GTFS static + GTFS-RT vehicle positions + Transitous/MOTIS routing (sources in report 01 section 1). Not the unofficial TTC gateway; do not use the key published in third-party code. |
| AI provider | Claude API (`@anthropic-ai/sdk`), model configurable by env var | Vision and PDF input are needed for schedule upload. Key goes in an env var, never committed. |
| Backend | Node + TypeScript, one always-on process, SQLite | Poller and decision loop need a long-running process (report 01 section 2). |

## 3. Features in the first build

### F1. Home point
- User sets home once: address search (geocode) or current location.
- All trips start or end here.

### F2. Schedule upload, AI-parsed [decided: all four inputs]
| Input | How it is read |
|---|---|
| Photo / screenshot (e.g. a printed uni timetable) | Claude vision |
| PDF (uni portal / HR export) | Claude PDF input |
| Calendar file (.ics) or calendar link | Fetched server-side, read by Claude (handles recurrence and messy titles) |
| Typed or pasted text ("Mon/Wed 10:00 lectures at Free Uni, Fri 9-18 office in Vake") | Claude |

- Output: a list of weekly events `{title, kind: work|uni|other, days[], start, end, place_name, address?}`.
- Places are geocoded (MOTIS `/api/v1/geocode`, fallback OSM Nominatim) and the **user confirms or fixes each place** before trips are built. Georgian and English text both supported.
- AI only extracts; it never invents times or places. Unreadable items are flagged, not guessed.

### F3. Trip builder and weekly plan view [decided]
- For each event: an outbound trip home → place (arrive by start minus a buffer) and a return trip place → home (depart at end).
- Routes come from Transitous/MOTIS `plan` with `arriveBy=true`; several itineraries kept.
- **Weekly plan view:** a 7-day list of every trip: leave-by time, route (e.g. "306 → metro"), duration, arrival window.

### F4. Leave-by alerts with reasons [decided]
- Background loop re-plans trips starting in the next ~2 hours using live bus positions.
- Push notification only when the decision changes (leave-by moves ≥ 3 min, a different route is better, or it's time to go), with a cooldown.
- One-line reason, e.g. "Leave 6 min earlier: 306 is behind on the Rustaveli detour, 17 gets you there 4 min sooner." Code computes the numbers; the LLM only phrases them (template fallback if the call fails).
- Trip detail shows the plan history: who changed it (planner / notice reader / you), when, and from which data.

### F5. Georgian notice reader [decided]
- Paste a TTC / City Hall / news notice (Georgian or English).
- Claude extracts `{area, streets, start, end, affected routes, modes}`, then checks it against **the user's own trips** and says which are affected and why.
- Affected trips are re-planned with itineraries that avoid the affected routes, and the user gets an alert.
- This is the clearest "AI is necessary" moment for the demo (see section 4).

### F6. Reliability scorecard [decided]
- Logger polls the GTFS-RT feed every ~20 s from day one and records observed arrivals per route / stop / hour.
- Every prediction the app makes (boarding window) is stored and later checked against observed arrivals.
- Scorecard screen: % of predictions that landed inside the window vs the printed timetable, with sample size shown. Label honestly as "learned from N hours of live data".

### Demo support
- Scenario controller (backend flag): inject a delay on a route, inject a notice, set a demo clock. UI shows a `LIVE` / `REPLAY` badge. Rationale: Sunday has no rush hour (reports 01 and 03).

### Not in the first build
- Home-screen widget (stretch, Android only, see report 01 section 5).
- iOS, accounts/login (device id only), payments, chat interface, marshrutka live data (none exists; show wider windows instead).

## 4. What the AI does (for the pitch and Q&A)

| Job | Technique | Real AI? |
|---|---|---|
| Read schedules from photo / PDF / calendar / text | Claude vision + extraction to a fixed schema | Yes |
| Read Georgian disruption notices and match them to *your* trips | Claude extraction + matching | Yes, the strongest one |
| Learn how late each line runs | Statistics on logged live data | Learned, small data |
| Decide when to notify | Rules + hysteresis + cooldown | No (engineering) |
| Explain changes | Claude narrates numbers computed by code | Yes, narrator only |

Rule: **LLMs parse and narrate; numbers always come from code.**

## 5. Technical notes found today

- **MOTIS API version [V]:** the current MOTIS OpenAPI spec (github.com/motis-project/motis, `openapi.yaml`, master) lists `/api/v6/plan`; report 01 tested `/api/v5/plan` on Transitous. **[?]** Check which versions Transitous serves; keep the path configurable.
- Useful `plan` parameters [V, from the spec]: `fromPlace`, `toPlace` (`lat,lon` or stop id), `time`, `arriveBy`, `numItineraries`, `transitModes`, `pedestrianSpeed`, `language`.
- Leg fields [V, from the spec]: `mode`, `from`, `to`, `startTime`, `endTime`, `scheduledStartTime`, `scheduledEndTime`, `realTime`, `routeShortName`, `routeId`, `tripId`, `headsign`, `intermediateStops`, `legGeometry`.
- Geocoding [V, from the spec]: `/api/v1/geocode?text=...`, returns matches with `name`, `lat`, `lon`, `street`, `houseNumber`, `areas`.
- Data landmines from report 01 still apply: GTFS-RT has no `trip_id`, terminus buses read "0 min", single volunteer-hosted RT feed. Start the logger early and save raw snapshots for replay.
- The Claude Code cloud session could not reach `jbb.ghsq.de`, `api.transitous.org` or `vm-gtfs.spline.de` (network policy), so nothing above was re-tested against live data today. Test from a laptop.

## 6. Suggested split for two people

- **Person A, backend:** GTFS ingest, GTFS-RT logger, MOTIS planner client, trip builder, decision loop, schedule and notice parsing (Claude), push sending, scorecard, scenario controller.
- **Person B, phone:** Expo dev build on the demo phone, home setup, upload screens (camera / file / text / link), event confirmation screen, weekly plan, trip detail with reasons and history, notice screen, scorecard, push registration.
- First checkpoint: a photographed timetable becomes a confirmed weekly plan with real routes on the phone.

## 7. Open questions

1. Which MOTIS API version does Transitous serve today (v5 or v6)? **[?]**
2. Does the hackathon allow code or data prepared before the event? (report 01) **[?]**
3. Who owns the demo phone, the replay recording and the backup video?
4. Which real Georgian notice will be used on stage? Pick one about the Rustaveli works and keep its source link.
