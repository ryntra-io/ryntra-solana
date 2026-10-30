import { NOT_MEASURED } from '../../../lib/world/text-safety/measured.ts';
import { digits, wordsNow } from '../i18n/dict.ts';
import { langNow } from '../i18n/lang.ts';
import { isNamed, towerFigure, type District, type Tower } from '../market/types.ts';
import { AGENT_RULE } from './words.ts';

/**
 * The scout's rule, put together from fixed choices only: what move to look for, how much liquidity a coin needs,
 * where in the city, and after how much a week of the person's own trades from its finds it pauses. There is no free text
 * anywhere in it, so a typo can never become an amount.
 */

export type Signal = 'rise1h' | 'rise24h' | 'dip24h';
export type Area = Exclude<District, 'docks'> | 'any';

export type Rule = Readonly<{
  signal: Signal;
  /** The size of the move, in percent: a rise of at least this, or a drop of at least this. */
  move: number;
  /** The least liquidity a coin needs, in US dollars. */
  liquidity: number;
  area: Area;
  /**
   * The scout pauses once the person's buys from its finds add up to this in seven days, in US dollars. A pause rule,
   * not a spending cap: only buys paid in SOL or USDC within 30 minutes of a find are counted, and the trade card's own
   * amounts are not limited by it.
   */
  budget: number;
}>;

/** A signal: its name in the language on screen (read each time it is shown), its window and the moves it offers. */
const signal = (id: Signal, window: '1H' | '24H', moves: readonly number[]) => ({
  get label() {
    return wordsNow(AGENT_RULE)[id];
  },
  window,
  moves,
});

export const SIGNALS: Readonly<Record<Signal, Readonly<{ label: string; window: '1H' | '24H'; moves: readonly number[] }>>> = {
  rise1h: signal('rise1h', '1H', [2, 5, 10]),
  rise24h: signal('rise24h', '24H', [5, 10, 25]),
  dip24h: signal('dip24h', '24H', [5, 10, 20]),
};

/** A window as the city says it: «1H» · «1 год». */
export const windowText = (window: '1H' | '24H'): string => (window === '1H' ? wordsNow(AGENT_RULE).window1h : wordsNow(AGENT_RULE).window24h);
export const SIGNAL_ORDER: readonly Signal[] = ['rise1h', 'rise24h', 'dip24h'];
export const LIQUIDITY: readonly number[] = [50_000, 250_000, 1_000_000, 10_000_000];
export const AREAS: Readonly<Record<Area, string>> = {
  get any() {
    return wordsNow(AGENT_RULE).any;
  },
  get core() {
    return wordsNow(AGENT_RULE).core;
  },
  get heights() {
    return wordsNow(AGENT_RULE).heights;
  },
  get strip() {
    return wordsNow(AGENT_RULE).strip;
  },
  get avenue() {
    return wordsNow(AGENT_RULE).avenue;
  },
};
export const AREA_ORDER: readonly Area[] = ['any', 'core', 'heights', 'strip', 'avenue'];
export const BUDGETS: readonly number[] = [50, 100, 250, 500];

export const DEFAULT_RULE: Rule = { signal: 'rise1h', move: 5, liquidity: 250_000, area: 'any', budget: 100 };

/**
 * The floors every find must clear whatever the rule says: activity that looks human and enough people trading it,
 * the same bar the city's own trends use. Launch Docks pools are never brought: they are unverified.
 */
export const MIN_ORGANIC = 30;
export const MIN_TRADERS_1H = 25;

/** A rule read back from storage or anywhere else: every field must be one of the offered choices, or the default. */
export function readRule(raw: unknown): Rule {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const signal = SIGNAL_ORDER.includes(r.signal as Signal) ? (r.signal as Signal) : DEFAULT_RULE.signal;
  const moves = SIGNALS[signal].moves;
  const move = moves.includes(r.move as number) ? (r.move as number) : moves.includes(DEFAULT_RULE.move) ? DEFAULT_RULE.move : moves[0]!;
  const liquidity = LIQUIDITY.includes(r.liquidity as number) ? (r.liquidity as number) : DEFAULT_RULE.liquidity;
  const area = AREA_ORDER.includes(r.area as Area) ? (r.area as Area) : DEFAULT_RULE.area;
  const budget = BUDGETS.includes(r.budget as number) ? (r.budget as number) : DEFAULT_RULE.budget;
  return { signal, move, liquidity, area, budget };
}

/** A new signal keeps the move when it is offered there too, otherwise takes the signal's middle choice. */
export function withSignal(rule: Rule, signal: Signal): Rule {
  const moves = SIGNALS[signal].moves;
  return { ...rule, signal, move: moves.includes(rule.move) ? rule.move : moves[1] ?? moves[0]! };
}

/** The coin's move in the rule's window, signed so that a bigger number is always a stronger match. */
function moveOf(tower: Tower, signal: Signal): number {
  switch (signal) {
    case 'rise1h':
      return tower.change1h;
    case 'rise24h':
      return tower.change24h;
    case 'dip24h':
      return -tower.change24h;
  }
}

/** Why a coin was left out, or null when it fits the rule. */
export function miss(tower: Tower, rule: Rule): 'unverified' | 'area' | 'liquidity' | 'organic' | 'traders' | 'move' | null {
  if (!isNamed(tower) || tower.district === 'docks') return 'unverified';
  if (rule.area !== 'any' && tower.district !== rule.area) return 'area';
  if (!(tower.liquidity >= rule.liquidity)) return 'liquidity';
  if (!(tower.organic >= MIN_ORGANIC)) return 'organic';
  if (!(tower.traders1h >= MIN_TRADERS_1H)) return 'traders';
  if (!(moveOf(tower, rule.signal) >= rule.move)) return 'move';
  return null;
}

export const fits = (tower: Tower, rule: Rule): boolean => miss(tower, rule) === null;

/** How strong a match is: the move, weighted by how many people made it, so one wallet's spike ranks low. */
export function strength(tower: Tower, rule: Rule): number {
  return moveOf(tower, rule.signal) * Math.log10(10 + tower.traders1h);
}

/** Every coin that fits, strongest first; ties go to the deeper pool. */
export function matches(towers: readonly Tower[], rule: Rule): Tower[] {
  return towers
    .filter((t) => fits(t, rule))
    .sort((a, b) => strength(b, rule) - strength(a, rule) || b.liquidity - a.liquidity || a.id.localeCompare(b.id));
}

/** One line of «why this tower»: a figure from the city's data, its window, and the rule it passed. */
export type Fact = Readonly<{ label: string; value: string; note: string }>;

/**
 * Why this tower: four short lines, each a real figure from the city's read and its window, beside the bar it cleared.
 * Written in English, as the question to Ryntra carries them; the card shows them in the language on screen
 * (`factShown`).
 */
export function explain(tower: Tower, rule: Rule): Fact[] {
  const s = SIGNALS[rule.signal];
  /* A figure the source did not measure reads «Not measured», never a zero (CITY-73). */
  return [
    { label: `Move ${s.window}`, value: towerFigure(tower, rule.signal === 'rise1h' ? 'change1h' : 'change24h', signed, 'en'), note: rule.signal === 'dip24h' ? `≤ −${rule.move}%` : `≥ +${rule.move}%` },
    { label: 'Liquidity', value: towerFigure(tower, 'liquidity', usd, 'en'), note: `≥ ${usd(rule.liquidity)}` },
    { label: 'Traders 1H', value: towerFigure(tower, 'traders1h', count, 'en'), note: `≥ ${MIN_TRADERS_1H}` },
    { label: 'Organic', value: towerFigure(tower, 'organic', (v) => `${Math.round(v)}/100`, 'en'), note: `≥ ${MIN_ORGANIC}` },
  ];
}

/** A fact of a find as the card shows it: its label, figure and bar in the language on screen. */
export function factShown(fact: Fact): Fact {
  const w = wordsNow(AGENT_RULE);
  const label =
    fact.label === 'Move 1H' ? w.move(w.window1h) : fact.label === 'Move 24H' ? w.move(w.window24h) : fact.label === 'Liquidity' ? w.liquidity : fact.label === 'Traders 1H' ? w.traders1h : fact.label === 'Organic' ? w.organic : fact.label;
  const value = fact.value === NOT_MEASURED.en ? NOT_MEASURED[langNow()] : digits(fact.value);
  return { label, value, note: digits(fact.note) };
}

/** The rule in one line, as the scout's card says it. */
export function ruleLine(rule: Rule): string {
  const w = wordsNow(AGENT_RULE);
  const s = SIGNALS[rule.signal];
  const move = rule.signal === 'dip24h' ? `−${rule.move}%` : `+${rule.move}%`;
  const where = rule.area === 'any' ? '' : w.inArea(AREAS[rule.area]);
  return w.ruleLine(s.label, move, where, digits(usd(rule.liquidity)), digits(usd(rule.budget)));
}

export function usd(v: number): string {
  if (v >= 1e9) return `$${trim(v / 1e9)}B`;
  if (v >= 1e6) return `$${trim(v / 1e6)}M`;
  if (v >= 1e4) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

const trim = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ''));
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const count = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : `${Math.round(v)}`);
