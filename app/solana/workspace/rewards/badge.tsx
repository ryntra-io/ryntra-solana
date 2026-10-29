"use client";

import { useId, type CSSProperties, type PointerEvent } from "react";

import {
  ACHIEVEMENT_METAL,
  achievementBadgeSvg,
  faceAvatarSvg,
  RANK_METALS,
  rankBadgeSvg,
  SEASON_METAL,
  seasonBadgeSvg,
  trackBadgeSvg,
  walletAvatarSvg,
  type AchievementId,
  type SeasonBadgeId,
  type TrackBadgeId,
} from "@/lib/growth/badges";
import type { RewardRank } from "@/lib/rewards/rules";

/**
 * The badges as page elements: the one drawing in `lib/growth/badges`, sized
 * and named. Each instance owns its gradient ids, so a page full of badges
 * never borrows another's metal. With `label` the badge is an image with that
 * name; without it, decoration beside a name already written.
 *
 * Each badge carries its metal as `--badge-glow`, for the light the page's
 * CSS puts behind a badge that is held.
 */

function Drawing({ markup, size, label, className, glow }: { markup: string; size: number; label?: string; className?: string; glow?: string }) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", width: size, height: size, flex: "none", ...(glow ? ({ "--badge-glow": glow } as CSSProperties) : null) }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

const cleanId = (id: string) => `rw${id.replace(/[^A-Za-z0-9]/g, "")}`;

export function RankBadge({ rank, size = 40, locked = false, label, className }: { rank: RewardRank; size?: number; locked?: boolean; label?: string; className?: string }) {
  const id = cleanId(useId());
  return <Drawing markup={rankBadgeSvg(rank, { id, size, locked })} size={size} label={label} className={className} glow={locked ? undefined : RANK_METALS[rank].mid} />;
}

export function AchievementBadge({ achievement, earned, size = 40, label, className }: { achievement: AchievementId; earned: boolean; size?: number; label?: string; className?: string }) {
  const id = cleanId(useId());
  return <Drawing markup={achievementBadgeSvg(achievement, { id, size, earned })} size={size} label={label} className={className} glow={earned ? ACHIEVEMENT_METAL.mid : undefined} />;
}

/** A season's badge: the season done, or a week's podium. */
export function SeasonBadge({ badge, earned, size = 40, label, className }: { badge: SeasonBadgeId; earned: boolean; size?: number; label?: string; className?: string }) {
  const id = cleanId(useId());
  return <Drawing markup={seasonBadgeSvg(badge, { id, size, earned })} size={size} label={label} className={className} glow={earned ? SEASON_METAL.mid : undefined} />;
}

/** A Network track's badge: a partner level, the Founding seat, a creator's or an ambassador's. */
export function TrackBadge({ badge, earned, size = 40, label, className }: { badge: TrackBadgeId; earned: boolean; size?: number; label?: string; className?: string }) {
  const id = cleanId(useId());
  return <Drawing markup={trackBadgeSvg(badge, { id, size, earned })} size={size} label={label} className={className} glow={earned ? ACHIEVEMENT_METAL.mid : undefined} />;
}

/** Another wallet's face on a board, from the number the server sends beside its masked name. */
export function FaceAvatar({ face, rank, size = 32, label, className }: { face: number; rank: RewardRank | null; size?: number; label?: string; className?: string }) {
  const id = cleanId(useId());
  return <Drawing markup={faceAvatarSvg(face, rank, { id, size })} size={size} label={label} className={className} />;
}

/** A wallet's face with its rank's frame — Silver and above; none below. */
export function RankAvatar({ wallet, rank, size = 40, label, className }: { wallet: string; rank: RewardRank | null; size?: number; label?: string; className?: string }) {
  const id = cleanId(useId());
  const glow = rank && rank !== "BRONZE" ? RANK_METALS[rank].mid : undefined;
  return <Drawing markup={walletAvatarSvg(wallet, rank, { id, size })} size={size} label={label} className={className} glow={glow} />;
}

/**
 * A badge that answers the pointer: it leans toward it and a soft light
 * follows it across the metal. Writes four CSS variables on the element the
 * handlers sit on — `--rx`, `--ry` (the lean) and `--mx`, `--my` (where the
 * light is, −1 to 1) — and clears them when the pointer leaves. The page's
 * CSS decides what they move, and turns the lean off for reduced motion.
 */
export const tilt = {
  onPointerMove(event: PointerEvent<HTMLElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const x = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / box.width - 0.5));
    const y = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / box.height - 0.5));
    const style = event.currentTarget.style;
    style.setProperty("--rx", `${(-y * 18).toFixed(2)}deg`);
    style.setProperty("--ry", `${(x * 18).toFixed(2)}deg`);
    style.setProperty("--mx", (x * 2).toFixed(3));
    style.setProperty("--my", (y * 2).toFixed(3));
  },
  onPointerLeave(event: PointerEvent<HTMLElement>) {
    for (const name of ["--rx", "--ry", "--mx", "--my"]) event.currentTarget.style.removeProperty(name);
  },
};
