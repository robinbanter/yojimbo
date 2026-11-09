// Fork only: whale -> fork hub (SUI), then hub swaps SUI -> USDC on DeepBook SUI_USDC at the fork state.
// Usage: tsx scripts/fork-fund-hub.ts [--sui 120] [--swap-sui 52] [--min-usdc 40]
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { keyFromEnvFile, forkUrl, forkClient, forkStatus } from '../packages/core/src/fork.ts';
import { fundFromWhale, swapSuiForUsdcOnFork, balances } from '../packages/core/src/hub.ts';
const { values } = parseArgs({ options: { sui: { type: 'string', default: '120' }, 'swap-sui': { type: 'string', default: '52' }, 'min-usdc': { type: 'string', default: '40' }, 'env-file': { type: 'string', default: resolve(import.meta.dirname, '..', '.env.fork') } } });
const envFile = values['env-file']!;
const url = forkUrl({ YOJIMBO_SUI_FORK_RPC: process.env.YOJIMBO_SUI_FORK_RPC ?? 'http://127.0.0.1:9796' })!;
const hub = keyFromEnvFile(envFile, 'SUI_HUB_KEY');
const client = forkClient(url);
console.log('fork', JSON.stringify(await forkStatus(client)));
const fund = await fundFromWhale(url, hub.toSuiAddress(), Number(values.sui));
console.log('whale -> hub', JSON.stringify(fund));
if (fund.status.status !== 'success') process.exit(1);
const swap = await swapSuiForUsdcOnFork(url, hub, Number(values['swap-sui']), Number(values['min-usdc']));
console.log('hub swap SUI -> USDC', JSON.stringify(swap));
console.log('hub balances', JSON.stringify(await balances(client, hub.toSuiAddress())));
if (swap.status.status !== 'success') process.exit(1);
