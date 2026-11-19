/**
 * The portfolio of one wallet across Solana: every source read at once, priced once, summed once.
 *
 * The readers are handed in (`service.server.ts` hands the real ones), which is what lets the tests prove every branch on
 * recorded answers with no network. What this file decides:
 *
 * - **Time.** Every source is asked at once, each with its own budget; one that does not answer in it is a source that
 *   did not answer, and the answer leaves without it.
 * - **A source that falls never fails the answer.** Its last good read for this wallet, while it is younger than
 *   {@link GRACE_MS}, is shown as `stale` with its own time; with none, one row says it was not read. A source the
 *   deployment does not serve (`NO_KEY`, `CLOSED`) is `off`, and draws nothing.
 * - **Memory.** A whole answer is kept {@link ANSWER_TTL_MS} for the same wallet, and one wallet's read in flight is
 *   shared; «Ще раз» (`refresh`) asks again, but not more often than {@link REFRESH_FLOOR_MS}.
 * - **Prices.** One read for every mint not already priced, SOL among them; a row whose principal has no price has no
 *   value, never a guessed one.
 * - **The projection** (Jupiter Portfolio) adds only what no reader of the engine shows: its rows of a platform the
 *   engine read, or naming an account the engine shows, are dropped; what stays is summed apart.
 *
 * No `server-only` here and no environment: pure but for the clock and the memory.
 */

import {
  NATIVE_SOL_MINT,
  PORTFOLIO_SOURCES,
  earnedOfTokens,
  solOf,
  unitsOf,
  unreadRow,
  usdRound,
  worthOfTokens,
  type PortfolioAnswer,
  type PortfolioKind,
  type PortfolioPosition,
  type PortfolioProtocol,
  type PortfolioSource,
  type PortfolioSourceStatus,
  type PortfolioToken,
  type SourceReason,
} from "./model.ts";
import { OWN_PLATFORMS } from "./projection.ts";

export type SourceRead =
  | Readonly<{ ok: true; positions: readonly PortfolioPosition[]; readAt: string; solUsd?: number | null }>
  | Readonly<{ ok: false; reason: SourceReason }>;

export type PortfolioReader = (owner: string, signal: AbortSignal) => Promise<SourceRead>;

export type PriceRead = ReadonlyMap<string, Readonly<{ usd: number | null; symbol: string | null }>>;
export type PriceReader = (mints: readonly string[], signal: AbortSignal) => Promise<PriceRead>;

export type PortfolioDeps = Readonly<{
  /** A source absent here is off on this deployment: `CLOSED`. */
  readers: Readonly<Partial<Record<PortfolioSource, PortfolioReader>>>;
  prices: PriceReader;
  now?: () => number;
  /** One source's budget, ms. */
  sourceMs?: number;
  /** The prices' budget, ms. */
  priceMs?: number;
}>;

/** A whole answer is kept this long for the same wallet. */
export const ANSWER_TTL_MS = 20_000;
/** «Ще раз» reads again, but not sooner than this after the last read. */
export const REFRESH_FLOOR_MS = 5_000;
/** A source's last good read stands in for it, marked `stale`, while it is younger than this. */
export const GRACE_MS = 10 * 60_000;
export const SOURCE_MS = 9_000;
export const PRICE_MS = 3_000;
const MEMORY_CAP = 2_000;
/** The most rows one answer carries, biggest first; the totals count every row. */
export const MAX_ROWS = 500;
const MAX_TOKENS = 24;

/** What a source's rows are drawn under when it has nothing to show. */
const SOURCE_ROW: Readonly<Record<PortfolioSource, Readonly<{ protocol: PortfolioProtocol; kind: PortfolioKind }>>> = {
  wallet: { protocol: "wallet", kind: "coin" },
  "native-stake": { protocol: "native-stake", kind: "stake" },
  "meteora-dlmm": { protocol: "meteora-dlmm", kind: "pool" },
  "meteora-damm-v2": { protocol: "meteora-damm-v2", kind: "pool" },
  "meteora-dlmm-pro": { protocol: "meteora-dlmm-pro", kind: "pool" },
  "jupiter-lend": { protocol: "jupiter-lend", kind: "deposit" },
  kamino: { protocol: "kamino", kind: "deposit" },
  "jupiter-portfolio": { protocol: "other", kind: "other" },
};

/** A deployment's choice, not a failure: nothing is drawn for it. */
const OFF_REASONS: ReadonlySet<SourceReason> = new Set(["NO_KEY", "CLOSED"]);

type Kept = Readonly<{ at: number; read: Extract<SourceRead, { ok: true }> }>;
const lastGood = new Map<string, Kept>();
const answers = new Map<string, Readonly<{ at: number; answer: PortfolioAnswer }>>();
const inflight = new Map<string, Promise<PortfolioAnswer>>();

/**
 * After the wallet acted: its kept answer no longer holds, and the next read asks every source. A
 * read already in flight began before the action: it is answered, but not shared with the next ask.
 */
export function forgetPortfolio(owner: string): void {
  answers.delete(owner);
  inflight.delete(owner);
}

export function resetPortfolioMemory(): void {
  lastGood.clear();
  answers.clear();
  inflight.clear();
}

function keep<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  if (map.size >= MEMORY_CAP) map.delete(map.keys().next().value as K);
  map.set(key, value);
}

/** The reader's own promise against its budget: an answer, its refusal, or `TIMEOUT`. Never throws. */
async function readOne(reader: PortfolioReader, owner: string, ms: number): Promise<SourceRead> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<SourceRead>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: "TIMEOUT" });
    }, ms);
  });
  try {
    return await Promise.race([reader(owner, controller.signal).catch((): SourceRead => ({ ok: false, reason: "REFUSED" })), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A name as the contract carries it: trimmed, bounded, never empty. */
const bounded = (value: string | null | undefined, max: number): string | null => {
  const clean = value?.trim();
  return clean ? clean.slice(0, max) : null;
};

function priced(token: PortfolioToken, prices: PriceRead): PortfolioToken {
  const known = prices.get(token.mint);
  const symbol = bounded(token.symbol ?? known?.symbol, 32);
  if (token.usd !== null || token.amountRaw === null || token.decimals === null || !known || known.usd === null) return symbol === token.symbol ? token : { ...token, symbol };
  return { ...token, symbol, usd: unitsOf(token.amountRaw, token.decimals) * known.usd };
}

/**
 * A row's name from its coins: what it holds, supplies or borrows — never a fee or a reward, which is the same coin
 * again («SOL–SOL» for a pool whose other coin has no symbol). A coin without a symbol leaves the name unsaid: the
 * screen names it from the market, never by a guess here.
 */
function labelOf(tokens: readonly PortfolioToken[]): string | null {
  const principal = tokens.filter((t) => t.role === "held" || t.role === "supplied" || t.role === "borrowed").slice(0, 2);
  if (!principal.length || principal.some((t) => !t.symbol)) return null;
  return principal.map((t) => t.symbol).join("–");
}

/** A row with its coins priced, its value and its earnings counted in dollars and in SOL. */
export function valued(position: PortfolioPosition, prices: PriceRead, solUsd: number | null): PortfolioPosition {
  if (position.state === "unread") return position;
  const tokens = position.tokens.slice(0, MAX_TOKENS).map((token) => priced(token, prices));
  const fromSol = (sol: number | null) => (sol === null || solUsd === null ? null : sol * solUsd);
  const usd = position.value.usd ?? fromSol(position.value.sol) ?? worthOfTokens(tokens);
  const earnedUsd = position.earned ? (position.earned.usd ?? fromSol(position.earned.sol)) : earnedOfTokens(tokens);
  const earnedSol = position.earned?.sol ?? solOf(earnedUsd, solUsd);
  return {
    ...position,
    platform: bounded(position.platform, 64),
    label: bounded(position.label ?? labelOf(tokens), 80),
    tokens: tokens.map((t) => (t.usd === null ? t : { ...t, usd: usdRound(t.usd) })),
    value: { usd: usdRound(usd), sol: position.value.sol ?? solOf(usd, solUsd) },
    earned: earnedUsd === null && earnedSol === null ? null : { usd: usdRound(earnedUsd), sol: earnedSol },
  };
}

/** Of the projection's rows, those no reader of the engine shows. */
export function projectionLeft(projected: readonly PortfolioPosition[], own: readonly PortfolioPosition[], answered: ReadonlySet<PortfolioSource>): PortfolioPosition[] {
  const shown = new Set<string>();
  for (const position of own) for (const ref of [position.refs.position, position.refs.pool, position.refs.nftMint, position.refs.account]) if (ref) shown.add(ref);
  return projected.filter((position) => {
    const sources = OWN_PLATFORMS[(position.platform ?? "").toLowerCase()];
    if (sources && sources.every((source) => answered.has(source))) return false;
    return !(position.refs.position && shown.has(position.refs.position));
  });
}

const ORDER: Readonly<Record<string, number>> = { read: 0, stale: 0, unread: 1 };

/** Biggest first; a borrow by its size; rows that were not read last. */
function byWorth(a: PortfolioPosition, b: PortfolioPosition): number {
  return ORDER[a.state]! - ORDER[b.state]! || Math.abs(b.value.usd ?? -1) - Math.abs(a.value.usd ?? -1) || a.id.localeCompare(b.id);
}

async function readAll(owner: string, deps: PortfolioDeps): Promise<PortfolioAnswer> {
  const now = deps.now ?? Date.now;
  const started = now();
  const sourceMs = deps.sourceMs ?? SOURCE_MS;
  const reads = await Promise.all(
    PORTFOLIO_SOURCES.map(async (source): Promise<readonly [PortfolioSource, SourceRead | null]> => {
      const reader = deps.readers[source];
      return [source, reader ? await readOne(reader, owner, sourceMs) : null];
    }),
  );

  const statuses: PortfolioSourceStatus[] = [];
  const own: PortfolioPosition[] = [];
  let projected: PortfolioPosition[] = [];
  const answered = new Set<PortfolioSource>();
  let statedSolUsd: number | null = null;
  for (const [source, read] of reads) {
    const key = `${owner}:${source}`;
    let shown: Extract<SourceRead, { ok: true }> | null = null;
    let status: PortfolioSourceStatus;
    if (read === null) {
      status = { source, state: "off", reason: "CLOSED", readAt: null, positions: 0 };
    } else if (read.ok) {
      keep(lastGood, key, { at: now(), read });
      shown = read;
      status = { source, state: "read", reason: null, readAt: read.readAt, positions: read.positions.length };
    } else if (OFF_REASONS.has(read.reason)) {
      status = { source, state: "off", reason: read.reason, readAt: null, positions: 0 };
    } else {
      const kept = lastGood.get(key);
      if (kept && now() - kept.at < GRACE_MS) {
        shown = { ...kept.read, positions: kept.read.positions.map((p) => ({ ...p, state: "stale" as const })) };
        status = { source, state: "stale", reason: read.reason, readAt: kept.read.readAt, positions: kept.read.positions.length };
      } else {
        const { protocol, kind } = SOURCE_ROW[source];
        if (source === "jupiter-portfolio") {
          status = { source, state: "unread", reason: read.reason, readAt: null, positions: 0 };
        } else {
          own.push(unreadRow(protocol, kind, source));
          status = { source, state: "unread", reason: read.reason, readAt: null, positions: 0 };
        }
      }
    }
    statuses.push(status);
    if (!shown) continue;
    answered.add(source);
    if (source === "wallet" && typeof shown.solUsd === "number" && shown.solUsd > 0) statedSolUsd = shown.solUsd;
    if (source === "jupiter-portfolio") projected = [...shown.positions];
    else own.push(...shown.positions);
  }
  const left = projectionLeft(projected, own, answered);

  /* One price read: every mint not priced yet, SOL first. */
  const rows = [...own, ...left];
  const mints = new Set<string>([NATIVE_SOL_MINT]);
  for (const row of rows) for (const token of row.tokens) if (token.usd === null || token.symbol === null) mints.add(token.mint);
  let prices: PriceRead = new Map();
  try {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    prices = await Promise.race([
      deps.prices([...mints], controller.signal),
      new Promise<PriceRead>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(new Map());
        }, deps.priceMs ?? PRICE_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  } catch {
    prices = new Map();
  }
  const read = prices.get(NATIVE_SOL_MINT)?.usd ?? null;
  const solUsd = read !== null && read > 0 ? read : statedSolUsd;

  const positions = rows.map((row) => valued(row, prices, solUsd)).sort(byWorth);
  let usd = 0;
  let earnedUsd = 0;
  let projectedUsd = 0;
  /* The projection is summed apart: its silence leaves the total as complete as the engine's own reads make it. */
  let complete = statuses.every((status) => status.source === "jupiter-portfolio" || status.state === "read" || status.state === "off");
  for (const position of positions) {
    if (position.state === "unread") continue;
    if (position.origin === "projection") {
      projectedUsd += position.value.usd ?? 0;
      continue;
    }
    if (position.state === "stale") complete = false;
    if (position.value.usd === null) complete = false;
    else usd += position.value.usd;
    earnedUsd += position.earned?.usd ?? 0;
  }
  return {
    owner,
    at: new Date(started).toISOString(),
    solUsd,
    totals: { usd: usdRound(usd) ?? 0, sol: solOf(usd, solUsd), earnedUsd: usdRound(earnedUsd) ?? 0, projectedUsd: usdRound(projectedUsd) ?? 0, complete },
    /* The rows that say a source was not read always stay: they are the answer's honesty, not its dust. */
    positions: [...positions.filter((p) => p.state !== "unread").slice(0, MAX_ROWS - positions.filter((p) => p.state === "unread").length), ...positions.filter((p) => p.state === "unread")],
    sources: statuses,
  };
}

/**
 * The wallet's portfolio. A whole answer younger than {@link ANSWER_TTL_MS} is served as it is; `refresh` reads again
 * once it is older than {@link REFRESH_FLOOR_MS}. Never throws: every source's failure is in the answer.
 */
export function readPortfolio(owner: string, deps: PortfolioDeps, options: Readonly<{ refresh?: boolean }> = {}): Promise<PortfolioAnswer> {
  const now = (deps.now ?? Date.now)();
  const hit = answers.get(owner);
  if (hit) {
    const age = now - hit.at;
    if (age < (options.refresh ? REFRESH_FLOOR_MS : ANSWER_TTL_MS)) return Promise.resolve(hit.answer);
  }
  const pending = inflight.get(owner);
  if (pending) return pending;
  const promise = readAll(owner, deps)
    .then((answer) => {
      keep(answers, owner, { at: (deps.now ?? Date.now)(), answer });
      return answer;
    })
    .finally(() => {
      if (inflight.get(owner) === promise) inflight.delete(owner);
    });
  inflight.set(owner, promise);
  return promise;
}

/**
 * A process's share of a paid provider's budget: at most `perMinute` calls in any sixty seconds. Asking past it is
 * refused at once — the portfolio then shows the source's last good read, or says it was not read.
 */
export function minuteBudget(perMinute: number, now: () => number = Date.now): () => boolean {
  const calls: number[] = [];
  return () => {
    const at = now();
    while (calls.length > 0 && at - calls[0]! >= 60_000) calls.shift();
    if (calls.length >= perMinute) return false;
    calls.push(at);
    return true;
  };
}
