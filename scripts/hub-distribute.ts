// Send SUI gas and USDC from a hub wallet to one app wallet (e.g. the Yojimbo bot).
// The hub key is read by variable name from the env file you pass; it is never printed.
//
//   Fork (default):  tsx scripts/hub-distribute.ts --keys-file .env.fork --to <0x...> --sui 3 --usdc 20
//   Mainnet:         tsx scripts/hub-distribute.ts --mainnet --keys-file <hub env> --to <0x...> --sui 1 --usdc 15
//
// Without --mainnet the RPC must be a local sui-fork (default http://127.0.0.1:9796) and must answer the
// fork admin service. With --mainnet the RPC defaults to https://fullnode.mainnet.sui.io:443, is refused if it
// is a fork, and the transfer moves real funds.
import { parseArgs } from 'node:util';
import { keyFromEnvFile, forkUrl } from '../packages/core/src/fork.ts';
import { distributeFromHub, type HubTarget } from '../packages/core/src/hub.ts';
const { values } = parseArgs({ options: {
  'keys-file': { type: 'string' }, 'hub-var': { type: 'string', default: 'SUI_HUB_KEY' }, to: { type: 'string' },
  'to-keys-file': { type: 'string' }, 'to-var': { type: 'string', default: 'YOJIMBO_BOT_KEY' },
  sui: { type: 'string', default: '0' }, usdc: { type: 'string', default: '0' }, rpc: { type: 'string' }, mainnet: { type: 'boolean', default: false },
} });
if (!values['keys-file']) throw new Error('Pass --keys-file <file holding the hub key>');
const hub = keyFromEnvFile(values['keys-file'], values['hub-var']!);
const to = values.to ?? (values['to-keys-file'] ? keyFromEnvFile(values['to-keys-file'], values['to-var']!).toSuiAddress() : undefined);
if (!to) throw new Error('Pass --to <address> or --to-keys-file <file> [--to-var NAME]');
const target: HubTarget = values.mainnet
  ? { kind: 'mainnet', url: values.rpc ?? 'https://fullnode.mainnet.sui.io:443' }
  : { kind: 'fork', url: forkUrl({ YOJIMBO_SUI_FORK_RPC: values.rpc ?? 'http://127.0.0.1:9796' })! };
const out = await distributeFromHub(target, hub, to, { sui: Number(values.sui), usdc: Number(values.usdc) });
console.log(JSON.stringify(out, null, 2));
if (out.result.status.status !== 'success') process.exit(1);
