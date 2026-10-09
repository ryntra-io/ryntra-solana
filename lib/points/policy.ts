/**
 * Ryntra Points — the formula, versioned.
 *
 * ## Why the formula is a value and not code scattered across the product
 *
 * Every points entry carries the version of the policy that produced it. A
 * later policy changes the number the *next* trade earns and never rewrites
 * what an earlier trade already earned — history is a ledger, and a ledger is
 * not recomputed. So everything a person could ask "why did I get 412 points
 * for that" about lives here, in one object with one version string, and the
 * arithmetic below reads that object rather than its own constants.
 *
 * ## What points are
 *
 * Points reflect genuine activity and may be used for future benefits, access,
 * campaigns and rewards. They have no cash value, cannot be transferred and
 * promise no token, airdrop or conversion. Nothing here rewards leverage, PnL
 * or risk: the base is settled trade volume, with diminishing returns inside
 * a day and a daily cap, so the marginal point gets cheaper the more somebody
 * churns and there is a ceiling on what a day can earn at all.
 *
 * ## Integers only
 *
 * Volume arrives in USD micro-units (`bigint`) and points are whole numbers
 * (`bigint`). A tier's rate is *points per one thousand dollars* — an integer —
 * so a share is `segment × rate / 1e9` floored, and there is no floating point
 * anywhere a person's figure comes from.
 */

export const POINTS_POLICY_VERSION = "1.0.0" as const;

/** Why a row exists. `STRATEGY_COMPLETED` is reserved: it has no writer until Strategies exist. */
export const POINTS_REASONS = [
  "TRADE_VOLUME",
  "ACTIVE_DAY",
  "QUALIFIED_REFERRAL",
  "STRATEGY_COMPLETED",
  "ADJUSTMENT",
] as const;

export type PointsReason = (typeof POINTS_REASONS)[number];

/** One US dollar in the integer unit every amount here counts in. */
export const USD_MICROS = 1_000_000n;

/** One thousand dollars in micro-units — the denominator of every tier rate. */
const THOUSAND_USD_MICROS = 1_000n * USD_MICROS;

export type PointsVolumeTier = Readonly<{
  /** The day's cumulative eligible volume this tier runs up to; null for the last tier. */
  upToUsdMicros: bigint | null;
  /** Whole points per $1,000 of volume inside this tier. */
  pointsPerThousandUsd: bigint;
}>;

export type PointsPolicy = Readonly<{
  version: string;
  /** Marginal, per wallet, per UTC day. */
  volumeTiers: readonly PointsVolumeTier[];
  /** The most volume points one wallet can earn in one UTC day. */
  dailyVolumePointsCap: bigint;
  activeDay: Readonly<{ points: bigint; minimumDayVolumeUsdMicros: bigint }>;
  qualifiedReferral: Readonly<{ points: bigint }>;
  strategyCompleted: Readonly<{ points: bigint }>;
  /** Lifetime points at which each level begins; index 0 is level 1. */
  levels: readonly bigint[];
}>;

export const POINTS_POLICY_V1: PointsPolicy = {
  version: POINTS_POLICY_VERSION,
  volumeTiers: [
    /* The first $1,000 of a day at one point per dollar. */
    { upToUsdMicros: 1_000n * USD_MICROS, pointsPerThousandUsd: 1_000n },
    /* $1,000 – $5,000 at half a point per dollar. */
    { upToUsdMicros: 5_000n * USD_MICROS, pointsPerThousandUsd: 500n },
    /* $5,000 – $25,000 at a fifth. */
    { upToUsdMicros: 25_000n * USD_MICROS, pointsPerThousandUsd: 200n },
    /* Everything above at a twentieth. */
    { upToUsdMicros: null, pointsPerThousandUsd: 50n },
  ],
  dailyVolumePointsCap: 10_000n,
  /* A day counts as active once it reaches ten dollars of eligible volume,
     so a dust trade does not buy the bonus. */
  activeDay: { points: 10n, minimumDayVolumeUsdMicros: 10n * USD_MICROS },
  /* Once per invited wallet, to the level-1 inviter, on that wallet's first
     active day — "qualified" means the person actually traded. */
  qualifiedReferral: { points: 100n },
  /* Reserved. Strategies do not exist yet; a completed one earns nothing
     until a policy version says what. */
  strategyCompleted: { points: 0n },
  levels: [0n, 1_000n, 5_000n, 25_000n, 100_000n],
};

/**
 * Volume points for one operation, given what the wallet already did today.
 *
 * Walks the marginal tiers from the day's prior volume to the prior volume
 * plus this operation, floors each segment's share, then applies what is
 * left of the daily cap. Pure; the caller supplies the day's prior figures
 * from the ledger.
 */
export function volumePoints(
  policy: PointsPolicy,
  args: Readonly<{ dayVolumeBeforeUsdMicros: bigint; volumeUsdMicros: bigint; dayVolumePointsBefore: bigint }>,
): bigint {
  if (args.volumeUsdMicros <= 0n) return 0n;
  const from = args.dayVolumeBeforeUsdMicros < 0n ? 0n : args.dayVolumeBeforeUsdMicros;
  const to = from + args.volumeUsdMicros;
  let points = 0n;
  let tierStart = 0n;
  for (const tier of policy.volumeTiers) {
    const tierEnd = tier.upToUsdMicros;
    /* The overlap of [from, to) with this tier's [tierStart, tierEnd). */
    const segmentStart = from > tierStart ? from : tierStart;
    const segmentEnd = tierEnd === null ? to : to < tierEnd ? to : tierEnd;
    if (segmentEnd > segmentStart) {
      points += ((segmentEnd - segmentStart) * tier.pointsPerThousandUsd) / THOUSAND_USD_MICROS;
    }
    if (tierEnd === null || to <= tierEnd) break;
    tierStart = tierEnd;
  }
  const room = policy.dailyVolumePointsCap - (args.dayVolumePointsBefore < 0n ? 0n : args.dayVolumePointsBefore);
  if (room <= 0n) return 0n;
  return points > room ? room : points;
}

/** The level a lifetime total sits at, and the total the next one begins at. */
export function levelFor(policy: PointsPolicy, points: bigint): Readonly<{ level: number; nextAt: bigint | null }> {
  let level = 1;
  for (let index = 1; index < policy.levels.length; index += 1) {
    if (points >= policy.levels[index]!) level = index + 1;
    else break;
  }
  const nextAt = level < policy.levels.length ? policy.levels[level]! : null;
  return { level, nextAt };
}
