import { PARTNER_LEVEL_IDS, type TrackBadgeId } from "./badges.ts";

/**
 * The tracks of the Ryntra Network as badges a person holds — read from what
 * the ledgers already know, never stored a second time.
 *
 * | Track | Badges | For |
 * |---|---|---|
 * | Partner | Scout · Partner · Builder · Council | 1 · 3 · 10 · 25 activated creators |
 * | Founding Partner | one status badge | a Founding seat, approved |
 * | Creator | Launched · Graduated · Returning Builder | a confirmed launch · a DEX · a second real market 30+ days later |
 * | Ambassador | Educator · Guide · Community Partner | given by Ryntra's review of materials and the creators they brought |
 *
 * An activated creator is a creator one of whose launches with this partner
 * was activated (three independent external addresses with a real trade
 * within thirty days, written once by the protection run) and is not held by
 * the review or barred from paying the partner. A creator counts once,
 * whatever number of their launches did. A badge is dated by the moment that
 * earned it: a level by the activation of the creator that reached it.
 *
 * A real market, for Returning Builder, is a launch that was activated or
 * reached a DEX; the second one has to be launched at least thirty days
 * after the first.
 *
 * Ambassador badges are given by a person, not by a count: no reviewer action
 * awards them yet, so they are held by nobody and shown as the way up.
 */

export const PARTNER_LEVEL_CREATORS: Readonly<Record<(typeof PARTNER_LEVEL_IDS)[number], number>> = {
  SCOUT: 1,
  PARTNER: 3,
  BUILDER: 10,
  COUNCIL: 25,
};

/** Days between the first real market and the second one for Returning Builder. */
export const RETURNING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TrackBadgeState = Readonly<{ id: TrackBadgeId; earned: boolean; at: string | null }>;

export type PartnerLevelState = Readonly<{
  /** The level held now, or null below Scout. */
  current: (typeof PARTNER_LEVEL_IDS)[number] | null;
  /** The next level and how many activated creators it needs in all; null at Council. */
  next: Readonly<{ id: (typeof PARTNER_LEVEL_IDS)[number]; creators: number }> | null;
  activated: number;
}>;

/** One activated creator: who, and when their first launch with this partner was activated. */
export type ActivatedCreator = Readonly<{ creator: string; at: string }>;

/** The partner level from the number of activated creators. */
export function partnerLevel(activated: number): PartnerLevelState {
  let current: PartnerLevelState["current"] = null;
  for (const id of PARTNER_LEVEL_IDS) if (activated >= PARTNER_LEVEL_CREATORS[id]) current = id;
  const next = PARTNER_LEVEL_IDS.find((id) => activated < PARTNER_LEVEL_CREATORS[id]) ?? null;
  return { current, next: next ? { id: next, creators: PARTNER_LEVEL_CREATORS[next] } : null, activated };
}

/** The four partner levels, each dated by the activation of the creator that reached it. */
export function partnerTrack(creators: readonly ActivatedCreator[]): readonly TrackBadgeState[] {
  const order = [...creators].sort((a, b) => a.at.localeCompare(b.at));
  return PARTNER_LEVEL_IDS.map((id) => {
    const reached = order[PARTNER_LEVEL_CREATORS[id] - 1];
    return { id, earned: reached !== undefined, at: reached?.at ?? null };
  });
}

/** The Founding status, from an approved seat. */
export function foundingBadge(seat: Readonly<{ approvedAt: string }> | null): TrackBadgeState {
  return { id: "FOUNDING_PARTNER", earned: seat !== null, at: seat?.approvedAt ?? null };
}

/** One of this wallet's own launches as a creator. */
export type OwnLaunch = Readonly<{ launchedAt: string; activatedAt: string | null; graduatedAt: string | null }>;

const earliest = (values: readonly (string | null)[]): string | null =>
  values.filter((value): value is string => value !== null).sort((a, b) => a.localeCompare(b))[0] ?? null;

/** When a launch became a real market — activated or on a DEX, whichever came first; null — not yet. */
export function realMarketAt(launch: OwnLaunch): string | null {
  return earliest([launch.activatedAt, launch.graduatedAt]);
}

/** The creator track from this wallet's own confirmed launches. */
export function creatorTrack(launches: readonly OwnLaunch[]): readonly TrackBadgeState[] {
  const launched = earliest(launches.map((launch) => launch.launchedAt));
  const graduated = earliest(launches.map((launch) => launch.graduatedAt));
  const real = launches
    .map((launch) => ({ launchedAt: launch.launchedAt, realAt: realMarketAt(launch) }))
    .filter((launch): launch is { launchedAt: string; realAt: string } => launch.realAt !== null)
    .sort((a, b) => a.launchedAt.localeCompare(b.launchedAt));
  let returning: string | null = null;
  const first = real[0];
  if (first) {
    for (const later of real.slice(1)) {
      if (Date.parse(later.launchedAt) - Date.parse(first.launchedAt) < RETURNING_DAYS * DAY_MS) continue;
      /* Held from the moment the second market became real — never before it was launched. */
      const at = later.realAt.localeCompare(later.launchedAt) > 0 ? later.realAt : later.launchedAt;
      if (returning === null || at.localeCompare(returning) < 0) returning = at;
    }
  }
  return [
    { id: "LAUNCHED", earned: launched !== null, at: launched },
    { id: "GRADUATED", earned: graduated !== null, at: graduated },
    { id: "RETURNING_BUILDER", earned: returning !== null, at: returning },
  ];
}

/** The ambassador track: given by review, held by nobody until a reviewer gives it. */
export function ambassadorTrack(): readonly TrackBadgeState[] {
  return (["EDUCATOR", "GUIDE", "COMMUNITY_PARTNER"] as const).map((id) => ({ id, earned: false, at: null }));
}
