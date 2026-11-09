// Adds fresh fork-only Ed25519 keys to an app's env file (created mode 600 if missing) and prints addresses only.
// Existing variables are kept. Usage: tsx scripts/fork-app-keys.ts --keys-file ../eidolon/.env.fork EIDOLON_GHOST_KEY EIDOLON_PLAYER_KEY
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { generateForkKey, keyFromEnvFile } from '../packages/core/src/fork.ts';
const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'keys-file': { type: 'string' }, set: { type: 'string', multiple: true, default: [] } } });
const file = values['keys-file'];
if (!file || !positionals.length) throw new Error('Usage: --keys-file <file> [--set NAME=value ...] KEY_VAR [KEY_VAR ...]');
if (!existsSync(file)) writeFileSync(file, '# Fork-only keys and settings (gitignored). Never fund these on mainnet.\n', { mode: 0o600 });
const have = parseEnv(readFileSync(file, 'utf8'));
for (const pair of values.set!) { const [name] = pair.split('='); if (!(name in have)) appendFileSync(file, `${pair}\n`); }
for (const name of positionals) if (!have[name]) appendFileSync(file, `${name}=${generateForkKey().secret}\n`);
console.log(JSON.stringify(Object.fromEntries(positionals.map(name => [name, keyFromEnvFile(file, name).toSuiAddress()]))));
