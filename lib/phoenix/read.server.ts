import {
  PHOENIX_API_URL,
  accountFrom,
  bookFrom,
  candlesFrom,
  candlesQuery,
  fundingFrom,
  marketsFrom,
  noAccount,
  type FuturesAccount,
  type FuturesBook,
  type FuturesCandles,
  type FuturesFunding,
  type FuturesMarkets,
  type FuturesTimeframe,
} from "./market-data.ts";
import { marginFrom, marginWire, traderAccountOf, traderSubaccountOf, type PhoenixMargin } from "./collateral.ts";
import { HISTORY_LIMIT, fundingHistoryFrom, orderHistoryFrom, tradesFrom, type FuturesFundingHistory, type FuturesOrdersHistory, type FuturesTrades } from "./history.ts";

/**
 * Phoenix's public API from Ryntra's server (B7): the browser asks Ryntra's routes and never Phoenix, so one edge
 * cache answers everyone who looks at the same market. No key, no session, no signature: only the public reads the
 * B7a audit named (§9), each under its own deadline. A 429 is passed on as such; anything else that fails is the
 * source being down, never a number made up.
 */

const DEADLINE_MS = 8_000;

export type PhoenixRead<T> = { ok: true; value: T } | { ok: false; code: "RATE_LIMITED" | "NOT_FOUND" | "UPSTREAM"; status: number };

export async function getJson(path: string): Promise<PhoenixRead<unknown>> {
  try {
    const response = await fetch(`${PHOENIX_API_URL}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    if (response.status === 429) return { ok: false, code: "RATE_LIMITED", status: 429 };
    if (response.status === 404) return { ok: false, code: "NOT_FOUND", status: 404 };
    if (!response.ok) return { ok: false, code: "UPSTREAM", status: response.status };
    return { ok: true, value: (await response.json()) as unknown };
  } catch {
    return { ok: false, code: "UPSTREAM", status: 0 };
  }
}

/** The markets with their latest stats: two reads at once, joined by symbol. */
export async function readFuturesMarkets(now: () => number = Date.now): Promise<PhoenixRead<FuturesMarkets>> {
  const [config, stats] = await Promise.all([getJson("/v1/view/exchange/markets"), getJson("/v1/markets/stats/latest")]);
  if (!config.ok) return config;
  /* Stats that failed leave the list without prices rather than without markets. */
  return { ok: true, value: marketsFrom(config.value, stats.ok ? stats.value : null, now()) };
}

/** How long one process keeps the markets' units for the accounts' reads: they change when Phoenix lists a market. */
const UNITS_TTL_MS = 60_000;
let units: { at: number; markets: FuturesMarkets["markets"] } | null = null;

/** The markets' tick sizes and decimals for a trader state's ticks and lots — one read a minute per process, not one per account read. */
async function marketUnits(now: () => number): Promise<FuturesMarkets["markets"]> {
  if (units && now() - units.at < UNITS_TTL_MS) return units.markets;
  const read = await readFuturesMarkets(now);
  if (read.ok) units = { at: now(), markets: read.value.markets };
  return units?.markets ?? [];
}

/** One market's book, uncut by the execution band (B7a §9: `bypassExecutionBand=true`). */
export async function readFuturesBook(symbol: string, now: () => number = Date.now): Promise<PhoenixRead<FuturesBook>> {
  const read = await getJson(`/v1/view/orderbook/${encodeURIComponent(symbol)}?bypassExecutionBand=true`);
  return read.ok ? { ok: true, value: bookFrom(read.value, symbol, now()) } : read;
}

/**
 * One market's newest funding rate (PERP-4): `GET /v1/funding/{symbol}/rates` — the newest point and the period it is
 * for. A market without a recent point is not found: no rate is made up.
 */
export async function readFuturesFunding(symbol: string, now: () => number = Date.now): Promise<PhoenixRead<FuturesFunding>> {
  const at = now();
  const read = await getJson(`/v1/funding/${encodeURIComponent(symbol)}/rates?limit=24`);
  if (!read.ok) return read;
  const funding = fundingFrom(read.value, symbol, at);
  return funding ? { ok: true, value: funding } : { ok: false, code: "NOT_FOUND", status: 404 };
}

/* ---------------------------------------------------- a wallet's history */

/*
 * Each history takes its own spelling of the same two narrowings (SDK `api/{trades,orders,funding}/client.ts`): the
 * trades want `pdaIndex` and `marketSymbol`, the orders `traderPdaIndex` and `marketSymbol`, the funding
 * `traderPdaIndex` and `symbol`. A name Phoenix does not know would quietly widen the read past the row limit, so each
 * is written out rather than shared — and the parser narrows by market again whatever comes back.
 */
const historyQuery = (pda: "pdaIndex" | "traderPdaIndex", market: "marketSymbol" | "symbol", symbol: string | null): string =>
  `${pda}=0&limit=${HISTORY_LIMIT}${symbol ? `&${market}=${encodeURIComponent(symbol)}` : ""}`;

/**
 * A wallet's own fills, orders and funding on Phoenix (PERP-5, spec §11.1): the three public reads of the trader's
 * history, each on subaccount 0 — the account Ryntra trades. Public, as the account read is: no key, no signature.
 */
export async function readFuturesTrades(wallet: string, symbol: string | null, now: () => number = Date.now): Promise<PhoenixRead<FuturesTrades>> {
  const [read, markets] = await Promise.all([getJson(`/v1/trader/${encodeURIComponent(wallet)}/trades-history?${historyQuery("pdaIndex", "marketSymbol", symbol)}`), marketUnits(now)]);
  if (!read.ok) return read;
  /* A fill states its size in base lots: the asset's amount is the market's own decimals, from the units read above. */
  const decimals = new Map(markets.filter((market) => market.baseLotsDecimals !== null).map((market) => [market.symbol.toLowerCase(), market.baseLotsDecimals as number]));
  return { ok: true, value: tradesFrom(read.value, wallet, symbol, now(), (market) => decimals.get(market.toLowerCase()) ?? null) };
}

export async function readFuturesOrderHistory(wallet: string, symbol: string | null, now: () => number = Date.now): Promise<PhoenixRead<FuturesOrdersHistory>> {
  const read = await getJson(`/v1/trader/${encodeURIComponent(wallet)}/order-history?${historyQuery("traderPdaIndex", "marketSymbol", symbol)}`);
  return read.ok ? { ok: true, value: orderHistoryFrom(read.value, wallet, symbol, now()) } : read;
}

export async function readFuturesFundingHistory(wallet: string, symbol: string | null, now: () => number = Date.now): Promise<PhoenixRead<FuturesFundingHistory>> {
  const read = await getJson(`/v1/trader/${encodeURIComponent(wallet)}/funding-history?${historyQuery("traderPdaIndex", "symbol", symbol)}`);
  return read.ok ? { ok: true, value: fundingHistoryFrom(read.value, wallet, symbol, now()) } : read;
}

/** One market's newest bars of a timeframe, the traded price's and the mark price's. */
export async function readFuturesCandles(symbol: string, timeframe: FuturesTimeframe, now: () => number = Date.now): Promise<PhoenixRead<FuturesCandles>> {
  const at = now();
  const read = await getJson(`/v1/candles_v2/${encodeURIComponent(symbol)}?${candlesQuery(timeframe, at)}`);
  return read.ok ? { ok: true, value: candlesFrom(read.value, symbol, timeframe, at) } : read;
}

/**
 * The margin of a wallet's trader account (B6): `GET /v1/view/trader/{traderAccount}` by the account's address — PDA
 * `["trader", wallet, 0, 0]` — the figures the trader state does not carry: what positions hold, what is free to
 * withdraw, how near liquidation, and whether Phoenix takes a deposit or a withdrawal now. Not found: no account.
 */
export async function readTraderMargin(wallet: string): Promise<PhoenixRead<PhoenixMargin>> {
  return readMarginOf(() => traderAccountOf(wallet));
}

/** One trader account's margin view, by the address `account` derives; not found for a string that is no key. */
async function readMarginOf(account: () => string): Promise<PhoenixRead<PhoenixMargin>> {
  let address: string;
  try {
    address = account();
  } catch {
    /* A string shaped like an address that is no key has no account. */
    return { ok: false, code: "NOT_FOUND", status: 404 };
  }
  const read = await getJson(`/v1/view/trader/${encodeURIComponent(address)}`);
  return read.ok ? { ok: true, value: marginFrom(read.value) } : read;
}

/** The most other subaccounts one account read asks the margin of: a wallet rarely isolates more markets at once. */
const MAX_SUBACCOUNT_READS = 4;

/**
 * The margin view of an isolated subaccount (SOL-C7): its positions' liquidation prices and leverage and its own risk,
 * which the first subaccount's view does not carry. Read only; a subaccount that does not answer is left out.
 */
async function readSubaccountMargin(wallet: string, subaccount: number): Promise<PhoenixMargin | null> {
  const read = await readMarginOf(() => traderSubaccountOf(wallet, subaccount));
  if (!read.ok) return null;
  const margin = read.value;
  /* The view names its own subaccount; the address read is the one that counts. */
  return { ...margin, positions: (margin.positions ?? []).map((position) => ({ ...position, subaccount })) };
}

/**
 * A wallet's trader account at PDA index 0 — the account phoenix.trade opens for the same wallet (B7a §7) — by its
 * public address alone. A wallet Phoenix does not know is an answer, not an error: it has no account yet.
 */
export async function readFuturesAccount(wallet: string, now: () => number = Date.now): Promise<PhoenixRead<FuturesAccount>> {
  const [state, markets, margin] = await Promise.all([getJson(`/v1/trader/state/${encodeURIComponent(wallet)}?traderPdaIndex=0`), marketUnits(now), readTraderMargin(wallet)]);
  if (!state.ok) return state.code === "NOT_FOUND" ? { ok: true, value: noAccount(wallet, now()) } : state;
  const account = accountFrom(state.value, wallet, markets, now());
  /* Positions on other subaccounts are isolated: each has its own margin view, read beside the first. */
  const others = [...new Set(account.positions.map((position) => position.subaccount).filter((index) => Number.isInteger(index) && index > 0 && index < 256))].slice(0, MAX_SUBACCOUNT_READS);
  const subaccountMargins = (await Promise.all(others.map((index) => readSubaccountMargin(wallet, index)))).filter((read): read is PhoenixMargin => read !== null).map(marginWire);
  /* A margin read that failed leaves the account without its margin rather than without the account. */
  return { ok: true, value: { ...account, margin: margin.ok ? marginWire(margin.value) : null, ...(subaccountMargins.length ? { subaccountMargins } : {}) } };
}
