/**
 * Whether Meteora DLMM Pro is open to people in Ryntra: it is not.
 *
 * The venue is in the engine — it reads pools, quotes and builds unsigned transactions, and its whole path was
 * rehearsed on the program's own binary without touching mainnet
 * (docs/research/meteora-dlmm-pro-2026-11-14/results/REHEARSAL.md). Nothing reaches it but its own rehearsal and the
 * surfaces that stand on it, each a folder of the engine behind a gate of its own: ./sdk.test.mjs names them and
 * holds that no route, no window of the city and no agent tool imports the venue any other way.
 *
 * Opening it is not a switch here. Each surface that will stand on it — a launch, limit orders,
 * earning and an agent's care — opens with its own gate, its own pass on devnet. The first of them, earning, is served on devnet where a deployment asks
 * (`lib/earn-pro/gate.ts`, `DLMM_PRO_EARN_ON_MAINNET` below); on mainnet it is closed.
 *
 * Pure: no I/O, no clock, no environment.
 */

/** No surface for people stands on this venue yet. A constant, not a flag: nothing in a deployment can flip it. */
export const DLMM_PRO_OPEN_TO_PEOPLE = false;

/**
 * Limit orders are the first surface with a gate of its own: `lib/pro-limits/gate.ts`. Its routes and its
 * window answer only where a deployment's switch names a network — and on mainnet only where this constant says so
 * too. No switch of a deployment opens mainnet. Devnet's test
 * money opens by the switch alone.
 */
export const DLMM_PRO_LIMITS_MAINNET = false;

/**
 * Earning and an agent's care — a surface that stands on the venue through named doors: `lib/earn-pro/` behind
 * `/api/v1/earn/pro/**`, and the Piers of the city's Earn window. It is served on devnet where a deployment asks for it
 * (`RYNTRA_EARN_PRO=devnet`), and on mainnet only when this reads true. A constant: nothing in a deployment can flip it.
 */
export const DLMM_PRO_EARN_ON_MAINNET = false;

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
