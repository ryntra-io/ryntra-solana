/**
 * A figure nobody measured is «not measured», never a zero (CITY-73): a probe that never ran is `NOT_MEASURED` — a
 * different fact from a failure and from a zero. A source that leaves a field out, or sends text, `NaN` or `Infinity`, measured nothing; a source that
 * sends `0` measured zero.
 *
 * Pure. Relative imports with their extension only.
 */

export type Locale = "en" | "uk";

/** What the city writes in place of a figure nobody measured. */
export const NOT_MEASURED: Readonly<Record<Locale, string>> = Object.freeze({ en: "Not measured", uk: "Не виміряно" });

/** A figure as the source sent it: the number, or `null` when it measured nothing. */
export function measured(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/** A figure on screen: formatted when measured, «Not measured» when not — never a zero standing in for nothing. */
export function shownFigure(value: number | null | undefined, format: (value: number) => string, locale: Locale = "en"): string {
  return typeof value === "number" && Number.isFinite(value) ? format(value) : NOT_MEASURED[locale];
}

/**
 * The keys of a record whose figures nobody measured: for a record that keeps a zero in place of a missing figure so
 * the scene can still draw it, this is how the screen knows the zero is not a reading.
 */
export function unmeasuredKeys<K extends string>(raw: Readonly<Partial<Record<K, unknown>>>, keys: readonly K[]): K[] {
  return keys.filter((key) => measured(raw[key]) === null);
}
