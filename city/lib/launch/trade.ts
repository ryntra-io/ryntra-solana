import type {
  LaunchMarketResponse,
  LaunchTradeBuildRequest,
  LaunchTradeBuildResponse,
  LaunchTradeQuoteRequest,
  LaunchTradeQuoteResponse,
  LaunchTradeReceiptRequest,
  LaunchTradeReceiptResponse,
  LaunchTradeSubmitRequest,
  LaunchTradeSubmitResponse,
  LaunchWalletResponse,
} from '../../../lib/api/v1/contract.ts';
import { API_HEADERS, type Answer } from './engine.ts';

/**
 * Buying and selling a launched coin from its tower (L1, the operator's Launch strategy of 29.10): the city's line to the
 * engine's own trade routes — `/api/v1/launch/{mint}/trade/{quote,build,submit,receipt}` — on its curve before it
 * graduates and in its DAMM v2 pool after. The city counts nothing about money: every figure here is the engine's
 * quote, only cut into the words and shares a screen shows. Pure, so the tests read it.
 */

export type Side = 'buy' | 'sell';

/** The engine's trade routes for one coin, and the two reads around them. */
export interface LaunchTradeEngine {
  market(token: string): Promise<Answer<LaunchMarketResponse>>;
  wallet(token: string, address: string): Promise<Answer<LaunchWalletResponse>>;
  quote(token: string, body: LaunchTradeQuoteRequest): Promise<Answer<LaunchTradeQuoteResponse>>;
  build(token: string, body: LaunchTradeBuildRequest): Promise<Answer<LaunchTradeBuildResponse>>;
  submit(token: string, body: LaunchTradeSubmitRequest): Promise<Answer<LaunchTradeSubmitResponse>>;
  receipt(token: string, body: LaunchTradeReceiptRequest): Promise<Answer<LaunchTradeReceiptResponse>>;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The engine over HTTP, on the same origin. A failed call or an answer that is not the engine's is `UNAVAILABLE`. */
export function httpTradeEngine(fetcher: typeof fetch = (input, init) => fetch(input, init)): LaunchTradeEngine {
  async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
    try {
      const response = await fetcher(path, { cache: 'no-store', ...init, headers: { ...API_HEADERS, ...(init?.headers ?? {}) } });
      const body = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
      if (!response.ok || !body) {
        const code = typeof body?.error?.code === 'string' ? body.error.code : 'UNAVAILABLE';
        const message = typeof body?.error?.message === 'string' ? body.error.message : '';
        return { ok: false, code, message };
      }
      return { ok: true, data: body as T };
    } catch {
      return { ok: false, code: 'UNAVAILABLE', message: '' };
    }
  }
  const refused = <T>(): Promise<Answer<T>> => Promise.resolve({ ok: false, code: 'VALIDATION_ERROR', message: '' });
  const post = <T>(token: string, route: string, body: unknown) =>
    BASE58.test(token) ? call<T>(`/api/v1/launch/${token}/trade/${route}`, { method: 'POST', body: JSON.stringify(body) }) : refused<T>();
  return {
    market: (token) => (BASE58.test(token) ? call(`/api/v1/launch/${token}/market`) : refused()),
    wallet: (token, address) => (BASE58.test(token) && BASE58.test(address) ? call(`/api/v1/launch/${token}/wallet/${address}`) : refused()),
    quote: (token, body) => post(token, 'quote', body),
    build: (token, body) => post(token, 'build', body),
    submit: (token, body) => post(token, 'submit', body),
    receipt: (token, body) => post(token, 'receipt', body),
  };
}

/* ---------------------------------------------------------------- amounts */

/**
 * SOL in, checked 29.10 against the engine: the quote takes `amountRaw` in the launch's pair currency only — the curve
 * (`swapQuote2`) and the pool (`getQuote2`) each spend their quote mint, USDC on every preset the city launches on —
 * and the build signs exactly that swap. There is no SOL leg to ride, so the city's chips are in the pair currency.
 */
export const BUY_CHIPS = [10, 25, 50, 100] as const;
export const SELL_CHIPS = [25, 50, 100] as const;
export const SLIPPAGES = [100, 300, 500, 1000] as const;
export const DEFAULT_SLIPPAGE_BPS = 300;

const TEN = 10n;

/** Whole units of a currency as its raw amount: 25 USDC → 25000000. */
export function wholeToRaw(whole: number, decimals: number): string {
  if (!Number.isInteger(whole) || whole < 0) throw new RangeError('whole: a whole, non-negative number');
  return (BigInt(whole) * TEN ** BigInt(decimals)).toString();
}

/** A share of a holding, rounded down, so a sale never asks for more than the wallet holds. */
export function shareOfRaw(raw: string, pct: number): string {
  if (pct >= 100) return BigInt(raw).toString();
  return ((BigInt(raw) * BigInt(Math.max(0, Math.floor(pct)))) / 100n).toString();
}

/** A raw amount as a number of units, for words only — never sent back to the engine. */
export function rawToNumber(raw: string, decimals: number): number {
  const value = BigInt(raw);
  const unit = TEN ** BigInt(decimals);
  return Number(value / unit) + Number(value % unit) / Number(unit);
}

/** A chip the wallet cannot pay: a buy over its pair balance. Unknown balance — every chip stays open. */
export function chipFits(chipRaw: string, heldRaw: string | null): boolean {
  return heldRaw === null || BigInt(chipRaw) <= BigInt(heldRaw);
}

/* ---------------------------------------------------------------- the fee line */

export type FeeNow = Readonly<{
  venue: 'curve' | 'pool';
  /** What this trade pays now, all fees in, from the quote — the schedule plus any surcharge the price's swings add. */
  nowBps: number;
  /** Where the launch fee falls to; null in the pool, or once it has fallen. */
  endBps: number | null;
  /** Seconds until it has fallen; null when it is not falling. */
  leftS: number | null;
}>;

/**
 * The live fee: the quote's own when there is one, the market's read of the curve when the panel has no amount yet.
 * The falling part is the curve's schedule (`curveFee.sniperUntil`), counted on this device's clock.
 */
export function feeNow(market: Pick<LaunchMarketResponse, 'venue' | 'curveFee'>, quoteFeeBps: number | null, nowMs: number): FeeNow | null {
  const venue = market.venue;
  const nowBps = quoteFeeBps ?? market.curveFee?.nowBps ?? null;
  if (nowBps === null) return null;
  const curve = venue === 'curve' ? market.curveFee : null;
  const until = curve?.sniperUntil ? Date.parse(curve.sniperUntil) : NaN;
  const leftS = Number.isFinite(until) ? Math.ceil((until - nowMs) / 1000) : 0;
  const falling = curve !== null && leftS > 0 && nowBps > curve.endBps;
  return { venue, nowBps, endBps: falling ? curve.endBps : null, leftS: falling ? leftS : null };
}

/** Seconds as the line counts them: 48 → 0:48, 312 → 5:12. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- who earns the fee */

export type FeeEarner = 'creator' | 'ryntra' | 'meteora' | 'creatorPosition' | 'ryntraPosition' | 'liquidity' | 'compounding';
export type FeeShare = Readonly<{ who: FeeEarner; raw: string; bps: number }>;

/**
 * Who receives this trade's fee, by the quote's own split. On the curve: the creator, Ryntra (partner and referral)
 * and Meteora. In the pool: the locked liquidity — the creator's and Ryntra's positions of the move to the DEX, the
 * other positions, the part compounded back — then Meteora and Ryntra's referral. Nothing zero is listed.
 */
export function feeShares(quote: Pick<LaunchTradeQuoteResponse, 'venue' | 'fee'>): readonly FeeShare[] {
  const { fee } = quote;
  const total = BigInt(fee.totalRaw);
  const rows: [FeeEarner, string | null | undefined][] =
    quote.venue === 'curve'
      ? [
          ['creator', fee.creatorRaw],
          ['ryntra', fee.ryntraRaw],
          ['meteora', fee.meteoraRaw],
        ]
      : fee.liquidity
        ? [
            ['creatorPosition', fee.liquidity.creatorRaw],
            ['ryntraPosition', fee.liquidity.ryntraRaw],
            ['liquidity', fee.liquidity.othersRaw],
            ['compounding', fee.liquidity.compoundingRaw],
            ['meteora', fee.meteoraRaw],
            ['ryntra', fee.ryntraRaw],
          ]
        : [
            ['liquidity', fee.liquidityRaw],
            ['meteora', fee.meteoraRaw],
            ['ryntra', fee.ryntraRaw],
          ];
  return rows
    .filter((row): row is [FeeEarner, string] => typeof row[1] === 'string' && BigInt(row[1]) > 0n)
    .map(([who, raw]) => ({ who, raw, bps: total > 0n ? Number((BigInt(raw) * 10_000n) / total) : 0 }));
}

/* ---------------------------------------------------------------- the way to the DEX */

export type Progress =
  | Readonly<{ migrated: false; pct: number; capUsd: number | null; graduationUsd: number | null }>
  | Readonly<{ migrated: true; jupiter: boolean }>;

/** The bonding bar from the engine's read: the curve's share of its way, rounded down, and the cap against the exit. */
export function progressOf(market: Pick<LaunchMarketResponse, 'progress' | 'marketCap' | 'trading'>, graduationUsd: number | null): Progress {
  if (market.progress.migrated) return { migrated: true, jupiter: market.trading.jupiter };
  return { migrated: false, pct: Math.floor(market.progress.bps / 100), capUsd: market.marketCap.usd, graduationUsd };
}

/* ---------------------------------------------------------------- the review the person signs on */

export type Units = Readonly<{ token: string; tokenDecimals: number; pair: string; pairDecimals: number }>;

export type Review = Readonly<{
  side: Side;
  /** What the trade spends and receives, as the quote says, in units. */
  spend: number;
  get: number;
  minimum: number;
  /** Every fee of the trade, in the pair currency. */
  fee: number;
  feeBps: number;
  priceMoveBps: number;
  /** A buy the curve cannot take whole before it graduates leaves this much of the pair currency in the wallet. */
  left: number;
  spendSymbol: string;
  getSymbol: string;
}>;

/** One quote as the one line before signing reads it. */
export function reviewOf(quote: LaunchTradeQuoteResponse, units: Units): Review {
  const buy = quote.side === 'buy';
  const inDecimals = buy ? units.pairDecimals : units.tokenDecimals;
  const outDecimals = buy ? units.tokenDecimals : units.pairDecimals;
  return {
    side: quote.side,
    spend: rawToNumber(quote.amountInRaw, inDecimals),
    get: rawToNumber(quote.amountOutRaw, outDecimals),
    minimum: rawToNumber(quote.minimumOutRaw, outDecimals),
    fee: rawToNumber(quote.fee.totalRaw, units.pairDecimals),
    feeBps: quote.feeBps,
    priceMoveBps: quote.priceMoveBps,
    left: buy ? rawToNumber(quote.amountLeftRaw, units.pairDecimals) : 0,
    spendSymbol: buy ? units.pair : units.token,
    getSymbol: buy ? units.token : units.pair,
  };
}

/** The route a trade runs on now, by the engine's read: the curve, or the DAMM v2 pool (and Jupiter where it routes). */
export function routeOf(market: Pick<LaunchMarketResponse, 'venue' | 'trading'>): 'curve' | 'pool' | 'poolJupiter' {
  if (market.venue === 'curve') return 'curve';
  return market.trading.jupiter ? 'poolJupiter' : 'pool';
}

/** What the wallet holds after a trade, at once, before the chain is read again: the fill moved onto the last read. */
export function heldAfter(held: Readonly<{ tokenRaw: string; pairRaw: string }>, side: Side, filled: Readonly<{ tokensRaw: string; pairRaw: string }>): Readonly<{ tokenRaw: string; pairRaw: string }> {
  const clamp = (v: bigint) => (v < 0n ? 0n : v).toString();
  const token = BigInt(held.tokenRaw);
  const pair = BigInt(held.pairRaw);
  return side === 'buy'
    ? { tokenRaw: clamp(token + BigInt(filled.tokensRaw)), pairRaw: clamp(pair - BigInt(filled.pairRaw)) }
    : { tokenRaw: clamp(token - BigInt(filled.tokensRaw)), pairRaw: clamp(pair + BigInt(filled.pairRaw)) };
}

/** Where anyone can see the trade: Solscan, on the trade's own cluster. */
export function explorerUrl(signature: string, network: 'solana:devnet' | 'solana:mainnet'): string {
  return `https://solscan.io/tx/${signature}${network === 'solana:devnet' ? '?cluster=devnet' : ''}`;
}
