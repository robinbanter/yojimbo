# Yojimbo on a local fork of Sui mainnet

This runs Yojimbo end to end with real Move execution against a **LOCAL FORK of Sui mainnet**, so no real funds are involved. A fork-only hub wallet receives SUI from a mainnet whale and swaps some of it for USDC on DeepBook. It then funds the bot. The bot opens a SUI/USDC margin long with Yojimbo's own `createMarginManager` and `openLong`. Yojimbo's server watches the position and defends it with a USDC collateral deposit.

Every digest below exists only on the local fork. None of them is on Suiscan.

## How it works

- **Fork.** `sui-fork` ships in the official Sui release (`mainnet-v1.83.1`, macOS arm64 binary, 78 MB). It needs no Docker, no VM and no source build. It serves Sui gRPC plus the `sui.forking.v1alpha` admin service on `127.0.0.1:9796`. When it needs an object, it fetches it from mainnet GraphQL as of the fork checkpoint.
- **Funds.** The fork accepts unsigned transactions from any address. Only `fundFromWhale` uses this, to move SUI out of devstack's default mainnet whale `0xbc7e…b725`. Every other transaction is signed with a fresh fork-only key from `.env.fork`, which is gitignored and created by `scripts/fork-keys.ts`. USDC comes from a real `swap_exact_base_for_quote` on the DeepBook SUI_USDC pool state at the fork checkpoint. Fees are paid in SUI, with no DEEP.
- **Yojimbo fork mode.** Set `YOJIMBO_SUI_FORK_RPC=http://127.0.0.1:9796`. Fork mode accepts only loopback addresses and refuses to start alongside `YOJIMBO_DEV_SUI_RPC` or `YOJIMBO_ALLOW_MAINNET`. Reads are labelled `LOCAL FORK of Sui mainnet`, and `/status` reports `LOCAL FORK of Sui mainnet @ checkpoint N`. Writes simulate first. They are sent only when `YOJIMBO_ALLOW_FORK_WRITES=LOCAL_FORK_ONLY`, with a fixed 0.1 SUI gas budget, and each returns its digest with the fork checkpoint.
- **Rules.** No Walrus Memory account is set up yet. On the fork, the rule engine recalls `docs/fork-rules.json` instead: a schedule that guards alone all day, plus "deposit up to 5 USDC if the risk ratio is at or below 3.2". The recalled IDs carry a `local-file:` prefix, and the decision source says it is not Walrus Memory.
- **Pyth.** Margin operations read the real Pyth `PriceInfoObject`s as they stood at the fork checkpoint (SUI $0.8264 in run 1, published 4 s before the checkpoint). The fork clock stays at the checkpoint timestamp: transactions advance the checkpoint number, not the clock. The oracle therefore stays fresh, and nothing fakes a price. A newer price would need a Hermes update, but the SDK's Pyth Core endpoint requires an access token (`pythAccessToken`), which is not configured. The demo therefore holds the price at the checkpoint and triggers the defence with a rule threshold (3.2) above the opened ratio (about 3.0), not with a price move. Do not run `sui-fork advance-clock`: once the Pyth objects age past the pool's limit, margin operations would likely abort. This has not been tested.

## Run it

```sh
scripts/fork-demo.sh          # start or reuse the fork, fund hub -> bot, open, run the server until it defends
scripts/fork-demo.sh status   # fork checkpoint plus hub and bot balances
scripts/fork-demo.sh server   # (re)start the Yojimbo server on 127.0.0.1:8796 against the fork
scripts/fork-demo.sh fresh    # stop, then start a new fork at the latest mainnet checkpoint in a new data dir
scripts/fork-demo.sh hub      # new fork with only the hub funded (base for the Eidolon / Nakama rehearsals)
scripts/fork-demo.sh stop     # stop the server and the fork
scripts/fork-apps-rehearsal.sh   # new fork + hub, fund Eidolon player/ghost and Nakama members, run both apps' rehearsals
scripts/unwind.ts --keys-file .env.fork --to-keys-file .env.fork --to-var SUI_HUB_KEY   # close the position, return funds
```

The script downloads `sui-fork` into `../yojimbo-fork-tools/` if it is missing. Fork state lives in `../yojimbo-fork-tools/data*` (about 5 MB each). PIDs and logs go to `.fork/`, and fork events to `packages/server/data-fork/`, all gitignored. Each step is also a standalone script: `fork-keys.ts`, `fork-fund-hub.ts`, `hub-distribute.ts`, `fork-open.ts` and `fork-balances.ts`, run with `packages/core/node_modules/.bin/tsx scripts/<name>`. A defence fires once per fresh fork. Afterwards the ratio is about 4.0, which is above the rule.

For the UI against the fork, run `cd packages/web && PORT=8796 VITE_PORT=5186 ./node_modules/.bin/vite --host 127.0.0.1` and open <http://127.0.0.1:5186>. The web app labels fork mode from `/status.fork` (commit e49a576).

Pass key files with `--keys-file`, not `--env-file`. tsx hands `--env-file` to Node, which would also load that file into `process.env`.

## Hub to app wallet (same shape as mainnet)

`scripts/hub-distribute.ts` sends SUI gas and USDC from a hub key to an app wallet. It reads the key by variable name from the env file you pass and never prints it.

```sh
# fork (default; the RPC must answer the sui-fork admin service)
tsx scripts/hub-distribute.ts --keys-file .env.fork --to-keys-file .env.fork --sui 3 --usdc 20
# mainnet: only with --mainnet; refuses a fork RPC; moves real funds (not run here)
tsx scripts/hub-distribute.ts --mainnet --keys-file <hub env file> --hub-var SUI_HUB_KEY --to <bot address> --sui 1 --usdc 15
```

## Unwind: close the position and return the funds

`scripts/unwind.ts` calls `unwindPosition` in three gated transactions. Each step re-reads the manager.

1. Sell 99% of the SUI at market, floored to lots, and repay the whole USDC loan. Without DEEP, the taker fee is paid in SUI from the manager, so selling all of it aborts in `balance_manager::withdraw_with_proof` (code 3).
2. Withdraw everything left in the manager, USDC and SUI, to the bot wallet.
3. Send every USDC coin plus the gas coin (all remaining SUI, minus this transaction's gas) to the hub.

On mainnet, the same script runs with `--mainnet --keys-file <Yojimbo .env> --to <hub address>`. It sends only when that file sets `YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS`. Without that, each step is only simulated.

## Recorded runs (fork-only digests)

Hub `0xce2bbe7322287839bbdd8e083682d08854b96e3fa3f2e6d7e206a3dbe58a5d24`, bot `0x5558474a2216d1caa829df59d6460064ae0bfc712213e23a6bfae28d13ab4515` (fork-only keys).

| Step | Run 1: forked at checkpoint 343343439 (manual) | Run 2: forked at checkpoint 343347199 (`fork-demo.sh fresh`) |
|---|---|---|
| Whale → hub, 120 SUI | `B46uE7j8eh1HwUywU5YuojEmALbLgqhU1DdCQwXY49Jd` | `B46uE7j8eh1HwUywU5YuojEmALbLgqhU1DdCQwXY49Jd`¹ |
| Hub swap of 52 SUI → USDC (DeepBook) | `5pV6bEmNtH163MsqGVbYiYfrg8PeSyhu3etrRuPWG9P6`, 42.890160 USDC | `5pV6bEmNtH163MsqGVbYiYfrg8PeSyhu3etrRuPWG9P6`¹, 42.813348 USDC |
| Hub → bot: 3 SUI and 20 USDC | `D9qgGX6KHiMeeudBpH8LAFQib6WmpMEgJ1oANU32dk31` | `4YBDZtvsq6dgEkcUzFMZVbQhLWUD7jXkssYAPvmgXsUK` |
| `createMarginManager` | `FNX4pdtBcxcrFg3f6YKPRD6T7vPHoVwTHVr5wUW2EH7H` → `0xc8f7abc2901aa04d736eb28710373cc5883abadf34a40216740c434ead6cfea0` | `C9ggbHrem8fjUUbRE7p2aK4ar7dXb1awEM59EwHtvjyo` → `0xe633d5b2333444edcf07add46db08453b85c05a6f130a6993c36ad1a26ba2a9a` |
| `openLong`: deposit 10, borrow 5 USDC, buy 16.3 SUI | `Ds52w7R4XWGr2672CXgXUuP4rJoujZJHwWudpEGZ2EG6`, risk ratio 2.9986612 | `5HgEHXtqabUaerTm6yUNKvb996MzBUVJcgCULEB7kCaw`, risk ratio 2.998504 |
| Server watcher defence: deposit 5 USDC (rule `fork-deposit-below-3.2`, guard-alone) | `GWckNkaoESWsYhUeTEie9WYYzGyohmyRree8kwxrCnvv`, **2.9986612 → 3.998661** | `HAZT84yAQp4Tmsrfhejw4NHHWvYqa1BrAuNZXBL1NDyU`, **2.998504 → 3.9985038** |

**Run 3**: forked at checkpoint 343353046, sharing the fork with the Eidolon and Nakama rehearsals. It ran the full lifecycle, including the unwind.

| Step | Digest | Result |
|---|---|---|
| Hub → bot: 3 SUI and 20 USDC | `J6xRzkV2FhRv789P3p84dMCJrzKj4f7AzCMhoWbWGdD2` | |
| `createMarginManager` | `BbtHKCR2URGzFww4PDVssAQEXWsr9Ab7w7BWQsQVVfsd` | manager `0xf9842d66314ce04a757c8022525aaae52da92032cc22487629774d9efbfb8a02` |
| `openLong`: deposit 10, borrow 5, buy 16.2 SUI | `2UWHSqSogL34NXqpjknm2SRHXG21Q5goYuMpFt22CCWp` | ratio 2.998967 |
| Watcher defence: deposit 5 USDC | `CrdqKWvg6WD9LCEpLRbwpo1rBTMY4f9rTJzEKhWkDgM4` | **2.998967 → 3.9989668** |
| Unwind 1: sell 16.0 SUI, repay 5.000001 USDC | `2EL9xJXp9sG3M1SxL4WJ3k2HAcjDD5D71mFAwKJH82yB` | no debt; 14.824842 USDC and 0.196 SUI left |
| Unwind 2: withdraw both to the bot | `AQ8emCmYtpgRN8ftTNjw7XzuRPfkrj7CPt3Br1WyGetA` | manager empty |
| Unwind 3: return to the hub | `EE8XuY2RcsdMgSFSC37rAxnDbMoVAzyWjwZpd9nwwgCw` | 19.824842 USDC and all SUI to the hub; bot at 0 / 0 |

Of the bot's 20 USDC, 19.82 came back. The 0.18 USDC difference is the cost of the round trip: two taker fees, the spread on 16 SUI, and borrow interest. Gas for the whole lifecycle was about 0.02 SUI.

¹ The same transaction bytes give the same digest on both forks. The whale's coin was unchanged between the two checkpoints, and the objects these transactions create derive from that digest. The effects still differ: run 2 swapped against a later order book and received 42.813348 USDC instead of 42.890160.

The first `openLong` attempt aborted in `order_info::validate_inputs` with code 2 (`EOrderInvalidLotSize`). Yojimbo sent `(deposit + borrow) × 0.9 / price` SUI, which is not a multiple of the pool's lot size, so this would have failed on mainnet too. `openLong` and the reduce defence now floor the quantity to the lot size.
