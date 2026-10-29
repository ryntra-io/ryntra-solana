/**
 * The header a Launch read answers with when its answer is the first of two (SOL-P1): what the newest page of the
 * history did not reach is said as not read yet, and the full read is under way — the page asks again in a moment.
 * Shared by the route and the page that reads it; not part of the contract's body, so no client is broken by it.
 */
export const LAUNCH_READ_HEADER = "x-ryntra-read";
