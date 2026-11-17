/**
 * «Усе в Solana»: one position model for everything a wallet holds across Solana, read outside Ryntra.
 *
 * The «Портфель» screen draws it, and «Вийти з усього» acts on it: every position carries
 * what an exit needs — the program, the pool or market, the position's own account, the NFT that holds it, the
 * mints and raw amounts — and says whether one step takes it out, and if not, why not.
 *
 * Words of the model:
 *
 * - **protocol** — whose program holds it (`wallet` for the wallet's own coins);
 * - **kind** — `coin` · `lst` · `pool` · `stake` · `deposit` · `borrow` · `other`;
 * - **state** — `read` now, `stale` (the last good read of a source that did not answer, with its own time), or
 *   `unread` (a source that fell and has nothing to show: one row says so, never an empty list);
 * - **source** — `chain` (the program's accounts), `provider` (the protocol's own API, checked against the chain where
 *   the engine already does), `projection` (a third party's view — Jupiter Portfolio — never the truth of a figure);
 * - **value** — dollars and SOL at the price read now; a borrow is negative; `null` where a price did not read;
 * - **earned** — fees and rewards still to collect, where the protocol shows them; `null` where it does not;
 * - **exit** — whether one step takes the whole of it out (`oneStep`), how (`how`), what stops it (`reason`).
 *
 * Pure and client-safe: no I/O, no clock, no environment.
 */

export const PORTFOLIO_PROTOCOLS = [
  "wallet",
  "native-stake",
  "meteora-dlmm",
  "meteora-dlmm-pro",
  "meteora-damm-v2",
  "jupiter-lend",
  "kamino",
  "other",
] as const;
export type PortfolioProtocol = (typeof PORTFOLIO_PROTOCOLS)[number];

export const PORTFOLIO_KINDS = ["coin", "lst", "pool", "stake", "deposit", "borrow", "other"] as const;
export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number];

export const PORTFOLIO_STATES = ["read", "stale", "unread"] as const;
export type PortfolioState = (typeof PORTFOLIO_STATES)[number];

export const PORTFOLIO_ORIGINS = ["chain", "provider", "projection"] as const;
export type PortfolioOrigin = (typeof PORTFOLIO_ORIGINS)[number];

/** What a token is to the position: held as it is, supplied to a market, borrowed, a share of a market, a fee or a reward still to collect. */
export const TOKEN_ROLES = ["held", "supplied", "borrowed", "share", "fee", "reward"] as const;
export type TokenRole = (typeof TOKEN_ROLES)[number];

/**
 * How a position leaves, in the engine's own steps:
 *
 * - `swap` — a coin or an LST, swapped for the target coin;
 * - `pool-withdraw` — all liquidity out of a pool position, its fees and rewards collected, the position closed;
 * - `lend-withdraw` — a deposit taken back from its market;
 * - `repay` — a borrow paid back in the borrowed coin;
 * - `stake-withdraw` — an inactive stake account's lamports taken back;
 * - `stake-deactivate` — an active stake account deactivated; its lamports are free after the epoch ends;
 * - `none` — nothing the engine knows takes it out.
 */
export const EXIT_HOWS = ["swap", "pool-withdraw", "lend-withdraw", "repay", "stake-withdraw", "stake-deactivate", "none"] as const;
export type ExitHow = (typeof EXIT_HOWS)[number];

/**
 * Why one step does not take a position out, or not all of it:
 *
 * - `NOT_READ` — the protocol did not answer; nothing is known of it now;
 * - `PROJECTION` — seen only in a third party's view; the program's own accounts were not read;
 * - `NO_ROUTE` — the engine builds no exit for this protocol yet;
 * - `LOCKED` — a part, or all, is locked by the pool (`partBps` is what can leave);
 * - `LIQUIDITY` — the market can give back only a part now (`partBps`);
 * - `DEBT` — a borrow stands against this deposit: it is repaid first;
 * - `REPAY` — a borrow: it leaves only when paid back in the borrowed coin;
 * - `STAKE_ACTIVE` — the stake is delegated: deactivated first, withdrawn after the epoch ends (`untilEpoch`);
 * - `STAKE_COOLING` — deactivating: withdrawn from `untilEpoch`;
 * - `STAKE_LOCKUP` — a lockup holds it until `untilTime` or `untilEpoch`;
 * - `NOT_WITHDRAWER` — the wallet may delegate this stake but not withdraw it;
 * - `CLOSED_HERE` — the engine's surface for this protocol is closed on this deployment.
 */
export const EXIT_REASONS = [
  "NOT_READ",
  "PROJECTION",
  "NO_ROUTE",
  "LOCKED",
  "LIQUIDITY",
  "DEBT",
  "REPAY",
  "STAKE_ACTIVE",
  "STAKE_COOLING",
  "STAKE_LOCKUP",
  "NOT_WITHDRAWER",
  "CLOSED_HERE",
] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

/** The readers behind the answer, one per source of facts. */
export const PORTFOLIO_SOURCES = ["wallet", "native-stake", "meteora-dlmm", "meteora-damm-v2", "meteora-dlmm-pro", "jupiter-lend", "kamino", "jupiter-portfolio"] as const;
export type PortfolioSource = (typeof PORTFOLIO_SOURCES)[number];

export const SOURCE_STATES = ["read", "stale", "unread", "off"] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

/**
 * Why a source did not answer now: `NO_KEY` — the deployment has no key for it; `CLOSED` — the engine's surface is shut
 * here; `TIMEOUT` — it did not answer in its time; `REFUSED` — it answered no; `UNREADABLE` — its answer did not read;
 * `BUDGET` — this process spent its share of the provider's budget this minute.
 */
export const SOURCE_REASONS = ["NO_KEY", "CLOSED", "TIMEOUT", "REFUSED", "UNREADABLE", "BUDGET"] as const;
export type SourceReason = (typeof SOURCE_REASONS)[number];

export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";

export type PortfolioToken = Readonly<{
  mint: string;
  symbol: string | null;
  /** The mint's scale; null where the source stated a worth but not an amount. */
  decimals: number | null;
  /** Base units, as the chain or the protocol states them; null where the source stated a worth but not an amount. */
  amountRaw: string | null;
  /** Its worth in dollars at the price read now; null where no price read. */
  usd: number | null;
  role: TokenRole;
}>;

export type PortfolioExit = Readonly<{
  /** One step takes all of it out. */
  oneStep: boolean;
  how: ExitHow;
  /** What stops one step, or takes only a part; null — nothing does. */
  reason: ExitReason | null;
  /** The share, basis points, that one step takes out now: 10 000 — all of it. */
  partBps: number;
  /** The epoch from which it can leave, where an epoch decides it. */
  untilEpoch: number | null;
  /** The time from which it can leave, ISO, where a time decides it. */
  untilTime: string | null;
}>;

/** Everything an exit names: the program it acts on, and the accounts. Each is null where the protocol has none. */
export type PortfolioRefs = Readonly<{
  program: string | null;
  /** A pool's address. */
  pool: string | null;
  /** The position's own account: a pool position, a stake account, a lending obligation. */
  position: string | null;
  /** The NFT whose holder owns the position (DAMM v2, DLMM Pro). */
  nftMint: string | null;
  /** A lending market or a reserve: the id the protocol's withdraw takes. */
  market: string | null;
  /** The wallet's token account a coin sits in, where one does. */
  account: string | null;
}>;

export type PortfolioPosition = Readonly<{
  /** Stable for the same position across reads: `<protocol>:<the position's own address or mint>`. */
  id: string;
  protocol: PortfolioProtocol;
  /** The provider's own name for the platform — a projection's `platformId` — or null. */
  platform: string | null;
  kind: PortfolioKind;
  state: PortfolioState;
  origin: PortfolioOrigin;
  /** A short name: a coin's symbol, a pool's pair. Null where none is known. */
  label: string | null;
  /**
   * What an exit would give now, at the prices read now: a pool's liquidity with its fees and rewards to collect, a
   * deposit with its interest; a borrow is negative. Null where a price did not read.
   */
  value: Readonly<{ usd: number | null; sol: number | null }>;
  /** The part of the value that is earnings, where the protocol shows it: a pool's fees and rewards to collect, a deposit's interest. */
  earned: Readonly<{ usd: number | null; sol: number | null }> | null;
  tokens: readonly PortfolioToken[];
  /** A pool position: whether the price stands in its range, so it earns now. Null for anything else. */
  inRange: boolean | null;
  exit: PortfolioExit;
  refs: PortfolioRefs;
  /** When the facts were read, ISO; null for a row that says a source did not answer. */
  readAt: string | null;
}>;

export type PortfolioSourceStatus = Readonly<{
  source: PortfolioSource;
  state: SourceState;
  reason: SourceReason | null;
  /** When the facts shown were read: now, or the stale copy's own time. */
  readAt: string | null;
  positions: number;
}>;

export type PortfolioAnswer = Readonly<{
  owner: string;
  at: string;
  /** The price of one SOL in dollars the SOL figures are counted at; null where it did not read. */
  solUsd: number | null;
  /**
   * The sum of every row read now or kept (`stale`), in dollars and in SOL; `complete` — every source answered and every
   * row has a price. Rows of the projection are not in it: `projectedUsd` is theirs, apart.
   */
  totals: Readonly<{ usd: number; sol: number | null; earnedUsd: number; projectedUsd: number; complete: boolean }>;
  positions: readonly PortfolioPosition[];
  sources: readonly PortfolioSourceStatus[];
}>;

/* ------------------------------------------------------------------ helpers */

export const NO_REFS: PortfolioRefs = Object.freeze({ program: null, pool: null, position: null, nftMint: null, market: null, account: null });

export function refs(partial: Partial<PortfolioRefs>): PortfolioRefs {
  return { ...NO_REFS, ...partial };
}

/** One step takes all of it out. */
export function exitWhole(how: ExitHow): PortfolioExit {
  return { oneStep: true, how, reason: null, partBps: 10_000, untilEpoch: null, untilTime: null };
}

/** One step does not take all of it: why, how it would leave, and what part leaves now. */
export function exitBlocked(how: ExitHow, reason: ExitReason, extra: Partial<Pick<PortfolioExit, "partBps" | "untilEpoch" | "untilTime">> = {}): PortfolioExit {
  return { oneStep: false, how, reason, partBps: extra.partBps ?? 0, untilEpoch: extra.untilEpoch ?? null, untilTime: extra.untilTime ?? null };
}

const RAW = /^\d{1,40}$/;

/** A raw amount as it travels: decimal digits, no sign; anything else is null. */
export function rawText(value: unknown): string | null {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value === "string") {
    const clean = value.trim();
    if (!RAW.test(clean)) return null;
    return clean.replace(/^0+(?=\d)/, "");
  }
  return null;
}

/** Base units → the token's own unit, for reading and pricing (a float: enough for a figure on a screen, never for a transaction). */
export function unitsOf(raw: string, decimals: number): number {
  if (!RAW.test(raw) || !Number.isInteger(decimals) || decimals < 0) return 0;
  if (raw.length <= 15) return Number(raw) / 10 ** decimals;
  const head = Number(raw.slice(0, 15));
  return head * 10 ** (raw.length - 15 - decimals);
}

/** Dollars, rounded to the cent's hundredth; null stays null. */
export function usdRound(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10_000) / 10_000;
}

/** SOL at the given SOL price; null where either is unknown. */
export function solOf(usd: number | null, solUsd: number | null): number | null {
  if (usd === null || solUsd === null || !(solUsd > 0)) return null;
  return Math.round((usd / solUsd) * 1e9) / 1e9;
}

const PRINCIPAL: Readonly<Partial<Record<TokenRole, 1 | -1>>> = { held: 1, supplied: 1, borrowed: -1 };

/**
 * A position's worth from its tokens: what it holds or supplied, less what it borrowed, with its fees and rewards to
 * collect. A share token is the receipt of a supplied amount already counted, so it adds nothing. Null when the
 * principal has a coin without a price — a partial sum is not a worth; a fee or a reward without a price is left out.
 */
export function worthOfTokens(tokens: readonly PortfolioToken[]): number | null {
  let sum = 0;
  let counted = 0;
  for (const token of tokens) {
    const sign = PRINCIPAL[token.role];
    if (sign !== undefined) {
      if (token.usd === null) return null;
      sum += sign * token.usd;
      counted += 1;
    } else if ((token.role === "fee" || token.role === "reward") && token.usd !== null) {
      sum += token.usd;
    }
  }
  return counted === 0 ? null : sum;
}

/** What is still to collect, from the fee and reward tokens: null when there are none, or one has no price. */
export function earnedOfTokens(tokens: readonly PortfolioToken[]): number | null {
  let sum = 0;
  let counted = 0;
  for (const token of tokens) {
    if (token.role !== "fee" && token.role !== "reward") continue;
    if (token.usd === null) return null;
    sum += token.usd;
    counted += 1;
  }
  return counted === 0 ? null : sum;
}

/** The row a source that fell leaves: nothing known but that it was not read, and a kind to draw it under. */
export function unreadRow(protocol: PortfolioProtocol, kind: PortfolioKind, source: PortfolioSource): PortfolioPosition {
  return {
    id: `${protocol}:unread:${source}`,
    protocol,
    platform: null,
    kind,
    state: "unread",
    origin: "chain",
    label: null,
    value: { usd: null, sol: null },
    earned: null,
    tokens: [],
    inRange: null,
    exit: exitBlocked("none", "NOT_READ"),
    refs: NO_REFS,
    readAt: null,
  };
}
