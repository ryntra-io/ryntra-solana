import type { RatingView, RingFormat, Weight } from '../../../lib/ring/contract.ts';
import { scenarioText } from '../../../lib/ring/agent.ts';
import { WEIGHT_BOUNDS } from '../../../lib/ring/weight.ts';
import { digits, wordsNow } from '../i18n/dict.ts';
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
