# Tbilisi transit: features, demo strategy, scope, track

Author: feature-design session (Claude), 2026-10-17. Status: proposal for the founders to challenge.
Sources: event rules from `knowledge-base/hf-challenge.md`; Transit app GO behaviour from https://help.transitapp.com/article/104-get-notifications-about-your-trip-with-go ; everything about Moovit, Google Maps, Citymapper and Tbilisi data availability is **from memory / unverified** and flagged "(verify)".

---

## 0. Working name and one-line pitch

**Working name: "Leave" (placeholder).** One-liner: *"Your commute, decided before you open the app."*

The app has no search bar and no chat box. You save a trip once, and the app spends the rest of the day quietly deciding when you should leave and telling you only when something changed, with a reason.

Design rule used everywhere below, from the founders: **every feature must work without AI (plain version), and AI only makes it better.** If the AI is down, the app degrades to a normal timetable app instead of breaking. That is also a good thing to say on stage.

---

## 1. Core problem statement

In Tbilisi, "when does my bus come" is the wrong question. Timetables are mostly fiction, live ETAs jump around, traffic on Rustaveli, Vake or the Tsereteli axis swings a 25-minute ride to 55 minutes, and a closure or a march can change the whole map by 08:00. Existing apps answer *"what routes exist right now?"* when you open them, which is the one moment you are already late. The real daily question is *"for my trip, when exactly must I step out of the door, how sure can I be, and has anything changed since last night?"* Nobody answers that proactively, with an honest uncertainty range, calibrated to how fast **you** actually walk and how much lateness **this** appointment tolerates, and nobody explains why the plan changed. We rebuild the transit app around that single question.

(Judging fit: "clear problem identification" is the first criterion. This paragraph plus the demo's first 20 seconds must land it.)

---

## 2. What competitors do, and the gaps we exploit

| App | Proactive behaviour (what exists) | Gap |
|---|---|---|
| Transit (GO) | "Leave now", "Hurry up", "Your stop is N stops away", detour notice, auto-switch to next departure, lock-screen live activity. Source: Transit help centre (link above). | Triggered once you start a trip, one departure at a time. No uncertainty range, no per-person calibration, no "why". Tbilisi coverage unknown (verify). |
| Google Maps | Commute tab, delay notifications, "leave now" style alerts (verify exact current behaviour). | Single point estimate, not risk-tunable, no explanations, weak local detail (marshrutka, closures). |
| Citymapper | Disruption alerts, "get off" alerts (verify). | Not in Tbilisi; reactive. |
| Moovit | Favourites, live directions, crowd-sourced reports; the common app in Tbilisi (verify). | You still open it and search; no scheduled decision-making. |

Our wedge is not "better routing". It is **a scheduled, explained, risk-aware decision about when to leave, delivered without opening the app.** Keep that sentence in the pitch.

Tbilisi data facts to verify tonight (do not claim on stage until checked): Tbilisi Transport Company's site exposes real-time bus positions and stop arrival boards; there is an unofficial `ttc-api` npm wrapper (https://www.npmjs.com/package/ttc-api) that suggests an accessible endpoint; I could not confirm an official GTFS or GTFS-realtime feed. Metro and marshrutka (minibus) real-time is probably absent (verify). Founders say they have static data and possibly live buses: plan for **live buses = bonus, static + traffic = baseline**.

---

## 3. Feature list

Legend per feature: **Plain** = works with no AI. **AI** = what the AI adds. **Sees** = what the user sees. **Honest AI** = what the model actually is (be able to answer this if a judge asks).

### 3A. MUST-HAVE for the demo (build these, in this order)

**F1. Saved trips from stops (the base object)**
- Plain: user picks origin stop/place and destination stop/place, names it ("Home to Work"), optionally picks a target arrival time. The app generates all route options (bus, metro, bus+metro, walking legs) from static transit data.
- AI: ranks and prunes the options by predicted door-to-door time distribution, not scheduled time; collapses near-duplicates (three buses on the same corridor become one "any of 37/61/124" option).
- Sees: one card per trip showing the *current best plan* and a one-line status ("On track", "Leave 6 min earlier today").
- Honest AI: routing itself is deterministic (use a library or precomputed graph); AI is only the scoring on top. Do not call routing "AI".

**F2. Leave-by with a confidence window (the hero feature)**
- Plain: "leave at 08:15 to arrive by 09:00" from the timetable.
- AI: models door-to-door duration as a distribution (personal walk time + wait + ride under current traffic + transfer + final walk), and returns a **window**, not a number. You choose a risk level (see F6) and it returns the latest safe leave time. Example: "Leave between 08:12 and 08:17. Arrive 08:51 to 09:03; 90 percent chance before 09:00."
- Sees: a horizontal band (fan) on the trip card and in the widget: green zone = comfortable, amber = tight, a thin marker for "now". A countdown to the start of the leave window.
- Honest AI: a Monte Carlo / quantile model: each leg has a mean and a spread, spread widens with traffic level, live-ETA staleness, rain and time of day. Fit the spreads from whatever history you can log (see section 8). Say "probabilistic model", not "deep learning".

**F3. Smart notifications that only fire on meaningful change**
- Plain: a reminder at a fixed time before departure.
- AI: decides whether to notify at all. It re-plans every few minutes in the background and sends a push only when the *decision* changes: leave-by moved by more than N minutes, a different route is now better, or the confidence dropped below your threshold. Silence is a feature.
- Sees: at most 2 to 3 pushes a day, each with a verb up front: "Leave 6 min earlier", "Switch to metro today", "You're fine, no change".
- Honest AI: a change-detection rule over the model output, plus a cooldown. The "smart" is mostly deciding not to disturb you.

**F4. "Why I changed your plan" explanations with attribution (Track 01 match)**
- Plain: a notification says the plan changed.
- AI: an LLM turns the model's structured diff (`{leave_by: 08:20 -> 08:14, cause: [traffic_Vake +9min, rain +2min], source: [ttc_live, traffic_feed, weather]}`) into one plain sentence in the user's language, and an **audit trail** names who acted.
- Sees: tap the notification, get a short "Plan history" timeline: "07:41 Planner agent moved your leave time from 08:20 to 08:14. Why: traffic on Chavchavadze +9 min (traffic feed 07:40), light rain (+2 min). You can undo." Every entry names the actor (Planner agent, Disruption agent, You) and the data source.
- Honest AI: LLM only verbalises a diff computed by code, so it cannot invent causes. Show the structured causes next to the sentence; that is a credibility point with a technical jury.
- Why must-have: this directly answers Track 01's "everyone can see who did what" and the "chatbot is not enough" warning.

**F5. Home-screen widget and lock-screen live view (the native proof)**
- Plain: widget showing next departures for the saved stop.
- AI: widget shows the *decision*: big "Leave in 11 min" with the confidence band underneath, colour changes when the plan changes, tap goes to the reason (F4).
- Sees: small widget: trip name, countdown, band. Lock-screen/ongoing notification during the trip: "Bus 37 in 3 min, 2 stops to your transfer".
- Notes: this is the main reason the app counts as mobile-native, not a web wrapper (Track 03). Do the widget on **one platform only** (see section 7).

**F6. One risk dial plus calendar/appointment strictness**
- Plain: choose "arrive by" time.
- AI: each trip has a single "how bad is late?" setting (Relaxed 60 percent, Normal 80 percent, Must not be late 95 percent), and a connected calendar event can set it automatically: job interview or flight = 95 percent, gym = 60 percent. The leave-by shifts accordingly.
- Sees: a three-position slider on the trip, and a line "Set to Must-not-be-late because of 'Interview 10:00' in your calendar".
- Why must-have: it makes the confidence window actionable and shows a clearly smart behaviour in 10 seconds. If calendar integration is too slow, ship the dial alone and fake the calendar trigger via a pre-seeded event (say so).

**F7. Disruption-aware rerouting before you open the app**
- Plain: a list of service alerts the user has to read.
- AI: an LLM reads unstructured disruption text (city announcements, TTC notices, a hand-pasted or scraped news line such as "Rustaveli Ave closed between X and Y from 17:00") and extracts `{area, from, to, mode_affected}`; code maps that to affected stops/segments; the re-planner then checks only *your saved trips* and notifies only if you are affected.
- Sees: at 07:40, a push: "Rustaveli closed at Freedom Square from 08:00. Your usual 37 is diverted. New plan: walk 4 min to Liberty Square metro. Leave 08:09." Not "here is a list of alerts".
- Honest AI: LLM as a parser/extractor of messy text plus geocoding of street names to stops. That is a real, defensible use of an LLM.
- This is the wow moment (section 5). Keep the trigger neutral: say "road closure" or "event", do not make a political statement on stage.

### 3B. NICE-TO-HAVE (only after 3A is solid; pick at most 2 or 3)

**N1. Personal calibration (walking speed and door-to-stop time)**
- Plain: assumes 5 km/h walking.
- AI: learns *your* door-to-stop time and walking speed from past trips (GPS trace or just the time between leaving home geofence and the stop geofence). Every user is different, so the leave time stops being generic.
- Sees: "You take 6:40 to reach the stop, not 4 min. Leave-by adjusted." and a tiny "Learned from your last 9 trips" label.
- Demo-safe version: seed 10 historical trips for the demo user, show the calibration card. Say that it is seeded. Online learning can be a simple exponentially weighted average; no heavy ML required.

**N2. Bunching and ghost-bus awareness**
- Plain: next arrivals list.
- AI: if two vehicles of one route are within about 2 minutes, flag "the second 37 is right behind; the gap after is 14 min. Take the first." If a scheduled trip has no live vehicle assigned for N minutes, mark it "probably not running" and exclude it from the plan.
- Sees: a small tag on the departure and a plan that does not rely on a ghost bus.
- Depends entirely on live vehicle data quality (verify). Great if live positions exist; skip if not.

**N3. Metro transfer and station knowledge**
- Plain: metro as a node with fixed transfer time.
- AI: transfer time varies: escalator depth, platform direction, station (verify local specifics with a local on the team). Use per-station walking offsets, and for a "Must not be late" trip prefer transfers with a short walk even if nominally slower.
- Sees: "Transfer at Station Square: 4 min walk, we budgeted 6" in the detail view.

**N4. Weather and terrain-adjusted walking**
- Plain: constant walking speed.
- AI: multiplies walking time by slope (Tbilisi hills, long stairways) and rain/ice; rain also widens traffic spread. Free data: Open-Meteo for weather and elevation (verify rate limits).
- Sees: "Rain from 08:30: +2 min, the covered path via the underpass is chosen".

**N5. Card balance and top-up awareness**
- Plain: balance shown.
- AI/logic: predicts "this week's trips will cost X; your balance covers N more rides" and warns the evening before "Balance 0.80 GEL, bus needs 1.00; top-up points on your route: metro station Y". Fare rules and cash vs card on each mode need verification (verify: I believe the Metromoney card has a time-limited free-transfer rule, and buses/minibuses may not take cash). Do not build real top-up; only the warning, and only if you can read the balance.

**N6. Marshrutka (minibus) handling**
- Plain: marshrutka lines as another mode.
- AI: since there is likely no real-time, estimate reliability by headway history from user reports or treat them as "frequency-based, high variance" in the confidence model. Wider band, explicit label: "Minibus, no live data, ±8 min".
- This is a quirk that shows local understanding and costs almost nothing: it is just a wider variance parameter plus a label.

**N7. MCP server for the planner (partner-tool bonus)**
- Expose `get_leave_time(trip_id)`, `get_plan_history(trip_id)`, `report_disruption(text)` as an MCP server (Elva/Theneo auto-generates one from a repo, per the challenge deck). On stage, show the MCP logs while the disruption is injected: "an agent is a user too". About 30 to 60 minutes if the backend already has clean endpoints. Only do it after F1 to F7 work. Do not let it become a chat interface.

### 3C. LATER (mention in the pitch's last 10 seconds, build none)

- Crowding/standing-room predictions and "full bus will skip your stop" awareness.
- Shared plans: two people meeting at the same stop with synchronised leave times (this is Track 02 territory).
- Accessibility routing (step-free, wheelchair, stroller) using stair/elevation data.
- Learning from collective anonymous trip traces to improve delay models city-wide.
- Offline mode; Georgian, English, Russian polish; tourist mode.
- City/operator dashboard: aggregated predicted pain points (this is a business angle and is **not judged**, so only a one-liner).
- Smart-watch complication.

---

## 4. How the AI is split (the honest map, memorise this)

| Component | Technique | Where it shows in the demo |
|---|---|---|
| Duration/uncertainty model | Per-leg distributions, Monte Carlo, calibrated on logged delays | The confidence band (F2) |
| Change detector | Rules over model output with cooldown | Fewer, better notifications (F3) |
| Disruption extractor | LLM turns messy text into structured area/time | Pre-emptive reroute (F7) |
| Explainer | LLM verbalises a structured diff computed by code | "Why" cards and plan history (F4) |
| Personal calibration | Running averages per user (on-device or server) | Door-to-stop time (N1) |

Rule: **LLMs only parse and narrate; numbers come from code.** This prevents hallucinated ETAs, which is the one thing that would sink a transit demo.

---

## 5. The 3-minute stage demo

Target: 180 seconds. One presenter talks, one holds the phone mirrored to the projector (screen mirroring over cable; test the venue's HDMI/USB-C adapter). Phone must be real hardware, not an emulator, because the jury is judging "real phone app".

**Pre-stage setup (done before the pitch, not shown):**
- Demo trip "Home to Work" already saved with Free University of Tbilisi area as one end if you want a local anchor that the jury knows, or any pair of stops the jurors will recognise as a hard commute.
- Phone on lock screen, widget on home screen, notifications permitted, do-not-disturb off.
- A hidden **scenario controller** (a second laptop tab or a secret gesture) that can: (a) set the clock, (b) inject a disruption text, (c) switch data mode between Live and Replay. These inject events into the *same pipeline* real data uses. Do not hard-code the UI.
- A tiny data-source chip in the corner of the app: `LIVE` or `REPLAY 08:12 Sat`. Say the mode out loud if replay is in use. Honesty protects you if a juror asks.

| Time | What happens | What you say (gist) |
|---|---|---|
| 0:00 to 0:20 | Slide-less. Hold up the phone. | "Every morning in Tbilisi you open a transit app when you are already late. We asked a different question: when must I step out the door, and how sure can I be?" Name the problem in one breath. |
| 0:20 to 0:45 | Show saved trip creation: tap two stops, name it. All route options appear instantly (plain feature). | "No search bar, no chatbot. You save your commute once." Show routes: bus, metro, bus + metro. |
| 0:45 to 1:20 | Trip card with the confidence band. Move the risk dial from Relaxed to Must-not-be-late: leave-by jumps from 08:19 to 08:08. Tap calendar chip: "Interview 10:00". | "A normal app says 08:15. We say: between 08:12 and 08:17, 90 percent sure to be there by 09:00. And the strictness comes from your calendar, because being late to an interview and being late to the gym are not the same." |
| 1:20 to 1:40 | Widget on the home screen with countdown. Lock the phone, show the lock-screen view. | "You never need to open the app." One sentence on native widgets (Track 03 signal). |
| 1:40 to 2:30 | **WOW MOMENT.** Lock screen is showing. Operator injects the disruption (or the real event arrives): the phone buzzes. Notification: "Rustaveli closed at Freedom Square from 08:00. Leave 6 min earlier, take metro from Liberty Square." Widget band shifts live on screen. Tap it: plan history shows "Disruption agent read the city notice at 07:40; Planner agent moved your plan; you can undo", with the source and the structured causes. | "Nobody opened anything. A city notice in plain text was read, matched to *your* two saved routes only, and the plan changed before you left the house. And it tells you why, who changed it, and from which source. If the AI is wrong, you can see it and undo it." Pause. Let the room see the widget move. |
| 2:30 to 2:50 | Quick N1 or N6 card as a "local touch": "learned your door-to-stop time 6:40", or minibus lines shown with a wider ±8 min band and no pretend precision. | "It learns that you walk slower than the default. For minibuses with no live data it widens the window rather than lying." |
| 2:50 to 3:00 | Close. | "A transit app that decides when to leave, tells you only when it matters, and shows its reasoning. AI as the engine under familiar features, not a chat box on top." |

**Live-or-fallback plan (decide before going on stage, rehearse both):**
1. **Level 1, fully live:** real TTC bus positions plus a traffic feed. Danger: Wi-Fi at a packed venue. Bring a phone hotspot as the laptop's uplink and test on stage hardware.
2. **Level 2, semi-live (recommended default):** static timetable plus *recorded real* bus/traffic snapshots from Saturday evening and Sunday morning, replayed through the same backend with the clock set to a morning rush slot. The disruption is injected by the scenario controller. Label it `REPLAY`.
3. **Level 3, offline safety net:** the backend and a seeded database run on the presenter laptop (or on the phone), no internet needed; the scripted scenario runs end to end. Also keep a **screen recording** of the whole 3-minute flow on the laptop, one keystroke to play, to use only if the phone or mirroring dies. Say "Here is the recording from this morning" rather than pretending.
- Switch rule: if the first push does not arrive within 10 seconds of injection, the operator hits the scenario controller's "resend" once, then moves to the recording without apology.
- Rehearse the pitch three times, including once with Wi-Fi off.

Q&A prep (the jury are "tech people, nerds"): (1) "Where is the AI?" answer with the section 4 table. (2) "How accurate is it?" show one slide: predicted vs actual on the trips you logged, even if tiny, and say the sample is small. (3) "What if the LLM hallucinates?" LLM never produces numbers, only parses text and narrates a diff computed by code. (4) "Why not Google Maps?" it answers a query when you open it; we make a scheduled, explained, risk-aware decision.

---

## 6. What NOT to build in two days

- Your own routing engine from scratch. Use a ready library/service or precompute routes between the two or three demo trips.
- A chatbot, natural-language search, "ask the transit assistant", voice. Explicitly contradicts the founders and the Track 01 warning.
- A full-city map UI with every line drawn. One clean route preview is enough.
- iOS and Android both. Pick one.
- Accounts, login, onboarding flow, settings pages, payments or real top-up, ticketing.
- Real ML pipeline with training infrastructure. A small statistical model plus logged data beats an unfinished neural net.
- Turn-by-turn navigation or live GPS tracking during the ride (a simple "next stop" ticker is enough).
- Crowd-sourced reports, social features, gamification.
- Multi-language polish. Pick English UI with Georgian stop names as data.
- Business model, pricing, expansion slides (explicitly not judged).
- Accuracy benchmarking across the city. One honest small chart is the ceiling.
- Calendar integration beyond one provider; if it eats more than 90 minutes, seed an event instead.

---

## 7. Suggested split and cut lines for a two-person team

- **Person A (phone):** native app skeleton, saved trips UI, trip card with band, notification handling, widget and lock-screen view. One platform, a real device from hour one. If using Lovable for the shell, remember the track needs a real native app, not a wrapper; confirm what the Lovable mobile flow produces before relying on it (unverified).
- **Person B (backend and data):** static data ingestion and route generation, live/recorded feed poller, duration model, re-plan loop, disruption extractor, explainer, scenario controller.
- Day 1 target: F1 + F2 working end to end on a real device with static or semi-live data, and the poller **recording live bus and traffic data from Saturday afternoon onwards** (this is your replay data and your tiny training set).
- Day 1 evening: F3 + F4 skeleton, F5 widget.
- Day 2 morning: F7 and F6, scenario controller, replay mode.
- **Feature freeze Sunday 09:00.** Submissions close Sunday 12:00, so the submission asset (video or link) must be produced by 11:00. After freeze: rehearse, record the fallback video, charge devices.
- Nice-to-haves are allowed only in this order: N1 (seeded), N6, N7, N4. Drop N2 unless live vehicle data is clearly good.

---

## 8. Data you need to confirm tonight

1. Static feed: stops, routes, stop sequences, headways (the founders have it). Check stop name encoding (Georgian script) and metro included or not.
2. Live bus positions or arrivals: confirm the endpoint, update frequency, rate limit, and legal comfort of polling it. Start logging immediately so there is something to replay.
3. Traffic: which source (Google/HERE/TomTom/other) gives free or cheap speed/congestion at hackathon volume? Without it, derive a congestion proxy from live bus speed vs scheduled speed, which is actually a nice story ("the buses are our traffic sensors").
4. Weather and elevation: Open-Meteo is free (verify limits).
5. Disruption text: pick 1 to 2 real sources (city announcements, TTC social posts) you can paste or scrape; also prepare 3 realistic fake notices for the replay scenario and label them as scripted.
6. Fares/cards: only needed for N5; skip if unclear.

---

## 9. Track fit and pitch framing

**Recommendation: enter Track 03 (Mobile native) as the primary track, and speak Track 01's language in the pitch.**

Why 03:
- The product's core value is *delivered outside the app*: widgets, lock-screen live view, background re-planning, push. That is exactly "a real phone application, not a web wrapper" and cannot be faked with a web page. It is a strong, concrete answer to the track definition.
- Track 01 is likely to be crowded with "X plus a chatbot" entries; this idea is a genuine anti-chatbot and stands out in either track, but the native proof is harder to copy in a weekend.
- Judging criteria are the same on every track (clear problem, creative solution, really solves it), so framing matters more than the track label.

How to frame for 03: lead with the phone; the first thing the jury sees is a lock screen, not a UI. Say "the best interface is the one you don't open".

How to also win the 01 argument in the same pitch: "We rebuilt the transit app as if AI existed from day one. Notice what is missing: the chat box. AI is the engine under familiar features (saved routes, notifications, widgets)." Use the F4 plan-history screen to show visible attribution ("who did what, from which data"), which mirrors Track 01's explicit wording. If the organisers allow only one track, pick 03; ask at the help desk or on `#ask-okto` whether a project may be considered for two tracks (unverified, rules not stated in the deck).

Other tracks:
- Track 02 (Multiplayer) only fits if you pivot to "two people, two agents negotiating a shared meeting plan" (listed under Later); do not chase it.
- Track 05 (Solana): not relevant.
- Special prizes: if N7 is done, the Theneo & Elva MCP angle is a legitimate extra entry point ("the planner is an MCP server, so any agent can ask when you should leave"); show the MCP logs live as the deck suggests.

Pitch skeleton for the 10-team finalist stage (about 3 minutes plus questions): Problem in one sentence (section 1) -> demo (section 5) -> "how the AI is used" table (section 4) -> "what's next" three bullets from section 3C. Never spend slide time on business model.

---

## 10. Open questions for the founders

1. Do you truly have live bus data, and how stale is it? This decides whether N2 and the live-confidence story are real or replayed.
2. Android or iOS in the room? Pick the device that will be on stage and build the widget there.
3. Which neutral disruption do you want as the demo wow (road closure, event, heavy rain, metro delay)? Closure is the most visual; avoid anything political in wording.
4. Who owns the replay recording and the fallback video? Name one person.
5. Is there anyone local on the team to sanity-check metro transfer times, marshrutka coverage, and fare rules (verify-flagged items)?
