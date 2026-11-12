/**
 * The ranges that ship with the deployment (CITY-238): Ryntra's own training ranges, as `record.mjs` wrote them. The
 * server reads them to build an agent's session; the machine's image carries the same file, so both sides hold the
 * same pins — and a deployment whose ranges differ from its machine's simply gets its runs refused.
 */

import { createRangeStore, type RangeStore } from "./range.ts";
import { RECORDED } from "./recorded.ts";

let store: RangeStore | null = null;

/** The deployment's ranges, made ready once. */
export function catalogue(): RangeStore {
  store ??= createRangeStore(RECORDED);
  return store;
}
