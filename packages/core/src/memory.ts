import { MemWal } from '@mysten-incubation/memwal';
import { contextQuery, decodeMemory, encodeMemory, type Context, type Hit, type Memory } from './policy.js';
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function retry<T>(run: () => Promise<T>): Promise<T> {
  for (let i=0;;i++) { try { return await run(); } catch(e) { if (i >= 4 || !String(e).includes('429')) throw e; await delay(2000 * 2**i); } }
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
    remember: (memory: Memory): Promise<string> => { const task = queue.then(() => retry(async () => (await client.rememberAndWait(encodeMemory(memory))).blob_id)); queue = task.then(()=>{},()=>{}); return task; },
  };
}
