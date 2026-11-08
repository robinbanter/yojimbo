# Yojimbo

An AI bodyguard for a dedicated DeepBook Margin wallet.

## Custody

Yojimbo uses a **bot wallet**. The DeepBook Margin SDK does not expose a transferable delegated capability for the wrapped BalanceManager. The [MarginManager source](https://github.com/MystenLabs/deepbookv3/blob/main/packages/deepbook_margin/sources/margin_manager.move) stores its deposit, withdraw, and trade caps internally and checks `ctx.sender() == self.owner` for owner operations. Fund `YOJIMBO_BOT_KEY` with only the amount you authorize Yojimbo to risk. It owns its MarginManager. Never import a primary wallet key.

The installed SDK is the source of truth for active package and transaction builders. Version 2.11.1 declares mainnet margin package `0x40fa183b5602cd0f6c4d7b16c08766ad8d7d581608fbe3b2570fe72ab4f5625f` (v8), newer than the v3 address in the brief. The server reports live chain checks before enabling any action.
