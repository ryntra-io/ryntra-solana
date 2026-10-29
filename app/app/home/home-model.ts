/**
 * Home, as numbers and rows: what the page shows is decided here, so the
 * screen only draws it. Pure — the market index, the launches, the wallet's
 * holdings, its pools, its limit orders and its history come from the reads
 * Markets, Launch, Portfolio, Pools, Spot and History already use.
 */

import type { FundingNeed } from "../invest/funding-model.ts";
import type { LimitToken } from "../../solana/workspace/spot/limit-orders-view.ts";
import { isOpenLimit, limitOrderPrice } from "../../solana/workspace/spot/limit-orders-view.ts";
import type { LimitOrderView } from "../../../lib/solana/limits/sync.server.ts";
import type { LimitOrderState } from "../../../lib/solana/limits/store.server.ts";
import type { SolanaWalletAction } from "../../../lib/solana/action-ledger.ts";
import type { SearchIndex } from "../../../lib/search/product-search.ts";
import type { LaunchMarketRow } from "../../../lib/api/v1/contract.ts";
import { moversOf } from "../../../lib/search/movers.ts";
import { publicLaunchMarkets } from "../launch/markets/public-markets.ts";
import { withoutOffensiveNames } from "../../../lib/spot/offensive-names.ts";
import { holdingValue, type WalletHolding } from "../wallet-view-model.ts";

/** Rows in a table of orders and positions: open orders first, then the largest positions, up to this many. */
export const HOME_ROWS_SHOWN = 4;
/** Below this a holding is dust: counted in the total, not a row on Home. */
export const DUST_MICRO_USD = 10_000n;

/** Home's one orange action: the step that works next — dollars, then the network's SOL, then a trade. */
export type HomeAction = "top-up" | "top-up-sol" | "trade";

export function homeAction(need: FundingNeed): HomeAction {
  if (need === "usdc") return "top-up";
  if (need === "sol") return "top-up-sol";
  return "trade";
}

export const HOME_ACTION_HREF: Readonly<Record<HomeAction, string>> = {
  "top-up": "/app/top-up",
  "top-up-sol": "/app/top-up?need=sol",
  trade: "/app/spot",
};

/**
 * The day's change of what the wallet holds — Portfolio's own rule: value
 * today less value yesterday, `v − v / (1 + Δ)`, over the assets whose price
 * and day are both known, and shown only when those cover most of the value.
 */
export function dayChangeOf(holdings: readonly WalletHolding[], totalMicro: bigint): { usd: number; pct: number } | null {
  let covered = 0;
  let delta = 0;
  for (const holding of holdings) {
    const value = holdingValue(holding);
    const change = holding.catalog?.dayChangePct;
    if (value === null || typeof change !== "number" || !Number.isFinite(change)) continue;
    const usd = Number(value) / 1_000_000;
    const ratio = 1 + change / 100;
    if (ratio <= 0) continue;
    covered += usd;
    delta += usd - usd / ratio;
  }
  const total = Number(totalMicro) / 1_000_000;
  if (total <= 0 || covered / total < 0.9) return null;
  const previous = covered - delta;
  return { usd: delta, pct: previous > 0 ? (delta / previous) * 100 : 0 };
}

/** `note`: what the row must say instead of «Позиція» — a token no longer supported, or its issuer's deadline. */
export type HomePosition = Readonly<{ key: string; name: string; href: string; value: bigint; change: number | null; note?: string }>;

export type HomeRow =
  | Readonly<{
      kind: "order";
      key: string;
      side: "buy" | "sell";
      state: LimitOrderState;
      venue: LimitOrderView["venue"];
      /** Null when the catalogue has not named the token: the row says «token», never part of an address. */
      baseSymbol: string | null;
      quoteSymbol: string | null;
      /** Quote per base the order fills at; null when the scale is not known yet. */
      price: number | null;
      /** What the order spends, in its own token. */
      amount: number | null;
      amountSymbol: string | null;
      href: string;
    }>
  | Readonly<{ kind: "position"; key: string; name: string; value: bigint; change: number | null; note: string | null; href: string }>;

/* The quote assets by mint: a catalogue that is busy never turns SOL into «So11…». */
const KNOWN_SYMBOLS: Readonly<Record<string, string>> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};
const KNOWN_DECIMALS: Readonly<Record<string, number>> = {
  So11111111111111111111111111111111111111112: 9,
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
};

export function limitSymbol(tokens: Readonly<Record<string, LimitToken>>, mint: string): string | null {
  return tokens[mint]?.symbol ?? KNOWN_SYMBOLS[mint] ?? null;
}

function spent(order: LimitOrderView, tokens: Readonly<Record<string, LimitToken>>): number | null {
  const decimals = tokens[order.inputMint]?.decimals ?? KNOWN_DECIMALS[order.inputMint] ?? null;
  if (decimals === null) return null;
  const value = Number(order.makingRaw) / 10 ** decimals;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * «Ордери й позиції»: every open limit order, newest first, then the largest
 * positions — up to `HOME_ROWS_SHOWN` rows in all. An order opens its market
 * in Spot, where «Мої ордери» cancels it; a position opens its page.
 */
export function homeRows(
  orders: readonly LimitOrderView[],
  tokens: Readonly<Record<string, LimitToken>>,
  positions: readonly HomePosition[],
  max = HOME_ROWS_SHOWN,
): readonly HomeRow[] {
  const open = orders
    .filter(isOpenLimit)
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
    .map((order): HomeRow => ({
      kind: "order",
      key: `order:${order.key}`,
      side: order.side,
      state: order.state,
      venue: order.venue,
      baseSymbol: limitSymbol(tokens, order.baseMint),
      quoteSymbol: limitSymbol(tokens, order.quoteMint),
      price: limitOrderPrice(order, tokens),
      amount: spent(order, tokens),
      amountSymbol: limitSymbol(tokens, order.inputMint),
      href: `/app/spot?mint=${encodeURIComponent(order.baseMint)}`,
    }));
  const held = positions
    .filter((position) => position.value >= DUST_MICRO_USD)
    .map((position): HomeRow => ({ kind: "position", key: `position:${position.key}`, name: position.name, value: position.value, change: position.change, note: position.note ?? null, href: position.href }));
  return [...open, ...held].slice(0, max);
}

export type OrdersNote = "orders-unread" | "orders-partial" | "positions-unread";

/**
 * What «Ордери й позиції» can say about its own reads. Two sources fill one
 * table, so each that failed is named — a failed read is never shown as an
 * empty list — and a read some venues did not answer says so, as Spot does.
 */
export function ordersView(
  limits: Readonly<{ status: "idle" | "loading" | "ready" | "failed"; complete: boolean }>,
  holdings: "idle" | "loading" | "ready" | "error",
  rows: number,
): Readonly<{ loading: boolean; notes: readonly OrdersNote[]; retry: boolean }> {
  const pending = limits.status === "idle" || limits.status === "loading" || holdings === "idle" || holdings === "loading";
  const notes: OrdersNote[] = [];
  if (limits.status === "failed") notes.push("orders-unread");
  else if (limits.status === "ready" && !limits.complete) notes.push("orders-partial");
  if (holdings === "error") notes.push("positions-unread");
  return {
    loading: rows === 0 && pending && notes.length === 0,
    notes,
    /* A venue that did not answer is asked again too — the person has no other way to. */
    retry: notes.length > 0,
  };
}

/* ------------------------------------------------------- markets now -- */

/**
 * «Ринки зараз»: the three lists Markets draws, each by the day's volume, and the day's movers among what trades most —
 * Home's one list of markets beside Pulse (SOL-C5; аудит UX 21.10: UX-103), where «Рухи дня» stood as a block of its own.
 */
export const MARKET_TABS = ["stocks", "crypto", "memes", "movers"] as const;
export type MarketTab = (typeof MARKET_TABS)[number];
/** Rows a desk shows; a phone shows the first five of them. */
export const MARKET_ROWS = 8;
export const MARKET_ROWS_PHONE = 5;

export type MarketRow = Readonly<{ key: string; name: string; symbol: string; mint: string; icon: string | null; price: number; change24h: number | null; volume24h: number; href: string }>;

/**
 * The head of one list of the market index, in its own order (the day's
 * volume): a company opens its page, a coin or a meme its market in Spot.
 */
export function marketRows(index: SearchIndex, tab: MarketTab, count = MARKET_ROWS): readonly MarketRow[] {
  /* The biggest moves of the day, no memes and no dollars (`lib/search/movers.ts`), the largest first. */
  if (tab === "movers") {
    return moversOf(index, count).map((mover) => ({
      key: mover.key,
      name: mover.name,
      symbol: mover.symbol,
      mint: mover.mint,
      icon: mover.icon,
      price: mover.price,
      change24h: mover.change24h,
      volume24h: mover.volume24h,
      href: mover.href,
    }));
  }
  if (tab === "stocks") {
    return index.companies.slice(0, count).map((card) => ({
      key: card.mint,
      name: card.name,
      symbol: card.ticker,
      mint: card.mint,
      icon: card.icon,
      price: card.price,
      change24h: card.change24h,
      volume24h: card.volume24h,
      href: `/app/stocks/${encodeURIComponent(card.ticker)}`,
    }));
  }
  return (tab === "crypto" ? index.coins : index.memes).slice(0, count).map((coin) => ({
    key: coin.mint,
    name: coin.name,
    symbol: coin.symbol,
    mint: coin.mint,
    icon: coin.icon,
    price: coin.price,
    change24h: coin.change24h,
    volume24h: coin.volume24h,
    href: `/app/spot?mint=${encodeURIComponent(coin.mint)}`,
  }));
}

/* ----------------------------------------------------------- launches -- */

/** Rows of «Лаунчі на Ryntra» on Home. */
export const LAUNCH_ROWS = 4;

export type LaunchLine = Readonly<{
  key: string;
  name: string;
  symbol: string;
  image: string | null;
  /** The curve's way to the DEX, 0–100; null once on the DEX or when not read. */
  progressPct: number | null;
  onDex: boolean;
  holders: number | null;
  holdersAtLeast: boolean;
  href: string;
}>;

/**
 * People's launches only — never the team's technical validations (B15), never a name with a hate word (Home is the
 * first screen a guest meets, under Ryntra's name) — in the list's own order.
 */
export function launchLines(markets: readonly LaunchMarketRow[], count = LAUNCH_ROWS): readonly LaunchLine[] {
  return withoutOffensiveNames(publicLaunchMarkets(markets))
    .slice(0, count)
    .map((row) => ({
      key: row.token,
      name: row.name,
      symbol: row.symbol,
      image: row.image,
      progressPct: row.progress && !row.progress.migrated ? Math.max(0, Math.min(100, row.progress.bps / 100)) : null,
      onDex: row.progress?.migrated === true,
      holders: row.holders,
      holdersAtLeast: row.holdersAtLeast,
      href: `/app/launch/${row.token}`,
    }));
}

/* -------------------------------------------------------- wallet rows -- */

/** «Мої активи»: the largest holdings and their part of the value. */
export const ASSET_ROWS = 5;

export type AssetRow = HomePosition & Readonly<{ sharePct: number | null }>;

export function assetRows(positions: readonly HomePosition[], total: bigint | null, count = ASSET_ROWS): readonly AssetRow[] {
  return positions
    .filter((position) => position.value >= DUST_MICRO_USD)
    .slice(0, count)
    .map((position) => ({ ...position, sharePct: total && total > 0n ? (Number(position.value) / Number(total)) * 100 : null }));
}

/** «Останні операції»: the newest of the wallet's history as the server keeps it. */
export const RECENT_ROWS = 5;

export function recentOperations(actions: readonly SolanaWalletAction[], count = RECENT_ROWS): readonly SolanaWalletAction[] {
  return [...actions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)).slice(0, count);
}

/** «Відкриті ордери»: rows under the count. */
export const ORDER_ROWS = 3;

/* ------------------------------------------------------ needs attention -- */

export type AttentionKind = "needs-you" | "in-flight" | "order-claim" | "order-part" | "pool-out" | "risk";

export type AttentionItem = Readonly<{ kind: AttentionKind; count: number; href: string }>;

/** At most this many things ask for the person at once. */
export const ATTENTION_ROWS = 3;

type AttentionPool = Readonly<{ pool: string; address: string; rangeState: "in_range" | "above" | "below" }>;

/**
 * «Потребує уваги»: what waits on the person, most pressing first — an
 * operation that needs them, one still on its way, an order that filled and
 * waits to be taken back or filled in part, a pool position whose price left
 * its range, and the portfolio's risk when it asks for attention. Each says
 * how many and opens the place that acts on it. Nothing waiting: an empty list
 * — «Усе спокійно».
 */
export function attentionItems(
  input: Readonly<{ actions: readonly SolanaWalletAction[]; orders: readonly LimitOrderView[]; pools: readonly AttentionPool[]; risk: string | null }>,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  const needs = input.actions.filter((action) => action.outcome === "NEEDS_YOU");
  if (needs.length > 0) items.push({ kind: "needs-you", count: needs.length, href: "/app/activity?filter=pending" });
  const flying = input.actions.filter((action) => action.outcome === "IN_FLIGHT");
  if (flying.length > 0) items.push({ kind: "in-flight", count: flying.length, href: "/app/activity" });
  const claim = input.orders.filter((order) => order.canClaim);
  const firstClaim = claim[0];
  if (firstClaim) items.push({ kind: "order-claim", count: claim.length, href: `/app/spot?mint=${encodeURIComponent(firstClaim.baseMint)}` });
  const part = input.orders.filter((order) => order.state === "PARTIAL" && !order.canClaim);
  const firstPart = part[0];
  if (firstPart) items.push({ kind: "order-part", count: part.length, href: `/app/spot?mint=${encodeURIComponent(firstPart.baseMint)}` });
  const out = input.pools.filter((position) => position.rangeState !== "in_range");
  const firstOut = out[0];
  if (firstOut) items.push({ kind: "pool-out", count: out.length, href: out.length === 1 ? `/app/markets/pools/${firstOut.pool}/position/${firstOut.address}` : "/app/markets/pools" });
  if (input.risk === "attention") items.push({ kind: "risk", count: 1, href: "#home-details" });
  return items.slice(0, ATTENTION_ROWS);
}
