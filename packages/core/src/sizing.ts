/** Pure order-size and liquidation math for long and short margin positions. No chain calls. */

/** Floor an order quantity (in base units) to the pool's lot size; DeepBook aborts (EOrderInvalidLotSize) otherwise. */
export function toLots(quantity:number,lotSize:number,minSize:number){
  if(!(lotSize>0))throw new Error('Invalid pool lot size');
  const lots=Math.floor(quantity/lotSize+1e-9);
  const rounded=Number((lots*lotSize).toFixed(9));
  if(!(rounded>=minSize))throw new Error(`Order of ${quantity} base units is below the pool minimum of ${minSize}`);
  return rounded;
}

/**
 * Short sizing: borrow `borrow` base units and market-sell them. Without DEEP the taker fee is taken from the base
 * being sold, so only 99% is sold (floored to whole lots). `borrowBase` wins over `borrowUsdc` (converted at `price`).
 */
export function shortSellQuantity(o:{borrowBase?:number;borrowUsdc?:number;price:number;lotSize:number;minSize:number}){
  const raw=o.borrowBase!=null&&o.borrowBase>0?o.borrowBase:o.borrowUsdc!=null&&o.borrowUsdc>0&&o.price>0?o.borrowUsdc/o.price:NaN;
  if(!Number.isFinite(raw)||raw<=0)throw new Error('A short needs borrowBase or borrowUsdc above zero');
  const borrow=Number(raw.toFixed(9));
  return {borrow,sell:toLots(borrow*0.99,o.lotSize,o.minSize),notionalUsdc:borrow*o.price};
}

/**
 * Closing a short: base to market-buy so the manager can repay all base debt plus `buffer` (interest accrues between
 * the read and the transaction, and the taker fee may come out of the base bought). Rounded UP to whole lots and at
 * least the pool minimum. 0 when the manager already holds enough base.
 */
export function coverQuantity(baseDebt:number,baseAsset:number,lotSize:number,minSize:number,buffer=0.02){
  if(!(lotSize>0))throw new Error('Invalid pool lot size');
  const need=baseDebt*(1+buffer)-baseAsset;
  if(!(need>0))return 0;
  const q=Number((Math.ceil(need/lotSize-1e-9)*lotSize).toFixed(9));
  return Math.max(q,minSize);
}

/**
 * Base price (in quote units) at which the risk ratio (base*p + quote) / (baseDebt*p + quoteDebt) equals L.
 * Long (quote debt): liquidated as the price FALLS to p = (L*quoteDebt - quote) / (base - L*baseDebt).
 * Short (base debt): liquidated as the price RISES to the same p (the denominator is negative).
 * Returns null when no price move alone reaches L (for example no debt, or the position can never fall to L).
 */
export function liquidationPrice(s:{baseAsset:number;quoteAsset:number;baseDebt:number;quoteDebt:number},L:number):{price:number;direction:'below'|'above'}|null{
  const v=[s.baseAsset,s.quoteAsset,s.baseDebt,s.quoteDebt,L];
  if(!v.every(Number.isFinite)||L<=0)return null;
  if(s.baseDebt<=0&&s.quoteDebt<=0)return null;
  const denom=s.baseAsset-L*s.baseDebt;
  if(denom===0)return null;
  const price=(L*s.quoteDebt-s.quoteAsset)/denom;
  if(!(price>0))return null;
  return {price,direction:denom>0?'below':'above'};
}

/** Risk ratio at a given base price, as DeepBook Margin defines it. Infinity with no debt. */
export function riskRatioAt(s:{baseAsset:number;quoteAsset:number;baseDebt:number;quoteDebt:number},price:number){
  const debt=s.baseDebt*price+s.quoteDebt;
  return debt>0?(s.baseAsset*price+s.quoteAsset)/debt:Infinity;
}
