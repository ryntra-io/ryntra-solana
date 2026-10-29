/**
 * A SOL figure as «Гаманці» print it (SOL-R4, SOL-R3): a dust result keeps two figures that matter — «−0,00021», never
 * «−0,00»; from 100 SOL one decimal, from 1 two, below three. The minimum never passes the maximum: «150 SOL» once
 * threw a RangeError that took the wallet's page down.
 */
export function solText(value: number, locale: string, signed = false): string {
  const abs = Math.abs(value);
  const most = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  const text = abs > 0 && abs < 0.01 ? new Intl.NumberFormat(locale, { maximumSignificantDigits: 2 }).format(abs) : new Intl.NumberFormat(locale, { maximumFractionDigits: most, minimumFractionDigits: Math.min(2, most) }).format(abs);
  return `${signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : value < 0 ? "−" : ""}${text}`;
}
