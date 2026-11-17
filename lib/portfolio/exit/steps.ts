/**
 * The words an exit's package is told in, apart from the code that builds it, so that the contract and a
 * screen can name them without loading a builder. Pure.
 */

/**
 * What a transaction of the package is: a position left (`leave`), its fees and rewards collected (`collect`), a stake
 * account's step (`stake`), a coin of the wallet swapped (`swap`), what arrived swapped into the target (`sweep`).
 */
export const EXIT_STEP_KINDS = ["leave", "collect", "stake", "swap", "sweep"] as const;
export type ExitStepKind = (typeof EXIT_STEP_KINDS)[number];

/**
 * Why something picked is not in the package, or a coin that arrives is not swapped — as the screen words it:
 *
 * - `CLOSED_HERE` — the engine's own surface for this protocol is closed on this deployment;
 * - `NOTHING_TO_DO` — the position holds nothing to take now;
 * - `NO_ROUTE` — no swap carries this coin now;
 * - `NO_PRICE` — the coin has no price to hold its swap to;
 * - `TOO_SMALL` — less than a swap carries;
 * - `PAUSED` — swapping is paused;
 * - `REFUSED` — the bytes built are not the action reviewed;
 * - `SIMULATION_FAILED` — the network would refuse the transaction now;
 * - `NO_ROOM` — it did not fit this approval: one more takes it;
 * - `UNAVAILABLE` — the chain or the provider did not answer.
 */
export const EXIT_SKIP_REASONS = ["CLOSED_HERE", "NOTHING_TO_DO", "NO_ROUTE", "NO_PRICE", "TOO_SMALL", "PAUSED", "REFUSED", "SIMULATION_FAILED", "NO_ROOM", "UNAVAILABLE"] as const;
export type ExitSkipReason = (typeof EXIT_SKIP_REASONS)[number];

/** Where a transaction of a relay stands: landed, failed on chain, sent with no clear answer yet, or never sent. */
export const EXIT_RELAY_STATES = ["LANDED", "FAILED", "UNKNOWN", "NOT_SENT"] as const;
export type ExitRelayState = (typeof EXIT_RELAY_STATES)[number];
