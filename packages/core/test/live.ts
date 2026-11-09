import { chain, registry, position, botKey, buildDefence, discoverRecentManagers, watchPosition } from '../src/index.js';
const owner=process.env.YOJIMBO_BOT_KEY ? botKey().toSuiAddress() : '0x0000000000000000000000000000000000000000000000000000000000000001';
try {
 const r=await registry(owner);
 console.log(JSON.stringify({test:'registry',ok:r.enabled && r.liquidation>1 && r.minBorrow>r.liquidation,source:r.source,packageId:r.packageId,liquidation:r.liquidation,minBorrow:r.minBorrow,minWithdraw:r.minWithdraw,basePool:r.basePool,quotePool:r.quotePool}));
 const managers=await discoverRecentManagers(5);
 const live=await Promise.all(managers.map(async m=>({managerId:m.managerId,riskRatio:(await watchPosition(m.managerId)).state.riskRatio})));
 if(live.length<3||live.some(m=>!Number.isFinite(m.riskRatio)))throw new Error('Fewer than three recent managers with live risk ratios');
 console.log(JSON.stringify({test:'recent managers',ok:true,count:live.length,positions:live}));
 if (!process.env.YOJIMBO_BOT_KEY) { console.log(JSON.stringify({test:'manager state and deposit dry-run',blocked:'YOJIMBO_BOT_KEY'})); process.exit(0); }
 const p=await position(owner);
 if (!p.managerId || !p.state || !p.price) { console.log(JSON.stringify({test:'manager state and deposit dry-run',blocked:'funded bot-owned MarginManager'})); process.exit(0); }
 console.log(JSON.stringify({test:'manager state',ok:Number.isFinite(p.state.riskRatio),riskRatio:p.state.riskRatio,price:p.price}));
 const c=chain(owner,p.managerId);
 const {tx}=await buildDefence(owner,p.managerId,'deposit',0.1,{baseAsset:p.state.baseAsset,baseDebt:p.state.baseDebt,quoteAsset:p.state.quoteAsset,quoteDebt:p.state.quoteDebt,price:p.price});
 const dry=process.env.YOJIMBO_DEV_SUI_RPC ? await c.client.core.simulateTransaction({transaction:tx,include:{effects:true}}) : await (c.client as any).dryRunTransactionBlock({transactionBlock:await tx.build({client:c.client})});
 console.log(JSON.stringify({test:'deposit dry-run',status:'effects' in dry ? dry.effects?.status : dry.FailedTransaction?.status??'success'}));
} catch(e) { console.error(JSON.stringify({test:'live',error:String(e)})); process.exitCode=1; }
