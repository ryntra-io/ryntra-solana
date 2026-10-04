/**
 * Representations — which Solana tokens are tokenized stocks, who stands
 * behind each one, and what it stands for.
 *
 * A symbol is never an identity. A representation is a **mint** that two
 * independent facts agree on: the venue's verified universe tags it as a stock
 * token of a named issuer, and — where the issuer publishes a list — the
 * issuer's own catalogue names that exact mint. A token that borrows a symbol
 * but sits on no issuer list is not "unconfirmed"; it is not in the catalogue
 * at all, which is how a look-alike stays out of a person's screener.
 *
 * Issuers are separate models, and an issuer is never inferred from a
 * category: `pre-ipo` is a class of instrument, `prestocks` is an issuer,
 * confirmed by its own catalogue. xStocks (Backed) publishes assets,
 * references, multipliers and reserves; PreStocks publishes its mints and its
 * own marks; Backpack Securities and Ondo Global Markets are known here by
 * the venue's tag only, so their representations carry
 * `issuerConfirmation: "tag-only"` and no issuer reference until a source
 * exists. Ondo tokens with no on-chain route say so by route state, never by
 * issuer name.
 *
 * Private companies come through PreStocks only: a token of any other
 * pre-IPO issuer is no representation here, whatever the venue's tags say
 * (`retired.ts`).
 */

import type { SpotMarket } from "../spot/markets.ts";
import type { Instrument } from "./instrument.ts";
import type { PreStocksAsset } from "./issuer-prestocks.server.ts";

export const STOCK_ISSUER_IDS = ["xstocks", "backpack", "ondo", "prestocks"] as const;
export type StockIssuerId = (typeof STOCK_ISSUER_IDS)[number];

export type StockIssuer = Readonly<{ id: StockIssuerId; label: string; /** Whether the issuer publishes a machine-readable catalogue Ryntra reads. */ catalogue: boolean }>;

export const STOCK_ISSUERS: Readonly<Record<StockIssuerId, StockIssuer>> = {
  xstocks: { id: "xstocks", label: "xStocks · Backed Finance", catalogue: true },
  backpack: { id: "backpack", label: "Backpack Securities", catalogue: false },
  ondo: { id: "ondo", label: "Ondo Global Markets", catalogue: false },
  prestocks: { id: "prestocks", label: "PreStocks", catalogue: true },
};

/**
 * The instrument each issuer's tokens are, as far as Ryntra can check
 * (`instrument.ts`). The listed-equity issuers price a share; the pre-IPO
 * issuer prices a token, because it states no unit of one share that Ryntra
 * can verify (PreStocks calls its price a gross price per share of the
 * referenced company — the issuer's own statement, shown as such).
 */
export const ISSUER_INSTRUMENT: Readonly<Record<StockIssuerId, Instrument>> = {
  xstocks: { class: "listed-equity", unitBasis: "share", rights: "issuer-terms" },
  backpack: { class: "listed-equity", unitBasis: "share", rights: "issuer-terms" },
  ondo: { class: "listed-equity", unitBasis: "share", rights: "issuer-terms" },
  prestocks: { class: "pre-ipo", unitBasis: "token", rights: "economic-exposure" },
};

/**
 * The venue's tags that name an issuer. Read off Jupiter Tokens v2, nothing
 * inferred from a name — and nothing inferred from a category: `pre-ipo`
 * alone names no issuer (the bare tag was read as PreStocks until 2026-09-16;
 * the first mint carrying `pre-ipo` beside another issuer's tag would have
 * been listed under the wrong name).
 */
export function issuerFromTags(tags: readonly string[]): StockIssuerId | null {
  if (tags.includes("xstocks")) return "xstocks";
  if (tags.includes("backpack")) return "backpack";
  if (tags.includes("ondo")) return "ondo";
  if (tags.includes("prestocks")) return "prestocks";
  return null;
}

/** One asset of the xStocks public catalogue, reduced to what Ryntra keeps. */
export type XStocksAsset = Readonly<{
  symbol: string;
  name: string;
  isin: string | null;
  underlying: Readonly<{ symbol: string; isin: string | null; listingCountry: string | null }>;
  /** The Solana mint the issuer names for this asset. */
  solanaMint: string;
  tradingHalted: boolean;
  trading: Readonly<{
    currency: string;
    currentPeriod: string | null;
    openNow: boolean | null;
    nextChangeAt: string | null;
    exchange: Readonly<{ mic: string; name: string; timezone: string }> | null;
  }> | null;
  logo: string | null;
}>;

export type IssuerConfirmation = "issuer-catalogue" | "tag-only";

export type StockRepresentation = Readonly<{
  mint: string;
  /** The token's own symbol and name, as the venue lists them. */
  symbol: string;
  name: string;
  issuer: StockIssuer;
  issuerConfirmation: IssuerConfirmation;
  /** What kind of instrument the token is: its class, the unit its price stands for, the rights it carries. */
  instrument: Instrument;
  underlying: Readonly<{ symbol: string; isin: string | null; listingCountry: string | null; name: string | null }>;
  /** The company behind the instrument, normalized for linking one company's instruments across issuers — never for treating them as one instrument. */
  companyKey: string | null;
  exchange: Readonly<{ mic: string; name: string; timezone: string }> | null;
  tokenProgram: string | null;
  decimals: number | null;
  /** Whether the issuer has halted trading of this asset, when the issuer says. */
  tradingHalted: boolean | null;
  /** The issuer's own page for this token, on the issuer's domain; null where the issuer publishes none Ryntra reads. */
  issuerUrl: string | null;
  /** The issuer's own words about the token, plain text and short; null where the issuer publishes none. */
  issuerNote: string | null;
  /** Where the identity was confirmed. */
  sources: readonly string[];
}>;

/** The issuers' catalogues, indexed by mint; null where a catalogue could not be read at all. */
export type IssuerCatalogues = Readonly<{
  xstocks: ReadonlyMap<string, XStocksAsset> | null;
  prestocks: ReadonlyMap<string, PreStocksAsset> | null;
}>;

export const NO_CATALOGUES: IssuerCatalogues = { xstocks: null, prestocks: null };

/** A company name into the key one company's instruments share: lower case, letters and digits only. */
export function companyKeyOf(name: string | null): string | null {
  if (name === null) return null;
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return key.length > 0 ? key : null;
}

/**
 * Build the representation for one verified market, or nothing.
 *
 * - not a stock by the venue's tags → null;
 * - not verified by the venue → null (a copy can borrow a name);
 * - issuer with a catalogue whose catalogue does not name this mint → null,
 *   the look-alike rule — and a catalogue that could not be read names
 *   nothing, so its issuer's rows are absent rather than guessed;
 * - otherwise a representation, with the issuer's facts when it has them.
 */
export function buildRepresentation(market: SpotMarket, catalogues: IssuerCatalogues | XStocksAsset | null): StockRepresentation | null {
  if (!market.verified) return null;
  const issuerId = issuerFromTags(market.tags);
  if (issuerId === null) return null;
  const issuer = STOCK_ISSUERS[issuerId];
  const instrument = ISSUER_INSTRUMENT[issuerId];
  /* The older call shape — one xStocks asset or null — is still honoured for the callers and tests that use it. */
  const books: IssuerCatalogues = catalogues === null || "xstocks" in catalogues ? (catalogues ?? NO_CATALOGUES) : { xstocks: new Map([[catalogues.solanaMint, catalogues]]), prestocks: null };

  if (issuerId === "xstocks") {
    const issuerAsset = books.xstocks?.get(market.mint) ?? null;
    if (!issuerAsset || issuerAsset.solanaMint !== market.mint) return null;
    const name = underlyingNameFrom(issuerAsset.name);
    return {
      mint: market.mint,
      symbol: market.symbol,
      name: market.name,
      issuer,
      issuerConfirmation: "issuer-catalogue",
      instrument,
      underlying: { symbol: issuerAsset.underlying.symbol, isin: issuerAsset.underlying.isin, listingCountry: issuerAsset.underlying.listingCountry, name },
      companyKey: companyKeyOf(name),
      exchange: issuerAsset.trading?.exchange ?? null,
      tokenProgram: market.tokenProgram,
      decimals: market.decimals,
      tradingHalted: issuerAsset.tradingHalted,
      issuerUrl: null,
      issuerNote: null,
      sources: ["jupiter-verified", "xstocks-public-api"],
    };
  }

  if (issuerId === "prestocks") {
    const asset = books.prestocks?.get(market.mint) ?? null;
    if (!asset || asset.solanaMint !== market.mint) return null;
    return {
      mint: market.mint,
      symbol: market.symbol,
      name: market.name,
      issuer,
      issuerConfirmation: "issuer-catalogue",
      instrument,
      /* A private company has no ticker: the underlying symbol is the token's own, the name the issuer's. */
      underlying: { symbol: market.symbol, isin: null, listingCountry: null, name: asset.company },
      companyKey: companyKeyOf(asset.company),
      exchange: null,
      tokenProgram: market.tokenProgram,
      decimals: market.decimals,
      tradingHalted: null,
      issuerUrl: asset.productUrl,
      issuerNote: asset.description ? asset.description.split("\n")[0].slice(0, 400) : null,
      sources: ["jupiter-verified", "prestocks-public-api"],
    };
  }

  const impliedName = underlyingNameFromTokenName(market.name, issuerId);
  return {
    mint: market.mint,
    symbol: market.symbol,
    name: market.name,
    issuer,
    issuerConfirmation: "tag-only",
    instrument,
    underlying: { symbol: underlyingSymbolFromToken(market.symbol, issuerId), isin: null, listingCountry: null, name: impliedName },
    companyKey: companyKeyOf(impliedName),
    exchange: null,
    tokenProgram: market.tokenProgram,
    decimals: market.decimals,
    tradingHalted: null,
    issuerUrl: null,
    issuerNote: null,
    sources: ["jupiter-verified"],
  };
}

/** "NVIDIA xStock" → "NVIDIA". The issuer's naming pattern, not a guess about the company. */
export function underlyingNameFrom(issuerName: string): string | null {
  const trimmed = issuerName.replace(/\s*xStock$/i, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

const ISSUER_SUFFIX = /\s*[-–·]?\s*(Backpack Securities|PreStocks|\(Ondo Tokenized\)|Ondo Global Markets|Ondo|xStocks?)$/i;

/**
 * A tag-only issuer's token name carries the issuer as a suffix — "Nike -
 * Backpack Securities", "Anthropic PreStocks". The suffix is the issuer's
 * naming pattern; removing it leaves the company as the token names it, still
 * labelled as implied rather than confirmed. A name without the suffix implies
 * nothing new and answers null.
 */
export function underlyingNameFromTokenName(tokenName: string, issuer: StockIssuerId): string | null {
  void issuer;
  const stripped = tokenName.replace(ISSUER_SUFFIX, "").trim();
  return stripped.length > 0 && stripped !== tokenName.trim() ? stripped : null;
}

/**
 * The underlying symbol a tag-only issuer's token implies. The token symbol is
 * the only fact available, so the answer is the token symbol with the issuer's
 * known suffix removed — and it is labelled as implied, never as confirmed.
 */
export function underlyingSymbolFromToken(tokenSymbol: string, issuer: StockIssuerId): string {
  if (issuer === "xstocks") return tokenSymbol.replace(/x$/, "");
  /* Ondo Global Markets names every token `<TICKER>on` — `METAon`, `SPYon`. */
  if (issuer === "ondo") return tokenSymbol.replace(/on$/, "");
  return tokenSymbol;
}

/** Index a catalogue by Solana mint, the only key a representation is looked up by. */
export function indexIssuerAssets(assets: readonly XStocksAsset[]): ReadonlyMap<string, XStocksAsset> {
  return new Map(assets.map((asset) => [asset.solanaMint, asset]));
}

/** The address a person types in the URL: a token symbol (case-insensitive) or a mint. */
export function matchesTicker(representation: StockRepresentation, ticker: string): boolean {
  const wanted = ticker.trim();
  if (wanted.length === 0) return false;
  return representation.mint === wanted || representation.symbol.toLowerCase() === wanted.toLowerCase();
}
