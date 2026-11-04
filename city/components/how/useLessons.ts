'use client';

import { useMemo } from 'react';
import { CITY_GUIDE_FLAGS, lessons, type Lesson } from '@/city/lib/how/guides';
import { launchOpenHere, useLaunch } from '@/city/lib/launch/district';

/**
 * The lessons the city shows right now (CITY-43): a live function with its film. Launch counts as the city counts it —
 * on the network the engine serves — so a devnet stand shows its lesson where its sheet opens. None: the menu has no
 * row and there is no window, never an empty one.
 */
export function useLessons(): readonly Lesson[] {
  const launch = useLaunch(launchOpenHere);
  return useMemo(() => lessons({ ...CITY_GUIDE_FLAGS, launch }), [launch]);
}
