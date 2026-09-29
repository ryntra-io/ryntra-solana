/**
 * Verified issuer events about pre-IPO tokens — the one place a state the
 * issuer announced (a conversion opened, redemption opened, a window closed)
 * is written down, with the notice, the read time, the issuer's own cut-off
 * and the date it is due for another look.
 *
 * The issuer publishes no such state in an API today (PreStocks
 * `/api/prestocks` lists mints and marks, nothing about a window), so the
 * registry is kept by hand and
 * versioned: an entry is added from the issuer's own notice, never from a
 * pool's quote or a symbol's presence. An empty registry means no event has
 * been verified — it never means every token is fine; the catalogue and the
 * chain still decide `active`, `paused` and `unknown` (`instrument.ts`).
 *
 * `recheckBy` is a promise to look again, not an expiry of the fact: a
 * state past its recheck date is still shown, and named as due for a check.
 * `deadline` is the issuer's own cut-off; a conversion window whose deadline
 * the clock has passed is read as `expired` whatever this file still says
 * (`eventStateAt`).
 *
 * The issuer's product pages are read again every day (the IPO and
 * conversion watch — `lib/monitoring/issuer-events.ts`, the pages in
 * `issuer-pages.ts`): a notice the registry does not carry, or a cut-off it
 * states differently, is reported for a person to verify and write here — the
 * registry itself is never rewritten by a parser.
 */

import type { LifecycleEvent } from "./instrument.ts";

export const LIFECYCLE_EVENTS_VERSION = "2026-09-25.2";

/** SpaceX's listed token the issuer points the swap to — xStocks' SPCXx, the one Ryntra offers. */
const SPCXX = { mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", symbol: "SPCXx", company: "SpaceX" } as const;
const SPACEX_MINT = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";

/**
 * PreStocks' own word on how a swap after an IPO works — «SpaceX PreStocks:
 * What Happens After IPO», 7 June 2026, the notice's «Learn more». Read on
 * 2026-09-25: the token becomes convertible into a tokenized public stock
 * equivalent; conversion happens through normal trading, fully onchain, no
 * KYC; the 5-for-1 split is accounted for (the mint's ×5); during the
 * six-month lockup the token trades at a discount to the public stock,
 * priced by the market; the deadlines — SPACEX 23:59 UTC on 12 March 2027,
 * XAI 23:59 UTC on 12 September 2026 — after which the tokens expire
 * worthless and are no longer supported. Ryntra's action is that ordinary
 * swap at the live quote; it promises no ratio.
 */
const PRESTOCKS_AFTER_IPO = { url: "https://x.com/PreStocks/status/2063623768535363940", publishedAt: "2026-06-07", readAt: "2026-09-25" } as const;

/**
 * Read on 2026-09-16 (08:30–08:55 UTC) from the issuers' own pages, and
 * again on 2026-09-25 (06:00 UTC) with the notice's «Learn more».
 *
 * PreStocks — the FAQ: a token converts into the tokenized public stock for
 * up to nine months after an IPO and expires worthless after the conversion
 * deadline; in an acquisition it converts into the acquirer's token by the
 * issuer's ratio, with its own deadline. Two products carry a live notice on
 * their product page:
 *
 * - **SPACEX** (`PreANxu…HsfTh`): *"SpaceX has gone public! SpaceX PreStocks
 *   tokens must be swapped into $SPCXx or any other token before 11:59pm UTC
 *   on 12 March 2027, or they will expire worthless."* SpaceX is listed
 *   (Pyth `Equity.US.SPCX/USD`; xStocks `SPCXx`, Backpack `SPCX`, Ondo
 *   `SPCXon` on the venue). The token still trades and still stands in the
 *   issuer's catalogue: a conversion window, open until the cut-off.
 * - **XAI** (`PreC1Kt…TwfTx`, the venue-verified mint; an `[OUTDATED]`
 *   migration mint `PreYPq1…FCwGS` also exists): *"xAI was acquired by
 *   SpaceX. Each XAI token must be swapped into 0.7165 SPACEX before 11:59pm
 *   UTC on 12 September 2026, or it will expire worthless."* The cut-off has
 *   passed; the token is no longer in the issuer's API. Recorded so that a
 *   purchase of the mint is refused on the Spot routes too, whatever a pool
 *   still quotes.
 *
 * The seven other companies' pages carried no notice on 2026-09-25
 * (`issuer-pages.ts`).
 *
 * Private companies come through PreStocks only since canon v5.2 (В25–В26);
 * the disconnected issuer's tokens are not events here but retired tokens
 * (`retired.ts`).
 */
export const LIFECYCLE_EVENTS: readonly LifecycleEvent[] = [
  {
    mint: SPACEX_MINT,
    state: "conversion-open",
    url: "https://www.prestocks.com/spacex",
    observedAt: "2026-09-25T06:00:00.000Z",
    recheckBy: "2026-12-01",
    deadline: "2027-03-12T23:59:00.000Z",
    note: "SpaceX has gone public. The issuer states SPACEX tokens must be swapped into SPCXx or any other token before 23:59 UTC on 12 March 2027, or they expire worthless.",
    watch: { symbol: "SPACEX", company: "SpaceX", cause: { kind: "ipo" }, into: SPCXX, mechanics: PRESTOCKS_AFTER_IPO },
  },
  {
    mint: "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx",
    state: "expired",
    url: "https://www.prestocks.com/xai",
    observedAt: "2026-09-25T06:00:00.000Z",
    recheckBy: "2026-12-01",
    deadline: "2026-09-12T23:59:00.000Z",
    note: "xAI was acquired by SpaceX. The issuer's swap window into SPACEX closed at 23:59 UTC on 12 September 2026; the issuer states unswapped tokens expire worthless.",
    watch: { symbol: "XAI", company: "xAI", cause: { kind: "acquisition", acquirer: "SpaceX" }, into: { mint: SPACEX_MINT, symbol: "SPACEX", company: "SpaceX" }, mechanics: PRESTOCKS_AFTER_IPO },
  },
];

const byMint = new Map(LIFECYCLE_EVENTS.map((event) => [event.mint, event]));

/** The verified event for a mint, or null — the only way the registry is read. */
export function lifecycleEventFor(mint: string, events: ReadonlyMap<string, LifecycleEvent> = byMint): LifecycleEvent | null {
  return events.get(mint) ?? null;
}

/* ------------------------------------------------------ the company's path */

/** A document a step of a company's path was read from — its own words, dated by the document and by Ryntra's read. */
export type PathSource = Readonly<{ label: string; url: string; publishedAt: string | null; readAt: string }>;

/**
 * A company that has left the private step (canon v5.2 В27, §7): the day its
 * shares first traded and the price they
 * were offered at, the exchange and the ticker, and the listed token on
 * Solana the issuer points the private token's swap to — each from the
 * company's own filings or a report of the day, with the read date. The
 * private token's own deadline stays on its event above; this record adds
 * only what the event does not say.
 */
export type CompanyPathRecord = Readonly<{
  company: string;
  /** The private token — its event above carries the swap window. */
  privateMint: string;
  ipo: Readonly<{ date: string; priceUsd: number }>;
  exchange: Readonly<{ name: string; ticker: string; since: string }>;
  solana: Readonly<{ mint: string; symbol: string; since: string }>;
  sources: readonly PathSource[];
}>;

/**
 * Read on 2026-09-25 from SpaceX's own SEC filings (CIK 1181412): the pricing
 * term sheet (FWP, filed 11 June 2026) — «Price to Public $135.00 per share ·
 * Trade Date June 12, 2026 · Closing Date June 15, 2026 · Symbol SPCX (Nasdaq
 * and Nasdaq Texas)»; the final prospectus (424B4, filed 12 June 2026, dated
 * 11 June) — «The initial public offering price is $135.00 per share … under
 * the symbol "SPCX"». The xStocks catalogue lists SPCXx on Solana for the
 * Nasdaq share SPCX, and SpaceX xStock was on Solana from the IPO's first
 * trading day (The Cryptonomist, 12 June 2026).
 */
export const COMPANY_PATHS: readonly CompanyPathRecord[] = [
  {
    company: "SpaceX",
    privateMint: SPACEX_MINT,
    ipo: { date: "2026-06-12", priceUsd: 135 },
    exchange: { name: "Nasdaq", ticker: "SPCX", since: "2026-06-12" },
    solana: { mint: SPCXX.mint, symbol: SPCXX.symbol, since: "2026-06-12" },
    sources: [
      { label: "SEC · FWP (pricing term sheet)", url: "https://www.sec.gov/Archives/edgar/data/1181412/000162828026042466/spaceexplorationtechnologi.htm", publishedAt: "2026-06-11", readAt: "2026-09-25" },
      { label: "SEC · 424B4 (prospectus)", url: "https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm", publishedAt: "2026-06-12", readAt: "2026-09-25" },
      { label: "PreStocks · SpaceX", url: "https://www.prestocks.com/spacex", publishedAt: null, readAt: "2026-09-25" },
      { label: "The Cryptonomist", url: "https://en.cryptonomist.ch/2026/06/12/tokenized-spacex-shares-solana/", publishedAt: "2026-06-12", readAt: "2026-09-25" },
    ],
  },
];

/**
 * The private step's date — the day each PreStocks token's first pool opened
 * on Solana, from Jupiter's token list (`firstPool.createdAt`), read on
 * 2026-09-25 for the eight tokens PreStocks lists. A token PreStocks adds
 * later stands at its first step without a date until it is read here.
 */
export const PRIVATE_SINCE: Readonly<Record<string, string>> = {
  PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB: "2025-09-16",
  Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw: "2025-09-16",
  PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd: "2026-09-05",
  PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua: "2026-01-22",
  PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S: "2026-04-16",
  PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF: "2025-09-16",
  Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP: "2026-02-05",
  [SPACEX_MINT]: "2025-09-16",
};

/** The private step's source: Jupiter's page of the token. */
export function privateSinceSource(mint: string): PathSource {
  return { label: "Jupiter", url: `https://jup.ag/tokens/${mint}`, publishedAt: null, readAt: "2026-09-25" };
}

/** PreStocks' rule for every private token: after an IPO, up to nine months to swap it (the FAQ, read 2026-09-25). */
export const PRESTOCKS_SWAP_RULE = { months: 9, source: { label: "PreStocks · FAQ", url: "https://www.prestocks.com/faq", publishedAt: null, readAt: "2026-09-25" } } as const satisfies Readonly<{ months: number; source: PathSource }>;

/** The path of the company whose private token or whose listed token on Solana this mint is, or null. */
export function companyPathRecordFor(mint: string, paths: readonly CompanyPathRecord[] = COMPANY_PATHS): CompanyPathRecord | null {
  return paths.find((path) => path.privateMint === mint || path.solana.mint === mint) ?? null;
}
