import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { toLots } from '../src/chain.js';
test('orders are floored to the pool lot size and refused below the minimum',()=>{
 assert.equal(toLots(16.343,0.1,1),16.3);
 assert.equal(toLots(16.3,0.1,1),16.3);
 assert.throws(()=>toLots(0.95,0.1,1),/minimum/);
});
