import { MemWal } from '@mysten-incubation/memwal';
import { contextQuery, decodeMemory, encodeMemory, type Context, type Hit, type Memory } from './policy.js';
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Rate limits back off up to 4 times. A relayer timeout or dropped connection is retried quietly up to 2 times
 * (1 s, then 2 s), so one slow preflight does not surface as a failed read. Anything else fails at once. */
const transient = (e: unknown) => /Timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|socket hang up/i.test(String((e as Error)?.name ?? '') + ' ' + String(e));
async function retry<T>(run: () => Promise<T>): Promise<T> {
  for (let i=0;;i++) {
    try { return await run(); } catch(e) {
      if (String(e).includes('429') && i < 4) { await delay(2000 * 2**i); continue; }
      if (transient(e) && i < 2) { await delay(1000 * 2**i); continue; }
      throw e;
    }
  }
}
export function memoryFor(owner: string, env = process.env) {
  if (!env.MEMWAL_MAINNET_KEY) throw new Error('Setup required: MEMWAL_MAINNET_KEY');
  if (!env.MEMWAL_MAINNET_ACCOUNT_ID) throw new Error('Setup required: MEMWAL_MAINNET_ACCOUNT_ID');
  const client = MemWal.create({key: env.MEMWAL_MAINNET_KEY, accountId: env.MEMWAL_MAINNET_ACCOUNT_ID, serverUrl:'https://relayer.memory.walrus.xyz', namespace:`yojimbo-v1:${owner.toLowerCase()}`});
  let queue = Promise.resolve();
  return {
    recallQuery: async (query: string): Promise<Hit[]> => retry(async () => (await client.recall({query, topK: 40})).results.flatMap(r => { const memory = decodeMemory(r.text); return memory ? [{blobId:r.blob_id,memory,distance:r.distance}] : []; })),
    recall: async (context: Context): Promise<Hit[]> => {
      const queries=[contextQuery(context),`Yojimbo owner schedule asleep flying meeting guard alone ask first at ${context.at.toISOString()}`,`Yojimbo newest override correction approval supersedes defence at ratio ${context.ratio.toFixed(2)}`];
      const batches=await Promise.all(queries.map(query=>retry(async () => (await client.recall({query, topK: 40})).results.flatMap(r => { const memory = decodeMemory(r.text); return memory ? [{blobId:r.blob_id,memory,distance:r.distance}] : []; }))));
      return [...new Map(batches.flat().map(h=>[h.blobId,h])).values()];
    },
    remember: (memory: Memory): Promise<string> => { const task = queue.then(() => retry(async () => (await client.rememberAndWait(encodeMemory(memory), { timeoutMs: 300_000 })).blob_id)); queue = task.then(()=>{},()=>{}); return task; },
  };
}
