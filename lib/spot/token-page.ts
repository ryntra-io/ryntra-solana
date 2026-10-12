/**
 * The token page's own facts — «Сторінка токена»: the windows of the header, who bought and who
 * sold with the market's capitalisation at the trade, who holds and how their
 * holding moved, the facts behind «Ризик», and the marks on the chart.
 *
 * Pure and client-safe. Every figure is a source's own claim carried with the
 * source's name: Jupiter Tokens V2 for the token's stats, its creator and its
 * audit; GeckoTerminal for the pools and the trades; the chain itself for the
 * holders. A figure a source did not state is `null` and the page prints a
 * dash, never a zero; a fact is said with its reason and never as a verdict on
 * the person's behalf — there is no score, no «safe», no «scam» here.
 *
 * `token-page.server.ts` reads the network and calls these; tests exercise
 * them against recorded answers.
 */

import { WRAPPED_SOL_MINT } from "../solana/send-kinds.ts";

/* ------------------------------------------------------------- sources */

/**
 * Who each figure on the token page comes from, and what its terms ask in
 * return. Read from the providers' own documents on 2026-10-11; a source not
 * listed here is not shown on the page.
 */
export const TOKEN_PAGE_SOURCES = {
  jupiter: {
    label: "Jupiter",
    /* SDK & API License Agreement §8.4: the product shows «Powered by Jupiter» prominently. */
    attribution: "Powered by Jupiter",
    href: "https://jup.ag",
    terms: "https://dev.jup.ag/docs/legal/sdk-api-license-agreement",
    readOn: "2026-10-11",
  },
  geckoterminal: {
    label: "GeckoTerminal",
    /* CoinGecko API Terms §4.3 and its attribution guide: on-chain data says «Powered by GeckoTerminal». */
    attribution: "Powered by GeckoTerminal",
    href: "https://www.geckoterminal.com",
    terms: "https://www.coingecko.com/en/api_terms",
    readOn: "2026-10-11",
  },
  chain: {
    label: "Solana",
    /* The chain's own accounts, read through Ryntra's node: public data, no attribution owed. */
    attribution: null,
    href: null,
    terms: null,
    readOn: "2026-10-11",
  },
} as const;

export type TokenPageSource = keyof typeof TOKEN_PAGE_SOURCES;

/* ------------------------------------------------------------- helpers */

function asString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asIso(value: unknown): string | null {
  const text = asString(value, 64);
  if (!text) return null;
  const stamp = Date.parse(text);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function asAddress(value: unknown): string | null {
  const text = asString(value, 44);
  return text && BASE58.test(text) ? text : null;
}

function asHttpsUrl(value: unknown): string | null {
  const text = asString(value, 512);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------- the token's facts */

export const TOKEN_WINDOWS = ["m5", "h1", "h6", "h24"] as const;
export type TokenWindow = (typeof TOKEN_WINDOWS)[number];

export function isTokenWindow(value: unknown): value is TokenWindow {
  return typeof value === "string" && (TOKEN_WINDOWS as readonly string[]).includes(value);
}

export type TokenWindowStats = Readonly<{
  /** Percent, Jupiter's own scale (1.5 = +1.5 %). */
  priceChangePct: number | null;
  /** USD, buys plus sells. */
  volumeUsd: number | null;
  buyVolumeUsd: number | null;
  sellVolumeUsd: number | null;
  buys: number | null;
  sells: number | null;
  traders: number | null;
  /** Percent change in the count of holders over the window, as Jupiter states it. */
  holderChangePct: number | null;
  /** Percent change in the token's liquidity over the window, as Jupiter states it. */
  liquidityChangePct: number | null;
}>;

export type TokenSocial = Readonly<{ kind: "discord" | "instagram" | "tiktok" | "other"; url: string }>;

/**
 * What Jupiter Tokens V2 says of a token beyond the Spot header's market
 * shape: the four windows, the supply the capitalisation is counted on, the
 * wallet it names as the token's creator and what that wallet has done, the
 * launchpad and the day the token left its curve.
 */
export type TokenFacts = Readonly<{
  mint: string;
  /** Tokens counted as circulating — the capitalisation is the price times this. */
  circulatingSupply: number | null;
  totalSupply: number | null;
  /** The wallet Jupiter names as the token's creator (`dev`). */
  dev: string | null;
  /** How many tokens that wallet has created, as Jupiter counts them. */
  devMints: number | null;
  /** How many of them left their curve for a DEX. */
  devMigrations: number | null;
  launchpad: string | null;
  /** When the token left its launch curve for a DEX, as Jupiter states it. */
  graduatedAt: string | null;
  createdAt: string | null;
  windows: Readonly<Record<TokenWindow, TokenWindowStats>>;
  /** The creator's other addresses Jupiter lists beyond the site, X and Telegram the header shows. */
  socials: readonly TokenSocial[];
}>;

const EMPTY_WINDOW: TokenWindowStats = {
  priceChangePct: null,
  volumeUsd: null,
  buyVolumeUsd: null,
  sellVolumeUsd: null,
  buys: null,
  sells: null,
  traders: null,
  holderChangePct: null,
  liquidityChangePct: null,
};

function windowOf(raw: unknown): TokenWindowStats {
  const stats = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!stats) return EMPTY_WINDOW;
  const buy = asNumber(stats.buyVolume);
  const sell = asNumber(stats.sellVolume);
  return {
    priceChangePct: asNumber(stats.priceChange),
    volumeUsd: buy === null && sell === null ? null : (buy ?? 0) + (sell ?? 0),
    buyVolumeUsd: buy,
    sellVolumeUsd: sell,
    buys: asNumber(stats.numBuys),
    sells: asNumber(stats.numSells),
    traders: asNumber(stats.numTraders),
    holderChangePct: asNumber(stats.holderChange),
    liquidityChangePct: asNumber(stats.liquidityChange),
  };
}

/** One Tokens V2 row → the token page's facts, or null when the row names no mint. */
export function tokenFactsOf(raw: unknown): TokenFacts | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const mint = asAddress(row.id);
  if (!mint) return null;
  const audit = row.audit && typeof row.audit === "object" ? (row.audit as Record<string, unknown>) : null;
  const socials: TokenSocial[] = [];
  for (const [key, kind] of [["discord", "discord"], ["instagram", "instagram"], ["tiktok", "tiktok"], ["otherUrl", "other"]] as const) {
    const url = asHttpsUrl(row[key]);
    if (url) socials.push({ kind, url });
  }
  return {
    mint,
    circulatingSupply: asNumber(row.circSupply),
    totalSupply: asNumber(row.totalSupply),
    dev: asAddress(row.dev),
    devMints: audit ? asNumber(audit.devMints) : null,
    devMigrations: audit ? asNumber(audit.devMigrations) : null,
    launchpad: asString(row.launchpad, 48),
    graduatedAt: asIso(row.graduatedAt),
    createdAt: asIso(row.createdAt),
    windows: { m5: windowOf(row.stats5m), h1: windowOf(row.stats1h), h6: windowOf(row.stats6h), h24: windowOf(row.stats24h) },
    socials,
  };
}

/* ---------------------------------------------------------------- pools */

export type TokenPool = Readonly<{
  address: string;
  name: string;
  dex: string | null;
  /** Which side of the pool the mint is on. */
  side: "base" | "quote";
  reserveUsd: number | null;
  volume24hUsd: number | null;
  buys24h: number | null;
  sells24h: number | null;
  createdAt: string | null;
}>;

function tokenIdMint(id: unknown): string | null {
  return typeof id === "string" && id.startsWith("solana_") ? asAddress(id.slice("solana_".length)) : null;
}

/** GeckoTerminal's `/tokens/{mint}/pools` answer → the mint's pools, deepest first, at most `limit`. */
export function poolsOf(body: unknown, mint: string, limit = 8): TokenPool[] {
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? ((body as { data: unknown[] }).data) : [];
  const pools: TokenPool[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id?: unknown } }> };
    const attributes = row.attributes ?? {};
    const address = asAddress(attributes.address);
    if (!address) continue;
    const base = tokenIdMint(row.relationships?.base_token?.data?.id);
    const quote = tokenIdMint(row.relationships?.quote_token?.data?.id);
    const side = base === mint ? "base" : quote === mint ? "quote" : null;
    if (!side) continue;
    const volume = attributes.volume_usd && typeof attributes.volume_usd === "object" ? (attributes.volume_usd as Record<string, unknown>) : {};
    const transactions = attributes.transactions && typeof attributes.transactions === "object" ? (attributes.transactions as Record<string, unknown>) : {};
    const day = transactions.h24 && typeof transactions.h24 === "object" ? (transactions.h24 as Record<string, unknown>) : {};
    const dex = row.relationships?.dex?.data?.id;
    pools.push({
      address,
      name: asString(attributes.name, 96) ?? address,
      dex: typeof dex === "string" && dex.length <= 48 ? dex : null,
      side,
      reserveUsd: asNumber(attributes.reserve_in_usd),
      volume24hUsd: asNumber(volume.h24),
      buys24h: asNumber(day.buys),
      sells24h: asNumber(day.sells),
      createdAt: asIso(attributes.pool_created_at),
    });
  }
  pools.sort((a, b) => (b.reserveUsd ?? -1) - (a.reserveUsd ?? -1));
  return pools.slice(0, limit);
}

/**
 * The pool whose trades the page lists: the one where the token traded most in
 * the last day. Unlike the chart's pool, it needs no stable or SOL on the
 * other side and no minimum depth — a trade is a fact whatever it was paired
 * against — but a pool that did not trade has nothing to list.
 */
export function tradesPoolOf(pools: readonly TokenPool[]): TokenPool | null {
  let best: TokenPool | null = null;
  for (const pool of pools) {
    if (pool.volume24hUsd === null || pool.volume24hUsd <= 0) continue;
    if (!best || pool.volume24hUsd > (best.volume24hUsd ?? 0)) best = pool;
  }
  return best;
}

/* --------------------------------------------------------------- trades */

export type TokenTrade = Readonly<{
  signature: string;
  at: string;
  side: "buy" | "sell";
  /** The wallet that signed the trade. */
  wallet: string;
  /** Tokens bought or sold, in the unit the wallet shows. */
  tokenAmount: number;
  usd: number | null;
  /** The token's price in the trade, USD per unit the wallet shows. */
  priceUsd: number | null;
  /** The market's capitalisation at the trade: the trade's price times today's circulating supply; null for a tokenized stock. */
  capUsd: number | null;
}>;

/**
 * GeckoTerminal's `/pools/{pool}/trades?token={mint}` answer → the token's
 * trades, newest first. The side is the token's own: a buy is the token
 * received. `multiplier` is a scaled-UI token's active multiplier (a stock's
 * reinvested dividends), so amounts and prices read in the unit the wallet
 * shows; `capSupply` is the circulating supply the capitalisation is counted
 * on, null where none is (a tokenized stock's supply is no company's value).
 */
export function tradesOf(body: unknown, mint: string, capSupply: number | null, multiplier: number | null = null): TokenTrade[] {
  const data = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? ((body as { data: unknown[] }).data) : [];
  const scale = multiplier !== null && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const trades: TokenTrade[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const attributes = (entry as { attributes?: Record<string, unknown> }).attributes ?? {};
    const signature = asString(attributes.tx_hash, 128);
    const at = asIso(attributes.block_timestamp);
    const wallet = asAddress(attributes.tx_from_address);
    const to = asAddress(attributes.to_token_address);
    const from = asAddress(attributes.from_token_address);
    if (!signature || !at || !wallet) continue;
    const side = to === mint ? "buy" : from === mint ? "sell" : null;
    if (!side) continue;
    const raw = asNumber(side === "buy" ? attributes.to_token_amount : attributes.from_token_amount);
    if (raw === null || raw <= 0) continue;
    /* One transaction can carry two legs through the same pool; each leg is its own id, the pair is one trade here. */
    const key = `${signature}:${side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rawPrice = asNumber(side === "buy" ? attributes.price_to_in_usd : attributes.price_from_in_usd);
    const priceUsd = rawPrice === null ? null : rawPrice / scale;
    const capUsd = capSupply !== null && capSupply > 0 && priceUsd !== null ? priceUsd * capSupply : null;
    trades.push({ signature, at, side, wallet, tokenAmount: raw * scale, usd: asNumber(attributes.volume_in_usd), priceUsd, capUsd });
  }
  trades.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return trades;
}

/** The span the trades cover, oldest to newest — what «the last trades» means on this page. */
export function tradesSpan(trades: readonly TokenTrade[]): Readonly<{ from: string; to: string }> | null {
  if (trades.length === 0) return null;
  let from = trades[0].at;
  let to = trades[0].at;
  for (const trade of trades) {
    if (trade.at < from) from = trade.at;
    if (trade.at > to) to = trade.at;
  }
  return { from, to };
}

/* -------------------------------------------------------------- holders */

export type HolderAccount = Readonly<{ account: string; owner: string; amountRaw: string }>;
export type HolderLabel = "creator" | "program" | "pool";

export type TokenHolder = Readonly<{
  owner: string;
  /** Tokens held, in the unit the wallet shows. */
  amount: number;
  /** Per cent of the supply. */
  sharePct: number | null;
  labels: readonly HolderLabel[];
  /**
   * The net of this wallet's own buys and sells among the trades the page read
   * (`tradesSpan`), in tokens; null when it did not trade in that span —
   * which says nothing of transfers, and the page says so.
   */
  change: number | null;
  /** How many of those trades were this wallet's. */
  trades: number;
}>;

export type HolderRead = Readonly<{
  holders: readonly TokenHolder[];
  /** Per cent of the supply in the listed accounts a program owns — pools, locks, vaults, multisigs; null without a supply. */
  programPct: number | null;
  /** The supply the shares are counted on, in the unit the wallet shows. */
  supply: number | null;
}>;

function rawToUnits(raw: string, decimals: number): number | null {
  try {
    const value = BigInt(raw);
    return Number(value) / 10 ** decimals;
  } catch {
    return null;
  }
}

/**
 * The largest token accounts of a mint → its largest holders, merged by
 * owner, with their share of the supply, what they are where the chain says
 * it (the creator Jupiter names; an owner that is a program's account rather
 * than a person's key — a pool, a lock, a vault; the pools GeckoTerminal
 * lists), and the net of their own trades in the span the page read.
 */
export function holdersOf(input: Readonly<{
  accounts: readonly HolderAccount[];
  decimals: number;
  supplyRaw: string | null;
  /** Owners that are no person's key (off the curve): programs' accounts. */
  programOwners: ReadonlySet<string>;
  /** Pool addresses and pool authorities known for the mint. */
  poolOwners?: ReadonlySet<string>;
  dev: string | null;
  trades: readonly TokenTrade[];
  multiplier?: number | null;
  limit?: number;
}>): HolderRead {
  const scale = input.multiplier !== null && input.multiplier !== undefined && Number.isFinite(input.multiplier) && input.multiplier > 0 ? input.multiplier : 1;
  const byOwner = new Map<string, bigint>();
  for (const entry of input.accounts) {
    let amount: bigint;
    try {
      amount = BigInt(entry.amountRaw);
    } catch {
      continue;
    }
    if (amount <= 0n) continue;
    byOwner.set(entry.owner, (byOwner.get(entry.owner) ?? 0n) + amount);
  }
  const supplyUnits = input.supplyRaw === null ? null : rawToUnits(input.supplyRaw, input.decimals);
  const supply = supplyUnits === null || supplyUnits <= 0 ? null : supplyUnits * scale;
  const net = new Map<string, { tokens: number; count: number }>();
  for (const trade of input.trades) {
    const held = net.get(trade.wallet) ?? { tokens: 0, count: 0 };
    net.set(trade.wallet, { tokens: held.tokens + (trade.side === "buy" ? trade.tokenAmount : -trade.tokenAmount), count: held.count + 1 });
  }
  const rows = [...byOwner.entries()]
    .map(([owner, raw]): TokenHolder => {
      const amount = (rawToUnits(raw.toString(), input.decimals) ?? 0) * scale;
      const labels: HolderLabel[] = [];
      if (input.dev && owner === input.dev) labels.push("creator");
      if (input.poolOwners?.has(owner)) labels.push("pool");
      else if (input.programOwners.has(owner)) labels.push("program");
      const moved = net.get(owner);
      return {
        owner,
        amount,
        sharePct: supply === null ? null : (amount / supply) * 100,
        labels,
        change: moved ? moved.tokens : null,
        trades: moved?.count ?? 0,
      };
    })
    .sort((a, b) => b.amount - a.amount)
    .slice(0, input.limit ?? 20);
  /* What programs hold among the listed: a pool, a lock, a vault or a multisig holds for no one key — said beside the list, never dropped from it. */
  const programs = rows.filter((row) => row.labels.includes("pool") || row.labels.includes("program"));
  const programPct = supply === null ? null : programs.reduce((sum, row) => sum + (row.sharePct ?? 0), 0);
  return { holders: rows, programPct, supply };
}

/* ----------------------------------------------------------------- risk */

/**
 * One fact behind «Ризик»: what stands, the figure, why a person might care,
 * and who says so. `notice` marks the facts that are a power someone holds
 * over the holders or a source's own flag — a binary fact, never a threshold
 * Ryntra chose; everything else is `plain`. Nothing here adds up to a verdict.
 */
export type RiskFactCode =
  | "MINT_AUTHORITY"
  | "FREEZE_AUTHORITY"
  | "FLAGGED"
  | "VERIFIED"
  | "ORGANIC"
  | "TOP10"
  | "CREATOR_HOLDS"
  | "CREATOR_TOKENS"
  | "LIQUIDITY"
  | "LIQUIDITY_CHANGE"
  | "AGE"
  | "HONEYPOT";

export type RiskFact = Readonly<{
  code: RiskFactCode;
  tone: "notice" | "plain";
  /** The state in one word the page translates: `active`, `revoked`, `yes`, `no`, or a source's own label. */
  state: string | null;
  /** The figure, where the fact has one: a per cent, a count, dollars, days. */
  value: number | null;
  source: TokenPageSource;
}>;

export type RiskInput = Readonly<{
  market: Readonly<{
    verified: boolean;
    liquidityUsd: number | null;
    organicScoreLabel: string | null;
    firstPoolAt: string | null;
    category: string | null;
    audit: Readonly<{ mintAuthorityDisabled: boolean | null; freezeAuthorityDisabled: boolean | null; topHoldersPct: number | null; devBalancePct: number | null; suspicious: boolean }>;
  }>;
  facts: TokenFacts | null;
  /** GeckoTerminal's honeypot check: true, false, null when it could not be read, undefined where it is not asked (SOL, a stock). */
  honeypot?: boolean | null;
  now: number;
}>;

/**
 * The facts of «Ризик», in the order a person reads them: powers over the
 * holders and the sources' flags first, then who holds, then the market.
 * A tokenized stock keeps only what is the chain's — its issuer's freeze and
 * mint rights are the instrument's design, and the issuer block says that.
 */
export function riskFactsOf(input: RiskInput): RiskFact[] {
  const { market, facts } = input;
  const facts_: RiskFact[] = [];
  const stock = market.category === "stock";
  if (market.audit.mintAuthorityDisabled !== null) {
    facts_.push({ code: "MINT_AUTHORITY", tone: market.audit.mintAuthorityDisabled || stock ? "plain" : "notice", state: market.audit.mintAuthorityDisabled ? "revoked" : "active", value: null, source: "jupiter" });
  }
  if (market.audit.freezeAuthorityDisabled !== null) {
    facts_.push({ code: "FREEZE_AUTHORITY", tone: market.audit.freezeAuthorityDisabled || stock ? "plain" : "notice", state: market.audit.freezeAuthorityDisabled ? "revoked" : "active", value: null, source: "jupiter" });
  }
  if (market.audit.suspicious) facts_.push({ code: "FLAGGED", tone: "notice", state: "yes", value: null, source: "jupiter" });
  if (input.honeypot === true) facts_.push({ code: "HONEYPOT", tone: "notice", state: "yes", value: null, source: "geckoterminal" });
  facts_.push({ code: "VERIFIED", tone: "plain", state: market.verified ? "yes" : "no", value: null, source: "jupiter" });
  if (market.organicScoreLabel) facts_.push({ code: "ORGANIC", tone: "plain", state: market.organicScoreLabel, value: null, source: "jupiter" });
  /* One concentration figure on the whole page — the catalogue's, the same the header shows. */
  if (market.audit.topHoldersPct !== null && !stock) facts_.push({ code: "TOP10", tone: "plain", state: null, value: market.audit.topHoldersPct, source: "jupiter" });
  if (market.audit.devBalancePct !== null && !stock) facts_.push({ code: "CREATOR_HOLDS", tone: "plain", state: null, value: market.audit.devBalancePct, source: "jupiter" });
  if (facts?.devMints !== null && facts?.devMints !== undefined && !stock) facts_.push({ code: "CREATOR_TOKENS", tone: "plain", state: null, value: facts.devMints, source: "jupiter" });
  if (market.liquidityUsd !== null) facts_.push({ code: "LIQUIDITY", tone: "plain", state: null, value: market.liquidityUsd, source: "jupiter" });
  const liquidityDay = facts?.windows.h24.liquidityChangePct ?? null;
  if (liquidityDay !== null) facts_.push({ code: "LIQUIDITY_CHANGE", tone: "plain", state: null, value: liquidityDay, source: "jupiter" });
  if (market.firstPoolAt) {
    const born = Date.parse(market.firstPoolAt);
    if (Number.isFinite(born) && born <= input.now) facts_.push({ code: "AGE", tone: "plain", state: null, value: (input.now - born) / 86_400_000, source: "jupiter" });
  }
  if (input.honeypot === false && !stock) facts_.push({ code: "HONEYPOT", tone: "plain", state: "no", value: null, source: "geckoterminal" });
  if (input.honeypot === null && !stock) facts_.push({ code: "HONEYPOT", tone: "plain", state: "unread", value: null, source: "geckoterminal" });
  return facts_;
}

/** GeckoTerminal's `/tokens/{mint}/info` answer → its honeypot check, or null where it states none. */
export function honeypotOf(body: unknown): boolean | null {
  const attributes = body && typeof body === "object" ? ((body as { data?: { attributes?: Record<string, unknown> } }).data?.attributes ?? null) : null;
  if (!attributes) return null;
  const value = attributes.is_honeypot;
  if (value === true || value === "yes") return true;
  if (value === false || value === "no") return false;
  return null;
}

/* -------------------------------------------------------- chart marks */

export type TokenMarkKind = "big-buy" | "big-sell" | "creator-buy" | "creator-sell" | "dex" | "liquidity-drop";

export type TokenMark = Readonly<{
  kind: TokenMarkKind;
  /** Unix seconds. */
  t: number;
  usd: number | null;
  /** For a creator's sale: the share of the supply it moved; for a liquidity drop: the change, per cent. */
  pct: number | null;
}>;

/** A trade this large or larger, and among the five largest the page read, is marked. */
export const BIG_TRADE_MIN_USD = 1_000;
const BIG_TRADE_COUNT = 3;
/** A fall in liquidity over a day this deep is marked on the newest candle. */
export const LIQUIDITY_DROP_PCT = -30;

/**
 * The marks the market itself puts on the chart, from what the page read:
 * the largest trades, the creator's own buys and sales with the share of the
 * supply a sale moved, the day the token left its curve, and a deep fall in
 * liquidity over the last day. The person's own trades are marked by the page
 * from the wallet's history, not from here.
 */
export function marksOf(input: Readonly<{
  trades: readonly TokenTrade[];
  facts: TokenFacts | null;
  supply: number | null;
  now: number;
}>): TokenMark[] {
  const marks: TokenMark[] = [];
  const dev = input.facts?.dev ?? null;
  const supply = input.supply ?? input.facts?.circulatingSupply ?? null;
  const big = input.trades
    .filter((trade) => trade.usd !== null && trade.usd >= BIG_TRADE_MIN_USD && trade.wallet !== dev)
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
    .slice(0, BIG_TRADE_COUNT);
  for (const trade of big) marks.push({ kind: trade.side === "buy" ? "big-buy" : "big-sell", t: Math.floor(Date.parse(trade.at) / 1000), usd: trade.usd, pct: null });
  if (dev) {
    for (const trade of input.trades) {
      if (trade.wallet !== dev) continue;
      marks.push({
        kind: trade.side === "buy" ? "creator-buy" : "creator-sell",
        t: Math.floor(Date.parse(trade.at) / 1000),
        usd: trade.usd,
        pct: supply !== null && supply > 0 ? (trade.tokenAmount / supply) * 100 : null,
      });
    }
  }
  const graduated = input.facts?.graduatedAt ? Date.parse(input.facts.graduatedAt) : NaN;
  if (Number.isFinite(graduated) && graduated <= input.now) marks.push({ kind: "dex", t: Math.floor(graduated / 1000), usd: null, pct: null });
  const drop = input.facts?.windows.h24.liquidityChangePct ?? null;
  if (drop !== null && drop <= LIQUIDITY_DROP_PCT) marks.push({ kind: "liquidity-drop", t: Math.floor(input.now / 1000), usd: null, pct: drop });
  return marks.sort((a, b) => a.t - b.t);
}

/**
 * The bar a moment belongs to: the newest candle that opened at or before it.
 * A moment before the first candle has no bar on this chart and is dropped;
 * marks that land on one bar are one mark with the strongest kind's face.
 */
export function snapToBars(times: readonly number[], t: number): number | null {
  let low = 0;
  let high = times.length - 1;
  let found: number | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (times[middle] <= t) {
      found = times[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** SOL has no creator, no curve and no holders worth listing: the token page reads its market only. */
export function isNativeToken(mint: string): boolean {
  return mint === WRAPPED_SOL_MINT;
}
