/**
 * A Meteora launch's life: on its Dynamic Bonding Curve (DBC), then graduated into a DAMM v2 pool, then the survival
 * checks at day 7, 30 and 90.
 *
 * Two reads again. Jupiter's token record states the launchpad and, once the curve is done, the graduated pool and its
 * time; Meteora's own DAMM v2 Data API confirms the pool exists and holds the token, and states its depth and trading.
 * A graduation Jupiter states and Meteora does not confirm stays `confirmed: false`.
 *
 * The curve's progress is `not_measured` here: no keyless public endpoint states it, and reading the curve account
 * itself is a later adapter. A survival check is judged at the time of the read: `alive` means the pool, past day N,
 * still holds the floor and traded in the last day.
 *
 * Pure: no network, no clock unless given.
 */

import { notMeasured, valueOf, type Measured, type WeatherPolicy, DEFAULT_POLICY } from "./contract.ts";

/** The launchpads Jupiter names whose curve is Meteora's DBC: Meteora's own, Jupiter Studio's, Believe's. */
const DBC_LAUNCHPADS: ReadonlySet<string> = new Set(["met-dbc", "jup-studio", "believe"]);

export const isDbcLaunchpad = (launchpad: string | null): boolean => launchpad !== null && DBC_LAUNCHPADS.has(launchpad.toLowerCase());

export const SURVIVAL_DAYS = [7, 30, 90] as const;

export type SurvivalCheck = Readonly<{
  day: (typeof SURVIVAL_DAYS)[number];
  /** `pending` before day N; `alive` or `quiet` after it; `not_measured` when the pool's figures were not read. */
  state: "pending" | "alive" | "quiet" | "not_measured";
}>;

export type GraduatedPool = Readonly<{
  address: string;
  /** Meteora's DAMM v2 record was read and holds this token. */
  confirmed: boolean;
  tvlUsd: Measured;
  volume24hUsd: Measured;
  url: string;
}>;

export type LaunchLifecycle = Readonly<{
  asset: string;
  launchpad: string | null;
  stage: "curve" | "graduated";
  curveProgressPct: Measured;
  graduatedAt: string | null;
  pool: GraduatedPool | null;
  survival: readonly SurvivalCheck[];
}>;

const DAY_MS = 86_400_000;

/**
 * The life of one launch, or null when Jupiter does not name it a DBC launch. `pool` is Meteora's confirming read of
 * the graduated pool, when there was one.
 */
export function judgeLifecycle(
  args: Readonly<{
    asset: string;
    launchpad: string | null;
    graduatedPool: string | null;
    graduatedAt: string | null;
    pool: GraduatedPool | null;
    now: number;
    policy?: WeatherPolicy;
  }>,
): LaunchLifecycle | null {
  if (!isDbcLaunchpad(args.launchpad)) return null;
  const policy = args.policy ?? DEFAULT_POLICY;
  const graduated = args.graduatedPool !== null || args.graduatedAt !== null;
  const base = { asset: args.asset, launchpad: args.launchpad, curveProgressPct: notMeasured("no keyless source states curve progress") };
  if (!graduated) return { ...base, stage: "curve", graduatedAt: null, pool: null, survival: [] };
  const pool = args.pool && args.pool.address === args.graduatedPool ? args.pool : args.graduatedPool ? { address: args.graduatedPool, confirmed: false, tvlUsd: notMeasured("pool not read"), volume24hUsd: notMeasured("pool not read"), url: "" } : null;
  const since = args.graduatedAt ? Date.parse(args.graduatedAt) : Number.NaN;
  const survival = SURVIVAL_DAYS.map((day): SurvivalCheck => {
    if (!Number.isFinite(since)) return { day, state: "not_measured" };
    if (args.now - since < day * DAY_MS) return { day, state: "pending" };
    const tvl = pool?.confirmed ? valueOf(pool.tvlUsd) : null;
    const volume = pool?.confirmed ? valueOf(pool.volume24hUsd) : null;
    if (tvl === null || volume === null) return { day, state: "not_measured" };
    return { day, state: tvl >= policy.survivalTvlUsd && volume > 0 ? "alive" : "quiet" };
  });
  return { ...base, stage: "graduated", graduatedAt: args.graduatedAt, pool, survival };
}
