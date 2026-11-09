import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { forkUrl } from '../src/fork.js';
test('fork mode only accepts a local endpoint and never alongside the mainnet gate',()=>{
 assert.equal(forkUrl({}),null);
 assert.equal(forkUrl({YOJIMBO_SUI_FORK_RPC:'http://127.0.0.1:9796'}),'http://127.0.0.1:9796');
 assert.throws(()=>forkUrl({YOJIMBO_SUI_FORK_RPC:'https://fullnode.mainnet.sui.io:443'}),/local/);
 assert.throws(()=>forkUrl({YOJIMBO_SUI_FORK_RPC:'http://127.0.0.1:9796',YOJIMBO_ALLOW_MAINNET:'I_ACKNOWLEDGE_REAL_FUNDS'}),/unset/);
 assert.throws(()=>forkUrl({YOJIMBO_SUI_FORK_RPC:'http://127.0.0.1:9796',YOJIMBO_DEV_SUI_RPC:'https://fullnode.mainnet.sui.io:443'}),/not both/);
});
