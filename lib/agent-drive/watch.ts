import type { GuardStore } from "../guard/store.ts";
import { readBook, type BookEntry, type BookStatus } from "../mandate/book.server.ts";
import { frozenOn } from "../mandate/freeze.server.ts";
import type { AgentTrade, PauseReason } from "../mandate/strategy.ts";
import { positionTrades, type AgentSale, type ExitWhy } from "../mandate/exit.ts";
import { EXIT_FAILED, PAUSE_WHYS, type DriveEvent, type PauseWhy, type SaleWhy, type StopWhy } from "./events.ts";
import { DRIVE_COLLECTION, driveSettingsOf, type DriveSettings } from "./settings.ts";
import { DRIVE_HOLD_MS, tellDrive } from "./tell.ts";

/**
 * The watch over the agent's book: once a minute it reads every mandate the agent works for — its trades, its state,
 * the person's «Stop» switch — and the sales through it, and tells each new move once:
 *
 * - **bought** — a trade the chain confirmed, by its signature, while it is fresh (`FRESH_MS`); one not yet confirmed
 *   waits for its confirmation and is told then;
 * - **sold** — a sale through the agent that came back with SOL in her wallet: what the coins sold cost her (their share
 *   of what the agent spent, rounded up, so the «×» never reads better) and what came back; the agent's own
 *   sales by her rules too, from its book (`agentSoldEvents`), with why — her stop, half at 2x, the fade, the clock;
 * - **exit_failed** — a sale her rules called for did not go and the agent tries again (`exitFailedEvents`);
 * - **paused** — the agent paused itself, and why; **stopped** — her «Stop», her budget taken back, its term over, its
 *   budget spent.
 *
 * A state is told by its change: each mandate keeps a cursor of what was last seen (`k:<cluster>:<policy>` beside the
 * drive's settings), moved with compare-and-set, so two passes never tell one change twice; a mandate seen for the first
 * time is only noted. A trade or a sale is told by its signature's identity, whoever sees it first.
 *
 * Reads the book and writes notes, cursors and cards. Signs, sends and trades nothing.
 */

/** A trade or a sale older than this when first seen is history, not news. */
export const FRESH_MS = 30 * 60_000;
/** The pass starts nothing new after this: the minute's cron has the deliveries to make too. */
export const WATCH_BUDGET_MS = 40_000;

export type DriveCursor = Readonly<{
  version: number;
  kind: "cursor";
  cluster: "devnet" | "mainnet";
  policy: string;
  owner: string;
  status: BookStatus;
  pausedBy: PauseReason | null;
  frozen: boolean;
  seenAt: number;
}>;

/** The part of a sale the watch reads (`lib/mandate/sale.server.ts` `SaleRow`). */
export type SaleSeen = Readonly<{
  parent: string;
  record: Readonly<{ policy: string; owner: string }>;
  coin: string;
  amountRaw: string;
  status: string;
  trade: AgentTrade | null;
  /** The seller's reason, when it says one (the agent's own exit). */
  why?: SaleWhy;
}>;

export type WatchDeps = Readonly<{
  store: GuardStore;
  cluster: "devnet" | "mainnet";
  clock: () => number;
  /** The coins' tickers by mint; a mint missing — not read. */
  symbols: (mints: readonly string[]) => Promise<Readonly<Record<string, string | null>>>;
  /** The sales through the agent on the network. */
  sales: () => Promise<readonly SaleSeen[]>;
  /** The mandates whose «Stop» is on; throws when not read. */
  frozen?: () => Promise<ReadonlySet<string>>;
  book?: () => Promise<readonly BookEntry[]>;
  /** Sends the rows this pass queued (production: the engine's delivery narrowed to them). */
  deliver?: (rows: ReadonlySet<string>, atMs: number) => Promise<void>;
  budgetMs?: number;
}>;

export type WatchPass = Readonly<{ mandates: number; told: number; quiet: number; queued: number; failed: number; ms: number }>;

export const cursorKey = (cluster: string, policy: string) => `k:${cluster}:${policy}`;
const cursors = (store: GuardStore) => store.versioned<DriveCursor>(DRIVE_COLLECTION);

const DIGITS = /^\d{1,30}$/u;
const done = (trade: AgentTrade) => trade.status === "ok" && trade.signature !== null && trade.unsettledRaw === undefined;

/** What the agent spent and bought for a mandate over its done trades, and when it first bought. */
function costOf(trades: readonly AgentTrade[]): Readonly<{ spent: bigint; bought: bigint; first: number | null }> {
  let spent = 0n;
  let bought = 0n;
  let first: number | null = null;
  for (const trade of trades) {
    if (trade.status !== "ok" || !DIGITS.test(trade.receivedRaw ?? "")) continue;
    spent += BigInt(trade.spentRaw);
    bought += BigInt(trade.receivedRaw!);
    first = first === null ? trade.at : Math.min(first, trade.at);
  }
  return { spent, bought, first };
}

/** The new trades of a mandate worth telling: confirmed, fresh. */
export function boughtEvents(entry: BookEntry, now: number): readonly DriveEvent[] {
  return entry.trades
    .filter((trade) => done(trade) && trade.at >= now - FRESH_MS)
    .map((trade) => ({
      kind: "bought" as const,
      owner: entry.record.owner,
      cluster: entry.cluster,
      policy: entry.record.policy,
      coin: { mint: entry.receiveMint, symbol: null },
      at: trade.at,
      signature: trade.signature!,
      spentRaw: trade.spentRaw,
      receivedRaw: DIGITS.test(trade.receivedRaw ?? "") ? trade.receivedRaw : null,
    }));
}

/**
 * A sale that came back with SOL, as a closed trade: the coins sold cost her their share of what the agent spent on them
 * (rounded up); what came back is the SOL that reached her wallet. Null — not sold, not fresh, or not priced.
 */
export function soldEvent(sale: SaleSeen, parent: BookEntry | null, now: number): DriveEvent | null {
  const trade = sale.trade;
  if (sale.status !== "sold" || !trade || !done(trade) || !DIGITS.test(trade.receivedRaw ?? "") || trade.at < now - FRESH_MS) return null;
  if (!parent || parent.record.owner !== sale.record.owner) return null;
  const cost = costOf(parent.trades);
  if (cost.bought <= 0n || !DIGITS.test(sale.amountRaw)) return null;
  const entryRaw = (cost.spent * BigInt(sale.amountRaw) + cost.bought - 1n) / cost.bought;
  if (entryRaw <= 0n) return null;
  return {
    kind: "sold",
    owner: sale.record.owner,
    cluster: parent.cluster,
    policy: parent.record.policy,
    coin: { mint: sale.coin, symbol: null },
    at: trade.at,
    signature: trade.signature!,
    entryRaw: entryRaw.toString(),
    exitRaw: trade.receivedRaw!,
    openedAt: cost.first,
    why: sale.why ?? null,
  };
}

/** The agent's rule a sale went by, in the drive's words: half at 2x is the «take»; a bot's own rule. */
const SALE_WHY: Readonly<Record<ExitWhy, SaleWhy>> = { stop: "stop", half: "take", fade: "fade", time: "time", grid: "grid", signal: "signal" };

/**
 * The agent's own sales by her rules, as closed trades: fresh, landed, with what reached her wallet read; what
 * the coins sold cost her is the cost the sale carried out of the position (the book's own figure), and the position's
 * first buy is when they were bought from.
 */
export function agentSoldEvents(entry: BookEntry, now: number): readonly DriveEvent[] {
  const sales: readonly AgentSale[] = entry.sales ?? [];
  return sales.flatMap((sale) => {
    if (sale.status !== "ok" || !sale.signature || !DIGITS.test(sale.gotRaw ?? "") || !DIGITS.test(sale.costRaw) || BigInt(sale.costRaw) <= 0n || sale.at < now - FRESH_MS) return [];
    const opened = positionTrades(entry.trades.filter((trade) => trade.at < sale.at), sales.filter((one) => one.at < sale.at)).find((trade) => trade.status === "ok")?.at ?? null;
    return [
      {
        kind: "sold" as const,
        owner: entry.record.owner,
        cluster: entry.cluster,
        policy: entry.record.policy,
        coin: { mint: entry.receiveMint, symbol: null },
        at: sale.at,
        signature: sale.signature,
        entryRaw: sale.costRaw,
        exitRaw: sale.gotRaw!,
        openedAt: opened,
        why: SALE_WHY[sale.why],
      },
    ];
  });
}

/** The sales her rules called for that did not go, as the agent's book keeps them: fresh, each told once. */
export function exitFailedEvents(entry: BookEntry, now: number): readonly DriveEvent[] {
  return (entry.events ?? []).flatMap((event) =>
    event.kind === "exit_failed" && event.at >= now - FRESH_MS
      ? [{ kind: EXIT_FAILED, owner: entry.record.owner, cluster: entry.cluster, policy: entry.record.policy, coin: { mint: entry.receiveMint, symbol: null }, at: event.at, why: SALE_WHY[event.why], retryAt: event.retryAt }]
      : [],
  );
}

const STOPS: Partial<Record<BookStatus, StopWhy>> = { stopped: "withdrawn", ended: "ended", spent: "spent" };
const isPauseWhy = (value: unknown): value is PauseWhy => (PAUSE_WHYS as readonly unknown[]).includes(value);

/**
 * What changed for a mandate since the cursor: her «Stop» turned on, a pause and its reason, an end. Null `frozen` —
 * the switch was not read: kept as it was. A mandate seen for the first time changes nothing.
 */
export function stateEvent(entry: BookEntry, was: DriveCursor | null, frozen: boolean | null, now: number): DriveEvent | null {
  if (!was) return null;
  const base = { owner: entry.record.owner, cluster: entry.cluster, policy: entry.record.policy, coin: { mint: entry.receiveMint, symbol: null }, at: now };
  const stop = STOPS[entry.status];
  if (stop && was.status !== entry.status) return { kind: "stopped", ...base, why: stop };
  const atWork = entry.status === "working" || entry.status === "paused";
  if (atWork && frozen === true && !was.frozen) return { kind: "stopped", ...base, why: "you" };
  if (entry.status === "paused" && (was.status !== "paused" || was.pausedBy !== (entry.pausedBy ?? null)) && isPauseWhy(entry.pausedBy)) {
    return { kind: "paused", ...base, why: entry.pausedBy };
  }
  return null;
}

const cursorOf = (entry: BookEntry, frozen: boolean, version: number, now: number): DriveCursor => ({
  version,
  kind: "cursor",
  cluster: entry.cluster,
  policy: entry.record.policy,
  owner: entry.record.owner,
  status: entry.status,
  pausedBy: entry.pausedBy ?? null,
  frozen,
  seenAt: now,
});

const changed = (was: DriveCursor, entry: BookEntry, frozen: boolean) => was.status !== entry.status || was.pausedBy !== (entry.pausedBy ?? null) || was.frozen !== frozen;

/** One pass: every mandate's new trades, its sales and its state, each told once. */
export async function runDrivePass(deps: WatchDeps): Promise<WatchPass> {
  const started = deps.clock();
  const budget = deps.budgetMs ?? WATCH_BUDGET_MS;
  const entries = await (deps.book ?? (() => readBook(deps.store, deps.cluster)))();
  const frozenSet = await (deps.frozen ?? (() => frozenOn(deps.store, deps.cluster)))().catch(() => null);
  const sales = await deps.sales().catch(() => [] as readonly SaleSeen[]);
  const seen = new Map((await cursors(deps.store).valuesWithPrefix(`k:${deps.cluster}:`)).filter((row) => row.kind === "cursor").map((row) => [row.policy, row]));
  const byPolicy = new Map(entries.map((entry) => [entry.record.policy, entry]));

  /* The moves to tell, each with the cursor step that saw it (a state's identity). */
  const moves: { event: DriveEvent; mark?: number }[] = [];
  let failed = 0;
  for (const entry of entries) {
    if (deps.clock() - started > budget) break;
    const now = deps.clock();
    moves.push(...[...boughtEvents(entry, now), ...agentSoldEvents(entry, now), ...exitFailedEvents(entry, now)].map((event) => ({ event })));
    const was = seen.get(entry.record.policy) ?? null;
    /* A switch not read keeps the cursor's word: never a «Stop» told from a read that failed. */
    const frozen = frozenSet === null ? (was?.frozen ?? false) : frozenSet.has(entry.record.policy);
    if (was && !changed(was, entry, frozen)) continue;
    const event = stateEvent(entry, was, frozenSet === null ? null : frozen, now);
    const next = cursorOf(entry, frozen, (was?.version ?? 0) + 1, now);
    const moved = await cursors(deps.store)
      .compareAndSet(cursorKey(entry.cluster, entry.record.policy), was ? was.version : null, next)
      .catch(() => false);
    if (!moved) {
      failed += 1;
      continue;
    }
    if (event) moves.push({ event, mark: next.version });
  }
  for (const sale of sales) {
    const event = soldEvent(sale, byPolicy.get(sale.parent) ?? null, deps.clock());
    if (event) moves.push({ event });
  }

  const tickers = moves.length ? await deps.symbols([...new Set(moves.map((move) => move.event.coin.mint))]).catch(() => ({}) as Record<string, string | null>) : {};
  const settings = new Map<string, DriveSettings>();
  const queued = new Set<string>();
  let told = 0;
  let quiet = 0;
  for (const { event, mark } of moves) {
    const symbol = tickers[event.coin.mint] ?? null;
    const named = { ...event, coin: { mint: event.coin.mint, symbol: symbol && /^[A-Za-z0-9]{1,10}$/u.test(symbol) ? symbol : null } } as DriveEvent;
    let own = settings.get(event.owner);
    if (!own) {
      own = await driveSettingsOf(deps.store, event.owner);
      settings.set(event.owner, own);
    }
    const result = await tellDrive(deps.store, named, { clock: deps.clock, settings: own }, mark).catch(() => null);
    if (!result) failed += 1;
    else if (result.told) {
      told += 1;
      for (const row of result.rows) queued.add(row);
    } else if (result.why !== "told-before") quiet += 1;
  }
  if (queued.size > 0 && deps.deliver) await deps.deliver(queued, deps.clock() + DRIVE_HOLD_MS).catch(() => undefined);
  return { mandates: entries.length, told, quiet, queued: queued.size, failed, ms: deps.clock() - started };
}
