/**
 * A DLMM Pro pool's liquidity by price as the one answer every concentrated pool gives (`lib/earn-pools/
 * bins.ts`): the steps of its tick spacing around the price, each with what the liquidity in range holds there, and
 * where the market prices the pair. Read from the chain through the surface's one door (`./venue.server.ts`), so it is
 * served only where the gate serves earning on DLMM Pro at all.
 *
 * Reads only. Null — no DLMM Pro pool at the address. A chain that does not answer throws, and the route says so: an
 * unread pool is never an empty one. What a new position's accounts cost is the Review's own to say here (`rent: null`).
 */

import { EARN_BINS_HALF, gapPctOf, marketPriceOf, stepBpsOfSpacing, type EarnBinsAnswer } from "../earn-pools/bins.ts";
import { jupiterUsd } from "../earn-pools/market-price.ts";
import type { EarnProNetwork } from "./gate.ts";
import type { PierDeps } from "./piers.server.ts";
import { DlmmProRefusal, earnProConnection, earnProVenue, type DlmmProSteps } from "./venue.server.ts";

const BINS_FRESH_MS = 20_000;
const BINS_KEPT = 64;
const READ_DEADLINE_MS = 15_000;
/** The last answer of each pool and width — null for an address with no pool, so a wrong one costs a read a while. */
const kept = new Map<string, Readonly<{ at: number; answer: EarnBinsAnswer | null }>>();
const inflight = new Map<string, Promise<EarnBinsAnswer | null>>();

export type ProBinsDeps = PierDeps & Readonly<{ market?: (mints: readonly string[]) => Promise<Readonly<Record<string, number>>> }>;

/** The venue's steps as the one answer; the market's price beside them where it was read. */
export function proBinsAnswer(steps: DlmmProSteps, usd: Readonly<Record<string, number>>, at: number): EarnBinsAnswer {
  const marketPrice = marketPriceOf(usd[steps.tokenX.mint] ?? null, usd[steps.tokenY.mint] ?? null);
  return {
    venue: "pro",
    pool: steps.pool,
    x: steps.tokenX,
    y: steps.tokenY,
    stepBps: stepBpsOfSpacing(steps.tickSpacing),
    activeId: steps.hereTickId,
    price: steps.price,
    bins: steps.steps.map((step) => ({ offset: step.offset, id: step.tickLowerId, price: step.price, x: step.xRaw, y: step.yRaw })),
    market: { price: marketPrice, gapPct: gapPctOf(steps.price, marketPrice) },
    rent: null,
    at: new Date(at).toISOString(),
  };
}

function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The chain did not answer within ${ms} ms.`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

async function readNow(network: EarnProNetwork, address: string, half: number, deps: ProBinsDeps, now: number): Promise<EarnBinsAnswer | null> {
  const venue = deps.venue ?? earnProVenue(network, deps.connection ?? earnProConnection(network), deps.env ?? process.env);
  let steps: DlmmProSteps;
  try {
    steps = await deadline(venue.bins.around(address, half), READ_DEADLINE_MS);
  } catch (error) {
    if (error instanceof DlmmProRefusal && (error.code === "NO_POOL" || error.code === "BAD_INPUT")) return null;
    throw error;
  }
  /* Jupiter prices mainnet's coins only; elsewhere, and when it does not answer, the bins stand without a market price. */
  const market = deps.market ?? (network === "mainnet" ? (mints: readonly string[]) => jupiterUsd(mints) : null);
  const usd = market ? await market([steps.tokenX.mint, steps.tokenY.mint]).catch(() => ({}) as Readonly<Record<string, number>>) : {};
  return proBinsAnswer(steps, usd, now);
}

/**
 * A pool's steps around its price on a network, kept twenty seconds; one read at a time per pool and width. Null — no
 * pool there. Throws where the chain did not answer in time.
 */
export function readProBins(network: EarnProNetwork, address: string, half: number = EARN_BINS_HALF, deps: ProBinsDeps = {}): Promise<EarnBinsAnswer | null> {
  const now = deps.now?.() ?? Date.now();
  /* A read a test or a rehearsal hands its own chain to is never kept, nor shared. */
  const own = Boolean(deps.fresh || deps.connection);
  if (own) return readNow(network, address, half, deps, now);
  const cacheKey = `${network}:${address}:${half}`;
  const cached = kept.get(cacheKey);
  if (cached && now - cached.at < BINS_FRESH_MS) return Promise.resolve(cached.answer);
  const pending = inflight.get(cacheKey);
  if (pending) return pending;
  const read = readNow(network, address, half, deps, now)
    .then((answer) => {
      if (kept.size >= BINS_KEPT) kept.delete(kept.keys().next().value!);
      kept.set(cacheKey, { at: now, answer });
      return answer;
    })
    .finally(() => {
      inflight.delete(cacheKey);
    });
  inflight.set(cacheKey, read);
  return read;
}
