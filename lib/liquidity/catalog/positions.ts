/**
 * A wallet's pool positions as the page shows them: the chain's amounts and
 * unclaimed fees in each token's own unit, the place against the price, and a
 * USD value from the venue's token prices — two sources, each with its time.
 *
 * Pure and client-safe.
 */

import type { Amount } from "@ryntra/core/adapters";

import type { LiquidityPosition, RangeState } from "../studio/contract.ts";
import { priceBound, type CatalogPool, type LiquidityPoolKind } from "./model.ts";

export type PositionSide = Readonly<{
  mint: string;
  symbol: string;
  /** In the token's own unit. */
  amount: number;
  unclaimed: number;
  priceUsd: number | null;
}>;

export type PositionView = Readonly<{
  kind: LiquidityPoolKind;
  address: string;
  pool: string;
  name: string;
  x: PositionSide;
  y: PositionSide;
  rangeState: RangeState;
  /** The position's price bounds, Y per X; null bounds — the plain curve. */
  lower: number | null;
  upper: number | null;
  /** The pool's price now, Y per X, as the venue states it; null when the venue did not price the pool (SOL-2b: how far from the edge). */
  price: number | null;
  /** What the position holds, USD, at the venue's token prices; null when a price is missing. */
  valueUsd: number | null;
  unclaimedUsd: number | null;
  /** 0–10 000: the part that cannot be withdrawn now. */
  lockedBps: number;
  /** Claimed fees go to another address than the owner's (a launch can set that). */
  feesElsewhere: boolean;
  hasRewards: boolean;
  /** The chain read: slot and time. */
  slot: number | null;
  at: number;
  /** When the venue's prices were read; null when they were not. */
  pricesAt: string | null;
}>;

/** Base units → the token's own unit, for reading. */
export function unitsOf(amount: Amount): number {
  const units = amount.units;
  if (!/^\d+$/.test(units)) return 0;
  const decimals = amount.decimals;
  if (units.length <= 15) return Number(units) / 10 ** decimals;
  /* Past a float's exact digits: keep the leading ones, which is all a reading needs. */
  const head = Number(units.slice(0, 15));
  return head * 10 ** (units.length - 15 - decimals);
}

const readPrice = (value: string): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const shortMint = (mint: string): string => `${mint.slice(0, 4)}…`;

export function positionView(position: LiquidityPosition, kind: LiquidityPoolKind, record: CatalogPool | null, pricesAt: string | null): PositionView {
  const xMint = position.amounts.x.asset;
  const yMint = position.amounts.y.asset;
  const xPrice = record?.x.mint === xMint ? record.x.priceUsd : null;
  const yPrice = record?.y.mint === yMint ? record.y.priceUsd : null;
  const x: PositionSide = {
    mint: xMint,
    symbol: record?.x.mint === xMint ? record.x.symbol : shortMint(xMint),
    amount: unitsOf(position.amounts.x),
    unclaimed: unitsOf(position.unclaimedFees.x),
    priceUsd: xPrice,
  };
  const y: PositionSide = {
    mint: yMint,
    symbol: record?.y.mint === yMint ? record.y.symbol : shortMint(yMint),
    amount: unitsOf(position.amounts.y),
    unclaimed: unitsOf(position.unclaimedFees.y),
    priceUsd: yPrice,
  };
  const priced = xPrice !== null && yPrice !== null;
  const range = position.range;
  return {
    kind,
    address: position.address,
    pool: position.pool,
    name: record?.name ?? `${x.symbol}-${y.symbol}`,
    x,
    y,
    rangeState: position.rangeState,
    /* A bin range is always real; only a curve's bounds can be the program's extremes, which mean none. */
    lower: range.kind === "bins" ? readPrice(range.lowerPrice) : priceBound(range.minPrice, "min"),
    upper: range.kind === "bins" ? readPrice(range.upperPrice) : priceBound(range.maxPrice, "max"),
    price: record?.x.mint === xMint && record.y.mint === yMint && record.price !== null && record.price > 0 ? record.price : null,
    valueUsd: priced ? x.amount * xPrice + y.amount * yPrice : null,
    unclaimedUsd: priced ? x.unclaimed * xPrice + y.unclaimed * yPrice : null,
    lockedBps: position.lockedBps,
    feesElsewhere: position.feeRecipient !== position.owner,
    hasRewards: position.unclaimedRewards.some((reward) => reward.units !== "0"),
    slot: position.source.slot,
    at: position.source.at,
    pricesAt: priced ? pricesAt : null,
  };
}

/** The deepest first; the ones out of range — which earn nothing now — before equal ones in range. */
export function rankPositions(views: readonly PositionView[]): PositionView[] {
  return views.slice().sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1) || (a.rangeState === "in_range" ? 1 : 0) - (b.rangeState === "in_range" ? 1 : 0) || a.address.localeCompare(b.address));
}

export type PositionsAnswer = Readonly<{
  owner: string;
  positions: readonly PositionView[];
  /** Per venue: read or not, and why not. */
  venues: Readonly<Record<LiquidityPoolKind, Readonly<{ ok: boolean }>>>;
  at: number;
}>;
