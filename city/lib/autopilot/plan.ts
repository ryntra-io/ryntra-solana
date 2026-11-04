import { BUDGET_PRESET_IDS, BUDGET_PRESETS, type BudgetPresetId } from '../../../lib/mandate/presets.ts';
import { steadyRhythm } from '../../../lib/mandate/strategy.ts';

/**
 * What the agent proposes from the person's words (CITY-175), worked out before anything is signed. Pure, so the tests
 * read it: the budget a day from the amount said, the rhythm the agent keeps, and a launch's name, ticker and picture
 * seed when the person left them to the agent.
 */

/**
 * The budget for a day said in SOL: the largest of the city's budgets that is not more than what was said — never
 * more than the person said. `capped` when she said more than a new agent starts with: the card says the agent starts
 * smaller, and raising it is her own, separate choice later. Null when nothing was said, or less than the smallest.
 */
export function presetFor(perDaySol: string | null, offered: readonly BudgetPresetId[] = BUDGET_PRESET_IDS): Readonly<{ preset: BudgetPresetId | null; capped: boolean }> {
  if (perDaySol === null || !/^\d+(\.\d+)?$/u.test(perDaySol)) return { preset: null, capped: false };
  const said = lamports(perDaySol);
  const fitting = offered.filter((id) => BUDGET_PRESETS[id].perDay <= said);
  const preset = fitting.at(-1) ?? null;
  const largest = BUDGET_PRESETS[offered.at(-1)!].perDay;
  return { preset, capped: said > largest };
}

/** SOL as said, in lamports, rounded down: «0.25» → 250 000 000. */
export function lamports(sol: string): bigint {
  const [whole, fraction = ''] = sol.split('.');
  return BigInt(whole || '0') * 1_000_000_000n + BigInt((fraction + '000000000').slice(0, 9));
}

/** How the agent spends a budget: so many buys a day, this far apart, each this big (SOL). */
export function rhythmOf(id: BudgetPresetId): Readonly<{ buys: number; everyHours: number; perTrade: number; perDay: number; days: number }> {
  const preset = BUDGET_PRESETS[id];
  const { buys, everyMs } = steadyRhythm(preset.perTrade, preset.perDay);
  return { buys, everyHours: Math.round((everyMs / 3_600_000) * 10) / 10, perTrade: Number(preset.perTrade) / 1e9, perDay: Number(preset.perDay) / 1e9, days: preset.days };
}

/* ---------------------------------------------------------------- a launch the agent prepares */

const FIRST = ['Neon', 'Solar', 'Lucky', 'Velvet', 'Turbo', 'Cosmic', 'Golden', 'Midnight', 'Ember', 'Nova', 'Lunar', 'Crystal'] as const;
const SECOND = ['Fox', 'Comet', 'Tiger', 'Koi', 'Owl', 'Lynx', 'Falcon', 'Orca', 'Panda', 'Dragon', 'Raven', 'Wolf'] as const;

/** A launch's fields as the agent proposes them: the person's own words first, the agent's for what was left out. */
export type Proposal = Readonly<{ name: string; symbol: string; seed: number }>;

/** A ticker from a name: one word as it is, or the last word that reads as one (3+ letters), letters and digits, ≤ 6. */
export function tickerFrom(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.replace(/[^A-Za-z0-9]/gu, '').toUpperCase())
    .filter(Boolean);
  if (!words.length) return '';
  const last = [...words].reverse().find((word) => word.length >= 3);
  if (last) return last.slice(0, 6);
  return words.map((word) => word[0]!).join('').slice(0, 6);
}

/** The agent's proposal: `seed` picks the words it fills in; the person's name and ticker, when said, stand as said. */
export function proposal(ask: Readonly<{ name: string | null; symbol: string | null }>, seed: number): Proposal {
  const pick = <T>(list: readonly T[], n: number) => list[((n % list.length) + list.length) % list.length]!;
  const name = ask.name?.trim() || (ask.symbol ? ask.symbol.charAt(0) + ask.symbol.slice(1).toLowerCase() : `${pick(FIRST, seed)} ${pick(SECOND, Math.floor(seed / FIRST.length) + seed)}`);
  const symbol = (ask.symbol?.replace(/[^A-Za-z0-9]/gu, '').toUpperCase().slice(0, 10) || tickerFrom(name) || 'COIN').slice(0, 10);
  return { name: name.slice(0, 32), symbol, seed };
}

/** The picture's colour from the seed: one of the city's warm and cool lights, never the same twice in a row. */
export function emblemHue(seed: number): number {
  const hues = [22, 268, 192, 338, 44, 152, 210, 4];
  return hues[((seed % hues.length) + hues.length) % hues.length]!;
}

/**
 * SOL as the agent's figures say it: small amounts keep their digits (0.0117, 0.312), never rounded up; whole amounts two
 * places. `lang` writes the Ukrainian comma.
 */
export function solText(value: number, lang: 'en' | 'uk'): string {
  const abs = Math.abs(value);
  const places = abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
  const cut = Math.floor(abs * 10 ** places) / 10 ** places;
  const text = cut.toFixed(places).replace(/\.?0+$/u, '') || '0';
  return lang === 'uk' ? text.replace('.', ',') : text;
}
