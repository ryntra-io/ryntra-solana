/**
 * Which way a private swap goes, and what others see on it. One pure decision for the Swap's «Private»:
 *
 * - **desk** — the desk quotes this pair and this browser can check the desk's leg before the wallet signs: one joint
 *   transfer inside the ring (`joint.ts`). The band is the swap's: both addresses seen (the person and the desk's
 *   one-time address sign it), the coins and the amounts hidden — `bandOf('swap')` in `../exposure.ts`.
 * - **route** — otherwise: out of the ring → the market route → back (`../swap/**`). The band is the route
 *   swap's: all four seen — the trade is on chain; the rest of the balance stays hidden. Its line says so.
 *
 * The band's facts are `exposure.ts`'s, never restated here; this file only says which of its actions stands before the
 * press, and what each step of the desk's swap shows to whom (`DESK_STEPS`), for the PR and the tests.
 */

import { bandOf, type Band, type BandAction, type BandMode, type BandPart, type Shown } from '../exposure.ts';
import { RING_SOL } from '../network.ts';
import type { DeskSetup } from './config.ts';
import { quotesPair, type Pair } from './quote.ts';

/**
 * Why a private swap goes the route's way:
 * - `SHUT` — there is no desk;
 * - `PAIR` — the desk does not quote this pair;
 * - `CHECK` — this build cannot check the desk's leg before the wallet signs (`run.ts`, `deskAbilities`).
 */
export type RouteWhy = 'SHUT' | 'PAIR' | 'CHECK';

export type Way = Readonly<{ way: 'desk' }> | Readonly<{ way: 'route'; why: RouteWhy }>;

const WSOL = 'So11111111111111111111111111111111111111112';

/** A pair in the ring's names: the market's routes call SOL wrapped SOL, the ring calls it by the system program. */
export function ringPair(pair: Pair): Pair {
  const name = (mint: string) => (mint === WSOL ? RING_SOL : mint);
  return { inMint: name(pair.inMint), outMint: name(pair.outMint) };
}

export function chooseWay(input: Readonly<{ desk: DeskSetup; pair: Pair; canCheck: boolean }>): Way {
  if (!input.desk.url || input.desk.pairs.length === 0) return { way: 'route', why: 'SHUT' };
  if (!quotesPair(input.desk.pairs.map(ringPair), ringPair(input.pair))) return { way: 'route', why: 'PAIR' };
  if (!input.canCheck) return { way: 'route', why: 'CHECK' };
  return { way: 'desk' };
}

/** The band's action for a way: the desk's joint transfer, or the route swap. */
export function bandActionOf(way: Way['way']): BandAction {
  return way === 'desk' ? 'swap' : 'routeSwap';
}

/** The band «what others see» before the press — `exposure.ts`'s own, for the way this swap goes. */
export function bandOfWay(way: Way['way'], mode: BandMode = 'private'): Band {
  return bandOf(bandActionOf(way), mode);
}

/** The one line under the band: which of the swap's words it says (`terminal/swap/private-words.ts`). */
export function lineOfWay(way: Way['way']): 'deskSeen' | 'seen' {
  return way === 'desk' ? 'deskSeen' : 'seen';
}

/* ── each step of the desk's swap, and who sees what ──────────────────────────────────────────────────────────────── */

/** Who looks at a step: anyone reading the chain, the desk (the other side of the trade), Helius's proof server. */
export type StepViewer = 'everyone' | 'desk' | 'prover';
export type DeskStep = 'quote' | 'joint' | 'stock';

type Four = Readonly<Record<BandPart, Shown>>;
const ALL: Four = { who: 'seen', to: 'seen', what: 'seen', amount: 'seen' };
const NOTHING: Four = { who: 'hidden', to: 'hidden', what: 'hidden', amount: 'hidden' };
const everyoneOnSwap = (): Four => Object.fromEntries(bandOf('swap').cells.map((c) => [c.part, c.shown])) as Four;

/**
 * - `quote` — off chain: the person asks the desk for a price. The chain sees nothing; the desk sees who asks, the pair
 *   and the amount — it is the other side of the trade; the prover is not asked.
 * - `joint` — the one transaction: everyone sees both addresses and not the coins or the amounts (the swap's band); the
 *   desk sees all four (it pays and is paid); the prover gets each leg whole to prove it (PROBE.md, L2).
 * - `stock` — the desk's own housekeeping, before and after: its ring stocks the one-time address and the address is
 *   swept back. Nothing of the person's is in it; everyone sees the desk's addresses, the coins and amounts are hidden.
 */
export function deskStep(step: DeskStep): Readonly<Record<StepViewer, Four>> {
  if (step === 'quote') return { everyone: NOTHING, desk: ALL, prover: NOTHING };
  if (step === 'joint') return { everyone: everyoneOnSwap(), desk: ALL, prover: ALL };
  return { everyone: { who: 'seen', to: 'seen', what: 'hidden', amount: 'hidden' }, desk: ALL, prover: ALL };
}

export const DESK_STEPS: readonly DeskStep[] = ['quote', 'joint', 'stock'];
