# Setup Nick must provide

1. `TATUM_API_KEY` for normal Sui mainnet reads, SDK simulations and dry runs through the Tatum gateway.
2. A Walrus Memory mainnet account ID and delegate key for `MEMWAL_MAINNET_ACCOUNT_ID` and `MEMWAL_MAINNET_KEY`.
3. A dedicated bot wallet private key for `YOJIMBO_BOT_KEY`, funded with about **15 USDC plus 1 SUI**. The bot owns the MarginManager and its positions; do not use a primary wallet. After funding, run `pnpm test:live` to verify the manager state and deposit dry-run. The chat can create a bot-owned manager, gated by the mainnet acknowledgement.
4. Optional: a Telegram bot token from @BotFather and the owner's chat ID for `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

`OPENROUTER_API_KEY` was present in the local process environment during development; it was never printed or committed. Confirm it is present in Nick's runtime environment. Keep `YOJIMBO_ALLOW_MAINNET` unset until the funded-wallet dry run succeeds and the rules and limits are reviewed.
