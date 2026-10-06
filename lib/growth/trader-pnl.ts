import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { movementUsdMicros } from "../solana/action-value.ts";
import { within, type WeekRange } from "./weeks.ts";

/**
 * A trader's result for one week, in percent, from their own trades through
 * Ryntra — what the traders' board ranks.
 *
 * ## Only what was closed, only what was measured
 *
 * The result is the trades **closed** in the week: what the tokens sold that
 * week brought, against what was paid for them through Ryntra, as a percent
 * of what was paid. Nothing is priced later: a trade's dollar value is its
 * stablecoin leg at par, or else the provider's own dollar figure for that
 * exact fill (`statedUsd`), or else it is unmeasured. An open position has no
 * result yet, and a price read today would be a guess dressed as a fact.
 *
 * ## Average cost, through Ryntra only
 *
 * Each token is a position at its average cost, built from the wallet's buys
 * through Ryntra across all its history — a week's sale can close what was
 * bought a month ago. Tokens that came from somewhere else, or a buy whose
 * value was not measured, have no known cost: the part of a sale that closes
 * them is left out of the result entirely rather than counted at zero cost,
 * which would turn every transfer-in into profit.
 *
 * Integers throughout: token amounts in raw base units, dollars in micros.
 */

/** A trade counts only when Ryntra has its settled record on this network. */
const NETWORK = "mainnet";

export type TraderWeek = Readonly<{
  /** What the closed part cost, in USD micros — the board's minimum is on this. */
  closedCostMicros: bigint;
  /** What the closed part brought. */
  closedProceedsMicros: bigint;
  /** Closed trades in the week whose cost was known. */
  closedTrades: number;
  /** The result in hundredths of a percent, or null with nothing closed. */
  resultBps: number | null;
  /** When the last counted sale settled — the tie-break. */
  lastClosedAt: string | null;
}>;

type Position = { knownQty: bigint; knownCost: bigint; unknownQty: bigint; openedAt: string | null };

/** A settled swap's dollar value: the par leg, else the provider's figure for the exact fill. */
export function swapValueMicros(action: Pick<SolanaWalletAction, "out" | "in" | "statedUsd">): bigint | null {
  const par = movementUsdMicros(action.out) ?? movementUsdMicros(action.in);
  if (par !== null) return par > 0n ? par : null;
  if (typeof action.statedUsd === "number" && Number.isFinite(action.statedUsd) && action.statedUsd > 0) {
    return BigInt(Math.round(action.statedUsd * 1_000_000));
  }
  return null;
}

const RAW = /^[1-9][0-9]*$/;

/** The swaps that count, oldest first: done, on mainnet, both legs settled. */
export function countedSwaps(actions: readonly SolanaWalletAction[], wallet: string): readonly SolanaWalletAction[] {
  return actions
    .filter((action) =>
      action.wallet === wallet
      && action.network === NETWORK
      && action.lane === "SWAP"
      && action.outcome === "DONE"
      && action.out !== null && action.in !== null
      && action.out.mint !== null && action.in.mint !== null
      && action.out.mint !== action.in.mint
      && RAW.test(action.out.amountRaw) && RAW.test(action.in.amountRaw))
    .slice()
    .sort((left, right) => (left.startedAt < right.startedAt ? -1 : left.startedAt > right.startedAt ? 1 : left.actionId < right.actionId ? -1 : 1));
}

/** A par asset is cash, not a position: selling a dollar for a dollar closes nothing. */
function isCash(movement: SolanaWalletAction["out"]): boolean {
  return movementUsdMicros(movement) !== null;
}

/** A sale that closed part of a position whose cost was known, measured. */
export type ClosedPart = Readonly<{
  mint: string;
  symbol: string | null;
  decimals: number | null;
  /** The closed part with a known cost, raw base units. */
  quantity: bigint;
  /** What that part cost through Ryntra, USD micros. */
  cost: bigint;
  /** What that part brought, USD micros. */
  proceeds: bigint;
  /** When the position was opened: its first buy since it was last empty. */
  openedAt: string | null;
}>;

/** A buy whose dollar value was measured. */
export type MeasuredBuy = Readonly<{ mint: string; symbol: string | null; decimals: number | null; quantity: bigint; value: bigint }>;

export type PositionStep = Readonly<{ action: SolanaWalletAction; sale: ClosedPart | null; buy: MeasuredBuy | null }>;

/**
 * The wallet's counted swaps, oldest first, each with what it closed and
 * what it opened at average cost — the one walk the traders' board and the
 * trade cards both read, so a result is the same figure wherever it shows.
 */
export function positionSteps(actions: readonly SolanaWalletAction[], wallet: string): readonly PositionStep[] {
  const positions = new Map<string, Position>();
  const position = (mint: string): Position => {
    let found = positions.get(mint);
    if (!found) {
      found = { knownQty: 0n, knownCost: 0n, unknownQty: 0n, openedAt: null };
      positions.set(mint, found);
    }
    return found;
  };
  const steps: PositionStep[] = [];

  for (const action of countedSwaps(actions, wallet)) {
    const out = action.out!;
    const arrived = action.in!;
    const value = swapValueMicros(action);
    let sale: ClosedPart | null = null;
    let buy: MeasuredBuy | null = null;

    /* The sale side: what left, unless it was cash. */
    if (!isCash(out)) {
      const held = position(out.mint!);
      const sold = BigInt(out.amountRaw);
      const total = held.knownQty + held.unknownQty;
      const closing = sold < total ? sold : total;
      const knownPart = total > 0n ? (closing * held.knownQty) / total : 0n;
      if (value !== null && knownPart > 0n && held.knownQty > 0n) {
        const partCost = (held.knownCost * knownPart) / held.knownQty;
        const partProceeds = (value * knownPart) / sold;
        if (partCost > 0n) {
          sale = { mint: out.mint!, symbol: out.symbol, decimals: out.decimals, quantity: knownPart, cost: partCost, proceeds: partProceeds, openedAt: held.openedAt };
        }
      }
      /* The position shrinks by what was sold of it, known and unknown alike. */
      if (total > 0n) {
        const unknownOut = closing - knownPart;
        const costOut = held.knownQty > 0n ? (held.knownCost * knownPart) / held.knownQty : 0n;
        held.knownQty -= knownPart;
        held.knownCost -= costOut;
        held.unknownQty -= unknownOut < held.unknownQty ? unknownOut : held.unknownQty;
        if (held.knownQty + held.unknownQty === 0n) held.openedAt = null;
      }
    }

    /* The buy side: what arrived, unless it was cash. */
    if (!isCash(arrived)) {
      const held = position(arrived.mint!);
      const bought = BigInt(arrived.amountRaw);
      if (held.knownQty + held.unknownQty === 0n) held.openedAt = action.startedAt;
      if (value !== null) {
        held.knownQty += bought;
        held.knownCost += value;
        buy = { mint: arrived.mint!, symbol: arrived.symbol, decimals: arrived.decimals, quantity: bought, value };
      } else {
        held.unknownQty += bought;
      }
    }
    steps.push({ action, sale, buy });
  }
  return steps;
}

/**
 * The wallet's result for the week `range`, from all its actions (any order;
 * the ones that do not count are ignored).
 */
export function traderWeek(actions: readonly SolanaWalletAction[], wallet: string, range: WeekRange): TraderWeek {
  let cost = 0n;
  let proceeds = 0n;
  let closed = 0;
  let lastClosedAt: string | null = null;
  const end = Date.parse(range.end);

  for (const { action, sale } of positionSteps(actions, wallet)) {
    if (Date.parse(action.startedAt) >= end) break;
    if (sale && within(action.startedAt, range)) {
      cost += sale.cost;
      proceeds += sale.proceeds;
      closed += 1;
      lastClosedAt = action.startedAt;
    }
  }

  return {
    closedCostMicros: cost,
    closedProceedsMicros: proceeds,
    closedTrades: closed,
    /* Basis points of what was paid, rounded toward zero: +12.34 % is 1234. */
    resultBps: cost > 0n ? Number(((proceeds - cost) * 10_000n) / cost) : null,
    lastClosedAt,
  };
}
