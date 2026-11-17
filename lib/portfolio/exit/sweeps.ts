/**
 * What is swapped after the positions are left, so that everything ends in the target.
 *
 * A position that is left brings coins into the wallet only when its transaction lands, so the swap of those coins is
 * signed before they are there. Two kinds of swap make that safe:
 *
 * - **a sweep of what arrived** (any coin but SOL): Meteora's Zap Out reads the wallet's own account of the coin when it
 *   runs and swaps a share of what it holds above the balance read at the Review — never what the wallet held before,
 *   never more than the cap. Jupiter's route inside it is quoted, and its floor set, for a little under what is expected
 *   ({@link SWEEP_QUOTE_BPS}); the cap stands a little over it ({@link SWEEP_CAP_MARGIN_BPS}) — so nearly all a sweep
 *   can swap is under its floor. Less arriving than the quote fails the route's own floor and the coin stays; more than
 *   the cap stays as the coin it is;
 * - **a fixed swap of SOL** (SOL arrives unwrapped): the least SOL the positions bring is wrapped and swapped. It is
 *   sent only when every position that brings SOL has landed and the wallet holds at least what it held at the Review,
 *   that amount and the rent the package brings back, less the package's own network fees — so it never spends SOL the
 *   wallet held before (`service.ts`, the relay).
 *
 * Half and half: every other coin is swapped in two legs — half of what arrived into SOL, then the rest into USDC — and
 * SOL and USDC themselves are evened with one swap of half their difference, when a SOL price is known and the difference
 * is worth it.
 *
 * Pure: what the units bring in, the swaps out.
 */

import { NATIVE_SOL_MINT, USDC_MINT } from "../model.ts";
import type { ExitTarget } from "./model.ts";

/** A coin a step brings into the wallet: what is expected, and the least that can arrive — nothing, where no program holds a least. */
export type Bring = Readonly<{ mint: string; decimals: number; expectedRaw: bigint; minRaw: bigint }>;

export type SweepSpec = Readonly<{
  inMint: string;
  inDecimals: number;
  outMint: string;
  /** The share of what arrived that this swap takes, per cent (1–100); a fixed swap takes its own amount. */
  percent: number;
  /** What the route is quoted for, and its floor set for. */
  quoteRaw: bigint;
  /** The most this swap may take. */
  capRaw: bigint;
  /** What it is expected to swap. */
  expectedRaw: bigint;
  /** A fixed swap of SOL: the lamports wrapped for it; null — a sweep of what arrived. */
  wrapLamports: bigint | null;
  /** The units that bring this coin. */
  feeders: readonly number[];
  /** The sweep (its place in this list) that must land first; null — none. */
  after: number | null;
}>;

/** A sweep's route is quoted for this share of what is expected, basis points: a little less arriving still passes its floor. */
export const SWEEP_QUOTE_BPS = 9_900;
/** A sweep may take this much above what is expected, basis points: fees collected a moment later, a price that moved the person's way. */
export const SWEEP_CAP_MARGIN_BPS = 200;
/** Half and half: SOL and USDC are evened only when their difference is at least this share of both, and this many dollars. */
export const SPLIT_EVEN_MIN_BPS = 200;
export const SPLIT_EVEN_MIN_USD = 1;

const bps = (raw: bigint, of: number): bigint => (raw * BigInt(of)) / 10_000n;
const share = (raw: bigint, percent: number): bigint => (raw * BigInt(percent)) / 100n;

type Total = { decimals: number; expected: bigint; min: bigint; feeders: number[] };

/** Everything the units bring, by coin. */
export function bringsByMint(units: readonly (readonly Bring[])[]): Map<string, Total> {
  const totals = new Map<string, Total>();
  units.forEach((brings, unit) => {
    for (const bring of brings) {
      if (bring.expectedRaw <= 0n) continue;
      const total = totals.get(bring.mint) ?? { decimals: bring.decimals, expected: 0n, min: 0n, feeders: [] };
      total.expected += bring.expectedRaw;
      /* The least is never counted above what is expected. */
      total.min += bring.minRaw <= 0n ? 0n : bring.minRaw < bring.expectedRaw ? bring.minRaw : bring.expectedRaw;
      if (!total.feeders.includes(unit)) total.feeders.push(unit);
      totals.set(bring.mint, total);
    }
  });
  return totals;
}

/** A sweep of `part` — what this leg is expected to take of the coin. */
const sweep = (mint: string, total: Total, part: bigint, outMint: string, percent: number, after: number | null): SweepSpec => ({
  inMint: mint,
  inDecimals: total.decimals,
  outMint,
  percent,
  quoteRaw: bps(part, SWEEP_QUOTE_BPS),
  capRaw: bps(part, 10_000 + SWEEP_CAP_MARGIN_BPS),
  expectedRaw: part,
  wrapLamports: null,
  feeders: total.feeders,
  after,
});

const fixedSol = (total: Total, lamports: bigint): SweepSpec => ({
  inMint: NATIVE_SOL_MINT,
  inDecimals: 9,
  outMint: USDC_MINT,
  percent: 100,
  quoteRaw: lamports,
  capRaw: lamports,
  expectedRaw: lamports,
  wrapLamports: lamports,
  feeders: total.feeders,
  after: null,
});

/**
 * The swaps that turn what the left positions bring into the target. `units` — what each unit brings, in the units'
 * order; `solUsd` — the SOL price, for evening half and half (null — SOL and USDC stay as they came).
 */
export function sweepsOf(units: readonly (readonly Bring[])[], target: ExitTarget, solUsd: number | null): SweepSpec[] {
  const totals = bringsByMint(units);
  const out: SweepSpec[] = [];
  const push = (spec: SweepSpec): number | null => {
    if (spec.quoteRaw <= 0n) return null;
    out.push(spec);
    return out.length - 1;
  };
  for (const [mint, total] of totals) {
    if (mint === NATIVE_SOL_MINT || mint === USDC_MINT) continue;
    if (target === "SPLIT") {
      const half = share(total.expected, 50);
      const first = push(sweep(mint, total, half, NATIVE_SOL_MINT, 50, null));
      /* The second leg takes all that is left above the balance before: it stands on the first having landed. */
      if (first !== null) push(sweep(mint, total, total.expected - half, USDC_MINT, 100, first));
      else push(sweep(mint, total, total.expected, USDC_MINT, 100, null));
    } else push(sweep(mint, total, total.expected, target === "SOL" ? NATIVE_SOL_MINT : USDC_MINT, 100, null));
  }
  const sol = totals.get(NATIVE_SOL_MINT);
  const usdc = totals.get(USDC_MINT);
  if (target === "SOL" && usdc) push(sweep(USDC_MINT, usdc, usdc.expected, NATIVE_SOL_MINT, 100, null));
  if (target === "USDC" && sol) push(fixedSol(sol, sol.min));
  if (target === "SPLIT" && solUsd !== null && solUsd > 0) {
    const solWorth = sol ? (Number(sol.expected) / 1e9) * solUsd : 0;
    const usdcWorth = usdc ? Number(usdc.expected) / 1e6 : 0;
    const both = solWorth + usdcWorth;
    const apart = solWorth - usdcWorth;
    if (both > 0 && Math.abs(apart) >= SPLIT_EVEN_MIN_USD && Math.abs(apart) * 10_000 >= both * SPLIT_EVEN_MIN_BPS) {
      if (apart > 0 && sol) {
        /* Half the difference, taken from the least SOL that arrives. */
        const part = Math.min(10_000, Math.max(0, Math.floor(((apart / 2) / solWorth) * 10_000)));
        push(fixedSol(sol, bps(sol.min, part)));
      } else if (apart < 0 && usdc) {
        const percent = Math.min(100, Math.max(1, Math.round(((-apart / 2) / usdcWorth) * 100)));
        push(sweep(USDC_MINT, usdc, share(usdc.expected, percent), NATIVE_SOL_MINT, percent, null));
      }
    }
  }
  return out;
}
