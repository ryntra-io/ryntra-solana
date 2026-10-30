import { langNow, type Lang } from './lang.ts';

/**
 * Figures for the eye without the machine's habits (CITY-150, the operator's pass on the Seeker of 29.10: «1,2e-7 BTC»,
 * «0,099796891 SOL»): never an exponent, and no more places than the figure needs — at most `places` after the point
 * from one up, and `significant` figures after the leading zeros below one. Written the English way (a point); the
 * language on screen comes after, through `digits`.
 */

export type FigureShape = Readonly<{ places?: number; significant?: number }>;

/** The most places a figure below one ever gets: past this it is a zero to the eye. */
const MOST_PLACES = 12;

export function plainFigure(value: number, { places = 4, significant = 4 }: FigureShape = {}): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const kept = abs >= 1 ? places : Math.min(MOST_PLACES, -Math.floor(Math.log10(abs)) - 1 + significant);
  const text = abs.toFixed(kept).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return text === '0' ? `${sign}0.${'0'.repeat(MOST_PLACES - 1)}1` : `${sign}${text}`;
}

/** A figure with a long tail or an exponent: one whole number of the text, not a part of one. */
const LONG_FIGURE = /(?<![\d.])\d+(?:\.\d+)?e[-+]?\d+|(?<![\d.,])\d+\.\d{5,}/gi;

/** Every long figure in a line of words, shortened as `plainFigure` writes it; the rest of the words as they are. */
export function shortFigures(text: string, shape?: FigureShape): string {
  return text.replace(LONG_FIGURE, (match) => plainFigure(Number(match), shape));
}

/**
 * A number field in the language on screen (CITY-150: «0.1» in a field beside «0,1» on the screen). The field shows a
 * comma where Ukrainian writes one, and what the person types — a comma or a point — goes back as a point, the one way
 * the city's parsers and the engine read. English keeps its point, and its comma stays a thousands mark.
 */
export function fieldText(value: string, lang: Lang = langNow()): string {
  return lang === 'en' ? value : value.replace('.', ',');
}

export function fieldValue(typed: string, lang: Lang = langNow()): string {
  return lang === 'en' ? typed : typed.replace(/,/g, '.');
}
