import { EVM_ADDRESS, isDepositNetwork, type DepositAddress, type DepositNetwork, type DepositProgress } from '../../../lib/relay/deposit-address.ts';
import { ask, type FetchLike } from './engine.ts';

/**
 * Top up from another network: USDC sent from an exchange or another network to an
 * address there, and Relay pays USDC to this Solana wallet. No second wallet and no signature — the engine
 * (`/api/swap/deposit-address`) asks Relay for an open address and believes it only after checking where its money
 * goes. The address is kept per wallet and network for a month, in the same place Ryntra's web keeps it, so a person
 * who saved it in an exchange finds the same one in the city.
 */

export const KEPT_KEY = 'ryntra.deposit-address.v2';
const KEPT_MS = 30 * 24 * 60 * 60 * 1000;

type Kept = DepositAddress & Readonly<{ keptAt: number }>;

/** An address given for this wallet and network within the month, or null. Never one for another wallet. */
export function keptAddress(storage: Pick<Storage, 'getItem'> | null, recipient: string, network: DepositNetwork, now: number): DepositAddress | null {
  try {
    const all = JSON.parse(storage?.getItem(KEPT_KEY) ?? '{}') as Record<string, Kept>;
    const kept = all[`${recipient}:${network}`];
    const fresh = kept && typeof kept.keptAt === 'number' && now - kept.keptAt < KEPT_MS;
    return fresh && kept.recipient === recipient && kept.network === network && EVM_ADDRESS.test(kept.address) ? kept : null;
  } catch {
    return null;
  }
}

export function keepAddress(storage: Pick<Storage, 'getItem' | 'setItem'> | null, value: DepositAddress, now: number): void {
  try {
    const all = JSON.parse(storage?.getItem(KEPT_KEY) ?? '{}') as Record<string, Kept>;
    all[`${value.recipient}:${value.network}`] = { ...value, keptAt: now };
    storage?.setItem(KEPT_KEY, JSON.stringify(all));
  } catch {
    // Storage can be refused: the address is asked for again next time, and an open address is as good as the last.
  }
}

/** The engine's deposit address for this wallet on `network` — only when its answer names exactly what was asked. */
export async function readDepositAddress(fetchImpl: FetchLike, network: DepositNetwork, recipient: string): Promise<DepositAddress | null> {
  const answer = await ask<DepositAddress>(fetchImpl, '/api/swap/deposit-address', { body: { network, recipient } });
  if (!answer.ok) return null;
  const value = answer.value;
  return value && value.recipient === recipient && value.network === network && isDepositNetwork(value.network) && EVM_ADDRESS.test(value.address) ? value : null;
}

/** What Relay says of deposits to `address` since `since` (unix seconds). Unknown is never «arrived». */
export async function readDepositProgress(fetchImpl: FetchLike, address: string, since: number): Promise<Readonly<{ progress: DepositProgress | 'UNKNOWN'; amount: string | null }>> {
  const answer = await ask<{ progress?: DepositProgress | 'UNKNOWN'; amount?: string | null }>(fetchImpl, `/api/swap/deposit-address?address=${encodeURIComponent(address)}&since=${since}`);
  if (!answer.ok || !answer.value?.progress) return { progress: 'UNKNOWN', amount: null };
  return { progress: answer.value.progress, amount: typeof answer.value.amount === 'string' ? answer.value.amount : null };
}

export const PROGRESS_WORDS: Readonly<Record<DepositProgress, string>> = {
  NONE: '',
  ON_THE_WAY: 'A deposit is on its way.',
  ARRIVED: 'Arrived in your wallet.',
  REFUNDED: 'The deposit was refunded.',
  FAILED: 'The deposit could not be filled. Relay support can recover it.',
};

export function feeWords(feeUsd: number | null, referenceUsd: number): string {
  if (feeUsd === null) return 'The fee is set when the deposit is filled.';
  return `About $${feeUsd.toFixed(2)} on $${referenceUsd}, taken from the deposit.`;
}

/** The fee as the one line beside the address says it, or null when Relay named none yet. */
export function feeShort(feeUsd: number | null): string | null {
  return feeUsd === null || !Number.isFinite(feeUsd) || feeUsd < 0 ? null : `fee ≈ $${feeUsd.toFixed(2)}`;
}
