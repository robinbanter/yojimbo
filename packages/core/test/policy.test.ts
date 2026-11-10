import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decide, scheduleActive, type Hit, type Memory } from '../src/policy.js';
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

test('weekend schedules are active on Saturday and not on Monday', () => {
  const s = { version: 'YOJIMBO_V1' as const, kind: 'schedule' as const, id: 'w', createdAt: '2026-11-01T00:00:00Z', text: 'weekends', recurrence: 'weekends' as const, start: '00:00', end: '23:59', timezone: 'Asia/Kolkata', mode: 'guard-alone' as const };
  assert.equal(scheduleActive(s, new Date('2026-11-14T06:00:00Z')), true); // Saturday in India
  assert.equal(scheduleActive(s, new Date('2026-11-16T06:00:00Z')), false); // Monday
});

test('a forgotten rule no longer drives the decision, and a 0 alert ratio does not disable alerts', () => {
  const ctx = { at: new Date('2026-11-10T03:00:00Z'), ratio: 1.4, movePercent: 0, suiPrice: 2 };
  const zero = { blobId: 'b0', memory: { version: 'YOJIMBO_V1' as const, kind: 'rule' as const, id: 'r0', createdAt: '2026-11-10T00:00:00Z', text: 'cap 3', action: 'deposit' as const, maxUsdc: 3, alertRatio: 0, belowRatio: 0, movePercent: 0 } };
  const bad = { blobId: 'b1', memory: { version: 'YOJIMBO_V1' as const, kind: 'rule' as const, id: 'r1', createdAt: '2026-11-10T00:01:00Z', text: 'invented', action: 'reduce' as const, belowRatio: 1.45 } };
  const before = decide([zero, bad], ctx);
  assert.equal(before.action, 'reduce');
  assert.equal(before.alertRatio, 1.5);
  const forget = { blobId: 'b2', memory: { version: 'YOJIMBO_V1' as const, kind: 'retire' as const, id: 'x', createdAt: '2026-11-10T00:02:00Z', text: 'forget the invented rule', ids: ['r1'] } };
  const after = decide([zero, bad, forget], ctx);
  assert.equal(after.action, 'deposit');
  assert.equal(after.amountUsdc, 3);
  assert.deepEqual(after.ruleIds, ['r0']);
  assert.ok(after.recalledBlobIds.includes('b2'));
});
test('the tightest remembered cap limits a defence whose rule names no amount', () => {
 const uncapped: Memory = {version:'YOJIMBO_V1',kind:'rule',id:'below15',createdAt:'2026-11-10T00:00:00Z',text:'If the risk ratio falls below 1.5, add collateral',action:'deposit',belowRatio:1.5};
 const cap: Memory = {version:'YOJIMBO_V1',kind:'rule',id:'cap3',createdAt:'2026-11-10T00:00:00Z',text:'Never spend more than 3 USDC on a single defence',action:'deposit',maxUsdc:3};
 const d = decide([hit(uncapped),hit(cap)],{at:new Date('2026-11-10T12:00:00Z'),ratio:1.4,movePercent:0,suiPrice:2});
 assert.equal(d.action,'deposit'); assert.equal(d.amountUsdc,3); assert.ok(d.ruleIds.includes('cap3'));
 const alone = decide([hit(uncapped)],{at:new Date('2026-11-10T12:00:00Z'),ratio:1.4,movePercent:0,suiPrice:2});
 assert.equal(alone.amountUsdc,10);
});
