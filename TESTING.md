# Testing record — 2026-11-09

- `pnpm build`: 3 packages built, 0 errors.
- `pnpm test`: 6 tests passed, 0 failed. They cover recalled schedule mode, overnight weekday windows, newest similar override precedence, unrelated override rejection, and fail-closed defence and opening caps.
- Round-2 watch pass: `pnpm build` built all 3 packages with 0 errors; `pnpm test` passed **9 tests**, 0 failed, including 3 fixture tests from saved mainnet event, object and state responses.
- `YOJIMBO_DEV_SUI_RPC=https://fullnode.mainnet.sui.io:443 pnpm test:live`: registry passed; **5** recent SUI/USDC managers had finite live risk ratios (1.246, 2.558, 1.151, 1.270 and 1000 at the time of the run). The bot-owned deposit dry-run remained blocked by missing `YOJIMBO_BOT_KEY`.
- On isolated ports **8795/5185** with the dev override: `GET /registry` returned enabled=true, liquidation=1.1 and source="dev RPC (not Tatum)"; `GET /managers/recent` returned **12** managers with live ratios in 3.35 seconds, sorted closest first; **0** of these 12 were at or below liquidation. `GET /watch/0x7426…4593` returned risk ratio 1.131, SUI oracle $0.8172, liquidation 1.1 and `ask-first / ignore` from defaults with no remembered rules. Its dry-run endpoint returned **Setup required: YOJIMBO_BOT_KEY**. Vite and its API proxy returned HTTP 200.
- `YOJIMBO_DEV_SUI_RPC=https://fullnode.mainnet.sui.io:443 pnpm test:live`: 1 live registry check passed. SUI/USDC enabled; liquidation 1.1, minimum borrow 1.2499, minimum withdraw 2.0; SUI and USDC margin pool IDs matched the published IDs. The SDK used margin v8 package `0x40fa183b5602cd0f6c4d7b16c08766ad8d7d581608fbe3b2570fe72ab4f5625f`.
- `pnpm dev` with the dev override: Vite returned HTTP 200 at `localhost:5173`; `GET /status` returned the setup states; `GET /registry` returned the live values above. Server and UI launch succeeded.
- Manager state read: **0**, blocked because `YOJIMBO_BOT_KEY` was absent.
- Deposit dry-run: **0**, blocked because no funded bot-owned MarginManager was available. No successful defence is claimed.
- Tatum transport read: **0**, blocked because `TATUM_API_KEY` was absent.
- Walrus write/recall: **0** at the time, because delegate credentials were absent. Superseded by the Walrus readiness check below.
- Telegram delivery: **0**, optional token and chat ID absent.

Public Sui fullnode JSON-RPC returned “Method not found” during the first live attempt; the explicit dev override now uses gRPC. This does not validate the Tatum gateway or funded-wallet transaction path.

## Round-2 judging pass (Nov 9 2026)
- `pnpm test`: **12 passed**, 0 failed. New: 3 `liquidationCushion` tests. One uses the balances and Pyth prices of mainnet MarginManager `0x7426…4593`, reproduces the chain's risk ratio to 1e-6, and checks that the solved SUI price puts the ratio exactly on the 1.1 line. The others cover a short position and the no-debt and already-liquidatable cases.
- Chat, checked by hand against the dev server: `nvidia/nemotron-3-ultra-550b-a55b:free` called `watch_position` and answered "SUI would need to drop 1.84 percent" for that manager. The stream now closes after `done`, so a second question no longer hangs.

## Nov 9 2026, late: Tatum gRPC + fork
- `pnpm test`: **14 passed**, 0 failed (adds the liquidation-cushion and fork-mode tests).
- `pnpm test:live` through Tatum's gRPC gateway (13:08 UTC): margin registry plus live risk ratios for 5 positions read through Tatum. Event listing (recent managers) uses the public fullnode, because Tatum's gateway refuses `ListEvents`. The process-wide throttle keeps calls under Tatum's 3 requests/second.
- LOCAL FORK lifecycle (fund → open → watcher defence → unwind): see docs/FORK.md.

## Nov 9 2026, evening: Walrus Memory readiness
- Yojimbo's delegate key (label "Web App") is listed in the `account::DelegateKeyAdded` events of package `0xe7c16fbe…d7f5` (from the relayer's `GET /config`) under account `0xd2ca3cbe…335a`.
- `POST /api/stats` on the mainnet relayer returned owner `0x0cff6ac3…7e93`, so the key authenticates.
- Memories written: **0**. Rules are stored only through the chat agent's tools, and the shared OpenRouter free key hit "free-models-per-day" at 15:41 UTC. PENDING: first rules are written after the OpenRouter daily reset, Nov 10 00:00 UTC.
- Mainnet blobs took over 60 s to certify, so writes now wait up to 300 s (`a63b4b2`).
