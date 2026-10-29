import type { LaunchMarketResponse, LaunchMarketRow, LaunchStatsResponse, LaunchTradeRow } from '../../../lib/api/v1/contract.ts';
import type { TradeJudgement } from '../../../lib/city-economy/honest-count.ts';
import { hallTrades, hallView, type HallMarketRead, type HallView } from './hall.ts';

/**
 * A stand-in for the Hall, for development and screenshots only: answers in the shape of the v1 contract on the devnet
 * stand, the coins and wallets made up, run through the same `hallView` the server runs, with a few trades judged
 * inside one cluster or not checked so the share left out shows. Opened with `?hall=stub` (or `?hall=empty` for an
 * empty week) in a development build; never part of a production bundle, and every screen says «Stub data».
 */

const DAY = 24 * 60 * 60_000;
const PAIR = { mint: '9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB', symbol: 'USDC', decimals: 6, dollar: true } as const;

/** Made-up but well-formed: a base58 run of the given length from a seed. */
function base58(seed: number, length: number): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let out = '';
  let a = seed >>> 0 || 1;
  for (let i = 0; i < length; i += 1) {
    a = (Math.imul(a, 1_103_515_245) + 12_345) >>> 0;
    out += alphabet[a % alphabet.length];
  }
  return out;
}

const wallet = (n: number) => base58(1000 + n, 44);
const signature = (n: number) => base58(5000 + n, 88);

type Coin = Readonly<{ n: number; symbol: string; name: string; capNow: number; trades: ReadonlyArray<readonly [hunter: number, side: 'buy' | 'sell', daysAgo: number, capThen: number]>; fee: string }>;

const COINS: readonly Coin[] = [
  { n: 1, symbol: 'KITE', name: 'Kite', capNow: 61_800, fee: '4210000000', trades: [[11, 'buy', 5.2, 9_100], [12, 'buy', 4.1, 14_700], [13, 'buy', 2.4, 22_300], [12, 'sell', 1.2, 48_000]] },
  { n: 2, symbol: 'MOTH', name: 'Moth', capNow: 88_400, fee: '2385500000', trades: [[14, 'buy', 6.1, 19_500], [15, 'buy', 3.3, 31_000], [11, 'buy', 1.1, 52_000]] },
  { n: 3, symbol: 'NOVA', name: 'Nova', capNow: 23_900, fee: '918000000', trades: [[16, 'buy', 3.8, 8_200], [17, 'buy', 0.6, 17_400]] },
  /* A creator whose week rests on a buy from their own cluster: never on the board, counted as left out. */
  { n: 4, symbol: 'ECHO', name: 'Echo', capNow: 140_000, fee: '9900000000', trades: [[18, 'buy', 4.4, 6_000], [19, 'buy', 2.0, 30_000]] },
];

/** The trades the stand-in has judged inside one cluster (ECHO's first buyer) or not checked yet. */
const INSIDE = new Set([signature(4 * 100 + 0)]);
const UNCHECKED = new Set([signature(3 * 100 + 1)]);

function readsOf(now: number): readonly HallMarketRead[] {
  const observedAt = new Date(now - 40_000).toISOString();
  return COINS.map((coin): HallMarketRead => {
    const token = base58(coin.n, 44);
    const creator = wallet(coin.n);
    const rows: LaunchTradeRow[] = coin.trades
      .map(([hunter, side, daysAgo, capThen], index) => ({
        signature: signature(coin.n * 100 + index),
        at: new Date(now - daysAgo * DAY).toISOString(),
        side,
        venue: 'curve' as const,
        trader: wallet(hunter),
        payer: wallet(hunter),
        traderLabels: index === 0 && coin.n === 2 ? ['sniper' as const] : [],
        tokensRaw: '1000000000',
        pairRaw: '42000000',
        feeRaw: '420000',
        marketCapPair: capThen,
      }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const row = {
      token,
      name: coin.name,
      symbol: coin.symbol,
      image: null,
      preset: 'classic',
      launchedAt: new Date(now - 6.5 * DAY).toISOString(),
      creator,
      technicalValidation: false,
      pair: PAIR,
    } as unknown as LaunchMarketRow;
    const market = {
      network: 'solana:devnet',
      token,
      pair: PAIR,
      marketCap: { pair: coin.capNow, usd: coin.capNow },
      trades: { rows, complete: true, read: rows.length },
      creator: { address: creator, curves: 1, tradesComplete: true },
      observedAt,
    } as unknown as LaunchMarketResponse;
    const stats = {
      network: 'solana:devnet',
      token,
      creator,
      pair: PAIR,
      links: { curve: base58(200 + coin.n, 44), pool: null, position: null, lock: null },
      observedAt,
    } as unknown as LaunchStatsResponse;
    return { row, market, stats, weekFee: { raw: coin.fee, atLeast: false } };
  });
}

function judged(tx: string, at: string): TradeJudgement {
  const cluster = INSIDE.has(tx) ? 'inside' : UNCHECKED.has(tx) ? 'unknown' : 'outside';
  const verdict = cluster === 'outside' ? { counted: true as const } : { counted: false as const, reason: cluster === 'inside' ? ('cluster' as const) : ('unverified' as const) };
  return {
    tx,
    at,
    cluster,
    inside: cluster === 'inside' ? { party: 'creator', why: 'shared_funder' } : null,
    counts: { points: verdict, billboards: verdict, war: verdict, prestige: verdict, host_share: verdict },
    rules: 'stub',
  };
}

/** The stand-in's Hall at `now`: a week with catches, hunters and creators — or an empty week. */
export function stubHall(now: number, empty = false): HallView {
  const reads = empty ? [] : readsOf(now);
  const judgements = new Map(hallTrades(reads, now, new Set()).map((trade) => [trade.tx, judged(trade.tx, trade.at)]));
  return hallView({ network: 'solana:devnet', reads, judgements, exclude: new Set(), listed: reads.length, now });
}
