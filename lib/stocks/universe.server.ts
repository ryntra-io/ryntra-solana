/**
 * The stock universe — every representation Ryntra will show, with the
 * figures that belong on a screener row, assembled on the server and cached.
 *
 * Sources, each named on the row: the venue's verified universe (Jupiter
 * Tokens v2, through the Spot market registry) for identity and the token's
 * own market figures; the issuer's public catalogue for the underlying, the
 * exchange, the session and the reference quote where the issuer publishes
 * one (xStocks); the units — the Scaled UI Amount multiplier — from the chain
 * itself, for every issuer alike, in one batched read. A representation an
 * issuer does not list is not here.
 *
 * A screener row's reference is a cached issuer quote with its fetch time; it
 * is never presented as an executable price. The executable, size-aware
 * quote lives in `quote.server.ts` and is asked for on the asset page.
 *
 * ## Three caches, one build
 *
 * The build asks four providers and costs seconds; the person asking for the
 * page must not pay them. Three layers stand between the two:
 *
 * 1. the process memory, a minute fresh and fifteen minutes of grace — the
 *    same instance answers from what it built;
 * 2. the platform's data cache (`unstable_cache`), shared by every instance
 *    of the deployment — a cold instance reads the universe another one
 *    built, in milliseconds, and after a minute the next request serves the
 *    kept copy and rebuilds in the background;
 * 3. the build itself, single-flight, so ten arrivals at once cost one.
 *
 * A rebuild is background work. While the provider's own rate headers say
 * the window is nearly spent (`jupiter-budget.ts`), an instance that holds a
 * copy inside the grace serves it and does not touch the shared layer — a
 * touch there is what starts a revalidation, and a rebuild that runs into an
 * exhausted window is refused while a person's quote in the same second is
 * the request that pays for it. Measured on 2026-09-15.
 *
 * A build that fails is never cached: the platform layer is fed by a callback
 * that throws on failure, the memory keeps its last good copy inside the
 * grace, and the page reads a stated failure only when there is nothing
 * true to show. Outside a Next request (tests, scripts) the platform layer is
 * absent and the memory and the build do the work alone.
 */

import { unstable_cache } from "next/cache.js";

import { jupiterBackgroundAllowed } from "../solana/jupiter-budget.ts";
import { listSpotMarkets, readSpotMarketsByMint } from "../spot/markets.server.ts";
import type { SpotMarket } from "../spot/markets.ts";
import { lifecycleOf, markPremiumPct, type IssuerMark, type Lifecycle, type LifecycleEvent, type TransferFee } from "./instrument.ts";
import { indexPreStocksAssets, PRESTOCKS_SOURCE, readPreStocksCatalogueShared, type PreStocksAsset } from "./issuer-prestocks.server.ts";
import { peekXStocksQuote, QUOTE_TIMEOUT_MS, readXStocksAssets, readXStocksQuote, XSTOCKS_SOURCE } from "./issuer-xstocks.server.ts";
import { companyPathFor, type CompanyPath } from "./company-path.ts";
import { lifecycleEventFor } from "./lifecycle-events.ts";
import { PYTH_SOURCE, pythFeedForUsListing, pythIndexFeedForCompany, pythPriceAccess, readPythEquityCatalogue, readPythLatestMany, type PythPrice, type PythPriceFailure } from "./pyth.server.ts";
import { readCurrentEpoch, readMintMultiplier, readOnchainMintCached, transferFeeFromMint, warmOnchainMints } from "./asset.server.ts";
import { buildRepresentation, indexIssuerAssets, matchesTicker, type IssuerCatalogues, type StockRepresentation } from "./representations.ts";
import { retiredTokenFor } from "./retired.ts";
import { REFERENCE_UNAVAILABLE, referenceState, sessionFromIssuer, UNKNOWN_SESSION, type Reference, type Session } from "./session.ts";
import { deviationPct, multiplierState, type Multiplier, type MultiplierState } from "./units.ts";

const UNIVERSE_TTL_MS = 60 * 1000;
/**
 * How long the memory's last complete copy is still served when a rebuild
 * fails. An hour: the rows carry their own times and the strip states when
 * the market was last read, so an old complete list is an honest answer; a
 * partial one never is (see the build).
 */
const UNIVERSE_GRACE_MS = 60 * 60 * 1000;
/** The platform layer's own age; after it the kept copy is served and rebuilt behind. */
export const UNIVERSE_SHARED_REVALIDATE_S = 60;
const LIST_LIMIT = 400;
/** The venue answers one hundred mints per search. */
const MINT_LOOKUP_LIMIT = 100;
/**
 * How long one build waits for the issuers' references, all rows together
 * (since 2026-09-20). The reference is context on a row; the universe is the
 * list of confirmed representations, and a list whose issuer went silent is
 * still the list. Inside the budget a row asks the issuer with whatever window
 * is left; past it a row takes the cached answer if one is fresh and otherwise
 * states that the reference did not arrive in time — never a figure from
 * anywhere else. Fifteen seconds covers a cold instance on an ordinary day
 * (about a hundred and twenty xStocks rows, eight at a time, well under a
 * second each) and leaves the route's thirty seconds room for the venue, the
 * catalogues and the chain.
 */
export const ISSUER_QUOTE_BUDGET_MS = 15_000;
/** Less than this left of the budget is not worth an ask; the cache decides. */
const QUOTE_MIN_WAIT_MS = 250;

export type StockRow = Readonly<{
  representation: StockRepresentation;
  market: Readonly<{
    /**
     * Per token **as the wallet shows it** — the scaled UI unit — in USD, the
     * venue's figure. For a mint with the Scaled UI Amount extension this is
     * the price of one scaled unit, not of one raw base token: measured on
     * 2026-09-16 against the issuers' own references (SPYx 760.11 vs 759.02
     * at ×1.0057, NFLXx 75.81 vs 77.79 at ×10, AZNx 157.25 vs 163.68 at
     * ×0.511) and against a venue quote ($100 → 0.171 base = 0.856 scaled
     * SPACEX at ×5, $114 each). Until that day the list divided this figure
     * by the multiplier once more and drew a −90 % deviation on NFLXx.
     */
    priceUsd: number | null;
    change24hPct: number | null;
    volume24hUsd: number | null;
    liquidityUsd: number | null;
    verified: boolean;
    observedAt: string | null;
    icon: string | null;
  }>;
  /**
   * Per underlying share, USD, on the list basis — the venue's per-unit price
   * where the instrument's unit is a share; null where it is a token (the
   * pre-IPO issuers), because no share figure exists to state.
   */
  tokenPerShareUsd: number | null;
  multiplier: Multiplier | null;
  multiplierState: MultiplierState | null;
  reference: Reference;
  session: Session;
  /** The deviation on the *list* basis: token per-share against the reference. An estimate for orientation, not a quote. */
  deviationPct: number | null;
  /** The issuer's own mark of the token and the company, for a pre-IPO instrument; null for the listed issuers. */
  issuerMark: IssuerMark | null;
  /** The token's market price against the issuer's mark of one token, per cent — context, never a deviation from a market reference. */
  markPremiumPct: number | null;
  /**
   * Pyth's 24/7 index for the company behind a pre-IPO instrument — in Pyth's
   * own words an informational, indicative, company-level indicator: not a
   * stock price, not a valuation, not a price anything can be bought at.
   * Context for the company, with its own state; never the row's `reference`,
   * never set against the token's price (a pre-IPO token is priced per token,
   * not per share, so the two have no common unit). Null where the instrument
   * is not pre-IPO or Pyth publishes no index for the company.
   */
  companyIndex: CompanyIndex | null;
  /** The transfer fee the mint withholds on every transfer, from the chain; null when the mint charges none or could not be read. */
  transferFee: TransferFee | null;
  /** Where the token stands in its issuer's life for it — whether a new purchase is what the issuer supports. */
  lifecycle: Lifecycle;
  /** «Шлях компанії» — the company's way from a private token to its stock on Solana and this token's step on it (`company-path.ts`); null where the strip has nothing to say. */
  companyPath: CompanyPath | null;
}>;

/** The state of a company index judged from the feed's own publish time; an index is always open, so *current* or *stale* or nothing. */
export type CompanyIndexState = "current" | "stale" | "unavailable";

export type CompanyIndex = Readonly<{
  source: typeof PYTH_SOURCE;
  /** The index's display symbol on Pyth, e.g. `OPENAI`; the feed is `Equity.Index.<symbol>/USD`. */
  symbol: string;
  feedId: string;
  /** The index's USD value as Pyth publishes it; null when the feed did not answer. */
  valueUsd: number | null;
  state: CompanyIndexState;
  /** The feed's own publish time. */
  observedAt: string | null;
  fetchedAt: string | null;
  /** Why there is no value, in the feed's words (no key, a refusal, no parsed price); null when there is one. */
  note: string | null;
}>;

/** The company index's stale line — a 24/7 feed that has not published for this long is not current. */
export const COMPANY_INDEX_STALE_AFTER_MS = 15 * 60 * 1000;

/** How one issuer's catalogue answered on this build. */
export type IssuerCatalogueState = Readonly<{ ok: boolean; stale: boolean; fetchedAt: string | null; reason: string | null }>;

export type StockUniverse = Readonly<{
  rows: readonly StockRow[];
  /** When the venue's list was read. */
  marketsObservedAt: string;
  /** Whether the xStocks catalogue answered; without it xStocks rows are absent and the universe says so. Kept for the readers that predate `issuerCatalogues`. */
  issuerCatalogue: Readonly<{ ok: boolean; reason: string | null }>;
  /** Every issuer catalogue on this build: answered, served stale under grace, or failed with its reason. */
  issuerCatalogues: Readonly<Record<"xstocks" | "prestocks", IssuerCatalogueState>>;
  fetchedAt: string;
}>;

const CATALOGUE_OK: IssuerCatalogueState = { ok: true, stale: false, fetchedAt: null, reason: null };
/** The shape's default for a universe built before the pre-IPO issuer joined (tests, primed copies). */
export const DEFAULT_CATALOGUES: StockUniverse["issuerCatalogues"] = { xstocks: CATALOGUE_OK, prestocks: CATALOGUE_OK };

export type UniverseFailure = Readonly<{ ok: false; code: string; reason: string }>;
export type UniverseRead = { ok: true; universe: StockUniverse } | UniverseFailure;

let universeCache: { value: StockUniverse; at: number } | null = null;
let universeInflight: Promise<UniverseRead> | null = null;

export function resetStockUniverseCache(): void {
  universeCache = null;
  universeInflight = null;
  sharedBuild = null;
  lastBuildFailure = null;
}

/** Tests only: a universe already built, as the memory would hold it. */
export function primeStockUniverse(universe: StockUniverse, atMs: number): void {
  universeCache = { value: universe, at: atMs };
}

async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** What the market feed says for a row that is not xStocks: the feed it matched, and its answer. */
export type PythFacts = Readonly<{
  /** The exchange feed's answer for a US-listed underlying; null on a row that matched no listing. */
  price: PythPrice | PythPriceFailure | null;
  /** The 24/7 index for the company behind a pre-IPO row: the feed and its answer; null where Pyth indexes no such company. */
  index?: Readonly<{ symbol: string; feedId: string; price: PythPrice | PythPriceFailure }> | null;
}>;

/** The company index as the row carries it, judged now from the feed's own publish time. */
export function companyIndexOf(index: NonNullable<PythFacts["index"]>, nowMs: number): CompanyIndex {
  const base = { source: PYTH_SOURCE, symbol: index.symbol, feedId: index.feedId };
  if (!index.price.ok) return { ...base, valueUsd: null, state: "unavailable", observedAt: null, fetchedAt: null, note: index.price.reason };
  const state = referenceState({ perShare: index.price.price, fetchedAt: index.price.publishTime, exchangeOpen: true, nowMs, staleAfterMs: COMPANY_INDEX_STALE_AFTER_MS });
  return {
    ...base,
    valueUsd: index.price.price,
    state: state === "current" ? "current" : state === "unavailable" ? "unavailable" : "stale",
    observedAt: index.price.publishTime,
    fetchedAt: index.price.fetchedAt,
    note: null,
  };
}

/** The facts a pre-IPO row is built with beside the venue's: the issuer's mark, the chain's epoch, a verified event. */
export type RowFacts = Readonly<{
  issuerMark?: IssuerMark | null;
  /** The chain's current epoch, for the transfer fee in force; null when it was not read. */
  epoch?: bigint | null;
  event?: LifecycleEvent | null;
  /** Whether the issuer's catalogue names this mint on this build, and when it was read. */
  listedByIssuer?: boolean;
  catalogueFetchedAt?: string | null;
  /** The wall-clock moment after which this build no longer asks the issuer for a reference; a fresh cached answer is still used. Null: no budget. */
  quoteDeadlineMs?: number | null;
}>;

/** The issuer's mark for one PreStocks product, as the row carries it. */
export function preStocksMark(asset: PreStocksAsset, fetchedAt: string, stale: boolean): IssuerMark {
  return {
    source: PRESTOCKS_SOURCE,
    perUnit: asset.mark.markPriceUsd,
    valuationUsd: asset.mark.markValuationUsd,
    impliedValuationUsd: asset.mark.impliedValuationUsd,
    supply: asset.mark.supply,
    holders: null,
    observedAt: null,
    fetchedAt,
    stale,
  };
}

/** Build one screener row from a market and, for xStocks, the issuer's facts; for a US-listed underlying of another issuer, the market feed's. */
export async function buildStockRow(market: SpotMarket, representation: StockRepresentation, issuerFacts: Readonly<{ trading: Parameters<typeof sessionFromIssuer>[0] } | null>, nowMs: number, pyth: PythFacts | null = null, facts: RowFacts = {}): Promise<StockRow> {
  let reference: Reference = REFERENCE_UNAVAILABLE;
  let session: Session = issuerFacts ? sessionFromIssuer(issuerFacts.trading) : UNKNOWN_SESSION;

  /* The issuer's reference is asked for where the token has a market to set
     against it; a mint without a venue price has no deviation to draw, and
     the asset page reads its own reference when it is opened. */
  if (representation.issuer.id === "xstocks" && market.price !== null) {
    /* Inside the build's budget the issuer is asked with the window that is
       left; past it the cached answer stands if it is fresh, and otherwise
       the row says the reference did not arrive in time. The asset page
       asks on its own when it is opened. */
    const remainingMs = facts.quoteDeadlineMs == null ? null : facts.quoteDeadlineMs - Date.now();
    const quote = remainingMs !== null && remainingMs < QUOTE_MIN_WAIT_MS
      ? (peekXStocksQuote(representation.symbol) ?? { ok: false as const, code: "NETWORK" as const, reason: "The issuer's reference did not arrive in time for this list; open the asset to ask again." })
      : await readXStocksQuote(representation.symbol, remainingMs === null ? {} : { timeoutMs: Math.min(QUOTE_TIMEOUT_MS, remainingMs) });
    if (quote.ok) {
      const state = referenceState({ perShare: quote.quote, fetchedAt: quote.fetchedAt, exchangeOpen: session.exchangeOpen, nowMs });
      reference = {
        state,
        perShare: quote.quote,
        currency: quote.currency,
        source: XSTOCKS_SOURCE,
        observedAt: null,
        fetchedAt: quote.fetchedAt,
        note: state === "last-available" ? "The issuer's reference while the exchange is closed; not an official close." : null,
      };
    } else {
      reference = { ...REFERENCE_UNAVAILABLE, source: XSTOCKS_SOURCE, note: quote.reason };
    }
  }

  /* The chain states the units for every issuer alike — the Scaled UI Amount
     configuration, or one-to-one when the mint carries no such extension.
     The universe warms the mint cache in one batched read first, so this is
     a lookup; the issuer's own multiplier is read on the asset page, where
     the two are compared. */
  const multiplier = await readMintMultiplier(market.mint, nowMs);

  if (session.source === "none" && representation.underlying.symbol) {
    /* No issuer session: the feed catalogue still knows the exchange calendar. */
    const catalogue = await readPythEquityCatalogue();
    const feed = catalogue.ok ? catalogue.bySymbol.get(representation.underlying.symbol) : undefined;
    if (feed && feed.marketHours.isOpen !== null) {
      session = { period: feed.marketHours.isOpen ? "market" : "closed", exchangeOpen: feed.marketHours.isOpen, nextChangeAt: feed.marketHours.isOpen ? feed.marketHours.nextClose : feed.marketHours.nextOpen, exchange: null, source: "feed-catalogue" };
    }
  }

  /* The issuer's own reference comes first; where the issuer publishes none
     and the underlying is the same ticker on the US listing, the market feed
     states one, with its own publish time deciding whether it is current,
     last available or stale. A feed that did not answer — no key, a refusal,
     no such feed — leaves the reference UNAVAILABLE and named: context is
     stated or absent, never inferred. Execution never reads this. */
  if (representation.issuer.id !== "xstocks" && pyth && pyth.price) {
    if (pyth.price.ok) {
      const state = referenceState({ perShare: pyth.price.price, fetchedAt: pyth.price.publishTime, exchangeOpen: session.exchangeOpen, nowMs });
      reference = {
        state,
        perShare: pyth.price.price,
        currency: "USD",
        source: PYTH_SOURCE,
        observedAt: pyth.price.publishTime,
        fetchedAt: pyth.price.fetchedAt,
        note: state === "last-available" ? "The feed's last price while the exchange is closed; not an official close." : null,
      };
    } else {
      reference = { ...REFERENCE_UNAVAILABLE, source: PYTH_SOURCE, note: pyth.price.reason };
    }
  }

  /* The venue prices the scaled unit (see `market.priceUsd`); where that unit
     is a share, the per-share figure is the price itself — read only when the
     chain stated the multiplier, so a mint nobody could read draws no
     per-share figure and no deviation. A pre-IPO instrument has no share
     figure at all. */
  const price = market.price !== null && Number.isFinite(market.price) && market.price > 0 ? market.price : null;
  const instrument = representation.instrument ?? { class: "listed-equity" as const, unitBasis: "share" as const, rights: "issuer-terms" as const };
  const tokenPerShareUsd = instrument.unitBasis === "share" && multiplier ? price : null;
  /* A private company has no exchange reference: for a pre-IPO row the reference stays unavailable and says why,
     whatever feed a look-alike ticker might have matched. */
  if (instrument.class === "pre-ipo") {
    reference = { ...REFERENCE_UNAVAILABLE, note: "A private company has no exchange reference; the issuer's mark is shown separately and is not a market price." };
  }
  const onchain = await readOnchainMintCached(market.mint);
  const transferFee = transferFeeFromMint(onchain, facts.epoch ?? null);
  const lifecycle = lifecycleOf({
    paused: "error" in onchain ? null : (onchain.pausable?.paused ?? null),
    event: facts.event ?? lifecycleEventFor(market.mint),
    listedByIssuer: facts.listedByIssuer ?? representation.issuerConfirmation === "issuer-catalogue",
    catalogueFetchedAt: facts.catalogueFetchedAt ?? null,
    chainObservedAt: "error" in onchain ? null : onchain.observedAt,
    nowMs,
  });
  const issuerMark = facts.issuerMark ?? null;
  /* The company's 24/7 index is context for a pre-IPO row only: a listed
     company's index sits beside its exchange feed and adds nothing here. */
  const companyIndex = instrument.class === "pre-ipo" && pyth?.index ? companyIndexOf(pyth.index, nowMs) : null;
  return {
    representation,
    market: {
      priceUsd: market.price,
      change24hPct: market.change24hPct,
      volume24hUsd: market.volume24hUsd,
      liquidityUsd: market.liquidityUsd,
      verified: market.verified,
      observedAt: market.updatedAt,
      icon: market.icon,
    },
    tokenPerShareUsd,
    multiplier,
    multiplierState: multiplier ? multiplierState(multiplier, nowMs) : null,
    reference,
    session,
    deviationPct: deviationPct(tokenPerShareUsd, reference.perShare),
    issuerMark,
    markPremiumPct: markPremiumPct(price, issuerMark?.perUnit ?? null),
    companyIndex,
    transferFee,
    lifecycle,
    companyPath: companyPathFor({ mint: market.mint, symbol: representation.symbol, issuerId: representation.issuer.id, instrumentClass: instrument.class }, nowMs),
  };
}

/** The venue's full rows for every mint, a hundred per read, in order. */
async function readMarketsInChunks(mints: readonly string[]): Promise<{ ok: true; byMint: Map<string, SpotMarket> } | UniverseFailure> {
  const byMint = new Map<string, SpotMarket>();
  for (let start = 0; start < mints.length; start += MINT_LOOKUP_LIMIT) {
    const chunk = mints.slice(start, start + MINT_LOOKUP_LIMIT);
    const read = await readSpotMarketsByMint(chunk);
    if (!read.ok) return { ok: false, code: `MARKETS_${read.code}`, reason: read.reason };
    for (const [mint, market] of read.byMint) byMint.set(mint, market);
  }
  return { ok: true, byMint };
}

/**
 * The build: the venue's list, the issuer's catalogue and the feed calendar
 * asked for together; the venue's full rows and the chain's mints in
 * batches; then one row per confirmed representation with the issuer's
 * reference where there is one. No cache of its own — the readers below
 * decide what is kept.
 */
export async function buildStockUniverse(deps: Readonly<{ now?: () => Date; quoteBudgetMs?: number }> = {}): Promise<UniverseRead> {
  /* Four providers asked together: the venue, the two issuer catalogues and
     the feed calendar; the chain's epoch beside them. The pre-IPO catalogue
     is not the universe's condition — a slow PreStocks leaves its own rows
     absent (or served stale under grace) and the universe says so, never the
     whole market. Private companies come through PreStocks only: no other
     pre-IPO issuer is read. */
  const [listed, catalogue, feeds, prestocks, epoch] = await Promise.all([listSpotMarkets("stock", LIST_LIMIT), readXStocksAssets(), readPythEquityCatalogue(), readPreStocksCatalogueShared(), readCurrentEpoch()]);
  if (!listed.ok) return { ok: false, code: `MARKETS_${listed.code}`, reason: listed.reason };
  /* The ranked lists alone are not the universe. When the venue's verified
     list did not answer, the stock view is a few dozen traded rows with the
     list marked partial — a build from it would be cached as the whole
     market and the page would state "Listed 36" as a fact. Seen on
     production on 2026-09-15 (a cold instance's verified read failed; the
     36-row copy then served for minutes). A partial list is a failed build:
     nothing false is kept, and the readers serve the last complete copy. */
  if (listed.partial) return { ok: false, code: "MARKETS_PARTIAL", reason: "The venue's verified list did not answer; the ranked lists alone are not the stock universe." };
  /* The same rule for the issuer's catalogue: without it every xStocks
     representation — a quarter of the market — is absent, and a copy built
     that way was cached and served for minutes on 2026-09-15 (280 rows, the
     asset page answering not-found for NVDAx). A universe without an issuer's
     listing is not the universe; the last complete copy is served instead. */
  if (!catalogue.ok) return { ok: false, code: `ISSUER_CATALOGUE_${catalogue.code}`, reason: `The issuer's catalogue did not answer: ${catalogue.reason}` };
  const mints = listed.rows.map((row) => row.mint);
  const full = await readMarketsInChunks(mints);
  if (!full.ok) return full;
  const issuerByMint = indexIssuerAssets(catalogue.assets);
  const catalogues: IssuerCatalogues = {
    xstocks: issuerByMint,
    prestocks: prestocks.ok ? indexPreStocksAssets(prestocks.assets) : null,
  };
  const pairs: Array<{ market: SpotMarket; representation: StockRepresentation }> = [];
  for (const mint of mints) {
    const market = full.byMint.get(mint);
    if (!market) continue;
    const representation = buildRepresentation(market, catalogues);
    if (representation) pairs.push({ market, representation });
  }
  await warmOnchainMints(pairs.map((pair) => pair.market.mint));
  const now = (deps.now ?? (() => new Date()))();
  /* The market feed for every listed-equity row of a non-xStocks issuer whose
     underlying is the same ticker on the US listing, read once for all of
     them. A pre-IPO row asks for none: a private company has no feed, and a
     token symbol that happens to spell a listed ticker is not that listing.
     Without the key nothing is asked and every such row states NO_KEY; the
     build never fails for the feed — the reference is context, the universe
     is not. */
  const feedByMint = new Map<string, string>();
  /* And, for a pre-IPO row, Pyth's 24/7 index of the company behind the
     token where one exists — context with its own state, read in the same
     batch, never the row's reference. */
  const indexByMint = new Map<string, { symbol: string; feedId: string }>();
  if (feeds.ok) {
    for (const { market, representation } of pairs) {
      if (representation.issuer.id === "xstocks") continue;
      if (representation.instrument.class === "pre-ipo") {
        const index = pythIndexFeedForCompany(feeds.indexBySymbol, representation.companyKey);
        if (index) indexByMint.set(market.mint, { symbol: index.displaySymbol, feedId: index.id.toLowerCase() });
        continue;
      }
      const feed = pythFeedForUsListing(feeds.bySymbol, representation.underlying.symbol);
      if (feed) feedByMint.set(market.mint, feed.id.toLowerCase());
    }
  }
  const wantedFeedIds = [...new Set([...feedByMint.values(), ...[...indexByMint.values()].map((index) => index.feedId)])];
  const prices = wantedFeedIds.length > 0 && pythPriceAccess().enabled ? await readPythLatestMany(wantedFeedIds) : new Map<string, PythPrice | PythPriceFailure>();
  /* One budget for every issuer reference on this build, counted from here. */
  const quoteDeadlineMs = Date.now() + (deps.quoteBudgetMs ?? ISSUER_QUOTE_BUDGET_MS);
  const rows = await mapLimited(pairs, 8, ({ market, representation }) => {
    const asset = issuerByMint.get(market.mint);
    const feedId = feedByMint.get(market.mint);
    const index = indexByMint.get(market.mint);
    const noKey: PythPriceFailure = { ok: false, code: "NO_KEY", reason: "Hermes needs a Pyth API key for price updates; none is configured." };
    const pyth: PythFacts | null = feedId || index
      ? {
          price: feedId ? (prices.get(feedId) ?? noKey) : null,
          index: index ? { symbol: index.symbol, feedId: index.feedId, price: prices.get(index.feedId) ?? noKey } : null,
        }
      : null;
    /* The issuer's own mark and the catalogue's read time, for the pre-IPO rows. */
    let facts: RowFacts = { epoch, quoteDeadlineMs };
    const pre = catalogues.prestocks?.get(market.mint);
    if (pre && prestocks.ok) facts = { ...facts, issuerMark: preStocksMark(pre, prestocks.fetchedAt, prestocks.stale), listedByIssuer: true, catalogueFetchedAt: prestocks.fetchedAt };
    else if (asset) facts = { ...facts, listedByIssuer: true, catalogueFetchedAt: catalogue.fetchedAt };
    return buildStockRow(market, representation, asset ? { trading: asset.trading } : null, now.getTime(), pyth, facts);
  });
  rows.sort((a, b) => (b.market.volume24hUsd ?? -1) - (a.market.volume24hUsd ?? -1));
  const state = (read: { ok: true; fetchedAt: string; stale: boolean } | { ok: false; reason: string }): IssuerCatalogueState =>
    read.ok ? { ok: true, stale: read.stale, fetchedAt: read.fetchedAt, reason: null } : { ok: false, stale: false, fetchedAt: null, reason: read.reason };
  return {
    ok: true,
    universe: {
      rows,
      marketsObservedAt: listed.observedAt,
      issuerCatalogue: { ok: true, reason: null },
      issuerCatalogues: { xstocks: { ok: true, stale: false, fetchedAt: catalogue.fetchedAt, reason: null }, prestocks: state(prestocks) },
      fetchedAt: now.toISOString(),
    },
  };
}

/** After a failed build, no new build starts on this instance for this long; the last good copy is served meanwhile. */
export const BUILD_COOLDOWN_MS = 15_000;
let sharedBuild: Promise<StockUniverse> | null = null;
let lastBuildFailure: { at: number; message: string } | null = null;

/**
 * The one build behind the platform layer, coalesced per instance.
 *
 * The platform revalidates a stale entry in the background of every request
 * that reads it, and each request's revalidation is its own — so while a
 * rebuild kept failing, every arrival started another one, each spending
 * the provider's window on the same refused list (the storm seen on
 * 2026-09-15). Here all of them wait on one build, and after a failure no
 * build starts for a cool-down: the refusal is repeated from memory, nothing
 * is spent, the stale entry stays, and the next attempt is one attempt.
 * Throwing is the contract with the platform layer: a failed build is never
 * cached.
 */
export async function buildSharedUniverse(deps: Readonly<{ now?: () => number; build?: typeof buildStockUniverse }> = {}): Promise<StockUniverse> {
  const now = deps.now ?? Date.now;
  if (sharedBuild) return sharedBuild;
  if (lastBuildFailure && now() - lastBuildFailure.at < BUILD_COOLDOWN_MS) throw new Error(lastBuildFailure.message);
  sharedBuild = (async () => {
    const built = await (deps.build ?? buildStockUniverse)();
    if (!built.ok) {
      lastBuildFailure = { at: now(), message: `${built.code}: ${built.reason}` };
      throw new Error(lastBuildFailure.message);
    }
    lastBuildFailure = null;
    return built.universe;
  })().finally(() => {
    sharedBuild = null;
  });
  return sharedBuild;
}

/* The platform layer. The callback throws on a failed build so nothing false
   is ever kept; the key names the shape's version so a changed row shape is
   a new entry rather than an old one read into new code. v4: a copy built
   while a disconnected issuer's rows were still in the universe is never
   served again — the platform's data cache outlives a deployment. */
const readSharedUniverse = unstable_cache(
  (): Promise<StockUniverse> => buildSharedUniverse(),
  ["stock-universe", "v4"],
  { revalidate: UNIVERSE_SHARED_REVALIDATE_S, tags: ["stock-universe"] },
);

/** Next refuses the platform layer outside a request; that is the signal to build here. */
const isOutsideNext = (failure: unknown): boolean => failure instanceof Error && /incrementalCache missing/.test(failure.message);

/**
 * The whole universe: memory first, then the deployment's shared copy, then
 * the build — single-flight, and never a false answer cached.
 */
export function readStockUniverse(): Promise<UniverseRead> {
  const nowMs = Date.now();
  if (universeCache && nowMs - universeCache.at < UNIVERSE_TTL_MS) return Promise.resolve({ ok: true, universe: universeCache.value });
  if (universeCache && nowMs - universeCache.at < UNIVERSE_GRACE_MS && !jupiterBackgroundAllowed(nowMs)) {
    return Promise.resolve({ ok: true, universe: universeCache.value });
  }
  if (universeInflight) return universeInflight;
  universeInflight = (async (): Promise<UniverseRead> => {
    let read: UniverseRead;
    try {
      read = { ok: true, universe: await readSharedUniverse() };
    } catch (failure) {
      if (isOutsideNext(failure)) {
        read = await buildStockUniverse();
      } else {
        const message = failure instanceof Error ? failure.message : String(failure);
        const [code, ...rest] = message.split(": ");
        read = { ok: false, code: rest.length > 0 ? code : "BUILD_FAILED", reason: rest.length > 0 ? rest.join(": ") : message };
      }
    }
    if (read.ok) {
      universeCache = { value: read.universe, at: Date.parse(read.universe.fetchedAt) || Date.now() };
      return read;
    }
    /* A failed rebuild inside the grace serves the last good copy — the rows
       carry their own times, so nothing pretends to be fresher than it is. */
    if (universeCache && Date.now() - universeCache.at < UNIVERSE_GRACE_MS) return { ok: true, universe: universeCache.value };
    return read;
  })().finally(() => {
    universeInflight = null;
  });
  return universeInflight;
}

/** One row by token symbol or mint, from the cached universe. */
export async function findStockRow(ticker: string): Promise<{ ok: true; row: StockRow | null; universe: StockUniverse } | UniverseFailure> {
  const read = await readStockUniverse();
  if (!read.ok) return read;
  return findRowIn(read.universe, ticker);
}

/**
 * One row by token symbol or mint, from a universe already read. A copy
 * without every issuer's catalogue cannot say a ticker does not exist — it
 * can only say it does not know; that is a provider answer, never a 404.
 * The pre-IPO catalogue counts too: a copy built while an issuer's API
 * failed holds none of its rows, and a person asking for one of them was
 * told the stock does not exist (seen on a cold build on 2026-09-23). A
 * token Ryntra no longer supports is never a row, whatever the catalogues
 * said (`retired.ts`).
 */
export function findRowIn(universe: StockUniverse, ticker: string): { ok: true; row: StockRow | null; universe: StockUniverse } | UniverseFailure {
  const row = universe.rows.find((candidate) => matchesTicker(candidate.representation, ticker)) ?? null;
  if (row !== null) return { ok: true, row, universe };
  if (retiredTokenFor(ticker) !== null) return { ok: true, row: null, universe };
  const catalogues = universe.issuerCatalogues ?? DEFAULT_CATALOGUES;
  const silent = [!universe.issuerCatalogue.ok || !catalogues.xstocks.ok ? "xStocks" : null, !catalogues.prestocks.ok ? "PreStocks" : null].filter((name): name is string => name !== null);
  if (silent.length > 0) {
    return { ok: false, code: "ISSUER_CATALOGUE_UNAVAILABLE", reason: `The issuer's catalogue did not answer (${silent.join(", ")}), so the asset cannot be confirmed right now.` };
  }
  return { ok: true, row: null, universe };
}
