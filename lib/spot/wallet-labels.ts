/**
 * «хто купив»: the marks a wallet carries on the coin page's trades and traders.
 *
 * Pure and client-safe. Every mark is a fact the engine already read, never a guess about a person:
 *
 * - `creator` — the wallet Jupiter names as the coin's creator (`part=overview`, `facts.dev`);
 * - `ryntra-agent` — a key of Ryntra's own agent (the registry's open `AGENT_SIGNER` row): the agent signs and pays
 *   for every trade it makes for a person, so the trade's wallet is the agent's;
 * - `top-holder` — a person among the coin's largest holders the holders read listed (`part=holders`): pools,
 *   locks, vaults and other programs' accounts are left out of the ranking, the rank is kept;
 * - `pool` / `program` — an address that is a pool of the coin or another program's account, not a person's key;
 * - `big` — a trade of at least the configured dollars (`RYNTRA_SPOT_BIG_TRADE_USD`, default $1 000 — the same bar
 *   the chart's marks use); a mark of the trade, not of the wallet;
 * - `fresh` — a wallet whose whole history is short and young: fewer than `freshMaxTransactions` signatures, the
 *   first of them within `freshMaxAgeHours` (72 hours and 40 signatures unless the deployment sets
 *   `RYNTRA_SPOT_FRESH_MAX_HOURS` / `RYNTRA_SPOT_FRESH_MAX_TX`). Known only for the wallets whose history was read;
 *   for the rest the mark is absent, and the read says how many wallets were checked (`LabelBasis.fresh`).
 *
 * There are no «smart money», «KOL», «sniper» or «insider» marks here: those are other companies' lists or need
 * reads the engine does not make yet.
 */

import type { TokenHolder, TokenTrade } from "./token-page.ts";

export const WALLET_LABELS = ["creator", "ryntra-agent", "top-holder", "pool", "program", "big", "fresh"] as const;
export type WalletLabel = (typeof WALLET_LABELS)[number];

export function isWalletLabel(value: unknown): value is WalletLabel {
  return typeof value === "string" && (WALLET_LABELS as readonly string[]).includes(value);
}

export type WalletLabelSettings = Readonly<{
  /** A trade of at least this many dollars is `big`. */
  bigTradeUsd: number;
  /** How many of the largest people count as `top-holder`. */
  topHolderRanks: number;
  /** A wallet whose first signature is at most this old is young. */
  freshMaxAgeHours: number;
  /** A wallet with at least this many signatures is not fresh, however young. */
  freshMaxTransactions: number;
}>;

export const WALLET_LABEL_DEFAULTS: WalletLabelSettings = Object.freeze({
  bigTradeUsd: 1_000,
  topHolderRanks: 20,
  freshMaxAgeHours: 72,
  /*
   * Forty since 20.11.2026 (twenty before). Measured that day on the buyers of a coin seven minutes old, each wallet's
   * whole history read (`fixtures/wallet-ages-chain.json`): under twenty signatures — none; under forty and younger
   * than 72 hours — three of 123. A wallet a few hours old that traded for those hours is past twenty.
   */
  freshMaxTransactions: 40,
});

/** The deployment's bar for a big trade, in dollars. */
export const BIG_TRADE_ENV = "RYNTRA_SPOT_BIG_TRADE_USD";
const BIG_TRADE_FLOOR = 10;
const BIG_TRADE_CEILING = 10_000_000;

/** The bar from the environment's text: a number of dollars within reason, else the default. */
export function bigTradeUsdOf(raw: string | undefined | null): number {
  const text = raw?.trim();
  if (!text) return WALLET_LABEL_DEFAULTS.bigTradeUsd;
  const value = Number(text);
  return Number.isFinite(value) && value >= BIG_TRADE_FLOOR && value <= BIG_TRADE_CEILING ? value : WALLET_LABEL_DEFAULTS.bigTradeUsd;
}

/**
 * The deployment's rule for a fresh wallet: the two bars are settings, each within its range, else the default.
 * (Measured 20.11.2026 over every buyer of a coin an hour old, each wallet's whole history read: of 93 none had under
 * a hundred signatures. The mark is rare because such wallets are — so the bars are the deployment's to set.)
 */
export const FRESH_HOURS_ENV = "RYNTRA_SPOT_FRESH_MAX_HOURS";
export const FRESH_TX_ENV = "RYNTRA_SPOT_FRESH_MAX_TX";
/** A wallet's first signature may be an hour to thirty days old. */
const FRESH_HOURS_RANGE = [1, 720] as const;
/** The signatures' bar is at most one list of the node: a thousand. */
const FRESH_TX_RANGE = [2, 1_000] as const;

function settingOf(raw: string | undefined | null, range: readonly [number, number], otherwise: number, whole: boolean): number {
  const text = raw?.trim();
  if (!text) return otherwise;
  const value = Number(text);
  if (!Number.isFinite(value) || value < range[0] || value > range[1] || (whole && !Number.isInteger(value))) return otherwise;
  return value;
}

/** The fresh rule from the environment's text. */
export function freshRuleOf(hours: string | undefined | null, transactions: string | undefined | null): Pick<WalletLabelSettings, "freshMaxAgeHours" | "freshMaxTransactions"> {
  return {
    freshMaxAgeHours: settingOf(hours, FRESH_HOURS_RANGE, WALLET_LABEL_DEFAULTS.freshMaxAgeHours, false),
    freshMaxTransactions: settingOf(transactions, FRESH_TX_RANGE, WALLET_LABEL_DEFAULTS.freshMaxTransactions, true),
  };
}

/* ------------------------------------------------------------ wallet age */

export type WalletAge = Readonly<{
  /** Whether the wallet is fresh by the settings' rule. */
  fresh: boolean;
  /** Its first signature, when the whole history was read. */
  firstAt: string | null;
  /** Signatures read; with `whole` false, at least this many. */
  transactions: number;
  /** The whole history was read (fewer signatures than the read asked for). */
  whole: boolean;
}>;

export type ListedSignatureTime = Readonly<{ blockTime?: number | null }>;

/**
 * A wallet's newest signatures, as a node lists them (newest first, at most `limit`) → its age. A list as long as
 * the read asked for is a history longer than a fresh wallet's: not fresh. A shorter list is the whole history: fresh
 * when its oldest signature is young enough. An empty list or one without times says nothing: null.
 */
export function walletAgeOf(signatures: readonly ListedSignatureTime[], limit: number, nowMs: number, settings: WalletLabelSettings = WALLET_LABEL_DEFAULTS): WalletAge | null {
  if (signatures.length === 0) return null;
  const ceiling = Math.min(limit, settings.freshMaxTransactions);
  if (signatures.length >= ceiling) return { fresh: false, firstAt: null, transactions: signatures.length, whole: false };
  const oldest = signatures[signatures.length - 1]?.blockTime;
  if (typeof oldest !== "number" || !Number.isFinite(oldest)) return null;
  const ageMs = nowMs - oldest * 1000;
  return {
    fresh: ageMs >= 0 && ageMs <= settings.freshMaxAgeHours * 3_600_000,
    firstAt: new Date(oldest * 1000).toISOString(),
    transactions: signatures.length,
    whole: true,
  };
}

/* ------------------------------------------------------------- the book */

/** What the engine knows of the wallets around one coin: every mark is read from here. */
export type WalletBook = Readonly<{
  /** The coin's creator, as Jupiter names it; null — not named or not read. */
  dev: string | null;
  /** Ryntra's agents' keys. */
  agents: ReadonlySet<string>;
  /** People among the largest holders → their rank (1 — the largest); null — the holders were not read. */
  topHolders: ReadonlyMap<string, number> | null;
  poolOwners: ReadonlySet<string>;
  programOwners: ReadonlySet<string>;
  /** Wallets whose age was read. */
  ages: ReadonlyMap<string, WalletAge>;
}>;

export const EMPTY_WALLET_BOOK: WalletBook = Object.freeze({
  dev: null,
  agents: new Set<string>(),
  topHolders: null,
  poolOwners: new Set<string>(),
  programOwners: new Set<string>(),
  ages: new Map<string, WalletAge>(),
});

/**
 * The largest holders → the people among them by rank. Pools and programs hold for no one key: they are left out
 * of the ranking, so «top holder 1» is the largest person.
 */
export function topHoldersOf(holders: readonly Pick<TokenHolder, "owner" | "labels">[], ranks: number = WALLET_LABEL_DEFAULTS.topHolderRanks): Map<string, number> {
  const out = new Map<string, number>();
  for (const holder of holders) {
    if (out.size >= ranks) break;
    if (holder.labels.includes("pool") || holder.labels.includes("program")) continue;
    if (!out.has(holder.owner)) out.set(holder.owner, out.size + 1);
  }
  return out;
}

/** Pool and program owners among the holders the holders read labelled. */
export function ownersOf(holders: readonly Pick<TokenHolder, "owner" | "labels">[]): Readonly<{ pools: Set<string>; programs: Set<string> }> {
  const pools = new Set<string>();
  const programs = new Set<string>();
  for (const holder of holders) {
    if (holder.labels.includes("pool")) pools.add(holder.owner);
    else if (holder.labels.includes("program")) programs.add(holder.owner);
  }
  return { pools, programs };
}

/** A wallet's marks, in `WALLET_LABELS` order; `usd` — the trade's, for `big`. */
export function walletLabelsOf(wallet: string, book: WalletBook, usd: number | null = null, settings: WalletLabelSettings = WALLET_LABEL_DEFAULTS): WalletLabel[] {
  const labels: WalletLabel[] = [];
  if (book.dev && wallet === book.dev) labels.push("creator");
  if (book.agents.has(wallet)) labels.push("ryntra-agent");
  if (book.topHolders?.has(wallet)) labels.push("top-holder");
  if (book.poolOwners.has(wallet)) labels.push("pool");
  else if (book.programOwners.has(wallet)) labels.push("program");
  if (usd !== null && Number.isFinite(usd) && usd >= settings.bigTradeUsd) labels.push("big");
  if (book.ages.get(wallet)?.fresh === true) labels.push("fresh");
  return labels;
}

/** The trades with their marks; a trade with none carries no `labels` field at all. */
export function labelTrades(trades: readonly TokenTrade[], book: WalletBook, settings: WalletLabelSettings = WALLET_LABEL_DEFAULTS): TokenTrade[] {
  return trades.map((trade) => {
    const labels = walletLabelsOf(trade.wallet, book, trade.usd, settings);
    if (labels.length === 0) {
      if (trade.labels === undefined) return trade;
      const { labels: _old, ...rest } = trade;
      void _old;
      return rest;
    }
    return { ...trade, labels };
  });
}

/** What the marks of one answer stand on — so «no mark» is never read as «not the creator» when nothing was read. */
export type LabelBasis = Readonly<{
  /** The creator was named. */
  creator: boolean;
  /** The largest holders were read, and how many people of them rank. */
  topHolders: number | null;
  /** Ryntra's agents were known. */
  agents: boolean;
  /** How many wallets' age was read. */
  fresh: number;
  bigTradeUsd: number;
  freshRule: Readonly<{ maxAgeHours: number; maxTransactions: number }>;
}>;

export function labelBasisOf(book: WalletBook, wallets: readonly string[], settings: WalletLabelSettings = WALLET_LABEL_DEFAULTS): LabelBasis {
  let fresh = 0;
  for (const wallet of new Set(wallets)) if (book.ages.has(wallet)) fresh += 1;
  return {
    creator: book.dev !== null,
    topHolders: book.topHolders === null ? null : book.topHolders.size,
    agents: book.agents.size > 0,
    fresh,
    bigTradeUsd: settings.bigTradeUsd,
    freshRule: { maxAgeHours: settings.freshMaxAgeHours, maxTransactions: settings.freshMaxTransactions },
  };
}

/**
 * The wallets whose age is worth a read, at most `max`: buyers first, the largest buys first, and none the book
 * already marks as the creator, an agent, a pool or a program, or whose age it already knows — so each read goes on
 * down the list, and a watched coin's every buyer is reached. (Measured 20.11.2026: the fresh wallets of a busy coin
 * were small buyers scattered through it — 64th, 73rd and 83rd of 123 by size; taken by the latest buy instead they
 * came no sooner.)
 */
export function freshCandidates(trades: readonly TokenTrade[], book: WalletBook, max: number): string[] {
  const order = [...trades].sort((a, b) => (a.side === b.side ? (b.usd ?? -1) - (a.usd ?? -1) : a.side === "buy" ? -1 : 1));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const trade of order) {
    if (out.length >= max) break;
    const wallet = trade.wallet;
    if (seen.has(wallet)) continue;
    seen.add(wallet);
    if (wallet === book.dev || book.agents.has(wallet) || book.poolOwners.has(wallet) || book.programOwners.has(wallet) || book.ages.has(wallet)) continue;
    out.push(wallet);
  }
  return out;
}
