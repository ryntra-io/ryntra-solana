import { cleanResidentName } from '../../../../lib/world/text-safety/clean.ts';

/**
 * The garage agent's settings (CITY-29): its name, what it reports on, and whether it is on. Everything is a fixed
 * choice except the name, and the name passes the city's cleaning of typed text (CITY-73) before it is kept or shown.
 * There is no amount, budget or wallet anywhere in it: the garage agent has no money.
 */

export type Topic = 'moves' | 'liquidity' | 'beacons' | 'scout';

/** The topics in the order the settings show them; their words are the window's (`GARAGE`). */
export const TOPIC_ORDER: readonly Topic[] = ['moves', 'liquidity', 'beacons', 'scout'];

export type GarageSettings = Readonly<{
  name: string;
  topics: Readonly<Record<Topic, boolean>>;
  on: boolean;
}>;

/** The name a new agent comes with; the person renames it in its window. */
export const DEFAULT_NAME = 'Nova';
export const NAME_MAX = 20;

export const DEFAULT_SETTINGS: GarageSettings = {
  name: DEFAULT_NAME,
  topics: { moves: true, liquidity: true, beacons: true, scout: true },
  on: true,
};

/** A name as typed, cleaned; null when nothing of it may stand (empty, hidden characters, a disguised word, an order). */
export function agentName(raw: unknown): string | null {
  const cleaned = cleanResidentName(raw);
  if (!cleaned.ok) return null;
  const name = cleaned.text.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return name.length ? name : null;
}

/** Settings read back from storage: every field one of the offered choices, or the default. */
export function readSettings(raw: unknown): GarageSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const t = (r.topics && typeof r.topics === 'object' ? r.topics : {}) as Record<string, unknown>;
  const topics = Object.fromEntries(TOPIC_ORDER.map((k) => [k, typeof t[k] === 'boolean' ? t[k] : DEFAULT_SETTINGS.topics[k]])) as Record<Topic, boolean>;
  return {
    name: agentName(r.name) ?? DEFAULT_NAME,
    topics,
    on: typeof r.on === 'boolean' ? r.on : DEFAULT_SETTINGS.on,
  };
}
