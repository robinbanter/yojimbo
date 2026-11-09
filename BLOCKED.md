# Setup Nick must provide

1. Hub funding: **40 USDC plus 2.5 SUI** to the hub `0xf5887bcfaa178fbcc29f560afce15734e13989955100f9a6b6154c34a79c1f11`.
2. The dedicated mainnet bot wallet (`YOJIMBO_BOT_KEY`) exists, `0x923d5acc7c895a8f9d27d1e0712b717e1682e4d6490d82f2894e598e88c5556f`, and is unfunded. Fund it from the hub with about **15 USDC plus 1 SUI**. The bot owns the MarginManager and its positions; do not use a primary wallet. After funding, run `pnpm test:live` to verify the manager state and deposit dry-run. The chat can create a bot-owned manager, gated by the mainnet acknowledgement.
3. The Tatum account ID for the submission form.
4. Making the repo public, and publishing the blog and the social post.
5. Optional: a Telegram bot token from @BotFather and the owner's chat ID for `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

Done: Tatum reads are live with `TATUM_API_KEY`, and Yojimbo's Walrus Memory delegate key authenticates to the mainnet relayer. Walrus is not a blocker. Its first rules are written after the OpenRouter daily reset, Nov 10 00:00 UTC.

`OPENROUTER_API_KEY` was present in the local process environment during development; it was never printed or committed. Confirm it is present in Nick's runtime environment. Keep `YOJIMBO_ALLOW_MAINNET` unset until the funded-wallet dry run succeeds and the rules and limits are reviewed.
