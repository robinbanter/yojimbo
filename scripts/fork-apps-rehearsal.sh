#!/usr/bin/env bash
# LOCAL FORK rehearsal of Eidolon and Nakama on one fresh sui-fork of Sui mainnet.
# 1. New fork at the latest mainnet checkpoint, fork hub funded (whale SUI + DeepBook swap to USDC).
# 2. hub-distribute.ts sends SUI gas and USDC to Eidolon player + ghost and Nakama members A + B (fork-only keys).
# 3. Each app server runs against the fork on its own port; its fork-rehearsal.ts drives /fund, /plan, /execute
#    and the enqueue verification route. Servers are stopped afterwards; the fork keeps running.
# Predict markets at the fork checkpoint expire in wall-clock minutes, so this runs straight through.
set -euo pipefail
YOJ="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$(cd "$YOJ/.." && pwd)"
TSX="$YOJ/packages/core/node_modules/.bin/tsx"
STATE="$YOJ/.fork"
# tsx runs the server in a child node process, so stop by the process listening on each port.
stop_apps() { for port in 8797 8798; do for pid in $(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null); do kill "$pid"; echo "stopped pid $pid on $port"; done; done; rm -f "$STATE/eidolon.pid" "$STATE/nakama.pid"; }
if [ "${1:-}" = stop ]; then stop_apps; exit 0; fi
stop_apps
"$YOJ/scripts/fork-demo.sh" hub
dist() { "$TSX" "$YOJ/scripts/hub-distribute.ts" --keys-file "$YOJ/.env.fork" --to-keys-file "$1" --to-var "$2" --sui "$3" --usdc "$4" | python3 -c "import json,sys; d=json.load(sys.stdin); print('hub ->', d['to'], d['amounts'], d['result']['txDigest'], d['result']['status'])"; }
start_app() { # name port start-command...
  local name=$1 port=$2; shift 2
  ( cd "$PROJ/$name/packages/server" && nohup "$@" > "$STATE/$name.log" 2>&1 & echo $! > "$STATE/$name.pid" )
}
rehearse() { # name port
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$2/status" >/dev/null 2>&1 && break; sleep 1; done
  ( cd "$PROJ/$1/packages/server" && "$TSX" scripts/fork-rehearsal.ts ) 2>&1 | tee "$STATE/$1-rehearsal.log" || true
}
# Start both servers first: Predict markets at the fork checkpoint close in wall-clock minutes.
start_app eidolon 8797 env DOTENV_CONFIG_PATH="$PROJ/eidolon/.env.fork" "$TSX" src/index.ts
start_app nakama 8798 env NAKAMA_ENV_FILE="$PROJ/nakama/.env.fork" "$TSX" src/index.ts
dist "$PROJ/eidolon/.env.fork" EIDOLON_PLAYER_KEY 0.5 3
dist "$PROJ/eidolon/.env.fork" EIDOLON_GHOST_KEY 0.5 3
dist "$PROJ/nakama/.env.fork" NAKAMA_MEMBER_A_KEY 0.5 3
dist "$PROJ/nakama/.env.fork" NAKAMA_MEMBER_B_KEY 0.5 3
echo "=== Eidolon (port 8797)"; rehearse eidolon 8797
echo "=== Nakama (port 8798)"; rehearse nakama 8798
# Servers stay up for inspection; stop them with: scripts/fork-apps-rehearsal.sh stop
