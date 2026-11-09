#!/usr/bin/env bash
# Mainnet live run, started by the person who owns the funds (never by an agent). The Yojimbo server must be running
# with YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS on .env (port 8797 by default). It creates the bot's DeepBook
# MarginManager (if none) and opens a small SUI long: deposit and borrow in USDC. From then on Yojimbo's watcher guards
# the position on its own, following the rules recalled from Walrus, within YOJIMBO_MAX_DEFENCE_USDC and
# YOJIMBO_DAILY_USDC, and messages the owner on Telegram first.
# Usage: scripts/live-run.sh [deposit_usdc=6] [borrow_usdc=3]
set -euo pipefail
API="http://127.0.0.1:${PORT:-8797}"
DEPOSIT="${1:-6}"; BORROW="${2:-3}"
status=$(curl -sf "$API/status") || { echo "Yojimbo server is not running on $API"; exit 1; }
echo "$status" | python3 -c "
import json,sys; s=json.load(sys.stdin)
if s.get('fork'): sys.exit('This server is on a LOCAL FORK; use scripts/fork-demo.sh for rehearsals.')
if not s.get('mainnetWrites'): sys.exit('Live writes are off: start the server with YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS.')
print('server', s['rpc'], '| memory', s['memory'], '| telegram', s['telegram'], '| bot', s['wallet'])"
show() { python3 -c "
import json,sys; r=json.load(sys.stdin)
d=r.get('txDigest') or (r.get('result') or {}).get('txDigest')
print('$1:', r.get('note') or r.get('error'), ('https://suiscan.xyz/mainnet/tx/'+d) if d else '')"; }
curl -s -X POST "$API/bot/create" -H 'content-type: application/json' -d '{}' | show "create MarginManager"
curl -s -X POST "$API/bot/open" -H 'content-type: application/json' -d "{\"depositUsdc\":$DEPOSIT,\"borrowUsdc\":$BORROW}" | show "open SUI long ($DEPOSIT USDC deposit, $BORROW USDC borrow)"
echo "Yojimbo now guards this position on its own. Watch the console and your Telegram."
