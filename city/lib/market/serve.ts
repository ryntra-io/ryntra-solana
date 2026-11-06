import type { CitySnapshot } from './types.ts';

/**
 * What `/api/city` answers (CITY-200). The route is regenerated at the edge once a minute (`revalidate = 60`); a
 * regeneration whose Jupiter read failed (a 429 on the shared key) used to store the bundled skyline as the next
 * minute's answer, so every visitor saw «Delayed 15:55» — the bundle's afternoon — until a later read came through.
 * Now a failed read answers with the last live city this server read while it is recent; with none, it refuses, and
 * the edge keeps serving the last live city it holds. Only the build, which has nothing before it, takes the bundle.
 */

/** A live city older than this is not served in place of a fresh read. */
export const LAST_GOOD_MS = 15 * 60_000;

export type CityAnswer = Readonly<{ body: CitySnapshot; keep: CitySnapshot | null }> | Readonly<{ body: null; keep: CitySnapshot | null }>;

export function cityAnswer(live: CitySnapshot | null, kept: CitySnapshot | null, bundled: CitySnapshot, now: number, building: boolean): CityAnswer {
  if (live) return { body: live, keep: live };
  const at = kept ? Date.parse(kept.fetchedAt) : Number.NaN;
  if (kept && Number.isFinite(at) && now - at <= LAST_GOOD_MS) return { body: kept, keep: kept };
  return building ? { body: bundled, keep: kept } : { body: null, keep: kept };
}
