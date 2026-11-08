import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decide, type Hit, type Memory } from '../src/policy.js';
const schedule: Memory = {version:'YOJIMBO_V1',kind:'schedule',id:'sleep',createdAt:'2026-11-08T00:00:00Z',text:'asleep 01:00–08:00 IST daily',recurrence:'daily',start:'01:00',end:'08:00',timezone:'Asia/Kolkata',mode:'guard-alone'};
const rule: Memory = {version:'YOJIMBO_V1',kind:'rule',id:'night',createdAt:'2026-11-08T00:00:00Z',text:'At night add collateral, never close',action:'deposit',belowRatio:1.5,maxUsdc:10,mode:'guard-alone'};
const dayRule: Memory = {version:'YOJIMBO_V1',kind:'rule',id:'day',createdAt:'2026-11-08T00:00:00Z',text:'If ratio < 1.3 cut half',action:'reduce',belowRatio:1.3,maxUsdc:10};
const hit=(memory:Memory):Hit=>({memory,blobId:`blob-${memory.id}`});
test('recalled schedule selects guard-alone at night and ask-first by day',()=>{
 const night=decide([hit(schedule),hit(rule)],{at:new Date('2026-11-09T21:00:00Z'),ratio:1.4,movePercent:-3,suiPrice:2});
 assert.equal(night.mode,'guard-alone'); assert.equal(night.action,'deposit'); assert.deepEqual(night.recalledBlobIds,['blob-sleep','blob-night']);
 const day=decide([hit(schedule),hit(dayRule)],{at:new Date('2026-11-09T06:00:00Z'),ratio:1.2,movePercent:-3,suiPrice:2});
 assert.equal(day.mode,'ask-first'); assert.equal(day.action,'reduce');
});
test('newest similar override changes the next defence',()=>{
 const base={at:new Date('2026-11-09T21:00:00Z'),ratio:1.38,movePercent:-4,suiPrice:2};
 const older:Memory={version:'YOJIMBO_V1',kind:'override',id:'older',createdAt:'2026-11-09T21:30:00Z',text:'Good call',supersedes:'night',action:'deposit',mode:'guard-alone',ratio:1.4,movePercent:-3,verdict:'approval'};
 const correction:Memory={version:'YOJIMBO_V1',kind:'override',id:'override1',createdAt:'2026-11-09T22:00:00Z',text:'You should not have added; cut half next time',supersedes:'night',action:'reduce',mode:'guard-alone',ratio:1.4,movePercent:-3,verdict:'correction'};
 const before=decide([hit(schedule),hit(rule)],base);
 const after=decide([hit(schedule),hit(rule),hit(older),hit(correction)],base);
 assert.equal(before.action,'deposit'); assert.equal(after.action,'reduce'); assert.equal(after.quote,correction.text); assert.deepEqual(after.ruleIds,['night','override1']);
});
test('unrelated override does not apply and no recalled rule means no action',()=>{
 const correction:Memory={version:'YOJIMBO_V1',kind:'override',id:'other',createdAt:'2026-11-09T22:00:00Z',text:'cut next time',supersedes:'night',action:'reduce',mode:'guard-alone',ratio:2.4,movePercent:-30,verdict:'correction'};
 assert.equal(decide([hit(schedule),hit(rule),hit(correction)],{at:new Date('2026-11-09T21:00:00Z'),ratio:1.4,movePercent:-3,suiPrice:2}).action,'deposit');
 assert.equal(decide([], {at:new Date(),ratio:1.1,movePercent:-10,suiPrice:2}).action,'ignore');
});

test('weekday overnight schedule carries Monday into Tuesday morning',()=>{
 const meeting:Memory={version:'YOJIMBO_V1',kind:'schedule',id:'nightshift',createdAt:'2026-11-08T00:00:00Z',text:'weekdays 23:00–02:00 IST',recurrence:'weekdays',start:'23:00',end:'02:00',timezone:'Asia/Kolkata',mode:'guard-alone'};
 const tue=decide([hit(meeting),hit(rule)],{at:new Date('2026-11-09T20:00:00Z'),ratio:1.4,movePercent:0,suiPrice:2});
 const mon=decide([hit(meeting),hit(rule)],{at:new Date('2026-11-08T20:00:00Z'),ratio:1.4,movePercent:0,suiPrice:2});
 assert.equal(tue.mode,'guard-alone');assert.equal(mon.mode,'ask-first');
});
