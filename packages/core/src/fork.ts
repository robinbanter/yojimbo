import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Keypair } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import type { Transaction } from '@mysten/sui/transactions';

/** Visible label for every read and write that goes to a local sui-fork of Sui mainnet. */
export const FORK_SOURCE = 'LOCAL FORK of Sui mainnet' as const;
/** sui-fork has no gas estimation, so fork transactions carry a fixed 0.1 SUI budget (as devstack does). */
export const FORK_GAS_BUDGET = 100_000_000n;
/** The only value that lets Yojimbo send transactions to the local fork. It never enables mainnet writes. */
export const FORK_WRITE_GATE = 'LOCAL_FORK_ONLY';

export function forkUrl(env = process.env): string | null {
  const raw = env.YOJIMBO_SUI_FORK_RPC;
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('YOJIMBO_SUI_FORK_RPC must be a local http://127.0.0.1:<port> sui-fork endpoint');
  if (env.YOJIMBO_DEV_SUI_RPC) throw new Error('Set either YOJIMBO_SUI_FORK_RPC or YOJIMBO_DEV_SUI_RPC, not both');
  if (env.YOJIMBO_ALLOW_MAINNET) throw new Error('YOJIMBO_ALLOW_MAINNET must be unset in fork mode');
  return url.origin;
}

/**
 * gRPC client for a sui-fork endpoint. sui-fork does not implement GetBalance, which the SDK's
 * coinWithBalance intent calls, so balances are summed from the owner's coin objects instead.
 */
export function forkClient(url: string) {
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: url });
  const core = client.core;
  core.getBalance = async (options: { owner: string; coinType?: string }) => {
    const coinType = options.coinType ?? '0x2::sui::SUI';
    let total = 0n, cursor: string | null = null;
    do {
      const page = await core.listCoins({ owner: options.owner, coinType, cursor });
      for (const coin of page.objects) total += BigInt(coin.balance);
      cursor = page.hasNextPage ? page.cursor : null;
    } while (cursor);
    return { balance: { coinType, balance: total.toString(), coinBalance: total.toString(), addressBalance: '0' } };
  };
  return client;
}

/** Fails unless the endpoint answers the sui-fork admin service, so a fork RPC can never silently be a real network. */
export async function forkStatus(client: SuiGrpcClient) {
  const { response } = await client.forkingService.getStatus({});
  return { checkpoint: response.checkpointSequenceNumber.toString(), forkedAtCheckpoint: response.forkedAtCheckpoint.toString(), clockMs: Number(response.timestampMs), epoch: response.epoch.toString() };
}

/**
 * Execute on the fork. With a signer the transaction is signed normally; with `impersonate` it is
 * sent with no signature, which only sui-fork accepts (used to move funds out of a mainnet whale).
 */
export async function executeOnFork(client: SuiGrpcClient, tx: Transaction, auth: { signer: Keypair } | { impersonate: string }) {
  const status = await forkStatus(client);
  const sender = 'signer' in auth ? auth.signer.toSuiAddress() : auth.impersonate;
  tx.setSenderIfNotSet(sender);
  tx.setGasBudgetIfNotSet(FORK_GAS_BUDGET);
  const bytes = await tx.build({ client });
  const signatures = 'signer' in auth ? [(await auth.signer.signTransaction(bytes)).signature] : [];
  const result = await client.core.executeTransaction({ transaction: bytes, signatures, include: { effects: true } });
  const executed = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;
  const after = await forkStatus(client);
  return {
    mode: 'fork' as const,
    txDigest: executed.digest,
    status: executed.effects.status.success ? { status: 'success' } : { status: 'failure', error: executed.effects.status.error?.message ?? 'execution failed' },
    fork: { forkedAtCheckpoint: status.forkedAtCheckpoint, checkpoint: after.checkpoint, clockMs: after.clockMs },
  };
}

/** A fresh fork-only Ed25519 key. The caller writes `secret` to a gitignored file and never prints it. */
export function generateForkKey() { const k = new Ed25519Keypair(); return { secret: k.getSecretKey(), address: k.toSuiAddress() }; }

/** Read one key by variable name from an env file, without loading or echoing anything else. */
export function keyFromEnvFile(file: string, name: string) {
  const value = parseEnv(readFileSync(file, 'utf8'))[name];
  if (!value) throw new Error(`Setup required: ${name} in ${file}`);
  return Ed25519Keypair.fromSecretKey(value);
}
