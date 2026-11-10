# Yojimbo (用心棒)

**A margin exchange with a bodyguard.** Trade SUI/USDC long or short with borrowed money on DeepBook Margin. If the price moves far enough against you, the exchange sells you out (liquidation), even at 3 a.m. Yojimbo's bodyguard watches the position, remembers your rules and schedule on Walrus Memory, defends only inside the caps you set, and adjusts its next decision when you correct it.

Total Recall (Tatum × Walrus Memory), track **02 Smart Agents for Real Life**. Submission fields: [HACKATHON_SUBMISSION_FORM.md](HACKATHON_SUBMISSION_FORM.md). Blog post: [docs/BLOG.md](docs/BLOG.md).

- **The terminal** lists every DeepBook Margin pool. Only **SUI/USDC** trades; the other pools show "coming soon" with the reason, because they failed on a local fork of Sui mainnet.
- **The bodyguard** defends from its own bot wallet within hard caps (the owner's Walrus rule caps each defence at 3 USDC). A deterministic rule engine picks every defence.
- **Chat** is a docked panel on Claude Haiku (`claude-haiku-5-5`) with visible tool steps. It sees the selected pair and your positions. Telegram alerts go through @Yojimbo_robot.
- **Honest status:** no mainnet transaction with real funds has been sent. The trades and defences ran on a **LOCAL FORK of Sui mainnet**; the reads and the 14 Walrus memories are real mainnet.

## Live

| What | Where |
|---|---|
| Web app + API, 24/7 on a VPS (**dry-run**) | https://yojimbo.201-18-198-162.sslip.io. `/api/status` on Nov 10, 14:16 UTC: `rpc: "Tatum"`, `memory: "Walrus mainnet"`, `telegram: "Telegram ready"`, chat `Claude (claude-haiku-5-5)`, `mainnetWrites: false`. Mainnet writes need Nick's yes |
| Telegram alerts | @Yojimbo_robot |
| Round 4 film | `videos/yojimbo/round4/yojimbo-round4.mp4` (3:14, grokbot workspace); public link after upload |

## Status: live today vs pending

| Piece | Today | What unblocks it |
|---|---|---|
| Tatum gRPC reads on Sui mainnet (registry, every margin pool, MarginManager state, Pyth prices) | **Live.** The hosted server reports `rpc: "Tatum"`; `pnpm test:live` reported `source: "Tatum"` on Nov 9 | – |
| Recent-manager event list | Live, but through the **public Sui fullnode**, because Tatum's gateway refuses `LedgerService/ListEvents` | – |
| Margin terminal: every DeepBook Margin pool listed, SUI/USDC long and short | **SUI/USDC only.** The other pools are "coming soon" with the fork finding (`2294651`) | Each pool passing the fork test |
| Full lifecycle: fund, open long or short, watcher defence, unwind | Proven on a **LOCAL FORK of Sui mainnet** only (real Move execution, fork-only keys, no real funds). Round 4 (checkpoint 343730776): short 2× defended 2.006 → 2.509 (+3 USDC, fork digest `DusobxFo9bXgxchBcSDZUC3MpyFtZEURLAwuaTq1qXmR`); long 1.5× defended 3.0 → 4.0 (+3 USDC, `HWCZve2p2oaQAqRMGAd3GDf9b3b3WQLLB37fpMXJxsbg`). Not on Suiscan | – |
| Rules on the fork | The owner's real Walrus mainnet memories, recalled **read-only**; Walrus writes are refused on the fork (`b1ee7fd`). Earlier fork runs used `docs/fork-rules.json` | – |
| Walrus Memory on mainnet | **Live: 14 memories** in `yojimbo-v1:0x923d5acc…556f` (Nov 10, 01:15 UTC, counted from the relayer's namespace list), including one "forget" (retire) memory. Each was stored by a chat-agent tool call | – |
| Mainnet transactions through Tatum (create, open, defence, unwind) | **PENDING.** None sent. The bot wallet `0x923d5acc7c895a8f9d27d1e0712b717e1682e4d6490d82f2894e598e88c5556f` holds 0 SUI and 0 USDC | Nick's yes to use real funds |
| Chat agent | **Live** on Claude Haiku (`claude-haiku-5-5`) with tool steps and the app's screen context (`3e1466e`, `2497911`). OpenRouter's free model is the fallback without an Anthropic key | – |
| Telegram alerts | **Live** on @Yojimbo_robot. Alerts go out before any defence, and a reply is parsed into an override memory. Fork test alerts are labelled `[LOCAL FORK test · no real funds]` | – |
| Tests | `pnpm test`: **25 passing** (Nov 10) | – |
| Public repo | **PENDING**: private as of Nov 10, 14:20 UTC | Nick flips it to public |
| Film link, social post | **PENDING** | Nick uploads and posts |

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

### Walrus Memory on mainnet

| What | Observed |
|---|---|
| Account ID (public, on chain) | `0xd2ca3cbe1bd663a5fe7df7c14590451bbc712255cfee59966b0b8413cdaa335a`, owner `0x0cff6ac3b0396c3b449de58472dcf9cfd55f0bb2aefaca92c43315de128c7e93` |
| How it was found | On chain, not from a dashboard. The relayer's `GET https://relayer.memory.walrus.xyz/config` gives package `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5`. Its `account::DelegateKeyAdded` events list Yojimbo's delegate key (label "Web App") under that account |
| Delegate key | Yojimbo signs with its own delegate key. `POST /api/stats` on the mainnet relayer returned the owner above |
| Memories stored | **14** in `yojimbo-v1:0x923d5acc…556f` (Nov 10, 01:15 UTC), counted from the relayer's namespace list |
| Write wait | Mainnet blobs took over 60 s to certify, so each write now waits up to 300 s (`a63b4b2`) |

The memory count here will be the real count from the relayer, not an estimate.

## Films (not public yet)

- `videos/yojimbo/round4/yojimbo-round4.mp4` (3:14): the margin terminal, a short and a long on the LOCAL FORK, both defended, the docked Claude chat, the unwind and the night log. Link: **PENDING upload**.
- Earlier cuts: `yojimbo-fork-film-v1.mp4` (1:52, fork lifecycle) and `yojimbo-film-v3.mp4` (1:41, mainnet watch mode).

All live in the grokbot `videos/yojimbo/` folder, not in this repo.

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
