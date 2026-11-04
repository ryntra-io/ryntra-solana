import type { PlacedTower } from '../city/layout.ts';
import type { District } from '../market/types.ts';
import { LENS } from './words.ts';

/**
 * The Lens (CITY-86): one row of chips over the city that picks a kind of tower — All, Crypto, Memes, Stocks, New, Mine.
 * The towers of the kind rise a little in violet light, the rest sink into the ink haze, the camera frames the set. Pure:
 * the towers and what the city knows in, the matching towers out. Every tower is one of the city's own; the Lens never
 * adds a figure, it only says which towers to look at.
 */

export const LENSES = ['all', 'crypto', 'memes', 'stocks', 'new', 'mine'] as const;
export type LensId = (typeof LENSES)[number];

/** The chips' words: the city's dictionary (`./words.ts`, CITY-79), English and Ukrainian. */
export const LENS_WORDS = LENS satisfies Record<string, Record<LensId | 'label', string>>;

/** The districts each kind stands in. Stocks add the engine's listed companies; New and Mine are read from the towers. */
const DISTRICTS: Partial<Record<LensId, readonly District[]>> = {
  crypto: ['core', 'heights'],
  memes: ['strip'],
  stocks: ['avenue'],
  new: ['docks'],
};

/** A tower that opened its first pool this recently is new, wherever it stands. */
export const NEW_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** A launch this far along its curve to the pool is near its graduation. */
export const NEAR_GRADUATION = 70;

/** The three rings of «New»: fresh launches at the island's edge, those near graduation, the graduated in the skyline. */
export type NewStage = 'fresh' | 'near' | 'graduated';

/** What the Lens reads besides the towers: the engine's listed companies, the wallet's coins, Ryntra's launches. */
export type LensContext = Readonly<{
  /** Mints of the companies the engine lists (`/api/v1/stocks/popular`). */
  stocks: ReadonlySet<string>;
  /** Mints the connected wallet holds. */
  owned: ReadonlySet<string>;
  /** Ryntra's launches by mint: how far along the curve (0…100, null unread) and whether it moved to its pool. */
  launches: ReadonlyMap<string, Readonly<{ progress: number | null; migrated: boolean }>>;
  /**
   * Every new launch of the network by mint and the ring it stands on (CITY-142): the engine's Pulse, whichever
   * launchpad it was born on. Read first; a tower it does not name is placed by the city's own reads.
   */
  stages?: ReadonlyMap<string, NewStage>;
  now: number;
}>;

export const EMPTY_CONTEXT: LensContext = { stocks: new Set(), owned: new Set(), launches: new Map(), stages: new Map(), now: 0 };

/** Where a tower stands among the new ones, or null when it is not new. */
export function newStage(t: PlacedTower, ctx: LensContext): NewStage | null {
  const ring = ctx.stages?.get(t.tower.id);
  if (ring) return ring;
  const launch = ctx.launches.get(t.tower.id);
  if (t.tower.district === 'docks') {
    /* A graduation below the city's rule keeps its tower in the Docks (CITY-144): graduated, never «near». */
    if (launch?.migrated) return 'graduated';
    const progress = launch?.progress ?? null;
    return progress !== null && progress >= NEAR_GRADUATION ? 'near' : 'fresh';
  }
  if (launch?.migrated) return 'graduated';
  const at = t.tower.launchedAt ? Date.parse(t.tower.launchedAt) : NaN;
  return Number.isFinite(at) && ctx.now - at >= 0 && ctx.now - at < NEW_WINDOW_MS ? 'graduated' : null;
}

/** Whether a tower is one the lens looks for. «All» takes every tower. */
export function inLens(id: LensId, t: PlacedTower, ctx: LensContext): boolean {
  switch (id) {
    case 'all':
      return true;
    case 'mine':
      return ctx.owned.has(t.tower.id);
    case 'new':
      return newStage(t, ctx) !== null;
    case 'stocks':
      return DISTRICTS.stocks!.includes(t.tower.district) || ctx.stocks.has(t.tower.id);
    default:
      return DISTRICTS[id]!.includes(t.tower.district);
  }
}

/** The towers of a lens, in the layout's order. */
export function lensTowers(id: LensId, towers: readonly PlacedTower[], ctx: LensContext): PlacedTower[] {
  return towers.filter((t) => inLens(id, t, ctx));
}

/**
 * Each tower's light under the lens: 1 the tower is looked at, −1 it sinks into the haze, 0 nothing changes (All). A
 * lens nothing matches changes nothing either: an empty «Mine» never sinks the whole city.
 */
export function lensLevels(id: LensId, towers: readonly PlacedTower[], ctx: LensContext): Float32Array {
  const out = new Float32Array(towers.length);
  if (id === 'all') return out;
  let any = false;
  towers.forEach((t, i) => {
    const on = inLens(id, t, ctx);
    any ||= on;
    out[i] = on ? 1 : -1;
  });
  return any ? out : new Float32Array(towers.length);
}

/** The radii of the three rings of «New» on the ground: where each stage's towers stand, or the island's own rings. */
export function newRings(towers: readonly PlacedTower[], ctx: LensContext): Record<NewStage, Readonly<{ radius: number; count: number }>> {
  const sums: Record<NewStage, { r: number; n: number }> = { fresh: { r: 0, n: 0 }, near: { r: 0, n: 0 }, graduated: { r: 0, n: 0 } };
  for (const t of towers) {
    const stage = newStage(t, ctx);
    if (!stage) continue;
    sums[stage].r += Math.hypot(t.x, t.z);
    sums[stage].n += 1;
  }
  const ring = (stage: NewStage, fallback: number, lo: number, hi: number) => ({
    radius: sums[stage].n ? Math.min(hi, Math.max(lo, sums[stage].r / sums[stage].n)) : fallback,
    count: sums[stage].n,
  });
  // Outside in: the fresh at the edge, the near ones a step in, the graduated where the skyline begins.
  const fresh = ring('fresh', 62, 56, 70);
  const near = ring('near', 50, 44, fresh.radius - 5);
  const graduated = ring('graduated', 34, 22, near.radius - 6);
  return { fresh, near, graduated };
}

/* The viewer's chip, kept per browser. Storage may refuse (a private window): the lens then starts on «All». */
export const LENS_KEY = 'ryntra.city.lens';

export type LensStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readLens(storage: LensStorage | null): LensId {
  try {
    const kept = storage?.getItem(LENS_KEY);
    return (LENSES as readonly string[]).includes(kept ?? '') ? (kept as LensId) : 'all';
  } catch {
    return 'all';
  }
}

export function keepLens(storage: LensStorage | null, id: LensId): void {
  try {
    storage?.setItem(LENS_KEY, id);
  } catch {
    // Refused: the choice lasts for this visit.
  }
}
