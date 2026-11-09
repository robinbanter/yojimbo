import { SuiJsonRpcClient, JsonRpcHTTPTransport } from '@mysten/sui/jsonRpc';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { deepbook, mainnetPackageIds, mainnetCoins, mainnetPools } from '@mysten/deepbook-v3';
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
  if(pool.toLowerCase()!==SUI_USDC_POOL.toLowerCase())return null;
  return {...activity,owner:owner.toLowerCase(),pool:POOL};
}
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
  const url = dev ? env.YOJIMBO_DEV_SUI_RPC! : 'https://sui-mainnet.gateway.tatum.io';
  if (dev) return {client:new SuiGrpcClient({network:'mainnet',baseUrl:url}), source:'dev RPC (not Tatum)' as const, url};
  return {client:new SuiJsonRpcClient({network:'mainnet',transport:new JsonRpcHTTPTransport({url,rpc:{headers:{'x-api-key':env.TATUM_API_KEY!}}})}), source:'Tatum' as const, url};
}
export function chain(owner: string, managerId?: string, env = process.env) {
  const r = rpc(env);
  const options = {address:owner,marginManagers:managerId ? {BOT:{address:managerId,poolKey:POOL}} : undefined};
  if (r.source === 'dev RPC (not Tatum)' || r.source === FORK_SOURCE) return {...r,client:r.client.$extend(deepbook(options))};
  return {...r,client:r.client.$extend(deepbook(options))};
}
export async function registry(owner: string, env = process.env) {
  const c=chain(owner,undefined,env);
  const [enabled, liquidation, minBorrow, minWithdraw, basePool, quotePool] = await Promise.all([
    c.client.deepbook.isPoolEnabledForMargin(POOL),c.client.deepbook.getLiquidationRiskRatio(POOL),c.client.deepbook.getMinBorrowRiskRatio(POOL),c.client.deepbook.getMinWithdrawRiskRatio(POOL),c.client.deepbook.getBaseMarginPoolId(POOL),c.client.deepbook.getQuoteMarginPoolId(POOL)
  ]);
  return {enabled,liquidation,minBorrow,minWithdraw,basePool:basePool.replace(/^0x0x/,'0x'),quotePool:quotePool.replace(/^0x0x/,'0x'),packageId:mainnetPackageIds.MARGIN_PACKAGE_ID,registryId:MARGIN_REGISTRY,source:c.source};
}
export async function position(owner: string, env = process.env) {
  const base = chain(owner,undefined,env);
  const ids = env.YOJIMBO_MARGIN_MANAGER_ID ? [] : await base.client.deepbook.getMarginManagerIdsForOwner(owner);
  const managerId = env.YOJIMBO_MARGIN_MANAGER_ID || ids[0];
  if (!managerId) return {owner,managerId:null,state:null,price:null,source:base.source};
  const c=chain(owner,managerId,env);
  const state = await c.client.deepbook.getMarginManagerState('BOT');
  const parsed=parseManagerState(state);
  return {owner,managerId,state:parsed.state,price:parsed.price,source:c.source};
}
/** sui-fork's gRPC serves object BCS but no JSON; MarginManager starts with id, owner and deepbook_pool. */
const ManagerPrefix=bcs.struct('MarginManagerPrefix',{id:bcs.Address,owner:bcs.Address,deepbook_pool:bcs.Address});
function managerPrefix(content?:Uint8Array|null){if(!content||content.length<96)return undefined;try{return ManagerPrefix.parse(content.slice(0,96));}catch{return undefined;}}
export async function managerState(managerId:string,env=process.env){
  if(!addressPattern.test(managerId))throw new Error('Invalid MarginManager ID');
  const base=rpc(env);
  const result=await base.client.core.getObject({objectId:managerId,include:{json:true,content:true}});
  const object=result.object&&{...result.object,json:result.object.json??managerPrefix(result.object.content)};
  const candidate=object&&parseManagerObject(object,{managerId:managerId.toLowerCase(),lastActivity:'',activity:'',checkpoint:null});
  if(!candidate)throw new Error('SUI/USDC MarginManager not found');
  const c=chain(candidate.owner,managerId,env);
  const state=await c.client.deepbook.getMarginManagerState('BOT');
  const parsed=parseManagerState(state);
  return {owner:candidate.owner,managerId,state:parsed.state,price:parsed.price,quotePrice:parsed.quotePrice,source:c.source};
}
export async function watchPosition(managerId:string,env=process.env){
  const [p,thresholds]=await Promise.all([managerState(managerId,env),registry('0x1',env)]);
  return {...p,thresholds};
}
export async function discoverRecentManagers(limit=8,env=process.env):Promise<RecentManager[]>{
  const c=rpc(env).client;
  const registryObject=await c.core.getObject({objectId:MARGIN_REGISTRY});
  const originalPackage=registryObject.object?.type?.split('::')[0];
  if(!originalPackage||!addressPattern.test(originalPackage))throw new Error('Margin registry type unavailable');
  const seen=new Map<string,RecentManager>();
  let before:string|null|undefined;
  for(let page=0;page<10&&seen.size<limit;page++){
    const response=await c.core.listEvents({filter:{eventType:`${originalPackage}::margin_manager`},order:'descending',limit:50,...(before?{before}:{})});
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
/** Local fork writes: simulate first, then send only with YOJIMBO_ALLOW_FORK_WRITES=LOCAL_FORK_ONLY. Never reaches mainnet. */
async function forkWrite(owner:string,tx:Transaction,client:SuiGrpcClient,env=process.env){
  let status:{status:string;error?:string};
  try{const simulated=await client.core.simulateTransaction({transaction:tx,include:{effects:true}});status=simulated.FailedTransaction?{status:'failure',error:simulated.FailedTransaction.status.error?.message??'simulation failed'}:{status:'success'};}
  catch(e){status={status:'failure',error:`fork simulation unavailable: ${String(e).slice(0,200)}`};}
  if(env.YOJIMBO_ALLOW_FORK_WRITES!==FORK_WRITE_GATE)return {mode:'dry-run' as const,status,txDigest:null};
  if(owner!==botKey(env).toSuiAddress())throw new Error('Bot wallet does not own this manager');
  return executeOnFork(client,tx,{signer:botKey(env)});
}
/** Floor a SUI order quantity to the pool's lot size; DeepBook aborts (order_info EOrderInvalidLotSize) otherwise. */
export function toLots(quantity:number,lotSize:number,minSize:number){
  if(!(lotSize>0))throw new Error('Invalid pool lot size');
  const lots=Math.floor(quantity/lotSize+1e-9);
  const rounded=Number((lots*lotSize).toFixed(9));
  if(!(rounded>=minSize))throw new Error(`Order of ${quantity} SUI is below the pool minimum of ${minSize} SUI`);
  return rounded;
}
export type DefenceAction = 'deposit'|'reduce'|'repay';
export async function buildDefence(owner:string,managerId:string,action:DefenceAction,amountUsdc:number,state:{baseAsset:string;baseDebt:string;quoteAsset:string;quoteDebt:string;price:number},env=process.env) {
  const c=chain(owner,managerId,env);
  const tx = new Transaction(); tx.setSender(owner);
  if (action === 'deposit') tx.add(c.client.deepbook.marginManager.depositQuote({managerKey:'BOT',amount:amountUsdc}));
  if (action === 'repay') tx.add(c.client.deepbook.marginManager.repayQuote('BOT',Math.min(amountUsdc,Number(state.quoteAsset),Number(state.quoteDebt))));
  if (action === 'reduce') {
    const isBid=Number(state.baseDebt)>0;
    const raw=Math.min((isBid?Number(state.baseDebt):Number(state.baseAsset))/2,amountUsdc/state.price);
    if (!(raw > 0)) throw new Error('No SUI position available to reduce');
    const book=await c.client.deepbook.poolBookParams(POOL);
    const quantity=toLots(raw,book.lotSize,book.minSize);
    tx.add(c.client.deepbook.poolProxy.placeReduceOnlyMarketOrderAndRepayLoan({poolKey:POOL,marginManagerKey:'BOT',clientOrderId:String(Date.now()),quantity,isBid,payWithDeep:false}));
  }
  return {tx,client:c.client};
}
export async function executeDefence(owner:string,managerId:string,action:DefenceAction,amountUsdc:number,state:{baseAsset:string;baseDebt:string;quoteAsset:string;quoteDebt:string;price:number},spentToday:number,env=process.env) {
  const cap=Number(env.YOJIMBO_MAX_DEFENCE_USDC ?? 10), daily=Number(env.YOJIMBO_DAILY_USDC ?? 30);
  if (![cap,daily,amountUsdc,spentToday].every(v=>Number.isFinite(v)&&v>=0) || cap<=0 || daily<=0 || amountUsdc<=0 || amountUsdc>cap || spentToday+amountUsdc>daily) throw new Error('Defence exceeds per-action or daily USDC cap');
  if (action==='repay' && Math.min(Number(state.quoteAsset),Number(state.quoteDebt)) <= 0) throw new Error('No quote balance and debt to repay');
  const {tx,client}=await buildDefence(owner,managerId,action,amountUsdc,state,env);
  if (forkUrl(env)) return forkWrite(owner,tx,client as SuiGrpcClient,env);
  if (env.YOJIMBO_DEV_SUI_RPC) {
    const simulated=await client.core.simulateTransaction({transaction:tx,include:{effects:true}});
    const status = simulated.FailedTransaction ? {status:'failure',error:simulated.FailedTransaction.status.error?.message ?? 'simulation failed'} : {status:'success'};
    if (env.YOJIMBO_ALLOW_MAINNET === 'I_ACKNOWLEDGE_REAL_FUNDS') throw new Error('Remove YOJIMBO_DEV_SUI_RPC before mainnet writes');
    return {mode:'dry-run' as const,status,txDigest:null};
  }
  const jsonClient=client as SuiJsonRpcClient;
  const bytes=await tx.build({client:jsonClient});
  const dryRun=await jsonClient.dryRunTransactionBlock({transactionBlock:bytes});
  const status=dryRun.effects.status;
  if (status.status !== 'success' || env.YOJIMBO_ALLOW_MAINNET !== 'I_ACKNOWLEDGE_REAL_FUNDS') return {mode:'dry-run' as const,status,txDigest:null};
  if (owner !== botKey(env).toSuiAddress()) throw new Error('Bot wallet does not own this manager');
  const result=await jsonClient.signAndExecuteTransaction({signer:botKey(env),transaction:tx,options:{showEffects:true}});
  return {mode:'mainnet' as const,status:result.effects?.status ?? null,txDigest:result.digest};
}
export async function setupTransaction(owner:string,tx:Transaction,env=process.env){
  const c=chain(owner,undefined,env);
  if(forkUrl(env))return forkWrite(owner,tx,c.client as SuiGrpcClient,env);
  if(env.YOJIMBO_DEV_SUI_RPC){
    const simulation=await c.client.core.simulateTransaction({transaction:tx,include:{effects:true}});
    const status=simulation.FailedTransaction ? {status:'failure',error:simulation.FailedTransaction.status.error?.message??'simulation failed'} : {status:'success'};
    if(env.YOJIMBO_ALLOW_MAINNET==='I_ACKNOWLEDGE_REAL_FUNDS')throw new Error('Remove YOJIMBO_DEV_SUI_RPC before mainnet writes');
    return {mode:'dry-run' as const,status,txDigest:null};
  }
  const jsonClient=c.client as SuiJsonRpcClient;
  const bytes=await tx.build({client:jsonClient});
  const dry=await jsonClient.dryRunTransactionBlock({transactionBlock:bytes});
  if(dry.effects.status.status!=='success'||env.YOJIMBO_ALLOW_MAINNET!=='I_ACKNOWLEDGE_REAL_FUNDS')return {mode:'dry-run' as const,status:dry.effects.status,txDigest:null};
  if(owner!==botKey(env).toSuiAddress())throw new Error('Bot wallet mismatch');
  const result=await jsonClient.signAndExecuteTransaction({signer:botKey(env),transaction:tx,options:{showEffects:true}});
  return {mode:'mainnet' as const,status:result.effects?.status??null,txDigest:result.digest};
}
export async function createMarginManager(owner:string,env=process.env){
  const c=chain(owner,undefined,env);const tx=new Transaction();tx.setSender(owner);tx.add(c.client.deepbook.marginManager.newMarginManager(POOL));
  return setupTransaction(owner,tx,env);
}
export async function openLong(owner:string,managerId:string,depositUsdc:number,borrowUsdc:number,price:number,env=process.env){
  const cap=Number(env.YOJIMBO_MAX_DEFENCE_USDC??10);
  if(!Number.isFinite(cap)||cap<=0||![depositUsdc,borrowUsdc,price].every(v=>Number.isFinite(v)&&v>0)||depositUsdc>cap||borrowUsdc>cap)throw new Error('Invalid amount or exceeds per-action USDC cap');
  const c=chain(owner,managerId,env);const tx=new Transaction();tx.setSender(owner);
  const book=await c.client.deepbook.poolBookParams(POOL);
  const quantity=toLots((depositUsdc+borrowUsdc)*0.9/price,book.lotSize,book.minSize);
  tx.add(c.client.deepbook.marginManager.depositQuote({managerKey:'BOT',amount:depositUsdc}));
  tx.add(c.client.deepbook.marginManager.borrowQuote('BOT',borrowUsdc));
  tx.add(c.client.deepbook.poolProxy.placeMarketOrder({poolKey:POOL,marginManagerKey:'BOT',clientOrderId:String(Date.now()),quantity,isBid:true,payWithDeep:false}));
  return setupTransaction(owner,tx,env);
}
