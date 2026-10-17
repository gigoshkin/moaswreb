# Tbilisi transit: build plan (what we need to proceed)

Written Sat 17 Oct 2026, evening, from George's session. Builds on `04-product-spec.md` (darya's session). Labels: **[decided]**, **[proposed: needs George]** (code/stack), **[proposed: needs darya]** (features/flows), **[?]** unverified.

## 0. Roles [decided by George]
| Area | Owner | Means |
|---|---|---|
| Code, stack, data sources, architecture | **George (gigoshkin)** | No stack or library decision is final without George's OK. Other sessions propose; they don't decide. |
| Features, user flows, screens content | **darya / AndroPetrosyan** | Owns `04-product-spec.md` and the flows. **Has to come up with new flows** (see §4). |
| Pitch, demo script | open | Assign before Sun 09:00. |

## 1. Changes to 04-product-spec
- **Data source overridden (George):** use **TTC's own PIS gateway** directly, not the GTFS/GTFS-RT/Transitous mirrors. Mapped and tested in `knowledge-base/ttc-pis-gateway-api.md`: stops, routes, live positions, live arrival times, full timetables, geocoding, trip planner (`v2/plan`, `arriveBy`). The key comes from TTC's public page at runtime and is never committed.
- **Stack lines in §2 of 04 are proposals**, waiting for George (see §3 below).
- Features F1–F6 stay as darya's proposal. Code-side feasibility of each with the gateway is in §2.

## 2. Feature feasibility on the gateway (code view)
| Feature (04) | Data we have | Effort | Note |
|---|---|---|---|
| F1 Home point | `v2/geocode` (+ reverse) | S | bbox param required |
| F2 Schedule upload → events | Claude vision/PDF; places via `v2/geocode` | M | Confirm screen is a must (AI never guesses places) |
| F3 Trip builder + week view | `v2/plan` with `departMode=arriveBy` | S | Planner is TTC's own, so routes match the official app |
| F4 Leave-by alerts w/ reasons | `arrival-times` (live min.) + `positions` + our logged history | M–L | Core. Needs logger running **tonight** |
| F5 Georgian notice reader | Claude extraction; route matching via route/stop lists | M | No notice feed in API; paste/scrape |
| F6 Reliability scorecard | Our own logs vs `schedule` timetables | M | Only as good as hours logged → start logger first |
| Widget | n/a | L | Stretch, Android only |

## 3. Stack [decided by George, 17 Oct: "pick what gives the best result; backend runs on my VPS in Docker"]
| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript everywhere** | One language for app, server and shared types |
| Repo | npm workspaces monorepo: `apps/server`, `apps/mobile`, `packages/shared` | Shared trip/event/API types and schemas |
| Phone app | **Expo + expo-router, Android dev build built in the cloud with EAS** (no local Android SDK) | Real native app (Track 03): push, widget later, haptics |
| UI | Own design tokens + StyleSheet + Reanimated; no generic UI kit | Avoid the template / vibecoded look (§5) |
| Maps in app | MapLibre RN + free OSM vector tiles **[?]** | No key; don't reuse TTC's Mapbox token |
| Server | **Node 24 + Fastify**, running `.ts` directly (Node type stripping, no build step) | Fast to write; one process for API, poller, decision loop and MCP |
| Storage | Raw TTC snapshots as hourly JSONL (gzipped) = replay source; **SQLite** for app data (users, trips, predictions) | Zero ops; one Docker volume |
| AI | Claude API (`@anthropic-ai/sdk`), model in env var | Vision + PDF + Georgian |
| Chat agent + MCP | Official MCP TypeScript SDK, Streamable HTTP at `/mcp` on the same server; the app's chat agent and Claude Desktop use the same tools | Request 0001; Elva/Theneo prize |
| Push | expo-notifications + Expo push service | Works with an EAS dev build |
| Hosting | **Docker Compose on George's VPS**: `server` + `caddy` (automatic HTTPS). Data in a named volume | HTTPS is needed for MCP and push. Until the VPS is ready, run it locally |

**Rule regardless of stack:** LLMs parse and phrase; numbers always come from code.

**No reuse of old code [decided by George, 17 Oct]:** `~/Projects/web/moaswreb` (Symfony API + Expo app) is old. Use it **only as a reference** for how the TTC API behaves and for UI ideas. Copy no files or modules; everything is written fresh here. The TTC API may have changed since then, so trust `ttc-pis-gateway-api.md` (tested 17 Oct) over the old code.

## 4. Screens (draft, darya to own and redo)
1. Onboarding: language (ka/en), home point (search or GPS), notification permission.
2. **Today**: one big "next trip" card: *leave in 7 min (06–09)*, route chips in TTC route colours, live bus dot ETA, confidence. Below it, the rest of today's trips.
3. **Week**: 7-day list of trips (from F3).
4. **Trip detail**: itinerary legs, mini map with live buses, "why this plan" plus plan-change history (who/what/when).
5. **Add schedule**: camera / file / calendar link / text → **Confirm events** (fix times/places).
6. **Notice reader**: paste notice → extracted fields → "affects your Tue & Thu trips" → re-planned.
7. **Scorecard**: % inside window vs timetable, N hours logged, per line.
8. Settings / demo controls (hidden): demo clock, inject delay/notice, LIVE/REPLAY badge.
9. Android notification layouts (the stage moment) and widget (stretch).

**Flows darya still needs to define** (George's ask: new flows, not only the 04 list):
- First run to first useful alert in < 60 s: what's the shortest path?
- What happens when the user *misses* the leave-by (snooze? next option?)
- Return trip when the end time is fuzzy (uni lecture ends early)
- Trips that aren't in the schedule (one-off "meet at Fabrika at 19:00")
- What the user sees when live data is missing or stale
- The 3-minute stage demo, click by click

## 5. Design direction: must not look vibecoded

> **Superseded in part by `06-design-direction.md`** (17 Oct): Google/Apple-level feel, not stock Material; Google Sans Flex + a Georgian font instead of Inter; springs and shared transitions instead of plain Material motion.
Avoid the AI-template signals: purple/indigo gradients, glassmorphism, emoji as icons, "✨AI" badges, centred hero cards with huge rounded corners, generic shadcn grey-on-white, sparkle icons, lorem-like microcopy.

Do:
- **Transit-signage language**: dense, high-contrast, numbers first. Big tabular numerals for minutes (`7 min`), route numbers as coloured plates using **TTC's real route colours from the API** (`color` field).
- Type: **Noto Sans Georgian + Inter** (or Noto Sans) with tabular figures. Two weights only.
- One accent colour plus route colours; neutral greys; real dark mode.
- Native Android feel: Material 3 motion, haptics on state changes, system back, real notifications and widget, no web-looking modals.
- Short, specific microcopy in Georgian first ("გადი 7 წუთში"), English second. Reasons in one line with numbers.
- Confidence shown as a **window bar** (06–09 min), not a percentage badge.
- AI is invisible: no chat, no sparkle; show *what changed and why*.
- Design in Figma first (Figma MCP is available but needs auth via `/mcp`), one screen at a time, 4 px grid.

## 6. Name candidates (team to pick)
| Name | Meaning | Note |
|---|---|---|
| **Dro** (დრო) | "time" | Short and neutral; reads well on stage. Recommended |
| Gasvla (გასვლა) | "departure / going out" | Exactly the leave-by idea; harder for non-Georgians to say |
| Mivdivar (მივდივარ) | "I'm on my way" | Friendly; long |
| Tsadi (წადი) | "go!" | Punchy, but can sound like "get lost" |

## 7. Next steps, in order
1. **George:** approve/reject §3 stack (backend A or B). Ask `#ask-okto` about pre-event code.
2. **Logger tonight** (code): poll `arrival-times` for demo-trip stops + `positions` for their routes every 30 s, save raw JSON. Every hour logged makes the scorecard and the "AI" claim real.
3. **darya:** pick 2–3 real demo trips (home→Free Uni etc.) so the logger knows which stops/routes to watch; then the flows in §4.
4. Gateway client + `plan` → week view end-to-end on the phone (first checkpoint from 04 §6).
5. Leave-by engine + push; then notice reader; then scorecard; then polish/design; widget if time remains.
6. Sun 09:00 freeze features; 09:00–11:30 demo rehearsal + backup recording; submit before 12:00.

## 8. Data, learning and privacy [decided by George, 17 Oct]
- **Logger:** keep the city-wide sweep, but never risk a block. Gentle rate (≤ 1.4 req/s), automatic backoff on 403/429/5xx/network errors (30 s doubling to 30 min), sweep paused 01:00–06:00 Tbilisi. Keep it only while it gives real benefit.
- **Learning:** self-improving. Start from a wide safe window based on TTC's countdown; narrow it per line as observations accumulate (shrink toward the all-lines estimate when data is thin); always show the evidence ("learned from N arrivals").
- **Privacy:** **no user-bound GPS or movement data is collected, ever.** Current location may be used on the phone only, to compute walking time; it isn't sent or stored. No "learn your walking speed" on the server. Uploaded files are deleted after parsing. The MCP endpoint needs a personal key. There's a delete-all button. Google sign-in is still undecided (see George's session).
