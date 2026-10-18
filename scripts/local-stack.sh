#!/usr/bin/env bash
# Local test stack: a throwaway merge of the given branches, the server on :8090 with its own data, and Expo Go on :8081
# pointed at that server instead of production. Nothing is pushed or deployed.
#   scripts/local-stack.sh feat/chat-location-thinking fix/builder-picked-route
#   scripts/local-stack.sh            (just origin/main)
# Phone (Expo Go): exp://<HOST>:8081, HOST defaults to this machine's Tailscale address.
# Pushes are off here (no Expo token) and trips live in a separate database, so tests never touch real users.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WT="$ROOT/../maps-local-wt"
HOST=${HOST:-$(tailscale ip -4 2>/dev/null | head -1)}
PORT=${LOCAL_SERVER_PORT:-8090}
RUN="$WT/.local-run"

git -C "$ROOT" fetch -q origin
if [ ! -e "$WT/.git" ]; then git -C "$ROOT" worktree add -q --detach "$WT" origin/main; fi
git -C "$WT" merge --abort 2>/dev/null || true
git -C "$WT" checkout -q --detach origin/main
git -C "$WT" reset -q --hard origin/main
for b in "$@"; do
  git -C "$WT" -c user.name=local -c user.email=local@localhost merge -q --no-edit "origin/$b" || { echo "merge of $b failed; fix it first" >&2; exit 1; }
done
echo "stack: $(git -C "$WT" log --oneline -1)"

[ -d "$WT/node_modules" ] || (cd "$WT" && npm install --no-audit --no-fund --silent)
mkdir -p "$RUN/data"

# The real .env minus anything that reaches real users, with its own key, trips key and data folder.
KEY=${LOCAL_API_KEY:-local-test-key}
grep -v -E '^(PORT|DATA_DIR|API_KEY|TRIPS_KEY|EXPO_ACCESS_TOKEN|DOMAIN)=' "$ROOT/.env" > "$WT/.env"
{
  echo "PORT=$PORT"
  echo "DATA_DIR=$RUN/data"
  echo "API_KEY=$KEY"
  echo "TRIPS_KEY=$(openssl rand -base64 32)"
} >> "$WT/.env"

stop() { [ -f "$1" ] && kill -- "-$(cat "$1")" 2>/dev/null || true; rm -f "$1"; }
stop "$RUN/server.pgid"
stop "$RUN/expo.pgid"
for p in 8081 "$PORT"; do kill "$(ss -ltnp 2>/dev/null | awk -v p=":$p" '$4 ~ p"$" {print $NF}' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)" 2>/dev/null || true; done
sleep 1

(cd "$WT/apps/server" && setsid nohup node --env-file-if-exists=../../.env src/index.ts > "$RUN/server.log" 2>&1 & echo $! > "$RUN/server.pgid")
(cd "$WT/apps/mobile" && EXPO_PUBLIC_API_URL="http://$HOST:$PORT" EXPO_PUBLIC_API_KEY="$KEY" REACT_NATIVE_PACKAGER_HOSTNAME="$HOST" setsid nohup npx expo start --go --clear > "$RUN/expo.log" 2>&1 & echo $! > "$RUN/expo.pgid")

for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || curl -sf "http://127.0.0.1:$PORT/logger/stats" >/dev/null 2>&1 && break; sleep 1; done
echo "server: http://$HOST:$PORT (log $RUN/server.log)"
echo "expo:   exp://$HOST:8081 (log $RUN/expo.log)"
