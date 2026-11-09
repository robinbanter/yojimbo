import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseManagerEvent, parseManagerObject, parseManagerState, SUI_USDC_POOL } from '../src/chain.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/manager-responses.json',import.meta.url),'utf8'));

test('real margin events identify manager activity and reject unrelated events',()=>{
 const item=parseManagerEvent(fixture.events[0]);
 assert.equal(item?.managerId,fixture.object.objectId);
 assert.equal(item?.activity,'LoanBorrowedEvent');
 assert.equal(item?.lastActivity,new Date(Number(fixture.events[0].json.timestamp)).toISOString());
 assert.equal(parseManagerEvent({...fixture.events[0],eventType:fixture.events[0].eventType.replace('LoanBorrowedEvent','LoanRepaidEvent')}),null);
});

test('real shared manager object supplies the owner and SUI/USDC pool',()=>{
 const activity=parseManagerEvent(fixture.events[0])!;
 const item=parseManagerObject(fixture.object,activity);
 assert.equal(item?.owner,fixture.object.json.owner);
 assert.equal(item?.pool,'SUI_USDC');
 assert.equal(fixture.object.json.deepbook_pool,SUI_USDC_POOL);
 assert.equal(parseManagerObject({...fixture.object,json:{...fixture.object.json,deepbook_pool:'0x'+'0'.repeat(64)}},activity),null);
});

test('real manager state parses oracle prices and preserves risk and debt',()=>{
 const parsed=parseManagerState(fixture.state);
 assert.equal(parsed.price,0.81715958);
 assert.equal(parsed.quotePrice,0.99976687);
 assert.equal(parsed.state.riskRatio,1.244541698);
 assert.equal(parsed.state.quoteDebt,'39.587727');
 assert.equal(parsed.state.currentPrice,'817350');
});
