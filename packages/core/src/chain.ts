import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import type { RpcInterceptor } from '@protobuf-ts/runtime-rpc';
import { rateLimit } from './throttle.js';
// One limiter for the whole process: every Tatum client shares Tatum's 3 requests/second budget.
const tatumLimit = rateLimit(400);
// Tatum credits can run out (HTTP 402 "You have used all your credits"). SUI_RPC_FALLBACK=public, or the first 402 a
// Tatum call returns, sends every later read to the public Sui fullnode, labelled so /status never claims Tatum.
export const PUBLIC_FALLBACK_LABEL = 'public Sui node (Tatum credits exhausted)' as const;
const PUBLIC_FULLNODE = 'https://fullnode.mainnet.sui.io:443';
let tatumExhausted = false;
const usePublicFallback = (env = process.env) => env.SUI_RPC_FALLBACK === 'public' || tatumExhausted;
const tatumWatch: RpcInterceptor = {
  interceptUnary(next, method, input, options) {
    const call = next(method, input, options);
    call.response.catch((e: unknown) => { if (/HTTP status code 402/.test(String(e))) tatumExhausted = true; });
    return call;
  },
};
import { ChannelCredentials } from '@grpc/grpc-js';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { deepbook, mainnetPackageIds, mainnetCoins, mainnetPools } from '@mysten/deepbook-v3';
import { shortSellQuantity, coverQuantity, toLots } from './sizing.js';
export { toLots } from './sizing.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { FORK_SOURCE, FORK_WRITE_GATE, executeOnFork, forkClient, forkUrl } from './fork.js';
export const POOL = 'SUI_USDC';
export const USDC = mainnetCoins.USDC.type;
export const MARGIN_REGISTRY = mainnetPackageIds.MARGIN_REGISTRY_ID;
export const SUI_USDC_POOL = mainnetPools.SUI_USDC.address;
const addressPattern = /^0x[0-9a-fA-F]{64}$/;
export type RecentManager = {managerId:string;owner:string;pool:string;lastActivity:string;activity:string;checkpoint:string|null};
type EventData = {eventType:string;json:Record<string,unknown>|null;checkpoint:string|null};
export function parseManagerEvent(event:EventData): {managerId:string;lastActivity:string;activity:string;checkpoint:string|null}|null {
  const activity=event.eventType.split('::').at(-1) ?? '';
  if(!['MarginManagerCreatedEvent','LoanBorrowedEvent','DepositCollateralEvent','LiquidationEvent'].includes(activity))return null;
  const id=event.json?.margin_manager_id, timestamp=Number(event.json?.timestamp);
  if(typeof id!=='string'||!addressPattern.test(id)||!Number.isFinite(timestamp)||timestamp<=0)return null;
  return {managerId:id.toLowerCase(),lastActivity:new Date(timestamp).toISOString(),activity,checkpoint:event.checkpoint};
}
export function parseManagerObject(object:{objectId:string;type?:string;json?:unknown},activity:{managerId:string;lastActivity:string;activity:string;checkpoint:string|null}):RecentManager|null {
  const fields=object.json as Record<string,unknown>|undefined;
  const owner=fields?.owner,pool=fields?.deepbook_pool;
  if(object.objectId.toLowerCase()!==activity.managerId||!object.type?.includes('::margin_manager::MarginManager<')||typeof owner!=='string'||typeof pool!=='string'||!addressPattern.test(owner)||!addressPattern.test(pool))return null;
  const poolKey=poolKeyForAddress(pool);
  if(!poolKey)return null;
  return {...activity,owner:owner.toLowerCase(),pool:poolKey};
}
/** The DeepBook pool key (e.g. SUI_USDC) for an on-chain pool address, or null if the SDK does not know it. */
export function poolKeyForAddress(address:string):string|null{
  const a=address.toLowerCase();
  for(const [key,pool] of Object.entries(mainnetPools))if((pool as {address:string}).address.toLowerCase()===a)return key;
  return null;
}
export function assertPoolKey(poolKey:string){if(!Object.hasOwn(mainnetPools,poolKey))throw new Error(`Unknown DeepBook pool ${poolKey}`);return poolKey;}
export function parseManagerState<T extends {riskRatio:number;basePythPrice:string;basePythDecimals:number;quotePythPrice:string;quotePythDecimals:number;currentPrice:bigint|string;lowestTriggerAbovePrice:bigint|string;highestTriggerBelowPrice:bigint|string}>(state:T){
  const price=Number(state.basePythPrice)/10**state.basePythDecimals;
  const quotePrice=Number(state.quotePythPrice)/10**state.quotePythDecimals;
  if(!Number.isFinite(state.riskRatio)||!Number.isFinite(price)||price<=0||!Number.isFinite(quotePrice)||quotePrice<=0)throw new Error('Invalid live MarginManager state');
  return {state:{...state,currentPrice:state.currentPrice.toString(),lowestTriggerAbovePrice:state.lowestTriggerAbovePrice.toString(),highestTriggerBelowPrice:state.highestTriggerBelowPrice.toString()},price,quotePrice};
}
export function botKey(env = process.env) { if (!env.YOJIMBO_BOT_KEY) throw new Error('Setup required: YOJIMBO_BOT_KEY'); return Ed25519Keypair.fromSecretKey(env.YOJIMBO_BOT_KEY); }
export function rpc(env = process.env) {
  const fork = forkUrl(env);
  if (fork) return {client:forkClient(fork), source:FORK_SOURCE, url:fork};
  const dev = Boolean(env.YOJIMBO_DEV_SUI_RPC);
  if (!dev && !env.TATUM_API_KEY) throw new Error('Setup required: TATUM_API_KEY');
  if (dev) { const url=env.YOJIMBO_DEV_SUI_RPC!; return {client:new SuiGrpcClient({network:'mainnet',baseUrl:url}), source:'dev RPC (not Tatum)' as const, url}; }
  if (usePublicFallback(env)) return {client:new SuiGrpcClient({network:'mainnet',baseUrl:PUBLIC_FULLNODE}), source:PUBLIC_FALLBACK_LABEL, url:PUBLIC_FULLNODE};
  // Tatum's Sui JSON-RPC gateway returns 404; it serves native gRPC (not gRPC-web) with the key in metadata.
  const host = 'sui-mainnet-grpc.gateway.tatum.io:443';
  const transport = new GrpcTransport({host,channelCredentials:ChannelCredentials.createSsl(),meta:{'x-api-key':env.TATUM_API_KEY!},interceptors:[tatumLimit,tatumWatch]});
  return {client:new SuiGrpcClient({network:'mainnet',transport}), source:'Tatum' as const, url:`grpc://${host}`};
}
/**
 * Event listing. Tatum's gRPC gateway refuses sui.rpc.v2.LedgerService/ListEvents ("gRPC method not allowed"), so with
 * Tatum the event scan goes to the public Sui fullnode over gRPC (YOJIMBO_EVENTS_RPC overrides it); every other read and
 * every transaction still goes through Tatum. The source label says which one answered.
 */
export function eventsRpc(env = process.env) {
  const r = rpc(env);
  if (r.source !== 'Tatum') return r;
  const url = env.YOJIMBO_EVENTS_RPC ?? 'https://fullnode.mainnet.sui.io:443';
  return { client: new SuiGrpcClient({ network: 'mainnet', baseUrl: url }), source: 'public fullnode (events; Tatum blocks ListEvents)' as const, url };
}
export function chain(owner: string, managerId?: string, env = process.env, poolKey: string = POOL) {
  assertPoolKey(poolKey);
  const r = rpc(env);
  const options = {address:owner,marginManagers:managerId ? {BOT:{address:managerId,poolKey}} : undefined};
  return {...r,client:r.client.$extend(deepbook(options))};
}
// Pool thresholds change only by governance: read them one call at a time (Tatum rate-limits bursts of parallel
// calls with HTTP 429) and keep them for five minutes per transport.
const registryCache = new Map<string, { at: number; value: unknown[] }>();
export async function registry(owner: string, env = process.env, poolKey: string = POOL) {
  const c=chain(owner,undefined,env,poolKey);
  const cacheKey=`${c.source}:${poolKey}`;
  const hit = registryCache.get(cacheKey);
  let values = hit && Date.now() - hit.at < 300_000 ? hit.value : null;
  if (!values) {
    values = [];
    values.push(await c.client.deepbook.isPoolEnabledForMargin(poolKey));
    values.push(await c.client.deepbook.getLiquidationRiskRatio(poolKey));
    values.push(await c.client.deepbook.getMinBorrowRiskRatio(poolKey));
    values.push(await c.client.deepbook.getMinWithdrawRiskRatio(poolKey));
    values.push(await c.client.deepbook.getBaseMarginPoolId(poolKey));
    values.push(await c.client.deepbook.getQuoteMarginPoolId(poolKey));
    registryCache.set(cacheKey, { at: Date.now(), value: values });
  }
  const [enabled, liquidation, minBorrow, minWithdraw, basePool, quotePool] = values as any[];
  return {pool:poolKey,enabled,liquidation,minBorrow,minWithdraw,basePool:basePool.replace(/^0x0x/,'0x'),quotePool:quotePool.replace(/^0x0x/,'0x'),packageId:mainnetPackageIds.MARGIN_PACKAGE_ID,registryId:MARGIN_REGISTRY,source:c.source};
}
export async function position(owner: string, env = process.env) {
  const base = chain(owner,undefined,env);
  const ids = env.YOJIMBO_MARGIN_MANAGER_ID ? [] : await base.client.deepbook.getMarginManagerIdsForOwner(owner);
  const managerId = env.YOJIMBO_MARGIN_MANAGER_ID || ids[0];
  if (!managerId) return {owner,managerId:null,state:null,price:null,source:base.source};
  const pool=await managerPool(managerId,env);
  const c=chain(owner,managerId,env,pool);
  const state = await c.client.deepbook.getMarginManagerState('BOT');
  const parsed=parseManagerState(state);
  return {owner,managerId,pool,state:parsed.state,price:parsed.price,source:c.source};
}
/** sui-fork's gRPC serves object BCS but no JSON; MarginManager starts with id, owner and deepbook_pool. */
const ManagerPrefix=bcs.struct('MarginManagerPrefix',{id:bcs.Address,owner:bcs.Address,deepbook_pool:bcs.Address});
function managerPrefix(content?:Uint8Array|null){if(!content||content.length<96)return undefined;try{return ManagerPrefix.parse(content.slice(0,96));}catch{return undefined;}}
async function managerObject(managerId:string,env=process.env){
  if(!addressPattern.test(managerId))throw new Error('Invalid MarginManager ID');
  const base=rpc(env);
  const result=await base.client.core.getObject({objectId:managerId,include:{json:true,content:true}});
  const object=result.object&&{...result.object,json:result.object.json??managerPrefix(result.object.content)};
  const candidate=object&&parseManagerObject(object,{managerId:managerId.toLowerCase(),lastActivity:'',activity:'',checkpoint:null});
  if(!candidate)throw new Error('MarginManager not found on a known DeepBook pool');
  return candidate;
}
/** The pool key a MarginManager is bound to, read from its deepbook_pool field. */
export async function managerPool(managerId:string,env=process.env){return (await managerObject(managerId,env)).pool;}
/** 'long' when the manager owes quote (USDC), 'short' when it owes base, else 'none'. */
export function sideOf(state:{baseDebt:string|number;quoteDebt:string|number}):'long'|'short'|'none'{
  if(Number(state.quoteDebt)>0)return 'long';
  if(Number(state.baseDebt)>0)return 'short';
  return 'none';
}
export async function managerState(managerId:string,env=process.env,poolKey?:string){
  const candidate=await managerObject(managerId,env);
  if(poolKey&&poolKey!==candidate.pool)throw new Error(`MarginManager is on ${candidate.pool}, not ${poolKey}`);
  const c=chain(candidate.owner,managerId,env,candidate.pool);
  const state=await c.client.deepbook.getMarginManagerState('BOT');
  const parsed=parseManagerState(state);
  return {owner:candidate.owner,managerId,pool:candidate.pool,side:sideOf(parsed.state),state:parsed.state,price:parsed.price,quotePrice:parsed.quotePrice,source:c.source};
}
/** Every MarginManager the owner has, each read on its own pool. */
export async function positions(owner:string,env=process.env){
  const base=chain(owner,undefined,env);
  const ids=await base.client.deepbook.getMarginManagerIdsForOwner(owner);
  const out=[];
  for(const id of ids)out.push(await managerState(id,env));
  return {owner,positions:out,source:base.source};
}
export async function watchPosition(managerId:string,env=process.env){
  const p=await managerState(managerId,env);
  const thresholds=await registry('0x1',env,p.pool);
  return {...p,thresholds};
}
export async function discoverRecentManagers(limit=8,env=process.env):Promise<RecentManager[]>{
  const c=rpc(env).client;
  const ev=eventsRpc(env).client;
  const registryObject=await c.core.getObject({objectId:MARGIN_REGISTRY});
  const originalPackage=registryObject.object?.type?.split('::')[0];
  if(!originalPackage||!addressPattern.test(originalPackage))throw new Error('Margin registry type unavailable');
  const seen=new Map<string,RecentManager>();
  let before:string|null|undefined;
  for(let page=0;page<10&&seen.size<limit;page++){
    const response=await ev.core.listEvents({filter:{eventType:`${originalPackage}::margin_manager`},order:'descending',limit:50,...(before?{before}:{})});
    const activities=new Map<string,NonNullable<ReturnType<typeof parseManagerEvent>>>();
    for(const event of response.events){const item=parseManagerEvent(event);if(item&&!seen.has(item.managerId)&&!activities.has(item.managerId))activities.set(item.managerId,item);}
    const candidates=await Promise.all([...activities.values()].map(async activity=>{
      try{const result=await c.core.getObject({objectId:activity.managerId,include:{json:true}});return result.object?parseManagerObject(result.object,activity):null;}catch{return null;}
    }));
    for(const candidate of candidates)if(candidate)seen.set(candidate.managerId,candidate);
    if(!response.hasNextPage||!response.endCursor||response.endCursor===before)break;
    before=response.endCursor;
  }
  return [...seen.values()].sort((a,b)=>b.lastActivity.localeCompare(a.lastActivity)).slice(0,limit);
}
/** Mainnet path: simulate, then send only through Tatum with YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS. The dev RPC never sends. */
async function mainnetWrite(owner:string,tx:Transaction,client:SuiGrpcClient,env=process.env){
  const simulated=await client.core.simulateTransaction({transaction:tx,include:{effects:true}});
  const status=simulated.FailedTransaction ? {status:'failure',error:simulated.FailedTransaction.status.error?.message ?? 'simulation failed'} : {status:'success'};
  if (env.YOJIMBO_DEV_SUI_RPC) {
    if (env.YOJIMBO_ALLOW_MAINNET === 'I_ACKNOWLEDGE_REAL_FUNDS') throw new Error('Remove YOJIMBO_DEV_SUI_RPC before mainnet writes');
    return {mode:'dry-run' as const,status,txDigest:null};
  }
  if (status.status !== 'success' || env.YOJIMBO_ALLOW_MAINNET !== 'I_ACKNOWLEDGE_REAL_FUNDS') return {mode:'dry-run' as const,status,txDigest:null};
  if (owner !== botKey(env).toSuiAddress()) throw new Error('Bot wallet does not own this manager');
  const result=await client.core.signAndExecuteTransaction({signer:botKey(env),transaction:tx,include:{effects:true}});
  const executed=result.$kind==='Transaction'?result.Transaction:result.FailedTransaction;
  return {mode:'mainnet' as const,status:executed.effects.status.success?{status:'success'}:{status:'failure',error:executed.effects.status.error?.message ?? 'execution failed'},txDigest:executed.digest};
}
/** Local fork writes: simulate first, then send only with YOJIMBO_ALLOW_FORK_WRITES=LOCAL_FORK_ONLY. Never reaches mainnet. */
async function forkWrite(owner:string,tx:Transaction,client:SuiGrpcClient,env=process.env){
  let status:{status:string;error?:string};
  try{const simulated=await client.core.simulateTransaction({transaction:tx,include:{effects:true}});status=simulated.FailedTransaction?{status:'failure',error:simulated.FailedTransaction.status.error?.message??'simulation failed'}:{status:'success'};}
  catch(e){status={status:'failure',error:`fork simulation unavailable: ${String(e).slice(0,200)}`};}
  if(env.YOJIMBO_ALLOW_FORK_WRITES!==FORK_WRITE_GATE)return {mode:'dry-run' as const,status,txDigest:null};
  if(owner!==botKey(env).toSuiAddress())throw new Error('Bot wallet does not own this manager');
  return executeOnFork(client,tx,{signer:botKey(env)});
}
export type DefenceAction = 'deposit'|'reduce'|'repay';
type DefenceState={baseAsset:string;baseDebt:string;quoteAsset:string;quoteDebt:string;price:number;pool?:string};
/**
 * One defence transaction on the manager's own pool. deposit adds USDC collateral (works for longs and shorts);
 * reduce buys back base for a short (base debt) or sells base for a long, and repays; repay pays quote debt for a
 * long, or base debt from base already in the manager for a short.
 */
export async function buildDefence(owner:string,managerId:string,action:DefenceAction,amountUsdc:number,state:DefenceState,env=process.env) {
  const pool=state.pool??await managerPool(managerId,env);
  const c=chain(owner,managerId,env,pool);
  const short=Number(state.baseDebt)>0;
  const tx = new Transaction(); tx.setSender(owner);
  if (action === 'deposit') tx.add(c.client.deepbook.marginManager.depositQuote({managerKey:'BOT',amount:amountUsdc}));
  if (action === 'repay') {
    if (short) tx.add(c.client.deepbook.marginManager.repayBase('BOT',Math.min(amountUsdc/state.price,Number(state.baseAsset),Number(state.baseDebt))));
    else tx.add(c.client.deepbook.marginManager.repayQuote('BOT',Math.min(amountUsdc,Number(state.quoteAsset),Number(state.quoteDebt))));
  }
  if (action === 'reduce') {
    const isBid=short;
    const raw=Math.min((isBid?Number(state.baseDebt):Number(state.baseAsset))/2,amountUsdc/state.price);
    if (!(raw > 0)) throw new Error(`No ${pool} position available to reduce`);
    const book=await c.client.deepbook.poolBookParams(pool);
    const quantity=toLots(raw,book.lotSize,book.minSize);
    tx.add(c.client.deepbook.poolProxy.placeReduceOnlyMarketOrderAndRepayLoan({poolKey:pool,marginManagerKey:'BOT',clientOrderId:String(Date.now()),quantity,isBid,payWithDeep:false}));
  }
  return {tx,client:c.client};
}
export async function executeDefence(owner:string,managerId:string,action:DefenceAction,amountUsdc:number,state:DefenceState,spentToday:number,env=process.env) {
  const cap=Number(env.YOJIMBO_MAX_DEFENCE_USDC ?? 10), daily=Number(env.YOJIMBO_DAILY_USDC ?? 30);
  if (![cap,daily,amountUsdc,spentToday].every(v=>Number.isFinite(v)&&v>=0) || cap<=0 || daily<=0 || amountUsdc<=0 || amountUsdc>cap || spentToday+amountUsdc>daily) throw new Error('Defence exceeds per-action or daily USDC cap');
  const short=Number(state.baseDebt)>0;
  if (action==='repay' && !short && Math.min(Number(state.quoteAsset),Number(state.quoteDebt)) <= 0) throw new Error('No quote balance and debt to repay');
  if (action==='repay' && short && Math.min(Number(state.baseAsset),Number(state.baseDebt)) <= 0) throw new Error('No base balance in the manager to repay the base loan');
  const {tx,client}=await buildDefence(owner,managerId,action,amountUsdc,state,env);
  if (forkUrl(env)) return forkWrite(owner,tx,client,env);
  return mainnetWrite(owner,tx,client,env);
}
export async function setupTransaction(owner:string,tx:Transaction,env=process.env){
  const c=chain(owner,undefined,env);
  if(forkUrl(env))return forkWrite(owner,tx,c.client,env);
  return mainnetWrite(owner,tx,c.client,env);
}
export async function createMarginManager(owner:string,env=process.env,poolKey:string=POOL){
  const c=chain(owner,undefined,env,poolKey);const tx=new Transaction();tx.setSender(owner);tx.add(c.client.deepbook.marginManager.newMarginManager(poolKey));
  return setupTransaction(owner,tx,env);
}
function perActionCap(env:NodeJS.ProcessEnv){const cap=Number(env.YOJIMBO_MAX_DEFENCE_USDC??10);if(!Number.isFinite(cap)||cap<=0)throw new Error('Invalid YOJIMBO_MAX_DEFENCE_USDC');return cap;}
/** Long: deposit USDC, borrow USDC, market-buy base with 90% of both (floored to lots). */
export async function openLong(owner:string,managerId:string,depositUsdc:number,borrowUsdc:number,price:number,env=process.env,poolKey:string=POOL){
  const cap=perActionCap(env);
  if(![depositUsdc,borrowUsdc,price].every(v=>Number.isFinite(v)&&v>0)||depositUsdc>cap||borrowUsdc>cap)throw new Error('Invalid amount or exceeds per-action USDC cap');
  const c=chain(owner,managerId,env,poolKey);const tx=new Transaction();tx.setSender(owner);
  const book=await c.client.deepbook.poolBookParams(poolKey);
  const quantity=toLots((depositUsdc+borrowUsdc)*0.9/price,book.lotSize,book.minSize);
  tx.add(c.client.deepbook.marginManager.depositQuote({managerKey:'BOT',amount:depositUsdc}));
  tx.add(c.client.deepbook.marginManager.borrowQuote('BOT',borrowUsdc));
  tx.add(c.client.deepbook.poolProxy.placeMarketOrder({poolKey,marginManagerKey:'BOT',clientOrderId:String(Date.now()),quantity,isBid:true,payWithDeep:false}));
  return setupTransaction(owner,tx,env);
}
/**
 * Short: deposit USDC collateral, borrow base from that base's margin pool, market-sell the borrowed base (99%,
 * floored to lots; the taker fee comes out of the base). The borrowed notional is capped like a long's borrow.
 */
export async function openShort(owner:string,managerId:string,depositUsdc:number,borrowBase:number,price:number,env=process.env,poolKey:string=POOL){
  const cap=perActionCap(env);
  if(![depositUsdc,borrowBase,price].every(v=>Number.isFinite(v)&&v>0)||depositUsdc>cap)throw new Error('Invalid amount or deposit exceeds per-action USDC cap');
  const c=chain(owner,managerId,env,poolKey);
  const book=await c.client.deepbook.poolBookParams(poolKey);
  const size=shortSellQuantity({borrowBase,price,lotSize:book.lotSize,minSize:book.minSize});
  if(size.notionalUsdc>cap)throw new Error(`Borrowing ${size.borrow} base (~${size.notionalUsdc.toFixed(2)} USDC) exceeds the per-action cap of ${cap} USDC`);
  const tx=new Transaction();tx.setSender(owner);
  tx.add(c.client.deepbook.marginManager.depositQuote({managerKey:'BOT',amount:depositUsdc}));
  tx.add(c.client.deepbook.marginManager.borrowBase('BOT',size.borrow));
  tx.add(c.client.deepbook.poolProxy.placeMarketOrder({poolKey,marginManagerKey:'BOT',clientOrderId:String(Date.now()),quantity:size.sell,isBid:false,payWithDeep:false}));
  return setupTransaction(owner,tx,env);
}
/**
 * Close the bot's position and return its funds, in three gated transactions (fork: LOCAL_FORK_ONLY gate;
 * mainnet: YOJIMBO_ALLOW_MAINNET). Long: 1. sell all whole base lots at market and repay the whole USDC loan.
 * Short: 1. market-buy enough base (whole lots, 2% buffer) and repay the whole base loan. Then 2. withdraw
 * everything left in the manager to the bot wallet; 3. send all of the bot's USDC and its remaining SUI (the gas
 * coin, minus this transaction's gas) to `returnTo`. Each step re-reads chain state first.
 */
export async function unwindPosition(owner:string,managerId:string,returnTo:string,env=process.env){
  if(!addressPattern.test(returnTo))throw new Error('Return address must be a 0x Sui address');
  const pool=await managerPool(managerId,env);
  const base=pool.split('_')[0];
  const steps:{step:string;result:unknown;state?:unknown}[]=[];
  const read=async()=>{const s=(await managerState(managerId,env)).state;return {riskRatio:s.riskRatio,baseAsset:Number(s.baseAsset),quoteAsset:Number(s.quoteAsset),baseDebt:Number(s.baseDebt),quoteDebt:Number(s.quoteDebt)};};
  const ok=(r:{status:{status:string}|null;txDigest:string|null})=>r.status?.status==='success'&&r.txDigest!=null;
  let s=await read();
  if(s.baseDebt>0&&s.quoteDebt>0)throw new Error('The manager owes both base and quote; unwind it by hand');
  const c=chain(owner,managerId,env,pool);
  const book=await c.client.deepbook.poolBookParams(pool);
  if(s.baseDebt>0){
    const buy=coverQuantity(s.baseDebt,s.baseAsset,book.lotSize,book.minSize);
    const tx=new Transaction();tx.setSender(owner);
    if(buy>0)tx.add(c.client.deepbook.poolProxy.placeMarketOrder({poolKey:pool,marginManagerKey:'BOT',clientOrderId:String(Date.now()),quantity:buy,isBid:true,payWithDeep:false}));
    tx.add(c.client.deepbook.marginManager.repayBase('BOT'));
    const r=await setupTransaction(owner,tx,env);s=await read();steps.push({step:`buy ${buy} ${base} and repay the ${base} loan`,result:r,state:s});
    if(!ok(r))return {done:false,steps};
    if(s.baseDebt>0)throw new Error(`${base} debt ${s.baseDebt} remains after the buy`);
  }else{
    // Without DEEP the taker fee is paid in base from the manager, so sell 99% of it (floored to lots); step 2 withdraws the rest.
    const sellable=s.baseAsset*0.99;
    if(s.quoteDebt>0||sellable>=book.minSize){
      const tx=new Transaction();tx.setSender(owner);
      if(sellable>=book.minSize)tx.add(c.client.deepbook.poolProxy.placeMarketOrder({poolKey:pool,marginManagerKey:'BOT',clientOrderId:String(Date.now()),quantity:toLots(sellable,book.lotSize,book.minSize),isBid:false,payWithDeep:false}));
      if(s.quoteDebt>0)tx.add(c.client.deepbook.marginManager.repayQuote('BOT'));
      const r=await setupTransaction(owner,tx,env);s=await read();steps.push({step:`sell ${base} lots and repay USDC loan`,result:r,state:s});
      if(!ok(r))return {done:false,steps};
    }
    if(s.quoteDebt>0)throw new Error(`USDC debt ${s.quoteDebt} remains after the sell`);
  }
  const usdc=Math.floor(s.quoteAsset*1e6)/1e6,baseAmt=Math.floor(s.baseAsset*1e6)/1e6;
  if(usdc>0||baseAmt>0){
    const tx=new Transaction();tx.setSender(owner);
    const coins=[];
    if(usdc>0)coins.push(tx.add(c.client.deepbook.marginManager.withdrawQuote('BOT',usdc)));
    if(baseAmt>0)coins.push(tx.add(c.client.deepbook.marginManager.withdrawBase('BOT',baseAmt)));
    tx.transferObjects(coins,owner);
    const r=await setupTransaction(owner,tx,env);s=await read();steps.push({step:`withdraw ${usdc} USDC and ${baseAmt} ${base} to the bot wallet`,result:r,state:s});
    if(!ok(r))return {done:false,steps};
  }
  const usdcCoins=await c.client.core.listCoins({owner,coinType:USDC});
  const tx=new Transaction();tx.setSender(owner);
  const objects=[...usdcCoins.objects.map(o=>tx.object(o.objectId)),tx.gas];
  tx.transferObjects(objects,returnTo);
  const r=await setupTransaction(owner,tx,env);steps.push({step:`return ${usdcCoins.objects.reduce((n,o)=>n+Number(o.balance),0)/1e6} USDC and all remaining SUI to ${returnTo}`,result:r});
  return {done:ok(r),steps};
}
