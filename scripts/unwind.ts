// Close the Yojimbo bot's SUI long (sell SUI lots, repay the USDC loan, withdraw everything) and return all of the
// bot's USDC and SUI to the hub. Keys are read by variable name from the files you pass; nothing secret is printed.
//
//   Fork (default):  tsx scripts/unwind.ts --keys-file .env.fork --to-keys-file .env.fork --to-var SUI_HUB_KEY
//   Mainnet:         tsx scripts/unwind.ts --mainnet --keys-file <yojimbo .env> --to <hub address>
//
// Without --mainnet the keys file must put Yojimbo in LOCAL FORK mode (YOJIMBO_SUI_FORK_RPC). With --mainnet it must
// not, and sending still needs YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS in that file (otherwise each step is
// only simulated).
import { readFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { botKey, position, unwindPosition, forkUrl, keyFromEnvFile, rpc, coinTotal, USDC } from '../packages/core/src/index.ts';
const { values } = parseArgs({ options: { 'keys-file': { type: 'string' }, to: { type: 'string' }, 'to-keys-file': { type: 'string' }, 'to-var': { type: 'string', default: 'SUI_HUB_KEY' }, mainnet: { type: 'boolean', default: false } } });
if (!values['keys-file']) throw new Error('Pass --keys-file <Yojimbo env file holding YOJIMBO_BOT_KEY>');
const env = { ...parseEnv(readFileSync(values['keys-file'], 'utf8')) } as NodeJS.ProcessEnv;
const fork = forkUrl(env);
if (!values.mainnet && !fork) throw new Error('Not in LOCAL FORK mode: pass --mainnet to unwind on mainnet');
if (values.mainnet && fork) throw new Error('--mainnet was passed but the keys file sets YOJIMBO_SUI_FORK_RPC');
const to = values.to ?? (values['to-keys-file'] ? keyFromEnvFile(values['to-keys-file'], values['to-var']!).toSuiAddress() : undefined);
if (!to) throw new Error('Pass --to <hub address> or --to-keys-file <file> [--to-var NAME]');
const owner = botKey(env).toSuiAddress();
const p = await position(owner, env);
if (!p.managerId) throw new Error('The bot has no MarginManager');
const client = rpc(env).client;
const wallet = async (address: string) => ({ address, sui: Number(await coinTotal(client as any, address, '0x2::sui::SUI')) / 1e9, usdc: Number(await coinTotal(client as any, address, USDC)) / 1e6 });
console.log('network', p.source, 'manager', p.managerId, 'before', JSON.stringify({ riskRatio: p.state!.riskRatio, baseAsset: p.state!.baseAsset, quoteAsset: p.state!.quoteAsset, quoteDebt: p.state!.quoteDebt }), 'bot', JSON.stringify(await wallet(owner)), 'return to', JSON.stringify(await wallet(to)));
const result = await unwindPosition(owner, p.managerId, to, env);
for (const s of result.steps) console.log(s.step, JSON.stringify(s.result), s.state ? JSON.stringify(s.state) : '');
console.log('done', result.done, 'bot after', JSON.stringify(await wallet(owner)), 'return address after', JSON.stringify(await wallet(to)));
if (!result.done) process.exit(1);
