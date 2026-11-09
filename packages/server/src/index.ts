import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { liquidationCushion, botKey, chain, executeDefence, createMarginManager, openLong, memoryFor, memoryId, position, registry, decide, discoverRecentManagers, managerState, watchPosition, forkUrl, forkClient, forkStatus, forkRuleHits, FORK_SOURCE, FORK_WRITE_GATE, type RecentManager, type Context, type Decision, type Hit, type Memory, type Action } from '@yojimbo/core';

const port=Number(process.env.PORT ?? 8787);
// Fork runs keep their own event log (YOJIMBO_DATA_DIR) so fork digests never mix with mainnet history.
const dataDir=resolve(process.cwd(),process.env.YOJIMBO_DATA_DIR??'data');
const dataFile=resolve(dataDir,'events.json');
const managersFile=resolve(dataDir,'managers.json');
const fork=forkUrl();
async function forkLabel(){if(!fork)return null;const s=await forkStatus(forkClient(fork));return {label:`${FORK_SOURCE} @ checkpoint ${s.forkedAtCheckpoint}`,forkedAtCheckpoint:s.forkedAtCheckpoint,checkpoint:s.checkpoint,clockMs:s.clockMs,writes:process.env.YOJIMBO_ALLOW_FORK_WRITES===FORK_WRITE_GATE};}
let managersCache:{at:number;items:RecentManager[]}|null=null;
try{const saved=JSON.parse(await readFile(managersFile,'utf8'));if(Array.isArray(saved.items))managersCache=saved;}catch{}
async function recentManagers(){
 if(managersCache&&Date.now()-managersCache.at<300_000)return managersCache.items;
 const items=await discoverRecentManagers(12);
 managersCache={at:Date.now(),items};
 await mkdir(dataDir,{recursive:true});await writeFile(managersFile,JSON.stringify(managersCache,null,2));
 return items;
}
async function recentWithRisk(){
 const items=await recentManagers();
 const thresholds=await registry('0x1');
 const live=await Promise.all(items.map(async item=>{try{const p=await managerState(item.managerId);return {...item,riskRatio:p.state.riskRatio,liquidationRatio:thresholds.liquidation};}catch{return null;}}));
 return live.filter((item):item is NonNullable<typeof item>=>item!==null).sort((a,b)=>a.riskRatio-a.liquidationRatio-(b.riskRatio-b.liquidationRatio));
}
function memoryReady(){return Boolean(process.env.MEMWAL_MAINNET_KEY&&process.env.MEMWAL_MAINNET_ACCOUNT_ID);}
type EventRow={id:string;at:string;beforeRatio:number;afterRatio:number|null;suiPrice:number;movePercent:number;mode:string;action:Action;amountUsdc:number;outcome:string;txDigest:string|null;ruleIds:string[];recalledBlobIds:string[];memoryBlobId?:string;memoryError?:string};
let events:EventRow[]=[];
try { events=JSON.parse(await readFile(dataFile,'utf8')); } catch {}
const listeners=new Set<ServerResponse>();
const pending=new Map<string,{decision:Decision;context:Context;owner:string;managerId:string;state:any;timer:ReturnType<typeof setTimeout>}>();
let watcherError:string|null=null;
let lastPrice:number|null=null;
let lastActionAt=0;
let telegramOffset=0;
let lastSummaryDate=new Date().toISOString().slice(0,10);
function owner(){return botKey().toSuiAddress();}
function json(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));}
function emit(type:string,data:unknown){for(const res of listeners)res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);}
async function body(req:IncomingMessage){let text='';for await(const chunk of req){text+=chunk;if(text.length>100_000)throw new Error('Request too large');}return JSON.parse(text||'{}');}
function safeError(e:unknown){const message=String(e);return /API_KEY|BOT_KEY|ACCOUNT_ID|Setup required/.test(message)?message.replace(/([A-Za-z_]+)=\S+/g,'$1=[redacted]'):message.slice(0,400);}
async function persist(){await mkdir(dataDir,{recursive:true});await writeFile(dataFile,JSON.stringify(events,null,2));}
async function sendTelegram(message:string){const token=process.env.TELEGRAM_BOT_TOKEN,chatId=process.env.TELEGRAM_CHAT_ID;if(!token||!chatId)return;await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:fork?`[LOCAL FORK test · no real funds] ${message}`:message,disable_web_page_preview:true})});}
async function notify(message:string){emit('notification',{message,at:new Date().toISOString()});try{await sendTelegram(message);}catch{emit('status',{telegram:'Telegram delivery failed'});}}
async function recall(ownerAddress:string,ctx:Context){if(memoryReady())return memoryFor(ownerAddress).recall(ctx);return fork&&process.env.YOJIMBO_FORK_RULES?forkRuleHits(resolve(process.cwd(),'../..',process.env.YOJIMBO_FORK_RULES)):[];}
async function snapshot(ownerAddress:string){const p=await position(ownerAddress);if(!p.state||!p.price||!p.managerId)throw new Error('Setup required: bot-owned MarginManager');return p;}
async function context(ownerAddress:string){const p=await snapshot(ownerAddress);return {p,ctx:{at:new Date(),ratio:p.state!.riskRatio,movePercent:lastPrice ? (p.price!-lastPrice)/lastPrice*100 : 0,suiPrice:p.price!}};}
function spentToday(){const day=new Date().toISOString().slice(0,10);return events.filter(e=>e.at.startsWith(day)&&e.outcome===(fork?'fork success':'mainnet success')).reduce((n,e)=>n+e.amountUsdc,0);}
async function assess(ownerAddress:string){const {p,ctx}=await context(ownerAddress);const hits=await recall(ownerAddress,ctx);const decision=decide(hits,ctx,Number(process.env.YOJIMBO_ALERT_RATIO??1.5));return {p,ctx,hits,decision};}
async function assessWatched(managerId:string){const p=await watchPosition(managerId);const ctx:Context={at:new Date(),ratio:p.state.riskRatio,movePercent:0,suiPrice:p.price};const hits=await recall(p.owner,ctx);const cushion=p.thresholds?.liquidation==null?null:liquidationCushion({baseAsset:Number(p.state.baseAsset),quoteAsset:Number(p.state.quoteAsset),baseDebt:Number(p.state.baseDebt),quoteDebt:Number(p.state.quoteDebt),price:Number(p.price),quotePrice:Number(p.quotePrice),riskRatio:Number(p.state.riskRatio)},Number(p.thresholds.liquidation));return {...p,liquidation:cushion?{suiPriceAtLiquidationUsd:Number(cushion.price.toFixed(4)),suiMoveToLiquidationPercent:Number((cushion.move*100).toFixed(2)),alreadyLiquidatable:cushion.atOrBelow}:'no SUI price move alone liquidates this position',decision:decide(hits,ctx,Number(process.env.YOJIMBO_ALERT_RATIO??1.5)),decisionSource:memoryReady()?'Walrus Memory':fork&&process.env.YOJIMBO_FORK_RULES?`local fork rules file ${process.env.YOJIMBO_FORK_RULES} (not Walrus Memory)`:'defaults: no remembered rules (Walrus Memory setup required)',context:{at:ctx.at.toISOString(),movePercent:ctx.movePercent},caps:{perActionUsdc:Number(process.env.YOJIMBO_MAX_DEFENCE_USDC??10),dailyUsdc:Number(process.env.YOJIMBO_DAILY_USDC??30)}};}
async function remember(ownerAddress:string,memory:Memory){const blobId=await memoryFor(ownerAddress).remember(memory);emit('memory',{blobId,memory});return blobId;}
async function act(ownerAddress:string,decision:Decision,ctx:Context,managerId:string,state:any,forceDryRun=false){
 if(decision.action==='ignore')return {outcome:'ignored',decision};
 const amount=Math.min(decision.amountUsdc,Number(process.env.YOJIMBO_MAX_DEFENCE_USDC??10));
 const env=forceDryRun?{...process.env,YOJIMBO_ALLOW_MAINNET:'',YOJIMBO_ALLOW_FORK_WRITES:''}:process.env;
 const result=await executeDefence(ownerAddress,managerId,decision.action,amount,{baseAsset:state.baseAsset,baseDebt:state.baseDebt,quoteAsset:state.quoteAsset,quoteDebt:state.quoteDebt,price:ctx.suiPrice},spentToday(),env);
 let afterRatio:null|number=null;
 if(result.mode==='mainnet'||result.mode==='fork'){try{afterRatio=(await snapshot(ownerAddress)).state!.riskRatio;}catch{}}
 const outcome=(result.mode==='mainnet'||result.mode==='fork')&&result.status?.status==='success'?`${result.mode} success`:`${result.mode} ${result.status?.status??'unknown'}`;
 const row:EventRow={id:memoryId(),at:ctx.at.toISOString(),beforeRatio:ctx.ratio,afterRatio,suiPrice:ctx.suiPrice,movePercent:ctx.movePercent,mode:decision.mode,action:decision.action,amountUsdc:amount,outcome,txDigest:result.txDigest,ruleIds:decision.ruleIds,recalledBlobIds:decision.recalledBlobIds};
 events.unshift(row);await persist();emit('event',row);
 const memory:Memory={version:'YOJIMBO_V1',kind:'event',id:row.id,createdAt:row.at,text:`${decision.action}: ${outcome}. ${decision.quote}`,beforeRatio:ctx.ratio,afterRatio,suiPrice:ctx.suiPrice,movePercent:ctx.movePercent,mode:decision.mode,action:decision.action,txDigest:result.txDigest,outcome,ruleIds:decision.ruleIds};
 try{row.memoryBlobId=await remember(ownerAddress,memory);await persist();}catch(e){row.memoryError=safeError(e);await persist();}
 const txLink=!result.txDigest?'':result.mode==='fork'?` digest ${result.txDigest} (${FORK_SOURCE} @ checkpoint ${result.fork.forkedAtCheckpoint}, not on Suiscan)`:` https://suiscan.xyz/mainnet/tx/${result.txDigest}`;
 await notify(`Yojimbo ${outcome}: ${decision.action} ${amount} USDC at risk ratio ${ctx.ratio.toFixed(3)}. “${decision.quote}”${txLink}`);
 return {outcome,decision,event:row};
}
async function recordOverride(ownerAddress:string,args:any){
 const latest=events[0];if(!latest)throw new Error('No defence event to override');
 const action:Action=['deposit','reduce','repay','ignore'].includes(args.action)?args.action:latest.action;
 const memory:Memory={version:'YOJIMBO_V1',kind:'override',id:memoryId(),createdAt:new Date().toISOString(),text:String(args.text||'Owner override'),supersedes:String(args.supersedes||latest.ruleIds.at(-1)||latest.id),action,mode:latest.mode as any,ratio:latest.beforeRatio,movePercent:Number(args.movePercent??latest.movePercent??0),verdict:args.verdict==='approval'?'approval':'correction'};
 const blobId=await remember(ownerAddress,memory);return {blobId,memory};
}
async function tool(name:string,args:any,ownerAddress:string){
 if(['create_margin_manager','open_position','simulate_defence','defend'].includes(name)&&!process.env.YOJIMBO_BOT_KEY)return {error:'Setup required: YOJIMBO_BOT_KEY'};
 if(name==='get_position')return position(String(args.owner||ownerAddress));
 if(name==='get_risk'){if(args.managerId)return assessWatched(String(args.managerId));const target=String(args.owner||ownerAddress);return {position:await position(target),thresholds:await registry(target)};}
 if(name==='watch_position')return assessWatched(String(args.managerId));
 if(name==='list_recent_managers')return {managers:await recentWithRisk()};
 if(name==='create_margin_manager'){const existing=await position(ownerAddress);if(existing.managerId)throw new Error('Bot already has a MarginManager');return createMarginManager(ownerAddress);}
 if(name==='open_position'){const p=await snapshot(ownerAddress);if(Number(p.state!.baseDebt)>0||Number(p.state!.quoteDebt)>0)throw new Error('Position already has debt');return openLong(ownerAddress,p.managerId!,Number(args.depositUsdc),Number(args.borrowUsdc),p.price!);}
 if(name==='list_rules'){if(!memoryReady())return {error:'Setup required: Walrus Memory'};const hits=await memoryFor(ownerAddress).recallQuery('Yojimbo all schedules rules overrides and owner preferences');return {items:hits.filter(h=>['rule','schedule','override'].includes(h.memory.kind)),recalled:hits.map(h=>h.blobId)};}
 if(['add_rule','add_schedule','record_override'].includes(name)&&!memoryReady())return {error:'Setup required: Walrus Memory'};
 if(name==='add_rule'){
  if(!['deposit','reduce','repay','ignore'].includes(args.action))throw new Error('Invalid action');
  const memory:Memory={version:'YOJIMBO_V1',kind:'rule',id:memoryId(),createdAt:new Date().toISOString(),text:String(args.text),action:args.action,belowRatio:args.belowRatio,movePercent:args.movePercent,maxUsdc:args.maxUsdc,alertRatio:args.alertRatio,mode:args.mode,defaultOnTimeout:args.defaultOnTimeout};return {blobId:await remember(ownerAddress,memory),memory};
 }
 if(name==='add_schedule'){
  const memory:Memory={version:'YOJIMBO_V1',kind:'schedule',id:memoryId(),createdAt:new Date().toISOString(),text:String(args.text),recurrence:args.recurrence,start:String(args.start),end:String(args.end),timezone:String(args.timezone||'Asia/Kolkata'),mode:args.mode};return {blobId:await remember(ownerAddress,memory),memory};
 }
 if(name==='record_override')return recordOverride(ownerAddress,args);
 if(name==='simulate_defence'||name==='defend'){
  const {p,ctx,decision}=await assess(ownerAddress);
  emit('trace',{decision,recalled:decision.recalledBlobIds});
  return act(ownerAddress,decision,ctx,p.managerId!,p.state!,name==='simulate_defence');
 }
 throw new Error(`Unknown tool ${name}`);
}
const toolSchemas=[
 ['get_position','Read a DeepBook Margin position by owner address, defaulting to bot owner',{owner:{type:'string'}}],['get_risk','Read position risk and SUI/USDC margin pool thresholds; provide managerId for a watched position',{owner:{type:'string'},managerId:{type:'string'}}],['watch_position','Read live risk and deterministic decision for a MarginManager ID',{managerId:{type:'string'}}],['list_recent_managers','List recent real SUI/USDC MarginManagers with live risk ratios',{}],['create_margin_manager','Create a bot-owned SUI/USDC MarginManager, dry-run unless mainnet enabled',{}],['open_position','Deposit USDC, borrow USDC and buy SUI to open a long; dry-run unless mainnet enabled',{depositUsdc:{type:'number'},borrowUsdc:{type:'number'}}],['list_rules','Recall rules, schedules and overrides from Walrus Memory',{}],
 ['add_rule','Remember a defence rule',{text:{type:'string'},action:{type:'string',enum:['deposit','reduce','repay','ignore']},belowRatio:{type:'number'},movePercent:{type:'number'},maxUsdc:{type:'number'},alertRatio:{type:'number'},mode:{type:'string',enum:['guard-alone','ask-first']},defaultOnTimeout:{type:'string',enum:['deposit','reduce','repay','ignore']}}],
 ['add_schedule','Remember a recurring or one-time schedule',{text:{type:'string'},recurrence:{type:'string',enum:['daily','weekdays','once']},start:{type:'string'},end:{type:'string'},timezone:{type:'string'},mode:{type:'string',enum:['guard-alone','ask-first']}}],
 ['record_override','Remember owner correction or approval for last defence',{text:{type:'string'},action:{type:'string',enum:['deposit','reduce','repay','ignore']},verdict:{type:'string',enum:['correction','approval']}}],
 ['simulate_defence','Recall rules and dry-run current defence',{}],['defend','Recall rules and execute current defence, gated by YOJIMBO_ALLOW_MAINNET',{}]
].map(([name,description,properties])=>({type:'function',function:{name,description,parameters:{type:'object',properties,additionalProperties:false}}}));
async function openRouter(messages:any[],tools:any[]=toolSchemas){
 if(!process.env.OPENROUTER_API_KEY)throw new Error('Setup required: OPENROUTER_API_KEY');
 const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`},body:JSON.stringify({model:process.env.YOJIMBO_MODEL||'nvidia/nemotron-3-ultra-550b-a55b:free',messages,tools,tool_choice:'auto'})});
 if(!response.ok)throw new Error((response.status===402?'OpenRouter HTTP 402: this key has no credits left. Top up OpenRouter or set YOJIMBO_MODEL to a :free model':response.status===429?'OpenRouter HTTP 429: the free model is rate-limited right now. Try again in a minute':`OpenRouter HTTP ${response.status}`));
 return (await response.json()).choices[0].message;
}
async function chat(res:ServerResponse,prompt:string,watchManagerId?:string){
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
 const send=(type:string,data:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
 try{
  const address=process.env.YOJIMBO_BOT_KEY?owner():'0x1';
  const messages:any[]=[{role:'system',content:`You are Yojimbo, a cautious Sui DeepBook margin bodyguard. Use tools for every factual position or memory claim. Never invent chain or memory data or remembered rules. Defence decisions are deterministic. If a memory tool returns Setup required: Walrus Memory, say that clearly and do not claim to remember. Watched positions are read-only and Yojimbo cannot act on someone else's position. Reply in plain text for a chat bubble: no markdown, no headings, no bullet lists, at most four short sentences, and quote numbers exactly as the tools returned them. ${watchManagerId?`Current watched manager ID: ${watchManagerId}. Use watch_position or get_risk with this managerId for risk questions.`:''} State clearly that actions are dry-run unless mainnet is enabled. One-time schedule start/end are YYYY-MM-DDTHH:MM local. Do not claim success on a failed dry-run.`},{role:'user',content:prompt}];
  for(let i=0;i<8;i++){
   const reply=await openRouter(messages,watchManagerId?toolSchemas.filter(t=>['get_risk','watch_position','list_recent_managers','list_rules','add_rule','add_schedule','record_override'].includes(String(t.function.name))):toolSchemas);messages.push(reply);
   if(!reply.tool_calls?.length){send('message',{text:reply.content||''});send('done',{});return;}
   for(const call of reply.tool_calls){const name=call.function.name;let args:any={};try{args=JSON.parse(call.function.arguments||'{}');}catch{}
    send('tool',{name,args});let result:unknown;try{result=watchManagerId&&!['get_risk','watch_position','list_recent_managers','list_rules'].includes(name)?{error:memoryReady()?'Watch mode is read-only':'Setup required: Walrus Memory'}:await tool(name,args,address);}catch(e){result={error:safeError(e)};}
    send('tool_result',{name,result});messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v)});
   }
  }
  send('message',{text:'Tool limit reached. Please continue in a new message.'});send('done',{});
 }catch(e){send('error',{message:safeError(e)});send('done',{});}finally{res.end()}
}
async function watch(){
 try{
  const address=owner();const {p,ctx,decision}=await assess(address);
  const currentPrice=ctx.suiPrice;lastPrice=currentPrice;
  if(decision.action==='ignore'||Date.now()-lastActionAt<300000||pending.size)return;
  lastActionAt=Date.now();emit('trace',{decision,recalled:decision.recalledBlobIds});
  if(decision.mode==='guard-alone')await act(address,decision,ctx,p.managerId!,p.state!);
  else{
   const id=memoryId();const timer=setTimeout(async()=>{const item=pending.get(id);if(!item)return;pending.delete(id);const timeout={...item.decision,action:item.decision.timeoutAction};if(timeout.action!=='ignore')await act(item.owner,timeout,item.context,item.managerId,item.state);else await notify(`Yojimbo timed out to Ignore. “${item.decision.quote}”`);},60000);
   pending.set(id,{decision,context:ctx,owner:address,managerId:p.managerId!,state:p.state!,timer});
   await notify(`Yojimbo asks first: risk ratio ${ctx.ratio.toFixed(3)}. Proposed ${decision.action}. “${decision.quote}” Respond in app: Approve / Reduce / Ignore. Request ${id}`);
   emit('approval',{id,decision});
  }
  watcherError=null;
 }catch(e){watcherError=safeError(e);emit('status',{watcherError});}
}
async function dailySummary(){
 const today=new Date().toISOString().slice(0,10);
 if(today===lastSummaryDate)return;
 const yesterday=lastSummaryDate;lastSummaryDate=today;
 try{const address=owner();const p=await position(address);const daily=events.filter(e=>e.at.startsWith(yesterday));
  const text=`${yesterday}: ${daily.length} defence events. ${daily.map(e=>`${e.action} ${e.outcome}`).join('; ')||'No defences'}. Position ratio ${p.state?.riskRatio??'unavailable'}. P&L unavailable without a cost basis.`;
  await remember(address,{version:'YOJIMBO_V1',kind:'summary',id:memoryId(),createdAt:new Date().toISOString(),text,position:p.managerId?JSON.stringify({managerId:p.managerId,riskRatio:p.state?.riskRatio,baseAsset:p.state?.baseAsset,quoteAsset:p.state?.quoteAsset,baseDebt:p.state?.baseDebt,quoteDebt:p.state?.quoteDebt}):'No manager',pnlUsdc:null});
  await notify(`Yojimbo daily summary: ${text}`);
 }catch(e){emit('status',{summaryError:safeError(e)});}
}
async function telegramWorker(){
 if(!process.env.TELEGRAM_BOT_TOKEN||!process.env.TELEGRAM_CHAT_ID)return;
 const token=process.env.TELEGRAM_BOT_TOKEN;
 while(true){try{
  const response=await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${telegramOffset}`);
  const data:any=await response.json();for(const update of data.result||[]){telegramOffset=update.update_id+1;const msg=update.message;if(String(msg?.chat?.id)!==process.env.TELEGRAM_CHAT_ID||!msg?.text)continue;
   try{const parsed=await openRouter([{role:'system',content:'Parse this owner reaction to a Yojimbo defence. Call record_override only when the user corrects or approves the previous action. For good call, verdict approval and action equal to the last action if unknown; for cut half, action reduce. If not an override, respond with plain text.'},{role:'user',content:msg.text}],toolSchemas.filter(t=>t.function.name==='record_override'));
    const call=parsed.tool_calls?.[0];if(call){const result=await recordOverride(owner(),JSON.parse(call.function.arguments||'{}'));await sendTelegram(`Yojimbo remembered your override. Blob ${result.blobId}`);}
   }catch{}
  }
 }catch{await new Promise(r=>setTimeout(r,5000));}}
}
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url||'/',`http://localhost:${port}`).pathname;
 const origin=req.headers.origin;
 if(origin && !['http://localhost:5173','http://127.0.0.1:5173','http://localhost:5185','http://127.0.0.1:5185','http://localhost:5186','http://127.0.0.1:5186'].includes(origin))return json(res,403,{error:'Origin not allowed'});
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 if(path==='/stream'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});listeners.add(res);req.on('close',()=>listeners.delete(res));res.write(': connected\n\n');return;}
 if(path==='/status'){let address:string|null=null;try{address=owner();}catch{}let balance:string|null=null,usdcBalance:string|null=null;if(address){try{const client=chain(address).client;const balances=await Promise.all([client.core.getBalance({owner:address,coinType:'0x2::sui::SUI'}),client.core.getBalance({owner:address,coinType:'0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'})]);balance=balances[0].balance.balance;usdcBalance=balances[1].balance.balance;}catch{}}
  const forkInfo=await forkLabel();
  return json(res,200,{fork:forkInfo,rpc:forkInfo?forkInfo.label:process.env.YOJIMBO_DEV_SUI_RPC?'dev RPC (not Tatum)':process.env.TATUM_API_KEY?'Tatum':'Setup required: TATUM_API_KEY',memory:process.env.MEMWAL_MAINNET_KEY&&process.env.MEMWAL_MAINNET_ACCOUNT_ID?'Walrus mainnet':'Setup required: MEMWAL_MAINNET_KEY / MEMWAL_MAINNET_ACCOUNT_ID',telegram:process.env.TELEGRAM_BOT_TOKEN&&process.env.TELEGRAM_CHAT_ID?'Telegram ready':'Setup required: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID',openRouter:process.env.OPENROUTER_API_KEY?'ready':'Setup required: OPENROUTER_API_KEY',wallet:address,balanceMist:balance,usdcBalance,mainnetWrites:!fork&&process.env.YOJIMBO_ALLOW_MAINNET==='I_ACKNOWLEDGE_REAL_FUNDS'&&!process.env.YOJIMBO_DEV_SUI_RPC,watcherError,pending:[...pending.keys()]});}
 if(path==='/registry')return json(res,200,await registry(process.env.YOJIMBO_BOT_KEY?owner():'0x1'));
 if(path==='/managers/recent')return json(res,200,{managers:await recentCached()});
 const watchMatch=/^\/watch\/(0x[0-9a-fA-F]{64})$/.exec(path);
 if(watchMatch&&req.method==='GET')return json(res,200,await assessWatched(watchMatch[1]));
 if(watchMatch&&req.method==='POST'){
  const data=await body(req);
  if(data.action!=='dry-run')return json(res,400,{error:'Unknown action'});
  if(!process.env.YOJIMBO_BOT_KEY)return json(res,400,{error:'Setup required: YOJIMBO_BOT_KEY (Yojimbo only acts on positions its own bot wallet owns)'});
  const watched=await assessWatched(watchMatch[1]);
  if(watched.owner!==owner())return json(res,403,{error:'Yojimbo only acts on positions its own bot wallet owns'});
  if(watched.decision.action==='ignore')return json(res,200,{outcome:'No defence permitted by current rules',decision:watched.decision});
  const s=watched.state;
  const result=await executeDefence(watched.owner,watched.managerId,watched.decision.action,Math.min(watched.decision.amountUsdc,watched.caps.perActionUsdc),{baseAsset:s.baseAsset,baseDebt:s.baseDebt,quoteAsset:s.quoteAsset,quoteDebt:s.quoteDebt,price:watched.price},spentToday(),{...process.env,YOJIMBO_ALLOW_MAINNET:'',YOJIMBO_ALLOW_FORK_WRITES:''});
  return json(res,200,result);
 }
 // Setup writes for the bot's own position. Both go through core's write gate: without
 // YOJIMBO_ALLOW_MAINNET=I_ACKNOWLEDGE_REAL_FUNDS they are built and dry-run only, never sent.
 if((path==='/bot/create'||path==='/bot/open')&&req.method==='POST'){
  if(!process.env.YOJIMBO_BOT_KEY)return json(res,400,{error:'Setup required: YOJIMBO_BOT_KEY'});
  const address=owner();
  const data=await body(req);
  const existing=await position(address);
  let result;
  if(path==='/bot/create'){
   if(existing.managerId)return json(res,409,{error:'Bot already has a MarginManager',managerId:existing.managerId});
   result=await createMarginManager(address);
  }else{
   const p=await snapshot(address);
   if(Number(p.state!.baseDebt)>0||Number(p.state!.quoteDebt)>0)return json(res,409,{error:'Position already has debt',managerId:p.managerId});
   result=await openLong(address,p.managerId!,Number(data.depositUsdc),Number(data.borrowUsdc),p.price!);
  }
  const allowed=process.env.YOJIMBO_ALLOW_MAINNET==='I_ACKNOWLEDGE_REAL_FUNDS';
  const note=result.mode==='fork'?`Executed on ${FORK_SOURCE} @ checkpoint ${result.fork.forkedAtCheckpoint}, not mainnet`:result.mode==='mainnet'?'Executed on mainnet':allowed?'Dry run did not succeed, nothing was sent':'Dry-run only: YOJIMBO_ALLOW_MAINNET is not set, nothing was sent';
  return json(res,200,{...result,note});
 }
 if(path==='/position')return json(res,200,await position(owner()));
 if(path==='/memory'&&process.env.YOJIMBO_BOT_KEY&&!memoryReady()&&fork&&process.env.YOJIMBO_FORK_RULES){const address=owner();const hits=await forkRuleHits(resolve(process.cwd(),'../..',process.env.YOJIMBO_FORK_RULES));let currentDecision:Decision|null=null;try{const {ctx}=await context(address);currentDecision=decide(hits,ctx);}catch{}return json(res,200,{hits,decision:currentDecision,source:'local-file',setup:'Setup required: Walrus Memory'});}
 if(path==='/memory'){if(!process.env.YOJIMBO_BOT_KEY||!memoryReady())return json(res,200,{hits:[],decision:null,setup:'Setup required: Walrus Memory'});const address=owner();const hits=await memoryFor(address).recallQuery('Yojimbo all schedules rules overrides and owner preferences');let currentDecision:Decision|null=null;try{const {ctx}=await context(address);currentDecision=decide(await recall(address,ctx),ctx);}catch{}return json(res,200,{hits,decision:currentDecision});}
 if(path==='/events')return json(res,200,{events});
 if(path==='/chat'&&req.method==='POST'){const data=await body(req);return chat(res,String(data.message||''),typeof data.watchManagerId==='string'?data.watchManagerId:undefined);}
 if(path==='/decision'&&req.method==='POST'){const data=await body(req);const item=pending.get(data.id);if(!item)return json(res,404,{error:'Approval request expired'});clearTimeout(item.timer);pending.delete(data.id);
  const action:Action=data.choice==='approve'?item.decision.action:data.choice==='reduce'?'reduce':'ignore';if(action==='ignore'){await notify('Yojimbo ignored the alert at owner request.');return json(res,200,{outcome:'ignored'});}
  return json(res,200,await act(item.owner,{...item.decision,action},item.context,item.managerId,item.state));}
 return json(res,404,{error:'Not found'});
}catch(e){return json(res,500,{error:safeError(e)});}});
server.listen(port,'127.0.0.1',()=>console.log(`Yojimbo server listening on localhost:${port}`));
// The live manager scan takes about 40 s on Tatum's free plan, so the server keeps the last result and refreshes it in the background.
let recentState:{at:number;value:Promise<Awaited<ReturnType<typeof recentWithRisk>>>}|null=null;let recentRefresh:Promise<Awaited<ReturnType<typeof recentWithRisk>>>|null=null;
function recentCached(){const age=recentState?Date.now()-recentState.at:Infinity;if(age>60_000&&!recentRefresh){const next=recentWithRisk();recentRefresh=next;next.then(()=>{recentState={at:Date.now(),value:next}}).catch(()=>{}).finally(()=>{recentRefresh=null})}if(recentState&&age<600_000)return recentState.value;return recentRefresh??recentState!.value}
void recentCached();setInterval(()=>void recentCached(),60_000).unref();
setInterval(watch,15000);setTimeout(watch,1000);setInterval(dailySummary,60000);void telegramWorker();
