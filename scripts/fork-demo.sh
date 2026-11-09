#!/usr/bin/env bash
# Yojimbo on a LOCAL FORK of Sui mainnet: no real funds, real Move execution.
#
#   scripts/fork-demo.sh            start (or reuse) the fork, fund hub -> bot, open a long, run the server until it defends
#   scripts/fork-demo.sh fork       only start the fork and wait until it answers
#   scripts/fork-demo.sh server     start the Yojimbo server against the fork (port 8796) and leave it running
#   scripts/fork-demo.sh fresh      stop everything and start a new fork in a new data dir (old dir is kept)
#   scripts/fork-demo.sh status     fork status and hub/bot balances
#   scripts/fork-demo.sh stop       stop the server and the fork by PID
#
# Keys live only in .env.fork (gitignored, created by scripts/fork-keys.ts). Nothing here reads any other .env.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${YOJIMBO_FORK_TOOLS:-$REPO/../yojimbo-fork-tools}"
SUI_VERSION="${YOJIMBO_SUI_FORK_VERSION:-mainnet-v1.83.1}"
BIN="$TOOLS/sui-${SUI_VERSION#mainnet-v}/sui-fork"
PORT_RPC="${YOJIMBO_FORK_PORT:-9796}"
STATE="$REPO/.fork"
TSX="$REPO/packages/core/node_modules/.bin/tsx"
WHALE=0xbc7e7537564bd939b62e5b24477ac00ba8cef33ccec72d63090a080a1253b725
export YOJIMBO_SUI_FORK_RPC="http://127.0.0.1:$PORT_RPC"
mkdir -p "$STATE" "$TOOLS"
DATA="$(cat "$STATE/data-dir" 2>/dev/null || echo "$TOOLS/data")"

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

need_bin() {
  [ -x "$BIN" ] && return
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) asset=macos-arm64 ;; Darwin-x86_64) asset=macos-x86_64 ;;
    Linux-x86_64) asset=ubuntu-x86_64 ;; Linux-aarch64) asset=ubuntu-aarch64 ;;
    *) echo "No Sui release asset for $(uname -sm)" >&2; exit 1 ;;
  esac
  echo "Downloading sui-fork from the official $SUI_VERSION release ($asset)…"
  tmp="$TOOLS/download-$$"; mkdir -p "$tmp" "$(dirname "$BIN")"
  curl -fsSL -o "$tmp/sui.tgz" "https://github.com/MystenLabs/sui/releases/download/$SUI_VERSION/sui-$SUI_VERSION-$asset.tgz"
  tar xzf "$tmp/sui.tgz" -C "$(dirname "$BIN")" ./sui-fork
  rm -rf "$tmp"
  xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true
}

start_fork() {
  need_bin
  if alive "$STATE/fork.pid"; then echo "fork already running (pid $(cat "$STATE/fork.pid"))"; else
    mkdir -p "$DATA"
    seed=(); [ -f "$DATA/seed_manifest.json" ] || seed=(--address "$WHALE")  # seed only on first boot of a data dir
    nohup "$BIN" start --network mainnet --data-dir "$DATA" --rpc-addr "127.0.0.1:$PORT_RPC" "${seed[@]}" > "$STATE/fork.log" 2>&1 &
    echo $! > "$STATE/fork.pid"
    echo "fork starting (pid $!, data $DATA, log $STATE/fork.log)"
  fi
  for _ in $(seq 1 90); do
    "$BIN" status --json --rpc-addr "127.0.0.1:$PORT_RPC" >/dev/null 2>&1 && break
    alive "$STATE/fork.pid" || { echo "sui-fork exited:"; tail -20 "$STATE/fork.log"; exit 1; }
    sleep 2
  done
  "$BIN" status --json --rpc-addr "127.0.0.1:$PORT_RPC"
}

start_server() {
  if alive "$STATE/server.pid"; then echo "server already running (pid $(cat "$STATE/server.pid"))"; return; fi
  ( cd "$REPO/packages/server"
    DOTENV_CONFIG_PATH="$REPO/.env.fork" nohup "$TSX" src/index.ts > "$STATE/server.log" 2>&1 &
    echo $! > "$STATE/server.pid" )
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:8796/status" >/dev/null 2>&1 && break; sleep 1; done
  echo "server on http://127.0.0.1:8796 (pid $(cat "$STATE/server.pid"), log $STATE/server.log)"
}

stop_all() {
  for name in server fork; do
    if alive "$STATE/$name.pid"; then kill "$(cat "$STATE/$name.pid")"; echo "stopped $name (pid $(cat "$STATE/$name.pid"))"; fi
    rm -f "$STATE/$name.pid"
  done
}

json_field() { python3 -c "import json,sys; d=json.loads(sys.stdin.read().strip().splitlines()[-1]); print($1)"; }

demo() {
  start_fork
  "$TSX" "$REPO/scripts/fork-keys.ts"
  hub_usdc=$("$TSX" "$REPO/scripts/fork-balances.ts" | json_field "d['hub']['usdc']")
  if python3 -c "import sys; sys.exit(0 if float('$hub_usdc') < 40 else 1)"; then
    "$TSX" "$REPO/scripts/fork-fund-hub.ts"
  else echo "hub already holds $hub_usdc USDC on the fork"; fi
  bot=$("$TSX" "$REPO/scripts/fork-balances.ts")
  if python3 -c "import sys,json; d=json.loads('''$bot'''); sys.exit(0 if d['bot']['sui'] < 1 else 1)"; then
    "$TSX" "$REPO/scripts/hub-distribute.ts" --env-file "$REPO/.env.fork" --to-env-file "$REPO/.env.fork" --sui 3 --usdc 20
  else echo "bot already funded on the fork"; fi
  "$TSX" "$REPO/scripts/fork-open.ts" --deposit 10 --borrow 5
  start_server
  echo "waiting for the watcher (every 15 s) to apply docs/fork-rules.json…"
  for _ in $(seq 1 40); do
    n=$(curl -s http://127.0.0.1:8796/events | python3 -c "import json,sys; print(len(json.load(sys.stdin)['events']))")
    [ "$n" -gt 0 ] && break; sleep 3
  done
  curl -s http://127.0.0.1:8796/events | python3 -m json.tool
  curl -s http://127.0.0.1:8796/status | python3 -c "import json,sys; d=json.load(sys.stdin); print('status:', d['rpc'], '| fork writes:', d['fork']['writes'], '| mainnetWrites:', d['mainnetWrites'])"
}

case "${1:-demo}" in
  demo) demo ;;
  fork) start_fork ;;
  server) start_fork; start_server ;;
  status) "$TSX" "$REPO/scripts/fork-balances.ts" ;;
  stop) stop_all ;;
  fresh) stop_all; new="$TOOLS/data-$(date +%Y%m%d-%H%M%S)"; echo "$new" > "$STATE/data-dir"; DATA="$new"; echo "new fork data dir $new (previous dirs kept)"; demo ;;
  *) sed -n 2,12p "$0"; exit 1 ;;
esac
