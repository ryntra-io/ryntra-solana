/**
 * The core's trade ticket (`@ryntra/core/ui` `TradeTicket`) on Solana: what every Solana trade form hands it. The forms
 * keep their own execution — the swap's `/quote` → `/order` → the wallet → `/execute`, the launch's `quote` → `build` →
 * `submit` — and this module only says their figures in the ticket's words: the two tokens as `ExchangeToken`, raw
 * amounts as `Amount`, the market, the dollar prices, the network fee's token, the quote, and the receipt after the
 * fact. No React and no I/O here, so the forms, the tests and a server page read the same numbers.
 *
 * Money never passes through a float on its way into the ticket: raw base units stay strings and bigints; a dollar
 * price, which comes as a number from the venue, is written as a decimal string once.
 */

import type { Amount, AssetId, Fees, FxRate, Quote, Receipt } from "@ryntra/core/adapters";
import type { ExchangeToken, Prices, TicketGas, TicketMarket, TicketQuote, TicketReference, TicketSide } from "@ryntra/core/ui";

import { additionalJupiterFeeBps, serviceFeeEstimate, type RyntraServiceFee } from "../swap/service-fee.ts";

/** The network as the core's contracts name it, and the venue ids the forms quote through. */
export const TICKET_NETWORK = "solana";
export const NETWORK_LABEL = "Solana";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * A token as a form knows it: its mint, its symbol as the person reads it, its decimals; `digits` — how many it shows.
 * `multiplier` — a Scaled UI Amount mint's multiplier in force (a company's token after a dividend or a split): the
 * ticket then counts in the units the wallet shows, `raw × multiplier`, the way every company page has.
 */
export type TicketCoin = Readonly<{ mint: string; symbol: string; decimals: number; digits?: number; multiplier?: number | null }>;

const SCALE = 1_000_000_000n;
/** A multiplier other than one, to a billionth; null — the token counts as it is held. */
function scaleOf(coin: TicketCoin): bigint | null {
  const m = coin.multiplier;
  if (typeof m !== "number" || !Number.isFinite(m) || m <= 0 || m === 1) return null;
  const scale = BigInt(Math.round(m * 1e9));
  return scale > 0n && scale !== SCALE ? scale : null;
}

/** The units the ticket counts in, from what the chain holds. */
export function uiUnits(raw: bigint, coin: TicketCoin): bigint {
  const scale = scaleOf(coin);
  return scale === null ? raw : (raw * scale) / SCALE;
}

/**
 * What the chain moves for units the ticket counted, down to a whole unit; `held` — a sale of all the ticket shows is
 * exactly what the wallet holds, never one unit less left behind by the rounding.
 */
export function chainUnits(ui: bigint, coin: TicketCoin, held?: bigint | null): bigint {
  if (held !== undefined && held !== null && ui >= uiUnits(held, coin)) return held;
  const scale = scaleOf(coin);
  return scale === null ? ui : (ui * SCALE) / scale;
}

export const SOL_COIN: TicketCoin = Object.freeze({ mint: SOL_MINT, symbol: "SOL", decimals: 9, digits: 4 });

export const assetOf = (mint: string): AssetId => `${TICKET_NETWORK}:${mint}`;

export function coinToken(coin: TicketCoin): ExchangeToken {
  return { asset: assetOf(coin.mint), symbol: coin.symbol, decimals: coin.decimals, ...(coin.digits === undefined ? {} : { digits: coin.digits }) };
}

/** Raw base units the chain holds as the ticket's amount, in the units the wallet shows; anything else is none. */
export function rawAmount(raw: bigint | string | null | undefined, coin: TicketCoin): Amount | null {
  const units = typeof raw === "bigint" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? BigInt(raw) : null;
  if (units === null || units < 0n) return null;
  return { units: uiUnits(units, coin).toString(), asset: assetOf(coin.mint), decimals: coin.decimals };
}

/** The raw units of an amount; null for none. */
export function unitsOf(amount: Amount | null | undefined): bigint | null {
  return amount && /^\d+$/.test(amount.units) ? BigInt(amount.units) : null;
}

/** Raw units as the decimal a form's engine takes: «0.25», «10», every digit, no grouping. */
export function plainRaw(raw: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = raw / unit;
  const fraction = (raw % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** A positive finite number as a decimal string without an exponent, to `digits` significant digits. */
export function decimalText(value: number, digits = 12): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const [mantissa = "0", exponentText = "0"] = value.toExponential(Math.max(0, digits - 1)).split("e");
  const exponent = Number(exponentText);
  const bare = mantissa.replace(".", "");
  const point = 1 + exponent;
  let text: string;
  if (point <= 0) text = `0.${"0".repeat(-point)}${bare}`;
  else if (point >= bare.length) text = `${bare}${"0".repeat(point - bare.length)}`;
  else text = `${bare.slice(0, point)}.${bare.slice(point)}`;
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** USD per one whole unit of each token the form knows a price for; a token without one is left out, never zero. */
export function ticketPrices(entries: readonly Readonly<{ coin: TicketCoin; usd: number | null | undefined }>[], at: number, source: string): Prices {
  const prices: Record<AssetId, FxRate> = {};
  for (const { coin, usd } of entries) {
    const text = typeof usd === "number" ? decimalText(usd) : null;
    if (text) prices[assetOf(coin.mint)] = { usd: text, source, at };
  }
  return prices;
}

/**
 * The price step a market is shown with: four significant digits of its price, at least two after the point — so a
 * company at 182,40 USDC reads with cents and a meme at 0,00002914 SOL with its own digits. Limits and legs are not
 * placed from these forms, so the step only sets how a price reads.
 */
export function priceTick(price: number | null | undefined): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return "0.0001";
  const digits = Math.min(12, Math.max(2, 3 - Math.floor(Math.log10(price))));
  return `0.${"0".repeat(digits - 1)}1`;
}

/** The smallest step of a token: one base unit. */
export function lotOf(decimals: number): string {
  return decimals <= 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
}

/** One market for the ticket: the base bought, the quote paid; the price only sets how its prices read. */
export function ticketMarket(input: Readonly<{ id: string; base: TicketCoin; quote: TicketCoin; price?: number | null; minQuoteRaw?: bigint | null; symbol?: string }>): TicketMarket {
  return {
    id: input.id,
    symbol: input.symbol ?? `${input.base.symbol}/${input.quote.symbol}`,
    base: coinToken(input.base),
    quote: coinToken(input.quote),
    tick: priceTick(input.price),
    lot: lotOf(input.base.decimals),
    min_notional: input.minQuoteRaw ? rawAmount(input.minQuoteRaw, input.quote) : null,
  };
}

/** The price impact is measured against: the base's dollar price over the quote's, with where it was read and when. */
export function referenceOf(baseUsd: number | null | undefined, quoteUsd: number | null | undefined, source: string, at: number): TicketReference | null {
  if (typeof baseUsd !== "number" || typeof quoteUsd !== "number" || !(baseUsd > 0) || !(quoteUsd > 0)) return null;
  const price = decimalText(baseUsd / quoteUsd, 15);
  return price ? { price, source, at } : null;
}

/** The wallet's balances by asset, from raw units; a token whose balance was not read is left out. */
export function ticketBalances(rows: readonly Readonly<{ coin: TicketCoin; raw: bigint | string | null | undefined }>[]): Record<AssetId, Amount> {
  const balances: Record<AssetId, Amount> = {};
  for (const { coin, raw } of rows) {
    const amount = rawAmount(raw ?? null, coin);
    if (amount) balances[amount.asset] = amount;
  }
  return balances;
}

/** The network fee in SOL: what «Max» leaves for it and this trade's own fee, both in lamports. */
export function solGas(reserveLamports: bigint, txFeeLamports?: bigint | null): TicketGas {
  return {
    token: coinToken(SOL_COIN),
    reserve: rawAmount(reserveLamports, SOL_COIN) ?? { units: "0", asset: assetOf(SOL_MINT), decimals: 9 },
    ...(txFeeLamports && txFeeLamports > 0n ? { txFee: rawAmount(txFeeLamports, SOL_COIN) ?? undefined } : {}),
  };
}

/** Lamports from a venue's string; anything else is none. */
export function lamports(text: string | null | undefined): bigint {
  return typeof text === "string" && /^\d+$/.test(text) ? BigInt(text) : 0n;
}

/** What a form's engine quoted, in raw units of the two tokens, with its costs and how long it holds. */
export type QuotedFigures = Readonly<{
  inRaw: string;
  outRaw: string;
  minRaw: string;
  fees: Fees;
  /** As the person reads the route in Review's details. */
  route: string;
  /** ms */
  at: number;
  /** ms */
  expiresAt: number;
  slippageBps: number;
}>;

/**
 * The engine's quote as the ticket holds it: it speaks only for the amount the engine was asked (`inRaw`), this side,
 * this market and this venue — another amount typed since, and the ticket waits for its own.
 */
export function ticketQuote(input: Readonly<{ figures: QuotedFigures; side: TicketSide; market: TicketMarket; pay: TicketCoin; get: TicketCoin; executor: string; venueId: string; paid?: Amount | null }>): TicketQuote | null {
  const { figures } = input;
  /* What the ticket typed, when the engine was asked for its chain units: a sale of shares the wallet shows scaled. */
  const paid = input.paid ?? rawAmount(figures.inRaw, input.pay);
  const out = rawAmount(figures.outRaw, input.get);
  const min = rawAmount(figures.minRaw, input.get);
  if (!paid || !out || !min || unitsOf(paid) === 0n) return null;
  const quote: Quote = {
    intent_id: `quote:${input.market.id}:${input.side}:${figures.inRaw}`,
    out_expected: out,
    out_min: min,
    fees: figures.fees,
    route: figures.route,
    at: figures.at,
    expires_at: figures.expiresAt,
  };
  return { executor: input.executor, quote, side: input.side, paid, slippageBps: figures.slippageBps, market: input.market.id, venueId: input.venueId };
}

/** What happened, for the ticket's receipt: the facts the form's engine read after the fact. */
export type SettledFacts = Readonly<{
  intentId: string;
  venueId: string;
  marketId: string;
  side: TicketSide;
  state: "filled" | "rejected" | "expired";
  /** What was agreed to in Review. */
  paid: Amount;
  expected: Amount;
  atLeast: Amount | null;
  /** What actually left the wallet and arrived, when the chain was read. */
  actualIn: Amount | null;
  actualOut: Amount | null;
  fees: Fees;
  signature: string;
  signer: string;
  executor: string;
  /** ms */
  at: number;
  /** USD per one unit of what was paid, when known. */
  paidUsd?: number | null;
}>;

/** The core's receipt for a trade the form settled: what the receipt card and Review compare to the last digit. */
export function settledReceipt(facts: SettledFacts): Receipt {
  const usd = typeof facts.paidUsd === "number" ? decimalText(facts.paidUsd) : null;
  const expectedIn = unitsOf(facts.paid);
  const actualOut = unitsOf(facts.actualOut);
  const expectedOut = unitsOf(facts.expected);
  const diff = actualOut !== null && expectedOut !== null && expectedOut > 0n ? Number(((actualOut - expectedOut) * 10_000n) / expectedOut) : null;
  return {
    schema: "ryntra.flight-log/1",
    intent_id: facts.intentId,
    operation_id: facts.signature,
    action: "swap",
    venue: facts.venueId,
    network: TICKET_NETWORK,
    params: { market: facts.marketId, side: facts.side, type: "market", route: facts.executor },
    amounts: {
      expected: { in: facts.paid, out_expected: facts.expected, ...(facts.atLeast ? { out_min: facts.atLeast } : {}) },
      actual: { ...(facts.actualIn ? { in: facts.actualIn } : {}), ...(facts.actualOut ? { out: facts.actualOut } : {}) },
      ...(diff !== null && expectedIn !== null ? { diff_bps: diff } : {}),
    },
    fees: facts.fees,
    tx: { id: facts.signature, facts: {} },
    fx: { usd: usd ?? "0", source: facts.executor, at: facts.at },
    anchor: null,
    signer: facts.signer,
    signature: facts.signature,
    state: facts.state,
  };
}

/** A Jupiter order's figures as the swap's `/quote` and `/order` answer them. */
export type JupiterOrderFigures = Readonly<{
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  minReceivedRaw: string;
  slippageBps: number;
  totalFeeBasisPoints: number;
  signatureFeeLamports: string;
  priorityFeeLamports: string;
  route: readonly Readonly<{ label: string }>[];
  router: string;
  ryntraFee?: RyntraServiceFee | null;
  platformFee?: Readonly<{ basisPoints: number; mint: string }> | null;
}>;

/**
 * A Jupiter order in the ticket's words: what it pays and brings, the least that arrives, and every cost apart — the
 * network's in lamports, Ryntra's as the provider states it or sized on its side the way Review says «≈», Jupiter's own
 * beyond Ryntra's the same way. A cost in a token the form does not know is left to Review's own lines.
 */
export function jupiterFigures(order: JupiterOrderFigures, coins: Readonly<{ pay: TicketCoin; get: TicketCoin }>, at: number, expiresAt: number): QuotedFigures {
  const coinOf = (mint: string | null | undefined) => (mint === coins.pay.mint ? coins.pay : mint === coins.get.mint ? coins.get : mint === SOL_MINT ? SOL_COIN : null);
  const sides = { inputMint: order.inputMint, outputMint: order.outputMint, inputRaw: order.inAmountRaw, quotedOutputRaw: order.outAmountRaw };
  const fees: { venue?: Amount; ryntra?: Amount; gas?: Amount } = {};
  const gas = rawAmount(lamports(order.signatureFeeLamports) + lamports(order.priorityFeeLamports), SOL_COIN);
  if (gas && gas.units !== "0") fees.gas = gas;
  const fee = order.ryntraFee ?? null;
  const ryntra = fee ? serviceFeeEstimate(fee, sides) : null;
  const ryntraCoin = coinOf(fee?.asset);
  if (ryntra && ryntraCoin && /^\d+$/.test(ryntra.amountRaw) && BigInt(ryntra.amountRaw) > 0n) {
    const amount = rawAmount(ryntra.amountRaw, ryntraCoin);
    if (amount) fees.ryntra = amount;
  }
  const extraBps = additionalJupiterFeeBps(order.totalFeeBasisPoints, fee);
  const venueMint = order.platformFee?.mint ?? order.outputMint;
  const venueCoin = coinOf(venueMint);
  if (extraBps && extraBps > 0 && venueCoin) {
    const venue = serviceFeeEstimate({ basisPoints: extraBps, asset: venueMint, amountRaw: null }, sides);
    const amount = venue && BigInt(venue.amountRaw) > 0n ? rawAmount(venue.amountRaw, venueCoin) : null;
    if (amount) fees.venue = amount;
  }
  const route = order.route.map((leg) => leg.label).filter(Boolean).join(" → ") || order.router;
  return { inRaw: order.inAmountRaw, outRaw: order.outAmountRaw, minRaw: order.minReceivedRaw, fees, route, at, expiresAt, slippageBps: order.slippageBps };
}

const QUOTE_RANK: Readonly<Record<string, number>> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 3,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 2,
  [SOL_MINT]: 1,
};

/**
 * How dollar-like a token is — the side of a pair the other one is priced in: USDC, then USDT, then SOL, then any
 * other. A swap's market is the less dollar-like token against the more, so «Купити · Продати» reads the way a
 * terminal reads that pair.
 */
export function quoteRank(mint: string): number {
  return QUOTE_RANK[mint] ?? 0;
}

/** A short signature as the receipt card sets it in the mono face. */
export function shortSignature(signature: string): string {
  return signature.length > 12 ? `${signature.slice(0, 4)}…${signature.slice(-4)}` : signature;
}
