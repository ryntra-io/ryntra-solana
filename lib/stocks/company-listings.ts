/**
 * The companies that now trade, recorded beside the registry of issuer events (`lifecycle-events.ts`)
 * before their whole path is read. The registry is published as it is and names no company it does not have to; this
 * file is the product's own, read by the company's path (`company-path.ts`), the private shelf (`shelf.ts`), the
 * Market's «Pre-IPO» list and a stock's facts (`pool-facts.ts`).
 *
 * Pure and client-safe.
 */

import { COMPANY_PATHS, type CompanyPathRecord, type PathSource } from "./lifecycle-events.ts";

/**
 * A company whose shares now trade, recorded before its whole path is: what the company's own step is — it
 * is no longer private — and which token on Solana is its share, each fact from its own source with the read date.
 * What no primary source has been read for is named in `unread` and stated nowhere: the IPO's day and price, the
 * exchange's name, the issuer's swap notice for the private token and its cut-off. The private token's own life is not
 * changed here: without the issuer's notice it is no window (`LIFECYCLE_EVENTS`), and the daily watch of the issuer's
 * page (`issuer-pages.ts`) still reports a notice the moment one appears — then the event and a `CompanyPathRecord`
 * are written, and this record gives way to them.
 */
export type CompanyListingRecord = Readonly<{
  company: string;
  /** The company's key, as the universe links one company's instruments (`companyKeyOf`). */
  companyKey: string;
  /** The private token of the company — PreStocks'. */
  privateMint: string;
  /** The share's ticker on its exchange; the exchange's own name only where a source states it. */
  exchange: Readonly<{ ticker: string; name: string | null; country: string }>;
  /** The share's token on Solana Ryntra offers — the one its issuer confirms by contract address. */
  solana: Readonly<{ mint: string; symbol: string; issuer: "backpack" | "xstocks" }>;
  /** What the private token's issuer now calls it, on its own page. */
  privateMark: Readonly<{ label: string; url: string; readAt: string }>;
  /** What is not read from a primary source yet, and so is said nowhere. */
  unread: readonly ("ipo-date" | "ipo-price" | "exchange-name" | "swap-notice")[];
  sources: readonly PathSource[];
  observedAt: string;
  /** When the record is due for another look — the swap notice above all. */
  recheckBy: string;
}>;

/**
 * Anthropic, read on 2026-11-19 (18:00–18:40 UTC, `docs/research/terminal-bench-2026-11-19/ANT-LIVE.md`):
 *
 * - Pyth's catalogue lists the exchange feed `Equity.US.ANT/USD` — «ANTHROPIC PBC / US DOLLAR», US market hours — next
 *   to its 24/7 index `Equity.Index.ANT/USD`: the share trades in the US under the ticker ANT;
 * - Backpack's public list of assets names `ANT.US` «Anthropic» with the Solana contract address
 *   `ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe` — the share's token, by its issuer's word; the token's own metadata
 *   points to the issuer's domain («Tokenized shares of Anthropic (ANT)»);
 * - xStocks' catalogue lists ANTx for the share ANT with ISIN US03703U1079;
 * - PreStocks' own Anthropic page marks the product «Post-IPO».
 *
 * Not read from a primary source: the IPO's day and price, the exchange's name (Pyth's `nasdaq_symbol` is a symbology
 * field, not a listing venue), and a PreStocks swap notice with a cut-off — none was on the page.
 */
export const COMPANY_LISTINGS: readonly CompanyListingRecord[] = [
  {
    company: "Anthropic",
    companyKey: "anthropic",
    privateMint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    exchange: { ticker: "ANT", name: null, country: "US" },
    solana: { mint: "ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe", symbol: "ANT", issuer: "backpack" },
    privateMark: { label: "Post-IPO", url: "https://www.prestocks.com/anthropic", readAt: "2026-11-19" },
    unread: ["ipo-date", "ipo-price", "exchange-name", "swap-notice"],
    sources: [
      { label: "Pyth · Equity.US.ANT/USD", url: "https://hermes.pyth.network/v2/price_feeds?query=ANT&asset_type=equity", publishedAt: null, readAt: "2026-11-19" },
      { label: "Backpack · assets", url: "https://api.backpack.exchange/api/v1/assets", publishedAt: null, readAt: "2026-11-19" },
      { label: "PreStocks · Anthropic", url: "https://www.prestocks.com/anthropic", publishedAt: null, readAt: "2026-11-19" },
    ],
    observedAt: "2026-11-19T18:40:00.000Z",
    recheckBy: "2026-11-26",
  },
];

/** What a person reads of a listed company beside its private token: the company, its ticker, and its share's token on Solana. */
export type ListedCompany = Readonly<{ company: string; ticker: string; solana: Readonly<{ mint: string; symbol: string }> }>;

/**
 * The company behind a private token, once it trades — from the full path (`COMPANY_PATHS`: SpaceX) or the listing
 * record (`COMPANY_LISTINGS`: Anthropic) — or null while the company is private as far as the registry knows. Read by
 * the private token's mint, or by the company's key.
 */
export function listedCompanyFor(
  key: Readonly<{ mint?: string | null; companyKey?: string | null }>,
  registry: Readonly<{ paths: readonly CompanyPathRecord[]; listings: readonly CompanyListingRecord[] }> = { paths: COMPANY_PATHS, listings: COMPANY_LISTINGS },
): ListedCompany | null {
  const path = key.mint ? registry.paths.find((record) => record.privateMint === key.mint) : undefined;
  if (path) return { company: path.company, ticker: path.exchange.ticker, solana: { mint: path.solana.mint, symbol: path.solana.symbol } };
  const listing = registry.listings.find((record) => (key.mint && record.privateMint === key.mint) || (key.companyKey && record.companyKey === key.companyKey));
  return listing ? { company: listing.company, ticker: listing.exchange.ticker, solana: { mint: listing.solana.mint, symbol: listing.solana.symbol } } : null;
}
