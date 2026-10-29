import { judgeCityTradeOnServer } from '../../../lib/city-economy/clusters.server.ts';
import type { TradeJudgement } from '../../../lib/city-economy/honest-count.ts';
import { windowTotal } from '../../../lib/core/launch/creator-stats.ts';
import { boardExclusions } from '../../../lib/growth/league-store.ts';
import { readLaunchStats } from '../../../lib/launch/creator-stats.server.ts';
import { readLaunchMarket } from '../../../lib/launch/market.server.ts';
import { readLaunchMarkets } from '../../../lib/launch/markets.server.ts';
import { launchHealthDeps } from '../../../lib/launch/runtime.server.ts';
import { deadline, inTurn, KeptWork, type GuardAnswer, type WorkAnswer } from './hall-guard.ts';
import { hallCandidates, hallTrades, hallView, type HallMarketRead, type HallView } from './hall.ts';

/**
 * The Hall of Fame on the server: the same reads the engine's `/api/v1/launch/markets`, `…/{mint}/market` and
 * `…/{mint}/stats` answer with — the engine's own functions, unchanged and read-only — and every trade of the week put
 * to the honest count with the Growth line's real cluster check (`lib/city-economy/clusters.server.ts`).
 *
 * One Hall is worked out at a time and kept for a few minutes for every visitor: the week does not change by the
 * second, and the cluster check reads the chain. The whole work keeps one budget (`HALL_WORK_MS`), so it never runs
 * past the function's minute; the guard is `hall-guard.ts`.
 */

/** A Hall is kept this long before the next visitor's ask works out a new one. */
export const HALL_KEEP_MS = 3 * 60_000;
/**
 * The whole work of one Hall fits this budget — inside the function's minute with room to answer. Every read and every
 * cluster check below is bounded by what is left of it; what it does not reach is said as not read or not checked.
 */
export const HALL_WORK_MS = 45_000;
/** A visitor waits at most this long for a Hall being worked out; the work finishes behind and is kept. */
export const HALL_ANSWER_MS = 50_000;
/** After a failed work, the engine is not asked again for this long: the last Hall (or the failure) stands. */
export const HALL_PAUSE_MS = 60_000;
/** Reads of the engine at once; one read waits at most `READ_MS`, and none starts after `HALL_READS_MS`. */
const READS_AT_ONCE = 4;
const READ_MS = 12_000;
export const HALL_READS_MS = 20_000;
/** Questions to the honest count at once, and at most this many trades a Hall: the rest stay not checked, said as such. */
const CHECKS_AT_ONCE = 8;
const CHECK_MS = 8_000;
export const HALL_TRADES_MAX = 800;
/** The honest count's questions stop being asked after this (and never past the Hall's budget). */
export const HALL_CHECKS_MS = 25_000;

type HallCode = 'LAUNCH_UNAVAILABLE' | 'UNAVAILABLE';
export type HallAnswer = GuardAnswer<HallView, HallCode>;

async function workOut(): Promise<WorkAnswer<HallView, HallCode>> {
  const budget = deadline(HALL_WORK_MS);
  const now = Date.now();
  const deps = launchHealthDeps();
  if (!deps) return { ok: false, code: 'LAUNCH_UNAVAILABLE' };
  /* Who is never on a board: Ryntra's own wallets and the Growth line's list. A Hall that cannot say who is
     internal or who chose to be hidden is not shown — a read that throws or does not answer in time makes it unavailable. */
  const first = await budget.within(Promise.all([readLaunchMarkets(deps), deps.ryntraWallets(), boardExclusions(deps.store)]), READ_MS);
  if (!first) return { ok: false, code: 'UNAVAILABLE' };
  const [list, own, growth] = first;
  const exclude = new Set([...own.wallets, ...growth.wallets]);
  const { listed, chosen } = hallCandidates(list.markets, now);

  /* A market not read in time is said as not read (`markets.read` below `listed`), never guessed. */
  let cut = 0;
  const readsUntil = Date.now() + HALL_READS_MS;
  const reads = await inTurn(chosen, READS_AT_ONCE, async (row): Promise<HallMarketRead> => {
    if (Date.now() >= readsUntil || budget.over()) {
      cut += 1;
      return { row, market: null, stats: null, weekFee: null };
    }
    const market = await budget.within(readLaunchMarket(deps, row.token).catch(() => null), READ_MS);
    const stats = market ? await budget.within(readLaunchStats(deps, row.token).catch(() => null), READ_MS) : null;
    if (!market || !stats) cut += 1;
    return { row, market, stats, weekFee: stats ? windowTotal(stats.revenue.week) : null };
  });

  const trades = hallTrades(reads, now, exclude).slice(0, HALL_TRADES_MAX);
  const checksUntil = Date.now() + HALL_CHECKS_MS;
  const judged = await inTurn(trades, CHECKS_AT_ONCE, async (trade) => {
    if (Date.now() >= checksUntil || budget.over()) {
      cut += 1;
      return null;
    }
    const judgement = await budget.within(judgeCityTradeOnServer(trade).catch(() => null), CHECK_MS);
    if (!judgement) cut += 1;
    return judgement;
  });
  const judgements = new Map<string, TradeJudgement>();
  for (const judgement of judged) if (judgement) judgements.set(judgement.tx, judgement);

  return { ok: true, partial: cut > 0, view: hallView({ network: list.network, reads, judgements, exclude, listed, now }) };
}

/** One Hall worked out at a time on this instance, kept a few minutes, and a pause after the engine failed. */
const guard = new KeptWork<HallView, HallCode>({
  keepMs: HALL_KEEP_MS,
  pauseMs: HALL_PAUSE_MS,
  answerMs: HALL_ANSWER_MS,
  failCode: 'UNAVAILABLE',
  work: () => workOut(),
});

/** The Hall kept from the last work, and whether it is still fresh. */
export function keptHall(now: number = Date.now()): Readonly<{ view: HallView; fresh: boolean }> | null {
  return guard.kept(now);
}

/**
 * Work the week's Hall out now — one at a time for every visitor. When the engine cannot be read, the last Hall stands
 * marked `stale`, with its own read time, which the page shows.
 */
export function refreshHall(now: number = Date.now()): Promise<HallAnswer> {
  return guard.refresh(now);
}

/**
 * The week's Hall: a kept one at once — one past its few minutes is worked out again behind the answer (`behind`
 * keeps that work alive after the response) — or, with none kept, one worked out now.
 */
export function readHall(now: number = Date.now(), behind: (work: () => Promise<unknown>) => void = (work) => void work()): Promise<HallAnswer> {
  return guard.read(now, behind);
}
