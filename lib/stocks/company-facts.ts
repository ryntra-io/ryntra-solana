/**
 * The company's own facts, from its SEC filings (`RYN-COMPANY-PAGE-001`).
 *
 * `company-facts.data.ts` is written by `scripts/stocks/company-facts.mjs`
 * from EDGAR — public-domain filings, read with the product's contact in the
 * User-Agent and dated by the read. Nothing here calls SEC; the page reads the
 * record for the company's ticker and computes what depends on the live price
 * (the market value, P/E, the dividend's yield) against the issuer's price for
 * one share. A figure the filings do not give is null and is not drawn — never
 * a zero, never a guess. A foreign issuer (20-F, 40-F) reports in its own
 * currency and per ordinary share, not per the depositary share that trades,
 * so its figures are not set against the price at all; a fund has no revenue
 * or earnings of its own and shows none.
 */

import { COMPANY_FACTS, COMPANY_FACTS_READ_AT } from "./company-facts.data.ts";
import { sectorLabel } from "./company-sectors.ts";

export type PeriodFigure = Readonly<{
  value: number;
  /** The last day of the period the figure covers. */
  end: string;
  /** `ttm` — the twelve months to `end`; `fy` — the fiscal year ending `end`; `ytd` — a company new to the filings: its latest report's `months`. */
  basis: "ttm" | "fy" | "ytd";
  months?: number;
}>;

export type CompanyFactsRecord = Readonly<{
  cik: string;
  /** The name as it stands in the SEC's records. */
  name: string | null;
  /** The Standard Industrial Classification code the company files under. */
  sic: string | null;
  kind: "operating" | "fund" | "other";
  /** Files annual reports as a foreign private issuer (20-F, 40-F). */
  foreign: boolean;
  exchange: string | null;
  city: string | null;
  /** A US state's code, or the SEC's code for a country. */
  region: string | null;
  /** The country's name where the business address is outside the US, as the SEC writes it. */
  foreignLocation: string | null;
  /** The fiscal year's last day, `MMDD`. */
  fiscalYearEnd: string | null;
  /** `outstanding` — the count the filing states; `diluted-average` — the latest quarter's diluted weighted average, where several classes state no total. */
  shares: Readonly<{
    value: number;
    asOf: string;
    classes: number;
    basis: "outstanding" | "diluted-average";
  }> | null;
  revenue: PeriodFigure | null;
  netIncome: PeriodFigure | null;
  /** Diluted earnings per share. */
  eps: PeriodFigure | null;
  /** Dividends declared per share. */
  dividend: PeriodFigure | null;
  report: Readonly<{
    form: string;
    filed: string;
    end: string | null;
    url: string;
  }> | null;
}>;

export { COMPANY_FACTS_READ_AT };

/**
 * Tickers whose traded class is not the class the filings count per share —
 * Berkshire's class B trades at about 1/1,500 of the class A its earnings per
 * share are stated for — so no per-share figure is set against their price.
 */
const PER_SHARE_MISMATCH = new Set(["BRK.B", "BRK.A"]);

export function companyFactsFor(symbol: string | null | undefined): CompanyFactsRecord | null {
  if (!symbol) return null;
  return COMPANY_FACTS[symbol.toUpperCase()] ?? null;
}

export type CompanyFigures = Readonly<{
  marketCapUsd: number | null;
  pe: number | null;
  revenue: PeriodFigure | null;
  netIncome: PeriodFigure | null;
  dividendYieldPct: number | null;
  sharesAsOf: string | null;
}>;

/**
 * What the page shows against the price of one share: the market value
 * (shares × price), P/E — the market value over the net income of twelve
 * months, only when both are known, the income is positive and the ratio is
 * sane — and the dividend's yield. Revenue and income stand whenever the
 * filings give them; nothing set against the price for a fund, a foreign
 * issuer or a mismatched class. A company new to the filings (no annual
 * figure yet) whose count is only the quarter's weighted average gets no
 * market value: a listing inside the quarter leaves that average short of the
 * shares now out (SpaceX listed on 12 June; its first 10-Q averaged the
 * quarter).
 */
export function companyFigures(symbol: string, facts: CompanyFactsRecord | null, pricePerShareUsd: number | null): CompanyFigures {
  const none: CompanyFigures = {
    marketCapUsd: null,
    pe: null,
    revenue: null,
    netIncome: null,
    dividendYieldPct: null,
    sharesAsOf: null,
  };
  if (!facts || facts.kind !== "operating" || facts.foreign) return none;
  const price = typeof pricePerShareUsd === "number" && Number.isFinite(pricePerShareUsd) && pricePerShareUsd > 0 ? pricePerShareUsd : null;
  const priced = price !== null && !PER_SHARE_MISMATCH.has(symbol.toUpperCase());
  const newListing = facts.shares?.basis === "diluted-average" && facts.revenue?.basis === "ytd";
  const marketCapUsd = priced && facts.shares && !newListing ? facts.shares.value * (price as number) : null;
  const income = facts.netIncome && facts.netIncome.basis !== "ytd" ? facts.netIncome.value : null;
  const pe = marketCapUsd !== null && income !== null && income > 0 ? marketCapUsd / income : null;
  const dividend = facts.dividend && facts.dividend.basis !== "ytd" ? facts.dividend.value : null;
  const dividendYieldPct = priced && dividend !== null && dividend > 0 ? (dividend / (price as number)) * 100 : null;
  return {
    marketCapUsd,
    pe: pe !== null && pe < 1000 ? pe : null,
    revenue: facts.revenue,
    netIncome: facts.netIncome,
    dividendYieldPct: dividendYieldPct !== null && dividendYieldPct < 25 ? dividendYieldPct : null,
    sharesAsOf: facts.shares?.asOf ?? null,
  };
}

const US_STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "Washington, D.C.",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  PR: "Puerto Rico",
};

/**
 * Where the company is based, as its filings write the address: «Santa Clara,
 * California, США» — the city and the state as proper names, the country in
 * the reader's language for the US; a foreign address as the SEC names it.
 */
export function headquartersLabel(facts: CompanyFactsRecord | null, lang: "en" | "uk"): string | null {
  if (!facts?.city) return null;
  if (facts.foreignLocation) return `${facts.city}, ${facts.foreignLocation}`;
  const state = facts.region ? US_STATE_NAMES[facts.region] : undefined;
  if (!state) return facts.city;
  return `${facts.city}, ${state}, ${lang === "uk" ? "США" : "US"}`;
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/* The genitive the Ukrainian phrase «до кінця …» takes. */
const MONTHS_UK_OF = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];

/** When the company's fiscal year closes: «до кінця січня» · «ends in January». */
export function fiscalYearEndWords(facts: CompanyFactsRecord | null, lang: "en" | "uk"): string | null {
  const month = facts?.fiscalYearEnd ? Number(facts.fiscalYearEnd.slice(0, 2)) : NaN;
  if (!(month >= 1 && month <= 12)) return null;
  return lang === "uk" ? `до кінця ${MONTHS_UK_OF[month - 1]}` : `ends in ${MONTHS_EN[month - 1]}`;
}

export { sectorLabel };
