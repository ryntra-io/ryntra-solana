/**
 * A company page as the search engines and the share cards see it — read from
 * the same row the page draws (the plan of `RYN-SITE-V5-001` §1, §3, §6).
 *
 * Which pages are offered to the index is the shelf's rule, the Owner's
 * decision 3: the token a company's card opens — today about 150 listed
 * companies and funds and the private ones — each in both languages. The
 * company's other tokens (Ondo's, a second Backpack one) stay reachable and
 * out of the index: the same company twice in the results is one page too many.
 */

import type { CompanyCardInput } from "../../app/brand/page-card.ts";
import { companyFactsFor } from "../stocks/company-facts.ts";
import { companyDisplayName, companyShelf } from "../stocks/shelf.ts";
import type { StockRow, StockUniverse } from "../stocks/universe.server.ts";
import type { CompanySeoInput } from "./company-seo.ts";

const preIpo = (row: StockRow): boolean => row.representation.instrument?.class === "pre-ipo";

/** The company as a person names it — «Apple», not «AAPLx»; a private company by its own name. */
export function companyName(row: StockRow): string {
  const rep = row.representation;
  return companyDisplayName(rep.underlying.name ?? rep.name, preIpo(row) ? null : rep.underlying.symbol);
}

/** The ticker of the listed share the token tracks — none for a private company. */
export function companyTicker(row: StockRow): string | null {
  return preIpo(row) ? null : row.representation.underlying.symbol || null;
}

/** The page's address: by the token's own symbol, whatever spelling or mint the request used. */
export function companyPagePath(row: StockRow): string {
  return `/app/stocks/${row.representation.symbol}`;
}

export function companySeoInputOf(row: StockRow): CompanySeoInput {
  const rep = row.representation;
  const facts = preIpo(row) ? null : companyFactsFor(rep.underlying.symbol);
  return {
    name: companyName(row),
    symbol: rep.symbol,
    issuer: rep.issuer.id,
    instrumentClass: preIpo(row) ? "pre-ipo" : "listed-equity",
    facts: facts ? { kind: facts.kind, foreign: facts.foreign } : null,
    path: row.companyPath ?? null,
  };
}

export function companyCardInputOf(row: StockRow): CompanyCardInput {
  return { name: companyName(row), symbol: row.representation.symbol, issuer: row.representation.issuer.id, icon: row.market.icon };
}

const shelves = new WeakMap<StockUniverse, ReadonlySet<string>>();

/** The tokens the shelf's cards open, listed and private — the company pages offered to the index. */
export function shelfTickers(universe: StockUniverse): ReadonlySet<string> {
  const known = shelves.get(universe);
  if (known) return known;
  const shelf = companyShelf(universe);
  const tickers = new Set([...shelf.companies, ...shelf.privateCompanies].map((card) => card.ticker));
  shelves.set(universe, tickers);
  return tickers;
}
