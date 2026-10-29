/**
 * Number shapes the pools pages add to Spot's: a fee rate, a price that may be
 * tiny or huge, a read's time. A missing figure is a dash.
 */

const DASH = "—";

/** A fee in percent as the venue states it: `0.25%`, `0.01%`, `2%`. */
export function formatFeePct(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const digits = value >= 1 ? 2 : value >= 0.01 ? 3 : 4;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)}%`;
}

/** A pool's price, Y per X: as many significant figures as a reading needs, never an exponent. */
export function formatPoolPrice(value: number | null, locale: string): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e12) return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 2 }).format(value);
  if (abs >= 1) return new Intl.NumberFormat(locale, { maximumFractionDigits: abs >= 1000 ? 2 : 4 }).format(value);
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 5 }).format(value);
}

/** `14:05` today; `16 Oct, 14:05` on another day. */
export function formatTime(at: string | number, locale: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return DASH;
  const sameDay = new Date().toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** A slot with thin grouping: `373 512 004`. */
export function formatSlot(slot: number | null, locale: string): string {
  return slot === null ? DASH : new Intl.NumberFormat(locale, { useGrouping: true }).format(slot);
}
