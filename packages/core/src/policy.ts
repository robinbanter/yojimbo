export type Action = 'deposit' | 'reduce' | 'repay' | 'ignore';
export type Mode = 'guard-alone' | 'ask-first';
export type Memory =
  | { version: 'YOJIMBO_V1'; kind: 'schedule'; id: string; createdAt: string; text: string; recurrence: 'daily' | 'weekdays' | 'weekends' | 'once'; start: string; end: string; timezone: string; mode: Mode }
  | { version: 'YOJIMBO_V1'; kind: 'rule'; id: string; createdAt: string; text: string; action: Action; belowRatio?: number; movePercent?: number; maxUsdc?: number; alertRatio?: number; mode?: Mode; defaultOnTimeout?: Action }
  | { version: 'YOJIMBO_V1'; kind: 'override'; id: string; createdAt: string; text: string; supersedes: string; action: Action; mode: Mode; ratio: number; movePercent: number; verdict: 'correction' | 'approval' }
  | { version: 'YOJIMBO_V1'; kind: 'event'; id: string; createdAt: string; text: string; beforeRatio: number; afterRatio: number | null; suiPrice: number; movePercent: number; mode: Mode; action: Action; txDigest: string | null; outcome: string; ruleIds: string[] }
  | { version: 'YOJIMBO_V1'; kind: 'retire'; id: string; createdAt: string; text: string; ids: string[] }
  | { version: 'YOJIMBO_V1'; kind: 'summary'; id: string; createdAt: string; text: string; position: string; pnlUsdc: number | null };
export type Hit = { blobId: string; memory: Memory; distance?: number };
export type Context = { at: Date; ratio: number; movePercent: number; suiPrice: number };
export type Decision = { mode: Mode; action: Action; amountUsdc: number; reason: string; quote: string; ruleIds: string[]; recalledBlobIds: string[]; timeoutAction: Action; nextWindow: string | null; alertRatio: number };
export const memoryId = () => crypto.randomUUID();
export const encodeMemory = (memory: Memory) => JSON.stringify(memory);
export function decodeMemory(text: string): Memory | null {
  try { const value = JSON.parse(text); return value?.version === 'YOJIMBO_V1' && typeof value.id === 'string' ? value as Memory : null; } catch { return null; }
}
export function contextQuery(c: Context): string {
  return `Yojimbo schedules rules overrides owner protection risk ratio ${c.ratio.toFixed(2)} SUI move ${c.movePercent.toFixed(2)}% time ${c.at.toISOString()} defence action`; 
}
function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (name: string) => parts.find(p => p.type === name)?.value ?? '';
  return { minutes: Number(get('hour')) * 60 + Number(get('minute')), weekday: get('weekday'), day: `${get('year')}-${get('month')}-${get('day')}` };
}
function hm(value: string): number { const m = /^(\d{2}):(\d{2})$/.exec(value); if (!m) throw new Error('Time must be HH:MM'); return Number(m[1])*60 + Number(m[2]); }
export function scheduleActive(s: Extract<Memory, {kind:'schedule'}>, at: Date): boolean {
  const p = localParts(at, s.timezone);
  const start = s.recurrence === 'once' ? `${p.day}T${String(Math.floor(p.minutes/60)).padStart(2,'0')}:${String(p.minutes%60).padStart(2,'0')}` : p.minutes;
  if (s.recurrence === 'once') return start >= s.start && start < s.end;
  const a = hm(s.start), b = hm(s.end);
  const inWindow = a <= b ? p.minutes >= a && p.minutes < b : p.minutes >= a || p.minutes < b;
  if (!inWindow) return false;
  if (s.recurrence === 'weekdays' || s.recurrence === 'weekends') {
    const weekday = a > b && p.minutes < b ? localParts(new Date(at.getTime()-86400000), s.timezone).weekday : p.weekday;
    const weekend = ['Sat','Sun'].includes(weekday);
    return s.recurrence === 'weekends' ? weekend : !weekend;
  }
  return true;
}
/** A positive finite number, else undefined: models often send 0 for "not stated", which must not become a threshold. */
const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
/** Rule numbers the owner never stated are dropped, so a 0 can't silently disable alerts. */
export function cleanRule<T extends Extract<Memory, {kind:'rule'}>>(r: T): T {
  return { ...r, belowRatio: pos(r.belowRatio), movePercent: pos(r.movePercent), maxUsdc: pos(r.maxUsdc), alertRatio: pos(r.alertRatio) };
}
/** Memories the owner asked Yojimbo to forget (a retire memory lists their ids); Walrus is append-only, so forgetting is a memory too. */
export function retiredIds(memories: Memory[]): Set<string> {
  return new Set(memories.flatMap(m => (m.kind === 'retire' ? m.ids : [])));
}
export function live(hits: Hit[]): Hit[] {
  const gone = retiredIds(hits.map(h => h.memory));
  return hits.filter(h => h.memory.kind !== 'retire' && !gone.has(h.memory.id)).map(h => (h.memory.kind === 'rule' ? { ...h, memory: cleanRule(h.memory) } : h));
}
export function decide(allHits: Hit[], context: Context, alertRatio = 1.5): Decision {
  const hits = live(allHits);
  const memories = hits.map(h => h.memory);
  const schedules = memories.filter((m): m is Extract<Memory,{kind:'schedule'}> => m.kind === 'schedule').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const active = schedules.find(s => scheduleActive(s, context.at));
  const mode = active?.mode ?? 'ask-first';
  const nextWindow = schedules.find(s => !scheduleActive(s, context.at))?.text ?? null;
  const rules = memories.filter((m): m is Extract<Memory,{kind:'rule'}> => m.kind === 'rule');
  const overrides = memories.filter((m): m is Extract<Memory,{kind:'override'}> => m.kind === 'override');
  const personalAlert = rules.filter(r=>r.alertRatio != null).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]?.alertRatio ?? alertRatio;
  const relevant = overrides.filter(o => o.mode === mode && Math.abs(o.ratio-context.ratio) <= 0.2 && Math.abs(o.movePercent-context.movePercent) <= 5).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
  const matched = rules.filter(r => (!r.mode || r.mode === mode) && (r.belowRatio == null || context.ratio <= r.belowRatio) && (r.movePercent == null || Math.abs(context.movePercent) >= r.movePercent));
  const triggered = context.ratio <= personalAlert || rules.some(r => r.movePercent != null && Math.abs(context.movePercent) >= r.movePercent);
  const chosen = matched.sort((a,b)=>(a.belowRatio ?? 99)-(b.belowRatio ?? 99))[0];
  const source = relevant ?? chosen;
  const action: Action = triggered && source ? source.action : 'ignore';
  const quote = source?.text ?? 'No recalled rule permits an action.';
  return { mode, action, amountUsdc: action === 'ignore' ? 0 : chosen?.maxUsdc ?? 10, reason: triggered ? (source ? `Recalled ${source.kind} ${source.id}` : 'No matching recalled rule') : 'No alert threshold crossed', quote, ruleIds: source ? (source.kind === 'override' ? [source.supersedes,source.id] : [source.id]) : [], recalledBlobIds: allHits.map(h=>h.blobId), timeoutAction: chosen?.defaultOnTimeout ?? 'ignore', nextWindow, alertRatio: personalAlert };
}

/**
 * SUI price at which a margin manager's risk ratio reaches the liquidation line, holding the USDC price fixed.
 * Risk ratio = (base*p + quote*q) / (quoteDebt*q + baseDebt*p); solving for ratio = L gives
 * p = q*(L*quoteDebt - quote) / (base - L*baseDebt). Returns null when no SUI move alone can liquidate it.
 */
export function liquidationCushion(
  s: { baseAsset: number; quoteAsset: number; baseDebt: number; quoteDebt: number; price: number; quotePrice: number; riskRatio: number },
  liquidation: number,
): { price: number; move: number; atOrBelow: boolean } | null {
  const vals = [s.baseAsset, s.quoteAsset, s.baseDebt, s.quoteDebt, s.price, s.quotePrice, liquidation];
  if (!vals.every(Number.isFinite) || s.price <= 0) return null;
  if (s.riskRatio <= liquidation) return { price: s.price, move: 0, atOrBelow: true };
  const denom = s.baseAsset - liquidation * s.baseDebt;
  if (denom === 0 || (s.baseDebt === 0 && s.quoteDebt === 0)) return null;
  const price = (s.quotePrice * (liquidation * s.quoteDebt - s.quoteAsset)) / denom;
  if (!(price > 0)) return null;
  return { price, move: price / s.price - 1, atOrBelow: false };
}
