import type { Lang } from '../../../city/lib/i18n/langs.ts';
import { pct } from '../../../city/lib/launch/format.ts';
import type { PoolChoice, PoolReward } from '../../../city/lib/launch/pool.ts';
import { DLMM_PRO_LAUNCH_TERMS, DLMM_PRO_SUPPLY_RAW, dlmmProRewardDay, dlmmProRewardLockedShare, dlmmProRewardPerDayRaw } from '../../../lib/core/launch/dlmm-pro.ts';
import { PRO_REWARDS } from './words.ts';

/**
 * The reward for a pool's liquidity on the Launch screen, as plain numbers: whether the step shows, the
 * choices it offers, and what the supply becomes with it. The engine's terms (`lib/core/launch/dlmm-pro.ts`) are the
 * only source; the screen counts nothing the engine does not say again at the signature.
 */

/**
 * The step's switch: closed unless the deployment opens it — `NEXT_PUBLIC_RYNTRA_POOL_LAUNCH_REWARDS=open`. The
 * engine holds its own beside it: a screen
 * whose switch was opened alone builds nothing the engine has not opened.
 */
export const PRO_REWARDS_SWITCH = process.env.NEXT_PUBLIC_RYNTRA_POOL_LAUNCH_REWARDS === 'open';

export const REWARD = DLMM_PRO_LAUNCH_TERMS.reward;
/** The shares and the days the step offers, as the engine's terms list them. */
export const REWARD_SHARES: readonly number[] = REWARD.shares;
export const REWARD_DAYS: readonly number[] = REWARD.days;
/** What the step starts at when the creator switches it on. */
export const REWARD_DEFAULT: PoolReward = { shareBps: REWARD.defaultShareBps, days: REWARD.defaultDays };

const SUPPLY = DLMM_PRO_LAUNCH_TERMS.coin.supply;
const LADDER_BPS = DLMM_PRO_LAUNCH_TERMS.ladder.shareBps;

/** The choice's reward, where it is on and inside the terms; null — none. */
export function rewardOf(choice: Pick<PoolChoice, 'reward'> | null | undefined): PoolReward | null {
  const reward = choice?.reward ?? null;
  if (!reward) return null;
  const ok = Number.isInteger(reward.shareBps) && reward.shareBps >= REWARD.minShareBps && reward.shareBps <= REWARD.maxShareBps && Number.isInteger(reward.days) && reward.days >= REWARD.minDays && reward.days <= REWARD.maxDays;
  return ok ? reward : null;
}

/** The choice with the reward switched on (at the default, or as it was) or off. */
export function withReward(choice: PoolChoice, on: boolean): PoolChoice {
  return { ...choice, reward: on ? (rewardOf(choice) ?? REWARD_DEFAULT) : null };
}

/** The reward's coins, whole coins of the launch — a number for the eye. */
export function rewardCoins(shareBps: number): number {
  return (SUPPLY * shareBps) / 10_000;
}

/**
 * A day of the reward while the launch's own locked liquidity is the only liquidity at the price, whole coins
 * of the launch — the whole day, the creator's part and Ryntra's — and their shares, basis points. The program pays
 * every position at the price by its liquidity and cannot leave Ryntra's locked position out, so the line before the
 * signature says it; the engine tells the same `perDayRaw` and `locked` at every build.
 */
export function rewardDayOf(choice: Pick<PoolChoice, 'reward'> | null | undefined, split = true): Readonly<{ perDay: number; creator: number; ryntra: number; creatorBps: number; ryntraBps: number }> | null {
  const reward = rewardOf(choice);
  if (!reward) return null;
  const perDayRaw = dlmmProRewardPerDayRaw((DLMM_PRO_SUPPLY_RAW * BigInt(reward.shareBps)) / 10_000n, reward.days);
  const day = dlmmProRewardDay(perDayRaw, split, 0);
  const whole = (raw: bigint) => Number(raw) / 10 ** DLMM_PRO_LAUNCH_TERMS.coin.decimals;
  const share = dlmmProRewardLockedShare(split);
  return { perDay: whole(perDayRaw), creator: whole(day.creatorRaw), ryntra: whole(day.ryntraRaw), creatorBps: share.creatorBps, ryntraBps: share.ryntraBps };
}

/** What of the supply goes in as locked liquidity, basis points: the whole, less the creator's ladder and the reward. */
export function lockedShareBps(choice: Pick<PoolChoice, 'ladder' | 'reward'> | null | undefined): number {
  return 10_000 - (choice?.ladder ? LADDER_BPS : 0) - (rewardOf(choice)?.shareBps ?? 0);
}

/** How a launch into a pool goes, behind the launch's «i», where it pays a reward; null — it pays none, and the form says it its own way. */
export function rewardHowOf(choice: Pick<PoolChoice, 'ladder' | 'reward'> | null | undefined, lang: Lang): string | null {
  const reward = rewardOf(choice);
  if (!reward) return null;
  const w = PRO_REWARDS[lang];
  const locked = pct(lockedShareBps(choice));
  return choice?.ladder ? w.poolHowLadder(locked, pct(LADDER_BPS), pct(reward.shareBps)) : w.poolHow(locked, pct(reward.shareBps));
}
