import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { liquidationPrice, riskRatioAt, shortSellQuantity, coverQuantity } from '../src/sizing.js';
import { sideOf, poolKeyForAddress, parseManagerObject } from '../src/chain.js';
import { mainnetPools } from '@mysten/deepbook-v3';

test('long: liquidation price is below the current price and the ratio there equals L', () => {
  const s = { baseAsset: 20, quoteAsset: 0, baseDebt: 0, quoteDebt: 10 };
  const L = 1.1;
  const r = liquidationPrice(s, L)!;
  assert.equal(r.direction, 'below');
  assert.ok(Math.abs(r.price - 0.55) < 1e-12);
  assert.ok(Math.abs(riskRatioAt(s, r.price) - L) < 1e-12);
});

test('short: liquidation price is above the current price and the ratio there equals L', () => {
  // 10 USDC deposited + 8.3 USDC from selling 10 SUI at 0.83; owes 10 SUI.
  const s = { baseAsset: 0, quoteAsset: 18.3, baseDebt: 10, quoteDebt: 0 };
  const L = 1.1;
  const r = liquidationPrice(s, L)!;
  assert.equal(r.direction, 'above');
  assert.ok(Math.abs(r.price - 18.3 / 11) < 1e-12);
  assert.ok(r.price > 0.83);
  assert.ok(Math.abs(riskRatioAt(s, r.price) - L) < 1e-12);
});

test('liquidation price is null with no debt, or when no price move reaches L', () => {
  assert.equal(liquidationPrice({ baseAsset: 5, quoteAsset: 5, baseDebt: 0, quoteDebt: 0 }, 1.1), null);
  // Long whose USDC alone covers the debt at L: no SUI price can liquidate it.
  assert.equal(liquidationPrice({ baseAsset: 5, quoteAsset: 20, baseDebt: 0, quoteDebt: 10 }, 1.1), null);
  assert.equal(liquidationPrice({ baseAsset: 5, quoteAsset: 0, baseDebt: 0, quoteDebt: 10 }, NaN), null);
  assert.equal(riskRatioAt({ baseAsset: 1, quoteAsset: 1, baseDebt: 0, quoteDebt: 0 }, 1), Infinity);
});

test('short size: borrowBase wins, 99% is sold in whole lots, and dust below the minimum is refused', () => {
  assert.deepEqual(shortSellQuantity({ borrowBase: 6, price: 0.83, lotSize: 0.1, minSize: 1 }), { borrow: 6, sell: 5.9, notionalUsdc: 6 * 0.83 });
  const fromUsdc = shortSellQuantity({ borrowUsdc: 5, price: 0.5, lotSize: 0.1, minSize: 1 });
  assert.equal(fromUsdc.borrow, 10);
  assert.equal(fromUsdc.sell, 9.9);
  assert.throws(() => shortSellQuantity({ borrowBase: 1, price: 0.83, lotSize: 0.1, minSize: 1 }), /minimum/);
  assert.throws(() => shortSellQuantity({ price: 0.83, lotSize: 0.1, minSize: 1 }), /borrowBase or borrowUsdc/);
});

test('cover quantity rounds up to lots with a buffer, respects the minimum, and is 0 when already covered', () => {
  assert.equal(coverQuantity(6, 0, 0.1, 1), 6.2); // 6.12 -> 6.2
  assert.equal(coverQuantity(6, 0.1, 0.1, 1), 6.1); // 6.02 -> 6.1
  assert.equal(coverQuantity(0.5, 0, 0.1, 1), 1); // pool minimum
  assert.equal(coverQuantity(6, 7, 0.1, 1), 0);
  assert.equal(coverQuantity(100, 0, 1, 10), 102);
});

test('side comes from which asset is owed', () => {
  assert.equal(sideOf({ baseDebt: '0', quoteDebt: '5' }), 'long');
  assert.equal(sideOf({ baseDebt: '3', quoteDebt: '0' }), 'short');
  assert.equal(sideOf({ baseDebt: 0, quoteDebt: 0 }), 'none');
});

test('a manager on any known pool parses with that pool key; unknown pools are dropped', () => {
  assert.equal(poolKeyForAddress(mainnetPools.DEEP_USDC.address.toUpperCase().replace('0X', '0x')), 'DEEP_USDC');
  const id = '0x' + 'a'.repeat(64), owner = '0x' + 'b'.repeat(64);
  const activity = { managerId: id, lastActivity: '', activity: '', checkpoint: null };
  const obj = (pool: string) => ({ objectId: id, type: '0x1::margin_manager::MarginManager<A,B>', json: { owner, deepbook_pool: pool } });
  assert.equal(parseManagerObject(obj(mainnetPools.WAL_USDC.address), activity)?.pool, 'WAL_USDC');
  assert.equal(parseManagerObject(obj('0x' + 'c'.repeat(64)), activity), null);
});
