/**
 * What the phone asks of the chart page (CH-21): the market, the app's own theme and language, nothing else. The page
 * keeps no choice of its own for either — the app opens it again when the person changes them there. Anything else in
 * the address is ignored: the page never reads a wallet, a sum or a side from it.
 */

export type EmbedTheme = "graphite" | "porcelain";
export type EmbedLocale = "en" | "uk";

const MINT_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A Solana mint as the spot page takes it, or null. */
export function embedMint(value: string | undefined): string | null {
  return value && MINT_SHAPE.test(value) ? value : null;
}

/** Graphite unless the app says Porcelain — the core's two themes, by their names. */
export function embedTheme(value: string | undefined): EmbedTheme {
  return value === "porcelain" ? "porcelain" : "graphite";
}

/** English unless the app says Ukrainian. */
export function embedLocale(value: string | undefined): EmbedLocale {
  return value === "uk" ? "uk" : "en";
}

/**
 * The theme on <html> before first paint, after the site's own boot script: the core's name for the chart's tokens
 * and the older dark/light name for the rest, as the cabinet's look script sets them (`app/app/look.ts`).
 */
export function embedThemeScript(theme: EmbedTheme): string {
  const old = theme === "porcelain" ? "light" : "dark";
  return `(function(){var d=document.documentElement;d.setAttribute("data-theme","${theme}");d.setAttribute("data-ry-theme","${old}");d.setAttribute("data-ry-app","cabinet");d.style.colorScheme="${old}"})();`;
}
