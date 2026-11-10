import { mainnetPools, mainnetMarginPools, mainnetCoins } from '@mysten/deepbook-v3';
import { chain } from './chain.js';

export type Direction = { supported: boolean; reason?: string; lendingPoolAllows?: boolean };

/** Pool directions opened, defended and unwound end to end on a LOCAL FORK of Sui mainnet (checkpoint 343712658). */
export const FORK_VERIFIED = new Set(['SUI_USDC:long', 'SUI_USDC:short']);
const stale = (feed: string) => `Borrowing aborts in pyth::check_price_is_fresh: the ${feed} Pyth price object was stale on a mainnet fork (checkpoint 343712658), and Yojimbo does not yet add a Pyth price update to the transaction`;
const bounds = 'On a mainnet fork (checkpoint 343712658) the margin market order aborted in margin_registry::get_price_bounds (code 17); not offered until a Pyth price update in the same transaction is built and tested';
/** What the fork run found for directions the registry allows but Yojimbo could not open. */
export const FORK_BLOCKERS: Record<string, string> = {
  'DEEP_USDC:long': bounds, 'DEEP_USDC:short': bounds, 'WAL_USDC:long': bounds, 'WAL_USDC:short': bounds,
  'XBTC_USDC:long': stale('XBTC/USD'), 'XBTC_USDC:short': stale('XBTC/USD'),
  'SUIUSDE_USDC:long': stale('SUIUSDE/USD'), 'SUIUSDE_USDC:short': stale('SUIUSDE/USD'),
};
/**
 * A direction the live registry allows is offered only if it was verified on the fork; otherwise it is reported
 * unsupported with the fork finding, keeping lendingPoolAllows:true so the reason is not mistaken for a registry block.
 */
export function gateByForkFindings(pool: string, side: 'long' | 'short', d: Direction): Direction {
  if (!d.supported) return d;
  const key = `${pool}:${side}`;
  if (FORK_VERIFIED.has(key)) return d;
  return { supported: false, lendingPoolAllows: true, reason: FORK_BLOCKERS[key] ?? 'The registry allows it, but it has not been opened and unwound end to end on a mainnet fork yet' };
}
export type Market = {
  pool: string; base: string; quote: string; enabled: boolean;
  liquidation: number | null; minBorrow: number | null; midPrice: number | null; lotSize: number | null; minSize: number | null;
  baseMarginPool: string | null; quoteMarginPool: string | null;
  long: Direction; short: Direction;
};
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
const cache = new Map<string, { at: number; value: { markets: Market[]; notMarginEnabled: string[]; source: string; checkedAt: string } }>();
const short = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 160);
const transient = (e: unknown) => /429|Timeout|timed out|ECONNRESET|fetch failed|UNAVAILABLE/i.test(String(e));
/** Tatum rate-limits bursts (HTTP 429): retry a read up to 4 times (0.8, 1.6, 3.2, 6.4 s) before reporting it. */
async function calm<T>(run: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await run(); } catch (e) { if (i >= 4 || !transient(e)) throw e; await new Promise((r) => setTimeout(r, 800 * 2 ** i)); }
  }
}

/**
 * Every DeepBook pool the SDK knows, checked live against the mainnet MarginRegistry (read-only simulations):
 * whether it is margin-enabled, its liquidation and min-borrow risk ratios, and for each direction whether the
 * asset that must be borrowed has a margin pool that allows this DeepBook pool (long borrows USDC, short borrows
 * the base). Only USDC-quoted pools are traded, since collateral and defences are USDC. Calls run one at a time
 * (Tatum rate-limits bursts) and the result is kept for ten minutes.
 */
export async function markets(env = process.env) {
  const c = chain(ZERO, undefined, env);
  const key = String(c.source);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  const db = c.client.deepbook;
  const out: Market[] = [];
  const notMarginEnabled: string[] = [];
  let flaky = false;
  for (const [pool, info] of Object.entries(mainnetPools) as [string, { address: string; baseCoin: string; quoteCoin: string }][]) {
    let enabled = false;
    try { enabled = await calm(() => db.isPoolEnabledForMargin(pool)); } catch (e) { if (transient(e)) flaky = true; enabled = false; }
    if (!enabled) { notMarginEnabled.push(pool); continue; }
    const m: Market = { pool, base: info.baseCoin, quote: info.quoteCoin, enabled, liquidation: null, minBorrow: null, midPrice: null, lotSize: null, minSize: null, baseMarginPool: null, quoteMarginPool: null, long: { supported: false }, short: { supported: false } };
    try {
      m.liquidation = Number(await calm(() => db.getLiquidationRiskRatio(pool)));
      m.minBorrow = Number(await calm(() => db.getMinBorrowRiskRatio(pool)));
      m.baseMarginPool = String(await calm(() => db.getBaseMarginPoolId(pool))).replace(/^0x0x/, '0x');
      m.quoteMarginPool = String(await calm(() => db.getQuoteMarginPoolId(pool))).replace(/^0x0x/, '0x');
      const book = await calm(() => db.poolBookParams(pool));
      m.lotSize = book.lotSize; m.minSize = book.minSize;
      try { m.midPrice = await calm(() => db.midPrice(pool)); } catch (e) { if (transient(e)) flaky = true; m.midPrice = null; }
    } catch (e) {
      if (transient(e)) flaky = true;
      const reason = `Could not read this pool's margin settings: ${short(e)}`;
      m.long = { supported: false, reason }; m.short = { supported: false, reason }; out.push(m); continue;
    }
    if (info.quoteCoin !== 'USDC') {
      const reason = `Quoted in ${info.quoteCoin}, not USDC: Yojimbo's collateral and defences are USDC`;
      m.long = { supported: false, reason }; m.short = { supported: false, reason }; out.push(m); continue;
    }
    m.long = await direction(db, 'USDC', info.address, m.quoteMarginPool, 'USDC', 'long');
    m.short = await direction(db, info.baseCoin, info.address, m.baseMarginPool, info.baseCoin, 'short');
    m.long = gateByForkFindings(pool, 'long', m.long);
    m.short = gateByForkFindings(pool, 'short', m.short);
    if (m.midPrice == null) {
      const reason = flaky ? 'Could not read the order book price just now (rate-limited); try again in a minute' : 'The order book has no mid price right now (empty side), so a market order cannot be sized';
      if (m.long.supported) m.long = { supported: false, reason };
      if (m.short.supported) m.short = { supported: false, reason };
    }
    out.push(m);
  }
  const value = { markets: out, notMarginEnabled, source: String(c.source), checkedAt: new Date().toISOString() };
  // A scan that hit rate limits is kept for one minute only, so the next request reads the pools again.
  cache.set(key, { at: flaky ? Date.now() - 540_000 : Date.now(), value });
  return value;
}

async function direction(db: any, coin: string, poolAddress: string, registered: string | null, label: string, side: 'long' | 'short'): Promise<Direction> {
  const known = (mainnetMarginPools as Record<string, { address: string }>)[coin];
  if (!known) return { supported: false, reason: `A ${side} borrows ${label}, and there is no ${label} margin lending pool on mainnet` };
  if (!registered || /^0x0+$/.test(registered)) return { supported: false, reason: `The MarginRegistry has no ${label} lending pool registered for this pool, so ${label} cannot be borrowed` };
  if (registered.toLowerCase() !== known.address.toLowerCase()) return { supported: false, reason: `The registry's ${label} lending pool ${registered} differs from the SDK's ${known.address}` };
  try {
    const allowed = await calm(() => db.isDeepbookPoolAllowed(coin, poolAddress));
    if (!allowed) return { supported: false, reason: `The ${label} margin pool does not allow borrowing for this DeepBook pool` };
  } catch (e) { return { supported: false, reason: `Could not check the ${label} margin pool: ${short(e)}` }; }
  if (!(mainnetCoins as Record<string, { priceInfoObjectId?: string }>)[coin]?.priceInfoObjectId) return { supported: false, reason: `No Pyth price object for ${coin} in the SDK, so the oracle-checked borrow cannot be built` };
  return { supported: true };
}
