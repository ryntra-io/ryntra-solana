/**
 * An agent looks after a DLMM Pro position: what it is given, what it keeps of it, and what it does now.
 *
 * The person approves once (`positions.delegate` with a care's three rights — the venue's `CARE_RIGHTS`): the agent may
 * collect the fees, collect the rewards and take the liquidity out. The program pays all three into the owner's own
 * accounts, whoever signs, so there is no vault, no policy of ours and nothing to cap: the only thing the agent's key
 * can do with the position is hand its money to its owner.
 *
 * In order — the stop (the price under the person's
 * stop: everything out, to the wallet); the fees (enough of them waiting, not too soon after the last: to the wallet,
 * with the rewards); wait.
 *
 * **It does not move the range.** A delegate that puts liquidity back pays from its own accounts — rehearsed
 * (`docs/research/meteora-dlmm-pro-2026-11-14/results/REHEARSAL.md` §15): what it takes out lands in the owner's
 * wallet, and those accounts only the owner moves. Out of its range a position waits for its owner, who is told.
 *
 * Public data only.
 *
 * Pure: no I/O.
 */

import { decide, type CareAction, type CareEvent } from "../care/decide.ts";
import type { EarnProNetwork } from "./gate.ts";

/** The stops a person may choose: how far under the price at the approval the agent takes everything out; 0 — no stop. */
export const PRO_CARE_STOP_PCTS = [0, 10, 25] as const;
export type ProCareStopPct = (typeof PRO_CARE_STOP_PCTS)[number];
export const isProCareStopPct = (value: unknown): value is ProCareStopPct => typeof value === "number" && (PRO_CARE_STOP_PCTS as readonly number[]).includes(value);

export const PRO_CARE_EVENTS_KEPT = 60;

export type ProCareEntry = Readonly<{
  v: 1;
  kind: "dlmm-pro";
  key: string;
  network: EarnProNetwork;
  owner: string;
  pool: string;
  nftMint: string;
  agent: string;
  /** The watched price (`watchOf`) under which the agent takes everything out; null — no stop. */
  stopBelow: number | null;
  /**
   * Whether the chain has shown the approval. A row is written before the approval is sent, so that an answer lost
   * on the way back never leaves a care on the chain with nobody keeping its stop; the agent's pass confirms it from
   * the chain, and lets go of a row the chain never confirms.
   */
  confirmed: boolean;
  status: "working" | "stopped";
  /** Why it stopped: the stop was reached, the owner took the care back, or the position is no longer the owner's. */
  stoppedBy: "stop" | "owner" | "gone" | null;
  lastClaimAt: number | null;
  events: readonly CareEvent[];
  createdAt: number;
  updatedAt: number;
  /** A removal at the stop the agent sent but did not see land; the next pass settles it from the chain. */
  exitSent?: Readonly<{ signature: string; at: number; valueInY: number }> | null;
}>;

export const proCareKey = (network: EarnProNetwork, owner: string, nftMint: string): string => `p:${network}:${owner}:${nftMint}`;
export const proCarePrefix = (network: EarnProNetwork, owner?: string): string => (owner ? `p:${network}:${owner}:` : `p:${network}:`);

/**
 * The price a care's stop watches — the coin whose fall is the risk, in the coin it is counted in. On a pier of SOL
 * against dollars that is SOL in dollars; on a pier of a staked SOL (or the stand's test coin) it is that coin in SOL —
 * whichever side of the pool each coin was made on. `value` from the pool's own price, token Y per token X.
 */
export type Watch = Readonly<{ value: number; coin: string; unit: string }>;

export function watchOf(pier: Readonly<{ solIsX: boolean; price: number; x: Readonly<{ symbol: string }>; y: Readonly<{ symbol: string }> }>, otherKind: "sol" | "dollar" | "staked-sol" | "test" | "other" | null): Watch {
  const other = pier.solIsX ? pier.y.symbol : pier.x.symbol;
  const inverse = pier.price > 0 ? 1 / pier.price : 0;
  if (otherKind === "dollar") return { value: pier.solIsX ? pier.price : inverse, coin: "SOL", unit: other };
  return { value: pier.solIsX ? inverse : pier.price, coin: other, unit: "SOL" };
}

/** A row written before its approval lands is let go after this long if the chain never shows the approval. */
export const PRO_CARE_PENDING_MS = 30 * 60_000;

/** The stop as a price: `pct` under the price at the approval; null for no stop or a price that is not one. */
export function stopBelowOf(price: number, pct: ProCareStopPct): number | null {
  if (pct === 0 || !(price > 0) || !Number.isFinite(price)) return null;
  return price * (1 - pct / 100);
}

export type ProCareReading = Readonly<{
  /** The watched price now (`watchOf`). */
  price: number;
  hasLiquidity: boolean;
  /** The fees waiting, valued in token Y (whole coins). */
  feesInY: number;
  /** What the agent's transactions for one collect cost, valued in token Y. */
  txCostInY: number;
}>;

/** The one thing to do now: `exit`, `claim` or `wait` — never a rebalance, never a reinvest. */
export function proCareAction(reading: ProCareReading, entry: Pick<ProCareEntry, "stopBelow" | "lastClaimAt">, now: number): CareAction {
  return decide(
    {
      /* A kind without a range of its own to the chooser: the range is the owner's to move. */
      kind: "damm-v2",
      price: reading.price,
      activeBin: null,
      lowerBin: null,
      upperBin: null,
      feesInY: reading.feesInY,
      txCostInY: reading.txCostInY,
      hasLiquidity: reading.hasLiquidity,
      outOfRangeSince: null,
      lastRebalanceAt: null,
      lastClaimAt: entry.lastClaimAt,
    },
    { fees: "wallet", rebalance: false, stopBelow: entry.stopBelow },
    now,
  );
}

/** Raw amounts of a pool's two coins as whole coins of token Y at the pool's price. */
export function inTokenY(xRaw: bigint, yRaw: bigint, pool: Readonly<{ price: number; decimalsX: number; decimalsY: number }>): number {
  return Number(yRaw) / 10 ** pool.decimalsY + (Number(xRaw) / 10 ** pool.decimalsX) * pool.price;
}

/** Lamports as whole coins of token Y: SOL is one of a pier's two coins. */
export function lamportsInTokenY(lamports: number, pool: Readonly<{ price: number; solIsX: boolean }>): number {
  const sol = lamports / 1e9;
  return pool.solIsX ? sol * pool.price : sol;
}

/** A row with one more event, the oldest dropped past what is kept. */
export function withEvent(entry: ProCareEntry, event: CareEvent, changes: Partial<Pick<ProCareEntry, "status" | "stoppedBy" | "lastClaimAt">> = {}): ProCareEntry {
  return { ...entry, ...changes, events: [...entry.events, event].slice(-PRO_CARE_EVENTS_KEPT), updatedAt: event.at };
}

/** How long a removal sent and not seen may still land — its blockhash's life with room to spare, ms. */
export const EXIT_LANDS_WITHIN_MS = 150_000;

/**
 * A removal sent and not seen last pass, settled by its own signature: landed — the exit, as it was sent; refused, or
 * past the time it could land — dropped, nothing written of it. The same row where nothing was sent.
 */
export function settleExit(entry: ProCareEntry, landed: boolean): ProCareEntry {
  const sent = entry.exitSent;
  if (!sent) return entry;
  const rest: ProCareEntry = { ...entry, exitSent: null };
  return landed ? withEvent(rest, { at: sent.at, kind: "exit", valueInY: sent.valueInY, signature: sent.signature }) : rest;
}

/** What the agent brought to the wallet in the last day, in token Y, and when it last acted. */
export function proCareDay(entry: Pick<ProCareEntry, "events">, now: number): Readonly<{ claimedInY: number; lastAt: number | null; refusals: number }> {
  const day = entry.events.filter((event) => event.at <= now && now - event.at <= 86_400_000);
  return {
    claimedInY: day.filter((event) => event.kind === "claim" || event.kind === "exit").reduce((sum, event) => sum + event.valueInY, 0),
    lastAt: entry.events.filter((event) => event.kind !== "refused").at(-1)?.at ?? null,
    refusals: day.filter((event) => event.kind === "refused").length,
  };
}
