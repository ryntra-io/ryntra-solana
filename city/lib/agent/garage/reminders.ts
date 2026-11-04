import { type BeaconRule, type BeaconStates } from '../../../../lib/world/beacons/rules.ts';
import type { Tower } from '../../market/types.ts';

/**
 * The garage agent's reminders (CITY-29) on your rules: the beacons on your towers (CITY-72) — one that fired, one
 * that ends soon, a one-time beacon that already fired and stopped, one that is off — and the scout (CITY-4) — paused
 * for the week, or a find waiting. Each is read from those features' own state; the agent changes none of it.
 */

export type Reminder =
  | Readonly<{ kind: 'fired'; mint: string; symbol: string; at: number }>
  | Readonly<{ kind: 'ending'; mint: string; symbol: string; at: number }>
  | Readonly<{ kind: 'spent'; mint: string; symbol: string }>
  | Readonly<{ kind: 'off'; mint: string; symbol: string }>
  | Readonly<{ kind: 'scout-paused'; until: number | null }>
  | Readonly<{ kind: 'scout-find'; mint: string; symbol: string }>;

/** A beacon that fired within this long is still worth a reminder. */
export const FIRED_MS = 24 * 60 * 60 * 1000;
/** A beacon ending within this long. */
export const ENDING_MS = 24 * 60 * 60 * 1000;
export const REMINDERS_MAX = 4;

/** What the agent reads of the scout's state. */
export type ScoutRead = Readonly<{ on: boolean; phase: string; until: number | null; find: Readonly<{ tower: Pick<Tower, 'id' | 'symbol'> }> | null }>;

/** The tower's own symbol when the city stands it, else the one the beacon kept. */
const symbolOf = (rule: BeaconRule, towers: ReadonlyMap<string, Tower>) => towers.get(rule.mint)?.symbol ?? rule.symbol;

export function beaconReminders(rules: readonly BeaconRule[], states: BeaconStates, towers: ReadonlyMap<string, Tower>, now: number): Reminder[] {
  const fired: Reminder[] = [];
  const rest: Reminder[] = [];
  for (const rule of rules) {
    const symbol = symbolOf(rule, towers);
    const state = states[rule.id]?.version === rule.version ? states[rule.id] : undefined;
    const at = state?.state.firedAt ?? null;
    if (!rule.on) {
      rest.push({ kind: 'off', mint: rule.mint, symbol });
      continue;
    }
    if (state?.spent) {
      rest.push({ kind: 'spent', mint: rule.mint, symbol });
      continue;
    }
    const ended = rule.expiresAt !== null && rule.expiresAt <= now;
    if (ended) continue;
    if (at !== null && at <= now && now - at < FIRED_MS) fired.push({ kind: 'fired', mint: rule.mint, symbol, at });
    else if (rule.expiresAt !== null && rule.expiresAt > now && rule.expiresAt - now < ENDING_MS) rest.push({ kind: 'ending', mint: rule.mint, symbol, at: rule.expiresAt });
  }
  const order = { ending: 0, spent: 1, off: 2 } as Record<Reminder['kind'], number>;
  fired.sort((a, b) => ('at' in b ? b.at : 0) - ('at' in a ? a.at : 0));
  rest.sort((a, b) => order[a.kind]! - order[b.kind]!);
  return [...fired, ...rest];
}

export function scoutReminders(scout: ScoutRead): Reminder[] {
  if (!scout.on) return [];
  if (scout.find) return [{ kind: 'scout-find', mint: scout.find.tower.id, symbol: scout.find.tower.symbol }];
  if (scout.phase === 'resting') return [{ kind: 'scout-paused', until: scout.until }];
  return [];
}

/** All reminders the person asked for, at most a few: the scout's first (it waits on a tap), then the beacons'. */
export function reminders(
  input: Readonly<{ rules: readonly BeaconRule[]; states: BeaconStates; scout: ScoutRead; towers: readonly Tower[]; now: number; beacons: boolean; scoutOn: boolean }>,
): Reminder[] {
  const towers = new Map(input.towers.map((t) => [t.id, t]));
  const out = [...(input.scoutOn ? scoutReminders(input.scout) : []), ...(input.beacons ? beaconReminders(input.rules, input.states, towers, input.now) : [])];
  return out.slice(0, REMINDERS_MAX);
}
