/**
 * «Події ринку»: one feed of what
 * happened on Solana's markets — a new token, a token out to a DEX, an Alpha Vault opened, a pool's liquidity changed,
 * a mint or freeze right still on, a creator's lock opening, a creator's sale, an act of a launch's flight log — each
 * with its type, when it happened and when Ryntra saw it, its sources, the transaction or the account anyone can open,
 * how final it is and how fresh.
 *
 * This file is pure: what an event is, how a Pulse row, a market launched on Ryntra, a flight log's entry and an early
 * access record become events, how one fact told twice — a webhook sent again, two sources of one graduation — stays
 * one record, and the feed's order. The reads are `market-events.server.ts`.
 *
 * Nothing here is advice. An event is a fact with its source: never a «signal», never a «buy», no score. A token's risk flags are Pulse's own (`pulseFlagsOf`), the same on Home, in the Radar and here; a suspicious
 * token's event is shown with its reason but never at the top of the feed. An event opens the token's own page, where a
 * trade has its quote and its Review — the feed has no trade button.
 */

import type { JournalActor, JournalEvent, JournalKind } from "../core/launch/autopilot.ts";
import { explorerAddressUrl, explorerTxUrl } from "../solana/explorer.ts";
import { borrowedNameOf, pulseFlagsOf, pulseHref, pulseUnstatedOf, type PulseCurveVenue, type PulseFlag, type PulseRow, type PulseUnstated } from "../spot/pulse.ts";

/** The kinds of event the feed knows, in the order its filter offers them. */
export const EVENT_KINDS = [
  "TOKEN_CREATED",
  "DEX_LISTED",
  "ALPHA_VAULT",
  "LIQUIDITY_CHANGED",
  "CONCENTRATION_CHANGED",
  "AUTHORITY_OPEN",
  "UNLOCK",
  "CREATOR_SOLD",
  "QUOTE_CHANGED",
  "LAUNCH_LOG",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * Where a fact comes from: `chain` — Ryntra read the transaction or the account on Solana itself; `jupiter` — Jupiter
 * Tokens V2 states it («Powered by Jupiter»); `launch` — Ryntra Launch's own records: the launch, its flight log and
 * MarketOS's executor receipts, each resting on a confirmed transaction.
 */
export const EVENT_SOURCES = ["chain", "jupiter", "launch"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/**
 * How final a fact is: `confirmed` — its transaction was read at the network's confirmed commitment; `reported` — a
 * provider states it and Ryntra did not read a transaction of it; `scheduled` — a time an account on the chain holds
 * (a lock's cliff), with no transaction of its own.
 */
export const EVENT_FINALITY = ["confirmed", "reported", "scheduled"] as const;
export type EventFinality = (typeof EVENT_FINALITY)[number];

/** Why a token's event is held below the top of the feed: Jupiter's own flag, a borrowed brand or name, a copy of another token's name. */
export const SUSPICION_REASONS = ["FLAGGED", "BORROWED_NAME", "NAME_COPY"] as const;
export type SuspicionReason = (typeof SUSPICION_REASONS)[number];

export type EventNetwork = "mainnet" | "devnet";

/** Pulse's risk flags and the figures they rest on that nobody stated, as codes a client can read (`pulseFlagsOf`). */
export const EVENT_FLAGS = ["MINT_AUTHORITY", "FREEZE_AUTHORITY", "FLAGGED", "BORROWED_NAME", "CREATOR_MANY", "LIQUIDITY_THIN", "HOLDERS_FEW", "BRAND_NEW"] as const satisfies readonly PulseFlag[];
export const EVENT_UNSTATED = ["RIGHTS", "HOLDERS", "CREATOR", "AGE"] as const satisfies readonly PulseUnstated[];
export const EVENT_VENUES = ["pump", "meteora-dbc", "launchlab"] as const satisfies readonly PulseCurveVenue[];

/** The way to the DEX: the launch program the token left and, where it is known, the pool it entered. */
export type EventRoute = Readonly<{ from: PulseCurveVenue | null; to: "damm-v2" | null }>;

export type MarketEvent = Readonly<{
  /**
   * One fact, one record: `signature:index` for a fact with a transaction — the index is the kind's fixed place in
   * {@link EVENT_INDEX}, so two reads of one transaction name the same record — and `source:mint:kind[:key]` for a fact a
   * provider states without one.
   */
  id: string;
  kind: EventKind;
  network: EventNetwork;
  token: Readonly<{
    mint: string;
    symbol: string;
    name: string;
    /** A picture only for a token Jupiter verified: a minutes-old token's picture nobody has looked at (B2b). */
    icon: string | null;
    /** The token's own page — a launch's for a market launched on Ryntra; its quote and Review are there, never here. */
    href: string;
    launchedOnRyntra: boolean;
  }>;
  /** When it happened: the block's time, a provider's stated time or a lock's cliff; null when no source states it. */
  happenedAt: string | null;
  /** A fact stated over a window rather than at a moment — «within the hour». */
  happenedWithin: "h1" | "h24" | null;
  /** When Ryntra saw it: the read that carried it. */
  observedAt: string;
  sources: readonly EventSource[];
  finality: EventFinality;
  /** The figures behind it are a held copy from an earlier read. */
  stale: boolean;
  signature: string | null;
  /** The account to open where there is no transaction: the mint, the pool, the escrow, the vault. */
  account: string | null;
  /* ---- what the kind says ---- */
  route: EventRoute | null;
  /** Who sent it, as the flight log names them. */
  actor: JournalActor | null;
  /** The flight log's own kind, for the launch's acts. */
  journalKind: JournalKind | null;
  /** A creator's sale: the share sold by then, basis points — of what they bought on Ryntra, or of the supply. */
  soldBps: number | null;
  soldOf: "bought" | "supply" | null;
  /** A liquidity change over its window, per cent. */
  changePct: number | null;
  /** A right still on. */
  authority: "MINT" | "FREEZE" | null;
  /** A lock's cliff or its end. */
  unlock: "cliff" | "end" | null;
  /** The pair currency and the token the act moved, raw, with what reads them. */
  pairRaw: string | null;
  tokensRaw: string | null;
  pair: Readonly<{ symbol: string; decimals: number }> | null;
  tokenDecimals: number | null;
  /* ---- the token's risk, as Pulse reads it ---- */
  flags: readonly PulseFlag[];
  unstated: readonly PulseUnstated[];
  /** The known brand or person a token's name borrows, for the flag's words. */
  borrowedLabel: string | null;
  suspicious: readonly SuspicionReason[];
}>;

/** A kind's fixed place inside one transaction: the `index` of `signature:index`. */
export const EVENT_INDEX: Readonly<Record<JournalKind | "VAULT", number>> = {
  LAUNCHED: 0,
  CREATOR_BOUGHT: 1,
  CREATOR_LOCKED: 2,
  FEES_SHARED: 3,
  CREATOR_SOLD: 4,
  GRADUATED: 5,
  FLOOR_POOL: 6,
  FLOOR_PLACED: 7,
  FLOOR_WITHDRAWN: 8,
  FLOOR_RAISED: 9,
  FLOOR_ADDED: 10,
  FEE_CLAIMED: 11,
  VAULT: 12,
};

/** The flight log's kinds that change the liquidity of a launch's market: Ryntra's steps placed, moved, added to or emptied. */
const LIQUIDITY_KINDS: ReadonlySet<JournalKind> = new Set(["FLOOR_PLACED", "FLOOR_WITHDRAWN", "FLOOR_RAISED", "FLOOR_ADDED"]);

/** The most new tokens one answer carries: Solana makes thousands a day, and the feed is more than a list of births. */
export const NEW_TOKENS_MAX = 20;
/** «Вийшов на DEX» from Jupiter: graduated within this span. */
export const DEX_EVENT_SPAN_MS = 24 * 60 * 60 * 1000;
/** A pool's liquidity moved this much or more over the hour, per cent, either way. */
export const LIQUIDITY_EVENT_PCT = 50;
/** …in a market at least this deep, in dollars: below it a few dollars move a pool by half. */
export const LIQUIDITY_EVENT_MIN_USD = 10_000;
/** A lock's cliff or end is an event for this long after it. */
export const UNLOCK_SPAN_MS = 7 * 24 * 60 * 60 * 1000;
/** No suspicious token's event stands among the feed's first this many. */
export const SUSPICIOUS_FLOOR = 5;
/** The most events one answer carries. */
export const EVENTS_MAX = 200;

/** The kinds the feed reads now and the ones it does not yet — said on the page, never a missing kind passed off as quiet. */
export const EVENT_COVERAGE: Readonly<Record<EventKind, Readonly<{ state: "read" | "partial" | "not-read"; sources: readonly EventSource[] }>>> = {
  /* Jupiter's lists of the newest and most traded tokens, not every token Solana makes; every launch on Ryntra whose log is read. */
  TOKEN_CREATED: { state: "partial", sources: ["jupiter", "launch", "chain"] },
  DEX_LISTED: { state: "partial", sources: ["jupiter", "launch", "chain"] },
  ALPHA_VAULT: { state: "read", sources: ["launch", "chain"] },
  /* Jupiter's hour for every token, the executor's steps for a launch's market; a pool's own history is not kept yet. */
  LIQUIDITY_CHANGED: { state: "partial", sources: ["jupiter", "launch", "chain"] },
  /* A change of concentration needs the holders' shares over time; Ryntra keeps no history of them yet. */
  CONCENTRATION_CHANGED: { state: "not-read", sources: [] },
  /* Mint and freeze as Jupiter states them now — the state, not the moment a right appeared; a Token-2022 permanent delegate is not read yet. */
  AUTHORITY_OPEN: { state: "partial", sources: ["jupiter"] },
  UNLOCK: { state: "read", sources: ["launch", "chain"] },
  CREATOR_SOLD: { state: "read", sources: ["launch", "chain"] },
  /* The quote-token monitor is SOL-L12, not live yet. */
  QUOTE_CHANGED: { state: "not-read", sources: [] },
  LAUNCH_LOG: { state: "read", sources: ["launch", "chain"] },
};

/* ------------------------------------------------------------ the token */

type TokenView = MarketEvent["token"];

function tokenOf(row: PulseRow): TokenView {
  return { mint: row.mint, symbol: row.symbol, name: row.name, icon: row.verified && row.ryntra === null ? row.icon : null, href: pulseHref(row), launchedOnRyntra: row.ryntra !== null };
}

/** The token's risk as Pulse reads it, and why its event would sit below the top. */
function riskOf(row: PulseRow, now: number, twins: number): Pick<MarketEvent, "flags" | "unstated" | "borrowedLabel" | "suspicious"> {
  const flags = pulseFlagsOf(row, now);
  const borrowedLabel = borrowedNameOf(row);
  const suspicious: SuspicionReason[] = [];
  if (flags.includes("FLAGGED")) suspicious.push("FLAGGED");
  if (borrowedLabel !== null) suspicious.push("BORROWED_NAME");
  if (twins > 0 && !row.verified) suspicious.push("NAME_COPY");
  return { flags, unstated: pulseUnstatedOf(row, now), borrowedLabel, suspicious };
}

const BLANK = {
  happenedWithin: null,
  stale: false,
  signature: null,
  account: null,
  route: null,
  actor: null,
  journalKind: null,
  soldBps: null,
  soldOf: null,
  changePct: null,
  authority: null,
  unlock: null,
  pairRaw: null,
  tokensRaw: null,
  pair: null,
  tokenDecimals: null,
} as const;

/** How a read is told: when it was made, whether it is a held copy, how many other tokens of the read share each one's name. */
export type ReadContext = Readonly<{ observedAt: string; stale: boolean; now: number; twins?: ReadonlyMap<string, number> }>;

/* ------------------------------------------------------------ Jupiter's rows */

const stampOf = (iso: string | null | undefined) => {
  const value = Date.parse(iso ?? "");
  return Number.isFinite(value) ? value : null;
};

/** A token just born, as Jupiter states its first pool: the newest {@link NEW_TOKENS_MAX}. */
export function createdEventsOf(rows: readonly PulseRow[], read: ReadContext): MarketEvent[] {
  return rows
    .filter((row) => {
      const at = stampOf(row.firstPoolAt);
      /* A time in the future is a provider's error, never the top of the feed. */
      return row.ryntra === null && at !== null && at <= read.now + 60_000;
    })
    .sort((a, b) => (stampOf(b.firstPoolAt) ?? 0) - (stampOf(a.firstPoolAt) ?? 0) || a.mint.localeCompare(b.mint))
    .slice(0, NEW_TOKENS_MAX)
    .map((row) => ({
      ...BLANK,
      id: `jupiter:${row.mint}:TOKEN_CREATED`,
      kind: "TOKEN_CREATED",
      network: "mainnet",
      token: tokenOf(row),
      happenedAt: row.firstPoolAt,
      observedAt: read.observedAt,
      sources: ["jupiter"],
      finality: "reported",
      stale: read.stale,
      account: row.mint,
      route: row.venue ? { from: row.venue, to: null } : null,
      ...riskOf(row, read.now, read.twins?.get(row.mint) ?? 0),
    }));
}

/** A token out of its curve to a DEX within the day, as Jupiter states it: the pool it entered is the account to open. */
export function listedEventsOf(rows: readonly PulseRow[], read: ReadContext): MarketEvent[] {
  return rows
    .filter((row) => {
      const at = stampOf(row.graduatedAt);
      return row.ryntra === null && at !== null && at <= read.now + 60_000 && read.now - at <= DEX_EVENT_SPAN_MS;
    })
    .map((row) => ({
      ...BLANK,
      id: `jupiter:${row.mint}:DEX_LISTED`,
      kind: "DEX_LISTED",
      network: "mainnet",
      token: tokenOf(row),
      happenedAt: row.graduatedAt,
      observedAt: read.observedAt,
      sources: ["jupiter"],
      finality: "reported",
      stale: read.stale,
      account: row.graduatedPool ?? row.mint,
      route: { from: row.venue, to: null },
      ...riskOf(row, read.now, read.twins?.get(row.mint) ?? 0),
    }));
}

/**
 * A pool's liquidity moved by {@link LIQUIDITY_EVENT_PCT} % or more over the hour in a market of
 * {@link LIQUIDITY_EVENT_MIN_USD} or deeper, as Jupiter states it — one record a token an hour, by the hour it was seen.
 */
export function liquidityEventsOf(rows: readonly PulseRow[], read: ReadContext): MarketEvent[] {
  const hour = Math.floor((stampOf(read.observedAt) ?? read.now) / 3_600_000);
  return rows
    .filter((row) => {
      const change = row.windows.h1.liquidityChangePct ?? null;
      return row.ryntra === null && change !== null && Number.isFinite(change) && Math.abs(change) >= LIQUIDITY_EVENT_PCT && row.liquidityUsd !== null && row.liquidityUsd >= LIQUIDITY_EVENT_MIN_USD;
    })
    .map((row) => ({
      ...BLANK,
      id: `jupiter:${row.mint}:LIQUIDITY_CHANGED:${hour}`,
      kind: "LIQUIDITY_CHANGED",
      network: "mainnet",
      token: tokenOf(row),
      happenedAt: null,
      happenedWithin: "h1",
      observedAt: read.observedAt,
      sources: ["jupiter"],
      finality: "reported",
      stale: read.stale,
      account: row.mint,
      changePct: row.windows.h1.liquidityChangePct ?? null,
      ...riskOf(row, read.now, read.twins?.get(row.mint) ?? 0),
    }));
}

/**
 * A mint or freeze right still on, on a token Jupiter has not verified: a fact Jupiter states at its read — when the
 * right was set nobody states, so the event says when it was seen, never when it happened.
 */
export function authorityEventsOf(rows: readonly PulseRow[], read: ReadContext): MarketEvent[] {
  const out: MarketEvent[] = [];
  for (const row of rows) {
    if (row.ryntra !== null || row.verified) continue;
    for (const [notice, authority] of [
      ["MINT_AUTHORITY", "MINT"],
      ["FREEZE_AUTHORITY", "FREEZE"],
    ] as const) {
      if (!row.notices.includes(notice)) continue;
      out.push({
        ...BLANK,
        id: `jupiter:${row.mint}:AUTHORITY_OPEN:${authority}`,
        kind: "AUTHORITY_OPEN",
        network: "mainnet",
        token: tokenOf(row),
        happenedAt: null,
        observedAt: read.observedAt,
        sources: ["jupiter"],
        finality: "reported",
        stale: read.stale,
        account: row.mint,
        authority,
        ...riskOf(row, read.now, read.twins?.get(row.mint) ?? 0),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------ a launch on Ryntra */

/** What the events of one launch's flight log need besides the log: the token as a Pulse row (its risk), the network, the pair. */
export type LaunchContext = Readonly<{
  row: PulseRow;
  network: EventNetwork;
  pair: Readonly<{ symbol: string; decimals: number }> | null;
  tokenDecimals: number | null;
  observedAt: string;
  now: number;
}>;

function kindOfJournal(kind: JournalKind): EventKind {
  if (kind === "LAUNCHED") return "TOKEN_CREATED";
  if (kind === "GRADUATED") return "DEX_LISTED";
  if (kind === "CREATOR_SOLD") return "CREATOR_SOLD";
  if (LIQUIDITY_KINDS.has(kind)) return "LIQUIDITY_CHANGED";
  return "LAUNCH_LOG";
}

/** One flight log's entries as events: every one with its confirmed transaction (MarketOS, `journal.server.ts`). */
export function journalEventsOf(entries: readonly Pick<JournalEvent, "kind" | "at" | "signature" | "actor" | "pairRaw" | "tokensRaw" | "soldBps" | "soldOf">[], launch: LaunchContext): MarketEvent[] {
  const risk = riskOf(launch.row, launch.now, 0);
  return entries.map((entry) => ({
    ...BLANK,
    ...risk,
    id: `${entry.signature}:${EVENT_INDEX[entry.kind]}`,
    kind: kindOfJournal(entry.kind),
    network: launch.network,
    token: tokenOf(launch.row),
    happenedAt: entry.at,
    observedAt: launch.observedAt,
    sources: ["launch", "chain"],
    finality: "confirmed",
    signature: entry.signature,
    route: entry.kind === "GRADUATED" ? { from: "meteora-dbc", to: "damm-v2" } : null,
    actor: entry.actor,
    journalKind: entry.kind,
    soldBps: entry.kind === "CREATOR_SOLD" ? entry.soldBps : null,
    soldOf: entry.kind === "CREATOR_SOLD" ? entry.soldOf : null,
    pairRaw: entry.pairRaw,
    tokensRaw: entry.tokensRaw,
    pair: launch.pair,
    tokenDecimals: launch.tokenDecimals,
  }));
}

/**
 * A creator's lock opening: its cliff — the first tokens free to claim — and its end, each an event from the moment
 * the escrow on the chain names until {@link UNLOCK_SPAN_MS} after it. A time not come yet is no event.
 */
export function unlockEventsOf(lock: Readonly<{ escrow: string; cliffAt: string | null; endsAt: string | null }> | null, launch: LaunchContext): MarketEvent[] {
  if (!lock) return [];
  const risk = riskOf(launch.row, launch.now, 0);
  const out: MarketEvent[] = [];
  for (const [unlock, at] of [
    ["cliff", lock.cliffAt],
    ["end", lock.endsAt],
  ] as const) {
    const stamp = stampOf(at);
    if (stamp === null || stamp > launch.now || launch.now - stamp > UNLOCK_SPAN_MS) continue;
    /* A lock with no cliff of its own opens at its end: one event, not two. */
    if (unlock === "end" && lock.cliffAt === lock.endsAt) continue;
    out.push({
      ...BLANK,
      ...risk,
      id: `launch:${lock.escrow}:UNLOCK:${unlock}`,
      kind: "UNLOCK",
      network: launch.network,
      token: tokenOf(launch.row),
      happenedAt: at,
      observedAt: launch.observedAt,
      sources: ["launch", "chain"],
      finality: "scheduled",
      account: lock.escrow,
      actor: "creator",
      unlock,
      tokenDecimals: launch.tokenDecimals,
    });
  }
  return out;
}

/** An early access on Meteora opened on Ryntra: its Alpha Vault on the chain, by the vault's own transaction. */
export function vaultEventOf(vault: Readonly<{ vault: string; signature: string; at: string | null }>, launch: LaunchContext): MarketEvent {
  return {
    ...BLANK,
    ...riskOf(launch.row, launch.now, 0),
    id: `${vault.signature}:${EVENT_INDEX.VAULT}`,
    kind: "ALPHA_VAULT",
    network: launch.network,
    token: tokenOf(launch.row),
    happenedAt: vault.at,
    observedAt: launch.observedAt,
    sources: ["launch", "chain"],
    finality: "confirmed",
    signature: vault.signature,
    account: vault.vault,
    actor: "creator",
  };
}

/* ------------------------------------------------------------ one fact, one record */

/** A token is born once and leaves its curve once: two sources of either are one fact, whatever names it. */
const ONCE: ReadonlySet<EventKind> = new Set(["TOKEN_CREATED", "DEX_LISTED"]);

export function mergeKeyOf(event: Pick<MarketEvent, "id" | "kind" | "network" | "token">): string {
  return ONCE.has(event.kind) ? `${event.network}:${event.token.mint}:${event.kind}` : event.id;
}

const FINALITY_RANK: Readonly<Record<EventFinality, number>> = { confirmed: 2, scheduled: 1, reported: 0 };

/**
 * One record per fact. The same record told again — a webhook delivered twice, a read repeated — is kept once; one fact
 * from two sources (Jupiter's graduation and the flight log's) is one record: the transaction's own when either has
 * it, its time from the chain, every source named, seen when it was first seen. Idempotent: merging a merged feed with
 * any of its own records changes nothing.
 */
export function mergeEvents(events: readonly MarketEvent[]): MarketEvent[] {
  const byKey = new Map<string, MarketEvent>();
  for (const event of events) {
    const key = mergeKeyOf(event);
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, event);
      continue;
    }
    const [lead, other] = FINALITY_RANK[event.finality] > FINALITY_RANK[seen.finality] ? [event, seen] : [seen, event];
    const sources = EVENT_SOURCES.filter((source) => lead.sources.includes(source) || other.sources.includes(source));
    const firstSeen = (stampOf(other.observedAt) ?? Infinity) < (stampOf(lead.observedAt) ?? Infinity) ? other.observedAt : lead.observedAt;
    byKey.set(key, {
      ...lead,
      sources,
      observedAt: firstSeen,
      happenedAt: lead.happenedAt ?? other.happenedAt,
      account: lead.account ?? other.account,
      route: lead.route && other.route ? { from: lead.route.from ?? other.route.from, to: lead.route.to ?? other.route.to } : (lead.route ?? other.route),
      stale: lead.stale && other.stale,
      flags: lead.flags.length >= other.flags.length ? lead.flags : other.flags,
      unstated: lead.unstated.length <= other.unstated.length ? lead.unstated : other.unstated,
      borrowedLabel: lead.borrowedLabel ?? other.borrowedLabel,
      suspicious: SUSPICION_REASONS.filter((reason) => lead.suspicious.includes(reason) || other.suspicious.includes(reason)),
    });
  }
  return [...byKey.values()];
}

/**
 * The moment an event is ordered by: when it happened. A fact stated over a window stands at the window's start — «within
 * the hour» among the events an hour old, never above the minute's; a fact no source dates (a right still on) is a
 * state, not a moment, and goes after every dated event.
 */
export function momentOf(event: Pick<MarketEvent, "happenedAt" | "happenedWithin" | "observedAt">): number {
  const at = stampOf(event.happenedAt);
  if (at !== null) return at;
  const seen = stampOf(event.observedAt) ?? 0;
  if (event.happenedWithin === "h1") return seen - 3_600_000;
  if (event.happenedWithin === "h24") return seen - 86_400_000;
  return 0;
}

/**
 * The feed's order, by the data alone: the newest first — no paid place, no referral's weight, no «recommended». A
 * suspicious token's event is shown with its reason but never above the first {@link SUSPICIOUS_FLOOR} clean events
 * (all of them, when there are fewer): it goes down to the first place after them its time allows. Ordered again after
 * every filter — the route's kinds and mint, the page's group and search — so a filter never lifts it to the top.
 */
export function orderEvents<T extends Pick<MarketEvent, "id" | "happenedAt" | "happenedWithin" | "observedAt" | "suspicious">>(events: readonly T[]): T[] {
  const byTime = [...events].sort((a, b) => momentOf(b) - momentOf(a) || a.id.localeCompare(b.id));
  const clear = byTime.filter((event) => event.suspicious.length === 0);
  const held = byTime.filter((event) => event.suspicious.length > 0);
  const out: T[] = clear.slice(0, SUSPICIOUS_FLOOR);
  let a = SUSPICIOUS_FLOOR;
  let b = 0;
  while (a < clear.length || b < held.length) {
    const next = clear[a];
    const waiting = held[b];
    if (waiting && (!next || momentOf(waiting) > momentOf(next) || (momentOf(waiting) === momentOf(next) && waiting.id.localeCompare(next.id) < 0))) {
      out.push(waiting);
      b += 1;
    } else if (next) {
      out.push(next);
      a += 1;
    }
  }
  return out;
}

/** The filter's groups on the page: by what a person looks for, each a set of kinds. */
export const EVENT_GROUPS = {
  all: EVENT_KINDS,
  new: ["TOKEN_CREATED"],
  dex: ["DEX_LISTED", "ALPHA_VAULT"],
  liquidity: ["LIQUIDITY_CHANGED", "CONCENTRATION_CHANGED"],
  rights: ["AUTHORITY_OPEN"],
  launch: ["LAUNCH_LOG", "CREATOR_SOLD", "UNLOCK", "QUOTE_CHANGED"],
} as const satisfies Readonly<Record<string, readonly EventKind[]>>;
export type EventGroup = keyof typeof EVENT_GROUPS;
export const EVENT_GROUP_IDS = Object.keys(EVENT_GROUPS) as readonly EventGroup[];

export function isEventGroup(value: unknown): value is EventGroup {
  return typeof value === "string" && Object.hasOwn(EVENT_GROUPS, value);
}

/**
 * The kinds an address asks for — `kinds=DEX_LISTED,UNLOCK` — each once, in the feed's own order; nothing asked is every
 * kind, and an ask that names no known kind is null (the route refuses it, never answers every kind in its place).
 */
export function eventKindsOf(value: string | null): EventKind[] | null {
  if (value === null || value.trim() === "") return [...EVENT_KINDS];
  const asked = new Set(value.split(",").map((part) => part.trim()));
  const kinds = EVENT_KINDS.filter((kind) => asked.has(kind));
  return kinds.length > 0 ? kinds : null;
}

/**
 * When Ryntra first saw each fact, kept in a server's memory: a later read never makes an old event look new, and «seen»
 * is never before «happened». A fact still on the feed stays known — its last sighting is refreshed and it moves to the
 * back of the line; facts unseen for `ms` are forgotten, and past `kept` the longest unseen go first.
 */
export function createSightings({ kept = 8_000, ms = 48 * 60 * 60 * 1000 }: Readonly<{ kept?: number; ms?: number }> = {}) {
  const seen = new Map<string, { first: number; last: number }>();
  return {
    apply(events: readonly MarketEvent[], now: number): MarketEvent[] {
      for (const [key, entry] of seen) {
        if (now - entry.last <= ms) break;
        seen.delete(key);
      }
      return events.map((event) => {
        const key = mergeKeyOf(event);
        const happened = stampOf(event.happenedAt);
        let read = stampOf(event.observedAt) ?? now;
        /* A held copy's read time can precede the fact it carries: seen is never before happened. */
        if (happened !== null && happened <= now && read < happened) read = happened;
        const known = seen.get(key);
        const first = known ? Math.min(known.first, read) : read;
        if (known) seen.delete(key);
        else if (seen.size >= kept) seen.delete(seen.keys().next().value as string);
        seen.set(key, { first, last: now });
        return first === stampOf(event.observedAt) ? event : { ...event, observedAt: new Date(first).toISOString() };
      });
    },
    size: () => seen.size,
    clear: () => seen.clear(),
  };
}

/** How old a read is at `now`, in whole seconds — the page says «seen 40 s ago», never a guess. */
export function ageSeconds(observedAt: string, now: number): number | null {
  const at = stampOf(observedAt);
  return at === null ? null : Math.max(0, Math.round((now - at) / 1000));
}

/** The explorer's page of an event: its transaction, or the account where it has none — on the event's own network. */
export function explorerUrlOf(event: Pick<MarketEvent, "network" | "signature" | "account" | "token">): string {
  if (event.signature) return explorerTxUrl(event.network, event.signature);
  return explorerAddressUrl(event.network, event.account ?? event.token.mint);
}

/** A name cut to its first `max` characters, never through the middle of one (an emoji is two UTF-16 units). */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const char of text) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out;
}

/** An event as `/api/v1/events` answers it: every field, the explorer's link beside it, the lists as plain arrays. */
export function eventViewOf(event: MarketEvent) {
  return {
    ...event,
    token: { ...event.token, symbol: clip(event.token.symbol, 32), name: clip(event.token.name, 80) },
    sources: [...event.sources],
    flags: [...event.flags],
    unstated: [...event.unstated],
    suspicious: [...event.suspicious],
    route: event.route ? { ...event.route } : null,
    pair: event.pair ? { ...event.pair } : null,
    explorerUrl: explorerUrlOf(event),
  };
}

/** The coverage of every kind, in the feed's order, as the answer states it. */
export function coverageOf() {
  return EVENT_KINDS.map((kind) => ({ kind, state: EVENT_COVERAGE[kind].state, sources: [...EVENT_COVERAGE[kind].sources] }));
}
