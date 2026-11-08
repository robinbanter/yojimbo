import { SuiJsonRpcClient, JsonRpcHTTPTransport } from '@mysten/sui/jsonRpc';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { deepbook, mainnetPackageIds, mainnetCoins } from '@mysten/deepbook-v3';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
export const POOL = 'SUI_USDC';
export const USDC = mainnetCoins.USDC.type;
export const MARGIN_REGISTRY = mainnetPackageIds.MARGIN_REGISTRY_ID;
export function botKey(env = process.env) { if (!env.YOJIMBO_BOT_KEY) throw new Error('Setup required: YOJIMBO_BOT_KEY'); return Ed25519Keypair.fromSecretKey(env.YOJIMBO_BOT_KEY); }
export function rpc(env = process.env) {
  const dev = Boolean(env.YOJIMBO_DEV_SUI_RPC);
  if (!dev && !env.TATUM_API_KEY) throw new Error('Setup required: TATUM_API_KEY');
  const url = dev ? env.YOJIMBO_DEV_SUI_RPC! : 'https://sui-mainnet.gateway.tatum.io';
  if (dev) return {client:new SuiGrpcClient({network:'mainnet',baseUrl:url}), source:'dev RPC (not Tatum)' as const, url};
  return {client:new SuiJsonRpcClient({network:'mainnet',transport:new JsonRpcHTTPTransport({url,rpc:{headers:{'x-api-key':env.TATUM_API_KEY!}}})}), source:'Tatum' as const, url};
}
export function chain(owner: string, managerId?: string, env = process.env) {
  const r = rpc(env);
  const options = {address:owner,marginManagers:managerId ? {BOT:{address:managerId,poolKey:POOL}} : undefined};
  if (r.source === 'dev RPC (not Tatum)') return {...r,client:r.client.$extend(deepbook(options))};
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
  const price = Number(state.basePythPrice) / 10**state.basePythDecimals;
  return {owner,managerId,state:{...state,currentPrice:state.currentPrice.toString(),lowestTriggerAbovePrice:state.lowestTriggerAbovePrice.toString(),highestTriggerBelowPrice:state.highestTriggerBelowPrice.toString()},price,source:c.source};
}
export type DefenceAction = 'deposit'|'reduce'|'repay';
export function buildDefence(owner:string,managerId:string,action:DefenceAction,amountUsdc:number,state:{baseAsset:string;baseDebt:string;quoteAsset:string;quoteDebt:string;price:number},env=process.env) {
  const c=chain(owner,managerId,env);
  const tx = new Transaction(); tx.setSender(owner);
  if (action === 'deposit') tx.add(c.client.deepbook.marginManager.depositQuote({managerKey:'BOT',amount:amountUsdc}));
  if (action === 'repay') tx.add(c.client.deepbook.marginManager.repayQuote('BOT',Math.min(amountUsdc,Number(state.quoteAsset),Number(state.quoteDebt))));
  if (action === 'reduce') {
    const isBid=Number(state.baseDebt)>0;
    const quantity=Math.min((isBid?Number(state.baseDebt):Number(state.baseAsset))/2,amountUsdc/state.price);
    if (!(quantity > 0)) throw new Error('No SUI position available to reduce');
    tx.add(c.client.deepbook.poolProxy.placeReduceOnlyMarketOrderAndRepayLoan({poolKey:POOL,marginManagerKey:'BOT',clientOrderId:String(Date.now()),quantity,isBid,payWithDeep:false}));
  }
  return {tx,client:c.client};
}
export async function executeDefence(owner:string,managerId:string,action:DefenceAction,amountUsdc:number,state:{baseAsset:string;baseDebt:string;quoteAsset:string;quoteDebt:string;price:number},spentToday:number,env=process.env) {
  const cap=Number(env.YOJIMBO_MAX_DEFENCE_USDC ?? 10), daily=Number(env.YOJIMBO_DAILY_USDC ?? 30);
  if (![cap,daily,amountUsdc,spentToday].every(v=>Number.isFinite(v)&&v>=0) || cap<=0 || daily<=0 || amountUsdc<=0 || amountUsdc>cap || spentToday+amountUsdc>daily) throw new Error('Defence exceeds per-action or daily USDC cap');
  if (action==='repay' && Math.min(Number(state.quoteAsset),Number(state.quoteDebt)) <= 0) throw new Error('No quote balance and debt to repay');
  const {tx,client}=buildDefence(owner,managerId,action,amountUsdc,state,env);
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
  tx.add(c.client.deepbook.marginManager.depositQuote({managerKey:'BOT',amount:depositUsdc}));
  tx.add(c.client.deepbook.marginManager.borrowQuote('BOT',borrowUsdc));
  tx.add(c.client.deepbook.poolProxy.placeMarketOrder({poolKey:POOL,marginManagerKey:'BOT',clientOrderId:String(Date.now()),quantity:(depositUsdc+borrowUsdc)*0.9/price,isBid:true,payWithDeep:false}));
  return setupTransaction(owner,tx,env);
}
