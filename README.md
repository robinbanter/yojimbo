# Yojimbo (用心棒)

An AI bodyguard for a leveraged SUI/USDC DeepBook Margin position while its owner sleeps, flies, or works. It recalls the owner's schedule and rules, acts within hard limits, and changes its next decision after an owner override.

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

The watched decision runs the same deterministic `decide` engine at the current time. With Walrus Memory configured it recalls the watched owner's rules and schedules. Without memory it shows **defaults: no remembered rules (Walrus Memory setup required)**; the default alert ratio is 1.5 (or `YOJIMBO_ALERT_RATIO`), the per-action cap is `YOJIMBO_MAX_DEFENCE_USDC`, and no rule authorizes a defence. **Dry-run the defence** requires `YOJIMBO_BOT_KEY` and only simulates a position owned by that bot wallet. Watch mode never submits a transaction. Chat can read a watched position and list recent managers without memory, provided the agent model is configured; memory writes return **Setup required: Walrus Memory**.

For an isolated walkthrough, run `PORT=8795 VITE_PORT=5185 YOJIMBO_DEV_SUI_RPC=https://fullnode.mainnet.sui.io:443 pnpm dev` and open <http://localhost:5185>. These ports are environment overrides; the normal defaults remain 8787 and 5173.

Set `YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS` only after funding the bot wallet and reviewing its rules. Without it, the Tatum path builds each transaction and stops at `sui_dryRunTransactionBlock`. The dev gRPC path stops at `simulateTransaction`. The server checks `YOJIMBO_MAX_DEFENCE_USDC` per action and `YOJIMBO_DAILY_USDC` against successful mainnet defences. `create_margin_manager` and `open_position` in chat are also gated. Opening deposits USDC, borrows USDC and buys SUI through the bot-owned manager; it refuses a manager with existing debt.

## Loop

1. The 15-second watcher reads the bot manager state and SUI oracle price through the configured Sui transport. It triggers at the personal alert ratio (default 1.5) or a remembered move threshold.
2. It recalls schedule, rule and override blobs from Walrus Memory namespace `yojimbo-v1:<bot-address>`. If memory is unavailable or no recalled rule permits an action, it does not defend. Each decision exposes the recalled blob IDs.
3. The pure rule engine resolves `guard-alone` or `ask-first` from recalled schedules, then applies the newest override matching mode, ratio and price move. In ask-first mode, the in-app Approve / Reduce / Ignore request times out after 60 seconds to the recalled rule's `defaultOnTimeout` (default Ignore).
4. A defence is a USDC collateral deposit, reduce-only market order with loan repayment, or repayment from available quote balance. The SDK and contract enforce the actual risk checks. A successful or failed dry run is reported as such. Live transaction links point to Suiscan.
5. Each defence writes an event memory with before/after ratio, SUI price and move, mode, action, outcome, digest and rule IDs. Owner corrections or approvals create override memories and the next similar decision quotes the override. At the UTC date rollover, a daily summary is stored. P&L is reported as unavailable until a cost basis is available.

Chat uses OpenRouter tool calls for reads, rule and schedule entry, override recording, simulation and gated defence. Every tool call and result streams to the UI. The model writes messages and parses intent; it does not select defence actions. Telegram is optional: with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, Yojimbo sends alerts first and parses replies into override memories. Without both, the status bar shows Setup required and in-app notifications remain available.

## HTTP

`GET /status`, `/registry`, `/position`, `/managers/recent`, `/watch/:managerId`, `/memory`, `/events`, `/stream` (SSE); `POST /chat` (SSE), `/decision`, and `/watch/:managerId` with `{"action":"dry-run"}`. The Vite app proxies these through `/api`. Both servers bind to localhost. Event rows are persisted in ignored `data/events.json`; Walrus is the source for remembered decisions.

See [TESTING.md](TESTING.md) for observed results and [BLOCKED.md](BLOCKED.md) for remaining setup.

## Art

Art generated with ChatGPT (image generation), directed in [docs/ART.md](docs/ART.md); source PNGs are not committed, the web app ships WebP copies in `packages/web/public/art/`.
