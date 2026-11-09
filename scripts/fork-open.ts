// Fork only: with Yojimbo's own core code, create the bot's MarginManager (if none) and open a small SUI long.
// Usage: tsx scripts/fork-open.ts [--deposit 10] [--borrow 5]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { botKey, createMarginManager, openLong, position, managerState, forkUrl, forkClient, forkStatus, balances } from '../packages/core/src/index.ts';
const { values } = parseArgs({ options: { deposit: { type: 'string', default: '10' }, borrow: { type: 'string', default: '5' }, 'keys-file': { type: 'string', default: resolve(import.meta.dirname, '..', '.env.fork') } } });
const env = { ...process.env, ...parseEnv(readFileSync(values['keys-file']!, 'utf8')) } as NodeJS.ProcessEnv;
const url = forkUrl(env);
if (!url) throw new Error('YOJIMBO_SUI_FORK_RPC is required: this script only runs against a local fork');
const owner = botKey(env).toSuiAddress();
const client = forkClient(url);
const summary = (s: any) => ({ riskRatio: s.riskRatio, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset, baseDebt: s.baseDebt, quoteDebt: s.quoteDebt, suiPythUsd: Number(s.basePythPrice) / 10 ** s.basePythDecimals });
console.log('fork', JSON.stringify(await forkStatus(client)), 'bot', owner, JSON.stringify(await balances(client, owner)));
let p = await position(owner, env);
if (!p.managerId) {
  const created = await createMarginManager(owner, env);
  console.log('createMarginManager', JSON.stringify(created));
  if (created.mode !== 'fork' || created.status.status !== 'success') process.exit(1);
  p = await position(owner, env);
}
console.log('manager', p.managerId, JSON.stringify(summary(p.state)));
if (Number(p.state!.baseDebt) > 0 || Number(p.state!.quoteDebt) > 0) { console.log('position already open'); process.exit(0); }
const opened = await openLong(owner, p.managerId!, Number(values.deposit), Number(values.borrow), p.price!, env);
console.log('openLong', JSON.stringify(opened));
if (opened.mode !== 'fork' || opened.status.status !== 'success') process.exit(1);
const after = await managerState(p.managerId!, env);
console.log('after open', JSON.stringify(summary(after.state)), 'bot', JSON.stringify(await balances(client, owner)));
