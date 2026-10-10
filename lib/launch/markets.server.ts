/**
 * «Лаунчі на Ryntra» — every market launched on Ryntra on this network, a row
 * each, for anyone without a wallet: its state of the cycle, the curve's way
 * to the DEX, the pool's liquidity, the market's budget, depth at −5 %, days
 * since the DEX, holders and the creator.
 *
 * The markets are Ryntra's own records of its launches — a launch is Ryntra's
 * when Ryntra's pool payer created its curve on a preset's config —, each read
 * whole by `readMarket`. A list answers at once from what was read: a market
 * read in the last five minutes as it is, one read earlier with that read's own
 * time while it is read again behind the answer, and one never read is read now,
 * a few at a time inside a short budget — what the budget does not reach keeps a
 * row with the record's facts, says it was not read, and is read behind the
 * answer; a list with such rows is answered again within seconds.
 * The order is the data's alone: markets with a trade in the last day first,
 * then the furthest along the cycle, then the newest — no hand-picked top.
 */

import type { LaunchMarketRow, LaunchMarketsResponse } from "../api/v1/contract.ts";
import { CYCLE_RANK } from "../core/launch/market-health.ts";
import { budgetFiguresOf } from "./autopilot.server.ts";
import { executorClaimsPreset, exhaustedNow, marketBudget, type BudgetRead } from "./budget.server.ts";
import { launchPair } from "./config.server.ts";
import type { LaunchRecord } from "./flow.server.ts";
import { lastGoodMarket, marketRow, readMarket, type HealthDeps, type MarketRead } from "./health.server.ts";

/**
 * How long a list is served again — briefly while some of its markets are not read —, how old a market's read may be
 * before it is read again, how long one answer waits on the chain, and how many markets it reads at once.
 */
const LIST_FRESH_MS = 30_000;
const LIST_PARTIAL_MS = 5_000;
const ROW_FRESH_MS = 5 * 60 * 1000;
const LIST_BUDGET_MS = 10_000;
const AT_ONCE = 2;
/** The most markets one answer lists. */
export const MARKETS_LISTED = 500;

const LISTS = new Map<string, Readonly<{ at: number; value: Promise<LaunchMarketsResponse>; complete: boolean | null }>>();

/* The markets to read behind the answer, and the one runner reading them — one market at a time, so a public node is not flooded. */
const BEHIND = new Map<string, HealthDeps>();
let RUNNER: Promise<void> | null = null;

/** The list, served again for a while: one read of the chain answers everyone in that time. */
export function readLaunchMarkets(deps: HealthDeps): Promise<LaunchMarketsResponse> {
  const key = deps.network.cluster;
  const now = deps.now().getTime();
  const hit = LISTS.get(key);
  /* A list being made, or made a moment ago, answers everyone; one with markets not read is made again soon. */
  if (hit && (hit.complete === null || now - hit.at < (hit.complete ? LIST_FRESH_MS : LIST_PARTIAL_MS))) return hit.value;
  const value = assemble(deps).then((list) => {
    if (LISTS.get(key)?.value === value) LISTS.set(key, { at: deps.now().getTime(), value, complete: list.complete });
    return list;
  });
  LISTS.set(key, { at: now, value, complete: null });
  value.catch(() => {
    if (LISTS.get(key)?.value === value) LISTS.delete(key);
  });
  return value;
}

/**
 * The markets left to read behind the answer, read now one at a time; resolves when none is left. A route hands it to
 * `after()`, so the reads outlive the answer; the next list finds them done.
 */
export function readMarketsBehind(): Promise<void> {
  if (RUNNER) return RUNNER;
  RUNNER = (async () => {
    for (;;) {
      const next = BEHIND.entries().next();
      if (next.done) return;
      const [key, deps] = next.value;
      BEHIND.delete(key);
      await readMarket(deps, key.slice(key.indexOf(":") + 1)).catch(() => null);
    }
  })().finally(() => {
    RUNNER = null;
  });
  return RUNNER;
}

function behind(deps: HealthDeps, token: string) {
  BEHIND.set(`${deps.network.cluster}:${token}`, deps);
}

/** The row of a market whose chain was not read in time: the record's facts only — its lock as the record holds it —, every figure null. */
export function unreadRow(record: LaunchRecord, deps: HealthDeps, technicalValidation: boolean, budget: BudgetRead = { kind: "NOT_COUNTED" }): LaunchMarketRow {
  const pair = launchPair(deps.network, record.preset);
  return {
    token: record.token,
    name: record.name.slice(0, 64),
    symbol: record.symbol.slice(0, 16),
    image: null,
    preset: record.preset,
    launchedAt: record.launchedAt,
    creator: record.creator,
    technicalValidation,
    pair: { mint: record.pairMint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
    read: false,
    state: null,
    venue: null,
    progress: null,
    poolLiquidity: null,
    budget: marketBudget({ state: "NONE" }, budget),
    depth5Raw: null,
    daysSinceDex: null,
    traded24h: null,
    holders: null,
    holdersAtLeast: false,
    creatorLock: record.lock?.state === "LOCKED" ? { escrow: record.lock.escrow, cliffAt: null, endsAt: null } : null,
    creatorSold: null,
    observedAt: deps.now().toISOString(),
  };
}

/**
 * The budget of a market whose chain was not read in time: on Micro and the demo market, the executor's ledger when it
 * has claimed there (the store's alone); else what waits in the pools — not read now, never said as none.
 */
async function unreadBudget(deps: HealthDeps, record: LaunchRecord, ours: boolean): Promise<BudgetRead> {
  if (!executorClaimsPreset(record.preset)) return { kind: "NOT_COUNTED" };
  const kept = ours ? await budgetFiguresOf(deps.store, deps.network.cluster, record.token).catch(() => null) : null;
  if (kept?.record?.claims.length) return { kind: "COUNTED", figures: kept.figures, inPoolRaw: null, exhausted: exhaustedNow(kept.record, kept.figures) };
  return { kind: "IN_POOL", inPool: null };
}

/** The data's own order: a trade in the last day first, then the furthest along the cycle, then the newest launch. */
export function marketOrder(a: LaunchMarketRow, b: LaunchMarketRow): number {
  const live = (row: LaunchMarketRow) => (row.traded24h === true ? 1 : 0);
  if (live(a) !== live(b)) return live(b) - live(a);
  const rank = (row: LaunchMarketRow) => (row.state ? CYCLE_RANK[row.state.code] : -1);
  if (rank(a) !== rank(b)) return rank(b) - rank(a);
  return Date.parse(b.launchedAt) - Date.parse(a.launchedAt) || a.token.localeCompare(b.token);
}

async function assemble(deps: HealthDeps): Promise<LaunchMarketsResponse> {
  const cluster = deps.network.cluster;
  const records = (await deps.store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${cluster}:`))
    /* A record written before launches had a state is a launch the chain confirmed. */
    .filter((record) => record.state !== "PENDING" && (record.cluster ?? cluster) === cluster)
    .sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt))
    .slice(0, MARKETS_LISTED);
  const { wallets } = await deps.ryntraWallets().catch(() => ({ wallets: new Set<string>() as ReadonlySet<string>, complete: false }));
  const now = deps.now().getTime();
  const rows = new Map<string, LaunchMarketRow>();
  const toRead: LaunchRecord[] = [];
  for (const record of records) {
    const known = lastGoodMarket(cluster, record.token, now);
    if (known) {
      rows.set(record.token, marketRow(known, deps.network));
      if (now - Date.parse(known.observedAt) >= ROW_FRESH_MS) behind(deps, record.token);
    } else toRead.push(record);
  }
  /* What was never read is read now, a few at a time inside the budget; what the budget does not reach is read behind the answer. */
  const deadline = Date.now() + LIST_BUDGET_MS;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const record = toRead[next++];
      if (!record) return;
      const left = deadline - Date.now();
      if (left < 2_000) {
        behind(deps, record.token);
        continue;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = await Promise.race([
        readMarket(deps, record.token).catch(() => null),
        new Promise<"late">((done) => {
          timer = setTimeout(() => done("late"), left);
        }),
      ]);
      clearTimeout(timer);
      if (read === "late") behind(deps, record.token);
      else if (read) rows.set(record.token, marketRow(read as MarketRead, deps.network));
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, toRead.length) }, worker));
  const markets = (
    await Promise.all(records.map(async (record) => rows.get(record.token) ?? unreadRow(record, deps, wallets.has(record.creator), await unreadBudget(deps, record, wallets.has(record.creator)))))
  ).sort(marketOrder);
  return { network: deps.network.chain, markets, complete: markets.every((row) => row.read), observedAt: deps.now().toISOString() };
}
