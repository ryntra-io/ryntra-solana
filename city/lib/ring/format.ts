import type { Archetype, RatingView, RingFormat, Weight } from '../../../lib/ring/contract.ts';
import { scenarioText } from '../../../lib/ring/agent.ts';
import { WEIGHT_BOUNDS } from '../../../lib/ring/weight.ts';
import { digits, wordsNow } from '../i18n/dict.ts';
import { BODIES } from './body.ts';
import { RING } from './words.ts';

/**
 * The Ring's figures as the city writes them: dollars from micro-dollars, the classes and formats by name, a rating with
 * its interval. Pure, so every line is tested.
 */

/** The names in the language on screen: each one is read when it is shown. */
export const WEIGHT_NAMES: Readonly<Record<Weight, string>> = {
  get light() {
    return wordsNow(RING).light;
  },
  get middle() {
    return wordsNow(RING).middle;
  },
  get heavy() {
    return wordsNow(RING).heavy;
  },
};

export const FORMAT_NAMES: Readonly<Record<RingFormat, string>> = {
  get 'duo-crack'() {
    return wordsNow(RING).duoCrack;
  },
  get code() {
    return wordsNow(RING).code;
  },
  get 'market-replay'() {
    return wordsNow(RING).marketReplay;
  },
};

/**
 * A brain's name as a person reads it (CITY-236): the catalog's «Google: Gemma 4 26B A4B (free)» without the maker in
 * front and the catalog's own marks in brackets at the end — «Gemma 4 26B A4B». On a phone the whole of the catalog's
 * name did not fit a line and was cut mid-word. The catalog's name stays one tap away, behind «i», where a brain is
 * picked. A name that would be left empty is kept as it is.
 */
export function brainLabel(name: string): string {
  const whole = name.replace(/\s+/g, ' ').trim();
  let label = whole.replace(/^[^:()]{1,40}:\s+/, '');
  for (let before = ''; before !== label; ) {
    before = label;
    label = label.replace(/\s*\([^()]*\)$/, '');
  }
  return label.trim() || whole;
}

/**
 * What the catalog adds to a name in brackets at its end — «free», «batch», «2024-11-20» — without the brackets, or an
 * empty string. The list of brains says it, quietly, only beside a name that stands in the list twice: «GPT-4o» and
 * «GPT-4o · batch» are two brains with two prices.
 */
export function brainMark(name: string): string {
  const marks: string[] = [];
  let rest = name.replace(/\s+/g, ' ').trim();
  for (let found = /\s*\(([^()]*)\)$/.exec(rest); found; found = /\s*\(([^()]*)\)$/.exec(rest)) {
    if (found[1]!.trim()) marks.unshift(found[1]!.trim());
    rest = rest.slice(0, found.index);
  }
  return marks.join(' · ');
}

/** The catalog's marks a row of the list never says as words (CITY-239). */
const UNSAID: ReadonlySet<string> = new Set(['free', 'batch']);

/**
 * The mark a row of the list shows beside a name that stands in it twice (CITY-239): the catalog's own, without its raw
 * English words. «free» is already said by the row's price — «Free a match», in the language on screen — and a «batch»
 * twin is not offered at all (`lib/ring/models.ts`); a date or a size («2024-11-20», «8B») is the same in any language
 * and stays. The catalog's whole name is one tap away, behind «i», once the brain is picked.
 */
export function listMark(name: string): string {
  return brainMark(name)
    .split(' · ')
    .filter((mark) => mark && !UNSAID.has(mark.toLowerCase()))
    .join(' · ');
}

/**
 * A brain as its catalog names it, behind «i» (CITY-240): the whole name — the maker in front, a date or a size in its
 * brackets — without the catalog's raw «(free)» and «(batch)». The line above it already says «Free a match» in the
 * language on screen, and a Ukrainian reader met an English «(free)» in the middle of it. One rule for both languages:
 * the name is the model's, not its price. A name that would be left empty is kept as it is.
 */
export function catalogName(name: string): string {
  const whole = name.replace(/\s+/g, ' ').trim();
  const kept: string[] = [];
  let rest = whole;
  for (let found = /\s*\(([^()]*)\)$/.exec(rest); found; found = /\s*\(([^()]*)\)$/.exec(rest)) {
    const mark = found[1]!.trim();
    if (mark && !UNSAID.has(mark.toLowerCase())) kept.unshift(`(${mark})`);
    rest = rest.slice(0, found.index);
  }
  return rest.trim() ? [rest.trim(), ...kept].join(' ') : whole;
}

/** The names that stand for more than one brain of the list once the maker and the marks are left out. */
export function twinLabels(names: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const twins = new Set<string>();
  for (const name of names) {
    const label = brainLabel(name);
    if (seen.has(label)) twins.add(label);
    seen.add(label);
  }
  return twins;
}

/** The maker a catalog name starts with — «Cohere» of «Cohere: Command R» — or an empty string. */
function makerOf(name: string): string {
  return /^([^:()]{1,40}):\s+/.exec(name.replace(/\s+/g, ' ').trim())?.[1]?.trim() ?? '';
}

/**
 * The mark of every brain whose shortened name stands for more than one (CITY-240), by the brain's id. Two brains of
 * one name must read apart wherever they are named — in the list and, once picked, in the line that says what is being
 * made: «Command R (08-2024)» and «Command R» both read «Command R» there. A twin keeps its catalog's mark, a date or a
 * size (`listMark`); two that still read the same on a row — one name, one mark, one price — take their makers' names
 * when those differ. A free twin needs no word: its row's price says «Free a match», in the language on screen.
 */
export function twinMarks(brains: readonly Readonly<{ id: string; name: string; matchMicroUsd: number }>[]): ReadonlyMap<string, string> {
  const groups = new Map<string, Readonly<{ id: string; name: string; matchMicroUsd: number }>[]>();
  for (const brain of brains) {
    const label = brainLabel(brain.name);
    const group = groups.get(label);
    if (group) group.push(brain);
    else groups.set(label, [brain]);
  }
  const marks = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const brain of group) marks.set(brain.id, listMark(brain.name));
    const reads = (brain: (typeof group)[number]) => `${marks.get(brain.id)}|${perMatch(brain.matchMicroUsd)}`;
    const alike = group.filter((brain) => group.some((other) => other !== brain && reads(other) === reads(brain)));
    if (new Set(alike.map((brain) => makerOf(brain.name))).size < 2) continue;
    for (const brain of alike) marks.set(brain.id, [makerOf(brain.name), marks.get(brain.id)].filter(Boolean).join(' · '));
  }
  return marks;
}

/** A brain named in a line of words: its short name, and its twin's mark in the catalog's own brackets — «Command R (08-2024)». */
export function brainNamed(name: string, mark = ''): string {
  const label = brainLabel(name);
  return mark ? `${label} (${mark})` : label;
}

/** Dollars from micro-dollars: `Free`, `<$0.01`, `$0.17`, `$12` — for the eye, in the language on screen. */
export function usd(micro: number): string {
  if (!Number.isFinite(micro) || micro < 0) return '—';
  if (micro === 0) return wordsNow(RING).free;
  if (micro < 10_000) return digits('<$0.01');
  const dollars = micro / 1_000_000;
  return digits(dollars < 10 ? `$${dollars.toFixed(2)}` : `$${Math.round(dollars)}`);
}

/** What one standard match costs one agent. */
export const perMatch = (micro: number) => (micro === 0 ? wordsNow(RING).freeMatch : wordsNow(RING).aMatch(usd(micro)));

/** A class's span of match prices, from the server's own bounds. */
export function classSpan(weight: Weight): string {
  if (weight === 'light') return wordsNow(RING).under(usd(WEIGHT_BOUNDS.light));
  if (weight === 'middle') return `${usd(WEIGHT_BOUNDS.light)}–${usd(WEIGHT_BOUNDS.middle).slice(1)}`;
  return `${usd(WEIGHT_BOUNDS.middle)}–${usd(WEIGHT_BOUNDS.heavy).slice(1)}`;
}

/** Dollars per 1M tokens, in and out: `$3 / $15`, `$0.25 / $1.25`. */
export function perMillion(input: number, output: number): string {
  const one = (value: number) => (value === 0 ? '$0' : value >= 10 || Number.isInteger(value) ? `$${Number(value.toFixed(2))}` : `$${value.toFixed(2)}`);
  return `${one(input)} / ${one(output)}`;
}

/** A rating and its 95 % interval: `1200 ±686`. */
export const ratingLine = (r: RatingView) => `${r.rating} ±${Math.round((r.high - r.low) / 2)}`;

/** Joins without a visible mark: a line never breaks inside a score. */
const JOIN = '\u2060';

/** Games so far, said plainly: `No games yet`, `1 game`, `14 games · 9–1–4` (wins, draws, losses; never broken across lines). */
export function gamesLine(r: RatingView): string {
  const w = wordsNow(RING);
  if (r.games === 0) return w.noGames;
  if (r.games === 1) return w.oneGame;
  return w.games(r.games, [r.wins, r.draws, r.losses].join(`${JOIN}–${JOIN}`));
}

/** A script's length as the server counts it: code points of the text it keeps (`scenarioText`). */
export const charCount = (text: string) => [...scenarioText(text)].length;

/**
 * An agent's name in the language on screen: its body's name («Fighter» → «Боєць»), never a piece of its id (review
 * 8.11) — whose agent it is shows by the «You» beside it, a rival by its corner. Nothing typed by anyone.
 */
export function agentLabel(archetype: Archetype): string {
  return BODIES[archetype].name;
}
