# Server

Node 24 + Fastify, TypeScript run directly by Node (no build step). Jobs: **log live TTC data** (delay statistics, demo replay), **`GET /plan`** (trip planner), **`POST /chat`** (the app's single chat input, request 0001) and **`/mcp`** (the same tools for Claude Desktop / Claude Code).

## Run locally (Docker)
```bash
cp .env.example .env        # from repo root; adjust HOT_STOPS / HOT_ROUTES
docker compose up -d --build server
curl localhost:8080/logger/stats
```
Data lives in the `data` Docker volume: `raw/YYYY-MM-DD/HH.jsonl` (UTC), gzipped when the hour ends. Each line is `{t, kind, key, data}` with the raw TTC response.

## Run without Docker
```bash
npm install                 # repo root
npm run dev -w @transit/server
```

## Deploy on the VPS
1. Install Docker, clone the repo, `cp .env.example .env`, set `DOMAIN=` (DNS A record pointing at the VPS).
2. `docker compose --profile vps up -d --build` starts the server plus Caddy with automatic HTTPS.
3. Moving logs from the laptop: `docker run --rm -v hacktoberfest_data:/data -v $PWD:/out alpine tar czf /out/data.tgz -C /data .`, then copy `data.tgz` to the VPS and extract it into its volume.

## What the logger polls
- **Hot set**, every `HOT_INTERVAL_MS` (30 s): arrival boards for `HOT_STOPS` and positions for the routes serving them plus `HOT_ROUTES`. The default hot set is the stops at Free University (1:1405, 1:1408, 1:1406), with routes 347 and 558.
- **Sweep**: positions for every route, one request every `SWEEP_INTERVAL_MS` (1.5 s). A full city pass takes about 7 minutes.
- All TTC calls share one queue with at least `TTC_MIN_INTERVAL_MS` (0.7 s) between them. The API key is read from TTC's public page at runtime and is never stored.

## GET /plan
Wraps TTC `v2/plan` with `departMode=arriveBy` and returns `PlanResponse` from `@transit/shared`.

```
GET /plan?from=41.7151,44.8271&to=41.7099,44.7929&arriveBy=2026-10-19T09:00[&modes=BUS,SUBWAY][&optimize=quick][&locale=ka]
```
- `arriveBy` is Tbilisi wall-clock time. `from`/`to` must be inside Tbilisi (rejects swapped lat/lon).
- Identical queries are answered from memory for 60 s.
- 400 on bad input, 502/503 when TTC fails.
- Leg `arrivalDelay` is dropped: it was off by up to ±1 h in testing.
- Normaliser tests use a **synthetic** fixture (`test/fixtures/plan-otp-synthetic.json`). Replace it with a saved real response: `curl "localhost:8080/plan?..."` won't do, save TTC's raw JSON instead.

## Tests
```bash
npm test -w @transit/server
```

## Tools (shared by /chat and /mcp)
`src/tools/index.ts` defines each tool once:

| Tool | On /mcp | Card in the app |
|---|---|---|
| `find_stop` (name or code, ka/en) | yes | `stops` |
| `find_place` (OSM geocode via TTC) | yes | none |
| `next_arrivals` (live countdown at a stop) | yes | `arrivals` |
| `plan_trip` (arrive-by planner) | yes | `plan` |
| `propose_trip` | no | `confirm_trip` |
| `propose_events` (from a photo, PDF or text) | no | `confirm_events` |

Numbers in cards always come from TTC data, not from the model. Proposals are confirmed in the app and stored on the phone. The server keeps no user data; the phone sends its saved trips as context with each chat request.

## POST /chat
```json
{ "messages": [{ "role": "user", "text": "როდის გავიდე ხვალ?", "attachments": [{ "kind": "image", "mediaType": "image/jpeg", "data": "<base64>" }] }],
  "trips": [ /* saved trips from the phone */ ], "locale": "ka" }
```
→ `{ "reply": "one short sentence", "cards": [ ... ] }`. Types: `ChatRequest` / `ChatResponse` in `@transit/shared`.
- Needs `ANTHROPIC_API_KEY` (else 503). Model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), effort `medium`, server-side refusal fallback on.
- Bearer `API_KEY` required when set. Body limit 20 MB (photos/PDFs as base64).

## /mcp
Streamable HTTP, stateless, read-only tools. Bearer `API_KEY` when set. Needs HTTPS for remote clients, so it's meant for the VPS behind Caddy.
- Claude Code: `claude mcp add --transport http tbilisi-transit https://<DOMAIN>/mcp --header "Authorization: Bearer <API_KEY>"`
- Claude Desktop: add it as a custom connector, or through the `mcp-remote` bridge with the same header **[not tested yet]**.

## Stored trips and alerts
Needs `TRIPS_KEY` (`openssl rand -base64 32`); without it `/me` and alerts are off.
- `PUT /me/trips` `{ trips: StoredTrip[] }`, `GET /me/trips`, `PUT /me/push` `{ token }`, `DELETE /me`. Header `x-device-id` (random id from the app); bearer `API_KEY` when set.
- Stored in `DATA_DIR/app.sqlite` (Node's built-in SQLite). Trips and push token encrypted (AES-256-GCM), device id stored as a hash. 30-day auto-delete. See `knowledge-base/data-and-privacy.md`.
- **AlertWatcher** (every 60 s): from 2 h before each trip's arrive-by time on its weekdays, plans the trip (stop → stop) and pushes "გადი N წუთში" 10 min before leaving, or "გეგმა შეიცვალა" when the leave time moves by 3+ min. Push via Expo (`EXPO_ACCESS_TOKEN` optional). `GET /alerts/stats` shows sent count and the last error.
- [?] Whether `v2/plan` uses live vehicle positions for today's trips is unverified; if not, alerts follow the timetable until we switch to `arrival-times` at the boarding stop.
