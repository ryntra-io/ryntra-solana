import { stubAddress } from '../launch/stub.ts';
import type { PulseFetcher } from './new-store.ts';

/**
 * The development stand-in for the engine's Pulse (CITY-142), never in a production bundle: `?launch=stub` in a
 * development build. A made-up market of new launches across the network's launchpads, beside the Launch stub's own
 * coins (the same mints, so its towers and its flows answer for them), so «New», its list and the beacon can be seen
 * without the network. No logos: a made-up coin has none, and a real coin's logo is never put on one.
 */

const MINUTE = 60_000;

type Made = Readonly<{
  seed: string;
  symbol: string;
  name: string;
  pad: string;
  ageMin: number;
  cap: number;
  liquidity: number | null;
  holders: number;
  progress?: number;
  graduatedMin?: number;
  ryntra?: boolean;
}>;

/* The Launch stub's own coins (city/lib/launch/stub.ts): the same seeds, so the same mints. */
const FRESH: readonly Made[] = [
  { seed: 'SPARK', symbol: 'SPARK', name: 'Spark', pad: 'Ryntra', ageMin: 8, cap: 7_900, liquidity: null, holders: 58, ryntra: true },
  { seed: 'KITE', symbol: 'KITE', name: 'Kite', pad: 'Ryntra', ageMin: 42, cap: 21_400, liquidity: null, holders: 37, ryntra: true },
  { seed: 'pulse:frog', symbol: 'FROGGY', name: 'Froggy', pad: 'pump.fun', ageMin: 1, cap: 6_200, liquidity: 3_100, holders: 14 },
  { seed: 'pulse:neon', symbol: 'NEONCAT', name: 'Neon Cat', pad: 'bags.fun', ageMin: 2, cap: 12_800, liquidity: 6_400, holders: 31 },
  { seed: 'pulse:hops', symbol: 'HOPS', name: 'Hops', pad: 'pump.fun', ageMin: 4, cap: 8_700, liquidity: 4_200, holders: 22 },
  { seed: 'pulse:glow', symbol: 'GLOW', name: 'Glow', pad: 'met-dbc', ageMin: 6, cap: 18_300, liquidity: 9_000, holders: 47 },
  { seed: 'pulse:byte', symbol: 'BYTE', name: 'Byte', pad: 'pump.fun', ageMin: 9, cap: 5_400, liquidity: 2_600, holders: 11 },
  { seed: 'pulse:tide', symbol: 'TIDE', name: 'Tide', pad: 'bags.fun', ageMin: 13, cap: 26_900, liquidity: 12_500, holders: 64 },
  { seed: 'pulse:pebl', symbol: 'PEBBLE', name: 'Pebble', pad: 'letsbonk.fun', ageMin: 17, cap: 9_800, liquidity: 4_900, holders: 29 },
  { seed: 'pulse:zest', symbol: 'ZEST', name: 'Zest', pad: 'raydium-launchlab', ageMin: 24, cap: 14_100, liquidity: 7_000, holders: 38 },
  { seed: 'pulse:orbt', symbol: 'ORBIT', name: 'Orbit', pad: 'pump.fun', ageMin: 31, cap: 33_600, liquidity: 15_800, holders: 92 },
  { seed: 'pulse:fern', symbol: 'FERN', name: 'Fern', pad: 'jup-studio', ageMin: 38, cap: 11_200, liquidity: 5_600, holders: 26 },
  { seed: 'pulse:lumo', symbol: 'LUMO', name: 'Lumo', pad: 'pump.fun', ageMin: 47, cap: 7_300, liquidity: 3_500, holders: 19 },
  { seed: 'pulse:quil', symbol: 'QUILL', name: 'Quill', pad: 'bags.fun', ageMin: 55, cap: 16_500, liquidity: 8_100, holders: 41 },
];

const NEAR: readonly Made[] = [
  { seed: 'NOVA', symbol: 'NOVA', name: 'Nova', pad: 'Ryntra', ageMin: 180, cap: 48_600, liquidity: null, holders: 41, progress: 62, ryntra: true },
  { seed: 'pulse:rush', symbol: 'RUSH', name: 'Rush', pad: 'pump.fun', ageMin: 26, cap: 66_800, liquidity: 24_000, holders: 311, progress: 93 },
  { seed: 'pulse:vela', symbol: 'VELA', name: 'Vela', pad: 'pump.fun', ageMin: 49, cap: 61_200, liquidity: 22_100, holders: 268, progress: 86 },
  { seed: 'pulse:okra', symbol: 'OKRA', name: 'Okra', pad: 'bags.fun', ageMin: 72, cap: 55_900, liquidity: 20_400, holders: 205, progress: 77 },
  { seed: 'pulse:nimb', symbol: 'NIMBUS', name: 'Nimbus', pad: 'raydium-launchlab', ageMin: 95, cap: 47_300, liquidity: 17_900, holders: 166, progress: 68 },
  { seed: 'pulse:cove', symbol: 'COVE', name: 'Cove', pad: 'met-dbc', ageMin: 130, cap: 41_000, liquidity: 15_200, holders: 133, progress: 54 },
  { seed: 'pulse:dart', symbol: 'DART', name: 'Dart', pad: 'pump.fun', ageMin: 160, cap: 36_400, liquidity: 13_600, holders: 117, progress: 41 },
  { seed: 'pulse:ember', symbol: 'EMBER', name: 'Ember', pad: 'letsbonk.fun', ageMin: 210, cap: 32_700, liquidity: 12_100, holders: 98, progress: 33 },
];

const GRADUATED: readonly Made[] = [
  { seed: 'pulse:apex', symbol: 'APEX', name: 'Apex', pad: 'pump.fun', ageMin: 70, cap: 142_000, liquidity: 41_000, holders: 812, graduatedMin: 4 },
  { seed: 'pulse:sail', symbol: 'SAIL', name: 'Sail', pad: 'bags.fun', ageMin: 150, cap: 96_400, liquidity: 30_200, holders: 540, graduatedMin: 18 },
  { seed: 'pulse:halo', symbol: 'HALO', name: 'Halo', pad: 'met-dbc', ageMin: 260, cap: 231_000, liquidity: 64_000, holders: 1_204, graduatedMin: 63 },
  { seed: 'pulse:root', symbol: 'ROOT', name: 'Root', pad: 'letsbonk.fun', ageMin: 400, cap: 78_900, liquidity: 26_300, holders: 433, graduatedMin: 190 },
  { seed: 'pulse:jolt', symbol: 'JOLT', name: 'Jolt', pad: 'pump.fun', ageMin: 700, cap: 384_000, liquidity: 92_000, holders: 2_077, graduatedMin: 540 },
];

const PADS: Readonly<Record<string, string>> = { 'pump.fun': 'pump.fun', 'met-dbc': 'Meteora', 'letsbonk.fun': 'bonk.fun', 'raydium-launchlab': 'LaunchLab', 'jup-studio': 'Jupiter Studio' };

function rowOf(made: Made, now: number) {
  const born = new Date(now - made.ageMin * MINUTE).toISOString();
  const window = (changePct: number, volumeUsd: number) => ({ changePct, volumeUsd, holdersChangePct: null });
  return {
    mint: stubAddress(made.seed),
    symbol: made.symbol,
    name: made.name,
    icon: null,
    launchpad: PADS[made.pad] ?? made.pad,
    venue: null,
    graduated: made.graduatedMin !== undefined,
    price: made.cap / 1e9,
    marketCapUsd: made.cap,
    liquidityUsd: made.liquidity,
    holders: made.holders,
    holdersAtLeast: false,
    windows: { m5: window(4.2, made.cap / 40), h1: window(18.5, made.cap / 6), h6: window(31, made.cap / 2), h24: window(44, made.cap) },
    firstPoolAt: born,
    graduatedAt: made.graduatedMin === undefined ? null : new Date(now - made.graduatedMin * MINUTE).toISOString(),
    curve: made.progress === undefined ? null : { venue: 'pump', progressPct: made.progress, complete: false },
    verified: false,
    ryntra: made.ryntra ? { preset: 'classic', technicalValidation: false, launchedAt: born, traded24h: true, daysSinceDex: null, dollarPair: true } : null,
  };
}

/** The stand's Pulse: the three feeds the rings read, in the engine's order — Ryntra's own first, as the engine puts them. */
export function stubPulse(options: Readonly<{ delayMs?: number; now?: () => number }> = {}): PulseFetcher {
  const now = options.now ?? Date.now;
  return async (url) => {
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 350));
    const feed = new URL(url, 'https://ryntra.io').searchParams.get('feed');
    const made = feed === 'new' ? FRESH : feed === 'soon' ? NEAR : feed === 'dex' ? GRADUATED : null;
    if (!made) return { ok: false, json: async () => ({ error: { code: 'VALIDATION_ERROR' } }) };
    const rows = made.map((one) => rowOf(one, now()));
    return { ok: true, json: async () => ({ feed, window: 'h1', mode: 'all', rows, observedAt: new Date(now()).toISOString(), stale: false, partial: false, sources: ['jupiter', 'chain', 'ryntra'] }) };
  };
}
