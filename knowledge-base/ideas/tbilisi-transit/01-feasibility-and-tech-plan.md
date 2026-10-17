# Tbilisi transit app: feasibility and tech plan

Author: research subagent for gigoshkin / AndroPetrosyan. Written Sat 17 Oct 2026, about 13:15 Tbilisi time (derived from HTTP `Date` headers; if the lead's clock disagrees, rescale the plan in section 7).
Status legend used throughout: **[V]** verified today by fetching the source or calling the endpoint; **[S]** from a secondary source or search snippet, not confirmed against primary docs; **[M]** from memory or general knowledge, NOT verified; **[?]** unknown, must be checked by the team.

## 0. Verdict (read this first)

**GO, but only as a tightly scoped demo, and it is not a "2-day" build any more.** Submissions close Sun 12:00 ([hf-challenge.md](../../hf-challenge.md)). From Sat ~13:15 that is about 22.5 wall-clock hours, realistically 13 to 16 hours of working time for the team after sleep. Plan for that, not for 48 hours.

What makes it feasible:
- The hard data problems are already solved by other people in public: a daily-updated TTC GTFS static feed, a live GTFS-Realtime vehicle-position feed (1,342 vehicles, 24 s old when I fetched it) **[V]**, a keyless multimodal routing API (Transitous/MOTIS) that returns Tbilisi itineraries today **[V]**, and an unofficial TTC gateway with per-stop arrival boards **[V via third-party docs]**.
- Everything the app needs to "feel smart" is deterministic engineering plus a thin LLM layer that explains decisions. No model training is required, and none is possible (no history).

What could sink it (details in section 6):
1. **Live-data quality.** The TTC "arrival" numbers are known to be wrong in specific ways (parked buses read "0 min", delay fields off by up to an hour). The "bus 301 is late, take 17" story only works if the ETA layer is trustworthy for the 2 or 3 routes you demo.
2. **Widgets and push on a real phone.** Both need a native build (Expo dev build or similar), not Expo Go and not a Lovable web app. Android is realistic in a day; iOS is a stretch and needs an Apple developer account and device **[M]**.
3. **It is a weekend.** There is no rush hour to demo live. The "late bus, take 17" moment must come from a recorded or injected scenario, labelled honestly.

Also relevant: **this idea already exists in the wild.** `trongio/gza` (Android app, "when do I leave, and when will the bus really arrive", created 2026-09-28) and `erik-balfe/tbilisi-transit` (PWA trip planner, pushed today) are public **[V]**. None has a licence (`license: None`), so treat them as reading material and prior art, not as code to copy. Your differentiator has to be the proactive decision loop (leave-by, reroute, reason shown, widget), not "another transit app".

## 1. What data actually exists (this changes the plan more than anything else)

The user says they "already have all available Tbilisi transport data" but not what it is. These are the public sources I could find, so you can compare against what the user has.

| Source | What it gives | Access | Status |
|---|---|---|---|
| TTC GTFS static via Transitous | Stops, routes, trips, timetables for bus, minibus, metro, cable car. Zip is 11.7 MB, rebuilt daily (last modified 2026-10-17 03:39 UTC) | `https://jbb.ghsq.de/gtfs/ge-tbilisi.gtfs.zip`, also `https://api.transitous.org/gtfs/ge_tbilisi-transport-company.gtfs.zip` (10.9 MB). No key. Licence for TTC data is not stated on the Transitous sources page (the Georgian Railway feed next to it is ODbL) | **[V]** headers only; I did not download or unpack the zip, so table contents (`stop_times`, `shapes`, `frequencies`) are **[?]** |
| TTC live vehicle positions (GTFS-RT) | One protobuf with all vehicles | `http://vm-gtfs.spline.de/gtfs-rt.pb`, no key, 111,752 bytes, header timestamp 24 s old. I decoded it by hand: 1,342 entities, **all `VehiclePosition`, zero `TripUpdate`, zero alerts**. Each has `route_id` (e.g. `1:R98113`), `start_date`, lat/lon/bearing, timestamp, `stop_id`, `vehicle.id`. **No `trip_id`.** Hosted on a third party's VM (spline.de, run by a volunteer for Transitous) | **[V]** |
| Transitous/MOTIS routing | Itineraries Tbilisi to Tbilisi: tested `GET https://api.transitous.org/api/v5/plan?fromPlace=41.7151,44.8271&toPlace=41.7099,44.7929&numItineraries=3` and got 4 itineraries (bus 328+300, 353 direct, etc.) in one call. Leg `realTime` was `false` in my sample | No key. Usage rules: open-source projects only, non-commercial, identify your app via headers, "contact before heavy use" (many `/plan` calls or many users), best effort, can be cut off | **[V]** call and rules ([rules](https://transitous.org/api/)) |
| TTC "PIS gateway" (what ttc.com.ge's transit web app uses) | `/v2/stops` (2,753 stops), `/v3/routes` (280 routes: 111 bus, 164 minibus, 2 metro, 3 cable car), per-stop arrival boards with `realtimeArrivalMinutes`, per-route vehicle `positions`, `/v2/plan` (OpenTripPlanner-shaped), geocoding | Unofficial, undocumented, needs an `x-api-key` header, **no CORS** (call from a server or native app only), key can rotate. Documented by a third party from live observation on 2026-09-28 ([TTC_API.md](https://github.com/trongio/gza/blob/main/docs/TTC_API.md)). I did not call it myself | **[S]** (third-party docs, not re-tested). **Ask the user whether this is "the data they have".** Terms of use are **[?]** |
| TTC official site | `https://ttc.com.ge` (Drupal site, Georgian/English). No developer/open-data page found in my search | n/a | **[V]** exists; no open API page found. Other repos wrapping a TTC API: [npm ttc-api](https://www.npmjs.com/package/ttc-api), `thatttim/TTC-Python-*` |
| Traffic | Not provided by TTC. See section 4 | | |

### Known data landmines (from the gza author's observations, [TTC_API.md](https://github.com/trongio/gza/blob/main/docs/TTC_API.md), **[S]**)
- A bus resting at a terminus shows `realtimeArrivalMinutes = 0` ("arriving") while it is actually waiting for its next scheduled departure. Observed repeatedly. Layover buses may also wait 300 to 450 m from the stop.
- `arrivalDelay` in the gateway planner is unreliable: ±1 hour errors, including negative values on on-time legs.
- `scheduledArrivalMinutes` can be large negatives for trips that never ran.
- Vehicle positions carry no speed. Speed needs two polls.
- In the GTFS-RT feed I decoded, vehicles have `route_id` but no `trip_id` or direction, so you must infer direction/pattern from `stop_id` and movement. Whether `stop_id` is the current or next stop is **[?]**: check it empirically in the first hour.
- Unknown ids return HTTP 500 rather than 404 (gateway).

**Questions to ask the user right now** (each changes the plan):
1. Exactly what files/endpoints do you have? Is it the gateway with a key, the GTFS zip, the GTFS-RT feed, or something else?
2. Do you have any **historical** vehicle positions or delays? If yes, real prediction becomes possible. If no, everything in section 3 stands.
3. Is there a traffic dataset, or only the transit data?
4. Does the hackathon allow building on existing public data/code written before the event? The deck text I could extract says only "Any language, any tool, any AI model" and does not mention pre-existing code **[?]**. Ask an organizer.

## 2. Recommended architecture and stack

Principle: **a dumb, honest pipeline with one small "explain" step, built so the demo never depends on live luck.**

```
 GTFS static (daily)      GTFS-RT vehicles (20 s)     [optional] TTC gateway boards     [optional] traffic API
        |                         |                              |                              |
        v                         v                              v                              v
 +---------------------------- Backend (one long-running process) ---------------------------------+
 | ingest: GTFS -> SQLite/Postgres (stops, routes, patterns, stop_times for today)                    |
 | poller: fleet snapshot -> in-memory vehicle state + compact log (per route/stop/hour aggregates)   |
 | enumerate: saved commute -> N itineraries (Transitous /plan  +  own direct-route SQL join fallback)|
 | re-time:   itinerary + live vehicles -> boarding ETA, arrival window, leave-by                     |
 | decide:    rules with hysteresis -> events (LEAVE_SOON, SWITCH_ROUTE, DELAYED, ALL_CLEAR)          |
 | narrate:   LLM turns structured facts into a one-line reason (template fallback if LLM fails)      |
 | notify:    Expo push (+ Telegram/ntfy fallback); write widget snapshot per commute                 |
 | API:       REST + OpenAPI  -> (Elva/Theneo generates an MCP server from it)                        |
 +----------------------------------------------------------------------------------------------------+
        ^                                     |
        |  REST / push                        |  push (data message) -> app/widget refresh
        |                                     v
  Mobile app (Expo React Native, Android first): saved commutes, stop picker, plan screen with reason chips,
  map, notification tap -> deep link, home-screen widget reading a cached snapshot
```

### Stack choices and why

| Layer | Pick | Why / alternatives |
|---|---|---|
| Mobile | **Expo (React Native) with a dev build**, Android first | The track says "a real phone app, not a web wrapper". Push and widgets need native code; Expo prebuild plus config plugins is the least-bad path. Expo Go cannot do remote push on Android from SDK 53 on **[V]** ([FAQ](https://docs.expo.dev/push-notifications/faq/)) and cannot do widgets **[V]** ([widgets doc](https://docs.expo.dev/versions/latest/sdk/widgets/)). Alternative: Capacitor around a web app; see Lovable section below. |
| Backend | **Node + TypeScript (Fastify) or Python (FastAPI), one always-on process**, SQLite file or Postgres | A poller (20 s) and a decision loop are natural in a long-running process. Do not put the poller in serverless edge functions; per-invocation limits and cold starts add risk **[M]**. Host on any cheap always-on host (Railway/Fly/Render/VPS) with the laptop as fallback behind a tunnel. |
| Routing | **Transitous/MOTIS `/plan` for option enumeration**, plus a hand-written "direct routes between stop A and stop B" SQL join as fallback | Self-hosting OpenTripPlanner/MOTIS is a 2 to 4 hour risk (graph build, Georgia OSM extract) with no payoff in 22 hours; skip. Note Transitous restricts commercial use and wants contact before heavy use **[V]**; for a hackathon with a handful of saved commutes, cache plan results for 5 minutes and identify the app in headers. The gateway's `/v2/plan` is an alternative if the user has its key **[S]**. |
| Live ETA | **Primary: gateway arrival board if the user has it; secondary/cross-check: own ETA from GTFS-RT vehicle positions** | The board already does stop-level ETA but has the terminus bug; the GTFS-RT feed is one cheap call for the whole fleet but you must do the trip matching yourself. Using both and flagging disagreement is itself a feature ("two sources disagree, showing the later one"). |
| LLM | Any hosted model via API (Claude/OpenAI/Gemini; prize credits exist per [hf-challenge.md](../../hf-challenge.md)), called from the backend with a strict JSON-in, 1-sentence-out prompt | Never let the LLM do arithmetic or choose the route. It narrates facts the engine already computed. |
| Push | **Expo push service** (free to send, 600 notifications/s per project limit) **[V]** ([FAQ](https://docs.expo.dev/push-notifications/faq/)), which relays to FCM on Android and APNs on iOS | Needs an FCM v1 credential uploaded to Expo for Android ([doc](https://docs.expo.dev/push-notifications/fcm-credentials.md)), about 30 to 60 min of console clicking **[M]** for time. Fallbacks: Telegram bot or ntfy for notifications; local scheduled notifications. |
| Widgets | **Android: native Jetpack Glance widget** injected by a custom Expo config plugin, reading a snapshot from SharedPreferences. **iOS: `expo-widgets`** only if someone has a Mac/Apple account | Details in section 5. |
| Maps | MapLibre + OSM tiles, or skip the map | The map is optional polish, not required for the decision loop. |
| MCP | Expose the backend's REST API as an MCP server via Elva/Theneo | Partner special prize (see [hf-challenge.md](../../hf-challenge.md): $4,800 Theneo + $7,200 Elva credits) and fits the "Mobile native: back the app with an MCP" suggestion. How well Elva handles your repo is **[?]**; try it early. |

### Where Lovable fits (verified, because this decides the track fit)

- Lovable's own public docs describe a web builder: React web apps, Cloud backend (database, auth, edge functions), Jobs (scheduled tasks), connectors including Firebase Cloud Messaging for sending push. The only "mobile" page is the **Lovable app for iOS/Android that lets you use Lovable from your phone**, not a native-app generator **[V]** ([llms.txt index](https://docs.lovable.dev/llms.txt), [FCM connector](https://docs.lovable.dev/integrations/firebase-cloud-messaging.md), [Jobs](https://docs.lovable.dev/features/jobs.md)).
- The FCM connector sends notifications but "does not register devices or report whether a notification was opened", and device registration is on you **[V]** (same FCM page).
- Third-party articles say consistently that Lovable output is a Vite/React web app, with no Swift/Kotlin/Expo export, and that going native means a PWA, Capacitor wrapper, or a rewrite; PWA push on iPhone only works after "add to home screen" **[S]** ([dev.to](https://dev.to/batmanofweb/lovable-mobile-app-what-you-actually-get-1jmp), [shipnative](https://www.shipnative.dev/blog/lovable-mobile-app)).
- The hackathon deck says Track 03 is "A real app for the phone. Not a website in an app frame. Lovable builds it for you. Early access: connect Lovable on your profile and check in." **[V]** (deck JS at opening.hacktoberfest.ge). **I could find no public description of what this early-access native output is, or whether it supports push and widgets. [?]** Action item: someone walks to the Lovable table in the first 30 minutes and asks: "what does early-access mobile native generate (Expo? Swift?), does it support push notifications and widgets, and can we bring our own backend?" Do not plan around the answer until you have it.
- Safe use of Lovable regardless: a web "decision inspector" (shows the event log, inputs and reasons for each notification, the "everyone can see who did what" spirit of Track 01), the PWA fallback client, and the landing/demo page. Lovable credits unlock Sat 12:00 via hacktoberfest.ge/profile ([hf-challenge.md](../../hf-challenge.md)).
- Track choice: Track 03 (Mobile native) fits best if the app is a real installed app with widget and push. Track 01 ("Make it better": rebuild Google Maps/Transit as if AI existed) is also arguable, and the organizers' warning "Adding a chatbot to the old app is not enough" is exactly the framing you already have. Judging is problem clarity, creative solution, problem-solving effectiveness; business model is not scored ([hf-challenge.md](../../hf-challenge.md)).

## 3. What is "prediction" and what is just engineering (be honest in the pitch)

There is no training data, so nothing here is a trained model. Say so; the judges are "tech people, nerds".

| Capability | Honest label | How |
|---|---|---|
| List all route options between saved stops | Engineering | Transitous `/plan` (several itineraries) plus a SQL join over GTFS `stop_times` for direct options |
| Walking time to the boarding stop | Engineering | Distance / walking speed, from OSRM/Transitous walk legs or haversine x 1.3 |
| Scheduled departures today | Engineering | GTFS calendar + `stop_times` (mind times past 24:00 on the previous service day; the gateway docs show `24:05`-style times, **[S]**) |
| "Leave in N min" | Arithmetic | `leave_by = boarding_ETA - walk_time - user_buffer` |
| Boarding ETA from live data | Heuristic estimation | Take vehicles on the route heading the right way whose next stop precedes your stop; remaining stops' scheduled inter-stop times, scaled by an observed speed factor; or read the gateway board. State the formula in the UI |
| "Bus is N min late" | Derived signal | ETA minus scheduled time for the matched trip. Matching a vehicle to a scheduled trip is non-trivial without `trip_id` (section 1). On high-frequency routes, use headway ("next bus in 4 min, then 11") instead of lateness |
| Arrival window (e.g. 08:41 to 08:49) | Heuristic band | Widen by an assumed per-stop uncertainty and by how stale/noisy the sources are. The constants are guesses; label as "estimated window", not "predicted with 90% confidence" |
| Traffic effect | Heuristic | Use the buses' own observed speeds on a corridor as the traffic signal (free and relevant), optionally corroborated by a road-traffic API (section 4) |
| Learned per-route/hour delay profile | "Online learning, tiny data" | Log aggregates from the poller from the first hour; by Sunday you have under 24 hours of weekend data. Useful for anomaly flags ("slower than usual for this hour") only if you label the sample size. A regression model is not credible in this window; do not claim ML |
| Switch recommendation | Rules + hysteresis | Notify only if the alternative improves arrival by at least ~3 min AND the primary slipped by more than a threshold, with a cooldown so it never flip-flops |
| The reason text | **The LLM's real job** | Facts in as JSON (route, delay, source, alternative, delta), one friendly sentence out, in English/Georgian. Template fallback if the call fails or output is not grounded in the input |
| Natural-language access | LLM via MCP | "When should I leave for work tomorrow?" through the Elva-generated MCP server |

If the user has historical positions/delays, upgrade the middle rows to a real quantile model (per route/stop/hour). Without that, don't.

## 4. Traffic data options (free-tier reality)

Key insight: for buses, the best "traffic" signal is **the buses themselves** (GTFS-RT positions over time give segment speeds for free, and they are about exactly the routes you care about). Road-traffic APIs are corroboration, and mostly relevant for roads, not bus lanes or the metro.

| Option | Facts | Status |
|---|---|---|
| Fleet-derived speeds | Needs two polls of the GTFS-RT feed; positions carry no speed | **[V]** feed, derivation is your code |
| Google Routes API | Traffic-aware routing (`TRAFFIC_AWARE`, `TRAFFIC_AWARE_OPTIMAL`) bills at the "Pro" SKU. **Transit-mode routes cannot request traffic data at all**, so it only helps for driving/taxi comparison. The old universal $200 monthly credit was retired in March 2025 and each SKU has its own small free tier; exact current free quota for Pro **[?]** | **[V]** SKU and transit limitation ([billing](https://developers.google.com/maps/documentation/routes/usage-and-billing), [transit route doc](https://developers.google.com/maps/documentation/routes/transit-route)); credit retirement **[S]** ([woosmap](https://www.woosmap.com/blog/is-google-maps-api-free)). Needs a billing account with a card |
| TomTom Traffic Flow Segment Data | Returns current vs free-flow speed and travel time for the road fragment nearest a coordinate. Free account about 2,500 requests/day, 5 requests/s on non-tile APIs | Quota **[S]** (search snippet, [TomTom docs](https://developer.tomtom.com/traffic-api/documentation/traffic-flow/flow-segment-data)). **Coverage of Georgia/Tbilisi traffic flow: [?]**, the market-coverage page is JS-rendered and I could not read it |
| HERE, Mapbox | Both offer traffic-aware routing and a free tier | Not verified. **[?]** |
| Waze/Yandex/Bolt-style crowd data | No public API I could confirm | **[?]** |

Recommendation: ship fleet-derived "corridor slowdown" as the traffic story. Add one TomTom or Google call for a single driving corridor only if (a) coverage in Tbilisi is confirmed with one test call and (b) a teammate has time. Otherwise cut.

## 5. Notifications and widgets: what is real

### Push notifications
- Expo push is free and relays to FCM/APNs **[V]**. From SDK 53, remote push does not work in Expo Go on Android; you need a development build **[V]** ([FAQ](https://docs.expo.dev/push-notifications/faq/), [dev builds](https://docs.expo.dev/develop/development-builds/introduction/)). Latest docs I read are for Expo SDK 58.
- Android is easy to demo: `.apk` install on a phone, FCM credential in Expo. iOS push needs APNs credentials and therefore a paid Apple developer account and TestFlight/ad-hoc device build **[M]**; skip iOS unless someone already has this.
- Web push (PWA) works on Android Chrome; on iPhone only for installed home-screen PWAs **[S]** (dev.to link above). Acceptable fallback, weaker story.
- Hard fallback: Telegram bot messages (30 min of work, no native build, no credentials beyond a bot token) or `ntfy.sh`. Clearly weaker for "real phone app" scoring, but guarantees the demo shows a notification.
- Design rule: send **data-rich** pushes with a deep link; the tap opens the plan screen with the reason chips. One push per decision change, with cooldown.

### Home-screen widgets
- **Expo:** `expo-widgets` builds iOS widgets and Live Activities using Expo UI components; it is not available in Expo Go; the widget code runs in an isolated runtime with only SwiftUI components and **no hooks, no app state, no async work** **[V]** ([doc](https://docs.expo.dev/versions/latest/sdk/widgets/)). One search snippet from the SDK 55 time frame called it alpha **[S]**; the current page shows no alpha banner in what I read; treat as "new, expect rough edges". The Android entries I saw in that page relate to custom notifications, not widgets; I could not confirm `expo-widgets` makes Android home-screen widgets **[?]**.
- **Android widgets:** Jetpack Glance via a custom Expo config plugin plus Kotlin, data handed over through SharedPreferences, no widgets in Expo Go **[S]** ([reactnativerelay, Sep 2026](https://reactnativerelay.com/article/react-native-android-widgets-expo-glance-2026)). Prior art: `whekin/kojori-bus-time-app` (Expo + Android widget module) shows it has been done by one person in a Tbilisi context **[V]** exists, no licence. Expect 3 to 5 hours for a first widget if nobody on the team has written one.
- **Capacitor:** only a third-party WidgetKit plugin (`@capgo/capacitor-widget-kit`, iOS-only, App Group storage) turned up **[S]**; nothing for Android widgets that I verified. Another reason not to base the native story on Lovable web plus Capacitor.
- **Lovable:** no documented widget support **[V absence in docs index]**. A Lovable-generated web app cannot produce a home-screen widget.
- **Design implication (important):** a widget does not think; it shows a snapshot. Make the backend write a small JSON `{commuteId, leaveBy, boardingStop, route, etaWindow, status, reason, generatedAt}` and (a) push it to the app via a data message which writes it to shared storage, (b) render **absolute times** ("Leave 08:12") rather than countdowns so the widget stays correct between refreshes. Android's periodic widget update has a floor of about 30 min **[M]**, so rely on push-triggered updates plus absolute times. iOS widgets refresh on a system-managed budget **[M]**.
- Honest framing for judges: "widget shows the engine's latest decision", not "the widget predicts".

## 6. Riskiest pieces, ranked, with fallbacks

| # | Risk | Likelihood / impact | Mitigation and fallback |
|---|---|---|---|
| 1 | Live ETA wrong or flaky (terminus buses, no `trip_id`, `stop_id` semantics unclear, gateway key rotates, single volunteer-hosted RT feed) | High / High | Hour 1 to 3: validate ETA for 2 or 3 chosen routes by watching real buses. Record raw feed snapshots to disk from the first minutes (fixtures, replay mode). Pick demo routes that start far from termini. Cache last good response. Cross-check two sources. |
| 2 | Native build pipeline (Android SDK, EAS/Gradle, dev build, FCM creds) eats the first afternoon | Medium-high / High | One person does it first thing and unblocks the rest within 90 min. Use `expo run:android` locally if EAS queue is slow **[M]**. Keep a PWA path alive (Lovable/React) as emergency demo client. |
| 3 | Widget | Medium / Medium | Do it last among must-haves. Fallback: show a screenshot/short video of the widget, or a static "pinned notification". Be explicit in the pitch about what is live. |
| 4 | No rush hour on a weekend | Certain / Medium | Build a **scenario injector** (backend flag: "delay vehicle X by 7 min" or replay a recorded slice) and say in the pitch "live data, with a staged incident because it is Sunday". Judges prefer honest to faked. |
| 5 | Notifications arrive late or never at demo time | Medium / High | Test on the actual venue wifi/phone the day before. Have the Telegram path ready. A "send test push" button in the app. |
| 6 | Data terms / rate limits (Transitous non-commercial and "contact first", unofficial TTC gateway, unlicensed prior art repos) | Medium / Low for a hackathon | Identify the app in headers, cache plan results, poll the RT feed at most every 15 to 20 s, do not commit keys (shared repo rule in [CLAUDE.md](../../../CLAUDE.md)), do not copy unlicensed code. Say "unofficial, TTC data" in the credits. |
| 7 | iOS | High if attempted / Low | Do not promise iOS. Android demo only. |
| 8 | Scope creep / LLM theatre | High / High | LLM only narrates. Cut list below. |
| 9 | Lovable mobile-native early access turns out to be required or useful and nobody asked | Medium / Medium | Ask in the first 30 minutes (section 2). |

## 7. Build plan (assumes start Sat ~13:15, freeze Sun 10:30, submit by 11:30; three people)

If it is actually earlier or later, shift the whole timeline and keep the ordering. Times are local.

Roles: **A = Backend/data/engine**, **B = Mobile app**, **C = Notifications, widget, AI narration, demo/pitch**. With 2 people, B also takes C's push work and drops the widget to stretch; with 4 to 5 people, add D = QA/replay-scenario/design and E = iOS/MCP/Lovable inspector.

### Saturday

| Time | A: Backend/engine | B: Mobile | C: Push / widget / AI / demo |
|---|---|---|---|
| 13:15-14:00 | Ask user the 4 questions. Repo skeleton. Download GTFS **(get explicit OK first if your policy requires it)** and unpack; list tables and sizes. Start the recording poller of the GTFS-RT feed (raw files, every 20 s) | `npx create-expo-app`, install Android SDK, run a dev build on a real phone | Firebase project + FCM credential into Expo; decide Telegram fallback; walk to Lovable desk with the mobile-native question; check Elva signup |
| 14:00-16:00 | GTFS to DB (stops, routes, patterns with ordered stops, stop_times for today/tomorrow). `/stops/search`, `/stops/:id/routes`. Vehicle state from RT feed; validate `stop_id` semantics against a real bus | Navigation + "pick a stop" screen (search, nearby), saved commute model (home stop, work stop, arrive-by time, buffer). Local storage | Token registration endpoint + "send test push" button; first push on a real phone end to end |
| 16:00-19:00 | Itinerary enumerator: Transitous `/plan` with caching, plus direct-route SQL join. Re-timer: boarding ETA from vehicles (and gateway board if available). Leave-by arithmetic | Commute list with "leave in N min" and ranked options; plan detail screen with reason chips | Decision engine v1 (events, hysteresis) shares code with A. Start LLM narrator: prompt, JSON schema, template fallback, 10 test cases |
| 19:00-21:00 | Scenario injector (`POST /demo/delay`), replay from recorded snapshots. Persist event log | Notifications received, deep link to plan screen, event history list | Narrator wired in with grounding check. OpenAPI spec cleaned up; connect repo to Elva, see what MCP comes out |
| 21:00-23:00 | Deploy backend to always-on host. Smoke test from phone on mobile data | Polish, i18n ka/en, error and empty states | Android widget spike (config plugin + Glance + SharedPreferences), static data first |
| 23:00 | Stop. Sleep. A tag: leave poller recording overnight if the host is up | | |

### Sunday

| Time | A | B | C |
|---|---|---|---|
| 07:30-09:30 | Check overnight logs. Fix top ETA bugs found. Tune thresholds/hysteresis with real weekend data | Widget display wired to snapshot; app polish | Widget refresh from push; second MCP/Elva pass; "ask Claude" demo query works |
| 09:30-10:30 | **Feature freeze at 10:00.** Only bug fixes. Deploy final | Build release APK, install on demo phone and a spare | Record a 90 s backup demo video; write submission text and README |
| 10:30-11:30 | Dry run of the demo script end to end twice | Same | Submit (do not wait for 12:00). Re-check what the submission form needs **[?]** (not in my notes) |
| 12:00 | Submissions close | | |
| 16:00-18:10 | Top 10 announced, pitches, awards: have the phone, cable, backup video, and the scenario injector ready ([hf-challenge.md](../../hf-challenge.md)) | | |

### 3-minute demo script (design the product around this)
1. Open app: saved "Home to Work" commute, shows "Leave 08:12 (in 11 min), arrive 08:41 to 08:49".
2. Lock phone; widget on home screen shows the same snapshot.
3. Trigger the staged incident (labelled): push arrives "Leave in 4 min: bus 301 is 6 min behind, 17 gets you there 4 min earlier" with the reason; tap opens the plan screen showing inputs (vehicle positions, scheduled vs live, corridor speed).
4. Show the MCP log (Elva) answering "when should I leave tomorrow?" from another AI client.
5. One sentence of honesty: what is live, what is staged, what is heuristic.

## 8. What to cut (in this order if time slips)

1. iOS entirely, Live Activities, Apple Watch.
2. Road-traffic API (fleet-derived speed is enough).
3. Metro/cable car fine detail; focus on buses/minibuses first (metro is timetable-only in the gateway **[S]**).
4. Map screen (keep a simple list of stops).
5. Accounts/auth: use a device id; no sign-up.
6. Multiple cities, multi-language beyond ka/en, accessibility modes.
7. Widget (replace by video) only if the push loop is not rock solid by Sun 08:00.
8. MCP/Elva only if the core loop is late; but it is cheap and prize-aligned, so protect ~1 hour.

Must-have core (the whole product in one line): **saved commute -> enumerated options -> live-adjusted leave-by and arrival window -> push on meaningful change with a reason -> widget showing the latest snapshot.**

## 9. Things I could not verify (consolidated)

- Contents of the GTFS zip beyond headers (stop_times, calendar, shapes, frequencies), and whether it includes minibus routes with real timetables (the gateway docs imply ~164 minibus routes exist).
- Whether Tbilisi traffic flow exists in TomTom/HERE/Mapbox feeds; exact current Google Routes free quota; Google coverage of Tbilisi transit.
- What Lovable's "Mobile native" early-access output really is, and whether it supports push or widgets.
- Whether `expo-widgets` supports Android home-screen widgets.
- Terms of use for the TTC gateway and the TTC data licence.
- Hackathon rules on pre-existing code and the exact submission format.
- The gateway behaviour in section 1 comes from a third-party write-up dated 2026-09-28; I did not call it. I also did not retrieve or use its key, and recommend the team not extract keys from TTC's app config unless the user confirms that is how they got their data and they are comfortable with it.
- Android widget minimum update interval, iOS refresh budgets, Apple Developer fee and APNs requirements, Supabase/edge-function limits, EAS free-tier queues: all from memory.
- Clock/timeline: derived from HTTP headers; confirm the actual time.

## 10. Sources

- Event rules, tracks, judging, prizes, partner tools: [hf-challenge.md](../../hf-challenge.md); deck at https://opening.hacktoberfest.ge/deck/hf-challenge
- Transitous sources (TTC feeds, RT feed credit): https://transitous.org/sources/ ; API rules: https://transitous.org/api/ ; feed config (maintainer `jbruechert`): https://github.com/public-transport/transitous/blob/main/feeds/ge.json
- TTC GTFS: https://jbb.ghsq.de/gtfs/ge-tbilisi.gtfs.zip ; GTFS-RT: http://vm-gtfs.spline.de/gtfs-rt.pb ; Transitous MOTIS API: https://api.transitous.org/api/v5/plan
- TTC gateway documented by third party: https://github.com/trongio/gza/blob/main/docs/TTC_API.md ; project README https://github.com/trongio/gza
- Similar projects: https://github.com/erik-balfe/tbilisi-transit ; https://github.com/whekin/kojori-bus-time-app ; wrappers: https://www.npmjs.com/package/ttc-api , https://github.com/sunney-x/ttc-api
- TTC site: https://ttc.com.ge
- Lovable docs index: https://docs.lovable.dev/llms.txt ; FCM connector: https://docs.lovable.dev/integrations/firebase-cloud-messaging.md ; Jobs: https://docs.lovable.dev/features/jobs.md ; mobile app page: https://docs.lovable.dev/integrations/lovable-mobile-app.md
- Lovable and native, third-party: https://dev.to/batmanofweb/lovable-mobile-app-what-you-actually-get-1jmp , https://www.shipnative.dev/blog/lovable-mobile-app , https://capawesome.io/blog/convert-lovable-app-to-mobile-app/
- Expo widgets: https://docs.expo.dev/versions/latest/sdk/widgets/ ; push FAQ: https://docs.expo.dev/push-notifications/faq/ ; FCM credentials: https://docs.expo.dev/push-notifications/fcm-credentials.md ; dev builds: https://docs.expo.dev/develop/development-builds/introduction/
- Android widgets with Expo and Glance: https://reactnativerelay.com/article/react-native-android-widgets-expo-glance-2026
- Capacitor WidgetKit plugin: https://capgo.app/docs/plugins/widget-kit/
- Google Routes billing: https://developers.google.com/maps/documentation/routes/usage-and-billing ; transit routes: https://developers.google.com/maps/documentation/routes/transit-route ; pricing context: https://www.woosmap.com/blog/is-google-maps-api-free
- TomTom: https://developer.tomtom.com/traffic-api/documentation/traffic-flow/flow-segment-data ; https://docs.tomtom.com/pricing
