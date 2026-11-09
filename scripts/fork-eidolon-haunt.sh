#!/usr/bin/env bash
# LOCAL FORK rehearsal of Eidolon's live run and haunt mode on a fresh sui-fork (Predict markets at the fork checkpoint
# close in wall-clock minutes, so everything runs straight through):
# fresh fork with the hub funded, fork-only player and ghost wallets funded, Eidolon on the fork with haunt mode on for a
# public trader (memories recalled from Walrus mainnet): scripts/live-run.ts --fork funds both accounts, then haunt mode is
# switched on through POST /haunt and the script waits for the ghost's own order.
set -euo pipefail
YOJ="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="$(cd "$YOJ/.." && pwd)"
TSX="$YOJ/packages/core/node_modules/.bin/tsx"
TRADER=0x7c9250467b7d7cc0aa2a9e76d06e9e8af313afa22285f1a3c314d749617b486e
for pid in $(lsof -tiTCP:8797 -sTCP:LISTEN 2>/dev/null) $(lsof -tiTCP:8798 -sTCP:LISTEN 2>/dev/null); do kill "$pid"; done
"$YOJ/scripts/fork-demo.sh" hub
for var in EIDOLON_PLAYER_KEY EIDOLON_GHOST_KEY; do
  "$TSX" "$YOJ/scripts/hub-distribute.ts" --keys-file "$YOJ/.env.fork" --to-keys-file "$PROJ/eidolon/.env.fork" --to-var "$var" --sui 0.3 --usdc 6 \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('hub ->', '$var', d['result']['status'])"
done
cd "$PROJ/eidolon/packages/server"
rm -rf data-fork/haunts.json data-fork/ghost-trades.json
# Walrus Memory keys come from the mainnet .env by name (memory is on Walrus mainnet even when the chain is a fork).
( set -a; eval "$(grep -E '^MEMWAL_' ../../.env)"; set +a
  DOTENV_CONFIG_PATH=../../.env.fork nohup "$TSX" src/index.ts > "$YOJ/.fork/eidolon-haunt.log" 2>&1 & )
for _ in $(seq 1 40); do curl -sf http://127.0.0.1:8797/status >/dev/null 2>&1 && break; sleep 1; done
"$TSX" scripts/live-run.ts --fork --player-usdc 3 --ghost-usdc 5
# Haunt mode goes on only after the ghost's Predict account is funded, exactly as in the app (Ghost → "Let it trade on its own").
curl -s -X POST http://127.0.0.1:8797/haunt -H 'content-type: application/json' -d "{\"player\":\"$TRADER\",\"cadence\":5}" >/dev/null
echo "waiting for the ghost's own order (haunt mode)…"
for _ in $(seq 1 60); do
  out=$(curl -s "http://127.0.0.1:8797/ghost-feed?player=$TRADER")
  if echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); t=[x for x in d['trades'] if x['status']!='thinking']; sys.exit(0 if t else 1)"; then
    echo "$out" | python3 -c "
import json,sys; d=json.load(sys.stdin)
for t in d['trades'][:2]:
  print(t['status'], t['side'], t.get('strike'), t['size'], (t.get('leg') or {}).get('digest'))
  for s in t['steps']: print('   ', 'OK' if s['ok'] else 'NO', s['tool'], '-', s['detail'][:150])"
    exit 0
  fi
  sleep 10
done
echo "no ghost cycle within 10 minutes"
