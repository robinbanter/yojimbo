# Yojimbo: a bodyguard for your leverage while you sleep

*Total Recall hackathon (Tatum × Walrus Memory), track 02: Smart Agents for Real Life. By Nick (nickthelegend).*

## The problem

Borrowing to buy an asset works until the price moves the wrong way. On DeepBook Margin, Sui's on-chain margin market, every position has a risk ratio: what you hold divided by what you owe. When it falls to the pool's liquidation line (1.1 for SUI/USDC), the position can be liquidated. The bad move often comes while you're asleep or on a plane.

## What it does

Yojimbo guards one SUI/USDC margin position from its own bot wallet,. You talk to it in plain words: "I sleep from one to eight. If the ratio drops below 1.5, add up to 5 USDC of collateral. Never close." The chat agent turns that into a structured rule and a schedule, and its tool calls stream on screen.

A watcher reads the position and the SUI oracle price every 15 seconds. When the risk ratio crosses your line, a deterministic rule engine decides; the language model plays no part. The engine first works out which mode applies now: guard alone, or ask first (an approve / reduce / ignore request that times out to your chosen default). Next it applies the newest matching owner override, and then it checks hard per-action and daily USDC caps. A defence is a collateral deposit, a reduce-only sale that repays the loan, or a repayment from spare USDC. If no remembered rule allows an action, Yojimbo does nothing and says why.

Watch mode needs no wallet. It lists real SUI/USDC margin positions on Sui mainnet, closest to liquidation first, and shows how far SUI can fall before each one is liquidated. That figure comes from the position's own balances and Pyth prices and matches the chain's risk ratio to six decimal places.

## How it uses Tatum

Every Sui read and transaction is designed to go through Tatum's Sui gRPC gateway. Tatum's Sui JSON-RPC endpoint returned 404, so Yojimbo runs the Sui SDK's gRPC client over native gRPC, with the API key in the request metadata. The DeepBook margin registry, pool thresholds, each MarginManager's balances and debt, and the Pyth price objects are all read through Tatum. A read-only live test on November 9 reported `source: "Tatum"` and live risk ratios for five recent positions.

Tatum's free plan allows three requests a second, so all calls share one limiter with backoff on HTTP 429. The gateway refuses the event-listing method, so the list of recent positions comes from the public Sui fullnode; everything else uses Tatum.

Transactions are simulated first, then signed by the bot key and sent, and only when an explicit acknowledgement variable is set. **No mainnet transaction has been sent yet**; that waits on funding the hub wallet.

## How it uses Walrus Memory

Each bot wallet gets its own Walrus Memory namespace, which holds four kinds of memory:

- **rules:** a trigger ratio, an action, a cap and a timeout default;
- **schedules:** recurring windows, including overnight ones;
- **overrides:** your corrections and approvals;
- **events:** each defence with the ratio before and after, the price, the mode, the rule IDs and the digest, plus a daily summary.

Before each decision, the watcher recalls schedules, rules and overrides by semantic query. The decision card shows which memory blobs it used. If memory is unreachable, Yojimbo fails closed and does not defend.

**This is not live on mainnet yet.** The Walrus Memory account ID is still pending, so zero memories are stored on mainnet. The event requires at least ten, and writing them is the first job once the ID arrives.

## How it learned over time

Yojimbo doesn't train a model. By design, it learns the way a good bodyguard does, by remembering what its client said and corrected. Say it deposits collateral at 2 a.m. and you reply in the morning, "next time, ask me first." That reply becomes an override memory. The next time a similar situation comes up (same mode, similar ratio, similar price move), the engine recalls the override, follows it, and quotes your correction in the decision. A newer correction outranks an older one. Unit tests cover each case, including "no recalled rule means no action"; the suite has 14 passing tests.

What exists today is a rehearsal. On a local fork of Sui mainnet, with real Move execution and no real money, Yojimbo funded its bot wallet, opened a position (deposit 10 USDC, borrow 5), and defended it on its own with a 5 USDC deposit. The risk ratio rose from 2.999 to 3.999. It then unwound the position and returned 19.82 of the 20 USDC. On the fork, the rule came from a local file, not from Walrus Memory. The fork proves the transactions and the decision logic, but not the memory.

## What's next

1. Set the Walrus Memory account ID, then write at least ten memories to mainnet: the rules, the schedule, defence events and an override.
2. Fund the hub, then run the same lifecycle on mainnet through Tatum, with Suiscan links in the README.
3. Film that run live, and report the real memory count.

The chat agent runs on a free OpenRouter model, so it can be slow or rate-limited. It only parses intent and writes replies; decisions stay in tested code.
