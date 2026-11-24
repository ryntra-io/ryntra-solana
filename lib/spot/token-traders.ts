/**
 * «хто заробив»: the coin's traders from the trades the page read, and what the holders' tokens are worth.
 *
 * Pure and client-safe. One table row per wallet: how much it bought and sold, its average prices, and its result by
 * Ryntra's one standard (`lib/core/pnl/honest.ts`, «Чесний PnL»): realized and unrealized apart, fees counted, what
 * is held valued at the price it would leave at now (the market's depth against the sale), and the result given only
 * when at least 95 % of the wallet's turnover is known. A sale of tokens bought before the read is a part not known —
 * so a wallet that came in before the span has no result, never a made-up one.
 *
 * The table is only as deep as the trades read: `TradersBasis` says from which source, over which span, and whether
 * that span reaches the coin's first trade (`whole`). Nothing here reads the network.
 */

import { ESTIMATED_NETWORK_FEE_SOL, HONEST_PNL_STANDARD, honestPnl, type ExitMark, type PnlLeg } from "../core/pnl/honest.ts";
import type { HolderLabel, TokenHolder, TokenTrade } from "./token-page.ts";
import { walletLabelsOf, WALLET_LABEL_DEFAULTS, type WalletBook, type WalletLabel, type WalletLabelSettings } from "./wallet-labels.ts";

export type TradesSource = "geckoterminal" | "helius";

export type TraderRow = Readonly<{
  wallet: string;
  /** The wallet's marks (no `big`: that is a trade's); absent when it has none. */
  labels?: readonly WalletLabel[];
  buys: number;
  sells: number;
  /** Tokens, in the unit the wallet shows. */
  boughtTokens: number;
  soldTokens: number;
  /** Dollars of the priced legs; `unpriced` says how many legs had no price. */
  boughtUsd: number;
  soldUsd: number;
  unpriced: number;
  /** Over the priced legs; null without one. */
  avgBuyPriceUsd: number | null;
  avgSellPriceUsd: number | null;
  /** Bought less sold within the span, tokens: what the span says of the holding, not the holding itself. */
  netTokens: number;
  /** By the honest standard: realized after fees; 0 with no sale; null — sales made and none known. */
  realizedUsd: number | null;
  /** What is held at the exit price now, less its cost; null — not known. */
  unrealizedUsd: number | null;
  /** Realized and unrealized — only when at least 95 % of the turnover is known; null otherwise. */
  resultUsd: number | null;
  completenessPct: number | null;
  firstAt: string;
  lastAt: string;
}>;

export type TradersBasis = Readonly<{
  method: typeof HONEST_PNL_STANDARD;
  source: TradesSource;
  /** How many trades the table is counted from, and the span they cover. */
  trades: number;
  from: string | null;
  to: string | null;
  /** The read reached the coin's first trade: the table is its whole history. False — the span only. */
  whole: boolean;
  /** Network fees: each transaction's own (`chain`), the standard's estimate (`estimate`), both, or none known. */
  fees: "chain" | "estimate" | "mixed" | "unknown";
  /** What the unrealized part is valued at: the price now and the depth that moves it; the pool's own fee is not counted. */
  exit: Readonly<{ priceUsd: number | null; depthUsd: number | null; poolFeeCounted: false }>;
  /** Wallets in the span, and how many rows were given. */
  wallets: number;
  listed: number;
}>;

export type TradersInput = Readonly<{
  mint: string;
  trades: readonly TokenTrade[];
  source: TradesSource;
  /** The span reaches the coin's first trade. */
  whole: boolean;
  nowMs: number;
  /** The coin's price now, dollars per unit the wallet shows; null — not quoted. */
  priceUsd: number | null;
  /** The market's depth on the dollar side, dollars; null — not known. */
  depthUsd: number | null;
  /** SOL's price now, for the network fees; null — not quoted. */
  solPriceUsd: number | null;
  book: WalletBook;
  /** What a wallet holds now, where a read says it (the largest holders): a holding below the span's buys was sent away. */
  held?: ReadonlyMap<string, number>;
  settings?: WalletLabelSettings;
  limit?: number;
}>;

export const TRADERS_LIMIT = 50;

const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** A trade's network fee in dollars: the chain's own where stated, else the standard's estimate; null without SOL's price. */
function feeUsdOf(trade: TokenTrade, solPriceUsd: number | null): number | null {
  if (!finite(solPriceUsd) || solPriceUsd <= 0) return null;
  return (finite(trade.feeSol) && trade.feeSol >= 0 ? trade.feeSol : ESTIMATED_NETWORK_FEE_SOL) * solPriceUsd;
}

/** The coin's traders in the span read: the known results first, largest first; then the rest by turnover. */
export function tradersOf(input: TradersInput): Readonly<{ traders: TraderRow[]; basis: TradersBasis }> {
  const settings = input.settings ?? WALLET_LABEL_DEFAULTS;
  const byWallet = new Map<string, TokenTrade[]>();
  let from: string | null = null;
  let to: string | null = null;
  let chainFees = 0;
  for (const trade of input.trades) {
    const list = byWallet.get(trade.wallet) ?? [];
    list.push(trade);
    byWallet.set(trade.wallet, list);
    if (from === null || trade.at < from) from = trade.at;
    if (to === null || trade.at > to) to = trade.at;
    if (finite(trade.feeSol)) chainFees += 1;
  }
  const solPrice = finite(input.solPriceUsd) && input.solPriceUsd > 0 ? input.solPriceUsd : null;
  const mark: ExitMark = {
    price: finite(input.priceUsd) && input.priceUsd >= 0 ? input.priceUsd : null,
    depth: finite(input.depthUsd) && input.depthUsd > 0 ? input.depthUsd : null,
    feeShare: 0,
    feeFixed: solPrice === null ? 0 : ESTIMATED_NETWORK_FEE_SOL * solPrice,
  };
  const nowS = Math.floor(input.nowMs / 1000);
  const rows: TraderRow[] = [];
  for (const [wallet, trades] of byWallet) {
    let buys = 0;
    let sells = 0;
    let boughtTokens = 0;
    let soldTokens = 0;
    let boughtUsd = 0;
    let soldUsd = 0;
    let boughtPricedTokens = 0;
    let soldPricedTokens = 0;
    let unpriced = 0;
    let firstAt = trades[0]!.at;
    let lastAt = trades[0]!.at;
    const legs: PnlLeg[] = [];
    for (const trade of trades) {
      if (trade.at < firstAt) firstAt = trade.at;
      if (trade.at > lastAt) lastAt = trade.at;
      const priced = finite(trade.usd) && trade.usd >= 0;
      if (!priced) unpriced += 1;
      if (trade.side === "buy") {
        buys += 1;
        boughtTokens += trade.tokenAmount;
        if (priced) {
          boughtUsd += trade.usd!;
          boughtPricedTokens += trade.tokenAmount;
        }
      } else {
        sells += 1;
        soldTokens += trade.tokenAmount;
        if (priced) {
          soldUsd += trade.usd!;
          soldPricedTokens += trade.tokenAmount;
        }
      }
      legs.push({
        id: `${trade.signature}:${trade.side}`,
        asset: input.mint,
        at: Math.floor(Date.parse(trade.at) / 1000),
        side: trade.side,
        amount: trade.tokenAmount,
        value: priced ? trade.usd : null,
        fee: feeUsdOf(trade, solPrice),
      });
    }
    const heldNow = input.held?.get(wallet);
    const pnl = honestPnl({
      unit: "USD",
      nowS,
      legs,
      marks: new Map([[input.mint, mark]]),
      ...(finite(heldNow) ? { held: new Map([[input.mint, heldNow]]) } : {}),
    });
    const labels = walletLabelsOf(wallet, input.book, null, settings);
    rows.push({
      wallet,
      ...(labels.length > 0 ? { labels } : {}),
      buys,
      sells,
      boughtTokens,
      soldTokens,
      boughtUsd,
      soldUsd,
      unpriced,
      avgBuyPriceUsd: boughtPricedTokens > 0 ? boughtUsd / boughtPricedTokens : null,
      avgSellPriceUsd: soldPricedTokens > 0 ? soldUsd / soldPricedTokens : null,
      netTokens: boughtTokens - soldTokens,
      realizedUsd: pnl.whole.realized,
      unrealizedUsd: pnl.whole.unrealized,
      resultUsd: pnl.whole.result,
      completenessPct: pnl.whole.completenessPct,
      firstAt,
      lastAt,
    });
  }
  rows.sort((a, b) => {
    if (a.resultUsd !== null && b.resultUsd !== null) return b.resultUsd - a.resultUsd;
    if (a.resultUsd !== null) return -1;
    if (b.resultUsd !== null) return 1;
    return b.boughtUsd + b.soldUsd - (a.boughtUsd + a.soldUsd);
  });
  const limit = input.limit ?? TRADERS_LIMIT;
  const listed = rows.slice(0, limit);
  const count = input.trades.length;
  return {
    traders: listed,
    basis: {
      method: HONEST_PNL_STANDARD,
      source: input.source,
      trades: count,
      from,
      to,
      whole: input.whole,
      fees: solPrice === null || count === 0 ? "unknown" : chainFees === count ? "chain" : chainFees === 0 ? "estimate" : "mixed",
      exit: { priceUsd: mark.price, depthUsd: typeof mark.depth === "number" ? mark.depth : null, poolFeeCounted: false },
      wallets: byWallet.size,
      listed: listed.length,
    },
  };
}

/* --------------------------------------------------------------- holders */

/** How far the holders list reaches: what the read could list, and whether it saw every account of the coin. */
export type HoldersReach = Readonly<{
  /** Rows listed. */
  listed: number;
  /** The most rows this read can list: 20 from the node's largest accounts, 100 from every account. */
  ceiling: number;
  /** `largest-accounts` — the node's twenty largest token accounts; `all-accounts` — every account of the coin, read whole. */
  source: "largest-accounts" | "all-accounts";
  /** Every account of the coin was read. */
  whole: boolean;
  /** How many holders Jupiter counts; null — not stated. */
  holders: number | null;
}>;

/** The node lists only the twenty largest token accounts of a coin. */
export const LARGEST_ACCOUNTS_CEILING = 20;
/** Listed from every account, where every account was read. */
export const ALL_ACCOUNTS_CEILING = 100;

export function holdersReachOf(listed: number, allAccounts: boolean, holders: number | null): HoldersReach {
  return {
    listed,
    ceiling: allAccounts ? ALL_ACCOUNTS_CEILING : LARGEST_ACCOUNTS_CEILING,
    source: allAccounts ? "all-accounts" : "largest-accounts",
    whole: allAccounts,
    holders: finite(holders) ? holders : null,
  };
}

/**
 * The holders with what their tokens are worth at the coin's price now, dollars; null without a price. `multiplier`
 * is a scaled-UI token's (a stock's): the amounts are in the unit the wallet shows, the price is per token.
 */
export function withHolderValues<T extends Pick<TokenHolder, "amount">>(holders: readonly T[], priceUsd: number | null, multiplier: number | null = null): (T & { valueUsd: number | null })[] {
  const scale = finite(multiplier) && multiplier > 0 ? multiplier : 1;
  const price = finite(priceUsd) && priceUsd >= 0 ? priceUsd : null;
  return holders.map((holder) => ({ ...holder, valueUsd: price === null ? null : (holder.amount / scale) * price }));
}

/** Whether a holder row is a pool's or a program's — no person's key. */
export function isProgramHolder(labels: readonly HolderLabel[]): boolean {
  return labels.includes("pool") || labels.includes("program");
}
