import { langNow, useLang } from './lang.ts';
import { LANG_LOCALE, type Lang } from './langs.ts';

/**
 * The city's dictionaries (CITY-79). Each district keeps its own words beside its components (a `words.ts` there), so
 * a window's text and its translation change in one place; this file only gives the shape and the reading.
 *
 * An entry is a string or a function of the numbers and names it carries (`(n) => …`), so word order and plural forms
 * stay each language's own. The Ukrainian half must have exactly the English half's keys and kinds — the compiler
 * refuses a missing or a stray key, and `city/lib/i18n/i18n.test.mjs` checks every dictionary again.
 *
 * Words files import nothing but this file (`city/lib/i18n/dict.ts`), so the test can read them all as they are.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Entry = string | ((...args: any[]) => string);
export type Dict = Readonly<Record<string, Entry>>;
/** The other half of a dictionary: the same keys, a string for a string, the same call for a call. */
export type Same<T extends Dict> = { readonly [K in keyof T]: T[K] extends string ? string : T[K] };
export type Words<T extends Dict> = Readonly<Record<Lang, Same<T>>>;
/** The keys of a dictionary that are plain strings — for a table that names its words by key. */
export type TextKey<W extends Words<Dict>> = { [K in keyof W['en']]: W['en'][K] extends string ? K : never }[keyof W['en']];

/** One dictionary: the English words and the same words in Ukrainian. */
export function words<T extends Dict>(en: T, uk: Same<T>): Words<T> {
  return { en: en as Same<T>, uk };
}

/** The words of a dictionary in the language on screen; the component repaints when the language changes. */
export function useWords<T extends Dict>(dict: Words<T>): Same<T> {
  return dict[useLang()];
}

/** The same words outside React, in the language of this moment (a moment's line, a formatter). */
export function wordsNow<T extends Dict>(dict: Words<T>): Same<T> {
  return dict[langNow()];
}

/**
 * The Ukrainian plural: 1, 21, 31 … take the first form; 2–4, 22–24 … the second; the rest the third. A fraction
 * takes the second («1,5 години»).
 */
export function pl(n: number, one: string, few: string, many: string): string {
  if (!Number.isInteger(n)) return few;
  const abs = Math.abs(n);
  const ten = abs % 10;
  const hundred = abs % 100;
  if (ten === 1 && hundred !== 11) return one;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return few;
  return many;
}

/** The locale tag `Intl` formats with, for the language on screen or the one given. */
export function locale(lang: Lang = langNow()): string {
  return LANG_LOCALE[lang];
}

/** A plain number in the language's own way: «1,234.5» in English, «1 234,5» in Ukrainian. */
export function num(value: number, options?: Intl.NumberFormatOptions, lang: Lang = langNow()): string {
  return new Intl.NumberFormat(LANG_LOCALE[lang], options).format(value);
}

const NBSP = ' ';
/** A number as English writes it: 1,234 · 1,234.56 · 0.5 · .5 is not one. */
const EN_NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+/g;

/**
 * A text the city's formatters wrote the English way («$1,234.56», «+12.4%», «$1.2M»), with its numbers in the
 * language on screen: in Ukrainian the decimal point is a comma and the thousands a narrow space. Tickers, signs and
 * letters stay as they are. Only for the eye — a value that goes back into a field or a request is never passed here.
 */
export function digits(text: string, lang: Lang = langNow()): string {
  if (lang === 'en') return text;
  return text.replace(EN_NUMBER, (match) => match.replace(/,/g, NBSP).replace('.', ','));
}

/** Dates as the city always wrote them in English (29 Oct, 14:05), and the Ukrainian way (29 жовт., 14:05). */
const DATE_LOCALE: Readonly<Record<Lang, string>> = { en: 'en-GB', uk: 'uk-UA' };

/** A date or a time in the language's own way. */
export function dateText(value: Date | number, options: Intl.DateTimeFormatOptions, lang: Lang = langNow()): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], options).format(value);
}
