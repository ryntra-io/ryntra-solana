/**
 * The public survival of markets launched on Ryntra at 7, 30 and 90 days (SOL-L3, audit SOL-L0 finding З19), read
 * from the chain by the definition of `../core/launch/survival-stats.ts`.
 *
 * Every launch the chain confirmed on this network is counted. A market whose outcome at a horizon is decided — it
 * lived, proven by a trade's transaction, or its week was read whole and went quiet — keeps it in the store for ever: a
 * week of the chain that is over never changes. A week still open is read on its own — the curve's and the pool's
 * signatures paged back to it, stopped at the first trade that proves demand —, a few at a time inside a short budget,
 * each answer starting where the last one stopped; a week the budget does not reach is said as not read, and read on a
 * later ask. Ryntra's own launches are counted apart. One answer serves everyone for a while.
 *
 * Server-only: the Guard store and the chain, through the market reader every Launch read uses.
 */

import type { LaunchSurvivalResponse } from "../api/v1/contract.ts";
import {
  SURVIVAL_HORIZONS_DAYS,
  SURVIVAL_WINDOW_DAYS,
  survivalDecided,
  survivalProves,
  survivalStats,
  survivalWindow,
  windowOutcome,
  type SurvivalHorizon,
  type SurvivalOutcome,
} from "../core/launch/survival-stats.ts";
import type { LaunchRecord } from "./flow.server.ts";
import type { HealthDeps } from "./health.server.ts";
import type { LaunchMarketReader } from "../core/venues/meteora-dbc/market.server.ts";
import { launchMarketReader } from "./trade-index.server.ts";

/** How long one answer is served, how long one being made is waited for, how long it may read the chain, and how many markets at once. */
const ANSWER_FRESH_MS = 10 * 60 * 1000;
const ANSWER_PARTIAL_MS = 60 * 1000;
const ANSWER_STUCK_MS = 45_000;
const READ_BUDGET_MS = 20_000;
const AT_ONCE = 2;
/** The most markets one answer lists by name — every market is counted in the tallies. */
export const SURVIVAL_LISTED = 500;

type Decided = Readonly<{ cluster: string; token: string; days: SurvivalHorizon; outcome: SurvivalOutcome; decidedAt: string }>;

const ANSWERS = new Map<string, Readonly<{ at: number; complete: boolean | null; value: Promise<LaunchSurvivalResponse> }>>();
/* Where the next answer starts reading the markets still open: each answer starts further on, so none waits for ever behind others. */
const ROTATION = new Map<string, number>();

/** The survival of this network's markets, served again for a while; one being made is joined, one stuck past its time is made again. */
export function readLaunchSurvival(deps: HealthDeps): Promise<LaunchSurvivalResponse> {
  const key = deps.network.cluster;
  const now = deps.now().getTime();
  const hit = ANSWERS.get(key);
  if (hit && (hit.complete === null ? now - hit.at < ANSWER_STUCK_MS : now - hit.at < (hit.complete ? ANSWER_FRESH_MS : ANSWER_PARTIAL_MS))) return hit.value;
  const value = assembleLaunchSurvival(deps).then((answer) => {
    if (ANSWERS.get(key)?.value === value) ANSWERS.set(key, { at: deps.now().getTime(), complete: answer.complete, value });
    return answer;
  });
  ANSWERS.set(key, { at: now, complete: null, value });
  value.catch(() => {
    if (ANSWERS.get(key)?.value === value) ANSWERS.delete(key);
  });
  return value;
}

const decidedKey = (cluster: string, token: string, days: number) => `${cluster}:${token}:${days}`;

/**
 * The outcomes the store keeps for these launches, nothing read from the chain: a decided one as it was decided, a week
 * not over yet as young, any other as not read — what the next survival answer reads. For a launch's flow (L3), which
 * shows a token's own outcomes and its creator's earlier coins' without waiting on a read of every market.
 */
export async function keptLaunchSurvival(
  deps: Pick<HealthDeps, "network" | "store" | "now">,
  launches: readonly Readonly<{ token: string; launchedAt: string }>[],
): Promise<Map<string, SurvivalOutcome[]>> {
  const cluster = deps.network.cluster;
  const now = Math.floor(deps.now().getTime() / 1000);
  const kept = deps.store.collection<Decided>("launchSurvival");
  const out = new Map<string, SurvivalOutcome[]>();
  await Promise.all(
    launches.map(async (launch) => {
      const launchedAt = Math.floor(Date.parse(launch.launchedAt) / 1000);
      const known = await Promise.all(SURVIVAL_HORIZONS_DAYS.map((days) => kept.get(decidedKey(cluster, launch.token, days)).catch(() => undefined)));
      out.set(
        launch.token,
        SURVIVAL_HORIZONS_DAYS.map((days, index): SurvivalOutcome => known[index]?.outcome ?? { days, state: survivalWindow(launchedAt, days).to > now ? "young" : "unread", proof: null }),
      );
    }),
  );
  return out;
}

/** One answer made now; `reader` is the chain's market reader (a test hands in its own). */
export async function assembleLaunchSurvival(
  deps: Pick<HealthDeps, "network" | "connection" | "store" | "now" | "ryntraWallets">,
  reader: Pick<LaunchMarketReader, "state" | "windowTrades"> = launchMarketReader(deps),
): Promise<LaunchSurvivalResponse> {
  const cluster = deps.network.cluster;
  const now = Math.floor(deps.now().getTime() / 1000);
  const records = (await deps.store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${cluster}:`))
    .filter((record) => record.state !== "PENDING" && (record.cluster ?? cluster) === cluster)
    .sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt));
  const own = await deps.ryntraWallets().catch(() => ({ wallets: new Set<string>() as ReadonlySet<string>, complete: false }));
  const kept = deps.store.collection<Decided>("launchSurvival");
  const launchedOf = (record: LaunchRecord) => Math.floor(Date.parse(record.launchedAt) / 1000);

  /* What is kept, read for every market at once; a horizon whose week is over and is not decided is due. */
  const outcomes = new Map<string, SurvivalOutcome[]>();
  const due: { record: LaunchRecord; days: SurvivalHorizon }[] = [];
  await Promise.all(
    records.map(async (record) => {
      const launchedAt = launchedOf(record);
      const known = await Promise.all(SURVIVAL_HORIZONS_DAYS.map((days) => kept.get(decidedKey(cluster, record.token, days)).catch(() => undefined)));
      outcomes.set(
        record.token,
        SURVIVAL_HORIZONS_DAYS.map((days, index): SurvivalOutcome => {
          if (known[index]) return known[index].outcome;
          if (survivalWindow(launchedAt, days).to > now) return { days, state: "young", proof: null };
          due.push({ record, days });
          return { days, state: "unread", proof: null };
        }),
      );
    }),
  );

  /* A stable order, whatever store read answered first: the rotation below points into the same list each time. */
  due.sort((a, b) => a.record.token.localeCompare(b.record.token) || a.days - b.days);
  /* Each due week read on its own from the chain — paged back to it, stopped at the first trade that proves demand —, a few at a time inside the budget, from where the last answer stopped. */
  const offset = due.length ? (ROTATION.get(cluster) ?? 0) % due.length : 0;
  const order = [...due.slice(offset), ...due.slice(0, offset)];
  const deadline = Date.now() + READ_BUDGET_MS;
  let next = 0;
  let reached = 0;
  const worker = async () => {
    for (;;) {
      const item = order[next++];
      if (!item) return;
      const left = deadline - Date.now();
      if (left < 3_000) return;
      reached += 1;
      const { record, days } = item;
      const launchedAt = launchedOf(record);
      const excluded = new Set([record.creator, ...own.wallets]);
      const window = survivalWindow(launchedAt, days);
      const read = await (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const state = await Promise.race([
          reader.state({ token: record.token, pool: record.pool, shared: true }),
          new Promise<never>((_, fail) => {
            timer = setTimeout(() => fail(new Error("The market's state was not read in time.")), left - 1_000);
          }),
        ]).finally(() => clearTimeout(timer));
        return reader.windowTrades({ token: record.token, state, from: window.from, to: window.to, found: (trade) => survivalProves(trade, excluded), budgetMs: Math.max(1_000, deadline - Date.now() - 1_000) });
      })().catch(() => null);
      if (!read) continue;
      const outcome = windowOutcome(days, read, launchedAt, excluded);
      const standing = outcomes.get(record.token);
      if (standing) standing[SURVIVAL_HORIZONS_DAYS.indexOf(days)] = outcome;
      /* Only a decision made with every one of Ryntra's wallets known is kept: a trade of an unknown one of them is no demand. */
      if (own.complete && survivalDecided(outcome)) {
        await kept.insertIfAbsent(decidedKey(cluster, record.token, days), { cluster, token: record.token, days, outcome, decidedAt: deps.now().toISOString() }).catch(() => false);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, order.length) }, worker));
  if (due.length) ROTATION.set(cluster, (offset + reached) % due.length);

  /* Every market is counted; the list names the newest of them, as many as the contract carries. */
  const markets = records.slice(0, SURVIVAL_LISTED).map((record) => ({
    token: record.token,
    symbol: record.symbol.slice(0, 16),
    launchedAt: record.launchedAt,
    own: own.wallets.has(record.creator),
    outcomes: (outcomes.get(record.token) ?? []).map((outcome) => ({ days: outcome.days, state: outcome.state, proof: outcome.proof ? { signature: outcome.proof.signature, at: new Date(outcome.proof.at * 1000).toISOString() } : null })),
  }));
  const stats = survivalStats(records.map((record) => ({ own: own.wallets.has(record.creator), outcomes: outcomes.get(record.token) ?? [] })));
  return {
    network: deps.network.chain,
    windowDays: SURVIVAL_WINDOW_DAYS,
    horizons: stats.map((entry) => ({ days: entry.days, people: { ...entry.people }, ryntra: { ...entry.ryntra } })),
    markets,
    listedAll: records.length <= SURVIVAL_LISTED,
    ownWalletsComplete: own.complete,
    complete: [...outcomes.values()].every((list) => list.every((outcome) => outcome.state !== "unread")),
    observedAt: deps.now().toISOString(),
  };
}
