import type { LaunchFlowResponse } from '../../../lib/api/v1/contract.ts';
import type { RingState } from '../../../lib/launch/flow/counts.ts';
import type { CheckState } from '../../../lib/mission-control/types.ts';

/**
 * Silhouette and rings (L7, CITY-144; `docs/research/ryntra-launch-2026-10-29/SPEC.md` §4 and §6).
 *
 * **A graduation means something.** A launch's tower joins the city's skyline only when its coin moved to its pool on
 * the chain *and* had `minBuyers` independent buyers fill its curve *and* spent `minCurveMinutes` on that curve.
 * Below that bar the tower graduates but stays in the Docks: «Fast exit» when the curve filled too fast, «Graduated
 * with N buyers» when too few people filled it. The rule is for the city's look only — the engine, the pool and every
 * trade are untouched.
 *
 * **Survival is status.** Days 7, 30 and 90 become rings on the tower's crown, each lit only when the flow traced the
 * trader that proves it and found them outside the creator's party (`independent: true` of the flow's cluster-aware
 * read). A proof by the creator's party is `unproven`; one whose trader was not traced, or a check the flow has not
 * confirmed yet, is not lit: the ring is a fact of the chain, never a guess.
 *
 * Every figure is the engine's (`GET /api/v1/launch/{mint}/flow`): independent buyers are counted once per funding
 * cluster, the creator's party never, and a wallet whose start was not read not at all — a floor, never more.
 *
 * Client-safe and pure.
 */

/**
 * The thresholds: display only.
 *
 * ⚠ PROPOSAL — the numbers are the session's proposal from SPEC §4 (≥ 50 buyers, ≥ 15 min). `ownerWord` turns true only with it.
 */
export const SILHOUETTE_RULE = Object.freeze({
  version: 'silhouette-0.1.0',
  /** Independent buyers that filled the curve, each funding cluster once. */
  minBuyers: 50,
  /** From the creation to the graduation. */
  minCurveMinutes: 15,
  /** The operator confirmed the numbers above: false until the word is given. */
  ownerWord: false,
});

export type SilhouetteRule = Readonly<{ minBuyers: number; minCurveMinutes: number }>;

/** One survival check as the flow proved it. */
export type RingProof = Readonly<{ state: CheckState; independent: boolean | null }>;

/** What of a launch's flow the city keeps on its tower: the graduation's facts and the survival proofs. */
export type TowerFlow = Readonly<{
  graduated: boolean;
  graduatedAt: string | null;
  /** The creation's block time; null when the history read did not reach it. */
  createdAt: string | null;
  /** Independent buyers that filled the curve; null before it graduated. */
  buyers: number | null;
  /** The count is a floor: some buyers' starts or trades were not read. */
  atLeast: boolean;
  survival: readonly [RingProof, RingProof, RingProof];
  /** What the creator's wallet bought here, of the supply, when every trade of it was read; null — not read whole (CITY-169). */
  creatorBoughtBps?: number | null;
}>;

/** The flow's answer as the tower keeps it. */
export function towerFlowOf(flow: Pick<LaunchFlowResponse, 'graduation' | 'launchSlot' | 'buyers' | 'survival'> & Partial<Pick<LaunchFlowResponse, 'dev'>>): TowerFlow {
  const proof = (days: 7 | 30 | 90): RingProof => {
    const entry = flow.survival.find((check) => check.days === days);
    return { state: entry?.state ?? 'unread', independent: entry?.independent ?? null };
  };
  return {
    graduated: flow.graduation.graduated,
    graduatedAt: flow.graduation.at,
    createdAt: flow.launchSlot?.at ?? null,
    buyers: flow.graduation.buyers?.independent ?? null,
    atLeast: flow.buyers.atLeast,
    survival: [proof(7), proof(30), proof(90)],
    creatorBoughtBps: flow.dev?.complete ? flow.dev.boughtBps : null,
  };
}

/**
 * Where a launch's tower stands and what it says of its graduation:
 * - `curve` — still on its curve, in the Docks;
 * - `unread` — graduated, its graduation's facts not read: in the Docks — or `held` back from the city while its first
 *   read is on its way, so a tower never stands in one place and jumps to another a moment later;
 * - `fast` — graduated after less than `minCurveMinutes` on its curve: «Fast exit», in the Docks;
 * - `few` — graduated with fewer than `minBuyers` independent buyers: «Graduated with N buyers», in the Docks;
 * - `skyline` — passed both: in the skyline.
 */
export type SilhouetteStatus = 'curve' | 'unread' | 'fast' | 'few' | 'skyline';

export type Silhouette = Readonly<{
  stand: 'docks' | 'skyline' | 'held';
  status: SilhouetteStatus;
  /** Independent buyers that filled the curve; null when not read. */
  buyers: number | null;
  atLeast: boolean;
  /** Whole minutes from the creation to the graduation; null when either was not read. */
  curveMinutes: number | null;
}>;

export type SilhouetteInput = Readonly<{
  migrated: boolean;
  launchedAt: string | null;
  flow: TowerFlow | null;
  /** The feed is reading this tower's flow for the first time and has not shown the tower yet. */
  awaitingFlow: boolean;
}>;

const MINUTE = 60_000;

/** Milliseconds from the creation to the graduation; null when either is not known, or they read backwards. */
function curveMs(flow: TowerFlow, launchedAt: string | null): number | null {
  const end = Date.parse(flow.graduatedAt ?? '');
  const start = Date.parse(flow.createdAt ?? launchedAt ?? '');
  if (!Number.isFinite(end) || !Number.isFinite(start) || end < start) return null;
  return end - start;
}

export function silhouetteOf(launch: SilhouetteInput, rule: SilhouetteRule = SILHOUETTE_RULE): Silhouette {
  if (!launch.migrated) return { stand: 'docks', status: 'curve', buyers: null, atLeast: false, curveMinutes: null };
  const flow = launch.flow;
  /* A flow read before the graduation says nothing of it yet: the tower waits in the Docks for the next read. */
  if (!flow || !flow.graduated) return { stand: !flow && launch.awaitingFlow ? 'held' : 'docks', status: 'unread', buyers: null, atLeast: false, curveMinutes: null };
  const ms = curveMs(flow, launch.launchedAt);
  const facts = { buyers: flow.buyers, atLeast: flow.atLeast, curveMinutes: ms === null ? null : Math.floor(ms / MINUTE) };
  if (ms !== null && ms < rule.minCurveMinutes * MINUTE) return { stand: 'docks', status: 'fast', ...facts };
  /* A floor below the bar is not known to be above it: it stays below until the read says more. */
  if (flow.buyers !== null && flow.buyers < rule.minBuyers) return { stand: 'docks', status: 'few', ...facts };
  if (ms === null || flow.buyers === null) return { stand: 'docks', status: 'unread', ...facts };
  return { stand: 'skyline', status: 'skyline', ...facts };
}

/**
 * The rings of days 7, 30 and 90 on a tower's crown: a check the survival read passed lights only when the flow traced
 * the trader of its proof and found them outside the creator's party; `unproven` when the proof is the creator's own
 * party's trade. A proof whose trader was not traced, or a passed check the flow has not confirmed yet — not read, or
 * read before the check passed — is `unread`: never lit, never a guess.
 */
export function crownRings(checks: readonly [CheckState, CheckState, CheckState] | readonly CheckState[], survival: TowerFlow['survival'] | null): readonly [RingState, RingState, RingState] {
  const ring = (index: number): RingState => {
    const state = (checks[index] ?? 'unread') as RingState;
    if (state !== 'alive') return state;
    const proof = survival?.[index];
    if (!proof || proof.state !== 'alive') return 'unread';
    return proof.independent === true ? 'alive' : proof.independent === false ? 'unproven' : 'unread';
  };
  return [ring(0), ring(1), ring(2)];
}

/** The days whose ring burns on the crown. */
export function litRings(rings: readonly RingState[]): readonly (7 | 30 | 90)[] {
  return ([7, 30, 90] as const).filter((_, index) => rings[index] === 'alive');
}

/** Whether a tower needs its flow read: graduated (where it stands), or a passed check (whether its ring lights). */
export function needsFlow(launch: Readonly<{ migrated: boolean; checks: readonly CheckState[] }>): boolean {
  return launch.migrated || launch.checks.includes('alive');
}

/** Whether the tower's kept flow says less than its checks do now: graduated or passed since it was read. */
export function flowBehind(launch: Readonly<{ migrated: boolean; checks: readonly CheckState[] }>, flow: TowerFlow): boolean {
  return (launch.migrated && !flow.graduated) || launch.checks.some((state, index) => state === 'alive' && flow.survival[index]?.state !== 'alive');
}

/**
 * A flow is read again after five minutes while what the city shows from it can still change; once it cannot, after
 * half an hour.
 */
export const FLOW_FRESH_MS = 5 * 60_000;
export const FLOW_SETTLED_MS = 30 * 60_000;

/**
 * How long a kept flow stays fresh. Settled: a fast exit (its time never changes), a graduation at or above the bar
 * (a floor that already passes only rises: `mergeFlow`), a count read whole, a tower still on its curve — unless a
 * passed check's trader is not traced yet. Anything else — a floor below the bar, a graduation not read whole — is read
 * again soon. What changes outright — a check passed since, a graduation since — makes the flow `flowBehind` and asks
 * for it at once.
 */
export function flowFreshMs(tower: Readonly<{ migrated: boolean; launchedAt: string | null }>, flow: TowerFlow, rule: SilhouetteRule = SILHOUETTE_RULE): number {
  if (flow.survival.some((proof) => proof.state === 'alive' && proof.independent === null)) return FLOW_FRESH_MS;
  if (!tower.migrated || !flow.atLeast) return FLOW_SETTLED_MS;
  const status = silhouetteOf({ ...tower, flow, awaitingFlow: false }, rule).status;
  return status === 'fast' || status === 'skyline' ? FLOW_SETTLED_MS : FLOW_FRESH_MS;
}

/**
 * A new read of a tower's flow, against the one kept. A count of buyers that is a floor never takes a tower's count
 * down: a read whose budget traced fewer wallets says «at least» less, not that fewer bought. A count read whole is
 * taken as it is, lower or higher — a cluster found since merges wallets that were counted apart.
 */
export function mergeFlow(kept: TowerFlow | null, next: TowerFlow): TowerFlow {
  if (!kept || !kept.graduated || !next.graduated || !next.atLeast || kept.graduatedAt !== next.graduatedAt) return next;
  if (kept.buyers === null || next.buyers === null || kept.buyers <= next.buyers) return next;
  return { ...next, buyers: kept.buyers };
}

/**
 * The flow's own pill of the graduation, which the window leaves out when its top line already says «Graduated with N
 * buyers» — but never the warning that one buy filled the curve.
 */
export function omitGraduationPill(silhouette: Silhouette, singleTrade: boolean): boolean {
  return silhouette.status === 'few' && (silhouette.buyers ?? 0) > 0 && !singleTrade;
}
