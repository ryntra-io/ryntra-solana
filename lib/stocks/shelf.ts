/**
 * The beginner's shelf of companies — «Простий»'s Markets and Home (canon
 * v5.0 §3, §4; `RYN-INVEST-SIMPLE-001`, session 1).
 *
 * **One company, one card.** The stock universe lists every confirmed
 * representation — Apple as xStocks' AAPLx, as Backpack's, as Ondo's — which
 * is what «Профі»'s screener is for. A person who wants «частинку Apple»
 * wants Apple: the shelf groups the representations of one underlying (the
 * grouping rule of `underlying-group.ts`, never merely one company name) and
 * shows the one it would buy by default — the most liquid representation
 * the issuer confirms in its own catalogue, else the most liquid one the
 * venue verifies. Comparing representations stays in «Профі» (canon §7).
 *
 * **Who is on the shelf.** An issuer whose instrument the canon puts in front
 * of a beginner: xStocks and Backpack. Ondo is not on the beginner's shelf
 * (canon §3: the liquidity of its tokens is too thin for a first purchase);
 * its rows stay in the screener. A representation that is halted, not offered
 * for purchase or has no price is not a default either — a card is something
 * a person can buy now.
 *
 * **The order is neutral and published:** the company's trading volume over
 * the last twenty-four hours across its representations, the same for every
 * person (canon §4: no «топ-3», no ranking by anyone's opinion).
 *
 * **Private companies** (pre-IPO) are a shelf of their own, «для досвідчених»,
 * and come through PreStocks only (canon v5.2 В25–В27): each of its tokens is
 * a card that says «Це не акція» and one honest number — the token's price
 * against PreStocks' own valuation, with the time that valuation was read.
 *
 * Pure: rows in, cards out. The names are the issuer's own, with the legal
 * form taken off («Applied Materials, Inc.» → «Applied Materials») and two
 * index funds named by the index they track, because the issuer's short name
 * for them («SP500», «Nasdaq») reads as something else.
 */

import type { StockIssuerId } from "./representations.ts";
import { sameUnderlying } from "./underlying-group.ts";
import type { StockRow, StockUniverse } from "./universe.server.ts";

/** The issuers whose instruments a beginner is shown (canon v5.0 §3, §7). */
export const SHELF_ISSUERS: ReadonlySet<StockIssuerId> = new Set(["xstocks", "backpack"]);

/** The one issuer of the private shelf (canon v5.2 В25). */
export const PRIVATE_SHELF_ISSUERS: ReadonlySet<StockIssuerId> = new Set(["prestocks"]);

/** Cards on Home's «Популярні компанії». */
export const POPULAR_COUNT = 8;

/**
 * The same list beside Home's right column on a wide desk: three rows of four
 * rather than two, so the main column is not the shorter one
 * (`RYN-WIDTH-PREMIUM-001`). Narrower, the first `POPULAR_COUNT` stand.
 */
export const POPULAR_WIDE_COUNT = 12;

export type ShelfCard = Readonly<{
  /** The company as a person names it. */
  name: string;
  /** The token the card opens and would buy — the address of its page, never a title. */
  ticker: string;
  mint: string;
  icon: string | null;
  /** Per token as the wallet shows it, USD — the price a person pays. */
  price: number;
  change24h: number | null;
  /** The company's trading over the last day, USD — the shelf's order. */
  volume24h: number;
  issuer: StockIssuerId;
  /** A private company's token against the issuer's own valuation of it, per cent (the row's `markPremiumPct`); absent on a listed company's card. */
  premiumPct?: number | null;
  /** When the issuer's valuation behind `premiumPct` was read. */
  premiumAt?: string | null;
}>;

export type CompanyShelf = Readonly<{
  companies: readonly ShelfCard[];
  privateCompanies: readonly ShelfCard[];
  /** When the market was read. */
  fetchedAt: string;
}>;

/** Index funds whose issuer name says something other than the index. */
const INDEX_NAMES: Readonly<Record<string, string>> = {
  SPY: "S&P 500",
  QQQ: "Nasdaq 100",
};

const COMMON_STOCK = /\s+common stock$/i;
const LEADING_THE = /^the\s+/i;
const LEGAL_FORM = /,?\s+(inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|llc|plc|n\.v\.|s\.a\.)$/i;
const TRAILING_AND = /\s+(and|&)$/i;

/**
 * A company's name as a person reads it: the issuer's own words with the
 * legal form and the share class's boilerplate taken off. Never shorter than
 * a word — a name that would vanish is kept as the issuer wrote it.
 */
export function companyDisplayName(name: string, underlyingSymbol: string | null = null): string {
  const alias = underlyingSymbol ? INDEX_NAMES[underlyingSymbol.toUpperCase()] : undefined;
  if (alias) return alias;
  let out = name.trim().replace(COMMON_STOCK, "").replace(LEADING_THE, "");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = out.replace(LEGAL_FORM, "").replace(TRAILING_AND, "").trim();
    if (next === out) break;
    out = next;
  }
  return out.length > 0 ? out : name.trim();
}

/** A wallet's token name → the company, for a holding the shelf does not list («Apple xStock» → «Apple»). */
export function companyFromTokenName(tokenName: string): string {
  const stripped = tokenName
    .replace(/\s*xStock$/i, "")
    .replace(/\s*[-–·]?\s*(Backpack Securities|PreStocks|\(Ondo Tokenized\)|Ondo Global Markets|Ondo|xStocks?)$/i, "")
    .trim();
  return companyDisplayName(stripped.length > 0 ? stripped : tokenName);
}

const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** A representation a beginner can be shown and can buy now. */
export function isShelfCandidate(row: StockRow): boolean {
  return (
    SHELF_ISSUERS.has(row.representation.issuer.id) &&
    row.representation.tradingHalted !== true &&
    row.lifecycle?.tradable !== false &&
    positive(row.market.priceUsd)
  );
}

const liquidity = (row: StockRow): number => row.market.liquidityUsd ?? 0;
const volume = (row: StockRow): number => (positive(row.market.volume24hUsd) ? row.market.volume24hUsd : 0);

/** The representation the card stands for: the issuer's catalogue before the venue's tag, then the deepest pool. */
function defaultOf(group: readonly StockRow[]): StockRow | null {
  const candidates = group.filter(isShelfCandidate);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const confirmed = Number(b.representation.issuerConfirmation === "issuer-catalogue") - Number(a.representation.issuerConfirmation === "issuer-catalogue");
    return confirmed !== 0 ? confirmed : liquidity(b) - liquidity(a);
  })[0];
}

function cardOf(row: StockRow, dayVolume: number, name: string): ShelfCard {
  return {
    name,
    ticker: row.representation.symbol,
    mint: row.representation.mint,
    icon: row.market.icon,
    price: row.market.priceUsd as number,
    change24h: typeof row.market.change24hPct === "number" && Number.isFinite(row.market.change24hPct) ? Math.round(row.market.change24hPct * 100) / 100 : null,
    volume24h: Math.round(dayVolume),
    issuer: row.representation.issuer.id,
  };
}

/** The listed companies, one card each, by the day's volume. */
export function shelfCompanies(rows: readonly StockRow[]): ShelfCard[] {
  const listed = rows.filter((row) => (row.representation.instrument?.class ?? "listed-equity") === "listed-equity");
  const groups: StockRow[][] = [];
  for (const row of [...listed].sort((a, b) => liquidity(b) - liquidity(a))) {
    const home = groups.find((group) => sameUnderlying(group[0].representation, row.representation));
    if (home) home.push(row);
    else groups.push([row]);
  }
  const cards: ShelfCard[] = [];
  for (const group of groups) {
    const chosen = defaultOf(group);
    if (!chosen) continue;
    const name = companyDisplayName(chosen.representation.underlying.name ?? chosen.representation.name, chosen.representation.underlying.symbol);
    cards.push(cardOf(chosen, group.reduce((sum, row) => sum + volume(row), 0), name));
  }
  return cards.sort((a, b) => b.volume24h - a.volume24h || a.name.localeCompare(b.name));
}

/**
 * The private companies — PreStocks' tokens only (canon v5.2 В25), every one
 * its own card, by the day's volume, each with the one number the shelf
 * shows for it: the price against PreStocks' valuation and its time.
 */
export function shelfPrivateCompanies(rows: readonly StockRow[]): ShelfCard[] {
  return rows
    .filter((row) => row.representation.instrument?.class === "pre-ipo" && PRIVATE_SHELF_ISSUERS.has(row.representation.issuer.id) && row.representation.tradingHalted !== true && row.lifecycle?.tradable !== false && positive(row.market.priceUsd))
    .map((row) => ({
      ...cardOf(row, volume(row), companyDisplayName(row.representation.underlying.name ?? row.representation.name)),
      premiumPct: typeof row.markPremiumPct === "number" && Number.isFinite(row.markPremiumPct) ? Math.round(row.markPremiumPct * 100) / 100 : null,
      premiumAt: row.issuerMark?.fetchedAt ?? null,
    }))
    .sort((a, b) => b.volume24h - a.volume24h || a.name.localeCompare(b.name));
}

export function companyShelf(universe: StockUniverse): CompanyShelf {
  return { companies: shelfCompanies(universe.rows), privateCompanies: shelfPrivateCompanies(universe.rows), fetchedAt: universe.fetchedAt };
}

/** Search the shelf by the company's name or the token's symbol. */
export function matchShelf(cards: readonly ShelfCard[], query: string): ShelfCard[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...cards];
  const score = (card: ShelfCard): number => {
    const name = card.name.toLowerCase();
    const ticker = card.ticker.toLowerCase();
    if (name === needle || ticker === needle) return 3;
    if (name.startsWith(needle) || ticker.startsWith(needle)) return 2;
    return name.includes(needle) || ticker.includes(needle) ? 1 : 0;
  };
  return cards
    .map((card) => ({ card, score: score(card) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.card.volume24h - a.card.volume24h)
    .map((entry) => entry.card);
}
