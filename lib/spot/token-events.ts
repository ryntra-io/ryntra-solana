/**
 * The coin's trades from the chain's own events: Helius Parsed Events Scan over the coin's mint address,
 * the second source of «хто купив» beside GeckoTerminal's one pool.
 *
 * Pure and client-safe: the request's body and the reading of an answer. `token-events.server.ts` sends it, behind
 * the deployment's closed switch; without it the page reads GeckoTerminal as before.
 *
 * The answer's shape is the one Helius publishes (`helius-sdk` 3.5.0, `parsedEvents/types.d.ts`, read 19.11.2026):
 * `data[]` of `{ signature, parserStatus, parsed: { blockTime, fee, feePayer, transactionStatus, nativeTransfers[],
 * tokenTransfers[], summary, instructions[] } }`, a `paginationToken` while the history goes on, and a `scan` block
 * with `stoppedOn`, `scannedTransactions`, `matchedTransactions` and `creditsCharged`.
 *
 * **Who traded.** The fee payer, when its own balance of the coin moved: in — a buy, out — a sale. When it did not —
 * a relayer paid the fee for someone (a sixth of a young coin's trades on 20.11.2026) — the trader is the one wallet
 * whose balance of the coin moved; a wallet is an address on the curve (`EventsPricing.isWallet`), so a pool's or a
 * program's account is never taken for a person. Coin that only passed through the wallet — a route's hop, an
 * arbitrage's round trip leaving dust — is no trade of the coin (`PASS_THROUGH_SHARE`).
 *
 * **What it paid or got**, in this order:
 * 1. the venue's own record of the trade where the venue writes one — pump.fun's curve emits a `TradeEvent` with the
 *    SOL and the tokens of every trade, and pays a sale's SOL out of the curve's account without a transfer, so the
 *    transfers alone show no payment for any sale on the curve (every sale of $LA BEAST on 20.11.2026: 22 of 79
 *    trades) — taken only where the curve is priced in SOL;
 * 2. else the wallet's own transfers in the same transaction: dollars of USDC or USDT moved the other way, else SOL
 *    moved the other way — wrapped SOL and plain lamports alike, with the wallet's own token accounts (the wrapping,
 *    the rent of a new account, the closing of one) left out — priced at SOL's price of the read.
 *
 * **Whole or not a row.** A trade is listed only with its size, its dollars and its price (`isWholeTrade`). A swap of
 * the coin whose payment the page cannot read — it came from a program's own account, in another coin, or SOL's price
 * is not known — is an `UnpricedTrade`: never a row with dashes. The page may take its price from the pools' trades by
 * the same signature (`fillUnpriced`); else it is not shown. Tokens that moved with nothing moving back, in a
 * transaction Helius does not call a swap, are a transfer and are left out.
 *
 * Helius's events are an index, not settlement: these figures are for the page to show who traded, never for money
 * Ryntra moves or counts.
 */

import { WRAPPED_SOL_MINT } from "../solana/send-kinds.ts";
import { USDC_MINT, USDT_MINT } from "./coin-shelf.ts";
import { isWholeTrade, type TokenTrade } from "./token-page.ts";

/** The dollar tokens a trade is paid in: the same two mints the rest of the Spot names. */
const STABLE_MINTS: readonly string[] = [USDC_MINT, USDT_MINT];
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Matches one page asks for: Helius's own ceiling for the parsed shape. */
export const EVENTS_PAGE_LIMIT = 100;
/**
 * The most history one call scans: a page of history is up to a thousand transactions and costs a credit, so a call
 * costs at most 10 + 3 credits. A coin's mint sees mostly trades, so a hundred matches rarely take more than a page.
 */
export const EVENTS_SCAN_BUDGET = 3_000;

/**
 * Coin that came to a wallet and left it in one transaction is no trade of the coin when what stayed is under this
 * share of the largest movement of the coin in the transaction: a route's hop or an arbitrage's dust.
 */
export const PASS_THROUGH_SHARE = 0.01;

export type EventsQuery = Readonly<{
  mint: string;
  limit?: number;
  paginationToken?: string | null;
  /** Unix seconds: only transactions at or after this time (a refresh of a list already read). */
  sinceS?: number;
}>;

/** One request's body: only the fields Helius knows. */
export function eventsBody(query: EventsQuery): Record<string, unknown> {
  return {
    address: query.mint,
    match: { mints: [{ mint: query.mint, scope: "address" }] },
    returnShape: "transactions",
    limit: Math.max(1, Math.min(EVENTS_PAGE_LIMIT, Math.floor(query.limit ?? EVENTS_PAGE_LIMIT))),
    commitment: "confirmed",
    sortOrder: "desc",
    status: "succeeded",
    tokenAccounts: "none",
    rawTransaction: "none",
    budget: { maxScannedTransactions: EVENTS_SCAN_BUDGET },
    ...(query.sinceS !== undefined ? { time: { gte: Math.floor(query.sinceS) } } : {}),
    ...(query.paginationToken ? { paginationToken: query.paginationToken } : {}),
  };
}

export type EventsPricing = Readonly<{
  /** The circulating supply the capitalisation at a trade is counted on; null — not counted (a stock). */
  capSupply: number | null;
  /** A scaled-UI token's active multiplier (a stock's); null — none. */
  multiplier: number | null;
  /** SOL's price in dollars, for trades paid in SOL; null — those trades have no price and are not listed. */
  solPriceUsd: number | null;
  /**
   * Whether an address is a wallet's own key (on the curve) and not a program's account. With it, a trade whose fee a
   * relayer paid is read as its trader's; without it only the fee payer's own trades are read.
   */
  isWallet?: (address: string) => boolean;
}>;

/** Why a swap of the coin has no price the page can state. */
export type UnpricedWhy = "no-payment" | "no-sol-price" | "off-market";

/** A swap of the coin the page cannot price from the transaction: listed only if the pools' trades price it. */
export type UnpricedTrade = Readonly<{
  signature: string;
  at: string;
  side: TokenTrade["side"];
  wallet: string;
  tokenAmount: number;
  feeSol?: number;
  why: UnpricedWhy;
}>;

export type EventsPage = Readonly<{
  trades: TokenTrade[];
  /** Swaps of the coin in this answer that have no price of their own. */
  unpriced: UnpricedTrade[];
  /** Where the next call resumes; null — the history (or the window) ended. */
  next: string | null;
  stoppedOn: string | null;
  scanned: number;
  matched: number;
  credits: number;
}>;

/** The answer is not the published shape: the page falls back rather than reading a short list as a whole one. */
export class EventsMalformed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventsMalformed";
  }
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/u;
const EPS = 1e-12;

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const address = (value: unknown): string | null => (typeof value === "string" && BASE58.test(value) ? value : null);

type Transfer = Readonly<{ from: string | null; to: string | null; fromAccount: string | null; toAccount: string | null; mint: string | null; amount: number | null; raw: number | null }>;

function tokenTransfersOf(parsed: Record<string, unknown>): Transfer[] {
  const list = Array.isArray(parsed.tokenTransfers) ? parsed.tokenTransfers : [];
  return list.flatMap((entry) => {
    const row = record(entry);
    if (!row) return [];
    const raw = number(row.rawTokenAmount);
    const decimals = number(row.decimals);
    const known = raw !== null && decimals !== null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18;
    return [{
      from: address(row.fromUserAccount),
      to: address(row.toUserAccount),
      fromAccount: address(row.fromTokenAccount),
      toAccount: address(row.toTokenAccount),
      mint: address(row.mint),
      amount: known ? raw / 10 ** decimals : null,
      raw: known ? raw : null,
    }];
  });
}

/** The wallet's net of some mints in the transaction's token transfers: in is plus. `raw` — the same in the mint's smallest units. */
function netOf(transfers: readonly Transfer[], wallet: string, mints: ReadonlySet<string>): Readonly<{ net: number; raw: number; moved: boolean }> {
  let net = 0;
  let raw = 0;
  let moved = false;
  for (const transfer of transfers) {
    if (!transfer.mint || !mints.has(transfer.mint) || transfer.amount === null || transfer.raw === null) continue;
    if (transfer.to === wallet && transfer.from !== wallet) {
      net += transfer.amount;
      raw += transfer.raw;
      moved = true;
    } else if (transfer.from === wallet && transfer.to !== wallet) {
      net -= transfer.amount;
      raw -= transfer.raw;
      moved = true;
    }
  }
  return { net, raw, moved };
}

/** Whether Helius's own summary of the transaction, or of one of its instructions, calls it a swap. */
function isSwap(parsed: Record<string, unknown>): boolean {
  if (record(parsed.summary)?.type === "swap") return true;
  const instructions = Array.isArray(parsed.instructions) ? parsed.instructions : [];
  return instructions.some((entry) => record(record(entry)?.summary)?.type === "swap");
}

/* ----------------------------------------------------- the venue's own record */

/** pump.fun's curve program. */
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
/* An Anchor program's event written to itself, and pump.fun's `TradeEvent` in it: the two eight-byte tags its data opens with. */
const EVENT_TAG = [0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d, 0xbd, 0xdb, 0x7f, 0xd3, 0x4e, 0xe6, 0x61, 0xee] as const;
/* `TradeEvent`: mint, sol_amount, token_amount, is_buy, user, timestamp, four reserves, fee_recipient, fee_basis_points, fee, creator, creator_fee_basis_points, creator_fee, … */
const AT = { mint: 16, sol: 48, token: 56, isBuy: 64, user: 65, head: 97, fee: 177, creatorFee: 225, withFees: 233 } as const;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/* An instruction's data longer than this is no trade event. */
const EVENT_TEXT_MOST = 1_200;

function base58Bytes(text: string): Uint8Array | null {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of text) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function u64At(bytes: Uint8Array, at: number): number {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = value * 256n + BigInt(bytes[at + index] ?? 0);
  return Number(value);
}

function sameBytes(bytes: Uint8Array, at: number, want: Uint8Array): boolean {
  for (let index = 0; index < want.length; index += 1) if (bytes[at + index] !== want[index]) return false;
  return true;
}

/**
 * What pump.fun's curve itself recorded of this wallet's trade of the coin in the transaction: the tokens, and the
 * lamports the wallet paid (the curve's and the creator's fee on top) or got (the two fees taken off). Read from the
 * program's own event in the instructions' raw data — the same bytes the chain keeps. Null where there is none.
 */
function curveRecordOf(parsed: Record<string, unknown>, mint: string, wallet: string, side: TokenTrade["side"]): Readonly<{ lamports: number; raw: number }> | null {
  const instructions = Array.isArray(parsed.instructions) ? parsed.instructions : [];
  let mintBytes: Uint8Array | null = null;
  let walletBytes: Uint8Array | null = null;
  let lamports = 0;
  let raw = 0;
  let found = false;
  for (const entry of instructions) {
    const row = record(entry);
    if (!row || row.programId !== PUMP_PROGRAM || typeof row.rawData !== "string" || row.rawData.length > EVENT_TEXT_MOST) continue;
    const bytes = base58Bytes(row.rawData);
    if (!bytes || bytes.length < AT.head || !EVENT_TAG.every((byte, index) => bytes[index] === byte)) continue;
    mintBytes ??= base58Bytes(mint);
    walletBytes ??= base58Bytes(wallet);
    if (!mintBytes || !walletBytes || mintBytes.length !== 32 || walletBytes.length !== 32) return null;
    if (!sameBytes(bytes, AT.mint, mintBytes) || !sameBytes(bytes, AT.user, walletBytes)) continue;
    if ((bytes[AT.isBuy] === 1) !== (side === "buy")) continue;
    const fees = bytes.length >= AT.withFees ? u64At(bytes, AT.fee) + u64At(bytes, AT.creatorFee) : 0;
    const sol = u64At(bytes, AT.sol);
    lamports += side === "buy" ? sol + fees : Math.max(0, sol - fees);
    raw += u64At(bytes, AT.token);
    found = true;
  }
  return found ? { lamports, raw } : null;
}

/* --------------------------------------------------------------- one trade */

/** One parsed transaction read: a whole trade, a swap of the coin without a price, or neither (`null`). */
export type ParsedReading = Readonly<{ trade: TokenTrade; unpriced?: undefined } | { unpriced: UnpricedTrade; trade?: undefined }>;

/** The trader of the coin in the transaction: the fee payer, else the one wallet whose balance of the coin moved. */
function traderOf(transfers: readonly Transfer[], payer: string, mint: string, isWallet: EventsPricing["isWallet"]): Readonly<{ wallet: string; coin: ReturnType<typeof netOf> }> | null {
  const coinMint = new Set([mint]);
  const own = netOf(transfers, payer, coinMint);
  if (Math.abs(own.net) > EPS) return { wallet: payer, coin: own };
  if (!isWallet) return null;
  const others = new Set<string>();
  for (const transfer of transfers) {
    if (transfer.mint !== mint) continue;
    if (transfer.from && transfer.from !== payer) others.add(transfer.from);
    if (transfer.to && transfer.to !== payer) others.add(transfer.to);
  }
  let found: { wallet: string; coin: ReturnType<typeof netOf> } | null = null;
  for (const wallet of others) {
    const coin = netOf(transfers, wallet, coinMint);
    if (Math.abs(coin.net) <= EPS || !isWallet(wallet)) continue;
    /* Two wallets whose coin moved are a transfer between people, or a bundle: not one trader's trade. */
    if (found) return null;
    found = { wallet, coin };
  }
  return found;
}

/** One parsed transaction → the trade of the coin in it, whole or unpriced; null when it is not one. */
export function readParsed(signature: string, parsedRaw: unknown, mint: string, pricing: EventsPricing): ParsedReading | null {
  const parsed = record(parsedRaw);
  if (!parsed || parsed.transactionStatus !== "OK") return null;
  const payer = address(parsed.feePayer);
  const blockTime = number(parsed.blockTime);
  if (!payer || blockTime === null) return null;
  const transfers = tokenTransfersOf(parsed);
  const trader = traderOf(transfers, payer, mint, pricing.isWallet);
  if (!trader) return null;
  const { wallet, coin } = trader;
  /* Coin that only passed through: what stayed is a sliver of what moved. */
  let largest = 0;
  for (const transfer of transfers) if (transfer.mint === mint && transfer.amount !== null && transfer.amount > largest) largest = transfer.amount;
  if (Math.abs(coin.net) < largest * PASS_THROUGH_SHARE) return null;

  const side: TokenTrade["side"] = coin.net > 0 ? "buy" : "sell";
  /* The other side moves the other way: a buy pays (minus), a sale gets (plus). */
  const against = side === "buy" ? -1 : 1;
  const solPrice = pricing.solPriceUsd !== null && Number.isFinite(pricing.solPriceUsd) && pricing.solPriceUsd > 0 ? pricing.solPriceUsd : null;

  let usd: number | null = null;
  let why: UnpricedWhy = "no-payment";
  /*
   * 1. The venue's own record of this very trade: the same tokens, to a hundredth. Its figure is SOL only on a curve
   *    priced in SOL — pump.fun also launches a coin against another coin, and writes that coin's units in the same
   *    field — so it is taken only where no other token moved in the transaction: the coin itself and wrapped SOL.
   */
  const solOnly = transfers.every((transfer) => transfer.mint === mint || transfer.mint === WRAPPED_SOL_MINT);
  const venue = solOnly ? curveRecordOf(parsed, mint, wallet, side) : null;
  if (venue && venue.lamports > 0 && Math.abs(venue.raw - Math.abs(coin.raw)) <= Math.abs(coin.raw) * 0.01) {
    if (solPrice !== null) usd = (venue.lamports / LAMPORTS_PER_SOL) * solPrice;
    else why = "no-sol-price";
  } else {
    /* 2. The wallet's own transfers: dollars and SOL that moved the other way. */
    const stable = netOf(transfers, wallet, new Set(STABLE_MINTS.filter((entry) => entry !== mint)));
    const dollars = Math.max(0, stable.net * against);
    let sol = 0;
    if (mint !== WRAPPED_SOL_MINT) {
      const wrapped = netOf(transfers, wallet, new Set([WRAPPED_SOL_MINT]));
      /* The wallet's own token accounts: lamports into or out of them are a wrapping, an account's rent or its closing, not a payment. */
      const own = new Set<string>();
      for (const transfer of transfers) {
        if (transfer.from === wallet && transfer.fromAccount) own.add(transfer.fromAccount);
        if (transfer.to === wallet && transfer.toAccount) own.add(transfer.toAccount);
      }
      let lamports = 0;
      const natives = Array.isArray(parsed.nativeTransfers) ? parsed.nativeTransfers : [];
      for (const entry of natives) {
        const row = record(entry);
        const amount = number(row?.amount);
        if (!row || amount === null) continue;
        const from = address(row.fromUserAccount);
        const to = address(row.toUserAccount);
        if (from === wallet && to !== wallet && !(to && own.has(to))) lamports -= amount;
        else if (to === wallet && from !== wallet && !(from && own.has(from))) lamports += amount;
      }
      sol = Math.max(0, (wrapped.net + lamports / LAMPORTS_PER_SOL) * against);
    }
    const solUsd = solPrice === null ? null : sol * solPrice;
    if (dollars <= EPS && sol <= EPS) {
      /* Tokens that moved with nothing moving back are a transfer, not a trade — unless Helius's own summary calls it a swap. */
      if (!isSwap(parsed)) return null;
    } else if (dollars > EPS && (solUsd === null || dollars >= solUsd)) {
      /* Paid in dollars: the dollars as they moved. A tip or an account's rent in SOL beside them is not the price. */
      usd = dollars;
    } else if (solUsd !== null) {
      /* Paid in SOL: a dollar token's dust beside it (a route's hop) is not the price. */
      usd = solUsd;
    } else {
      why = "no-sol-price";
    }
  }

  const scale = pricing.multiplier !== null && Number.isFinite(pricing.multiplier) && pricing.multiplier > 0 ? pricing.multiplier : 1;
  const tokenAmount = Math.abs(coin.net) * scale;
  const at = new Date(blockTime * 1000).toISOString();
  const fee = number(parsed.fee);
  /* The network fee is the fee payer's: a trader a relayer paid for paid none. */
  const feeSol = wallet !== payer ? 0 : fee !== null && fee >= 0 ? fee / LAMPORTS_PER_SOL : null;
  const withFee = feeSol === null ? {} : { feeSol };
  const priceUsd = usd === null ? null : usd / tokenAmount;
  if (usd === null || priceUsd === null || !isWholeTrade({ tokenAmount, usd, priceUsd })) return { unpriced: { signature, at, side, wallet, tokenAmount, ...withFee, why } };
  const capUsd = pricing.capSupply !== null && pricing.capSupply > 0 ? priceUsd * pricing.capSupply : null;
  return { trade: { signature, at, side, wallet, tokenAmount, usd, priceUsd, capUsd, ...withFee } };
}

/** One parsed transaction → the trade of the coin in it, with its size, dollars and price; null when it is not one or has no price. */
export function tradeOfParsed(signature: string, parsedRaw: unknown, mint: string, pricing: EventsPricing): TokenTrade | null {
  return readParsed(signature, parsedRaw, mint, pricing)?.trade ?? null;
}

/** One Scan answer → the coin's trades in it, newest first, the swaps without a price, and where the history goes on. */
export function tradesOfEvents(answer: unknown, mint: string, pricing: EventsPricing): EventsPage {
  const body = record(answer);
  if (!body) throw new EventsMalformed("The events answer is not an object.");
  if (body.data !== undefined && !Array.isArray(body.data)) throw new EventsMalformed("The events answer carries no list.");
  const scan = record(body.scan);
  if (!scan) throw new EventsMalformed("The events answer carries no scan summary.");
  const trades: TokenTrade[] = [];
  const unpriced: UnpricedTrade[] = [];
  const seen = new Set<string>();
  for (const entry of (body.data as unknown[] | undefined) ?? []) {
    const item = record(entry);
    if (!item) continue;
    const signature = typeof item.signature === "string" && SIGNATURE.test(item.signature) ? item.signature : null;
    if (!signature || item.parserStatus !== "OK" || seen.has(signature)) continue;
    seen.add(signature);
    const reading = readParsed(signature, item.parsed, mint, pricing);
    if (reading?.trade) trades.push(reading.trade);
    else if (reading?.unpriced) unpriced.push(reading.unpriced);
  }
  trades.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const next = typeof body.paginationToken === "string" && body.paginationToken.length > 0 ? body.paginationToken : null;
  return {
    trades,
    unpriced,
    next,
    stoppedOn: typeof scan.stoppedOn === "string" ? scan.stoppedOn : null,
    scanned: number(scan.scannedTransactions) ?? 0,
    matched: number(scan.matchedTransactions) ?? 0,
    credits: number(scan.creditsCharged) ?? 0,
  };
}

/** A list read before and the newer trades of a refresh → one list, newest first, no trade twice, at most `limit`. */
export function mergeTrades(newer: readonly TokenTrade[], older: readonly TokenTrade[], limit: number): TokenTrade[] {
  const seen = new Set<string>();
  const out: TokenTrade[] = [];
  for (const trade of [...newer, ...older]) {
    const key = `${trade.signature}:${trade.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trade);
  }
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out.slice(0, limit);
}

/* ------------------------------------------------------- off the market's price */

/** A trade priced this many times over or under its neighbours' is not at the market's price. */
export const OFF_MARKET_FACTOR = 10;
/** Neighbours each way a trade's price is held against, and the fewest that make a judgement. */
const NEIGHBOURS = 5;
const NEIGHBOURS_LEAST = 3;

function medianOf(values: readonly number[]): number | null {
  if (values.length < NEIGHBOURS_LEAST) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/**
 * The trades whose price stands with the market's, and those far off it. What a wallet itself paid is not always the
 * price of what it got: a bot whose program pays from its own account shows only its tip (10 300 000 tokens for 23
 * cents, 20.11.2026), a cent's worth bought with a fixed fee on top reads twenty times dearer. A trade is off when
 * its price is `OFF_MARKET_FACTOR` times over or under the middle price of the five trades before it **and** of the
 * five after it — so the first trades past a real collapse or a real run stay, standing with one side. With trades on
 * one side only (the newest, the oldest) that side judges; with fewer than three neighbours nothing is judged.
 * `trades` newest first; the order is kept.
 */
export function splitOffMarket(trades: readonly TokenTrade[], factor: number = OFF_MARKET_FACTOR): Readonly<{ kept: TokenTrade[]; off: TokenTrade[] }> {
  const prices = trades.map((trade) => (trade.priceUsd !== null && Number.isFinite(trade.priceUsd) && trade.priceUsd > 0 ? trade.priceUsd : null));
  const far = (price: number, middle: number) => price > middle * factor || price < middle / factor;
  const kept: TokenTrade[] = [];
  const off: TokenTrade[] = [];
  trades.forEach((trade, index) => {
    const price = prices[index];
    if (price === null || price === undefined) {
      kept.push(trade);
      return;
    }
    const pick = (from: number, to: number) => medianOf(prices.slice(Math.max(0, from), Math.max(0, to)).filter((entry): entry is number => entry !== null));
    const newer = pick(index - NEIGHBOURS, index);
    const older = pick(index + 1, index + 1 + NEIGHBOURS);
    const isOff = newer !== null && older !== null ? far(price, newer) && far(price, older) : newer !== null ? far(price, newer) : older !== null ? far(price, older) : false;
    (isOff ? off : kept).push(trade);
  });
  return { kept, off };
}

/** A trade set aside for want of a price, as the spare source may fill it. */
export function unpricedOf(trade: TokenTrade, why: UnpricedWhy): UnpricedTrade {
  return { signature: trade.signature, at: trade.at, side: trade.side, wallet: trade.wallet, tokenAmount: trade.tokenAmount, ...(trade.feeSol !== undefined ? { feeSol: trade.feeSol } : {}), why };
}

/* ------------------------------------------------------------ the spare source */

/** A pool's trade prices a swap of the events when it is the same trade: its tokens within this share of the chain's. */
export const FILL_AMOUNT_SHARE = 0.02;

/**
 * The swaps without a price, priced from the pools' trades where a pool's trade is the same one — the same signature
 * and side, the same tokens to `FILL_AMOUNT_SHARE`. The price is the pool's; the wallet, the tokens, the time and the
 * fee stay the chain's (GeckoTerminal names a relayed trade's fee payer, not its trader). `left` — those no pool's
 * trade prices: not shown.
 */
export function fillUnpriced(unpriced: readonly UnpricedTrade[], spare: readonly TokenTrade[], capSupply: number | null = null): Readonly<{ filled: TokenTrade[]; left: UnpricedTrade[] }> {
  const bySignature = new Map<string, TokenTrade[]>();
  for (const trade of spare) {
    if (!isWholeTrade(trade)) continue;
    const key = `${trade.signature}:${trade.side}`;
    const list = bySignature.get(key);
    if (list) list.push(trade);
    else bySignature.set(key, [trade]);
  }
  const filled: TokenTrade[] = [];
  const left: UnpricedTrade[] = [];
  for (const entry of unpriced) {
    const { why: _why, ...own } = entry;
    void _why;
    const match = (bySignature.get(`${entry.signature}:${entry.side}`) ?? []).find((trade) => Math.abs(trade.tokenAmount - entry.tokenAmount) <= entry.tokenAmount * FILL_AMOUNT_SHARE);
    const priceUsd = match?.priceUsd ?? null;
    if (!match || priceUsd === null || match.usd === null) {
      left.push(entry);
      continue;
    }
    /* The pool's dollars for the chain's tokens: the same figure where the two agree to the unit. */
    const usd = match.usd * (entry.tokenAmount / match.tokenAmount);
    const capUsd = match.capUsd ?? (capSupply !== null && capSupply > 0 ? priceUsd * capSupply : null);
    filled.push({ ...own, usd, priceUsd, capUsd });
  }
  return { filled, left };
}
