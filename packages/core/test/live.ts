import { chain, registry, position, botKey, buildDefence } from '../src/index.js';
import { Transaction } from '@mysten/sui/transactions';
const owner=process.env.YOJIMBO_BOT_KEY ? botKey().toSuiAddress() : '0x0000000000000000000000000000000000000000000000000000000000000001';
try {
 const r=await registry(owner);
 console.log(JSON.stringify({test:'registry',ok:r.enabled && r.liquidation>1 && r.minBorrow>r.liquidation,source:r.source,packageId:r.packageId,liquidation:r.liquidation,minBorrow:r.minBorrow,minWithdraw:r.minWithdraw,basePool:r.basePool,quotePool:r.quotePool}));
 if (!process.env.YOJIMBO_BOT_KEY) { console.log(JSON.stringify({test:'manager state and deposit dry-run',blocked:'YOJIMBO_BOT_KEY'})); process.exit(0); }
 const p=await position(owner);
 if (!p.managerId || !p.state || !p.price) { console.log(JSON.stringify({test:'manager state and deposit dry-run',blocked:'funded bot-owned MarginManager'})); process.exit(0); }
 console.log(JSON.stringify({test:'manager state',ok:Number.isFinite(p.state.riskRatio),riskRatio:p.state.riskRatio,price:p.price}));
 const c=chain(owner,p.managerId);
 const {tx}=buildDefence(owner,p.managerId,'deposit',0.1,{baseAsset:p.state.baseAsset,quoteAsset:p.state.quoteAsset,quoteDebt:p.state.quoteDebt,price:p.price});
 const bytes=await tx.build({client:c.client});
 const dry=await c.client.dryRunTransactionBlock({transactionBlock:bytes});
 console.log(JSON.stringify({test:'deposit dry-run',status:dry.effects.status}));
} catch(e) { console.error(JSON.stringify({test:'live',error:String(e)})); process.exitCode=1; }
