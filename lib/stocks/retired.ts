/**
 * Tokens Ryntra no longer supports — canon v5.2 В26 (2026-09-24): private
 * companies come through PreStocks only, and the other pre-IPO issuer's
 * tokens are disconnected from the product, the API, the phone and the
 * public projection.
 *
 * Ryntra offers them nowhere: no list, search, page, plan, quote or order
 * names one as something to buy or sell here. What a person already has with
 * one — a holding, a plan written before, a receipt — reads as history: the
 * asset is «Більше не підтримується в Ryntra», and the way out is a sale in
 * the person's own wallet. Records of the past are never rewritten.
 *
 * Known by mint — the three tokens the issuer listed when Ryntra
 * disconnected, read on 2026-09-25 — and, on the venue's lists, by the
 * issuer's own tag, so a later mint of the same issuer is not offered
 * either. Nothing here is read from the issuer: Ryntra no longer reads its
 * catalogue.
 */

export type RetiredToken = Readonly<{ mint: string; symbol: string }>;

export const RETIRED_TOKENS: readonly RetiredToken[] = [
  { mint: "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ", symbol: "tOpenAI" },
  { mint: "TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v", symbol: "tSpaceX" },
  { mint: "TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ", symbol: "tKalshi" },
];

/** The venue's tag of the disconnected issuer — its name stays in code only as the rule that keeps its tokens out. */
const RETIRED_VENUE_TAGS: ReadonlySet<string> = new Set(["tessera"]);

const byMint = new Set(RETIRED_TOKENS.map((token) => token.mint));
const bySymbol = new Map(RETIRED_TOKENS.map((token) => [token.symbol.toLowerCase(), token]));

/** Whether a mint is one of the retired tokens. */
export function isRetiredMint(mint: string | null | undefined): boolean {
  return typeof mint === "string" && byMint.has(mint);
}

/** Whether a venue tag names the disconnected issuer. */
export function isRetiredVenueTag(tag: string): boolean {
  return RETIRED_VENUE_TAGS.has(tag.toLowerCase());
}

/** A venue row that is a retired token: its mint is one, or its tags name the disconnected issuer. */
export function isRetiredToken(token: Readonly<{ mint: string; tags?: readonly string[] | null }>): boolean {
  return isRetiredMint(token.mint) || (token.tags ?? []).some(isRetiredVenueTag);
}

/** The retired token an address names — a mint, or a symbol in any case, as a person types it in a URL; null for every other address. */
export function retiredTokenFor(ticker: string): RetiredToken | null {
  const wanted = ticker.trim();
  if (wanted.length === 0) return null;
  return RETIRED_TOKENS.find((token) => token.mint === wanted) ?? bySymbol.get(wanted.toLowerCase()) ?? null;
}

type Bi = Readonly<{ en: string; uk: string }>;

/** What a person reads where a retired token would have been offered: its state, and the way out. */
export const RETIRED_WORDS: Readonly<{ state: Bi; exit: Bi }> = {
  state: { en: "No longer supported in Ryntra", uk: "Більше не підтримується в Ryntra" },
  exit: { en: "You can sell it in your own wallet", uk: "Продати можна у своєму гаманці" },
};

/** The server's sentence when it refuses a quote, an order or a plan on a retired token. */
export const RETIRED_REASON = "No longer supported in Ryntra; the token can be sold in the holder's own wallet.";
