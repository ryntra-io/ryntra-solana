import data from './snapshot.json';
import type { CitySnapshot } from './types.ts';

/** The city as last read into the repository: the first frame paints it while the live read is on its way. */
export const BUNDLED_CITY = data as CitySnapshot;
