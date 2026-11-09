import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Keypair } from '@mysten/sui/cryptography';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { deepbook, mainnetCoins } from '@mysten/deepbook-v3';
import { executeOnFork, forkClient, forkStatus } from './fork.js';

const SUI = '0x2::sui::SUI';
const USDC = mainnetCoins.USDC.type;
const MIST = 1_000_000_000;
const USDC_SCALAR = 1_000_000;

/** Fork-only funding source: a mainnet address with a large SUI coin, impersonated on the fork. Devstack uses the same default. */
export const FORK_MAINNET_WHALE = '0xbc7e7537564bd939b62e5b24477ac00ba8cef33ccec72d63090a080a1253b725';

export type HubTarget = { kind: 'fork'; url: string } | { kind: 'mainnet'; url: string };

/**
 * Resolve where the hub sends funds. A fork target must answer the sui-fork admin service.
 * A mainnet target must not, and is only reached when the caller passed an explicit mainnet flag.
 */
export async function hubClient(target: HubTarget) {
  if (target.kind === 'fork') {
    const client = forkClient(target.url);
    return { client, label: `LOCAL FORK of Sui mainnet @ forked checkpoint ${(await forkStatus(client)).forkedAtCheckpoint}` };
  }
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: target.url });
  const isFork = await forkStatus(client).then(() => true, () => false);
  if (isFork) throw new Error('--mainnet was passed but this RPC is a sui-fork endpoint');
  return { client, label: 'Sui MAINNET (real funds)' };
}

export async function coinTotal(client: SuiGrpcClient, owner: string, coinType: string) {
  let total = 0n, cursor: string | null = null;
  do {
    const page = await client.core.listCoins({ owner, coinType, cursor });
    for (const coin of page.objects) total += BigInt(coin.balance);
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return total;
}

export async function balances(client: SuiGrpcClient, owner: string) {
  const [sui, usdc] = await Promise.all([coinTotal(client, owner, SUI), coinTotal(client, owner, USDC)]);
  return { owner, sui: Number(sui) / MIST, usdc: Number(usdc) / USDC_SCALAR };
}

async function send(target: HubTarget, client: SuiGrpcClient, tx: Transaction, signer: Keypair) {
  if (target.kind === 'fork') return executeOnFork(client, tx, { signer });
  tx.setSender(signer.toSuiAddress());
  const result = await client.core.signAndExecuteTransaction({ signer, transaction: tx, include: { effects: true } });
  const executed = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;
  return { mode: 'mainnet' as const, txDigest: executed.digest, status: executed.effects.status.success ? { status: 'success' } : { status: 'failure', error: executed.effects.status.error?.message ?? 'execution failed' } };
}

/** Send SUI gas and USDC from the hub wallet to one app wallet in a single transaction. */
export async function distributeFromHub(target: HubTarget, hub: Keypair, to: string, amounts: { sui: number; usdc: number }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(to)) throw new Error('Recipient must be a 0x Sui address');
  if (![amounts.sui, amounts.usdc].every(v => Number.isFinite(v) && v >= 0) || amounts.sui + amounts.usdc <= 0) throw new Error('Amounts must be non-negative and not both zero');
  const { client, label } = await hubClient(target);
  const before = await balances(client, hub.toSuiAddress());
  if (before.usdc < amounts.usdc) throw new Error(`Hub has ${before.usdc} USDC, needs ${amounts.usdc}`);
  if (before.sui < amounts.sui + 0.1) throw new Error(`Hub has ${before.sui} SUI, needs ${amounts.sui} plus gas`);
  const tx = new Transaction();
  tx.setSender(hub.toSuiAddress());
  const coins = [];
  if (amounts.sui > 0) coins.push(coinWithBalance({ balance: BigInt(Math.round(amounts.sui * MIST)) }));
  if (amounts.usdc > 0) coins.push(coinWithBalance({ type: USDC, balance: BigInt(Math.round(amounts.usdc * USDC_SCALAR)) }));
  tx.transferObjects(coins, to);
  const result = await send(target, client, tx, hub);
  return { network: label, hub: hub.toSuiAddress(), to, amounts, result, hubAfter: await balances(client, hub.toSuiAddress()), recipientAfter: await balances(client, to) };
}

/** Fork only: move SUI out of the impersonated mainnet whale. Never possible on a real network. */
export async function fundFromWhale(url: string, to: string, sui: number) {
  const client = forkClient(url);
  const tx = new Transaction();
  tx.setSender(FORK_MAINNET_WHALE);
  tx.transferObjects([coinWithBalance({ balance: BigInt(Math.round(sui * MIST)) })], to);
  return executeOnFork(client, tx, { impersonate: FORK_MAINNET_WHALE });
}

/** Fork only: swap SUI for USDC on DeepBook's real SUI_USDC pool state at the fork checkpoint (fees paid in SUI, no DEEP). */
export async function swapSuiForUsdcOnFork(url: string, signer: Keypair, sui: number, minUsdc: number) {
  const client = forkClient(url).$extend(deepbook({ address: signer.toSuiAddress() }));
  const tx = new Transaction();
  tx.setSender(signer.toSuiAddress());
  const [base, quote, deep] = tx.add(client.deepbook.deepBook.swapExactBaseForQuote({ poolKey: 'SUI_USDC', amount: sui, deepAmount: 0, minOut: minUsdc }));
  tx.transferObjects([base, quote, deep], signer.toSuiAddress());
  return executeOnFork(client, tx, { signer });
}
