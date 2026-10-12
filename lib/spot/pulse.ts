/**
 * Pulse — the five feeds of Home, the `pulse`
 * part of the `TokenData` adapter (plan §5.2): Нові · Майже на DEX · Вийшли на
 * DEX · Тренди · Рухи, each a list of rows with the same figures, and the
 * person's filters over them.
 *
 * This file is pure: what a row is, how a Jupiter Tokens V2 row becomes one,
 * how a launch curve's account says how far it is to the DEX, how each feed
 * orders its rows and how the filters cut them. The reads are
 * `pulse.server.ts`.
 *
 * Sources, each with its right to show (plan §5.4): Jupiter Tokens V2 for
 * every figure of a row («Powered by Jupiter»); GeckoTerminal for which curves
 * trade the most («Powered by GeckoTerminal»); the chain itself for how far a
 * curve is — the curve's own account, no provider's estimate; and Ryntra's own
 * records for the markets launched on Ryntra, which stand first in every feed
 * whose condition their own data meets.
 *
 * Nothing here is a verdict. A row carries the facts that count against a
 * token — a mint or freeze right still on, Jupiter's «suspicious» flag — as a
 * count and a list; a feed never calls a token safe.
 */

import { normalizeSpotMarket, type SpotMarket } from "./markets.ts";
import { riskFactsOf, tokenFactsOf, type TokenWindow } from "./token-page.ts";

export const PULSE_FEEDS = ["new", "soon", "dex", "trending", "movers"] as const;
export type PulseFeed = (typeof PULSE_FEEDS)[number];

export function isPulseFeed(value: unknown): value is PulseFeed {
  return typeof value === "string" && (PULSE_FEEDS as readonly string[]).includes(value);
}

/** The windows a feed is read over: «Тренди» by any of Jupiter's four, «Рухи» by the hour or the day (plan §3.2). */
export const PULSE_WINDOWS: Readonly<Record<PulseFeed, readonly TokenWindow[]>> = {
  new: ["m5"],
  soon: ["h1"],
  dex: ["h24"],
  trending: ["m5", "h1", "h6", "h24"],
  movers: ["h1", "h24"],
};

/** The window each feed opens on. */
export const PULSE_DEFAULT_WINDOW: Readonly<Record<PulseFeed, TokenWindow>> = {
  new: "m5",
  soon: "h1",
  dex: "h24",
  trending: "h1",
  movers: "h24",
};

export function pulseWindowOf(feed: PulseFeed, value: unknown): TokenWindow {
  return typeof value === "string" && (PULSE_WINDOWS[feed] as readonly string[]).includes(value) ? (value as TokenWindow) : PULSE_DEFAULT_WINDOW[feed];
}

/** The most rows one feed answers with. */
export const PULSE_ROWS = 60;
/** «Майже на DEX»: a curve this far along or further; Ryntra's own markets on a curve stand first at any point. */
export const SOON_MIN_PCT = 25;
/** «Вийшли на DEX»: tokens that left their curve within this span. */
export const DEX_SPAN_MS = 24 * 60 * 60 * 1000;
/** «Нові»: Ryntra's own markets launched within this span stand first. */
export const NEW_SPAN_MS = 24 * 60 * 60 * 1000;
/** «Нові»: every other token's first pool is at most this old — «just created», not the day's trending. */
export const NEW_TOKEN_SPAN_MS = 60 * 60 * 1000;
/** «Рухи» counts only markets this deep: below it a few dollars move a price by half and the list would be noise. */
export const MOVERS_MIN_LIQUIDITY_USD = 10_000;

export type PulseWindowFigures = Readonly<{ changePct: number | null; volumeUsd: number | null }>;

/** A launch curve's way to the DEX, as its own account states it. */
export type PulseCurve = Readonly<{
  venue: PulseCurveVenue;
  /** 0–100. */
  progressPct: number;
  /** The curve is full: the token has left it or is leaving it now. */
  complete: boolean;
}>;

export type PulseCurveVenue = "pump" | "meteora-dbc" | "launchlab";

/** The facts that count against a token, by the token page's own codes (`riskFactsOf`, tone «notice»). */
export type PulseNotice = "MINT_AUTHORITY" | "FREEZE_AUTHORITY" | "FLAGGED";

export type PulseRyntra = Readonly<{
  preset: string;
  /** Ryntra's own launch — technical validation, never demand; the row says so. */
  technicalValidation: boolean;
  launchedAt: string;
  /** The market traded within the last day, as Ryntra's read of it states. */
  traded24h: boolean | null;
  /** Whole days since the market left its curve for the DEX, as Ryntra's read states; null on the curve or not read. */
  daysSinceDex: number | null;
  /** The pair is a dollar: the person's quick sums apply; a community pair keeps its own amounts on its page. */
  dollarPair: boolean;
}>;

export type PulseRow = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  /** The launchpad by the name people know it by; null where Jupiter names none. */
  launchpad: string | null;
  price: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  /** The holders are a floor (the node would not list every account): shown as «≥ N». */
  holdersAtLeast: boolean;
  windows: Readonly<Record<TokenWindow, PulseWindowFigures>>;
  /** When the first pool was created — the token's age on the market. */
  firstPoolAt: string | null;
  /** When the token left its curve for a DEX, as Jupiter states it. */
  graduatedAt: string | null;
  /** 0–100, Jupiter's scale; null where it states none. */
  top10Pct: number | null;
  devPct: number | null;
  verified: boolean;
  organic: string | null;
  /** Jupiter stated the token's audit (its rights, its flag): without it the facts against the token are not read — never «none». */
  auditRead: boolean;
  notices: readonly PulseNotice[];
  curve: PulseCurve | null;
  ryntra: PulseRyntra | null;
}>;

/** The launchpads Jupiter names, by the names their own sites use. */
const LAUNCHPAD_NAMES: Readonly<Record<string, string>> = {
  "pump.fun": "pump.fun",
  "met-dbc": "Meteora DBC",
  "letsbonk.fun": "bonk.fun",
  "raydium-launchlab": "LaunchLab",
  launchlab: "LaunchLab",
  "jup-studio": "Jupiter Studio",
  stonkfun: "StonkFun",
  metadao: "MetaDAO",
  believe: "Believe",
  Believe: "Believe",
  moonshot: "Moonshot",
  "boop.fun": "boop.fun",
};

export function launchpadName(raw: string | null): string | null {
  if (!raw) return null;
  return LAUNCHPAD_NAMES[raw] ?? LAUNCHPAD_NAMES[raw.toLowerCase()] ?? raw.slice(0, 24);
}

const NOTICE_CODES: ReadonlySet<string> = new Set(["MINT_AUTHORITY", "FREEZE_AUTHORITY", "FLAGGED"]);

/** The facts that count against a token, by the token page's own rule — so a row and its page never disagree. */
export function noticesOf(market: SpotMarket, now: number): PulseNotice[] {
  return riskFactsOf({ market, facts: null, now })
    .filter((fact) => fact.tone === "notice" && NOTICE_CODES.has(fact.code))
    .map((fact) => fact.code as PulseNotice);
}

/** One Jupiter Tokens V2 row → one Pulse row, or null when the row has no identity or is a tokenized stock. */
export function pulseRowOf(raw: unknown, now: number): PulseRow | null {
  const market = normalizeSpotMarket(raw);
  const facts = tokenFactsOf(raw);
  if (!market || !facts) return null;
  /* A tokenized stock has its own place (the company's page); Pulse is the market of coins and new tokens. */
  if (market.category === "stock") return null;
  const windows = {} as Record<TokenWindow, PulseWindowFigures>;
  for (const key of ["m5", "h1", "h6", "h24"] as const) windows[key] = { changePct: facts.windows[key].priceChangePct, volumeUsd: facts.windows[key].volumeUsd };
  return {
    mint: market.mint,
    symbol: market.symbol,
    name: market.name,
    icon: market.icon,
    launchpad: launchpadName(facts.launchpad),
    price: market.price,
    marketCapUsd: market.marketCapUsd,
    liquidityUsd: market.liquidityUsd,
    holders: market.holders,
    holdersAtLeast: false,
    windows,
    firstPoolAt: market.firstPoolAt,
    graduatedAt: facts.graduatedAt,
    top10Pct: market.audit.topHoldersPct,
    devPct: market.audit.devBalancePct,
    verified: market.verified,
    organic: market.organicScoreLabel,
    /* Both rights stated, on or off: only then is «no fact against it» a statement. */
    auditRead: market.audit.mintAuthorityDisabled !== null && market.audit.freezeAuthorityDisabled !== null,
    notices: noticesOf(market, now),
    curve: null,
    ryntra: null,
  };
}

/** The raw launchpad name of a Jupiter row, for choosing how its curve is read. */
export function rawLaunchpadOf(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as { launchpad?: unknown }).launchpad;
  return typeof value === "string" && value.length > 0 && value.length <= 48 ? value : null;
}

/** Whether Jupiter states the token has left its curve. */
export function graduatedOf(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const row = raw as { graduatedPool?: unknown; graduatedAt?: unknown };
  return (typeof row.graduatedPool === "string" && row.graduatedPool.length > 0) || typeof row.graduatedAt === "string";
}

/* ------------------------------------------------------------ curves */

/** pump.fun: the curve sells this many base units before it is full (793.1 M tokens at 6 decimals). */
export const PUMP_CURVE_TOKENS_RAW = 793_100_000_000_000n;
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const LAUNCHLAB_PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";

function u64At(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null;
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(data[offset + index] as number);
  return value;
}

function pctOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  const bps = Number((part * 10_000n) / whole);
  return Math.min(100, Math.max(0, bps / 100));
}

/**
 * A pump.fun bonding curve (`["bonding-curve", mint]` of the pump program):
 * after the 8-byte discriminator, the virtual token and SOL reserves, the real
 * token reserves, the real SOL reserves, the supply, then `complete`. The curve
 * is as far along as the share of its 793.1 M tokens already sold.
 */
export function pumpCurveOf(data: Uint8Array): PulseCurve | null {
  const realTokens = u64At(data, 24);
  if (realTokens === null || data.length < 49) return null;
  const complete = data[48] === 1;
  const sold = realTokens >= PUMP_CURVE_TOKENS_RAW ? 0n : PUMP_CURVE_TOKENS_RAW - realTokens;
  return { venue: "pump", progressPct: complete ? 100 : pctOf(sold, PUMP_CURVE_TOKENS_RAW), complete };
}

/**
 * A Raydium LaunchLab pool (bonk.fun's and LaunchLab's curves): after the
 * discriminator, the epoch, five one-byte fields (the status at offset 17 —
 * 0 on the curve), the supply, the base to sell, the virtual reserves, the
 * real base and the real quote raised (offset 61), then the quote the curve
 * raises before the DEX (offset 69).
 */
export function launchlabCurveOf(data: Uint8Array): PulseCurve | null {
  const raised = u64At(data, 61);
  const target = u64At(data, 69);
  if (raised === null || target === null || target === 0n || data.length < 77) return null;
  const status = data[17];
  const complete = status !== 0 || raised >= target;
  return { venue: "launchlab", progressPct: complete ? 100 : pctOf(raised, target), complete };
}

/** A Meteora DBC curve: the quote it holds against its config's migration threshold. */
export function dbcCurveOf(quoteReserve: bigint, threshold: bigint, migrated: boolean): PulseCurve | null {
  if (threshold <= 0n) return null;
  const complete = migrated || quoteReserve >= threshold;
  return { venue: "meteora-dbc", progressPct: complete ? 100 : pctOf(quoteReserve, threshold), complete };
}

/* ------------------------------------------------------------ filters */

export type PulseFilter = Readonly<{
  marketCapMin: number | null;
  marketCapMax: number | null;
  liquidityMin: number | null;
  volumeMin: number | null;
  /** Hours on the market, from the first pool. */
  ageMinHours: number | null;
  ageMaxHours: number | null;
  holdersMin: number | null;
  /** The top ten holders' share at most, per cent. */
  top10Max: number | null;
  /** The creator's share at most, per cent. */
  devMax: number | null;
  /** Leave out tokens with any fact against them. */
  noNotices: boolean;
}>;

export const PULSE_FILTER_NONE: PulseFilter = Object.freeze({
  marketCapMin: null,
  marketCapMax: null,
  liquidityMin: null,
  volumeMin: null,
  ageMinHours: null,
  ageMaxHours: null,
  holdersMin: null,
  top10Max: null,
  devMax: null,
  noNotices: false,
});

export const PULSE_FILTER_KEYS = Object.keys(PULSE_FILTER_NONE) as readonly (keyof PulseFilter)[];

/** How many of the filters are set. */
export function activeFilters(filter: PulseFilter): number {
  return PULSE_FILTER_KEYS.filter((key) => (key === "noNotices" ? filter.noNotices : filter[key] !== null)).length;
}

/** A filter as stored on the device, or none for anything that is not one. */
export function readPulseFilter(raw: unknown): PulseFilter {
  if (!raw || typeof raw !== "object") return PULSE_FILTER_NONE;
  const value = raw as Record<string, unknown>;
  const number = (key: string) => {
    const item = value[key];
    return typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1e13 ? item : null;
  };
  return {
    marketCapMin: number("marketCapMin"),
    marketCapMax: number("marketCapMax"),
    liquidityMin: number("liquidityMin"),
    volumeMin: number("volumeMin"),
    ageMinHours: number("ageMinHours"),
    ageMaxHours: number("ageMaxHours"),
    holdersMin: number("holdersMin"),
    top10Max: number("top10Max"),
    devMax: number("devMax"),
    noNotices: value.noNotices === true,
  };
}

/** A token's hours on the market, or null where its first pool is not stated. */
export function ageHoursOf(row: Pick<PulseRow, "firstPoolAt" | "ryntra">, now: number): number | null {
  const stamp = Date.parse(row.firstPoolAt ?? row.ryntra?.launchedAt ?? "");
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, (now - stamp) / 3_600_000);
}

/**
 * Whether a row passes the filter. A figure nobody stated never passes a
 * bound set on it — unknown is not good — and a bound left empty asks nothing.
 */
export function passesFilter(row: PulseRow, filter: PulseFilter, window: TokenWindow, now: number): boolean {
  const atLeast = (value: number | null, bound: number | null) => bound === null || (value !== null && value >= bound);
  const atMost = (value: number | null, bound: number | null) => bound === null || (value !== null && value <= bound);
  const age = ageHoursOf(row, now);
  return (
    atLeast(row.marketCapUsd, filter.marketCapMin) &&
    atMost(row.marketCapUsd, filter.marketCapMax) &&
    atLeast(row.liquidityUsd, filter.liquidityMin) &&
    atLeast(row.windows[window].volumeUsd, filter.volumeMin) &&
    atLeast(age, filter.ageMinHours) &&
    atMost(age, filter.ageMaxHours) &&
    atLeast(row.holders, filter.holdersMin) &&
    atMost(row.top10Pct, filter.top10Max) &&
    atMost(row.devPct, filter.devMax) &&
    /* «No fact against it» asks for the facts read and none found — a token whose audit was not read does not pass. */
    (!filter.noNotices || (row.auditRead && row.notices.length === 0))
  );
}

/* ------------------------------------------------------------ feeds */

const stampOf = (iso: string | null | undefined) => {
  const value = Date.parse(iso ?? "");
  return Number.isFinite(value) ? value : 0;
};

/** One row per mint, the first seen kept, with what a later source adds where the first left a gap. */
export function mergeRows(rows: readonly PulseRow[]): PulseRow[] {
  const byMint = new Map<string, PulseRow>();
  for (const row of rows) {
    const seen = byMint.get(row.mint);
    if (!seen) {
      byMint.set(row.mint, row);
      continue;
    }
    byMint.set(row.mint, { ...seen, curve: seen.curve ?? row.curve, ryntra: seen.ryntra ?? row.ryntra, icon: seen.icon ?? row.icon });
  }
  return [...byMint.values()];
}

/**
 * The order of each feed, by the data alone — no hand-picked top. Ryntra's
 * own markets stand first wherever their own data meets the feed's condition.
 *
 * - **Нові** — the newest first pools; Ryntra's markets launched within a day first.
 * - **Майже на DEX** — curves not yet full, furthest first, from {@link SOON_MIN_PCT}; Ryntra's on a curve first.
 * - **Вийшли на DEX** — left their curve within a day, the latest first; Ryntra's that did first.
 * - **Тренди** — Jupiter's trending order for the window, as given; Ryntra's that traded within the day first.
 * - **Рухи** — the window's largest rise (or, with `down`, fall), markets of {@link MOVERS_MIN_LIQUIDITY_USD} and deeper.
 */
export function feedRows(feed: PulseFeed, rows: readonly PulseRow[], window: TokenWindow, now: number, down = false): PulseRow[] {
  const ours = (row: PulseRow) => row.ryntra !== null;
  const first = (picked: PulseRow[], order: (a: PulseRow, b: PulseRow) => number) =>
    [...picked.filter(ours).sort(order), ...picked.filter((row) => !ours(row)).sort(order)].slice(0, PULSE_ROWS);
  if (feed === "new") {
    const picked = rows.filter((row) => {
      if (ours(row)) return now - stampOf(row.ryntra!.launchedAt) <= NEW_SPAN_MS;
      const born = stampOf(row.firstPoolAt);
      return born > 0 && now - born <= NEW_TOKEN_SPAN_MS;
    });
    return first(picked, (a, b) => stampOf(b.firstPoolAt ?? b.ryntra?.launchedAt) - stampOf(a.firstPoolAt ?? a.ryntra?.launchedAt) || a.mint.localeCompare(b.mint));
  }
  if (feed === "soon") {
    const picked = rows.filter((row) => row.curve !== null && !row.curve.complete && row.graduatedAt === null && (ours(row) || row.curve.progressPct >= SOON_MIN_PCT));
    return first(picked, (a, b) => b.curve!.progressPct - a.curve!.progressPct || a.mint.localeCompare(b.mint));
  }
  if (feed === "dex") {
    const picked = rows.filter((row) => {
      const at = stampOf(row.graduatedAt);
      if (at > 0) return at <= now + 60_000 && now - at <= DEX_SPAN_MS;
      /* A Ryntra market Jupiter has no date for: its own read says it reached the DEX today. */
      return ours(row) && row.curve?.complete === true && row.ryntra!.daysSinceDex === 0;
    });
    return first(picked, (a, b) => stampOf(b.graduatedAt) - stampOf(a.graduatedAt) || a.mint.localeCompare(b.mint));
  }
  if (feed === "trending") {
    /* The given order is Jupiter's rank; Ryntra's markets that traded today go first, the rest keep their place. */
    const index = new Map(rows.map((row, at) => [row.mint, at]));
    const picked = rows.filter((row) => !ours(row) || row.ryntra!.traded24h === true);
    return first(picked, (a, b) => (index.get(a.mint) ?? 0) - (index.get(b.mint) ?? 0));
  }
  const change = (row: PulseRow) => row.windows[window].changePct;
  const picked = rows.filter((row) => {
    const value = change(row);
    return value !== null && (down ? value < 0 : value > 0) && row.liquidityUsd !== null && row.liquidityUsd >= MOVERS_MIN_LIQUIDITY_USD;
  });
  return first(picked, (a, b) => (down ? change(a)! - change(b)! : change(b)! - change(a)!) || a.mint.localeCompare(b.mint));
}

/** A row's own page: a market launched on Ryntra opens its launch page; every other token its token page. */
export function pulseHref(row: Pick<PulseRow, "mint" | "ryntra">, buyUsd?: number): string {
  const base = row.ryntra ? `/app/launch/${encodeURIComponent(row.mint)}` : `/app/spot?mint=${encodeURIComponent(row.mint)}`;
  if (buyUsd === undefined) return base;
  return `${base}${base.includes("?") ? "&" : "?"}buy=${encodeURIComponent(String(buyUsd))}`;
}
