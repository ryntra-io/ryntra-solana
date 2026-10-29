/**
 * Spot's ticket on the core's trade ticket (B16 on SOL-T1): what the core's `TradeTicket` reads, made from what Spot's
 * own flow already has — the market, the wallet's balances, the engine's quote, the exact order the Review signs, the
 * limit route's Review and the settled answer. The money flow is not touched: the quote, the exact order,
 * the signature checks, the one execute and the recovery stay `use-spot-ticket.ts`'s; the limits stay `limit-api.ts`'s.
 * This file only translates their answers into the core's shapes, so the one ticket of Ryntra draws them.
 *
 * Amounts never pass through a float: raw base units in a string or a bigint, as the core's contracts carry them. A
 * tokenized stock with the Scaled UI Amount extension is drawn in the unit the wallet shows (one base token stands for
 * `multiplier` of them): `toView` and `fromView` move its base leg between the two, and the routes keep speaking raw.
 *
 * Pure.
 */

import type { Amount, Fees, Quote, Receipt } from "@ryntra/core/adapters";
import type { ExchangeToken, Prices, TicketMarket, TicketQuote, TicketResult, TicketReviewed, TicketSide } from "@ryntra/core/ui";

/** The network and the venues as the core's contracts name them. */
export const SOLANA_NETWORK = "solana";
export const JUPITER_VENUE = "jupiter";
export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

export type TicketToken = Readonly<{ mint: string; symbol: string; decimals: number }>;

/** A stock's scale: one base token stands for `num / den` of the unit the wallet shows. Null — no scale. */
export type Scale = Readonly<{ num: bigint; den: bigint }> | null;

export const toView = (raw: bigint, scale: Scale): bigint => (scale ? (raw * scale.num) / scale.den : raw);
export const fromView = (view: bigint, scale: Scale): bigint => (scale ? (view * scale.den) / scale.num : view);

const amount = (units: bigint | string, token: TicketToken): Amount => ({ units: String(units), asset: token.mint, decimals: token.decimals });
const exchangeToken = (token: TicketToken): ExchangeToken => ({ asset: token.mint, symbol: token.symbol, decimals: token.decimals });
export const SOL_TOKEN: TicketToken = { mint: WRAPPED_SOL, symbol: "SOL", decimals: 9 };

/**
 * A price's step for a market: six significant digits of the price it is first measured from, so every price of one
 * market lines up and a meme token at 0,00001234 keeps its digits. Without a price, a millionth.
 */
export function tickFor(price: number | null): string {
  if (price === null || !Number.isFinite(price) || price <= 0) return "0.000001";
  const exponent = Math.max(-12, Math.min(-2, Math.floor(Math.log10(price)) - 5));
  return `0.${"0".repeat(-exponent - 1)}1`;
}

/** The size step: one raw unit of the base. */
export function lotFor(decimals: number): string {
  return decimals <= 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
}

/** The pair as the ticket reads it: «SOL/USDC», the base bought and sold, the quote it is paid in. */
export function ticketMarketOf(base: TicketToken, quote: TicketToken, firstPrice: number | null): TicketMarket {
  return {
    id: `${base.mint}/${quote.mint}`,
    symbol: `${base.symbol}/${quote.symbol}`,
    base: exchangeToken(base),
    quote: exchangeToken(quote),
    tick: tickFor(firstPrice),
    lot: lotFor(base.decimals),
    min_notional: null,
  };
}

/** A decimal string of a positive number, every digit kept up to `digits` places; null for anything else. */
export function decimalText(value: number | null, digits = 12): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const text = value.toFixed(digits).replace(/\.?0+$/, "");
  return text === "0" ? null : text;
}

/** USD per one whole unit, by mint, with its source and time; a price not known is left out, never a zero. */
export function pricesOf(entries: readonly Readonly<{ mint: string; usd: number | null }>[], source: string, at: number): Prices {
  const prices: Record<string, { usd: string; source: string; at: number }> = {};
  for (const entry of entries) {
    const usd = decimalText(entry.usd, 10);
    if (usd !== null && !(entry.mint in prices)) prices[entry.mint] = { usd, source, at };
  }
  return prices;
}

/** The market's price in its quote: the base's dollars over the quote's. */
export function referencePrice(baseUsd: number | null, quoteUsd: number | null): string | null {
  if (baseUsd === null || quoteUsd === null || !(baseUsd > 0) || !(quoteUsd > 0)) return null;
  const ratio = baseUsd / quoteUsd;
  return decimalText(ratio, 18);
}

/** The engine's order as far as the ticket reads it: amounts, the fees and the route. */
export type EngineOrder = Readonly<{
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  minReceivedRaw: string;
  slippageBps: number;
  totalFeeBasisPoints: number;
  signatureFeeLamports: string;
  priorityFeeLamports: string;
  rentFeeLamports: string;
  requestId: string;
  route: readonly Readonly<{ label: string; basisPoints: number }>[];
  /** The mint Jupiter takes its own fee in, when the order states it. */
  platformFee?: Readonly<{ mint?: string | null }> | null;
}>;

/** Ryntra's own fee as the engine states it (`RyntraServiceFee`): its rate, its asset and its amount when stated. */
export type EngineServiceFee = Readonly<{ mechanism: string; basisPoints: number; asset: string | null; decimals: number | null; amountRaw: string | null }>;

/**
 * Every cost of an engine order by who takes it: the network's fee (signature and priority, in SOL), Ryntra's (the
 * amount the engine stated, else its rate on the side it is taken from) and Jupiter's own on top of it, on what
 * arrives. The account's rent is a reserve, not a fee — it is said beside the Review, not counted here.
 */
export function engineFees(order: EngineOrder, serviceFee: EngineServiceFee | null, tokens: ReadonlyMap<string, TicketToken>, scaled: Readonly<{ mint: string; scale: Scale }> | null = null): Fees {
  const fees: { gas?: Amount; ryntra?: Amount; venue?: Amount } = {};
  // A fee taken in a scaled stock's own token is counted in the wallet's unit, as its legs and its dollar price are.
  const view = (raw: bigint, mint: string): bigint => (scaled && scaled.scale && mint === scaled.mint ? toView(raw, scaled.scale) : raw);
  const gas = BigInt(order.signatureFeeLamports) + BigInt(order.priorityFeeLamports);
  if (gas > 0n) fees.gas = amount(gas, SOL_TOKEN);
  if (serviceFee && serviceFee.basisPoints > 0 && serviceFee.asset) {
    const token = tokens.get(serviceFee.asset);
    const decimals = serviceFee.decimals ?? token?.decimals ?? null;
    let raw: bigint | null = null;
    if (serviceFee.amountRaw !== null && /^\d+$/.test(serviceFee.amountRaw)) raw = BigInt(serviceFee.amountRaw);
    else if (serviceFee.basisPoints < 10_000) {
      const bps = BigInt(serviceFee.basisPoints);
      if (serviceFee.asset === order.inputMint) raw = (BigInt(order.inAmountRaw) * bps) / 10_000n;
      else if (serviceFee.asset === order.outputMint) raw = (BigInt(order.outAmountRaw) * bps) / 10_000n;
    }
    if (raw !== null && raw > 0n && decimals !== null) fees.ryntra = { units: view(raw, serviceFee.asset).toString(), asset: serviceFee.asset, decimals };
  }
  const included = serviceFee?.mechanism === "JUPITER_REFERRAL" || serviceFee?.mechanism === "JUPITER_PLATFORM_FEE" ? serviceFee.basisPoints : 0;
  const venueBps = Math.max(0, order.totalFeeBasisPoints - included);
  // The venue's own fee, in the mint the order names for it: on the input it is a share of what is paid; on the output
  // what arrives is already net of it, so it is that share of the gross.
  const feeMint = order.platformFee?.mint ?? order.outputMint;
  const onInput = feeMint === order.inputMint;
  const feeToken = tokens.get(onInput ? order.inputMint : order.outputMint);
  if (venueBps > 0 && venueBps < 10_000 && feeToken) {
    const raw = onInput ? (BigInt(order.inAmountRaw) * BigInt(venueBps)) / 10_000n : (BigInt(order.outAmountRaw) * BigInt(venueBps)) / BigInt(10_000 - venueBps);
    if (raw > 0n) fees.venue = amount(view(raw, feeToken.mint), feeToken);
  }
  return fees;
}

/** The route as a person reads it in «Що це»: its hops, or the venue's name. */
export function routeText(order: Pick<EngineOrder, "route">): string {
  const hops = order.route.map((hop) => hop.label).filter(Boolean);
  return hops.length > 0 ? hops.join(" → ") : "Jupiter";
}

/** The two legs of an engine order in the ticket's units: the base leg in the wallet's unit for a scaled stock. */
export function engineLegs(order: Pick<EngineOrder, "inAmountRaw" | "outAmountRaw" | "minReceivedRaw">, side: TicketSide, scale: Scale) {
  const paid = side === "sell" ? toView(BigInt(order.inAmountRaw), scale) : BigInt(order.inAmountRaw);
  const expected = side === "buy" ? toView(BigInt(order.outAmountRaw), scale) : BigInt(order.outAmountRaw);
  const atLeast = side === "buy" ? toView(BigInt(order.minReceivedRaw), scale) : BigInt(order.minReceivedRaw);
  return { paid, expected, atLeast };
}

/**
 * The engine's quote as the core's ticket reads it. `paidView` — the amount the ticket asked for, in its own units: a
 * scaled stock's sale asks for the raw amount behind it, and the quote speaks for the ticket's amount only when that
 * raw amount is exactly the one quoted.
 */
export function ticketQuoteOf(args: Readonly<{
  order: EngineOrder;
  serviceFee: EngineServiceFee | null;
  side: TicketSide;
  market: TicketMarket;
  pay: TicketToken;
  get: TicketToken;
  scale: Scale;
  paidView: bigint | null;
  expiresAt: number;
  at: number;
  slippageBps: number;
}>): TicketQuote | null {
  const { order, side, market, pay, get, scale } = args;
  if (order.inputMint !== pay.mint || order.outputMint !== get.mint) return null;
  const legs = engineLegs(order, side, scale);
  // A scaled sale: the ticket's amount is in the wallet's unit; the quote speaks for it when its raw amount is the one behind it.
  const paid = side === "sell" && scale && args.paidView !== null && fromView(args.paidView, scale) === BigInt(order.inAmountRaw) ? args.paidView : legs.paid;
  const tokens = new Map([[pay.mint, pay], [get.mint, get]]);
  const quote: Quote = {
    intent_id: order.requestId,
    out_expected: amount(legs.expected, get),
    out_min: amount(legs.atLeast, get),
    fees: engineFees(order, args.serviceFee, tokens, { mint: market.base.asset, scale }),
    route: routeText(order),
    at: args.at,
    expires_at: args.expiresAt,
  };
  return { executor: "Jupiter", quote, side, paid: amount(paid, pay), slippageBps: args.slippageBps, market: market.id, venueId: JUPITER_VENUE };
}

/** Quote per one base, 1e-18, from two amounts in the ticket's units: what a purchase pays per unit, what a sale gets. */
export function priceE18(quoteUnits: bigint, baseUnits: bigint, market: TicketMarket): bigint | null {
  if (baseUnits <= 0n) return null;
  return (quoteUnits * 10n ** BigInt(18 + market.base.decimals)) / (baseUnits * 10n ** BigInt(market.quote.decimals));
}

/**
 * What the person agrees to on the exact order — the bytes the wallet signs, not the estimate before them. Review
 * reads this and never the live form, so a new quote or balance after it changes nothing that is signed.
 */
export function reviewedFromOrder(args: Readonly<{
  order: EngineOrder;
  serviceFee: EngineServiceFee | null;
  side: TicketSide;
  market: TicketMarket;
  pay: TicketToken;
  get: TicketToken;
  scale: Scale;
  prices: Prices;
  impact: number | null;
  expiresAt: number;
  at: number;
}>): TicketReviewed {
  const { order, side, market, pay, get, scale } = args;
  const legs = engineLegs(order, side, scale);
  const quoteUnits = side === "buy" ? legs.paid : legs.expected;
  const baseUnits = side === "buy" ? legs.expected : legs.paid;
  const fees = engineFees(order, args.serviceFee, new Map([[pay.mint, pay], [get.mint, get]]), { mint: market.base.asset, scale });
  return {
    side,
    type: "market",
    market,
    paid: amount(legs.paid, pay),
    expected: amount(legs.expected, get),
    atLeast: amount(legs.atLeast, get),
    size: null,
    price: priceE18(quoteUnits, baseUnits, market) ?? 0n,
    impact: args.impact,
    fees,
    executor: "Jupiter",
    quote: { intent_id: order.requestId, out_expected: amount(legs.expected, get), out_min: amount(legs.atLeast, get), fees, route: routeText(order), at: args.at, expires_at: args.expiresAt },
    prices: args.prices,
    crosses: false,
    slippageBps: order.slippageBps,
    tp: null,
    sl: null,
    legSize: null,
  };
}

/** The impact Jupiter states, a signed fraction of a percent, as basis points; a favourable one is no cost. */
export function impactOf(priceImpactPct: string | null | undefined): number | null {
  const value = priceImpactPct === null || priceImpactPct === undefined ? Number.NaN : Number(priceImpactPct);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value * 100));
}

/** The limit route's Review as far as the ticket reads it (`LimitReview`). */
export type LimitReviewFacts = Readonly<{
  side: "buy" | "sell";
  venue: "trigger" | "dlmm";
  makingRaw: string;
  takingRaw: string;
  price: string;
  fee: Readonly<{ ryntraBps: number; venueBps: number; ryntraFeeRaw: string; venueFeeRaw: string }>;
  networkFeeLamports: number;
  depositLamports: number | null;
}>;

export const LIMIT_VENUE_NAMES: Readonly<Record<LimitReviewFacts["venue"], string>> = { trigger: "Jupiter", dlmm: "Meteora DLMM" };

/**
 * A limit order's Review: what waits in the venue's account, what arrives at its price, each fee on what arrives,
 * the network's in SOL. Its bytes live about thirty seconds and the ticket builds them again at the signature when
 * they aged (AG-1), so the Review itself carries no clock.
 */
export function reviewedFromLimit(args: Readonly<{ review: LimitReviewFacts; market: TicketMarket; pay: TicketToken; get: TicketToken; scale: Scale; prices: Prices; price: bigint }>): TicketReviewed {
  const { review, market, pay, get, scale } = args;
  const side: TicketSide = review.side;
  const paid = side === "sell" ? toView(BigInt(review.makingRaw), scale) : BigInt(review.makingRaw);
  const expected = side === "buy" ? toView(BigInt(review.takingRaw), scale) : BigInt(review.takingRaw);
  const fees: { gas?: Amount; ryntra?: Amount; venue?: Amount } = {};
  if (review.networkFeeLamports > 0) fees.gas = amount(BigInt(review.networkFeeLamports), SOL_TOKEN);
  if (/^\d+$/.test(review.fee.ryntraFeeRaw) && BigInt(review.fee.ryntraFeeRaw) > 0n) fees.ryntra = amount(BigInt(review.fee.ryntraFeeRaw), get);
  if (/^\d+$/.test(review.fee.venueFeeRaw) && BigInt(review.fee.venueFeeRaw) > 0n) fees.venue = amount(BigInt(review.fee.venueFeeRaw), get);
  return {
    side,
    type: "limit",
    market,
    paid: amount(paid, pay),
    expected: amount(expected, get),
    atLeast: null,
    size: amount(side === "buy" ? expected : paid, side === "buy" ? get : pay),
    price: args.price,
    impact: null,
    fees,
    executor: LIMIT_VENUE_NAMES[review.venue],
    quote: null,
    prices: args.prices,
    crosses: false,
    slippageBps: 0,
    tp: null,
    sl: null,
    legSize: null,
  };
}

/** The engine's settled answer as far as the ticket reads it. */
export type EngineSettlement = Readonly<{
  state: string;
  signature: string;
  observation: Readonly<{ actualInputRaw: string; actualOutputRaw: string }> | null;
}>;

/** What happened to a market order, in the core's words: the classifier's kind (`classifySpotFill`) to the intent's state. */
export type FillKind = "FILLED" | "NOTHING_HAPPENED" | "NOT_FILLED" | "UNPLACED";

/**
 * The receipt the core's card reads for a fill: what left and what arrived as the chain shows them, every cost the
 * Review named, the transaction. The ledger's own receipt (the Flight Log the engine minted) stays downloadable beside
 * it; this is only the card's reading of the same facts.
 */
export function receiptOfFill(args: Readonly<{
  settled: EngineSettlement;
  reviewed: TicketReviewed;
  scale: Scale;
  signer: string;
  at: number;
  /** Ryntra's fee as the chain showed it, when the engine states its amount. */
  chainFee?: Readonly<{ amountRaw: string; asset: string; decimals: number }> | null;
}>): Receipt | undefined {
  const { settled, reviewed, scale } = args;
  if (!settled.observation) return undefined;
  const { actualInputRaw, actualOutputRaw } = settled.observation;
  if (!/^\d+$/.test(actualInputRaw) || !/^\d+$/.test(actualOutputRaw)) return undefined;
  const pay = reviewed.paid;
  const get = reviewed.expected;
  // The base leg in the ticket's units, by the same scale the Review used.
  const viewIn = reviewed.side === "sell" ? toView(BigInt(actualInputRaw), scale) : BigInt(actualInputRaw);
  const viewOut = reviewed.side === "buy" ? toView(BigInt(actualOutputRaw), scale) : BigInt(actualOutputRaw);
  return {
    schema: "ryntra.flight-log/1",
    intent_id: reviewed.quote?.intent_id ?? settled.signature,
    operation_id: settled.signature,
    action: "swap",
    venue: JUPITER_VENUE,
    network: SOLANA_NETWORK,
    params: { market: reviewed.market.id, side: reviewed.side, type: "market", slippage_bps: reviewed.slippageBps, route: reviewed.executor },
    amounts: {
      expected: { in: pay, out_expected: get, ...(reviewed.atLeast ? { out_min: reviewed.atLeast } : {}) },
      actual: { in: { ...pay, units: viewIn.toString() }, out: { ...get, units: viewOut.toString() } },
    },
    // What the chain shows: the network's fee the transaction set and Ryntra's as settled; the venue's share stays
    // inside what arrived and is not repeated as an estimate.
    fees: {
      ...(reviewed.fees.gas ? { gas: reviewed.fees.gas } : {}),
      ...(args.chainFee && BigInt(args.chainFee.amountRaw) > 0n ? { ryntra: { units: args.chainFee.amountRaw, asset: args.chainFee.asset, decimals: args.chainFee.decimals } } : {}),
    },
    tx: { id: settled.signature, facts: {} },
    fx: reviewed.prices[get.asset] ? { usd: reviewed.prices[get.asset]!.usd, source: reviewed.prices[get.asset]!.source, at: reviewed.prices[get.asset]!.at } : { usd: "", source: "", at: args.at },
    anchor: null,
    signer: args.signer,
    signature: settled.signature,
    state: "filled",
  };
}

/** The result card's state for a market order: where the order is, never a failure for an answer not yet known. */
export function marketResult(args: Readonly<{
  phase: string;
  kind: FillKind | null;
  signature: string | null;
  time: string;
  receipt?: Receipt | undefined;
  reason?: string | undefined;
}>): TicketResult | null {
  const tx = args.signature ?? undefined;
  const base = { time: args.time, signed: true, ...(tx ? { tx } : {}) };
  if (args.phase === "EXECUTING") return { ...base, state: "sent" };
  if (args.phase === "RECOVERING" || args.phase === "RECOVERY") return { ...base, state: "unknown", ...(args.reason ? { reason: args.reason } : {}) };
  if (args.phase !== "SETTLED") return null;
  switch (args.kind) {
    case "FILLED":
      return { ...base, state: "filled", ...(args.receipt ? { receipt: args.receipt } : {}), ...(args.reason ? { reason: args.reason } : {}) };
    case "NOTHING_HAPPENED":
      return { ...base, state: "expired", ...(args.reason ? { reason: args.reason } : {}) };
    case "NOT_FILLED":
      return { ...base, state: "rejected", ...(args.reason ? { reason: args.reason } : {}) };
    default:
      return { ...base, state: "unknown", ...(args.reason ? { reason: args.reason } : {}) };
  }
}

/** Balances by mint for the ticket, in its units: what each holding can spend, a scaled stock in the wallet's unit. */
export function ticketBalances(rows: readonly Readonly<{ mint: string; spendableRaw: string; decimals: number }>[], scaleOf: (mint: string) => Scale): Record<string, Amount> {
  const balances: Record<string, Amount> = {};
  for (const row of rows) {
    if (!/^\d+$/.test(row.spendableRaw) || row.mint in balances) continue;
    balances[row.mint] = { units: toView(BigInt(row.spendableRaw), scaleOf(row.mint)).toString(), asset: row.mint, decimals: row.decimals };
  }
  return balances;
}
