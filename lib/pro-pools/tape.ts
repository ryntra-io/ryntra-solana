/**
 * The tape of a Meteora DLMM Pro pool: its trades, its limit orders placed and collected, and the day in
 * numbers — volume, fees, trades, the orders that filled and the bonus their makers took — read from the program's own
 * events. Meteora keeps no data of DLMM Pro anywhere; this is it.
 *
 * What the events say, and what they do not (Meteora's own «Indexing Notes», `developer-guides/dlmm-pro/program/events`):
 *
 * - **A trade** is one `evtSwap`: the pool, the direction, what the trader paid (`amountIn`, the trading fee and the
 *   input coin's transfer fee inside it) and received (`amountOut`, after both), the price after, and the fee in five
 *   parts that add up to the whole — to liquidity (`mmFee`), to the limit orders it filled (`limitOrderFee`), to the
 *   protocol, to the swap's referral (`hostFee`) and to the pool's partner. The event does not name the trader: the
 *   decoder gives the swap instruction's signer.
 * - **A fill has no event of its own.** A swap that fills orders shows it only as `limitOrderFee` above zero (and zero
 *   proves nothing: the share rounds down); the filled amounts are mixed into its `amountIn` and `amountOut`. What an
 *   order filled is settled when its owner collects — `cancel_limit_order`, whose `evtCancelLimitOrder` pays out the
 *   unfilled part in the order's own coin, the filled part in the other at the tick's price, and the owner's share of
 *   the fee inside the two (the referral's fifth apart). So «filled orders» here are orders **collected** with a part
 *   filled, and «bonus paid» what their makers took; the bonus the swaps earned and not yet collected is the swaps' sum.
 * - **The side of a collected order** is in `evtOpenLimitOrder`, which may lie before what was read. Without it the
 *   payout often tells: a fee share above zero means a fill, and a fill of an ask pays token Y, of a bid token X — so a
 *   payout of only Y with a fee is an ask filled whole, of only X a bid. Where the pool takes its fee in the output coin
 *   the fee's coin names the side as well (X for an ask, Y for a bid). Where none of it tells, the side stays unknown,
 *   and so does whether it filled — never guessed.
 *
 * Every amount is the coin's base units as a decimal string; a whole-coin number beside it is for reading only. A
 * dollar figure is at the coin's price now (Jupiter's, through the pool row), never at the trade's moment, and null
 * where a coin has no price.
 *
 * Pure and client-safe: the server reads the chain (`./tape.server.ts`), the screens and the tests read the answers.
 */

import { coinSideOf, type ProPoolNetwork, type ProPoolRow } from "./model.ts";

export type TapeSide = "x" | "y";

export type TapeCoin = Readonly<{ mint: string; symbol: string | null; decimals: number; usd: number | null }>;

/** What the tape needs of the pool: its two coins, which of them a person trades, and the coin it takes its fee in. */
export type TapePool = Readonly<{
  address: string;
  x: TapeCoin;
  y: TapeCoin;
  /** The coin people trade — the other is what it is priced in (`./model.ts` `coinSideOf`). */
  coin: TapeSide;
  /** The fee in the coin a swap pays out, or always in token Y. */
  collectedIn: "output" | "tokenY";
}>;

/** One landed transaction, as the pool's list of signatures gives it. */
export type TapeMoment = Readonly<{ signature: string; slot: number; blockTime: number | null }>;

/** One event of the program as the venue's decoder gives it: names in camel case, big numbers as decimal strings. */
export type TapeEvent = Readonly<{ name: string; data: Readonly<Record<string, unknown>>; user: string | null }>;

export type TapeFee = Readonly<{
  /** The coin every part is in. */
  token: TapeSide;
  totalRaw: string;
  /** To liquidity, to the limit orders filled, to the protocol, to the swap's referral, to the pool's partner. */
  lpRaw: string;
  ordersRaw: string;
  protocolRaw: string;
  referralRaw: string;
  partnerRaw: string;
}>;

export type ProTrade = Readonly<{
  signature: string;
  slot: number;
  /** When it landed; null where the node gave no time. */
  at: string | null;
  /** Of the coin people trade. */
  side: "buy" | "sell";
  /** The swap's signer: the trader, or a router's authority where another program swapped for them. */
  wallet: string | null;
  /** What moved on each side as the trader paid or received it, base units. */
  coinRaw: string;
  quoteRaw: string;
  coinAmount: number;
  quoteAmount: number;
  /** What the trader got per coin, in the quote coin, the fee included; null where nothing moved. */
  price: number | null;
  /** The pool's price after the trade, quote per coin. */
  poolPrice: number | null;
  fee: TapeFee;
  /** The orders it filled: asks when it bought token X, bids when it sold it; null — none seen. */
  filled: "asks" | "bids" | null;
}>;

export type ProOrderPlaced = Readonly<{
  signature: string;
  slot: number;
  at: string | null;
  order: string;
  owner: string;
  /** In the pool's terms: an ask sells token X, a bid buys it. */
  side: "ask" | "bid";
  /** What the order put in, base units of `token` (X for an ask, Y for a bid). */
  amountRaw: string;
  token: TapeSide;
  /** On how many prices it rests. */
  prices: number;
  referral: boolean;
}>;

/** One collect of an order, as the event pays it out. */
export type ProCollect = Readonly<{
  signature: string;
  slot: number;
  at: string | null;
  order: string;
  owner: string;
  /** What left the pool for the owner in each coin, the owner's bonus inside. */
  paidXRaw: string;
  paidYRaw: string;
  /** The owner's share of the fee the order's fills earned. */
  bonusXRaw: string;
  bonusYRaw: string;
  /** The order's referral's fifth of it, and its coin; null coin — none paid. */
  referralRaw: string;
  referralToken: TapeSide | null;
  prices: number;
  /** The order was closed in the same transaction. */
  closed: boolean;
}>;

export type FillState = "filled" | "partial" | "unfilled";

/** A collected order read for what it filled. */
export type ProFill = ProCollect &
  Readonly<{
    /** In the pool's terms; null where nothing read tells. */
    side: "ask" | "bid" | null;
    /** Of the coin people trade: an ask sells token X. */
    coinSide: "buy" | "sell" | null;
    /** Over the prices collected: all of it filled, a part, none; null where the side is not known and the payout does not tell. */
    state: FillState | null;
    /** The filled part in the coin it was paid in, the bonus left out; null where the side is not known. */
    proceedsRaw: string | null;
    proceedsToken: TapeSide | null;
    /** The part returned unfilled, in the order's own coin; null where the side is not known. */
    unfilledRaw: string | null;
    unfilledToken: TapeSide | null;
  }>;

/** One transaction of the pool read: what it holds for the tape. */
export type TapeTxRecords = Readonly<{
  moment: TapeMoment;
  trades: readonly ProTrade[];
  placed: readonly ProOrderPlaced[];
  collects: readonly ProCollect[];
  /** The pool was created here: the history reaches its start. */
  created: boolean;
}>;

/**
 * How far back the tape reaches — the honest field «from how deep it was counted».
 *
 * - `from` — every transaction of the pool from this moment to `checked` was read, without a gap; null — none was.
 * - `checked` — when the pool's list of transactions was last read.
 * - `whole` — the read reaches back past the start of the day counted, or to the pool's creation.
 * - `stop` — why it ends where it does: `window` — it reached the day's start; `start` — the pool's creation;
 *   `budget` — our own budget of reads stopped it, and the next reads go on from there; `node` — the node did not give a
 *   transaction (or its list ends before the pool's creation).
 */
export type TapeDepth = Readonly<{
  from: string | null;
  checked: string | null;
  transactions: number;
  whole: boolean;
  stop: "window" | "start" | "budget" | "node";
}>;

/** What the reader hands the answers: the pool, how deep, and the transactions read without a gap, newest first. */
export type TapeView = Readonly<{
  pool: TapePool;
  depth: TapeDepth;
  txs: readonly TapeTxRecords[];
  /** The sides of the orders whose placing was read — older than the tape's own span, too. */
  sides: ReadonlyMap<string, "ask" | "bid">;
}>;

/** The day counted: twenty-four hours back from the moment of the read. */
export const STATS_HOURS = 24;

/* ── numbers ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

const DIGITS = /^\d{1,40}$/;

/** A decoded unsigned amount as a bigint; null where it is not one. */
export function amountOf(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  return typeof value === "string" && DIGITS.test(value) ? BigInt(value) : null;
}

/** Base units in whole coins, for reading; exact to the float's precision. */
export function wholeOf(raw: bigint | string, decimals: number): number {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  return Number(value / scale) + Number(value % scale) / Number(scale);
}

const Q64 = 2 ** 64;

/** The pool's price from its Q64.64 square root: token Y per token X, whole coins. Null where it is not a price. */
export function priceOfSqrt(sqrt: unknown, decimalsX: number, decimalsY: number): number | null {
  const value = amountOf(sqrt);
  if (value === null || value === 0n) return null;
  const root = Number(value) / Q64;
  const price = root * root * 10 ** (decimalsX - decimalsY);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** The coin's price in the other coin, from the pool's price (token Y per token X). */
const coinPrice = (pool: TapePool, yPerX: number | null): number | null => (yPerX === null ? null : pool.coin === "x" ? yPerX : 1 / yPerX);

const timeOf = (blockTime: number | null): string | null => (blockTime === null ? null : new Date(blockTime * 1000).toISOString());
const other = (side: TapeSide): TapeSide => (side === "x" ? "y" : "x");
const sum = (values: readonly (bigint | null)[]): bigint | null => values.reduce<bigint | null>((total, value) => (total === null || value === null ? null : total + value), 0n);

/* ── one transaction ─────────────────────────────────────────────────────────────────────────────────────────────── */

function tradeOf(moment: TapeMoment, event: TapeEvent, pool: TapePool): ProTrade | null {
  const data = event.data;
  if (typeof data.swapForY !== "boolean" || typeof data.feesOnTokenX !== "boolean") return null;
  const amountIn = amountOf(data.amountIn);
  const amountOut = amountOf(data.amountOut);
  const parts = [data.mmFee, data.limitOrderFee, data.protocolFee, data.hostFee, data.partnerFee].map(amountOf);
  const total = sum(parts);
  if (amountIn === null || amountOut === null || total === null) return null;
  const [lp, orders, protocol, referral, partner] = parts as bigint[];
  const input: TapeSide = data.swapForY ? "x" : "y";
  const coinIn = pool.coin === input;
  const coinRaw = coinIn ? amountIn : amountOut;
  const quoteRaw = coinIn ? amountOut : amountIn;
  const coinCoin = pool.coin === "x" ? pool.x : pool.y;
  const quoteCoin = pool.coin === "x" ? pool.y : pool.x;
  const coinAmount = wholeOf(coinRaw, coinCoin.decimals);
  const quoteAmount = wholeOf(quoteRaw, quoteCoin.decimals);
  return {
    signature: moment.signature,
    slot: moment.slot,
    at: timeOf(moment.blockTime),
    side: coinIn ? "sell" : "buy",
    wallet: event.user,
    coinRaw: coinRaw.toString(),
    quoteRaw: quoteRaw.toString(),
    coinAmount,
    quoteAmount,
    price: coinAmount > 0 && quoteAmount > 0 ? quoteAmount / coinAmount : null,
    poolPrice: coinPrice(pool, priceOfSqrt(data.postSqrtPrice, pool.x.decimals, pool.y.decimals)),
    fee: {
      token: data.feesOnTokenX ? "x" : "y",
      totalRaw: total.toString(),
      lpRaw: lp.toString(),
      ordersRaw: orders.toString(),
      protocolRaw: protocol.toString(),
      referralRaw: referral.toString(),
      partnerRaw: partner.toString(),
    },
    filled: orders > 0n ? (data.swapForY ? "bids" : "asks") : null,
  };
}

function placedOf(moment: TapeMoment, event: TapeEvent): ProOrderPlaced | null {
  const data = event.data;
  const ticks = data.actualTickLimitOrderAmount;
  if (typeof data.limitOrder !== "string" || typeof data.owner !== "string" || typeof data.isAskSide !== "boolean" || !Array.isArray(ticks)) return null;
  const amount = sum(ticks.map((tick) => amountOf((tick as Record<string, unknown> | null)?.amount)));
  if (amount === null) return null;
  return {
    signature: moment.signature,
    slot: moment.slot,
    at: timeOf(moment.blockTime),
    order: data.limitOrder,
    owner: data.owner,
    side: data.isAskSide ? "ask" : "bid",
    amountRaw: amount.toString(),
    token: data.isAskSide ? "x" : "y",
    prices: ticks.length,
    referral: typeof data.referral === "string" && data.referral.length > 0,
  };
}

function collectOf(moment: TapeMoment, event: TapeEvent, closed: ReadonlySet<string>): ProCollect | null {
  const data = event.data;
  const [paidX, paidY, bonusX, bonusY, referral] = [data.ownerAmountX, data.ownerAmountY, data.ownerFeeX, data.ownerFeeY, data.referralFee].map(amountOf);
  if (typeof data.limitOrder !== "string" || typeof data.owner !== "string" || paidX == null || paidY == null || bonusX == null || bonusY == null || referral == null) return null;
  if (bonusX > paidX || bonusY > paidY) return null;
  return {
    signature: moment.signature,
    slot: moment.slot,
    at: timeOf(moment.blockTime),
    order: data.limitOrder,
    owner: data.owner,
    paidXRaw: paidX.toString(),
    paidYRaw: paidY.toString(),
    bonusXRaw: bonusX.toString(),
    bonusYRaw: bonusY.toString(),
    referralRaw: referral.toString(),
    referralToken: referral > 0n ? (data.referralFeesOnTokenX === true ? "x" : "y") : null,
    prices: Array.isArray(data.tickIds) ? data.tickIds.length : 0,
    closed: closed.has(data.limitOrder),
  };
}

/**
 * What one transaction holds for the pool's tape: its trades, the orders placed and collected, whether it created the
 * pool. Events of other pools are passed over — a router's transaction can swap through several. An event whose fields
 * are not what the program writes is passed over too, never read as zero.
 */
export function recordsOf(moment: TapeMoment, events: readonly TapeEvent[], pool: TapePool): TapeTxRecords {
  const own = events.filter((event) => event.data.pool === pool.address);
  const closed = new Set(own.filter((event) => event.name === "evtCloseLimitOrder").map((event) => String(event.data.limitOrder)));
  const trades: ProTrade[] = [];
  const placed: ProOrderPlaced[] = [];
  const collects: ProCollect[] = [];
  let created = false;
  for (const event of own) {
    if (event.name === "evtSwap") {
      const trade = tradeOf(moment, event, pool);
      if (trade) trades.push(trade);
    } else if (event.name === "evtOpenLimitOrder") {
      const order = placedOf(moment, event);
      if (order) placed.push(order);
    } else if (event.name === "evtCancelLimitOrder") {
      const collect = collectOf(moment, event, closed);
      if (collect) collects.push(collect);
    } else if (event.name === "evtInitializePool") {
      created = true;
    }
  }
  return { moment, trades, placed, collects, created };
}

/* ── a collected order ───────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The side of a collected order when its placing was not read: told only where the payout leaves no other reading
 * (the module's header); null otherwise.
 */
export function sideOfPayout(collect: Pick<ProCollect, "paidXRaw" | "paidYRaw" | "bonusXRaw" | "bonusYRaw" | "referralRaw" | "referralToken">, collectedIn: TapePool["collectedIn"]): "ask" | "bid" | null {
  const bonusX = BigInt(collect.bonusXRaw);
  const bonusY = BigInt(collect.bonusYRaw);
  const principalX = BigInt(collect.paidXRaw) - bonusX;
  const principalY = BigInt(collect.paidYRaw) - bonusY;
  const fee = bonusX + bonusY + BigInt(collect.referralRaw);
  if (fee === 0n) return null;
  /* A fee means a fill, and a fill pays the other coin: Y for an ask, X for a bid. */
  if (principalX === 0n && principalY > 0n) return "ask";
  if (principalY === 0n && principalX > 0n) return "bid";
  /* In the output coin the fee is X for an ask (a swap buying X filled it) and Y for a bid. */
  if (collectedIn === "output") {
    const feeX = bonusX > 0n || (collect.referralToken === "x" && BigInt(collect.referralRaw) > 0n);
    const feeY = bonusY > 0n || (collect.referralToken === "y" && BigInt(collect.referralRaw) > 0n);
    if (feeX && !feeY) return "ask";
    if (feeY && !feeX) return "bid";
  }
  return null;
}

/** A collected order read for what it filled: its side from its placing where that was read, else from its payout. */
export function fillOf(collect: ProCollect, pool: Pick<TapePool, "coin" | "collectedIn">, placedSide?: "ask" | "bid"): ProFill {
  const principalX = BigInt(collect.paidXRaw) - BigInt(collect.bonusXRaw);
  const principalY = BigInt(collect.paidYRaw) - BigInt(collect.bonusYRaw);
  const side = placedSide ?? sideOfPayout(collect, pool.collectedIn);
  const coinSide = side === null ? null : (side === "ask") === (pool.coin === "x") ? "sell" : "buy";
  if (side === null) {
    /* Both coins back: some filled, some did not, whichever side it was. Nothing back: nothing filled. */
    const state: FillState | null = principalX > 0n && principalY > 0n ? "partial" : principalX === 0n && principalY === 0n ? "unfilled" : null;
    return { ...collect, side, coinSide, state, proceedsRaw: null, proceedsToken: null, unfilledRaw: null, unfilledToken: null };
  }
  const own: TapeSide = side === "ask" ? "x" : "y";
  const proceeds = own === "x" ? principalY : principalX;
  const unfilled = own === "x" ? principalX : principalY;
  const state: FillState = proceeds > 0n ? (unfilled > 0n ? "partial" : "filled") : "unfilled";
  return { ...collect, side, coinSide, state, proceedsRaw: proceeds.toString(), proceedsToken: other(own), unfilledRaw: unfilled.toString(), unfilledToken: own };
}

/* ── how deep ────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** A listed transaction as the reader keeps it: read, not yet read, or not given by the node. */
export type TapeListed = Readonly<{ blockTime: number | null; state: "read" | "unread" | "lost"; created: boolean }>;

/**
 * How far back the tape reaches, from the pool's list as the reader holds it (newest first): the run of transactions
 * read without a gap from the newest, and whether it covers the day from `windowStart` (unix seconds). `end` — the
 * list reached the oldest transaction the node gives for the pool.
 */
export function depthOf(list: readonly TapeListed[], end: boolean, windowStart: number, checked: string | null): TapeDepth {
  let transactions = 0;
  let oldest: number | null = null;
  let whole = false;
  let stop: TapeDepth["stop"] | null = null;
  for (const item of list) {
    /* Everything newer was read: a transaction from before the day's start — read or not — closes the day. */
    if (!whole && item.blockTime !== null && item.blockTime < windowStart) {
      whole = true;
      stop = "window";
    }
    if (item.state !== "read") {
      if (!whole) stop = item.state === "lost" ? "node" : "budget";
      break;
    }
    transactions += 1;
    if (item.blockTime !== null) oldest = item.blockTime;
    if (item.created) {
      if (!whole) {
        whole = true;
        stop = "start";
      }
      break;
    }
  }
  /* The list ran out with the day still open: the node gives nothing older, or the reader has not listed further yet. */
  stop ??= end ? "node" : "budget";
  return { from: oldest === null ? null : new Date(oldest * 1000).toISOString(), checked, transactions, whole, stop };
}

/* ── the day ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type TwoCoins = Readonly<{ xRaw: string; yRaw: string; usd: number | null }>;

export type ProPoolStats = Readonly<{
  hours: number;
  /** The span counted: from the day's start or the tape's depth, whichever is later, to the read. */
  from: string | null;
  to: string;
  /** Whether the span is the whole day (or the pool's whole life, when it is younger). */
  whole: boolean;
  trades: Readonly<{ count: number; buys: number; sells: number; wallets: number }>;
  /** What traded, measured on each side as the traders paid or received it; dollars at the price now. */
  volume: Readonly<{ coinRaw: string; quoteRaw: string; usd: number | null }>;
  fees: Readonly<{ total: TwoCoins; lp: TwoCoins; orders: TwoCoins; protocol: TwoCoins; referral: TwoCoins; partner: TwoCoins }>;
  orders: Readonly<{
    placed: number;
    /** Swaps that filled limit orders, as their fee share shows it. */
    fillingTrades: number;
    /** Collected: all of it filled, a part filled, none filled, and those the events alone do not tell. */
    filled: number;
    partial: number;
    unfilled: number;
    unknown: number;
    /** The makers' share the swaps earned in the span, and what makers took when they collected — the referral apart. */
    bonusEarned: TwoCoins;
    bonusPaid: TwoCoins;
    referralPaid: TwoCoins;
  }>;
  /** The pool's price after the span's first and last trade, quote per coin. */
  price: Readonly<{ first: number | null; last: number | null }>;
}>;

/** Two coins' base units in dollars at their price now; null where a coin that moved has no price. */
export function usdOf(pool: Pick<TapePool, "x" | "y">, xRaw: bigint, yRaw: bigint): number | null {
  let usd = 0;
  for (const [raw, coin] of [[xRaw, pool.x], [yRaw, pool.y]] as const) {
    if (raw === 0n) continue;
    if (coin.usd === null) return null;
    usd += wholeOf(raw, coin.decimals) * coin.usd;
  }
  return usd;
}

class Tally {
  x = 0n;
  y = 0n;
  add(token: TapeSide, raw: bigint | string): void {
    if (token === "x") this.x += BigInt(raw);
    else this.y += BigInt(raw);
  }
  raw(): TwoRaw {
    return { xRaw: this.x.toString(), yRaw: this.y.toString() };
  }
}

/** The span a day's numbers cover: from (unix seconds; null — nothing was read), and whether it is the whole day. */
export function spanOf(depth: TapeDepth, now: number): Readonly<{ since: number | null; whole: boolean }> {
  const dayStart = Math.floor(now / 1000) - STATS_HOURS * 3600;
  if (depth.whole) return { since: dayStart, whole: true };
  const from = depth.from === null ? null : Math.floor(Date.parse(depth.from) / 1000);
  return { since: from === null ? null : Math.max(dayStart, from), whole: false };
}

const inSpan = (moment: TapeMoment, since: number | null): boolean => since !== null && (moment.blockTime === null || moment.blockTime >= since);

/** Two coins' base units as a tally keeps them. */
export type TwoRaw = Readonly<{ xRaw: string; yRaw: string }>;

/**
 * A span's transactions counted, before the dollars: what the numbers of the day are made of. The server counts it
 * from the records it holds (`tallyOf`); the database counts the same from its rows (`public.pro_pool_day`), so the
 * records never leave it. `statsOfTally` turns either into the day's numbers at the coins' price now.
 */
export type DayTally = Readonly<{
  trades: number;
  buys: number;
  sells: number;
  /** Distinct signers of the trades. */
  wallets: number;
  /** Trades that filled limit orders, as their fee share shows it. */
  filling: number;
  coinRaw: string;
  quoteRaw: string;
  fees: Readonly<{ total: TwoRaw; lp: TwoRaw; orders: TwoRaw; protocol: TwoRaw; referral: TwoRaw; partner: TwoRaw }>;
  placed: number;
  filled: number;
  partial: number;
  unfilled: number;
  unknown: number;
  bonusPaid: TwoRaw;
  referralPaid: TwoRaw;
  /** The pool's price after the span's oldest and newest priced trade. */
  priceFirst: number | null;
  priceLast: number | null;
}>;

const ZERO: TwoRaw = Object.freeze({ xRaw: "0", yRaw: "0" });

/** Nothing counted. */
export const EMPTY_TALLY: DayTally = Object.freeze({
  trades: 0,
  buys: 0,
  sells: 0,
  wallets: 0,
  filling: 0,
  coinRaw: "0",
  quoteRaw: "0",
  fees: Object.freeze({ total: ZERO, lp: ZERO, orders: ZERO, protocol: ZERO, referral: ZERO, partner: ZERO }),
  placed: 0,
  filled: 0,
  partial: 0,
  unfilled: 0,
  unknown: 0,
  bonusPaid: ZERO,
  referralPaid: ZERO,
  priceFirst: null,
  priceLast: null,
});

/** The transactions (newest first) counted; a collected order's side from `sides`, else from its payout. */
export function tallyOf(txs: readonly TapeTxRecords[], sides: ReadonlyMap<string, "ask" | "bid">, pool: Pick<TapePool, "coin" | "collectedIn">): DayTally {
  /* Newest first, inside a transaction too: its events come in the order they happened. */
  const trades = txs.flatMap((tx) => [...tx.trades].reverse());
  const wallets = new Set(trades.map((trade) => trade.wallet).filter((wallet): wallet is string => wallet !== null));
  let coinVolume = 0n;
  let quoteVolume = 0n;
  const fees = { total: new Tally(), lp: new Tally(), orders: new Tally(), protocol: new Tally(), referral: new Tally(), partner: new Tally() };
  for (const trade of trades) {
    coinVolume += BigInt(trade.coinRaw);
    quoteVolume += BigInt(trade.quoteRaw);
    fees.total.add(trade.fee.token, trade.fee.totalRaw);
    fees.lp.add(trade.fee.token, trade.fee.lpRaw);
    fees.orders.add(trade.fee.token, trade.fee.ordersRaw);
    fees.protocol.add(trade.fee.token, trade.fee.protocolRaw);
    fees.referral.add(trade.fee.token, trade.fee.referralRaw);
    fees.partner.add(trade.fee.token, trade.fee.partnerRaw);
  }
  const counts = { filled: 0, partial: 0, unfilled: 0, unknown: 0 };
  const paid = new Tally();
  const referral = new Tally();
  for (const collect of txs.flatMap((tx) => tx.collects)) {
    const fill = fillOf(collect, pool, sides.get(collect.order));
    if (fill.state === null) counts.unknown += 1;
    else counts[fill.state] += 1;
    paid.add("x", collect.bonusXRaw);
    paid.add("y", collect.bonusYRaw);
    if (collect.referralToken) referral.add(collect.referralToken, collect.referralRaw);
  }
  const priced = trades.filter((trade) => trade.poolPrice !== null);
  return {
    trades: trades.length,
    buys: trades.filter((trade) => trade.side === "buy").length,
    sells: trades.filter((trade) => trade.side === "sell").length,
    wallets: wallets.size,
    filling: trades.filter((trade) => trade.filled !== null).length,
    coinRaw: coinVolume.toString(),
    quoteRaw: quoteVolume.toString(),
    fees: { total: fees.total.raw(), lp: fees.lp.raw(), orders: fees.orders.raw(), protocol: fees.protocol.raw(), referral: fees.referral.raw(), partner: fees.partner.raw() },
    placed: txs.reduce((count, tx) => count + tx.placed.length, 0),
    ...counts,
    bonusPaid: paid.raw(),
    referralPaid: referral.raw(),
    priceFirst: priced.at(-1)?.poolPrice ?? null,
    priceLast: priced[0]?.poolPrice ?? null,
  };
}

const twoOf = (pool: Pick<TapePool, "x" | "y">, two: TwoRaw): TwoCoins => ({ xRaw: two.xRaw, yRaw: two.yRaw, usd: usdOf(pool, BigInt(two.xRaw), BigInt(two.yRaw)) });

/**
 * The day of the pool in numbers from a tally of the span's transactions — the dollars at the coins' price now. A span
 * with nothing read (`spanOf` gives no start) counts nothing, whatever the tally holds.
 */
export function statsOfTally(pool: TapePool, depth: TapeDepth, counted: DayTally, now: number): ProPoolStats {
  const span = spanOf(depth, now);
  const tally = span.since === null ? EMPTY_TALLY : counted;
  const coinVolume = BigInt(tally.coinRaw);
  const quoteVolume = BigInt(tally.quoteRaw);
  const coin = pool.coin === "x" ? pool.x : pool.y;
  const quote = pool.coin === "x" ? pool.y : pool.x;
  const volumeUsd = quote.usd !== null ? wholeOf(quoteVolume, quote.decimals) * quote.usd : coin.usd !== null ? wholeOf(coinVolume, coin.decimals) * coin.usd : quoteVolume === 0n && coinVolume === 0n ? 0 : null;
  const { fees } = tally;
  return {
    hours: STATS_HOURS,
    from: span.since === null ? null : new Date(span.since * 1000).toISOString(),
    to: new Date(now).toISOString(),
    whole: span.whole,
    trades: { count: tally.trades, buys: tally.buys, sells: tally.sells, wallets: tally.wallets },
    volume: { coinRaw: tally.coinRaw, quoteRaw: tally.quoteRaw, usd: volumeUsd },
    fees: { total: twoOf(pool, fees.total), lp: twoOf(pool, fees.lp), orders: twoOf(pool, fees.orders), protocol: twoOf(pool, fees.protocol), referral: twoOf(pool, fees.referral), partner: twoOf(pool, fees.partner) },
    orders: {
      placed: tally.placed,
      fillingTrades: tally.filling,
      filled: tally.filled,
      partial: tally.partial,
      unfilled: tally.unfilled,
      unknown: tally.unknown,
      bonusEarned: twoOf(pool, fees.orders),
      bonusPaid: twoOf(pool, tally.bonusPaid),
      referralPaid: twoOf(pool, tally.referralPaid),
    },
    price: { first: tally.priceFirst, last: tally.priceLast },
  };
}

/** The day of the pool in numbers, from the transactions read (newest first) within the span. */
export function statsOf(view: TapeView, now: number): ProPoolStats {
  const span = spanOf(view.depth, now);
  const txs = view.txs.filter((tx) => inSpan(tx.moment, span.since));
  return statsOfTally(view.pool, view.depth, tallyOf(txs, view.sides, view.pool), now);
}

/* ── the answers ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The pair as the answers name it: the coin people trade and the coin it is priced in. */
export type TapePair = Readonly<{ coin: TapeCoin & Readonly<{ side: TapeSide }>; quote: TapeCoin & Readonly<{ side: TapeSide }> }>;

type Head = Readonly<{ network: ProPoolNetwork; at: string; pool: string; pair: TapePair; depth: TapeDepth }>;
export type ProStatsAnswer = Head & Readonly<{ stats: ProPoolStats }>;
export type ProTradesAnswer = Head & Readonly<{ trades: readonly ProTrade[] }>;
export type ProFillsAnswer = Head & Readonly<{ fills: readonly ProFill[] }>;

/** The most rows a list answer gives, and how many when none is asked. */
export const TAPE_PAGE_MAX = 100;
export const TAPE_PAGE_DEFAULT = 50;

/** A list's `limit` from a query: absent — the default; a whole number from 1 to the most; anything else — null. */
export function pageLimitOf(value: string | null): number | null {
  if (value === null || value === "") return TAPE_PAGE_DEFAULT;
  if (!/^\d{1,3}$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= TAPE_PAGE_MAX ? limit : null;
}

/** What the tape needs of a pool row (`./model.ts`). */
export function tapePoolOf(row: Pick<ProPoolRow, "address" | "x" | "y" | "fee">): TapePool {
  const coin = (side: ProPoolRow["x"]): TapeCoin => ({ mint: side.mint, symbol: side.symbol, decimals: side.decimals, usd: side.usd });
  return { address: row.address, x: coin(row.x), y: coin(row.y), coin: coinSideOf(row), collectedIn: row.fee.collectedIn };
}

/** What every answer of a pool's tape begins with: the pool, its pair and how deep the tape reaches. */
export function headOf(view: Pick<TapeView, "pool" | "depth">, network: ProPoolNetwork, now: number): Head {
  const { pool } = view;
  const quoteSide = other(pool.coin);
  return {
    network,
    at: new Date(now).toISOString(),
    pool: pool.address,
    pair: { coin: { ...pool[pool.coin], side: pool.coin }, quote: { ...pool[quoteSide], side: quoteSide } },
    depth: view.depth,
  };
}

export const statsAnswerOf = (view: TapeView, network: ProPoolNetwork, now: number): ProStatsAnswer => ({ ...headOf(view, network, now), stats: statsOf(view, now) });

/** The newest trades read without a gap, newest first. */
export const tradesAnswerOf = (view: TapeView, network: ProPoolNetwork, now: number, limit: number): ProTradesAnswer => ({ ...headOf(view, network, now), trades: view.txs.flatMap((tx) => [...tx.trades].reverse()).slice(0, limit) });

/** The newest collected orders that filled — whole or a part — newest first. */
export const fillsAnswerOf = (view: TapeView, network: ProPoolNetwork, now: number, limit: number): ProFillsAnswer => ({
  ...headOf(view, network, now),
  fills: view.txs
    .flatMap((tx) => [...tx.collects].reverse())
    .map((collect) => fillOf(collect, view.pool, view.sides.get(collect.order)))
    .filter((fill) => fill.state === "filled" || fill.state === "partial")
    .slice(0, limit),
});

/**
 * One pool's day in the answer of every pool's day at once (`/api/pro/pools/days`, `./days.server.ts`):
 * `ready` — counted at `at`, from the depth `depth` (a part of a busy day is a floor, and `stats.whole` says so);
 * `counting` — not counted yet, the next refresh goes on with it; `unknown` — the node did not answer for it several
 * times in a row, and it is asked again only after a while. Never zeros for a pool not counted.
 */
export type ProDayEntry =
  | Readonly<{ pool: string; state: "ready"; at: string; depth: TapeDepth; stats: ProPoolStats }>
  | Readonly<{ pool: string; state: "counting" | "unknown"; at: null }>;

/** Every listed pool's day: when answered, how long one count stays (seconds), and each pool's day. */
export type ProDaysAnswer = Readonly<{ network: ProPoolNetwork; at: string; fresh: number; days: readonly ProDayEntry[] }>;

/* ── guards for the screens ──────────────────────────────────────────────────────────────────────────────────────── */

export function isProDaysAnswer(value: unknown): value is ProDaysAnswer {
  if (!isObject(value) || typeof value.at !== "string" || !Array.isArray(value.days)) return false;
  return value.days.every(
    (day: unknown) =>
      isObject(day) &&
      typeof day.pool === "string" &&
      (day.state === "counting" || day.state === "unknown" || (day.state === "ready" && typeof day.at === "string" && isTapeDepth(day.depth) && isObject(day.stats) && isObject(day.stats.volume) && isObject(day.stats.fees))),
  );
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

export function isTapeDepth(value: unknown): value is TapeDepth {
  return isObject(value) && typeof value.transactions === "number" && typeof value.whole === "boolean" && typeof value.stop === "string" && (value.from === null || typeof value.from === "string");
}

const isHead = (value: unknown): value is Head => isObject(value) && typeof value.pool === "string" && isObject(value.pair) && isTapeDepth(value.depth);

export function isProStatsAnswer(value: unknown): value is ProStatsAnswer {
  if (!isHead(value)) return false;
  const stats = (value as Record<string, unknown>).stats;
  return isObject(stats) && isObject(stats.trades) && typeof stats.trades.count === "number" && isObject(stats.volume) && isObject(stats.fees) && isObject(stats.orders);
}

export const isProTradesAnswer = (value: unknown): value is ProTradesAnswer => isHead(value) && Array.isArray((value as Record<string, unknown>).trades);
export const isProFillsAnswer = (value: unknown): value is ProFillsAnswer => isHead(value) && Array.isArray((value as Record<string, unknown>).fills);
