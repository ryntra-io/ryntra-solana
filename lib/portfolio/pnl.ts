/**
 * «Портфель» — прибуток і збиток: the wallet's own result by the honest standard (DSC-2,
 * `lib/core/pnl/honest.ts`) — fees counted, what is locked in apart from what is still held, 7 · 30 · 90 days, each
 * coin's entry price, and the days in the plus and in the minus for a calendar.
 *
 * What it counts from: the wallet's own transactions on Solana as «Стеження за гаманцями» reads them
 * (`lib/wallet-watch`, SOL-R4) — every swap against SOL, USDC or USDT on any venue, in Ryntra and outside it — in SOL,
 * with the network's fee of each transaction; what is held valued at the price it would leave at now (the pool's depth
 * against the sale, Ryntra's fee and the network's on the way out). The legs and marks are those of `walletHonest`
 * (`lib/wallet-watch/honest.ts`), so the wallet's page and the Portfolio say one result; a test keeps them equal.
 *
 * What it does not know is said, never a silent zero (`coverage.gaps`):
 * - `older` — the read reaches back only to its oldest transaction (`coverage.since`): a period or a day that starts
 *   before it is not known — its result is null, the known part said beside;
 * - `skipped` — transactions came faster than the read and some were never read: no period is known;
 * - `transfers` — coins that came without a buy read (a transfer in, or bought before the read) or left without a sale:
 *   no result is made of them, and a coin's entry price is not said;
 * - `unpriced` — a swap of one token for another, or tokens another wallet paid for: no price, a part not known;
 * - `unquoted` — a coin held that nobody quotes now, or whose pool's depth is not known: its open result is not known.
 * Deposits and withdrawals of SOL are no trades: they move no result.
 *
 * Pure and client-safe: no clock unless given, no network. Amounts are SOL.
 */

import {
  DAY_S,
  ESTIMATED_NETWORK_FEE_SOL,
  honestPnl,
  honestPnlWindow,
  PNL_PERIOD_DAYS,
  type ExitMark,
  type HonestPnlInput,
  type HonestPnlWindow,
  type PnlLeg,
  type PnlPeriodDays,
  type PnlVerdict,
} from "../core/pnl/honest.ts";
import { ryntraFeeBps } from "../wallet-watch/reality.ts";
import { USDC_MINT, USDT_MINT, WRAPPED_SOL, type WalletTrade } from "../wallet-watch/trades.ts";

export const PORTFOLIO_PNL_STANDARD = "ryntra.portfolio-pnl/1" as const;
/** The calendar's reach: the longest period. */
export const PNL_CALENDAR_DAYS = 90;
export { PNL_PERIOD_DAYS, type PnlPeriodDays };
const EPS = 1e-12;
/** Money, not a coin with a result of its own: the unit and the dollar coins. */
const MONEY: ReadonlySet<string> = new Set([WRAPPED_SOL, USDC_MINT, USDT_MINT]);

/** What is known of a coin now: its price and its liquidity in dollars (Jupiter), and how it is called. */
export type PnlMarket = Readonly<{ priceUsd: number | null; liquidityUsd: number | null; symbol?: string | null; name?: string | null; icon?: string | null }>;

/** The wallet's trades as the chain read keeps them, and how far that read reaches. */
export type PnlRead = Readonly<{
  /** Any order; newest first as kept. */
  trades: readonly WalletTrade[];
  /** What the wallet holds by mint, whole coins; null for a mint traded since the accounts were read. Null — not read. */
  held: ReadonlyMap<string, number | null> | null;
  /** The oldest transaction read, unix seconds. */
  oldestAt: number | null;
  /** The read reached the wallet's very first transaction. */
  complete: boolean;
  /** Some transactions between two reads were never listed. */
  gap: boolean;
  /** Transactions listed but never read (a burst faster than the read). */
  skipped: number;
}>;

export type PnlGap = "older" | "skipped" | "transfers" | "unpriced" | "unquoted";
export const PNL_GAPS: readonly PnlGap[] = ["older", "skipped", "transfers", "unpriced", "unquoted"];

/** A window's figures: the result only when it is known, the parts beside it. */
export type PnlFigures = Readonly<{
  /** The result after fees — null when not enough is known or the window reaches before the read. */
  result: number | null;
  /** Locked in: what sales brought against the average cost of what they closed. */
  realized: number | null;
  /** Still held, at the price it would leave at now, less its cost. */
  unrealized: number | null;
  /** The known parts — said beside a result that is not known, never as it. */
  known: number | null;
  /** Fees paid in the window, already inside the result. */
  fees: number;
  /** The result as a share of the capital at work, per cent. */
  pct: number | null;
  /** The share of the turnover whose result is known; null with nothing traded. */
  completenessPct: number | null;
  verdict: PnlVerdict;
  /** The read covers the whole window. */
  covered: boolean;
  trades: number;
}>;

export type PnlPeriod = PnlFigures & Readonly<{ days: PnlPeriodDays }>;

export type PnlCoin = Readonly<{
  mint: string;
  symbol: string | null;
  name: string | null;
  icon: string | null;
  /** What is held now, whole coins; 0 — all of it sold. */
  held: number;
  /** The average price paid per coin, its buy fees inside, SOL: of what is held; of every priced buy once all is sold. */
  entry: number | null;
  /** Its price now, SOL per coin; null — nobody quotes it. */
  now: number | null;
  /** What is held, as it would leave now (the pool's depth and the exit's fees against it), SOL. */
  value: number | null;
  realized: number | null;
  unrealized: number | null;
  result: number | null;
  pct: number | null;
  completenessPct: number | null;
  verdict: PnlVerdict;
  /** Part of what is held came without a buy read — a transfer in, or bought before the read. */
  arrived: boolean;
  /** Part of what was bought left without a sale — sent away. */
  sent: boolean;
}>;

/** One calendar day, UTC: `UNREAD` — the read does not reach it, nothing is said of it. */
export type PnlDayVerdict = PnlVerdict | "UNREAD";
export type PnlDay = Readonly<{ day: string; from: number; result: number | null; verdict: PnlDayVerdict; trades: number }>;

export type PnlCoverage = Readonly<{
  /** The wallet's own transactions on Solana, any venue. */
  source: "chain";
  /** The oldest transaction read; null when the read reached the wallet's first one. */
  since: number | null;
  gaps: readonly PnlGap[];
  /** Coins held now with no trade read (the unit and the dollar coins aside): no result is made of them. */
  untraded: number;
  /** A dollar leg was turned into SOL at SOL's price now. */
  approx: boolean;
  /** Some trades were read before fees were kept: their network fee is the standard's estimate. */
  feesEstimated: boolean;
}>;

export type PortfolioPnl = Readonly<{
  standard: typeof PORTFOLIO_PNL_STANDARD;
  unit: "SOL";
  asOf: number;
  /** SOL's price now, dollars — for the «≈ $» beside a result; null — not read. */
  solUsd: number | null;
  whole: PnlFigures;
  periods: Readonly<Record<PnlPeriodDays, PnlPeriod>>;
  /** Held coins first, by what they would bring; then the coins all sold, by their result. */
  coins: readonly PnlCoin[];
  /** Oldest first, `PNL_CALENDAR_DAYS` of them, the last one today. */
  days: readonly PnlDay[];
  coverage: PnlCoverage;
}>;

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/* ------------------------------------------------------------- the input */

/**
 * What the wallet holds now by mint, as the wallet's page reads it: a mint traded after the accounts were last read is
 * not known to be held or not — null, never a cap at 0.
 */
export function heldNow(held: Readonly<Record<string, number>> | null, heldAt: string | null, trades: readonly WalletTrade[]): Map<string, number | null> | null {
  if (!held) return null;
  const at = heldAt ? Date.parse(heldAt) / 1000 : Number.NaN;
  const after = new Set(trades.filter((trade) => !Number.isFinite(at) || trade.at === null || trade.at > at).map((trade) => trade.mint));
  return new Map<string, number | null>([...Object.entries(held), ...[...after].map((mint) => [mint, null] as const)]);
}

/**
 * The standard's input from the wallet's trades — the legs and marks of `walletHonest`: a dollar leg in SOL at SOL's
 * price now (`approx`), a trade without its fee on record at the standard's estimate (`feesEstimated`), tokens another
 * wallet paid for without a price.
 */
export function pnlInput(args: Readonly<{ trades: readonly WalletTrade[]; solUsd: number | null; market: ReadonlyMap<string, PnlMarket>; held: ReadonlyMap<string, number | null> | null; nowS: number }>): Readonly<{
  input: HonestPnlInput;
  approx: boolean;
  feesEstimated: boolean;
}> {
  const solUsd = args.solUsd && args.solUsd > 0 ? args.solUsd : null;
  let approx = false;
  let feesEstimated = false;
  const legs: PnlLeg[] = [...args.trades]
    .sort((a, b) => a.slot - b.slot)
    .map((trade) => {
      let value: number | null = null;
      if (trade.paidBy === null && trade.quote !== null && trade.quoteAmount !== null) {
        if (trade.quote === "SOL") value = trade.quoteAmount;
        else if (solUsd !== null) {
          value = trade.quoteAmount / solUsd;
          approx = true;
        }
      }
      if (trade.feeSol === undefined) feesEstimated = true;
      return {
        id: `${trade.signature}:${trade.mint}:${trade.side}`,
        asset: trade.mint,
        at: trade.at,
        side: trade.side,
        amount: Number(trade.tokensRaw) / 10 ** trade.decimals,
        value,
        fee: trade.feeSol ?? ESTIMATED_NETWORK_FEE_SOL,
      };
    });
  const marks = new Map<string, ExitMark>();
  if (solUsd !== null) {
    for (const mint of new Set(args.trades.map((trade) => trade.mint))) {
      const known = args.market.get(mint);
      if (!known) continue;
      const liquidity = known.liquidityUsd;
      marks.set(mint, {
        price: known.priceUsd !== null && known.priceUsd >= 0 ? known.priceUsd / solUsd : null,
        /* A constant-product pool holds half its liquidity on each side. */
        depth: liquidity !== null && liquidity > 0 ? liquidity / 2 / solUsd : null,
        feeShare: ryntraFeeBps(mint) / 10_000,
        feeFixed: ESTIMATED_NETWORK_FEE_SOL,
      });
    }
  }
  return { input: { unit: "SOL", nowS: args.nowS, legs, held: args.held ?? undefined, marks }, approx, feesEstimated };
}

/* ------------------------------------------------------------- the result */

function figuresOf(window: HonestPnlWindow, covered: boolean): PnlFigures {
  const result = covered ? window.result : null;
  /* A window the read does not reach is not known — even one with no trade read in it. */
  const verdict: PnlVerdict = !covered ? "UNKNOWN" : window.verdict;
  return {
    result,
    realized: window.realized,
    unrealized: window.unrealized,
    known: window.known,
    fees: window.fees,
    pct: result === null ? null : window.pct,
    completenessPct: window.completenessPct,
    verdict,
    covered,
    trades: window.trades,
  };
}

const dayOf = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

/** The days of the calendar, UTC, oldest first, the last one the day `nowS` falls in. */
export function pnlDays(input: HonestPnlInput, count: number, covered: (from: number) => boolean): PnlDay[] {
  const today = Math.floor(input.nowS / DAY_S) * DAY_S;
  const out: PnlDay[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const from = today - back * DAY_S;
    if (!covered(from)) {
      out.push({ day: dayOf(from), from, result: null, verdict: "UNREAD", trades: 0 });
      continue;
    }
    const window = honestPnlWindow(input, from, from + DAY_S);
    out.push({ day: dayOf(from), from, result: window.result, verdict: window.verdict, trades: window.trades });
  }
  return out;
}

/** The average price of every priced buy of a coin, its fees inside: a coin all sold still has the price it came in at. */
function averageBuy(legs: readonly PnlLeg[]): number | null {
  let cost = 0;
  let amount = 0;
  for (const leg of legs) {
    if (leg.side !== "buy" || !finite(leg.value) || !finite(leg.fee)) continue;
    cost += leg.value + leg.fee;
    amount += leg.amount;
  }
  return amount > EPS && cost > 0 ? cost / amount : null;
}

/** What the coin's trades leave open: bought less sold, never below zero. */
function bookOpen(legs: readonly PnlLeg[]): number {
  let open = 0;
  for (const leg of legs) open = Math.max(0, open + (leg.side === "buy" ? leg.amount : -leg.amount));
  return open;
}

/**
 * The Portfolio's result: the three periods ending now, each coin with its entry price, the calendar's days, and what
 * the read does not know. `calendarDays` — how many days the calendar reaches (`PNL_CALENDAR_DAYS`).
 */
export function portfolioPnl(args: Readonly<{ read: PnlRead; solUsd: number | null; market: ReadonlyMap<string, PnlMarket>; nowS: number; calendarDays?: number }>): PortfolioPnl {
  const { read, market, nowS } = args;
  const solUsd = args.solUsd && args.solUsd > 0 ? args.solUsd : null;
  const { input, approx, feesEstimated } = pnlInput({ trades: read.trades, solUsd, market, held: read.held, nowS });
  const pnl = honestPnl(input);
  const skipped = read.gap || read.skipped > 0;
  /* A window is covered when the read reaches its start and nothing between was left unread. */
  const covered = (from: number | null) => !skipped && (read.complete || (from !== null && read.oldestAt !== null && read.oldestAt <= from));

  const periods = {} as Record<PnlPeriodDays, PnlPeriod>;
  for (const days of PNL_PERIOD_DAYS) periods[days] = { ...figuresOf(pnl.periods[days], covered(nowS - days * DAY_S)), days };

  const legsOf = new Map<string, PnlLeg[]>();
  for (const leg of input.legs ?? []) legsOf.set(leg.asset, [...(legsOf.get(leg.asset) ?? []), leg]);
  const coins = pnl.assets.map((asset): PnlCoin => {
    const legs = legsOf.get(asset.asset) ?? [];
    const facts = market.get(asset.asset);
    const heldRead = read.held?.get(asset.asset);
    const open = bookOpen(legs);
    const tolerance = (amount: number) => Math.max(EPS, amount * 1e-9);
    const arrived = finite(heldRead) && heldRead > asset.held + tolerance(heldRead);
    const sent = finite(heldRead) && heldRead + tolerance(open) < open;
    const held = finite(heldRead) ? Math.max(0, heldRead) : asset.held;
    /* The entry of what is held only when all of it was bought at a known price; of every buy once all is sold. */
    const entry =
      held > EPS
        ? arrived || asset.heldUnknownCost > EPS || !(asset.held > EPS) || !(asset.heldCost > 0)
          ? null
          : asset.heldCost / asset.held
        : averageBuy(legs);
    const capital = honestPnl({ ...input, legs }).whole.capital;
    const result = skipped ? null : asset.result;
    return {
      mint: asset.asset,
      symbol: facts?.symbol ?? null,
      name: facts?.name ?? null,
      icon: facts?.icon ?? null,
      held,
      entry,
      now: solUsd !== null && finite(facts?.priceUsd) && facts.priceUsd > 0 ? facts.priceUsd / solUsd : null,
      value: arrived ? null : asset.held > EPS ? asset.exitValue : 0,
      realized: asset.realized,
      unrealized: asset.unrealized,
      result,
      pct: result !== null && capital > EPS ? (result / capital) * 100 : null,
      completenessPct: asset.completenessPct,
      verdict: result === null ? "UNKNOWN" : Math.abs(result) <= Math.max(EPS, capital * 1e-9) ? "FLAT" : result > 0 ? "PLUS" : "MINUS",
      arrived,
      sent,
    };
  });
  coins.sort((a, b) => {
    const heldA = a.held > EPS ? 1 : 0;
    const heldB = b.held > EPS ? 1 : 0;
    if (heldA !== heldB) return heldB - heldA;
    if (heldA) return (b.value ?? -1) - (a.value ?? -1);
    return Math.abs(b.result ?? b.realized ?? 0) - Math.abs(a.result ?? a.realized ?? 0);
  });

  const traded = new Set(read.trades.map((trade) => trade.mint));
  const untraded = [...(read.held ?? new Map<string, number | null>())].filter(([mint, amount]) => !MONEY.has(mint) && !traded.has(mint) && finite(amount) && amount > EPS).length;
  const gaps = new Set<PnlGap>();
  if (!read.complete) gaps.add("older");
  if (skipped) gaps.add("skipped");
  if (untraded > 0 || coins.some((coin) => coin.arrived || coin.sent)) gaps.add("transfers");
  if ((input.legs ?? []).some((leg) => leg.value === null)) gaps.add("unpriced");
  if (pnl.assets.some((asset) => asset.held > EPS && asset.exitValue === null && asset.heldUnknownCost <= EPS)) gaps.add("unquoted");

  return {
    standard: PORTFOLIO_PNL_STANDARD,
    unit: "SOL",
    asOf: nowS,
    solUsd,
    whole: figuresOf(pnl.whole, covered(null)),
    periods,
    coins,
    days: pnlDays(input, args.calendarDays ?? PNL_CALENDAR_DAYS, (from) => covered(from)),
    coverage: {
      source: "chain",
      since: read.complete ? null : read.oldestAt,
      gaps: PNL_GAPS.filter((gap) => gaps.has(gap)),
      untraded,
      approx,
      feesEstimated,
    },
  };
}
