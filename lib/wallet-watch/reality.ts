/**
 * «Реальність послідовника» (SOL-R3, порада ззовні 18.10) — the pure half: what a person copying a wallet would
 * have kept of its result, after the delay of their entry, the pool's depth, the network's and Ryntra's fees, the
 * transactions that do not land the first time and the price slipping while one lands — not «the wallet made 400 %».
 *
 * The leader's own trades are the ones «Стеження за гаманцями» (SOL-R4) reads from the chain (`trades.ts`); the price
 * between them is a pool's own bars (GeckoTerminal OHLCV, `paths.server.ts`), so a delay is priced by what the market
 * actually did in those seconds — a ratio of the pool's price then to its price at the leader's trade, applied to the
 * leader's own fill. Everything else is a stated assumption (`COPY_ASSUMPTIONS`), printed under the figure:
 *
 * - **delay** — the follower sends `delaySeconds` after the leader's trade, at the price the pool had then — counted
 *   only against the follower (a buy dearer, a sale cheaper): a bar that moved its way is luck, not the copy's edge;
 * - **liquidity** — the follower's own size moves a constant-product pool: an average price `× (1 + size / depth)` on
 *   a buy, `÷` on a sale. The depth at a trade's moment is half the token's liquidity now (Jupiter's), scaled as such a
 *   pool's is by the square root of the price then over the price now — a sale at the top met a deeper pool than the
 *   one drained since. Liquidity never makes a miss — a pool drained since (a rug) would otherwise turn the wallet's loss
 *   into the follower's escape — and its impact is charged whole, never held at the tolerance: a thinner pool never
 *   makes the figure better. A swap whose impact passes the tolerance would revert as sent; the token is counted as if
 *   sent wider, and said. (A tighter tolerance can miss a losing buy through the price's own move — that is real, and
 *   cuts both ways);
 * - **slippage** — while a transaction lands (`landSeconds`) the price moves like the bar it lands in, scaled to those
 *   seconds; the fill is half that move worse, and a move past the tolerance fails the attempt, retried after
 *   `retrySeconds`, up to `maxAttempts`, each failed attempt paying the network's fee;
 * - **fees** — Ryntra's fee by fee policy v2 (memes 1 %, majors 0.1 %) on what is swapped, the network's base fee and
 *   a priority fee on every attempt;
 * - **failed transactions** — beyond slippage, one in `failRate` does not land the first time: on average its delay
 *   grows by `failRate × retrySeconds` and its fees by `failRate` of one attempt.
 *
 * A token the pool's bars do not cover is «not measured», never guessed — its trades leave both sides of the
 * comparison, and what the wallet put into such tokens is said beside the figure. A token with no price now (dead,
 * mostly) stays in: what is held of it counts at zero, and the figure says so. The follower buys `sizeSol` on each of the leader's buys and sells the same share of its holding as the
 * leader sold of its own. Open holdings, the leader's and the follower's alike, are marked at the price now.
 *
 * Pure and client-safe: no clock, no network.
 */

import { FEE_POLICY_V2, MAJOR_MINTS } from "../core/fee-policy.ts";
import type { WalletTrade } from "./trades.ts";

/** A bar of a pool's price in dollars: start (unix seconds), open, high, low, close. Oldest first. */
export type PathBar = readonly [t: number, open: number, high: number, low: number, close: number];

export type PricePath = Readonly<{
  /** The bars' width, seconds — 60 for minute bars. */
  barSeconds: number;
  bars: readonly PathBar[];
  /** The pool the bars are of, and its venue — said under the figure. */
  pool: string | null;
  dex: string | null;
  /** When the bars were read, unix seconds: a trade whose follower's seconds came after it waits for the next read. */
  readAt?: number;
}>;

/** What is known of each token now: its price and its liquidity, dollars (Jupiter). */
export type TokenNow = Readonly<{ priceUsd: number | null; liquidityUsd: number | null }>;

export type CopySettings = Readonly<{
  /** SOL the follower puts into each of the leader's buys. */
  sizeSol: number;
  /** Seconds between the leader's trade and the follower's send. */
  delaySeconds: number;
  /** The tolerance a swap is sent with, percent. */
  slippagePct: number;
}>;

export const COPY_SIZES = [0.1, 0.5, 1, 5] as const;
export const COPY_DELAYS = [5, 30, 120] as const;
export const COPY_SLIPPAGES = [1, 5, 15] as const;
export const DEFAULT_COPY_SETTINGS: CopySettings = { sizeSol: 0.5, delaySeconds: 30, slippagePct: 5 };

/** The figures not read from anywhere — said on the page next to the result they shape. */
export const COPY_ASSUMPTIONS = Object.freeze({
  /** The network's base fee per signature, SOL. */
  networkFeeSol: 0.000005,
  /** A priority fee a meme swap needs to land, SOL per attempt. */
  priorityFeeSol: 0.0001,
  /** The share of transactions that do not land the first time, beyond slippage. */
  failRate: 0.1,
  /** Seconds before a failed transaction is sent again. */
  retrySeconds: 15,
  /** Seconds a transaction takes to land. */
  landSeconds: 2,
  /** Attempts before a trade is given up. */
  maxAttempts: 3,
});

/** Ryntra's fee on a swap of this token, bps — fee policy v2: a major's, else a meme's (the upper bound for a newer token). */
export function ryntraFeeBps(mint: string): number {
  return MAJOR_MINTS.has(mint) ? FEE_POLICY_V2.MAJOR.bps : FEE_POLICY_V2.MEME.bps;
}

/* ------------------------------------------------------------- the path */

/** Bars after a gap this long say nothing of the price inside it. */
const MAX_GAP_SECONDS = 6 * 3_600;

function barAt(path: PricePath, t: number): { bar: PathBar; inside: boolean } | null {
  const bars = path.bars;
  if (bars.length === 0 || t < bars[0]![0]) return null;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid]![0] <= t) lo = mid;
    else hi = mid - 1;
  }
  const bar = bars[lo]!;
  const inside = t < bar[0] + path.barSeconds;
  /* No bar for a stretch: nobody traded the pool — its last close stands, for a while. */
  if (!inside && t - (bar[0] + path.barSeconds) > MAX_GAP_SECONDS) return null;
  /* Past the last bar: quiet until the bars were read, the last close stands; beyond the read, the path does not reach. */
  if (!inside && lo === bars.length - 1 && (path.readAt === undefined ? t - (bar[0] + path.barSeconds) > path.barSeconds : t > path.readAt)) return null;
  return { bar, inside };
}

/** The pool's price at a moment, dollars: within a bar from its open to its close in proportion; in a quiet gap, the last close. */
export function priceAt(path: PricePath, t: number): number | null {
  const found = barAt(path, t);
  if (!found) return null;
  const [start, open, , , close] = found.bar;
  if (!found.inside) return close;
  const share = Math.min(1, Math.max(0, (t - start) / path.barSeconds));
  return open + (close - open) * share;
}

/** How far the price ranged in the bar at that moment, as a share of its open; a quiet gap — 0. */
export function rangeAt(path: PricePath, t: number): number {
  const found = barAt(path, t);
  if (!found || !found.inside) return 0;
  const [, open, high, low] = found.bar;
  return open > 0 ? Math.max(0, (high - low) / open) : 0;
}

/** Seconds GeckoTerminal may lag behind the chain: a trade this close to the read waits for the next one. */
export const INDEX_LAG_S = 120;
/** How far after a leg the follower's latest attempt can reach at any setting, seconds. */
export const REACH_S = Math.max(...COPY_DELAYS) + COPY_ASSUMPTIONS.retrySeconds * (COPY_ASSUMPTIONS.maxAttempts + 1);

/** Whether the path has a price at every moment from `from` to `to` (every five seconds) — a gap inside is no path. */
export function covered(path: PricePath, from: number, to: number): boolean {
  for (let t = from; t < to; t += 5) if (priceAt(path, t) === null) return false;
  return priceAt(path, to) !== null;
}

/* --------------------------------------------------------- the replay */

/** Which of the losses a run counts — each step of the breakdown turns one more on. */
type Frictions = Readonly<{ delay: boolean; liquidity: boolean; slippage: boolean; fees: boolean; failures: boolean }>;

const NONE: Frictions = { delay: false, liquidity: false, slippage: false, fees: false, failures: false };
export const REALITY_STEPS = ["delay", "liquidity", "slippage", "fees", "failures"] as const;
export type RealityStep = (typeof REALITY_STEPS)[number];

type Leg = Readonly<{ side: "buy" | "sell"; at: number; tokens: number; sol: number; key: string }>;

type SideResult = { spentSol: number; resultSol: number };
type FollowerRun = SideResult & { copiedBuys: number; missedSlippage: number; stuckSales: number; capped: number };

/** A trade's quote in SOL: SOL as it is, dollars at SOL's price now; null without a price. */
function legSol(trade: WalletTrade, solUsd: number | null): number | null {
  if (trade.quote === null || trade.quoteAmount === null) return null;
  if (trade.quote === "SOL") return trade.quoteAmount;
  return solUsd && solUsd > 0 ? trade.quoteAmount / solUsd : null;
}

/** The leader on these legs: what it put in, what came back of what it bought here, what it still holds at the price now. */
function leaderRun(legs: readonly Leg[], priceNowSol: number): SideResult & { positionsBefore: number[] } {
  let open = 0;
  let spent = 0;
  let cashIn = 0;
  const positionsBefore: number[] = [];
  for (const leg of legs) {
    positionsBefore.push(open);
    if (leg.side === "buy") {
      open += leg.tokens;
      spent += leg.sol;
      continue;
    }
    /* Units sold that were bought before the read have no cost: left out, on both sides. */
    const covered = Math.min(leg.tokens, open);
    if (covered <= 0) continue;
    cashIn += leg.sol * (covered / leg.tokens);
    open -= covered;
  }
  return { spentSol: spent, resultSol: cashIn + (open > 1e-12 ? open * priceNowSol : 0) - spent, positionsBefore };
}

/**
 * One attempt-by-attempt landing of a follower's swap: the moment it lands and its slippage, or null when every
 * attempt failed. `impact` — the follower's own move of the pool, a share.
 */
function land(path: PricePath, sendAt: number, impact: number, settings: CopySettings, on: Frictions): { at: number; slip: number; attempts: number } | null {
  const tolerance = settings.slippagePct / 100;
  for (let attempt = 0; attempt < (on.slippage ? COPY_ASSUMPTIONS.maxAttempts : 1); attempt += 1) {
    const at = sendAt + attempt * COPY_ASSUMPTIONS.retrySeconds;
    /* The price's move while it lands: the bar's range, scaled to the landing's seconds as a random walk is. */
    const move = on.slippage ? rangeAt(path, at) * Math.sqrt(COPY_ASSUMPTIONS.landSeconds / path.barSeconds) : 0;
    if (impact + move <= tolerance || !on.slippage) return { at, slip: move / 2, attempts: attempt + 1 };
  }
  return null;
}

function followerRun(legs: readonly Leg[], positionsBefore: readonly number[], path: PricePath, now: TokenNow, mint: string, solUsd: number, priceNowSol: number, settings: CopySettings, on: Frictions): FollowerRun {
  const depthNowSol = now.liquidityUsd !== null && now.liquidityUsd > 0 ? now.liquidityUsd / 2 / solUsd : null;
  /* The pool's depth at a moment: today's, by the square root of the price then over the price now; unknown without both. */
  const depthAt = (t: number) => {
    const then = priceAt(path, t);
    return depthNowSol === null || now.priceUsd === null || !(now.priceUsd > 0) || then === null ? null : depthNowSol * Math.sqrt(then / now.priceUsd);
  };
  const feeShare = on.fees ? ryntraFeeBps(mint) / 10_000 : 0;
  const perAttempt = on.fees ? COPY_ASSUMPTIONS.networkFeeSol + COPY_ASSUMPTIONS.priorityFeeSol : 0;
  const failExtra = on.failures ? COPY_ASSUMPTIONS.failRate : 0;
  const tolerance = settings.slippagePct / 100;
  const out: FollowerRun = { spentSol: 0, resultSol: 0, copiedBuys: 0, missedSlippage: 0, stuckSales: 0, capped: 0 };
  /* The follower's move of the pool, a share, charged whole. Past the tolerance it is said (`capped`) and the landing is
     judged by the price's move alone: today's depth scaled back is an estimate, and an estimate never makes a miss. */
  const impactOf = (sizeSol: number, t: number, buy = true): { share: number; capped: boolean } => {
    if (!on.liquidity) return { share: 0, capped: false };
    const depth = depthAt(t);
    if (depth === null || !(depth > 0)) return { share: 0, capped: false };
    const share = sizeSol / depth;
    /* Said for the follower's buys — the size a person picks; a sale's value is the market's. */
    if (buy && share > tolerance) out.capped += 1;
    return { share, capped: share > tolerance };
  };
  /* What went in (sizes, fees, failed attempts), what came back, and what is still held — the result is their sum. */
  let held = 0;
  let cashIn = 0;
  /* The holding in lots, each with a ceiling per token: a sale that did not land leaves its tokens held — sold with the
     rest by the leader's next sales, or marked at the price now — but never worth more than that sale would have netted. */
  let lots: { tokens: number; cap: number }[] = [];
  /* A share of every lot leaves (sold, or now capped): what it takes, and the lots left. */
  const takeShare = (fraction: number) => {
    const taken = lots.map((lot) => ({ tokens: lot.tokens * fraction, cap: lot.cap }));
    lots = lots.map((lot) => ({ tokens: lot.tokens * (1 - fraction), cap: lot.cap })).filter((lot) => lot.tokens > 1e-12);
    return taken;
  };
  legs.forEach((leg, index) => {
    const base = priceAt(path, leg.at)!;
    const sendAt = leg.at + (on.delay ? settings.delaySeconds : 0) + failExtra * COPY_ASSUMPTIONS.retrySeconds;
    const moved = on.delay || on.failures || on.slippage;
    /* Only a move against the follower counts: a buy's price up, a sale's down. A minute's bar that went its way is
       luck, not a copy's edge — and a bar's line drawn through the leader's own jump would make it one. */
    const fillAt = (at: number) => {
      /* Every moment probed was checked to have a price (`covered`); a gap would be no move, never a fill at zero. */
      const ratio = moved ? (priceAt(path, at) ?? base) / base : 1;
      return (leg.sol / leg.tokens) * (leg.side === "buy" ? Math.max(1, ratio) : Math.min(1, ratio));
    };
    /* A retry that lands after the price bounced back is no gain either: the fill is the worst of every moment tried —
       from the send without a failed first try, through each attempt up to the one that landed. */
    const plainAt = leg.at + (on.delay ? settings.delaySeconds : 0);
    const worstUntil = (at: number) => {
      const moments = [plainAt];
      for (let t = sendAt; t <= at + 1e-9; t += COPY_ASSUMPTIONS.retrySeconds) moments.push(t);
      const fills = moments.map(fillAt);
      return leg.side === "buy" ? Math.max(...fills) : Math.min(...fills);
    };
    if (leg.side === "buy") {
      const impact = impactOf(settings.sizeSol, sendAt).share;
      /* Landing is judged by the price's move alone: the pool's depth is an estimate, and an estimate never makes a miss. */
      const landed = land(path, sendAt, 0, settings, on);
      if (!landed) {
        out.missedSlippage += 1;
        out.spentSol += perAttempt * COPY_ASSUMPTIONS.maxAttempts;
        return;
      }
      const price = worstUntil(landed.at) * (1 + impact) * (1 + landed.slip);
      const bought = (settings.sizeSol * (1 - feeShare)) / price;
      held += bought;
      lots.push({ tokens: bought, cap: Number.POSITIVE_INFINITY });
      out.spentSol += settings.sizeSol + perAttempt * (landed.attempts + failExtra);
      out.copiedBuys += 1;
      return;
    }
    if (held <= 0) return;
    /* The leader's share of its own position sold; a sale of more than it bought here — all of it. */
    const before = positionsBefore[index] ?? 0;
    const share = before > 0 ? Math.min(1, leg.tokens / before) : 1;
    const fraction = share >= 1 - 1e-9 ? 1 : share;
    const amount = held * fraction;
    /* A seller widens the tolerance to the pool's depth: only the price's move while it lands fails a sale. */
    const landed = land(path, sendAt, 0, settings, on);
    if (!landed) {
      /* A sale that does not land is still held, with what the attempts cost — worth the price now, but never more than
         the sale would have netted at its last attempt (its impact, its slippage, Ryntra's fee): a price that rose since
         is luck, not the copy's, and failing to sell is never worth more than selling. */
      out.stuckSales += 1;
      out.spentSol += perAttempt * COPY_ASSUMPTIONS.maxAttempts;
      const lastAt = sendAt + (COPY_ASSUMPTIONS.maxAttempts - 1) * COPY_ASSUMPTIONS.retrySeconds;
      const would = amount * worstUntil(lastAt);
      const slip = on.slippage ? (rangeAt(path, lastAt) * Math.sqrt(COPY_ASSUMPTIONS.landSeconds / path.barSeconds)) / 2 : 0;
      const netted = (would / (1 + impactOf(would, lastAt, false).share)) * (1 - slip) * (1 - feeShare);
      /* Still held: the same share of every lot, now with this sale's ceiling. */
      const perToken = netted / amount;
      for (const lot of takeShare(fraction)) lots.push({ tokens: lot.tokens, cap: Math.min(lot.cap, perToken) });
      return;
    }
    const valueSol = amount * worstUntil(landed.at);
    const impact = impactOf(valueSol, landed.at, false).share;
    const netted = (valueSol / (1 + impact)) * (1 - landed.slip) * (1 - feeShare);
    /* Each lot sold at this sale's net per token, a capped one no higher than its ceiling. */
    const perToken = netted / amount;
    cashIn += takeShare(fraction).reduce((sum, lot) => sum + lot.tokens * Math.min(perToken, lot.cap), 0) - perAttempt * (landed.attempts + failExtra);
    held -= amount;
  });
  out.resultSol = cashIn + lots.reduce((sum, lot) => sum + lot.tokens * Math.min(priceNowSol, lot.cap), 0) - out.spentSol;
  return out;
}

/* ------------------------------------------------------------ the view */

export type UnmeasuredReason = "NO_PATH" | "NO_PRICE_NOW" | "NOT_PRICED" | "BOUGHT_BEFORE" | "NOT_READ" | "BEYOND_FOUR" | "TOO_FRESH";

export type TokenReality = Readonly<{
  mint: string;
  leader: Readonly<{ spentSol: number; resultSol: number; pct: number | null }>;
  follower: Readonly<{ spentSol: number; resultSol: number; pct: number | null; copiedBuys: number; buys: number; missedSlippage: number; stuckSales: number }>;
  liquidityKnown: boolean;
  /** No price now: what is held of it counts at zero. */
  noPriceNow: boolean;
  /** The follower's size would move its pool past the tolerance at some trade: counted at its full impact, said. */
  capped: boolean;
}>;

export type FollowerReality = Readonly<{
  settings: CopySettings;
  /** The leader on the measured tokens' trades: what it put in and what it made, at the price now. */
  leader: Readonly<{ spentSol: number; resultSol: number; pct: number | null }>;
  /** The same trades at the follower's size, with nothing lost — where the breakdown starts. */
  ideal: Readonly<{ spentSol: number; resultSol: number; pct: number | null }>;
  /** What the follower would have kept. */
  follower: Readonly<{ spentSol: number; resultSol: number; pct: number | null }>;
  /** What each loss took, SOL, in the breakdown's order (negative — a loss). */
  steps: Readonly<Record<RealityStep, number>>;
  tokens: readonly TokenReality[];
  buys: number;
  copiedBuys: number;
  missedSlippage: number;
  stuckSales: number;
  unmeasured: readonly Readonly<{ mint: string; reason: UnmeasuredReason }>[];
  /** Tokens whose liquidity now is not known: their size moved nothing. */
  liquidityUnknown: number;
  /** Tokens with no price now, held at zero. */
  noPriceNow: number;
  /** Tokens whose pool is thin for the size: as sent at the tolerance the swap would fail — counted at its full impact. */
  capped: number;
  /** What the wallet put into the tokens left out, SOL, and how many — said beside the figure. */
  leftOut: Readonly<{ tokens: number; buySol: number }>;
  /** A dollar leg was turned into SOL at SOL's price now. */
  approx: boolean;
  /** Trades too recent for the follower's seconds to have passed: left out of both sides until they have. */
  fresh: number;
}>;

export type RealityInput = Readonly<{
  trades: readonly WalletTrade[];
  paths: ReadonlyMap<string, PricePath>;
  now: ReadonlyMap<string, TokenNow>;
  solUsd: number | null;
  /** Tokens the server could not measure, and why — kept as said. */
  unmeasured?: readonly Readonly<{ mint: string; reason: UnmeasuredReason }>[];
  /** When the bars were read, unix seconds: a trade whose follower's seconds came after it is measured next time. */
  asOf?: number;
}>;

const pct = (result: number, spent: number) => (spent > 0 ? (result / spent) * 100 : null);

/**
 * The follower's reality on a wallet's trades: per token and in all, and what each loss took — delay, liquidity,
 * slippage, fees, failed transactions, each turned on in turn over the same trades.
 */
export function followerReality(input: RealityInput, settings: CopySettings = DEFAULT_COPY_SETTINGS): FollowerReality {
  const unmeasured = [...(input.unmeasured ?? [])];
  const said = new Set(unmeasured.map((row) => row.mint));
  const solUsd = input.solUsd && input.solUsd > 0 ? input.solUsd : null;
  const byMint = new Map<string, WalletTrade[]>();
  /* Tokens another wallet paid for, and token-for-token legs, have no price: nothing to copy at a known cost. */
  for (const trade of [...input.trades].sort((a, b) => a.slot - b.slot)) byMint.set(trade.mint, [...(byMint.get(trade.mint) ?? []), trade]);
  let approx = false;
  let fresh = 0;
  const latest = settings.delaySeconds + COPY_ASSUMPTIONS.retrySeconds * COPY_ASSUMPTIONS.maxAttempts;
  const measured: { mint: string; legs: Leg[]; path: PricePath; now: TokenNow; priceNowSol: number }[] = [];
  for (const [mint, list] of byMint) {
    if (said.has(mint)) continue;
    const path = input.paths.get(mint);
    const asOf = path?.readAt ?? input.asOf;
    const legs: Leg[] = [];
    const freshBefore = fresh;
    let dollars = false;
    for (const trade of list) {
      const sol = legSol(trade, solUsd);
      if (sol === null || trade.at === null || trade.paidBy !== null) continue;
      const tokens = Number(trade.tokensRaw) / 10 ** trade.decimals;
      if (!(tokens > 0) || !(sol > 0)) continue;
      if (asOf !== undefined && trade.at + latest + INDEX_LAG_S > asOf) {
        fresh += 1;
        continue;
      }
      dollars ||= trade.quote !== "SOL";
      legs.push({ side: trade.side, at: trade.at, tokens, sol, key: `${trade.signature}:${trade.side}` });
    }
    if (!legs.some((leg) => leg.side === "buy")) {
      unmeasured.push({ mint, reason: fresh > freshBefore ? "TOO_FRESH" : legs.length > 0 ? "BOUGHT_BEFORE" : "NOT_PRICED" });
      continue;
    }
    /* No bars because every buy is newer than the server reads for: measured next time, not «no history». */
    if (!path && input.asOf !== undefined && legs.filter((leg) => leg.side === "buy").every((leg) => leg.at > input.asOf! - REACH_S - INDEX_LAG_S)) {
      unmeasured.push({ mint, reason: "TOO_FRESH" });
      continue;
    }
    /* Every leg needs the pool's price at its moment and at every moment of the follower's attempts after it. */
    if (!path || !legs.every((leg) => covered(path, leg.at, leg.at + latest + COPY_ASSUMPTIONS.retrySeconds))) {
      unmeasured.push({ mint, reason: "NO_PATH" });
      continue;
    }
    const now = input.now.get(mint) ?? { priceUsd: null, liquidityUsd: null };
    /* Without SOL's price nothing is in SOL; a token without a price now (dead, mostly) stays in — its holdings at zero. */
    if (solUsd === null) {
      unmeasured.push({ mint, reason: "NO_PRICE_NOW" });
      continue;
    }
    const priceNowSol = now.priceUsd !== null && now.priceUsd > 0 ? now.priceUsd / solUsd : 0;
    approx ||= dollars;
    measured.push({ mint, legs, path, now, priceNowSol });
  }

  const runs = (on: Frictions) =>
    measured.map(({ mint, legs, path, now, priceNowSol }) => {
      const leader = leaderRun(legs, priceNowSol);
      return { mint, leader, follower: followerRun(legs, leader.positionsBefore, path, now, mint, solUsd!, priceNowSol, settings, on) };
    });
  const total = (rows: ReturnType<typeof runs>) => rows.reduce((sum, row) => ({ spentSol: sum.spentSol + row.follower.spentSol, resultSol: sum.resultSol + row.follower.resultSol }), { spentSol: 0, resultSol: 0 });

  /* The breakdown: the same trades, one more loss on at each step. */
  let on: Frictions = NONE;
  const ideal = runs(on);
  let previous = total(ideal).resultSol;
  const steps = {} as Record<RealityStep, number>;
  let last = ideal;
  for (const step of REALITY_STEPS) {
    on = { ...on, [step]: true };
    last = runs(on);
    const result = total(last).resultSol;
    steps[step] = result - previous;
    previous = result;
  }
  const leaderTotal = ideal.reduce((sum, row) => ({ spentSol: sum.spentSol + row.leader.spentSol, resultSol: sum.resultSol + row.leader.resultSol }), { spentSol: 0, resultSol: 0 });
  const idealTotal = total(ideal);
  const followerTotal = total(last);
  const tokens: TokenReality[] = last.map((row) => {
    const legs = measured.find((entry) => entry.mint === row.mint)!;
    return {
      mint: row.mint,
      leader: { spentSol: row.leader.spentSol, resultSol: row.leader.resultSol, pct: pct(row.leader.resultSol, row.leader.spentSol) },
      follower: {
        spentSol: row.follower.spentSol,
        resultSol: row.follower.resultSol,
        pct: row.follower.copiedBuys > 0 ? pct(row.follower.resultSol, row.follower.spentSol) : null,
        copiedBuys: row.follower.copiedBuys,
        buys: legs.legs.filter((leg) => leg.side === "buy").length,
        missedSlippage: row.follower.missedSlippage,
        stuckSales: row.follower.stuckSales,
      },
      liquidityKnown: legs.now.liquidityUsd !== null && legs.now.liquidityUsd > 0 && legs.priceNowSol > 0,
      noPriceNow: !(legs.priceNowSol > 0),
      capped: row.follower.capped > 0,
    };
  });
  const count = (pick: (row: TokenReality) => number) => tokens.reduce((sum, row) => sum + pick(row), 0);
  return {
    settings,
    leader: { ...leaderTotal, pct: pct(leaderTotal.resultSol, leaderTotal.spentSol) },
    ideal: { ...idealTotal, pct: pct(idealTotal.resultSol, idealTotal.spentSol) },
    /* No buy copied: a percent of the failed attempts' fees («−100 %») says nothing — the misses say it. */
    follower: { ...followerTotal, pct: tokens.some((row) => row.follower.copiedBuys > 0) ? pct(followerTotal.resultSol, followerTotal.spentSol) : null },
    steps,
    tokens,
    buys: count((row) => row.follower.buys),
    copiedBuys: count((row) => row.follower.copiedBuys),
    missedSlippage: count((row) => row.follower.missedSlippage),
    stuckSales: count((row) => row.follower.stuckSales),
    unmeasured,
    liquidityUnknown: tokens.filter((row) => !row.liquidityKnown).length,
    noPriceNow: tokens.filter((row) => row.noPriceNow).length,
    capped: tokens.filter((row) => row.capped).length,
    leftOut: {
      tokens: unmeasured.length,
      buySol: input.trades.filter((trade) => trade.side === "buy" && unmeasured.some((row) => row.mint === trade.mint)).reduce((sum, trade) => sum + (legSol(trade, solUsd) ?? 0), 0),
    },
    approx,
    fresh,
  };
}
