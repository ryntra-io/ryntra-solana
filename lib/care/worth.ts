/**
 * CITY-207 — what a looked-after position is worth in dollars, at the venue's prices: the same pool record and the same
 * sum Earn's «Mine» shows for a person's own position (`../liquidity/catalog/positions.ts` `positionView`). Pure.
 *
 * Each side is matched to the record by its mint; a side without its price or its decimals makes the figure unknown —
 * `null`, which the city shows as «—», never as zero.
 */

export type CareRecordSide = Readonly<{ mint: string; decimals: number | null; priceUsd: number | null }>;
export type CareRecord = Readonly<{ x: CareRecordSide; y: CareRecordSide }>;

export type CareHolds = Readonly<{ mintX: string; mintY: string; holdsX: bigint; holdsY: bigint; feeX: bigint; feeY: bigint }>;

export type CareWorth = Readonly<{ valueUsd: number | null; unclaimedUsd: number | null }>;

export const NO_WORTH: CareWorth = { valueUsd: null, unclaimedUsd: null };

const sideOf = (record: CareRecord, mint: string): CareRecordSide | null => (record.x.mint === mint ? record.x : record.y.mint === mint ? record.y : null);

const priced = (side: CareRecordSide | null): side is CareRecordSide & { decimals: number; priceUsd: number } =>
  side !== null &&
  typeof side.decimals === "number" &&
  Number.isInteger(side.decimals) &&
  side.decimals >= 0 &&
  side.decimals <= 18 &&
  typeof side.priceUsd === "number" &&
  Number.isFinite(side.priceUsd) &&
  side.priceUsd >= 0;

const units = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;

/** The position's worth and its fees not yet taken, USD; unknown when either side is not priced. */
export function careWorth(holds: CareHolds, record: CareRecord | null): CareWorth {
  if (!record) return NO_WORTH;
  const x = sideOf(record, holds.mintX);
  const y = sideOf(record, holds.mintY);
  if (!priced(x) || !priced(y) || holds.mintX === holds.mintY) return NO_WORTH;
  const value = units(holds.holdsX, x.decimals) * x.priceUsd + units(holds.holdsY, y.decimals) * y.priceUsd;
  const fees = units(holds.feeX, x.decimals) * x.priceUsd + units(holds.feeY, y.decimals) * y.priceUsd;
  return {
    valueUsd: Number.isFinite(value) ? value : null,
    unclaimedUsd: Number.isFinite(fees) ? fees : null,
  };
}
