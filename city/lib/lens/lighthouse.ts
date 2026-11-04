import type { NewLaunch, Rings } from './launches.ts';
import { STAGES } from './launches.ts';

/**
 * «Маяк» (CITY-142, launch strategy §8): the one new coin that is hot right now, by people, not by money — the most
 * different wallets that bought above the minimum buy, the wallets one source funded counted once. The count is the
 * engine's flow of the launch (CITY-140, `GET /api/v1/launch/{mint}/flow` → `buyers.independent`), read only. Nothing
 * else ranks a coin here: no market cap, no volume, no place for sale, no hand. A coin whose buyers the engine did not
 * count is not ranked — never ranked on a guess — and Ryntra's own technical launches never wear the beacon.
 */

/** The fewest independent buyers that make a coin the beacon: one or two wallets are not a crowd. */
export const LIGHTHOUSE_MIN = 3;
/** The flows read for the beacon at most, the launches nearest their DEX first: each is a read of the chain. */
export const FLOW_READS_MAX = 4;

export type BuyerCount = Readonly<{
  /** Different wallets above the floor, each funding cluster once. */
  independent: number;
  /** A floor: some starts or trades were not read. */
  atLeast: boolean;
  /** The minimum buy counted, in dollars; null on a pair that is not a dollar. */
  floorUsd: number | null;
}>;

export type Lighthouse = Readonly<{ mint: string; independent: number; atLeast: boolean; floorUsd: number | null; stage: NewLaunch['stage'] }>;

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);

/** The buyers of a flow answer, or null when it is not one. */
export function buyersOf(body: unknown): BuyerCount | null {
  const flow = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const buyers = flow?.buyers && typeof flow.buyers === 'object' ? (flow.buyers as Record<string, unknown>) : null;
  const independent = count(buyers?.independent);
  if (!buyers || independent === null) return null;
  const rules = flow?.rules && typeof flow.rules === 'object' ? (flow.rules as Record<string, unknown>) : null;
  const floor = rules?.floorUsd;
  return { independent, atLeast: buyers.atLeast === true, floorUsd: typeof floor === 'number' && Number.isFinite(floor) && floor >= 0 ? floor : null };
}

/** The launches whose buyers the engine can count — Ryntra's own, not its technical ones — the ones nearest their DEX first. */
export function flowCandidates(rings: Rings, max = FLOW_READS_MAX): string[] {
  const order: readonly NewLaunch['stage'][] = ['near', 'fresh', 'graduated'];
  const out: string[] = [];
  for (const stage of order) for (const launch of rings[stage]) if (launch.ryntra && !launch.test && out.length < max && !out.includes(launch.mint)) out.push(launch.mint);
  return out;
}

/**
 * The beacon among the rings: the most independent buyers, at least {@link LIGHTHOUSE_MIN}; between equals, the younger
 * coin, then the mint — the same answer on every device. Null when no coin is counted that high.
 */
export function lighthouseOf(rings: Rings, counts: ReadonlyMap<string, BuyerCount>): Lighthouse | null {
  let best: { launch: NewLaunch; count: BuyerCount } | null = null;
  for (const stage of STAGES) {
    for (const launch of rings[stage]) {
      const counted = counts.get(launch.mint);
      if (!counted || launch.test || counted.independent < LIGHTHOUSE_MIN) continue;
      if (
        !best ||
        counted.independent > best.count.independent ||
        (counted.independent === best.count.independent && ((launch.bornAt ?? 0) > (best.launch.bornAt ?? 0) || ((launch.bornAt ?? 0) === (best.launch.bornAt ?? 0) && launch.mint < best.launch.mint)))
      )
        best = { launch, count: counted };
    }
  }
  return best ? { mint: best.launch.mint, independent: best.count.independent, atLeast: best.count.atLeast, floorUsd: best.count.floorUsd, stage: best.launch.stage } : null;
}
