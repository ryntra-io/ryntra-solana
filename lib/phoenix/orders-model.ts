/**
 * What the browser and the server share about Phoenix orders (B6b, decision 64; spec §4.2–§4.3): a position opened,
 * changed and closed from the person's own wallet — the request as it travels, the units it travels in, and the Review
 * and the receipt as the page reads them. No Node module here — the page imports it. The actions are `orders.ts` and
 * `orders-actions.ts`.
 *
 * Units (SDK `units.ts`): the quote is USDC with six decimals, so a quote lot is a millionth of a dollar; a price in
 * ticks is ticks × `tickSize` × 10^`baseLotsDecimals` / 10^6 dollars; a base lot is 10^−`baseLotsDecimals` of the
 * asset (`baseLotsDecimals` may be negative — PUMP is −2). Sizes and prices travel as digits of lots and ticks: the
 * bytes the wallet signs carry exactly those, so a Review never rounds what it shows away from what is signed.
 */

/**
 * What a person does with an order: open or add to a position, cut or close it, set its TP/SL, cancel one resting
 * order, cancel every resting order of one market (`cancelAll`), or cancel one of Phoenix's conditional orders —
 * a position-linked take profit or stop loss — by its index (`cancelConditional`).
 */
export type PerpOrderKind = "open" | "reduce" | "protect" | "cancel" | "cancelAll" | "cancelConditional";
export type PerpSide = "long" | "short";
export type PerpOrderType = "market" | "limit";

/**
 * How long an order stands, within what Phoenix's SDK has (PERP-5, spec §9): a limit rests until it fills or is
 * cancelled (`gtc`, the SDK's `Limit` packet) or only ever rests and never takes liquidity (`post_only`, the SDK's
 * `PostOnly` packet); a market order fills what the book gives now and cancels the rest (`ioc`) or fills all of its
 * size at once or nothing (`fok` — an `ImmediateOrCancel` packet whose least fill is its whole size).
 */
export type PerpTif = "gtc" | "post_only" | "ioc" | "fok";
export const MARKET_TIFS: readonly PerpTif[] = Object.freeze(["fok", "ioc"]);
export const LIMIT_TIFS: readonly PerpTif[] = Object.freeze(["gtc", "post_only"]);
/** What a market order and a limit order stand as unless the person chose otherwise: today's behaviour either way. */
export const DEFAULT_MARKET_TIF: PerpTif = "fok";
export const DEFAULT_LIMIT_TIF: PerpTif = "gtc";

export const tifOf = (type: PerpOrderType, tif: PerpTif | null | undefined): PerpTif =>
  tif && (type === "market" ? MARKET_TIFS : LIMIT_TIFS).includes(tif) ? tif : type === "market" ? DEFAULT_MARKET_TIF : DEFAULT_LIMIT_TIF;

export const tifAllowed = (type: PerpOrderType, tif: unknown): tif is PerpTif => (type === "market" ? MARKET_TIFS : LIMIT_TIFS).includes(tif as PerpTif);

/** Whether an order of this kind may fill part of its size and leave the rest: everything but a fill-or-kill. */
export const tifTakesPart = (tif: PerpTif): boolean => tif !== "fok";

/** Whether what this order does not fill at once stays in Phoenix's book. */
export const tifRests = (tif: PerpTif): boolean => tif === "gtc" || tif === "post_only";

/** Whether this order can only ever rest — it never takes liquidity, so it never pays a taker's or a builder's fee. */
export const tifMakerOnly = (tif: PerpTif): boolean => tif === "post_only";

/** The price tolerance a market order goes with, bps: 0.5 % unless the person chose another (the core ticket's default). */
export const DEFAULT_PERP_SLIPPAGE_BPS = 50;
/** The tolerances a market order may take: from a tenth of a per cent to five. Wider is not a market order but a gamble. */
export const MIN_PERP_SLIPPAGE_BPS = 10;
export const MAX_PERP_SLIPPAGE_BPS = 500;
/**
 * How far a stop loss may slip once it fires, bps: the SDK's own ceiling for a stop's market order
 * (`TP_SL_MAX_SLIPPAGE_BPS`, 10 %). A stop exists to get out; Review says how far it may fill from its trigger.
 */
export const STOP_SLIPPAGE_BPS = 1_000;
/** The least one order opens or adds: one dollar of notional (the operator's minimum for every money action). */
export const MIN_ORDER_NOTIONAL_USD = 1;

export type PerpUnits = Readonly<{ tickSize: number; baseLotsDecimals: number }>;

/* ------------------------------------------------------------------ units */

const DECIMAL = /^(\d{1,15})(?:[.,](\d{0,18}))?$/;

/** A plain decimal typed by a person («12.5», «0,25») as an exact fraction; null for anything else. */
export function fractionOf(text: string): Readonly<{ num: bigint; den: bigint }> | null {
  const clean = text.trim().replace(/\s/g, "");
  const match = DECIMAL.exec(clean);
  if (!match) return null;
  const fraction = match[2] ?? "";
  return { num: BigInt(`${match[1]}${fraction}` || "0"), den: 10n ** BigInt(fraction.length) };
}

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

/** The units are whole and sane: a tick of at least one quote lot, decimals Phoenix uses. */
export function unitsValid(units: Partial<PerpUnits> | null | undefined): units is PerpUnits {
  return !!units && Number.isSafeInteger(units.tickSize) && (units.tickSize ?? 0) > 0 && Number.isInteger(units.baseLotsDecimals) && Math.abs(units.baseLotsDecimals ?? 99) <= 12;
}

/**
 * Dollars per one base unit in whole ticks, rounded the way that keeps the person's limit: down (`floor`) for a price
 * that must not be paid above, up (`ceil`) for one that must not be sold under. Null for text that is not a price.
 */
export function ticksFromUsd(text: string, units: PerpUnits, rounding: "floor" | "ceil"): bigint | null {
  const value = fractionOf(text);
  if (!value || value.num === 0n || !unitsValid(units)) return null;
  /* ticks = usd × 10^6 / (tickSize × 10^d) */
  const d = units.baseLotsDecimals;
  const num = value.num * 1_000_000n * (d < 0 ? pow10(-d) : 1n);
  const den = value.den * BigInt(units.tickSize) * (d > 0 ? pow10(d) : 1n);
  const ticks = rounding === "floor" ? num / den : (num + den - 1n) / den;
  return ticks > 0n ? ticks : null;
}

/** Ticks as dollars per one base unit, a float for the screen only (never sent back). */
export function usdFromTicks(ticks: bigint, units: PerpUnits): number {
  return (Number(ticks) * units.tickSize * 10 ** units.baseLotsDecimals) / 1_000_000;
}

/** Ticks as an exact decimal string of dollars: what a field takes back. */
export function usdTextFromTicks(ticks: bigint, units: PerpUnits): string {
  /* usd = ticks × tickSize × 10^d / 10^6 — as a fraction over a power of ten. */
  const d = units.baseLotsDecimals;
  const num = ticks * BigInt(units.tickSize) * (d > 0 ? pow10(d) : 1n);
  const scale = 6 + (d < 0 ? -d : 0);
  return decimalText(num, scale);
}

/** A size in the asset typed by a person, in whole base lots, rounded down: never more than typed. */
export function lotsFromUnits(text: string, baseLotsDecimals: number): bigint | null {
  const value = fractionOf(text);
  if (!value) return null;
  /* lots = units × 10^d */
  const num = value.num * (baseLotsDecimals > 0 ? pow10(baseLotsDecimals) : 1n);
  const den = value.den * (baseLotsDecimals < 0 ? pow10(-baseLotsDecimals) : 1n);
  return num / den;
}

/** Base lots as an exact decimal string of the asset. */
export function unitsTextFromLots(lots: bigint, baseLotsDecimals: number): string {
  if (baseLotsDecimals <= 0) return (lots * pow10(-baseLotsDecimals)).toString();
  return decimalText(lots, baseLotsDecimals);
}

/** `value / 10^scale` as a plain decimal without trailing zeros, sign kept. */
export function decimalText(value: bigint, scale: number): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const unit = pow10(scale);
  const whole = magnitude / unit;
  const rest = scale > 0 ? (magnitude % unit).toString().padStart(scale, "0").replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${rest ? `.${rest}` : ""}`;
}

/* ------------------------------------------------------------- the money */

/**
 * Phoenix's fee on a notional, dollars: the rate is a fraction of the notional (`takerFee` 0.00035 is 3.5 bps), and a
 * fee is rounded up to the cent it is paid in — a Review never shows a fee smaller than the one taken.
 */
export function perpFeeUsd(notionalUsd: number, rate: number): number | null {
  if (!Number.isFinite(notionalUsd) || notionalUsd < 0 || !Number.isFinite(rate) || rate < 0) return null;
  return Math.max(0, Math.ceil(notionalUsd * rate * 1_000_000 - 1e-6)) / 1_000_000;
}

/** The notional of a size at a price, in quote lots (micro-dollars), exactly: lots × ticks × the tick's quote lots per lot. */
export function notionalMicroOf(sizeLots: bigint, priceTicks: bigint, units: PerpUnits): bigint {
  return sizeLots * priceTicks * BigInt(units.tickSize);
}

/** A builder's fee in bps on the part that takes liquidity, dollars, rounded up the same way. */
export function builderFeeUsd(notionalUsd: number, bps: number): number | null {
  if (!Number.isInteger(bps) || bps < 0) return null;
  return perpFeeUsd(notionalUsd, bps / 10_000);
}

/** The worst price a market order may fill at: the reference moved against the order by the tolerance. */
export function worstPriceUsd(side: PerpSide, referenceUsd: number, slippageBps: number): number {
  return side === "long" ? referenceUsd * (1 + slippageBps / 10_000) : referenceUsd * (1 - slippageBps / 10_000);
}

/* ------------------------------------------------------------- the book */

export type BookLevel = Readonly<{ price: number; size: number }>;
export type BookLevels = Readonly<{ bids: readonly BookLevel[]; asks: readonly BookLevel[] }>;

/**
 * What an order of this size would fill at, walking the book on its side — the asks for a long, the bids for a short:
 * the average price of the walk and the worst level it reaches. `"thin"` when the book cannot fill it; null without a
 * book, or for a size that is not positive. The page counts the ticket's preview with it and the server the Review's
 * price impact, so both read one walk of one book.
 */
export function bookFill(side: PerpSide, sizeUnits: number, book: BookLevels | null): Readonly<{ averageUsd: number; worstUsd: number }> | "thin" | null {
  if (!book) return null;
  const levels = side === "long" ? book.asks : book.bids;
  if (levels.length === 0 || !(sizeUnits > 0)) return levels.length === 0 ? "thin" : null;
  let left = sizeUnits;
  let quote = 0;
  let worst = levels[0]!.price;
  for (const level of levels) {
    if (left <= 0) break;
    const take = Math.min(left, level.size);
    quote += take * level.price;
    left -= take;
    worst = level.price;
  }
  if (left > sizeUnits * 1e-9) return "thin";
  return { averageUsd: quote / sizeUnits, worstUsd: worst };
}

/** The best price on the side an order of this side takes: the first ask for a long, the first bid for a short. */
export const bestPriceOf = (side: PerpSide, book: BookLevels | null): number | null => (side === "long" ? book?.asks[0]?.price : book?.bids[0]?.price) ?? null;

/**
 * How far an order moves the price against itself, per cent of the best price on its side (spec §17, «Price impact»):
 * positive — it fills worse than the best level, which is what size costs. An estimate, always: the book moves.
 */
export function priceImpactPercent(side: PerpSide, averageUsd: number | null, bestUsd: number | null): number | null {
  if (averageUsd === null || bestUsd === null || !(bestUsd > 0) || !(averageUsd > 0)) return null;
  const impact = ((side === "long" ? averageUsd - bestUsd : bestUsd - averageUsd) / bestUsd) * 100;
  return Number.isFinite(impact) ? impact : null;
}

/**
 * A position's leverage: its value over what the account is worth (Phoenix's effective collateral — collateral with
 * unrealised result and funding). Null when the account is worth nothing or a figure is missing.
 */
export function leverageOf(positionValueUsd: number | null, accountValueUsd: number | null): number | null {
  if (positionValueUsd === null || accountValueUsd === null || !(accountValueUsd > 0)) return null;
  const leverage = Math.abs(positionValueUsd) / accountValueUsd;
  return Number.isFinite(leverage) ? leverage : null;
}

/**
 * Funding in one hour as a share of a position's value, from Hawkeye's micro-bps (a millionth of a basis point), and
 * who pays: a positive rate is paid by longs to shorts — Phoenix's accumulator runs on mark minus index (B7a §4), so
 * the side is stated only where the mark agrees; otherwise the rate stands without a side.
 */
export function fundingOf(microBps: bigint | null, markUsd: number | null, indexUsd: number | null): Readonly<{ ratePercent: number; payer: PerpSide | null }> | null {
  if (microBps === null) return null;
  const ratePercent = Number(microBps) / 1e8;
  if (!Number.isFinite(ratePercent)) return null;
  const premium = markUsd !== null && indexUsd !== null ? markUsd - indexUsd : null;
  const payer: PerpSide | null = microBps === 0n ? null : premium === null || premium === 0 ? null : microBps > 0n === premium > 0 ? (microBps > 0n ? "long" : "short") : null;
  return { ratePercent, payer };
}

/** Which side a position's take profit and stop loss sit on: above the mark for a long's take profit, below for its stop. */
export function legsSideOk(side: PerpSide, markUsd: number, tpUsd: number | null, slUsd: number | null): "TP_SIDE" | "SL_SIDE" | null {
  if (tpUsd !== null && (side === "long" ? !(tpUsd > markUsd) : !(tpUsd < markUsd))) return "TP_SIDE";
  if (slUsd !== null && (side === "long" ? !(slUsd < markUsd) : !(slUsd > markUsd))) return "SL_SIDE";
  return null;
}

/* ----------------------------------------------------------- the review */

/** What the account looks like after the order, by Phoenix's own on-chain view (Hawkeye) of the simulated transaction. */
export type PerpAfter = Readonly<{
  /** The position in the asset, signed: positive long, negative short, "0" flat. */
  positionUnits: string;
  entryUsd: number | null;
  positionValueUsd: number | null;
  /** Where Phoenix liquidates the position, a mark price; null when it has none (flat, or no price in bounds). */
  liquidationUsd: number | null;
  /** Hawkeye's word: `found`, `no_position`, `already_liquidatable`, `no_price_in_bounds`. */
  liquidationStatus: string;
  leverage: number | null;
  /** The account's collateral and what it is worth with the unrealised result, dollars. */
  collateralUsd: number | null;
  accountValueUsd: number | null;
  /** What the order changes in the collateral: fees, and a cut position's realised result. */
  collateralChangeUsd: number | null;
  /** What is left to open more or withdraw. */
  freeCollateralUsd: number | null;
  /** What the account's positions and orders hold as initial margin after the order. */
  initialMarginUsd: number | null;
  riskTier: string | null;
}>;

export type PerpFees = Readonly<{
  /** Phoenix's rate on the part that takes liquidity, and on the part that rests (a limit's), fractions. */
  takerRate: number | null;
  makerRate: number | null;
  /** Phoenix's own fee on the whole notional at the rate that applies, dollars; null when the fill decides it. */
  venueUsd: number | null;
  /**
   * Which of Phoenix's two rates `venueUsd` stands on: `taker` for an order that takes liquidity now, `maker` for a
   * post-only order that can only rest, `mixed` for a plain limit, whose parts are not known before it fills.
   */
  venueLiquidity: "taker" | "maker" | "mixed";
  /** Ryntra's builder fee through Phoenix's Flight, bps on the taker part; 0 when orders do not route through a builder. */
  builderBps: number;
  /** Dollars of it; null for a limit, whose taker part is not known before it fills; 0 where no part can take liquidity. */
  builderUsd: number | null;
}>;

export type PerpFunding = Readonly<{ ratePercent: number; payer: PerpSide | null; intervalSeconds: number | null }> | null;

export type OrderReview = Readonly<{
  kind: PerpOrderKind;
  symbol: string;
  /** How long the order stands (PERP-5); null for an action that places no order. */
  tif: PerpTif | null;
  /** The position's side the order acts on: an open's own, a cut's or a close's position side. */
  side: PerpSide;
  type: PerpOrderType;
  /** What the order trades, base lots as digits and the asset as a decimal; "0" for TP/SL or a cancel. */
  sizeLots: string;
  sizeUnits: string;
  /** A limit's price, or a market order's worst price; null for TP/SL or a cancel. */
  priceUsd: number | null;
  /** The mark price the Review was built at. */
  markUsd: number | null;
  indexUsd: number | null;
  slippageBps: number | null;
  notionalUsd: number | null;
  /** The account's margin before the order, Phoenix's view; null for a cancel. */
  before: Readonly<{ collateralUsd: number | null; accountValueUsd: number | null; liquidationUsd: number | null; positionUnits: string; initialMarginUsd: number | null }> | null;
  after: PerpAfter | null;
  fees: PerpFees;
  funding: PerpFunding;
  /** The TP/SL the transaction sets on the whole position; null — not set by this order. */
  tpUsd: number | null;
  slUsd: number | null;
  /** The TP/SL the transaction lifts before setting new ones (or with a close). */
  clearsLegs: boolean;
  /**
   * What the order does to the price it fills at, from Phoenix's book as the server read it when it built the Review
   * (spec §17): the average of the walk, the best price on that side, and the distance between them as a per cent.
   * An estimate — the book moves — and null where the order takes no liquidity or the book did not answer.
   */
  impact: Readonly<{ averageUsd: number; bestUsd: number; percent: number }> | null;
  /**
   * What Phoenix's book said when the Review walked it, so the screen never puts the book's silence and its answer in
   * one word: `walked` — it filled the size and `impact` holds the walk; `thin` — it answered and cannot fill this size
   * whole now (only an order allowed to fill in part gets this far); `quiet` — it did not answer; `resting` — this
   * order takes no liquidity at all (post-only); `unsure` — a limit that may rest or may cross, decided on the fill.
   */
  book: "walked" | "thin" | "quiet" | "resting" | "unsure";
  /** A cancel's order. */
  order: Readonly<{ id: string; side: "buy" | "sell"; priceUsd: number | null; sizeUnits: string | null }> | null;
  /** A «cancel every order of this market»: how many Phoenix holds now, and what they are worth. */
  cancelAll: Readonly<{ count: number; sizeUnits: string | null }> | null;
  /**
   * The conditional order of the position this cancel lifts: its index in Phoenix's account, which legs it holds and
   * each one's trigger. A take profit and a stop loss placed together are one conditional order, so both `legs` are
   * named — and Phoenix's cancel takes it whole.
   */
  conditional: Readonly<{ index: number; legs: readonly ("tp" | "sl")[]; tpUsd: number | null; slUsd: number | null }> | null;
  rentLamports: string;
  networkFeeLamports: string;
  traderAccount: string;
  transaction: Readonly<{ wireBase64: string }>;
  ticket: string;
  expiresAt: number;
  signableMs: number;
}>;

/* --------------------------------------------------------------- receipt */

/** One fill of a landed order, by Phoenix's record of the transaction (`/v1/trader/{wallet}/trades-history`). */
export type PerpFill = Readonly<{ sizeUnits: number; priceUsd: number; feeUsd: number | null; realizedPnlUsd: number | null; liquidity: "maker" | "taker" }>;

/** The fills of one signature summed: the size, the average price, the fees and the realised result. */
export function fillsSummary(fills: readonly PerpFill[]): Readonly<{ sizeUnits: number; averageUsd: number | null; feeUsd: number | null; realizedPnlUsd: number | null }> {
  let size = 0;
  let quote = 0;
  let fee: number | null = 0;
  let pnl: number | null = 0;
  for (const fill of fills) {
    size += Math.abs(fill.sizeUnits);
    quote += Math.abs(fill.sizeUnits) * fill.priceUsd;
    fee = fee === null || fill.feeUsd === null ? null : fee + fill.feeUsd;
    pnl = pnl === null || fill.realizedPnlUsd === null ? null : pnl + fill.realizedPnlUsd;
  }
  return { sizeUnits: size, averageUsd: size > 0 ? quote / size : null, feeUsd: fills.length ? fee : null, realizedPnlUsd: fills.length ? pnl : null };
}

/**
 * The fees of a landed order told apart (PERP-5, spec §17): Phoenix's own, at its maker or taker rate on each fill as
 * Phoenix's record names it, and Ryntra's, the builder's bps on the fills that took liquidity — maker fills bring the
 * builder nothing. `recordedUsd` is the one figure Phoenix writes on the fills; `agrees` says whether the two sides
 * add up to it, so a receipt never prints a split the chain's own number contradicts.
 */
export type PerpFeeSplit = Readonly<{ phoenixUsd: number | null; ryntraUsd: number | null; recordedUsd: number | null; agrees: boolean | null }>;

export function feeSplitOf(fills: readonly PerpFill[], rates: Readonly<{ takerRate: number | null; makerRate: number | null; builderBps: number }>): PerpFeeSplit {
  if (fills.length === 0) return { phoenixUsd: null, ryntraUsd: null, recordedUsd: null, agrees: null };
  let phoenix: number | null = 0;
  let ryntra: number | null = 0;
  let recorded: number | null = 0;
  for (const fill of fills) {
    const notional = Math.abs(fill.sizeUnits) * fill.priceUsd;
    const rate = fill.liquidity === "maker" ? rates.makerRate : rates.takerRate;
    phoenix = phoenix === null || rate === null ? null : phoenix + (perpFeeUsd(notional, rate) ?? 0);
    /* Flight's fee rides on the fills that remove liquidity only: a maker fill brings the builder nothing. */
    ryntra = ryntra === null ? null : ryntra + (fill.liquidity === "taker" ? (builderFeeUsd(notional, rates.builderBps) ?? 0) : 0);
    recorded = recorded === null || fill.feeUsd === null ? null : recorded + fill.feeUsd;
  }
  const sum = phoenix === null || ryntra === null ? null : phoenix + ryntra;
  /* A cent, or a fiftieth of the figure, is rounding; more than that and the split is not this chain record's. */
  const agrees = recorded === null || sum === null ? null : Math.abs(recorded - sum) <= Math.max(0.01, recorded * 0.02);
  return { phoenixUsd: phoenix, ryntraUsd: ryntra, recordedUsd: recorded, agrees };
}

export type OrderRelayState = "LANDED" | "FAILED" | "UNKNOWN" | "NOT_SENT";

/**
 * The relay's answer: where the signature stands on the chain and, once landed, Phoenix's record of what it filled —
 * absent until read, empty when the order filled nothing (a limit that rests, TP/SL, a cancel).
 */
export type OrderRelay = Readonly<{ results: readonly Readonly<{ signature: string; state: OrderRelayState; reason: string | null; fills?: readonly PerpFill[] | null }>[]; settled: boolean }>;

/**
 * The relay's own refusals, every one given before anything was sent — the collateral's list (`collateral-model.ts`)
 * with the orders' own. Any other answer after the wallet signed waits on the chain.
 */
export const ORDERS_REFUSED_BEFORE_SENDING: ReadonlySet<string> = new Set([
  "BAD_REQUEST",
  "TICKET_INVALID",
  "TICKET_EXPIRED",
  "ORDERS_CLOSED",
  "CANARY_LIMIT",
  "SIGNED_MISMATCH",
  "NOT_SIGNED",
  "RELAY_REFUSED",
  "UNAVAILABLE",
  "WALLET_MISMATCH",
  "RATE_LIMITED",
  "FORBIDDEN_ORIGIN",
  "UNAUTHORIZED",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "BODY_REQUIRED",
  "BODY_TOO_LARGE",
  "INVALID_BODY_STREAM",
  "INVALID_CONTENT_LENGTH",
  "INVALID_JSON",
  "JSON_REQUIRED",
]);

/**
 * Where a signed order stands, from the chain and Phoenix's own record of the fills (PERP-5, spec §10 and §16):
 * `pending` — the chain has not said, or an order that had to fill landed and Phoenix has not shown the fills;
 * `failed` — the transaction did not land; `accepted` — it landed and the whole order rests in the book; `partial` —
 * part of it filled and the rest either rests or was cancelled; `filled` — all of it filled; `cancelled` — a cancel,
 * or an order that filled nothing and does not rest; `set` — TP/SL.
 *
 * An order that rests needs no fill to be an answer: landed, it is `accepted`, and becomes `partial` or `filled` if
 * Phoenix later shows a fill. An order that had to fill at once has its Review's word that the book would fill it, so
 * until Phoenix shows what it filled it stays `pending` rather than claiming either. Nothing here says «the position
 * is open» before the chain confirmed it.
 */
export type OrderOutcome = "pending" | "failed" | "accepted" | "partial" | "filled" | "cancelled" | "set";

export function orderOutcomeOf(
  input: Readonly<{ state: OrderRelayState; kind: PerpOrderKind; tif: PerpTif | null; sizeUnits: number; filledUnits: number | null }>,
): OrderOutcome {
  if (input.state === "FAILED" || input.state === "NOT_SENT") return "failed";
  if (input.state !== "LANDED") return "pending";
  if (input.kind === "cancel" || input.kind === "cancelAll" || input.kind === "cancelConditional") return "cancelled";
  if (input.kind === "protect") return "set";
  const rests = input.tif !== null && tifRests(input.tif);
  if (input.filledUnits === null) return rests ? "accepted" : "pending";
  const room = Math.max(Math.abs(input.sizeUnits) * 1e-9, 1e-12);
  if (input.filledUnits <= room) return rests ? "accepted" : "cancelled";
  if (input.filledUnits + room < Math.abs(input.sizeUnits)) return "partial";
  return "filled";
}

export function orderRelayAfterSigning(relayed: Readonly<{ ok: true; value: OrderRelay }> | Readonly<{ ok: false; code: string }>, signatures: readonly string[]): Readonly<{ ok: true; value: OrderRelay }> | Readonly<{ ok: false; code: string }> {
  if (relayed.ok || ORDERS_REFUSED_BEFORE_SENDING.has(relayed.code)) return relayed;
  return { ok: true, value: { results: signatures.map((signature) => ({ signature, state: "UNKNOWN" as const, reason: null })), settled: false } };
}

/**
 * What a wallet may do with orders now: the gate, the first check's ceiling, and the builder's fee in bps as the chain
 * holds it (null — no builder, or the chain was not read; the Review reads it again and is the figure that counts).
 */
export type OrderStates = Readonly<{ open: boolean; maxNotionalUsd: number | null; builder: boolean; builderBps?: number | null }>;
