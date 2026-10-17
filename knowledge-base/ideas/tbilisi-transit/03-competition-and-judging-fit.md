# Tbilisi transit: competition landscape and judging fit (devil's advocate)

Written 2026-10-17 (event day 1). Sources are linked inline. Anything I could not confirm is marked **UNVERIFIED**. Event rules come from `knowledge-base/hf-challenge.md`.

## 0. Verdict in five lines

- The **problem is real and well documented** (long, unreliable bus headways; timetables that lie; roadworks on Rustaveli until end of November 2026). Judges will understand it in 10 seconds.
- The **idea as described ("saved routes + predicted leave time + arrival window + smart notifications + widgets + reasons") is mostly not new**. Google Maps has had "Commute" plus delay notifications since 2018 and ML bus-delay prediction since 2019; Moovit has favorites, widgets and service alerts. The incumbent Tbilisi app already has live bus positions, live arrivals, favorites and QR payment.
- The **only defensible edge** is: *a reliability-aware leave-by time built from TTC's live data and Tbilisi's own observed history, shown with its evidence*. "Google tells you what the bus should do. We tell you what this line actually does at 08:10 on a Monday, and when to leave to be 90% sure." That is only credible if you can **show a measured number** (backtest) on Sunday.
- **Best track fit: 03 Mobile native** if you ship a real app with real notifications (and ideally one real widget). 01 "Make it better" is a defensible second framing ("Google Maps transit, rebuilt AI-native") but the track text rewards agents-as-users, which this idea lacks.
- **Biggest weakness: "AI" with no data.** There is no public Tbilisi bus history, you have about 24 hours to collect any, and a jury of "tech people, nerds" will ask exactly what the model is and how you know it is right.

## 1. What exists today in Tbilisi

| Product | What it does (evidence) | Notable gaps / caveats |
|---|---|---|
| **Tbilisi Transport** (AzRy LTD; widely described as the "official" live app) | Live bus arrivals, live vehicle positions, route planner, favorite stops and routes, schedules for bus/minibus/metro/ropeway, QR payment. App Store page: 4.8 stars, 3,800+ ratings, v3.1.3, "no data collected" ([App Store](https://apps.apple.com/app/id1437141092)). Android: "over 100 thousand installs" per a search summary ([AppBrain dev page](https://www.appbrain.com/dev/AzRy+ltd/); I could not open it, so treat as UNVERIFIED). A mirror lists 273K+ downloads ([mwm.ai](https://spark.mwm.ai/en/apps/tbilisi-transport/1437141092)). | The listing mentions **no widgets, no push notifications, no leave-by/predictive logic** (absence in the store text, not proof of absence; the app may have them, check on a phone). It is a first-rate "where is my bus" app, so we are not competing with a bad product. Note: it is published by AzRy, a vendor, not by TTC itself, although travel guides call it official ([Bento](https://www.bento.travel/georgia/transit)). |
| **Tbilisi Transport Company (TTC) app** (JSC ITDC) | Journey planner, realtime arrival prediction, realtime bus location, offline timetables, favorites, fare info ([ttc.com.ge](https://ttc.com.ge/en/mobile-application)). | The iOS listing shows 2.6 stars on 129 ratings, last version 1.0.4 from Dec 2017, reviews saying it crashes / database errors ([App Store](https://apps.apple.com/app/id927903973)). The listing may be a stale legacy app; the web page above describes the same feature set. No payment, widget or notification mentioned. |
| **Tbilisi Bus** (Shota Nozadze) | Live tracking, stop boards, favorites, bilingual. 4.4 stars / 194 ratings, ~25k downloads, v2.0.0 June 2023 ([mwm.ai](https://mwm.ai/apps/tbilisi-bus/6449298862)). | Small, iPhone only. |
| **getBUS** (Gennady Dmitrik) | Live tracking, arrival estimates, offline routes, occupancy colour indicators; Tbilisi and Batumi; 4.6 stars / 471 ratings; developer says "not an official app", has ads ([mwm.ai](https://mwm.ai/apps/getbus/6736360762)). | Note "occupancy" claim; I could not confirm where its occupancy data comes from. |
| **Google Maps** | Transit routing in Tbilisi. Expat guide: "shows scheduled stops and does a fair job of estimating arrival times" ([ExpatHub](https://expathub.ge/public-transport-in-tbilisi/)). Generic Google features: Commute tab with delay notifications (Oct 2018, [BGR](https://bgr.com/tech/google-maps-update-new-commute-tab-and-real-time-public-transit/)), "Arrive by"/"Leave at", "Set a reminder to leave" ([Yahoo/Tech](https://tech.yahoo.com/general/articles/psa-google-maps-tell-leave-140113327.html)), and the BusTr ML model that predicts bus delays from live car traffic in "hundreds of cities" including Istanbul and Zagreb ([Google Research, 2019](https://research.google/blog/predicting-bus-delays-with-machine-learning/)). | **UNVERIFIED:** whether Google shows *real-time* (not scheduled) buses or BusTr delays in Tbilisi specifically. I found no source either way. A Bento guide says "do not rely on [Google] alone for live arrivals" ([Bento](https://www.bento.travel/georgia/transit)). Test on a phone in Tbilisi before claiming anything about Google in your pitch. |
| **Moovit** | Covers Tbilisi bus and minibus lines ([Moovit lines page](https://moovitapp.com/index/en/public_transit-lines-Tbilisi-1906-1233448), search summary). Favorites, home/work, a favorites widget, service-alert notifications, get-off alerts ([Moovit blog](https://moovit.com/blog/navigating-with-moovit/)). Live bus tracking exists in 220+ cities ([TechCrunch, 2022](https://techcrunch.com/2022/11/29/moovit-users-can-now-track-transit-vehicles-on-map-in-real-time/amp/)). | **UNVERIFIED:** whether live tracking works for Tbilisi. A travel guide says to use the local app for "the official live feed" and Moovit as a cross-check ([Bento](https://www.bento.travel/georgia/transit)). |
| **Citymapper** | Probably not available: a web-search summary said no Georgian city is listed as of Aug 2026, but I have no direct source. **UNVERIFIED**, check citymapper.com/cities. | n/a |
| **Bolt / Yandex Go** | Ride-hailing, not transit. I did not research any transit features. | Possible "alternative" a judge will mention ("why not just take a taxi"). |
| **Past hackathons** | Garage48 Tbilisi had a project "BLU-BUS" (live bus location, bus capacity via cameras, arrival estimates) ([Garage48](https://Garage48.org/blog/garage48-hacking-gamification-and-entertainment-in-tbilisi)); Caucasus University ran a "Smart City" hackathon ([CU](https://cu.edu.ge/en/news-page/c10-smart-city)). Dates not verified. | Tells you the "bus tracker" idea is a hackathon staple. Some jurors may have seen it. |
| **Community API wrapper** | `ttc-api` (MIT, unofficial) wraps TTC's backend: stops, routes, arrival times (with a flag to ignore scheduled-only times), live bus positions, route polylines, trip planner ([GitHub](https://github.com/sxnney/ttc-api)). | See data section below. |

### Data you can actually build on (important)

- The TTC backend (a "pis-gateway" API behind transit.ttc.com.ge) exposes stops, routes, **live arrival predictions, live bus positions per route, and a trip planner** ([ttc-api source](https://raw.githubusercontent.com/sxnney/ttc-api/main/src/ttc.ts)). It requires an API key that is published in that community wrapper's source. **I did not use or copy the key and did not call the API.** It is undocumented, so: it can change or throttle at any time, using it may not be sanctioned, and judges may ask about it. Confirm acceptable use with the organizers/TTC if you can, and poll gently.
- The wrapper's route listing is filtered to `modes: BUS`. **Minibuses (marshrutkas) are privately operated and I found no evidence of live data for them** (UNVERIFIED). That is a large share of real trips: on 26 Sep 2022 minibuses did 202,500 trips vs 452,000 for buses and 417,300 for the metro ([Bankwatch](https://bankwatch.org/story/tbilisi-s-public-transport-woes-and-faltering-reforms)). Be honest about this limit.
- I found **no public GTFS / GTFS-realtime feed for Tbilisi** (searches of Mobility Database / Transitland returned nothing for it; **UNVERIFIED**, check mobilitydatabase.org directly). So "all route options from transit data" means: use TTC's trip-planner endpoint, or build your own graph from stops/routes.
- Road traffic data: you will need a source (Google/HERE/TomTom APIs need keys and cost; OSM + your own bus-position logging is free). Pick one early.

## 2. Real user pain, with evidence (2022 to 2026)

- **Waits and reliability:** average gap between buses 18 minutes with "no improvement in nearly four years" (2022 report); the mayor himself has acknowledged waits of 30 to 40 minutes ([Bankwatch](https://bankwatch.org/story/tbilisi-s-public-transport-woes-and-faltering-reforms)). Frequency on 20 routes was reportedly 30% below plan ([Georgia Today](https://georgiatoday.ge/?p=10103), via search summary).
- **Timetables that mislead:** electronic timetables "frequently misrepresent actual travel times by 10+ minutes"; one example: board says 7 minutes, bus takes 17 ([Chaikhana](https://chaikhana.media/en/stories/1502/satransporto-kolafsi-tbilisshi), via fetch summary; I did not see the exact quote). Average bus speed fell from 14 km/h (2016) to 10 km/h.
- **Overcrowding:** 74% of respondents in a 2022 survey named it the top problem; buses reach capacity and doors do not close ([Bankwatch](https://bankwatch.org/story/tbilisi-s-public-transport-woes-and-faltering-reforms)).
- **Reform did not fix reliability:** 860 buses bought 2016 to 2022, bus lanes only ~33% complete (July 2022) ([Bankwatch](https://bankwatch.org/story/tbilisi-s-public-transport-woes-and-faltering-reforms)); 200 new 18 m MAN buses (EUR 111.1m) unveiled Sept 2025, 76 operating at launch, in service from 27 Sept 2025 ([Georgia Today](https://georgiatoday.ge/tbilisi-unveils-new-fleet-of-18-meter-man-buses-to-modernize-public-transport/)). June 2026: city announced a transport "macro-model" for planning; no mention of open data or public apps ([BM.ge](https://bm.ge/en/news/tbilisi-launches-strategic-transport-macro-model-transforming-citys-approach-to-urban-planning)).
- **Right now (the best demo story):** Rustaveli Avenue full rehabilitation started 23 July and runs "until the end of November" (mayor, 26 Aug 2026), with dozens of bus and minibus routes rerouted ([1TV](https://1tv.ge/lang/en/news/tbilisi-to-introduce-temporary-traffic-scheme-around-rustaveli-avenue-from-september-1/), [Georgia Today](https://georgiatoday.ge/rustaveli-avenue-rehabilitation-how-traffic-will-move-for-four-months/); note the Georgia Today page did not load for me, so the route list comes from a search summary). A travel guide warns "an old saved route can still be wrong while the rehabilitation is active" ([Bento](https://www.bento.travel/georgia/transit)). **That is precisely the failure of a saved home-to-work route**, and it is live today. Lead with it.
- **Payment friction (context, not our problem):** card/Metromoney tap required each boarding; paying in the app or cash on board does not give the 90-minute transfer window per TTC ([Bento](https://www.bento.travel/georgia/transit)). Fare numbers in guides conflict (0.5 vs 1 GEL), so do not quote fares.
- **App-store complaints:** the only negative reviews I could find were for the legacy TTC app (crashes, "database error"). The main competing app is rated 4.8. **I found no Reddit threads or news pieces on app-level complaints** (my searches returned none). So the "existing apps are bad" argument is weak; the argument must be "they show you the bus, not the decision".

Honest gap in my evidence: no direct user research, no Reddit/Facebook-group sentiment. If you have 15 minutes, ask five people at the venue how they decide when to leave for work and screenshot it for the pitch.

## 3. Where the real gaps are

1. **Decision, not display.** Existing Tbilisi apps answer "where is bus 306 now". Nobody (from what I can see) answers "when should I walk out the door to be at work by 09:00 with 90% confidence, given this line's actual behaviour". This is the genuine gap.
2. **Reliability memory.** Schedules say 7 minutes, reality says 17. Learning per-line, per-stop, per-hour error from logged live data is something a local team can do and Google likely does not tune for Tbilisi (UNVERIFIED).
3. **Stale saved routes during disruptions** (Rustaveli). Detecting that a saved route changed and re-planning proactively.
4. **Transparency:** explaining *why* ("line 306 is running 6 min behind the schedule on Rustaveli detour; leave 7 min earlier"). Competitors give a number; few give reasons.
5. **Proactive surfaces:** the AzRy listing mentions no widgets or notifications (see caveat above).
6. **Not a gap, be careful:** "all route options" (the TTC planner and Google do this), "saved routes" (favorites exist everywhere), "widgets" (Moovit has had one for years), "leave notification" (Google).

## 4. Judging fit (the three criteria; business model not judged)

My honest scores out of 5, as a Tbilisi tech juror (FLP, DevTherapy, Lovable people who live in this traffic):

| Criterion | Score | Why | How to raise it |
|---|---|---|---|
| **Clear problem identification** | **4 to 4.5** | Universal, local, and today's Rustaveli roadworks give a concrete example. Jurors personally ride or drive in this city. | Open with one real commute, one real wrong ETA, with numbers (scheduled vs actual from your log). |
| **Creative solution approach** | **2.5 to 3** | "Predicted leave time + notifications + widgets" reads as Google Maps Commute for Tbilisi. A judge who knows Google's features will say "so, localization". | Make the *measured reliability layer* and the *receipts* the creative core. Add one surprising, demoable behaviour (e.g. the app silently changes your leave time because a bus 3 stops upstream is stuck on the detour). |
| **Problem-solving effectiveness ("really solves it")** | **3, high variance** | Depends entirely on whether the live demo shows a correct, verifiable prediction. If predictions are wrong or the API is down, this collapses to 1 to 2. | A backtest slide with a real number, plus a live ride-along proof (someone actually catches the bus the app told them to). |

Other realities:
- The deck says: "Adding a chatbot to the old app is not enough" (Track 01). Your explicit non-chatbot stance matches the organizers' taste. Keep it.
- Judges are "tech people, nerds". Expect depth questions on the model, data pipeline and failure handling, not on market. Do not spend pitch time on cities-later or monetisation (explicitly not judged).
- Only 10 teams get to pitch live (Top 10 at 16:00, pitches from 16:30). Review starts at 12:00 submission close, so the **submitted artefact (video/README/repo/working link) must carry the proof without you in the room**.

## 5. Track fit

| Track | Fit | Comment |
|---|---|---|
| **03 Mobile native** | **Best** | "A real phone application, not a web wrapper." Widgets, notifications, background location are the feature set of this idea. Example ideas are camera/voice/keyboard, so a commute app is a new angle, which is good. **Risk:** if you build a Lovable web app in a WebView/PWA shell, a strict juror may say "this is a web wrapper". Lovable generates React web apps; native packaging is via third-party wrappers ([Lovable-to-Mobile page](https://compile.lovable.app/): Expo React Native WebView wrapper with Expo push; **third-party, not confirmed as Lovable's own product**). Plan for a genuinely native shell or at least one native widget/notification you can show on a physical phone. |
| **01 Make it better** | Second | "Rebuild famous apps as if AI existed from day one." Google Maps / Moovit transit is arguably a famous app; "everyone can see who did what" maps neatly onto "why this suggestion". But the examples are agent-as-user apps (notes, email, calendar), and a local transit app is not "rebuilding a famous app". Reasonable only if framed as "Google Maps transit, rebuilt around predicted departure". |
| 02 Multiplayer | Poor | Not relevant. |
| 04 Desktop | No | |
| 05 Solana | No | |

Unknown: whether a team may enter more than one track or whether tracks are separate prize pools. The deck lists one prize ladder (1st to 3rd) plus special prizes and does not say tracks are scored separately. **Ask on Discord `#ask-okto`** before choosing. If prizes are shared across tracks, track choice matters less than demo strength.

**Cheap bonus:** expose "when should I leave?" as an MCP tool (Elva / Theneo give a free plan and a special prize pool of $4,800 Theneo + $7,200 Elva credits, and the deck explicitly suggests backing a native app with an MCP). It is a credible "not a chatbot app, but agent-ready" story, and the MCP logs can be shown live. Do not let it consume more than ~1 to 2 hours.

## 6. Strongest differentiator vs Google Maps / Moovit

> **Calibrated departure for Tbilisi: a leave-by time with an honest confidence window learned from TTC's own live data, and it shows its evidence.**

Concretely:
- Collect TTC arrival predictions and bus positions on a schedule (every 30 to 60 s) and compute, per line / stop / hour / weekday, the distribution of (actual minus scheduled).
- From that, output "leave 08:12; 80% chance you arrive between 08:41 and 08:52", not a single optimistic ETA.
- Show **why**: "Line 306 has run 6 min behind the timetable on 9 of the last 12 weekday mornings; today a bus 4 stops up is stopped on the Rustaveli detour".
- Show **proof**: a small "scorecard" screen: of the last N predictions the app made, X% landed inside the window vs Y% for the published schedule. A number beats every adjective.

Why it beats the generic competitors: Google/Moovit optimise for the whole planet; they cannot tune for Rustaveli's detour or TTC's habits. Why it beats the incumbent local app: that app shows the bus, not the decision. Say this carefully; do not claim Google has no real-time in Tbilisi unless you verified it.

## 7. The five hardest judge questions and strong answers

**1. "Google Maps already tells me when to leave and uses ML for bus delays. What's different?"**
Answer: "Google's notifications use its own prediction of the schedule; in Tbilisi it relies on what it receives (we checked how it behaves on [route X at time Y]: it said A, the bus actually came at B). We learn from TTC's own live feed, per line and per hour, and we show a confidence window and a scorecard that proves it. Here is our measured hit-rate versus the published timetable." (Only say the Google part if you tested it. Otherwise say: "Google is built for the planet; we're built for line 306 on the Rustaveli detour.")

**2. "Where's the AI? What model, trained on what?"**
Answer (be honest, it wins respect): "Three layers. A statistical model (quantile regression / empirical delay distributions per line-stop-hour) trained on live data we logged since Saturday morning and, where available, on the arrival-prediction field versus actual arrivals. A rules layer for disruptions. An LLM only to turn the numbers into a plain-language reason, with the numbers passed in so it cannot invent them. Here is the backtest." Do not claim a deep model you did not train. Google's own BusTr result (-30% error vs prior models) shows the field, but you are not claiming that.

**3. "Your data is an undocumented API. What happens when it breaks or they block you?"**
Answer: "It is TTC's own backend that its apps use; we poll gently and cache. If it's down the app falls back to scheduled data and says so with a red 'no live data' badge instead of guessing. For production we'd ask TTC for a sanctioned feed or a GTFS-RT; a clear public feed is also part of what we'd advocate to the city." (Don't over-promise.)

**4. "How do you know your predictions are right? Show me."**
Answer: "Scorecard screen and one slide: predicted window vs actual arrival for N trips we logged, coverage X%, median error Y min vs timetable error Z min. It is a small sample, collected in about a day, and we say so. Also, [teammate] actually took the 14:20 bus based on the app's advice; here is the clip." Having this ready is the single highest-leverage thing you can do.

**5. "Half of Tbilisi rides marshrutkas and the metro. Does this work for them?"**
Answer: "Phase one is TTC buses plus metro, where there is live or fixed-headway data. Minibuses are private and we have no live feed; we show scheduled/historical times and label confidence as low rather than pretending. The metro is a fixed-headway system so it enters as a stable leg." (If untrue for your build, say what is.) Alternative judge question to prepare for: "Why native rather than a web app?" Answer: "Widgets and time-triggered notifications are the product; a web page can't wake you at 08:12."

## 8. Likely failure modes at demo time (and mitigations)

1. **Live API empty / blocked / slow on venue Wi-Fi.** Mitigation: record a day of data, build a **replay mode** with a visible "LIVE / REPLAY" badge and keep live as a bonus. Pre-cache stops and routes.
2. **It is Sunday afternoon, not rush hour.** Weekend headways and light traffic make predictions look boring and delays small, so your "leave earlier" insight has nothing to show. Mitigation: replay a recorded Monday-morning on the Rustaveli detour; be upfront that it is a replay.
3. **No ground-truth data in 24 hours** for a fair backtest. Mitigation: start the logger **now**; also log the API's own predicted vs eventually observed arrival; present small-n results honestly.
4. **Notifications can't wait.** A "leave in 18 minutes" push is unwatchable live. Mitigation: a demo clock / time-travel control, or a pre-recorded screen capture of a real notification on a real phone.
5. **Widget doesn't work on stage.** iOS widgets need native WidgetKit; Android widgets need native code; neither is possible in a pure WebView wrapper (UNVERIFIED for any specific Expo library, check before committing). Mitigation: decide on day one: either one real Android widget on a real phone, or cut widgets and say so; a convincing fake widget will cost credibility with nerds.
6. **LLM "reason" hallucinates** (wrong line number, invented delay). Mitigation: template the reason from structured fields; use the LLM only for phrasing, and show the raw numbers under the sentence.
7. **Geolocation / stop matching mistakes** (wrong stop ID, opposite direction). Pre-pick a demo route and rehearse it; hard-code a fallback.
8. **Georgian text/locale bugs** (font rendering, `ka` vs `en` responses). Test both.
9. **Local juror tries his own commute** and the app is wrong for that line. Mitigation: have a "this line has too little data, confidence low" state so a miss looks honest, not broken.
10. **Rustaveli detour data**: bus rerouting is in the TTC planner, but your own graph may still path through closed streets if built from stale data. Prefer TTC's planner for route options.

## 9. What to change to improve the odds (concrete, prioritised)

1. **Start logging TTC arrivals/positions for 5 to 10 chosen lines immediately** (Saturday). Without this, the AI claim is empty. This single action matters more than any UI work.
2. **Pick one line pair and one story** (e.g. a Saburtalo-to-centre commute crossing the Rustaveli detour). Depth beats breadth: one flawless commute beats "all of Tbilisi".
3. **Put the scorecard in the app and in the submission.** It makes "really solves the problem" checkable.
4. **Cut features that are table stakes** (route lists, favorites UI polish). They don't score; the prediction + reasons + notification do.
5. **Real phone, real notification, real ride.** Film someone leaving at the app's advised time and catching the bus.
6. **Don't call it AI-everything.** Say "statistics learned from live data, with an LLM that explains". Judges forgive modest ML; they punish bluster.
7. **Optional:** MCP tool `when_to_leave(route, arrive_by)` as an agent-ready bonus.
8. **Verify before the pitch** (30 minutes): how Google Maps and Moovit behave in Tbilisi for your demo route (screenshots), and whether the incumbent app has widgets/notifications on a phone. Your differentiator claims must survive a juror opening Google Maps on stage.

## 10. 30-second pitch

"In Tbilisi the bus schedule says seven minutes and the bus takes seventeen, and since July the Rustaveli roadworks have made every saved route a guess. Existing apps show you where the bus is; none tells you *when to leave the house*. Our app learns from the Tbilisi Transport Company's own live data how each line really behaves at each hour, then sends a notification: 'Leave at 08:12; you'll arrive between 08:41 and 08:52, because line 306 is running six minutes behind on the detour.' Every suggestion shows its evidence, and a built-in scorecard shows how often we were right compared with the printed timetable. It's not a chatbot, it's a commute you can trust: a real phone app with notifications and a widget, built on a day of data we collected this weekend."

(Replace the example numbers with real measured ones before presenting. Do not say "learns from months of data".)

## 11. Source list (consolidated)

- Event rules: `knowledge-base/hf-challenge.md` (deck: https://opening.hacktoberfest.ge/deck/hf-challenge)
- Tbilisi Transport (AzRy): https://apps.apple.com/app/id1437141092 ; https://spark.mwm.ai/en/apps/tbilisi-transport/1437141092 ; https://iphoneaddict.fr/apps/navigation/tbilisi-transport-181.html
- TTC official app page: https://ttc.com.ge/en/mobile-application ; iOS listing https://apps.apple.com/app/id927903973
- Tbilisi Bus: https://mwm.ai/apps/tbilisi-bus/6449298862 ; getBUS: https://mwm.ai/apps/getbus/6736360762
- ttc-api (unofficial wrapper): https://github.com/sxnney/ttc-api ; source https://raw.githubusercontent.com/sxnney/ttc-api/main/src/ttc.ts
- Bento Georgia transit guide: https://www.bento.travel/georgia/transit ; ExpatHub: https://expathub.ge/public-transport-in-tbilisi/
- Bankwatch: https://bankwatch.org/story/tbilisi-s-public-transport-woes-and-faltering-reforms ; Chaikhana: https://chaikhana.media/en/stories/1502/satransporto-kolafsi-tbilisshi
- New buses (Sept 2025): https://georgiatoday.ge/tbilisi-unveils-new-fleet-of-18-meter-man-buses-to-modernize-public-transport/ ; macro-model (June 2026): https://bm.ge/en/news/tbilisi-launches-strategic-transport-macro-model-transforming-citys-approach-to-urban-planning
- Rustaveli works (2026): https://1tv.ge/lang/en/news/tbilisi-to-introduce-temporary-traffic-scheme-around-rustaveli-avenue-from-september-1/ ; https://georgiatoday.ge/rustaveli-avenue-rehabilitation-how-traffic-will-move-for-four-months/
- Google: https://research.google/blog/predicting-bus-delays-with-machine-learning/ ; https://bgr.com/tech/google-maps-update-new-commute-tab-and-real-time-public-transit/ ; https://tech.yahoo.com/general/articles/psa-google-maps-tell-leave-140113327.html
- Moovit: https://moovit.com/blog/navigating-with-moovit/ ; https://techcrunch.com/2022/11/29/moovit-users-can-now-track-transit-vehicles-on-map-in-real-time/amp/
- Past hackathons: https://Garage48.org/blog/garage48-hacking-gamification-and-entertainment-in-tbilisi ; https://cu.edu.ge/en/news-page/c10-smart-city
- Lovable native packaging (third-party): https://compile.lovable.app/ ; https://vp0.com/blogs/can-lovable-export-to-react-native
