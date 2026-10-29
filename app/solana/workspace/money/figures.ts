/**
 * An exact figure — or a line carrying figures — as the page's language writes it (B18, the B13 review: «одна мова
 * чисел»): «1 234,5» in Ukrainian, «1,234.5» in English. Only separators between digits change. Display only — what is
 * signed, parsed or compared is never this string.
 */
export function localFigure(display: string, locale: string): string {
  if (locale !== "uk") return display;
  return display.replace(/(\d),(?=\d{3}(?!\d))/g, "$1 ").replace(/(\d),(?=\d{3} )/g, "$1 ").replace(/(\d)\.(?=\d)/g, "$1,");
}
