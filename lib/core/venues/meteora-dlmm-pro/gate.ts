/**
 * Whether Meteora DLMM Pro is open to people in Ryntra: it is not.
 *
 * The venue is in the engine — it reads pools, quotes and builds unsigned transactions, and its whole path was
 * rehearsed on the program's own binary without touching mainnet
 * (`docs/research/meteora-dlmm-pro-2026-11-14/results/REHEARSAL.md`). No route serves it, no window of the city shows
 * it, and no agent tool reaches it: `./sdk.test.mjs` holds that nothing outside this folder and its rehearsal imports
 * it.
 *
 * Opening it is not a switch here. Each surface that will stand on it — a launch, limit orders,
 * earning and an agent's care — opens with its own gate, its own pass on devnet. Until one of them does, `DLMM_PRO_OPEN_TO_PEOPLE` stays false and the
 * capability registry (`../../capabilities.ts`) reads `BUILDING`.
 *
 * Pure: no I/O, no clock, no environment.
 */

/** No surface for people stands on this venue yet. A constant, not a flag: nothing in a deployment can flip it. */
export const DLMM_PRO_OPEN_TO_PEOPLE = false;

/** What the venue can do in the engine, as the registry's capabilities name them. */
export const DLMM_PRO_CAPABILITIES = ["swap", "launch", "liquidity", "limit"] as const;

/** The honest state of the venue for a reader: built, rehearsed, closed. */
export const DLMM_PRO_STATE = Object.freeze({
  venue: "meteora-dlmm-pro",
  state: "BUILDING",
  openToPeople: DLMM_PRO_OPEN_TO_PEOPLE,
  network: "none",
  rehearsed: "LiteSVM, the program's own binary; no mainnet write",
} as const);
