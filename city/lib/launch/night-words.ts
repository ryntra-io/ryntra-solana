import { digits, wordsNow } from '../i18n/dict.ts';
import { pct, usd } from './format.ts';
import { NIGHT_RULE, type NightActId, type NightEntry } from './night.ts';
import { LAUNCH_NIGHT } from './words.ts';

/**
 * How Launch Night says its figures (CITY-146): a name, the main number and one line — in the language on screen
 * (`./words.ts`), each time rounded down so it never reads as more than it is.
 */

const ACT_KEYS = { fresh: 'actFresh', climbing: 'actClimbing', graduated: 'actGraduated' } as const satisfies Record<NightActId, keyof (typeof LAUNCH_NIGHT)['en']>;

/** An act's name. */
export function actName(id: NightActId): string {
  return wordsNow(LAUNCH_NIGHT)[ACT_KEYS[id]];
}

/** A span since a moment, short and rounded down: «a moment», «8 min», «3 h». */
export function agoSpan(ms: number): string {
  const w = wordsNow(LAUNCH_NIGHT);
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return w.justNow;
  if (minutes < 60) return w.minutes(minutes);
  return w.hours(Math.floor(minutes / 60));
}

/** The stage's one line under the coin: how long ago it launched, how far along its curve, or when it graduated. */
export function entryLine(entry: NightEntry, now: number): string {
  const w = wordsNow(LAUNCH_NIGHT);
  if (entry.act === 'graduated') return w.graduatedAgo(agoSpan(now - Date.parse(entry.graduatedAt ?? entry.startedAt)));
  if (entry.act === 'climbing') return w.toDex(pct(Math.floor(entry.progress) * 100));
  return w.launchedAgo(agoSpan(now - Date.parse(entry.startedAt)));
}

/** The main number: the market cap, short. */
export function entryCap(entry: NightEntry): string {
  return usd(entry.marketCapUsd);
}

/** «3 launches live». */
export function liveText(count: number): string {
  return wordsNow(LAUNCH_NIGHT).live(count, digits(String(count)));
}

/** The rule behind «i». */
export function ruleText(): string {
  return wordsNow(LAUNCH_NIGHT).rule(Math.round(NIGHT_RULE.windowMs / 3_600_000));
}
