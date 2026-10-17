# Server

Node 24 + Fastify, TypeScript run directly by Node (no build step). Right now it does one job: **log live TTC data** for delay statistics and demo replay. The API, chat agent and MCP come next.

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
