/**
 * «Claim» when the network's fee comes close to what it brings (CITY-243): one line before the signature says so. Only
 * a show — the claim, its sum and its transaction stay as the engine builds them. Pure: the windows and the tests read
 * it alike.
 */

/** From half of the sum the fee is «close to it». */
export const FEE_NEAR_SHARE = 0.5;

export type FeeNear = 'over' | 'near' | null;

const finite = (value: number | bigint | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The network's fee against what a claim brings, both in lamports: more than the sum, close to it (half of it or
 * more), or neither. A sum or a fee not known — or nothing to claim — says nothing: the line never guesses.
 */
export function feeNear(sumLamports: number | bigint | string | null | undefined, feeLamports: number | bigint | string | null | undefined): FeeNear {
  const sum = finite(sumLamports);
  const fee = finite(feeLamports);
  if (sum === null || fee === null || !(sum > 0) || !(fee > 0)) return null;
  if (fee >= sum) return 'over';
  return fee >= sum * FEE_NEAR_SHARE ? 'near' : null;
}

/** A raw amount of a pair currency in lamports: SOL as it is, dollars at SOL's price; any other currency, unknown. */
export function pairLamports(raw: string | bigint, pair: Readonly<{ symbol: string; decimals: number; dollar: boolean }>, solUsd: number | null): number | null {
  const units = finite(typeof raw === 'bigint' ? raw.toString() : raw);
  if (units === null) return null;
  if (pair.symbol === 'SOL') return (units / 10 ** pair.decimals) * 1e9;
  if (pair.dollar && solUsd !== null && solUsd > 0) return ((units / 10 ** pair.decimals) / solUsd) * 1e9;
  return null;
}

/** Dollars in lamports at SOL's price; unknown without either. */
export function usdLamports(usd: number | null, solUsd: number | null): number | null {
  if (usd === null || !Number.isFinite(usd) || solUsd === null || !(solUsd > 0)) return null;
  return (usd / solUsd) * 1e9;
}
