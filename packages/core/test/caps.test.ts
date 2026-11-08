import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { executeDefence, openLong } from '../src/chain.js';
const state={baseAsset:'5',baseDebt:'0',quoteAsset:'0',quoteDebt:'10',price:2};
test('defence caps fail closed before any chain call',async()=>{
 await assert.rejects(executeDefence('0x1','0x2','deposit',11,state,0,{YOJIMBO_MAX_DEFENCE_USDC:'10',YOJIMBO_DAILY_USDC:'30'}),/cap/);
 await assert.rejects(executeDefence('0x1','0x2','deposit',5,state,27,{YOJIMBO_MAX_DEFENCE_USDC:'10',YOJIMBO_DAILY_USDC:'30'}),/cap/);
 await assert.rejects(executeDefence('0x1','0x2','deposit',5,state,0,{YOJIMBO_MAX_DEFENCE_USDC:'bad',YOJIMBO_DAILY_USDC:'30'}),/cap/);
});
test('opening amount over cap fails before any chain call',async()=>{
 await assert.rejects(openLong('0x1','0x2',11,5,2,{YOJIMBO_MAX_DEFENCE_USDC:'10'}),/cap/);
});
