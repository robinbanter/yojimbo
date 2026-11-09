import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liquidationCushion } from '../src/policy.js';

// Balances and Pyth prices of mainnet MarginManager 0x7426…4593 read on Nov 9 2026 (chain risk ratio 1.122147172).
const long = { baseAsset: 26.191381, quoteAsset: 0.028037, baseDebt: 0, quoteDebt: 18.951507, price: 0.81068712, quotePrice: 0.9997492, riskRatio: 1.122147172 };

test('long SUI position: liquidation price puts the ratio exactly on the line', () => {
  const c = liquidationCushion(long, 1.1)!;
  const ratioAt = (long.baseAsset * c.price + long.quoteAsset * long.quotePrice) / (long.quoteDebt * long.quotePrice);
  assert.ok(Math.abs(ratioAt - 1.1) < 1e-9);
  assert.ok(c.move < 0 && c.move > -0.03, `expected a fall under 3%, got ${c.move}`);
  // The formula reproduces the chain's own ratio at today's price.
  const ratioNow = (long.baseAsset * long.price + long.quoteAsset * long.quotePrice) / (long.quoteDebt * long.quotePrice);
  assert.ok(Math.abs(ratioNow - long.riskRatio) < 1e-6);
});

test('short SUI position liquidates on a rise', () => {
  const short = { baseAsset: 0, quoteAsset: 30, baseDebt: 20, quoteDebt: 0, price: 1, quotePrice: 1, riskRatio: 1.5 };
  const c = liquidationCushion(short, 1.1)!;
  assert.ok(c.move > 0);
  assert.ok(Math.abs(30 / (20 * c.price) - 1.1) < 1e-9);
});

test('no debt or already under the line', () => {
  assert.equal(liquidationCushion({ ...long, quoteDebt: 0, riskRatio: Infinity }, 1.1), null);
  assert.deepEqual(liquidationCushion({ ...long, riskRatio: 1.05 }, 1.1), { price: long.price, move: 0, atOrBelow: true });
});
