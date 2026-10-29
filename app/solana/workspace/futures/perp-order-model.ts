/**
 * The perpetual's order as the Perps terminal's ticket sets it (PERP-2): the leverage the person picks, the size in USD
 * or in the asset, the share of what the collateral allows, reduce-only, TP/SL — and what the ticket shows before the
 * Review: the order's value, the margin it takes at that leverage, the fees, and an estimate of the liquidation price
 * by Phoenix's own risk figures. Then the order the route builds, in lots and ticks.
 *
 * Cross margin (Phoenix's subaccount 0, the one Ryntra trades): every position stands on the whole account, and Phoenix
 * holds the initial margin of each by its tier's leverage. The leverage picked here is the size's measure — how much of
 * the free collateral the order puts to work — never more than the market's tier allows. The margin, the most and the
 * liquidation estimate are Phoenix's SDK's (PERP-4, `lib/phoenix/margin.ts`); none is counted here. The Review —
 * Phoenix's own view of the account after the order — is the figure that counts.
 *
 * Amounts reach the order exactly: what is typed becomes lots and ticks through the decimal helpers, never a float.
 * Pure.
 */

import { bookFill as walkBook, lotsFromUnits, ticksFromUsd, tifOf, tifMakerOnly, usdFromTicks, DEFAULT_MARKET_TIF, MIN_ORDER_NOTIONAL_USD, type BookLevels, type PerpSide, type PerpTif, type PerpUnits } from "../../../../lib/phoenix/orders-model.ts";

export type PerpOrderType = "market" | "limit";
export type SizeUnit = "usd" | "coin";
/** The three units a take profit and a stop loss may be set in (spec §9): a price, a share of the margin, or dollars. */
export type LegUnit = "price" | "percent" | "usd";
export const LEG_UNITS: readonly LegUnit[] = Object.freeze(["price", "percent", "usd"]);

export type { BookLevels, PerpTif };
/** The book walk is the server's own (`orders-model.ts`), so the ticket's preview and the Review read one walk. */
export const bookFill = walkBook;

/** What the person sets in the ticket. Typed text stays text: the order is made from it exactly. */
export type PerpDraft = Readonly<{
  /** Long or short — null until the person chooses: no side is imposed on a first order (spec §9). */
  side: PerpSide | null;
  type: PerpOrderType;
  /** How long the order stands: a market order's `fok` or `ioc`, a limit's `gtc` or `post_only` (Pro, PERP-5). */
  tif: PerpTif;
  /** A limit's price in USD, as typed. */
  price: string;
  /** The size as typed, in `unit`. */
  size: string;
  unit: SizeUnit;
  /** The share of the most the collateral allows, when the slider set the size; null once a size is typed. */
  percent: number | null;
  reduceOnly: boolean;
  tpsl: boolean;
  /** The take profit and the stop loss as typed, in `legUnit`. */
  tp: string;
  sl: string;
  legUnit: LegUnit;
  slippageBps: number;
}>;

export const newPerpDraft = (slippageBps: number, unit: SizeUnit = "usd"): PerpDraft => ({
  side: null,
  type: "market",
  tif: DEFAULT_MARKET_TIF,
  price: "",
  size: "",
  unit,
  percent: null,
  reduceOnly: false,
  tpsl: false,
  tp: "",
  sl: "",
  legUnit: "price",
  slippageBps,
});

/** A decimal as people type it — a comma or a point, spaces between thousands — as plain text; null for anything else. */
export function decimalInput(text: string): string | null {
  const plain = text.replace(/[\s  ]/g, "").replace(",", ".");
  return /^\d+(\.\d+)?$|^\d+\.$|^\.\d+$/.test(plain) ? plain.replace(/\.$/, "").replace(/^\./, "0.") : null;
}

/** The leverage tier a position of this size falls in: its leverage, and the market's highest when no tier was sent. */
export function tierLeverage(market: Readonly<{ maxLeverage: number | null; leverageTiers?: readonly Readonly<{ maxLeverage: number; maxSizeUnits: number | null }>[] }>, sizeUnits: number): number | null {
  const tiers = market.leverageTiers ?? [];
  if (tiers.length === 0) return market.maxLeverage;
  const size = Math.abs(sizeUnits);
  return (tiers.find((tier) => tier.maxSizeUnits === null || size <= tier.maxSizeUnits) ?? tiers[tiers.length - 1]!).maxLeverage;
}

/** The leverages the picker offers up to the market's highest: the usual steps and the highest itself. */
export function leverageSteps(max: number | null): number[] {
  if (max === null || !(max >= 1)) return [1];
  const top = Math.floor(max);
  return [...new Set([1, 2, 3, 5, 10, 20, 25, 50, 100].filter((step) => step < top).concat(top))];
}

/**
 * The leverage a market opens with before the person has picked one (spec §9, «обережне значення для onboarding»):
 * two times — enough for a perpetual to be one, far from the ten that used to greet a first order.
 */
export const CAREFUL_LEVERAGE = 2;

/** A picked leverage inside the market's range: a whole number from one to its highest. */
export function clampLeverage(value: number, max: number | null): number {
  const top = max !== null && max >= 1 ? Math.floor(max) : 1;
  if (!Number.isFinite(value)) return Math.min(top, CAREFUL_LEVERAGE);
  return Math.min(top, Math.max(1, Math.round(value)));
}

/** The collateral free for new positions: Phoenix's account value less the margin its positions and orders hold. */
export function freeCollateralUsd(margin: Readonly<{ portfolioUsd: number | null; initialMarginUsd: number | null }> | null | undefined): number | null {
  if (!margin || margin.portfolioUsd === null || margin.initialMarginUsd === null) return null;
  return Math.max(0, margin.portfolioUsd - margin.initialMarginUsd);
}

/**
 * The most an order may be worth (PERP-4): the SDK's most in lots (`/api/solana/futures/ticket` — the margin
 * calculator's largest size at the picked leverage, its fees out) at the price the size is counted at, under the first
 * check's ceiling when there is one. Null without the SDK's answer: the slider then waits rather than guesses.
 */
export function maxUsdOfLots(maxLots: string | null, units: PerpUnits, priceUsd: number | null, ceilingUsd: number | null, slippageBps: number): number | null {
  if (maxLots === null || !/^\d{1,20}$/.test(maxLots) || priceUsd === null || !(priceUsd > 0)) return null;
  const most = unitsOfLots(BigInt(maxLots), units) * priceUsd;
  return ceilingUsd === null ? most : Math.min(most, ceilingUsd / (1 + slippageBps / 10_000));
}

/** How old the SDK's answer may be, on the page's own clock, before the ticket stops counting on it: three of its refreshes. */
export const SDK_FRESH_MS = 30_000;

/**
 * Whether the ticket may send new risk to Review on the SDK's check (PERP-4): a cut or a close never waits; an order that
 * adds risk goes only on a fresh answer for this very size that carries the order's figures. `CHECKING` — the answer has
 * not come; `UNCHECKED` — the read failed, or the SDK answered without figures (a market or a position it cannot count).
 */
export function sdkCheck(input: Readonly<{ addsRisk: boolean; failed: boolean; answered: boolean; hasOrder: boolean; ageMs: number | null }>): "ok" | "CHECKING" | "UNCHECKED" {
  if (!input.addsRisk) return "ok";
  if (input.failed) return "UNCHECKED";
  const fresh = input.ageMs !== null && input.ageMs >= 0 && input.ageMs <= SDK_FRESH_MS;
  if (!input.answered || !fresh) return "CHECKING";
  return input.hasOrder ? "ok" : "UNCHECKED";
}

/**
 * The size in the asset for what is typed: the asset's own amount, or USD at the price the order is counted at (a
 * limit's price, else the mark). Null when it is not a positive number or there is no price.
 */
export function sizeUnitsOf(draft: Pick<PerpDraft, "size" | "unit">, priceUsd: number | null): number | null {
  const typed = decimalInput(draft.size);
  if (typed === null) return null;
  const value = Number(typed);
  if (!(value > 0)) return null;
  if (draft.unit === "coin") return value;
  return priceUsd !== null && priceUsd > 0 ? value / priceUsd : null;
}

/** The size in lots, down to a whole lot — never more than typed; null under one lot. */
export function lotsOfUnits(sizeUnits: number, units: PerpUnits): bigint | null {
  const lots = lotsFromUnits(sizeUnits.toFixed(12), units.baseLotsDecimals);
  return lots !== null && lots > 0n ? lots : null;
}

/** The asset's amount of a number of lots, as a number for the screen. */
export const unitsOfLots = (lots: bigint, units: PerpUnits): number => Number(lots) * 10 ** -units.baseLotsDecimals;

/**
 * The account's leverage after the order: every position's value over the account's, by the marks — this market's
 * position as it stands after the order, whichever way it went (a sell larger than a long turns it short).
 */
export function accountLeverageAfter(positionsValueUsd: number, heldUnits: number, orderUnits: number, markUsd: number, accountValueUsd: number | null): number | null {
  if (accountValueUsd === null || !(accountValueUsd > 0) || !(markUsd > 0)) return null;
  const total = Math.max(0, positionsValueUsd - Math.abs(heldUnits) * markUsd) + Math.abs(heldUnits + orderUnits) * markUsd;
  return total / accountValueUsd;
}

/** Whether the order only makes this market's position smaller: no new margin. */
export const onlyReduces = (heldUnits: number, orderUnits: number): boolean => heldUnits !== 0 && Math.abs(heldUnits + orderUnits) <= Math.abs(heldUnits) + 1e-12;

/** A take profit's or a stop loss's result on the position at its price, in USD and as a share of the margin put in. */
export function legResult(side: PerpSide, entryUsd: number, legUsd: number, sizeUnits: number, leverage: number): Readonly<{ usd: number; percent: number }> {
  const move = side === "long" ? legUsd - entryUsd : entryUsd - legUsd;
  return { usd: move * sizeUnits, percent: (move / entryUsd) * leverage * 100 };
}

/**
 * The price a take profit or a stop loss sits at when it is set as a share of the margin or as dollars (spec §9, the
 * three synchronous units): the magnitude typed is a gain for a take profit and a loss for a stop, so the price lands
 * on the side each guards. The inverse of {@link legResult}, on the same margin — the leverage Phoenix holds the
 * position at. Null when the figures do not give a positive price.
 */
export function legPriceOf(
  input: Readonly<{ leg: "tp" | "sl"; side: PerpSide; unit: LegUnit; value: number; entryUsd: number; sizeUnits: number; leverage: number }>,
): number | null {
  const { leg, side, unit, value, entryUsd, sizeUnits, leverage } = input;
  if (unit === "price") return value > 0 ? value : null;
  if (!(entryUsd > 0) || !(sizeUnits > 0) || !(leverage > 0) || !(value > 0)) return null;
  const move = unit === "usd" ? value / sizeUnits : ((value / 100) * entryUsd) / leverage;
  if (!Number.isFinite(move) || move <= 0) return null;
  const up = (side === "long") === (leg === "tp");
  const price = up ? entryUsd + move : entryUsd - move;
  return price > 0 ? price : null;
}

/** The order the route builds from the ticket, or why there is none yet. */
export type PerpOrder =
  | Readonly<{ kind: "open"; side: PerpSide; type: "market"; tif: PerpTif; size: string; slippageBps: number; tp: string | null; sl: string | null }>
  | Readonly<{ kind: "open"; side: PerpSide; type: "limit"; tif: PerpTif; size: string; price: string }>
  | Readonly<{ kind: "reduce"; size: string; slippageBps: number }>;

export type PerpBlock =
  | "SIDE"
  | "SIZE"
  | "PRICE"
  | "MINIMUM"
  | "LOT"
  | "OVER_MAX"
  | "CEILING"
  | "MARGIN"
  | "TP"
  | "SL"
  | "TP_SIDE"
  | "SL_SIDE"
  | "POST_ONLY_CROSS"
  | "REDUCE_LIMIT"
  | "REDUCE_SIDE"
  | "REDUCE_NONE"
  | "REDUCE_OVER";

/**
 * The ticket's draft as the order the route builds: the side, the size in lots, a limit's price and the legs in ticks,
 * or a reduce-only market order — rounded toward the side each guards. A block word while the draft is not one.
 */
export function perpOrderOf(input: Readonly<{
  draft: PerpDraft;
  units: PerpUnits;
  markUsd: number | null;
  /** The most the order may be worth now, when known. */
  maxUsd: number | null;
  /** The position held on this market, signed; 0 for none. */
  heldUnits: number;
  /** The first check's ceiling on a new position's value, when the gate is a canary. */
  ceilingUsd?: number | null;
  /**
   * The price and the leverage a TP/SL set as a share of the margin or as dollars is counted on — the ticket's own
   * figures, so the price the screen shows for a leg is the price the order carries. Without them the order's own
   * price and a leverage of one stand in.
   */
  legEntryUsd?: number | null;
  legLeverage?: number;
  /** The best price on each side as the page last polled the book: a post-only order must not cross it. */
  best?: Readonly<{ bid: number | null; ask: number | null }> | null;
}>): Readonly<{ order: PerpOrder; sizeUnits: number; priceUsd: number }> | Readonly<{ block: PerpBlock }> | null {
  const { draft, units, markUsd, maxUsd, heldUnits, ceilingUsd, best } = input;
  /* No side chosen: nothing is built, and the action says which one to choose — never a side of the ticket's own. */
  if (draft.side === null) return draft.size.trim() === "" && draft.price.trim() === "" ? null : { block: "SIDE" };
  const side = draft.side;
  const limit = draft.type === "limit";
  const typedPrice = limit ? decimalInput(draft.price) : null;
  if (limit && typedPrice === null) return draft.price.trim() === "" ? null : { block: "PRICE" };
  const priceUsd = limit ? Number(typedPrice) : markUsd;
  if (priceUsd === null || !(priceUsd > 0)) return limit ? { block: "PRICE" } : null;
  if (draft.size.trim() === "") return null;
  const sizeUnits = sizeUnitsOf(draft, priceUsd);
  if (sizeUnits === null) return { block: "SIZE" };
  /* The asset as typed goes to lots exactly; USD goes through the price, down to the lot. */
  const typedCoins = draft.unit === "coin" ? decimalInput(draft.size) : null;
  const typedLots = typedCoins === null ? null : lotsFromUnits(typedCoins, units.baseLotsDecimals);
  const lots = typedCoins !== null ? (typedLots !== null && typedLots > 0n ? typedLots : null) : lotsOfUnits(sizeUnits, units);
  if (lots === null) return { block: draft.reduceOnly ? "LOT" : "MINIMUM" };
  const exact = unitsOfLots(lots, units);

  const tif = tifOf(draft.type, draft.tif);

  if (draft.reduceOnly) {
    if (limit) return { block: "REDUCE_LIMIT" };
    if (heldUnits === 0) return { block: "REDUCE_NONE" };
    if ((heldUnits > 0) !== (side === "short")) return { block: "REDUCE_SIDE" };
    if (exact > Math.abs(heldUnits) + 1e-12) return { block: "REDUCE_OVER" };
    return { order: { kind: "reduce", size: lots.toString(), slippageBps: draft.slippageBps }, sizeUnits: exact, priceUsd };
  }

  if (exact * priceUsd < MIN_ORDER_NOTIONAL_USD) return { block: "MINIMUM" };
  /* The first check's ceiling counts as the server does: a sell at the mark when that is above its limit. */
  const countUsd = side === "short" && limit && markUsd !== null ? Math.max(priceUsd, markUsd) : priceUsd;
  if (ceilingUsd != null && exact * countUsd > ceilingUsd / (1 + (limit ? 0 : draft.slippageBps / 10_000)) + 0.01) return { block: "CEILING" };
  /* A cent of rounding is not over the most: the slider's «100 %» rounds the size down to a lot already. */
  if (maxUsd !== null && exact * priceUsd > maxUsd + 0.01) return { block: "OVER_MAX" };
  if (limit) {
    const ticks = ticksFromUsd(typedPrice!, units, side === "long" ? "floor" : "ceil");
    if (ticks === null) return { block: "PRICE" };
    /* A post-only order only ever rests: a price that crosses the book is Phoenix's own refusal, said here first. */
    if (tifMakerOnly(tif)) {
      const bestOpposite = side === "long" ? (best?.ask ?? null) : (best?.bid ?? null);
      const atPrice = usdFromTicks(ticks, units);
      if (bestOpposite !== null && (side === "long" ? atPrice >= bestOpposite : atPrice <= bestOpposite)) return { block: "POST_ONLY_CROSS" };
    }
    return { order: { kind: "open", side, type: "limit", tif, size: lots.toString(), price: ticks.toString() }, sizeUnits: exact, priceUsd };
  }
  let tp: bigint | null = null;
  let sl: bigint | null = null;
  if (draft.tpsl) {
    const long = side === "long";
    /* Each leg is typed in one of three units; the price it becomes is what travels, and the unit is only the way in. */
    const legUsd = (leg: "tp" | "sl", text: string): number | null | "bad" => {
      if (text.trim() === "") return null;
      const typed = decimalInput(text);
      if (typed === null) return "bad";
      const price = legPriceOf({ leg, side, unit: draft.legUnit, value: Number(typed), entryUsd: input.legEntryUsd ?? priceUsd, sizeUnits: exact, leverage: input.legLeverage ?? 1 });
      return price === null ? "bad" : price;
    };
    const tpAt = legUsd("tp", draft.tp);
    const slAt = legUsd("sl", draft.sl);
    if (tpAt === "bad") return { block: "TP" };
    if (slAt === "bad") return { block: "SL" };
    /* A long's take profit down to the tick and its stop up — never past what was typed; a short's the other way. */
    tp = tpAt === null ? null : ticksFromUsd(tpAt.toFixed(12), units, long ? "floor" : "ceil");
    sl = slAt === null ? null : ticksFromUsd(slAt.toFixed(12), units, long ? "ceil" : "floor");
    if (tpAt !== null && tp === null) return { block: "TP" };
    if (slAt !== null && sl === null) return { block: "SL" };
    /* The side is checked on the price as it will be sent — on the tick — not as typed. */
    const tpUsd = tp === null ? null : usdFromTicks(tp, units);
    const slUsd = sl === null ? null : usdFromTicks(sl, units);
    if (tpUsd !== null && (long ? !(tpUsd > priceUsd) : !(tpUsd < priceUsd))) return { block: "TP_SIDE" };
    if (slUsd !== null && (long ? !(slUsd < priceUsd) : !(slUsd > priceUsd))) return { block: "SL_SIDE" };
  }
  return {
    order: { kind: "open", side, type: "market", tif, size: lots.toString(), slippageBps: draft.slippageBps, tp: tp === null ? null : tp.toString(), sl: sl === null ? null : sl.toString() },
    sizeUnits: exact,
    priceUsd,
  };
}

/**
 * The size the slider's share sets, as the ticket's text in its unit: the share of the most, in USD, or in the asset at
 * the price counted — down to the lot, so «100 %» is never over the most.
 */
export function sizeAtPercent(percent: number, maxUsd: number | null, priceUsd: number | null, unit: SizeUnit, units: PerpUnits): string {
  if (maxUsd === null || priceUsd === null || !(priceUsd > 0) || !(percent > 0)) return "";
  const lots = lotsOfUnits(((maxUsd * Math.min(100, percent)) / 100) / priceUsd, units);
  if (lots === null) return "";
  const coins = unitsOfLots(lots, units);
  if (unit === "coin") return trimZeros(coins.toFixed(Math.max(0, units.baseLotsDecimals)));
  return trimZeros((Math.floor(coins * priceUsd * 100) / 100).toFixed(2));
}

const trimZeros = (text: string) => (text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text);
