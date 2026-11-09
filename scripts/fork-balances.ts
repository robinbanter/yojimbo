// Fork only: print SUI and USDC coin totals for the hub and bot addresses from .env.fork (addresses only).
import { resolve } from 'node:path';
import { keyFromEnvFile, forkClient, forkStatus } from '../packages/core/src/fork.ts';
import { balances } from '../packages/core/src/hub.ts';
const file = resolve(import.meta.dirname, '..', '.env.fork');
const client = forkClient(process.env.YOJIMBO_SUI_FORK_RPC ?? 'http://127.0.0.1:9796');
console.log(JSON.stringify({ fork: await forkStatus(client), hub: await balances(client, keyFromEnvFile(file, 'SUI_HUB_KEY').toSuiAddress()), bot: await balances(client, keyFromEnvFile(file, 'YOJIMBO_BOT_KEY').toSuiAddress()) }));
