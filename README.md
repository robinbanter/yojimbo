# Yojimbo (用心棒)

**A bodyguard for a borrowed-money trade while you sleep.** If you borrow to buy SUI and the price falls far enough, the exchange sells you out (liquidation), even at 3 a.m. You tell Yojimbo your rules in plain words, such as "while I sleep, add up to 5 USDC of collateral, never close". It watches the position, remembers your rules and schedule, acts only inside the caps you set, and adjusts its next decision when you correct it.

Total Recall (Tatum × Walrus Memory), track **02 Smart Agents for Real Life**. Submission fields: [HACKATHON_SUBMISSION_FORM.md](HACKATHON_SUBMISSION_FORM.md). Blog post: [docs/BLOG.md](docs/BLOG.md).

An AI bodyguard for a leveraged SUI/USDC DeepBook Margin position while its owner sleeps, flies, or works. It recalls the owner's schedule and rules, acts within hard limits, and changes its next decision after an owner override.

## Status: live today vs pending keys

| Piece | Today | What unblocks it |
|---|---|---|
| Tatum gRPC reads on Sui mainnet (registry, pool thresholds, MarginManager state, Pyth prices) | **Live.** `pnpm test:live` with `TATUM_API_KEY` reported `source: "Tatum"` on Nov 9 2026 (table below) | – |
| Recent-manager event list | Live, but through the **public Sui fullnode**, because Tatum's gateway refuses `LedgerService/ListEvents` | – |
| Watch mode, liquidation cushion, rule engine, dry-run refusal for positions Yojimbo does not own | Live, read-only | – |
| Full lifecycle: fund, create manager, open, watcher defence, unwind | Proven on a **LOCAL FORK of Sui mainnet** only (real Move execution, fork-only keys, no real funds) | – |
| Rules on the fork | From the local file `docs/fork-rules.json`, labelled `local-file:` in the app. **Not Walrus Memory** | – |
| Walrus Memory writes and recalls on mainnet | **PENDING.** 0 memories on mainnet; the event requires at least 10 | Nick: Walrus Memory account ID (`MEMWAL_MAINNET_ACCOUNT_ID`) |
| Mainnet transactions through Tatum (create, open, defence, unwind) | **PENDING.** None sent yet | Nick: hub funding (40 USDC + 2.5 SUI), then `YOJIMBO_BOT_KEY` funded from the hub (see the grokbot `MAINNET-RUNBOOK.md`) |
| Chat agent | Works on a free OpenRouter model (`nvidia/nemotron-3-ultra-550b-a55b:free`). It hits rate limits, and a second answer took about 80 s in testing | Optional: OpenRouter credit |
| Telegram alerts | Not set up (optional) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Public repo | **PENDING** | Nick makes the repo public |

## Try it

**Watch mode (Sui mainnet, read-only, no wallet needed).** Put `TATUM_API_KEY` in `.env`, then:

```sh
pnpm install
pnpm dev            # http://localhost:5173, server on localhost:8787
```

Under **On guard**, choose **Watch a position**. Yojimbo lists recent SUI/USDC margin positions closest to liquidation first and shows how far SUI can fall before each one is liquidated. Without a Tatum key, `YOJIMBO_DEV_SUI_RPC=https://fullnode.mainnet.sui.io:443 pnpm dev` uses the public node and labels every read **dev RPC (not Tatum)**. Watch mode never submits a transaction.

**Fork demo (a copy of Sui mainnet on your machine, no real funds).**

```sh
scripts/fork-demo.sh          # start a sui-fork, fund hub -> bot, open the position, run the server until it defends
scripts/fork-demo.sh status   # fork checkpoint plus hub and bot balances
scripts/fork-demo.sh stop
```

Open the UI against the fork with `cd packages/web && PORT=8796 VITE_PORT=5186 ./node_modules/.bin/vite --host 127.0.0.1`, then <http://127.0.0.1:5186>. A striped **LOCAL FORK** banner stays on screen. Details and every step: [docs/FORK.md](docs/FORK.md).

## Proof

### LOCAL FORK of Sui mainnet: fork-only digests

These digests exist **only on a local fork** (`sui-fork` from `mainnet-v1.83.1`, run 3, forked at checkpoint 343353046). **They are not mainnet transactions and are not on Suiscan.** Rules came from `docs/fork-rules.json`, not Walrus Memory.

| Step | Fork digest | Result |
|---|---|---|
| Fund: hub → bot, 3 SUI and 20 USDC | `J6xRzkV2FhRv789P3p84dMCJrzKj4f7AzCMhoWbWGdD2` | |
| Open: `createMarginManager` | `BbtHKCR2URGzFww4PDVssAQEXWsr9Ab7w7BWQsQVVfsd` | manager `0xf984…8a02` |
| Open: `openLong` (deposit 10, borrow 5, buy 16.2 SUI) | `2UWHSqSogL34NXqpjknm2SRHXG21Q5goYuMpFt22CCWp` | risk ratio 2.998967 |
| Defence by the watcher: deposit 5 USDC (rule `fork-deposit-below-3.2`) | `CrdqKWvg6WD9LCEpLRbwpo1rBTMY4f9rTJzEKhWkDgM4` | **2.999 → 3.999** (2.998967 → 3.9989668) |
| Unwind 1: sell 16.0 SUI, repay 5.000001 USDC | `2EL9xJXp9sG3M1SxL4WJ3k2HAcjDD5D71mFAwKJH82yB` | no debt left |
| Unwind 2: withdraw to the bot | `AQ8emCmYtpgRN8ftTNjw7XzuRPfkrj7CPt3Br1WyGetA` | manager empty |
| Unwind 3: return to the hub | `EE8XuY2RcsdMgSFSC37rAxnDbMoVAzyWjwZpd9nwwgCw` | 19.824842 of 20 USDC back |

Runs 1 and 2 (open and defence on separate forks) are in [docs/FORK.md](docs/FORK.md).

### Sui mainnet, watch mode (read-only)

| Read | Transport | Observed |
|---|---|---|
| `pnpm test:live`, Nov 9 2026 13:08 UTC: margin registry | **Tatum gRPC** (`source: "Tatum"`) | SUI/USDC enabled, margin package v8 `0x40fa…625f`, liquidation 1.1, minimum borrow 1.2499, minimum withdraw 2 |
| Same run: 5 recent SUI/USDC MarginManagers | State via **Tatum gRPC**; the event list via the public fullnode | live risk ratios 1000, 1.286, 2.499, 1.185, 1.311 |
| Same run: bot manager state and deposit dry-run | – | blocked: `YOJIMBO_BOT_KEY` not set |
| Round-2 watch pass ([TESTING.md](TESTING.md)) | public fullnode, labelled **dev RPC (not Tatum)** | 12 managers in 3.35 s; manager `0x7426…4593` at ratio 1.131, about 1.8% above liquidation |

No mainnet transaction digest exists yet. Mainnet Suiscan links will be added here after the funded run.

## Films (not public yet)

- `videos/yojimbo/yojimbo-fork-film-v1.mp4` (1:52): fund, open and defence on the LOCAL FORK, with a fork badge in every shot. Link: **PENDING upload**.
- `yojimbo-film-v3.mp4` (1:41): mainnet watch mode, the chat agent, and the phone layout. Its reads use the public Sui node and say so on screen; Walrus Memory shows **Setup required**. Link: **PENDING upload**.

Both live in the grokbot `videos/yojimbo/` folder, not in this repo.

## Custody and chain version

Yojimbo uses a **dedicated bot wallet**. The [MarginManager contract](https://github.com/MystenLabs/deepbookv3/blob/main/packages/deepbook_margin/sources/margin_manager.move) stores its deposit, withdraw and trade caps internally; owner operations validate the transaction sender. The [Sui integration guide](https://www.docs.sui.io/onchain-finance/deepbook/deepbook-margin/margin-integration) confirms that callers never hold the wrapped manager's caps. There is no transferable delegated TradeCap or DepositCap for another address. Fund `YOJIMBO_BOT_KEY` only with money you permit this bot to risk. It owns the MarginManager; never use a primary wallet key.

The installed `@mysten/deepbook-v3@2.11.1` targets mainnet margin **v8** package `0x40fa183b5602cd0f6c4d7b16c08766ad8d7d581608fbe3b2570fe72ab4f5625f`. The [contract information page](https://www.docs.sui.io/onchain-finance/deepbook/deepbook-margin/contract-information) still lists v3. The SDK's v8 builders and live registry reads are used here; do not pin the older v3 package. The margin registry is `0x0e40998b359a9ccbab22a98ed21bd4346abf19158bc7980c8291908086b3a742`.

## Start

Requires Node.js 22.23.4+, 24.22.1+, or 26.12.1+ for the current Walrus Memory SDK, plus pnpm 10. Copy `.env.example` to `.env` and fill the named values locally. `.env` is gitignored. Keep the application on localhost.

```sh
pnpm install
pnpm dev
```

Open <http://localhost:5173>. The server is on localhost port 8787. `pnpm build` and `pnpm test` run without credentials. `pnpm test:live` requires Tatum or `YOJIMBO_DEV_SUI_RPC=https://fullnode.mainnet.sui.io:443` for registry reads. The dev override uses Sui gRPC because the public fullnode no longer serves JSON-RPC. It is visibly labeled **dev RPC (not Tatum)** and cannot submit writes.

## Watch mode

Choose **Watch a position** under **On guard** to inspect real SUI/USDC MarginManagers without a bot key. The list comes from recent DeepBook Margin manager creation, borrow, collateral deposit and liquidation events. It is cached for five minutes in ignored `data/managers.json`; every displayed risk ratio and selected position state is read live. Managers are sorted by distance to the pool's liquidation ratio. Paste any SUI/USDC MarginManager ID to inspect its current assets, debt, oracle prices, thresholds and SuiScan object. The nearby liquidation list reports only positions in the current live sample; it can be empty.

The watched decision runs the same deterministic `decide` engine at the current time. With Walrus Memory configured it recalls the watched owner's rules and schedules. Without memory it shows **defaults: no remembered rules (Walrus Memory setup required)**; the default alert ratio is 1.5 (or `YOJIMBO_ALERT_RATIO`), the per-action cap is `YOJIMBO_MAX_DEFENCE_USDC`, and no rule authorizes a defence. **Dry-run the defence** requires `YOJIMBO_BOT_KEY` and only simulates a position owned by that bot wallet. Watch mode never submits a transaction.

Above the gauge, Yojimbo shows how far SUI can move before the position is liquidated. `liquidationCushion` in `packages/core/src/policy.ts` solves the risk ratio `(base·p + quote·q) / (quoteDebt·q + baseDebt·p)` for the SUI price `p` at the pool's liquidation ratio, using the manager's own balances and Pyth prices. It is tagged Danger under 3% and Watch under 10%. `watch_position` returns the same number to the chat agent. Chat can read a watched position and list recent managers without memory, provided the agent model is configured; memory writes return **Setup required: Walrus Memory**.

For an isolated walkthrough, run `PORT=8795 VITE_PORT=5185 YOJIMBO_DEV_SUI_RPC=https://fullnode.mainnet.sui.io:443 pnpm dev` and open <http://localhost:5185>. These ports are environment overrides; the normal defaults remain 8787 and 5173.

Set `YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS` only after funding the bot wallet and reviewing its rules. Without it, the Tatum path builds each transaction and stops at `sui_dryRunTransactionBlock`. The dev gRPC path stops at `simulateTransaction`. The server checks `YOJIMBO_MAX_DEFENCE_USDC` per action and `YOJIMBO_DAILY_USDC` against successful mainnet defences. `create_margin_manager` and `open_position` in chat are also gated. Opening deposits USDC, borrows USDC and buys SUI through the bot-owned manager; it refuses a manager with existing debt.

## Loop

1. The 15-second watcher reads the bot manager state and SUI oracle price through the configured Sui transport. It triggers at the personal alert ratio (default 1.5) or a remembered move threshold.
2. It recalls schedule, rule and override blobs from Walrus Memory namespace `yojimbo-v1:<bot-address>`. If memory is unavailable or no recalled rule permits an action, it does not defend. Each decision exposes the recalled blob IDs.
3. The pure rule engine resolves `guard-alone` or `ask-first` from recalled schedules, then applies the newest override matching mode, ratio and price move. In ask-first mode, the in-app Approve / Reduce / Ignore request times out after 60 seconds to the recalled rule's `defaultOnTimeout` (default Ignore).
4. A defence is a USDC collateral deposit, reduce-only market order with loan repayment, or repayment from available quote balance. The SDK and contract enforce the actual risk checks. A successful or failed dry run is reported as such. Live transaction links point to Suiscan.
5. Each defence writes an event memory with before/after ratio, SUI price and move, mode, action, outcome, digest and rule IDs. Owner corrections or approvals create override memories and the next similar decision quotes the override. At the UTC date rollover, a daily summary is stored. P&L is reported as unavailable until a cost basis is available.

Chat uses OpenRouter tool calls (default model `nvidia/nemotron-3-ultra-550b-a55b:free`; set `YOJIMBO_MODEL` to change it) for reads, rule and schedule entry, override recording, simulation and gated defence. Every tool call and result streams to the UI. The model writes messages and parses intent; it does not select defence actions. Telegram is optional: with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, Yojimbo sends alerts first and parses replies into override memories. Without both, the status bar shows Setup required and in-app notifications remain available.

## HTTP

`GET /status`, `/registry`, `/position`, `/managers/recent`, `/watch/:managerId`, `/memory`, `/events`, `/stream` (SSE); `POST /chat` (SSE), `/decision`, and `/watch/:managerId` with `{"action":"dry-run"}`. The Vite app proxies these through `/api`. Both servers bind to localhost. Event rows are persisted in ignored `data/events.json`; Walrus is the source for remembered decisions.

See [TESTING.md](TESTING.md) for observed results and [BLOCKED.md](BLOCKED.md) for remaining setup.

## AI and art disclosure

- **Code:** written with AI coding agents, Claude (Anthropic) and Codex (OpenAI), directed and reviewed by Nick.
- **Art:** generated with ChatGPT image generation, directed in [docs/ART.md](docs/ART.md). Source PNGs are not committed; the web app ships WebP copies in `packages/web/public/art/`.
- **Film voice:** synthetic voice-over made with Chatterbox text-to-speech. The screen recordings show the real app; program output is not edited.
- **In the product:** the chat agent runs on a free OpenRouter model (`nvidia/nemotron-3-ultra-550b-a55b:free` by default). The model writes messages and parses intent. It does not choose defence actions; the deterministic rule engine in `packages/core/src/policy.ts` does.

## License

MIT, see [LICENSE](LICENSE).
