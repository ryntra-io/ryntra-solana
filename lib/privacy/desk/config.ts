/**
 * Until the owner names who makes the market and whose coins sit in the ring behind it, there is
 * no desk to ask: the Swap's «Private» goes the route's way (`lib/privacy/swap/**`) with its honest line.
 *
 * - `DESK_URL` — where the browser asks the desk for a quote and hands it its leg (`link.ts`). Null: no desk.
 * - `DESK_PAIRS` — the pairs the desk quotes. Empty: none.
 *
 * The desk's spread, its smallest trade and its middle price come with the desk itself, from the one who runs it; the
 * devnet probe brings its own (`scripts/privacy/desk-probe.mjs`). The private balance's switch (`../network.ts`) opens no
 * desk on any network: without these two the desk stays shut wherever the private balance runs.
 */

import type { Pair } from './quote.ts';

export const DESK_URL: string | null = null;
export const DESK_PAIRS: readonly Pair[] = [];

/** The desk as the Swap's toggle sees it. */
export type DeskSetup = Readonly<{ url: string | null; pairs: readonly Pair[] }>;

export const DESK: DeskSetup = { url: DESK_URL, pairs: DESK_PAIRS };
