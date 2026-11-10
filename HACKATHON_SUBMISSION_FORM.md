# Total Recall (Tatum × Walrus Memory): submission form, Yojimbo

Deadline: **Nov 10 2026, 17:00 UTC** (22:30 IST). Items marked **PENDING** must be finished, or left out of the form, before submitting. Items marked **Nick fills** need Nick's own account or decision.

## Project name

Yojimbo (用心棒)

## Track

02 Smart Agents for Real Life

## One-liner

A margin exchange with a bodyguard: trade SUI/USDC long or short on DeepBook Margin, and an AI bodyguard that remembers your rules on Walrus Memory defends the position within your caps while you sleep.

## Description

Leverage never sleeps. A DeepBook Margin position on Sui can be liquidated at 3 a.m. while its owner is asleep or on a plane. Yojimbo is a margin exchange with a bodyguard built in.

The terminal lists every DeepBook Margin pool. Only SUI/USDC trades today: the other pools are marked "coming soon", with the reason, because they failed on a local fork of Sui mainnet. On SUI/USDC you can go long or short. The bodyguard guards the position from its own dedicated bot wallet.

The owner tells it in plain words when they sleep or fly, how much it may spend per defence, and to add collateral rather than close. Yojimbo stores each of those as a rule or a schedule on Walrus Memory. A watcher reads the position and the SUI oracle price every 15 seconds. When the risk ratio crosses the owner's line, a deterministic rule engine decides what to do. It works out which mode applies now (guard alone, or ask first), applies the newest matching owner override, and acts only within per-action and daily USDC caps. The tightest cap any remembered rule names limits every defence. A defence is a collateral deposit, a reduce-only trade with loan repayment, or a repayment from spare USDC. Each one is recorded with the ratio before and after, the price, the mode, the rule IDs and the transaction digest.

Chat is a panel docked beside the terminal. It runs on Claude Haiku (`claude-haiku-5-5`), its tool steps show as it works, and it sees the selected pair and your positions. The model writes messages and parses intent; it never picks the defence. Telegram alerts go out through @Yojimbo_robot, and a reply there becomes an override memory.

**Status, stated plainly:**
- **Hosted 24/7** at https://yojimbo.201-18-198-162.sslip.io in **dry-run**: live Sui mainnet reads through Tatum, Walrus Memory on mainnet, Claude chat and Telegram ready. Mainnet writes are off (`mainnetWrites: false`) and need Nick's yes.
- **Walrus Memory on mainnet: 14 memories** in `yojimbo-v1:0x923d5acc…556f`, including a "forget" (retire) memory.
- **Proven on a LOCAL FORK of Sui mainnet** (checkpoint 343730776, real Move execution, no real funds), with the owner's Walrus rules recalled read-only: a short at 2× defended with 3 USDC (risk ratio 2.006 → 2.509), then a long at 1.5× defended with 3 USDC (3.0 → 4.0), and an unwind with no debt left.
- **PENDING:** any mainnet transaction with real funds. None has been sent. The bot wallet `0x923d5acc7c895a8f9d27d1e0712b717e1682e4d6490d82f2894e598e88c5556f` holds 0 SUI and 0 USDC.

## How it uses Walrus Memory

Each bot wallet gets its own namespace, `yojimbo-v1:<bot address>`, through the `@mysten-incubation/memwal` SDK on the mainnet relayer `relayer.memory.walrus.xyz`. Yojimbo stores five kinds of memory:

1. **Rules:** for example "if the risk ratio is at or below 3.2, deposit up to 5 USDC", with an alert ratio, an action, a USDC cap and a timeout default for ask-first mode.
2. **Schedules:** recurring windows ("daily 01:00–08:00 Asia/Kolkata: guard alone"), including overnight weekday windows that carry Monday into Tuesday morning.
3. **Overrides:** owner corrections and approvals, matched to later decisions by mode, ratio and price move. The newest similar override wins.
4. **Event memories:** each defence, with the ratio before and after, SUI price and move, mode, action, outcome, digest and the IDs of the rules it followed. There is also a daily summary at the UTC date rollover.
5. **Forget (retire) memories:** Walrus is append-only, so "forget that rule" is itself a memory listing the retired IDs. Retired rules stop counting and show struck through in the app.

Before every decision, the watcher recalls schedules, rules and overrides by semantic query. Each decision shows the blob IDs it recalled. If memory is unavailable, or no recalled rule allows an action, Yojimbo does not defend. It fails closed and says **Setup required: Walrus Memory**.

**Status: 14 memories on Walrus mainnet** (Nov 10, 01:15 UTC), all written through the chat agent's tools, including one retire memory. The first pass exposed real agent mistakes: it dated one-time windows 2025, stored "weekends" as every day, and invented caps of 10,000 and 1,000,000 USDC for rules that named no amount. We fixed the agent (`d04e38e`): it now gets today's date, has a `weekends` schedule, refuses a cap above the hard limit and a window that has already ended, and ignores 0 for any threshold the owner never stated. Then the owner told it to forget the five wrong memories (one `retire` memory) and stored them again correctly. On the LOCAL FORK, the server recalls these mainnet memories read-only and refuses Walrus writes, so the fork defences wrote no event memories. A mainnet run with real funds would add the defence event, an owner override and the daily summary; it is **PENDING**. Mainnet blobs took over 60 s to certify, so each write waits up to 300 s. We will report the real count from the relayer, not an estimate.

## How it uses Tatum

All Sui reads and transactions go through **Tatum's Sui gRPC gateway** (`sui-mainnet-grpc.gateway.tatum.io:443`, TLS, `x-api-key` metadata). Yojimbo builds a `SuiGrpcClient` from `@mysten/sui` over `@grpc/grpc-js`, with a process-wide limiter for Tatum's free plan (3 requests a second, with backoff on HTTP 429).

- **Reads (live):** the DeepBook margin registry and pool thresholds, MarginManager balances and debt, and Pyth SUI and USDC price objects. On Nov 9 2026, `pnpm test:live` reported `source: "Tatum"`, margin package v8, liquidation ratio 1.1, and live risk ratios for 5 recent SUI/USDC managers. One exception: Tatum's gateway refuses `LedgerService/ListEvents`, so the recent-manager event list uses the public Sui fullnode. Every other read goes through Tatum.
- **Transactions (PENDING on mainnet):** creating the margin manager, opening the position, every defence and the unwind are simulated first, then signed by the bot wallet and sent through Tatum. A send happens only with `YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS`. No mainnet transaction has been sent; a real-funds run needs Nick's yes. The hosted server answers `/status` with `rpc: "Tatum"` and `mainnetWrites: false` (checked Nov 10, 14:16 UTC).
- **Markets scan:** the terminal's pool list reads every DeepBook Margin pool through Tatum and retries rate-limited reads, so a Tatum 429 no longer marks SUI/USDC unsupported (`42d8cbd`).

## Tech stack

- TypeScript pnpm monorepo: `packages/core` (chain, memory, policy), `packages/server` (Node HTTP + SSE watcher and agent API), `packages/web` (React 19 + Vite 7).
- Sui: `@mysten/sui` 2.39, `@mysten/deepbook-v3` 2.11.1 (DeepBook Margin v8), Pyth price objects.
- Tatum Sui gRPC gateway through `@grpc/grpc-js` and `@protobuf-ts/grpc-transport`.
- Walrus Memory: `@mysten-incubation/memwal` 0.1.13.
- Chat: Claude Haiku (`claude-haiku-5-5`) tool calls when `ANTHROPIC_API_KEY` is set (`3e1466e`); OpenRouter (`nvidia/nemotron-3-ultra-550b-a55b:free`) stays the fallback.
- Deploy: Docker image (server + built web behind nginx), Traefik on a VPS, dry-run caps.
- Telegram alerts and replies, live on @Yojimbo_robot: the owner hears first, and a reply becomes an override memory on Walrus.
- Local fork: `sui-fork` from the official Sui release `mainnet-v1.83.1`.
- Tests: `pnpm test`, 25 passing (node:test via tsx, run Nov 10), plus `pnpm test:live` against mainnet.

## Repository

https://github.com/nickthelegend/yojimbo (secret scan passed Nov 10; Nick approved making it public. **Still private as of Nov 10, 14:20 UTC**: flip to public before submitting).

## Demo video

- Round 4 film, `videos/yojimbo/round4/yojimbo-round4.mp4` (3:14): the margin terminal, a short and a long on the LOCAL FORK, both defended by the bodyguard, the docked Claude chat explaining the position, the unwind and the night log. Every fork scene carries a LOCAL FORK badge. Fork digests are in `videos/yojimbo/round4/JUDGE.md` (workspace). Link: **Nick fills** (Drive).

## Tatum account ID

`6af1b0a07614eea902da0ee6` (Nick's Tatum account, given Nov 10).

## MEMWAL_AGENT_ID

`2b4e3b5934b41a0e2f99cc6c8ad582e2f20faff512b57dcdef0e6bd049b39f36`

This is the public half of Yojimbo's own Walrus Memory delegate key (the form asks for the agent's delegate public key; the dashboard at memory.walrus.xyz lists it under Delegate keys).

Account ID (SUI): `0xd2ca3cbe1bd663a5fe7df7c14590451bbc712255cfee59966b0b8413cdaa335a`. This is the Walrus Memory account ID. The code reads it as `MEMWAL_MAINNET_ACCOUNT_ID`. It is public and on chain: the relayer's `GET /config` gives package `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5`, and its `account::DelegateKeyAdded` events list Yojimbo's delegate key (label "Web App") under this account. The owner is `0x0cff6ac3b0396c3b449de58472dcf9cfd55f0bb2aefaca92c43315de128c7e93`. One account serves Yojimbo, Eidolon and Nakama, and each app signs with its own delegate key.

## Blog post

https://github.com/nickthelegend/yojimbo/blob/main/docs/BLOG.md

## Social post (bonus)

Drafts in [POST.md](POST.md). Post URL: **PENDING (Nick fills)**.

## Team

Nick (Nivesh Gajengi), GitHub `nickthelegend`. Solo.

## AI and tool disclosure

- **Claude (Anthropic)** and **Codex (OpenAI):** coding agents that wrote most of the code and docs under Nick's direction and review.
- **ChatGPT image generation:** the product art (prompts in `docs/ART.md`).
- **Chatterbox:** text-to-speech for the film voice-over.
- **Claude Haiku** (`claude-haiku-5-5`, Anthropic): the in-app chat agent on the hosted server. A free OpenRouter model (`nvidia/nemotron-3-ultra-550b-a55b:free`) is the fallback when no Anthropic key is set.
- The defence decision itself is deterministic code, not a language model.
