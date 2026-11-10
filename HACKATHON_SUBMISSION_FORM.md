# Total Recall (Tatum × Walrus Memory): submission form, Yojimbo

Deadline: **Nov 10 2026, 17:00 UTC** (22:30 IST). Items marked **PENDING** must be finished, or left out of the form, before submitting. Items marked **Nick fills** need Nick's own account or decision.

## Project name

Yojimbo (用心棒)

## Track

02 Smart Agents for Real Life

## One-liner

An AI bodyguard for your leveraged SUI trade: it remembers your rules and sleep schedule on Walrus Memory, watches the position through Tatum, and defends it within your caps while you sleep.

## Description

Leverage never sleeps. A DeepBook Margin position on Sui can be liquidated at 3 a.m. while its owner is asleep or on a plane. Yojimbo guards one SUI/USDC margin position from its own dedicated bot wallet.

The owner talks to it in plain words: "I sleep from one to eight; add up to 5 USDC of collateral, never close." Yojimbo stores that as a rule and a schedule. A watcher reads the position and the SUI oracle price every 15 seconds. When the risk ratio crosses the owner's line, a deterministic rule engine decides what to do. It works out which mode applies now (guard alone, or ask first), applies the newest matching owner override, and acts only within per-action and daily USDC caps. A defence is a collateral deposit, a reduce-only sale with loan repayment, or a repayment from spare USDC. Each defence is recorded with the ratio before and after, the price, the mode, the rule IDs and the transaction digest. When the owner corrects a decision ("next time, ask me first"), that override is remembered, and the next similar decision quotes it.

Watch mode works without any wallet. It lists real SUI/USDC margin positions on mainnet, closest to liquidation first, and shows how far SUI can fall before each one is liquidated. The figure is solved from the position's own balances and Pyth prices and reproduces the chain's risk ratio to 1e-6.

The chat agent's tool calls stream into the UI as it works. The language model writes messages and parses intent; it never picks the defence. That is done by the rule engine, which has unit tests.

**Status, stated plainly:**
- Live on Sui mainnet today: read-only watch mode, with reads through Tatum's gRPC gateway.
- Proven end to end on a **local fork of Sui mainnet**, with real Move execution and no real funds: fund, open, defence (risk ratio 2.999 → 3.999) and unwind (19.82 of 20 USDC returned). On the fork, rules come from a local file, not Walrus Memory.
- **Walrus Memory on mainnet is live: 14 memories** in `yojimbo-v1:0x923d5acc…556f` (Nov 10). The owner's rules and schedules (asleep 01:00–08:00 IST, recording today, flying Nov 12, weekends, a 3 USDC cap per defence, add collateral rather than close) were each stored by a chat-agent tool call, then recalled when the agent was asked what it remembers.
- **PENDING:** the first mainnet transaction. The bot wallet `0x923d5acc7c895a8f9d27d1e0712b717e1682e4d6490d82f2894e598e88c5556f` exists and is unfunded, waiting for hub funding.

## How it uses Walrus Memory

Each bot wallet gets its own namespace, `yojimbo-v1:<bot address>`, through the `@mysten-incubation/memwal` SDK on the mainnet relayer `relayer.memory.walrus.xyz`. Yojimbo stores five kinds of memory:

1. **Rules:** for example "if the risk ratio is at or below 3.2, deposit up to 5 USDC", with an alert ratio, an action, a USDC cap and a timeout default for ask-first mode.
2. **Schedules:** recurring windows ("daily 01:00–08:00 Asia/Kolkata: guard alone"), including overnight weekday windows that carry Monday into Tuesday morning.
3. **Overrides:** owner corrections and approvals, matched to later decisions by mode, ratio and price move. The newest similar override wins.
4. **Event memories:** each defence, with the ratio before and after, SUI price and move, mode, action, outcome, digest and the IDs of the rules it followed. There is also a daily summary at the UTC date rollover.
5. **Forget (retire) memories:** Walrus is append-only, so "forget that rule" is itself a memory listing the retired IDs. Retired rules stop counting and show struck through in the app.

Before every decision, the watcher recalls schedules, rules and overrides by semantic query. Each decision shows the blob IDs it recalled. If memory is unavailable, or no recalled rule allows an action, Yojimbo does not defend. It fails closed and says **Setup required: Walrus Memory**.

**Status: 14 memories on Walrus mainnet** (Nov 10, 01:15 UTC), all written through the chat agent's tools. The first pass exposed real agent mistakes: it dated one-time windows 2025, stored "weekends" as every day, and invented caps of 10,000 and 1,000,000 USDC for rules that named no amount. We fixed the agent (`d04e38e`): it now gets today's date, has a `weekends` schedule, refuses a cap above the hard limit and a window that has already ended, and ignores 0 for any threshold the owner never stated. Then the owner told it to forget the five wrong memories (one `retire` memory) and stored them again correctly. The funded mainnet run then adds the defence event, an owner override and the daily summary. Mainnet blobs took over 60 s to certify, so each write waits up to 300 s. We will report the real count from the relayer, not an estimate.

## How it uses Tatum

All Sui reads and transactions go through **Tatum's Sui gRPC gateway** (`sui-mainnet-grpc.gateway.tatum.io:443`, TLS, `x-api-key` metadata). Yojimbo builds a `SuiGrpcClient` from `@mysten/sui` over `@grpc/grpc-js`, with a process-wide limiter for Tatum's free plan (3 requests a second, with backoff on HTTP 429).

- **Reads (live):** the DeepBook margin registry and pool thresholds, MarginManager balances and debt, and Pyth SUI and USDC price objects. On Nov 9 2026, `pnpm test:live` reported `source: "Tatum"`, margin package v8, liquidation ratio 1.1, and live risk ratios for 5 recent SUI/USDC managers. One exception: Tatum's gateway refuses `LedgerService/ListEvents`, so the recent-manager event list uses the public Sui fullnode. Every other read goes through Tatum.
- **Transactions (PENDING on mainnet):** creating the margin manager, opening the position, every defence and the unwind are simulated first, then signed by the bot wallet and sent through Tatum. A send happens only with `YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS`. No mainnet transaction has been sent yet; it needs Nick's hub funding (40 USDC + 2.5 SUI to `0xf5887bcfaa178fbcc29f560afce15734e13989955100f9a6b6154c34a79c1f11`).

## Tech stack

- TypeScript pnpm monorepo: `packages/core` (chain, memory, policy), `packages/server` (Node HTTP + SSE watcher and agent API), `packages/web` (React 19 + Vite 7).
- Sui: `@mysten/sui` 2.39, `@mysten/deepbook-v3` 2.11.1 (DeepBook Margin v8), Pyth price objects.
- Tatum Sui gRPC gateway through `@grpc/grpc-js` and `@protobuf-ts/grpc-transport`.
- Walrus Memory: `@mysten-incubation/memwal` 0.1.13.
- Chat: OpenRouter tool calls; default free model `nvidia/nemotron-3-ultra-550b-a55b:free`.
- Telegram alerts and replies, live on @Yojimbo_robot: the owner hears first, and a reply becomes an override memory on Walrus.
- Local fork: `sui-fork` from the official Sui release `mainnet-v1.83.1`.
- Tests: `pnpm test`, 14 passing (node:test via tsx), plus `pnpm test:live` against mainnet.

## Repository

https://github.com/nickthelegend/yojimbo (**Nick fills / confirms**; the repo must be made public before submitting).

## Demo video

- Fork film, `yojimbo-fork-film-v1.mp4` (1:52): fund, open and defence on the local fork, with a fork badge in every shot. Link: **PENDING upload (Nick fills)**.
- Watch-mode film, `yojimbo-film-v3.mp4` (1:41): mainnet watch mode, chat agent and phone layout. Its reads use the public Sui node and are labelled on screen. Link: **PENDING upload (Nick fills)**.
- A mainnet film with Walrus Memory and a funded defence is planned after the first rules are written and the hub is funded.

## Tatum account ID

`6af1b0a07614eea902da0ee6` (Nick's Tatum account, given Nov 10).

## MEMWAL_AGENT_ID

`0xd2ca3cbe1bd663a5fe7df7c14590451bbc712255cfee59966b0b8413cdaa335a`

This is the Walrus Memory account ID. The code reads it as `MEMWAL_MAINNET_ACCOUNT_ID`. It is public and on chain: the relayer's `GET /config` gives package `0xe7c16fbea0560e7057e2bf7422feaa4fb313749fc69c9e9092fac7a33b81d7f5`, and its `account::DelegateKeyAdded` events list Yojimbo's delegate key (label "Web App") under this account. The owner is `0x0cff6ac3b0396c3b449de58472dcf9cfd55f0bb2aefaca92c43315de128c7e93`. One account serves Yojimbo, Eidolon and Nakama, and each app signs with its own delegate key.

## Blog post

[docs/BLOG.md](docs/BLOG.md). Published URL: **PENDING (Nick fills after publishing)**.

## Social post (bonus)

Drafts in [POST.md](POST.md). Post URL: **PENDING (Nick fills)**.

## Team

Nick (Nivesh Gajengi), GitHub `nickthelegend`. Solo.

## AI and tool disclosure

- **Claude (Anthropic)** and **Codex (OpenAI):** coding agents that wrote most of the code and docs under Nick's direction and review.
- **ChatGPT image generation:** the product art (prompts in `docs/ART.md`).
- **Chatterbox:** text-to-speech for the film voice-over.
- **OpenRouter, free model** (`nvidia/nemotron-3-ultra-550b-a55b:free`): the in-app chat agent. It is rate-limited on the free tier, so answers can be slow or refused with a readable 429 message.
- The defence decision itself is deterministic code, not a language model.
