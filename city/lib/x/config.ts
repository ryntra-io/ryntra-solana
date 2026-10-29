import type { XKeys } from './oauth.ts';
import { parseSlots, type Slots } from './schedule.ts';

/**
 * The publisher's settings, all from the environment the owner sets. Nothing here has a default that posts: the
 * sender is off until `RYNTRA_X_SENDER=on`, and without all four keys it is not connected whatever the switch says.
 *
 *     RYNTRA_X_SENDER          `on` connects the sender; anything else (or unset) keeps it off
 *     RYNTRA_X_API_KEY         the app's API key (consumer key)
 *     RYNTRA_X_API_SECRET      the app's API key secret
 *     RYNTRA_X_ACCESS_TOKEN    the Ryntra account's access token (Read and write)
 *     RYNTRA_X_ACCESS_SECRET   the Ryntra account's access token secret
 *     RYNTRA_X_SLOTS           3 to 5 times of day, `HH:MM` comma separated (default 11:00,15:00,18:00,21:00)
 *     RYNTRA_X_TZ              the zone of those times (default Europe/Kyiv)
 *     RYNTRA_X_DAILY_USD       the most the posts of one day may cost (default 1.00)
 */

export const KEY_NAMES = ['RYNTRA_X_API_KEY', 'RYNTRA_X_API_SECRET', 'RYNTRA_X_ACCESS_TOKEN', 'RYNTRA_X_ACCESS_SECRET'] as const;
export const DEFAULT_SLOTS = '11:00,15:00,18:00,21:00';
export const DEFAULT_TZ = 'Europe/Kyiv';
export const DEFAULT_DAILY_USD = 1;

export type XConfig = {
  /** Switch on and every key there. */
  connected: boolean;
  /** Why not, in words the desk and the cron show. */
  reason: string | null;
  keys: XKeys | null;
  slots: Slots;
  dailyUsd: number;
};

type Env = Record<string, string | undefined>;

export function readXConfig(env: Env): XConfig {
  const slots = parseSlots(env.RYNTRA_X_SLOTS?.trim() || DEFAULT_SLOTS, env.RYNTRA_X_TZ?.trim() || DEFAULT_TZ);
  const daily = Number(env.RYNTRA_X_DAILY_USD ?? DEFAULT_DAILY_USD);
  const dailyUsd = Number.isFinite(daily) && daily >= 0 ? daily : DEFAULT_DAILY_USD;
  const missing = KEY_NAMES.filter((k) => !env[k]?.trim());
  const keys: XKeys | null = missing.length
    ? null
    : { apiKey: env.RYNTRA_X_API_KEY!.trim(), apiSecret: env.RYNTRA_X_API_SECRET!.trim(), accessToken: env.RYNTRA_X_ACCESS_TOKEN!.trim(), accessSecret: env.RYNTRA_X_ACCESS_SECRET!.trim() };
  let reason: string | null = null;
  if (env.RYNTRA_X_SENDER?.trim() !== 'on') reason = 'X not connected: the sender is off (RYNTRA_X_SENDER is not "on").';
  else if (missing.length) reason = `X not connected: missing ${missing.join(', ')}.`;
  else if (!slots.ok) reason = `X not connected: ${slots.error}.`;
  return { connected: reason === null, reason, keys, slots: slots.ok ? slots.slots : { times: [], tz: DEFAULT_TZ }, dailyUsd };
}
