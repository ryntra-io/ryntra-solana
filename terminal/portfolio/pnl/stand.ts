import { portfolioPnl, type PnlMarket, type PortfolioPnl } from '../../../lib/portfolio/pnl.ts';
import type { WalletTrade } from '../../../lib/wallet-watch/trades.ts';

/**
 * The kit's stand of «Result»: wallets made of trades for the eyes only — the figures are what
 * `portfolioPnl` counts from them, never drawn by hand. People never see the stand.
 */

const DAY = 86_400;
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const MET = 'METstandMETstandMETstandMETstandMETstand11';
const KITE = 'KiTEstandKiTEstandKiTEstandKiTEstandKiTE11';
const SOL_USD = 182;

const MARKET: ReadonlyMap<string, PnlMarket> = new Map([
  [JUP, { priceUsd: 0.92, liquidityUsd: 48_000_000, symbol: 'JUP', name: 'Jupiter', icon: null }],
  [MET, { priceUsd: 0.61, liquidityUsd: 9_400_000, symbol: 'MET', name: 'Meteora', icon: null }],
  [KITE, { priceUsd: 0.0000412, liquidityUsd: 86_000, symbol: 'KITE', name: 'Kite', icon: null }],
]);

/** A small deterministic sequence: the same stand on every opening. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

let slot = 300_000_000;
function trade(nowS: number, side: 'buy' | 'sell', mint: string, coins: number, sol: number | null, daysAgo: number, extra: Partial<WalletTrade> = {}): WalletTrade {
  slot += 1;
  return {
    signature: `stand${slot}`,
    slot,
    at: Math.round(nowS - daysAgo * DAY),
    side,
    mint,
    tokensRaw: String(Math.round(coins * 1e6)),
    decimals: 6,
    quote: sol === null ? null : 'SOL',
    quoteAmount: sol,
    paidBy: null,
    feeSol: 0.000105,
    ...extra,
  };
}

/** Two months of trading three coins: some days in the plus, some in the minus. */
function trades(nowS: number): WalletTrade[] {
  const next = sequence(7);
  const out: WalletTrade[] = [];
  const prices: Record<string, number> = { [JUP]: 0.0052, [MET]: 0.0031, [KITE]: 0.00000019 };
  for (let day = 62; day >= 1; day -= 1) {
    for (const mint of [JUP, MET, KITE]) {
      prices[mint] = prices[mint]! * (0.94 + next() * 0.13);
      if (next() > 0.3) continue;
      const sol = Math.round((0.2 + next() * 1.6) * 1000) / 1000;
      out.push(trade(nowS, 'buy', mint, sol / prices[mint]!, sol, day + 0.2));
      if (next() > 0.35) {
        const back = (0.85 + next() * 0.4) * sol * (0.5 + next() * 0.5);
        out.push(trade(nowS, 'sell', mint, (sol / prices[mint]!) * 0.6, Math.round(back * 1000) / 1000, day - 0.4));
      }
    }
  }
  return out;
}

function held(list: readonly WalletTrade[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const one of list) out.set(one.mint, Math.max(0, (out.get(one.mint) ?? 0) + (one.side === 'buy' ? 1 : -1) * (Number(one.tokensRaw) / 1e6)));
  return out;
}

export type StandWallets = Readonly<{ live: PortfolioPnl; older: PortfolioPnl; partial: PortfolioPnl; empty: PortfolioPnl }>;

export function standWallets(nowS: number): StandWallets {
  const all = trades(nowS);
  const live = portfolioPnl({ read: { trades: all, held: held(all), oldestAt: nowS - 70 * DAY, complete: true, gap: false, skipped: 0 }, solUsd: SOL_USD, market: MARKET, nowS });
  /* Read from twelve days ago: the week is known, the month and the quarter are not yet. */
  const recent = all.filter((one) => one.at !== null && one.at >= nowS - 12 * DAY);
  const older = portfolioPnl({ read: { trades: recent, held: held(all), oldestAt: nowS - 12 * DAY, complete: false, gap: false, skipped: 0 }, solUsd: SOL_USD, market: MARKET, nowS });
  /* Swaps of one coin for another: no price, too little known for a result. */
  const unpriced = all.map((one, at) => (at % 2 ? { ...one, quote: null, quoteAmount: null } : one));
  const partial = portfolioPnl({ read: { trades: unpriced, held: held(all), oldestAt: nowS - 70 * DAY, complete: true, gap: false, skipped: 0 }, solUsd: SOL_USD, market: MARKET, nowS });
  const empty = portfolioPnl({ read: { trades: [], held: new Map(), oldestAt: null, complete: true, gap: false, skipped: 0 }, solUsd: SOL_USD, market: MARKET, nowS });
  return { live, older, partial, empty };
}
