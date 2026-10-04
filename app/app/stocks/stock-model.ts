import type { HelpTopicId } from "@/app/shell/help-topics";
import type { WorkspaceLocale } from "@/app/shell/locale";
import type { InstrumentClass, UnitBasis } from "@/lib/stocks/instrument";
import type { StockIssuerId } from "@/lib/stocks/representations";
import { referenceStateOf, REFERENCE_STATE_WORDS, SESSION_WORDS, type ReferenceState, type SessionPeriod } from "../../../lib/stocks/session.ts";
import type { StockRow, StockUniverse } from "@/lib/stocks/universe.server";

/**
 * The stock surface's own model: the slim row the browser draws, the
 * collections Discover offers, the figures the strip above the list carries,
 * and every word the surface says in both languages.
 *
 * The universe row is the server's — four hundred of them weigh half a
 * megabyte with their sources and notes. The browser needs what it draws:
 * the identity, the figures, the states. Nothing here computes a figure the
 * server did not; the one derivation is the reference's *state*, judged
 * again at render from the fetch time, so a copy served from the shared
 * cache a minute later cannot call a stale figure current.
 */

export type SlimStockRow = Readonly<{
  mint: string;
  symbol: string;
  /** The company or fund, from the issuer where it names it, else the token's own name. */
  name: string;
  issuer: StockIssuerId;
  /** A listed equity or ETF, or pre-IPO exposure — the class the Pre-IPO filter reads. */
  kind: InstrumentClass;
  /** The unit the price is in: a share, or one token as the wallet shows it. */
  unitBasis: UnitBasis;
  /** Whether the issuer offers a new purchase — false for a paused, redeem-only or expired token. */
  tradable: boolean;
  /** The issuer's own mark of one token, USD, for a pre-IPO instrument; null otherwise. Not a reference. */
  mark: number | null;
  icon: string | null;
  halted: boolean;
  /** Per token as the wallet shows it (the scaled unit), USD, the venue's figure. */
  price: number | null;
  change24h: number | null;
  /** The issuer's reference per share, USD; null where the issuer publishes none. */
  reference: number | null;
  referenceState: ReferenceState;
  referenceAt: string | null;
  deviation: number | null;
  period: SessionPeriod;
  volume: number | null;
  liquidity: number | null;
  /**
   * The issuer events a list can name without a read per asset (the mobile
   * line's request 26): the multiplier the chain has published and not yet
   * activated, and when it activates — judged again at answer time, so a
   * copy served after the activation names nothing pending — and when the
   * trading period in `period` next changes, as the issuer or the feed
   * stated it. Null where there is none or the source said nothing.
   */
  multiplierPending: number | null;
  multiplierPendingAt: string | null;
  sessionNextChangeAt: string | null;
  /**
   * A pre-IPO token's price against the issuer's own mark of one token, per
   * cent (contract 1.14.0) — the one figure the private shelf and the
   * screener's «Відхилення» draw for it, «до оцінки емітента»; context, never
   * a deviation from a market reference. Null on a listed row.
   */
  markPremium: number | null;
  /** When the issuer's mark behind `markPremium` was read. */
  markAt: string | null;
}>;

export const ISSUER_SHORT: Readonly<Record<StockIssuerId, string>> = {
  xstocks: "xStocks",
  backpack: "Backpack",
  ondo: "Ondo",
  prestocks: "PreStocks",
};

/**
 * What a person actually buys — one label per issuer from the issuer's own
 * documents, its line one press deeper through the product's `?`. No asset
 * here is labelled a real share.
 */
export const ISSUER_TRUTH: Readonly<Record<StockIssuerId, HelpTopicId>> = {
  xstocks: "truthXStocks",
  backpack: "truthBackpack",
  ondo: "truthOndo",
  prestocks: "truthPreStocks",
};

export const ISSUER_FULL: Readonly<Record<StockIssuerId, string>> = {
  xstocks: "xStocks · Backed Finance",
  backpack: "Backpack Securities",
  ondo: "Ondo Global Markets",
  prestocks: "PreStocks",
};

/** A pool this thin is not a market a person can trade into. */
export const LIQUID_FLOOR_USD = 10_000;

/** Six significant digits for a price, two decimals for a percent, whole dollars for a sum: what the row draws, and no more bytes than that. */
const price = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Number(value.toPrecision(6)));
const percent = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100);
const dollars = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Math.round(value));

export function toSlimRow(row: StockRow, nowMs: number): SlimStockRow {
  const rep = row.representation;
  return {
    mint: rep.mint,
    symbol: rep.symbol,
    name: rep.underlying.name ?? rep.name,
    issuer: rep.issuer.id,
    kind: rep.instrument?.class ?? "listed-equity",
    unitBasis: rep.instrument?.unitBasis ?? "share",
    tradable: row.lifecycle?.tradable ?? true,
    mark: price(row.issuerMark?.perUnit ?? null),
    icon: row.market.icon,
    halted: rep.tradingHalted === true,
    price: price(row.market.priceUsd),
    change24h: percent(row.market.change24hPct),
    reference: price(row.reference.perShare),
    /* Judged again at render from the reference's own observation time (a feed's publish time), else the fetch. */
    referenceState: referenceStateOf(row.reference, row.session.exchangeOpen, nowMs),
    referenceAt: row.reference.observedAt ?? row.reference.fetchedAt,
    deviation: percent(row.deviationPct),
    period: row.session.period,
    volume: dollars(row.market.volume24hUsd),
    liquidity: dollars(row.market.liquidityUsd),
    ...pendingMultiplier(row.multiplier, nowMs),
    sessionNextChangeAt: row.session.nextChangeAt,
    markPremium: percent(row.markPremiumPct ?? null),
    markAt: row.issuerMark?.fetchedAt ?? null,
  };
}

/** The published multiplier that has not activated at `nowMs`, and when it does; nulls when there is none or its time does not read. */
function pendingMultiplier(multiplier: StockRow["multiplier"], nowMs: number): Pick<SlimStockRow, "multiplierPending" | "multiplierPendingAt"> {
  if (!multiplier || multiplier.pending === null || multiplier.effectiveAt === null) return { multiplierPending: null, multiplierPendingAt: null };
  const at = Date.parse(multiplier.effectiveAt);
  return Number.isFinite(at) && at > nowMs ? { multiplierPending: multiplier.pending, multiplierPendingAt: multiplier.effectiveAt } : { multiplierPending: null, multiplierPendingAt: null };
}

/* ----------------------------------------------------------- collections */

export type StockCollection = "traded" | "liquid" | "gainers" | "losers" | "preipo";
export const STOCK_COLLECTIONS: readonly StockCollection[] = ["traded", "liquid", "gainers", "losers", "preipo"];

const number = (value: number | null): number => (value === null ? Number.NEGATIVE_INFINITY : value);

/** The rows of one collection, in its own order; the caller cuts the length. */
export function collect(rows: readonly SlimStockRow[], collection: StockCollection): SlimStockRow[] {
  switch (collection) {
    case "traded":
      return [...rows].sort((a, b) => number(b.volume) - number(a.volume));
    case "liquid":
      return [...rows].sort((a, b) => number(b.liquidity) - number(a.liquidity));
    case "gainers":
      return rows.filter((row) => row.change24h !== null && (row.liquidity ?? 0) >= LIQUID_FLOOR_USD).sort((a, b) => number(b.change24h) - number(a.change24h));
    case "losers":
      return rows.filter((row) => row.change24h !== null && (row.liquidity ?? 0) >= LIQUID_FLOOR_USD).sort((a, b) => number(a.change24h) - number(b.change24h));
    case "preipo":
      /* The pre-IPO instruments, by the day's volume — a class of instrument, whatever the issuer. */
      return rows.filter((row) => row.kind === "pre-ipo").sort((a, b) => number(b.volume) - number(a.volume));
  }
}

/* ----------------------------------------------------------------- sort */

export type StockSortKey = "symbol" | "price" | "change24h" | "reference" | "deviation" | "session" | "volume" | "liquidity";

const SESSION_RANK: Readonly<Record<SessionPeriod, number>> = { market: 4, extended: 3, overnight: 2, closed: 1, unknown: 0 };

export function sortRows(rows: readonly SlimStockRow[], key: StockSortKey, direction: "asc" | "desc"): SlimStockRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const by = (row: SlimStockRow): number | string => {
    switch (key) {
      case "symbol":
        return row.symbol.toLowerCase();
      case "price":
        return number(row.price);
      case "change24h":
        return number(row.change24h);
      case "reference":
        return number(row.reference);
      case "deviation": {
        /* A pre-IPO row's column carries its premium to the issuer's valuation; it sorts by what it shows. */
        const figure = row.deviation ?? (row.kind === "pre-ipo" ? (row.markPremium ?? null) : null);
        return figure === null ? Number.NEGATIVE_INFINITY : Math.abs(figure);
      }
      case "session":
        return SESSION_RANK[row.period];
      case "volume":
        return number(row.volume);
      case "liquidity":
        return number(row.liquidity);
    }
  };
  return [...rows].sort((a, b) => {
    const left = by(a);
    const right = by(b);
    if (typeof left === "string" && typeof right === "string") return sign * left.localeCompare(right);
    return sign * ((left as number) - (right as number));
  });
}

/** Search by company, ticker or token — over the rows already in the browser. */
export function matchRows(rows: readonly SlimStockRow[], query: string): SlimStockRow[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...rows];
  const score = (row: SlimStockRow): number => {
    const symbol = row.symbol.toLowerCase();
    if (symbol === needle || row.mint.toLowerCase() === needle) return 3;
    if (symbol.startsWith(needle)) return 2;
    if (symbol.includes(needle) || row.name.toLowerCase().includes(needle)) return 1;
    return 0;
  };
  return rows
    .map((row) => ({ row, score: score(row) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || number(b.row.volume) - number(a.row.volume))
    .map((entry) => entry.row);
}

/* ---------------------------------------------------------------- strip */

export type StockStrip = Readonly<{
  listed: number;
  issuers: number;
  tradedToday: number;
  volumeUsd: number;
  liquidityUsd: number;
  /** The US session as the issuer with a calendar states it for its own tokens; unknown when none does. */
  session: Readonly<{ period: SessionPeriod; nextChangeAt: string | null; exchangeOpen: boolean | null }>;
  fetchedAt: string;
  issuerCatalogue: boolean;
  /** How many rows are pre-IPO instruments. */
  preIpo: number;
  /** The issuer catalogues that did not answer on this build, by issuer id, with what was served instead. */
  cataloguesDown: readonly Readonly<{ issuer: "xstocks" | "prestocks"; stale: boolean }>[];
}>;

export function stripOf(universe: StockUniverse): StockStrip {
  const rows = universe.rows;
  const periods = new Map<SessionPeriod, { count: number; nextChangeAt: string | null; exchangeOpen: boolean | null }>();
  for (const row of rows) {
    if (row.representation.issuer.id !== "xstocks" || row.session.period === "unknown") continue;
    const entry = periods.get(row.session.period) ?? { count: 0, nextChangeAt: row.session.nextChangeAt, exchangeOpen: row.session.exchangeOpen };
    entry.count += 1;
    periods.set(row.session.period, entry);
  }
  const majority = [...periods.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  return {
    listed: rows.length,
    issuers: new Set(rows.map((row) => row.representation.issuer.id)).size,
    tradedToday: rows.filter((row) => (row.market.volume24hUsd ?? 0) > 0).length,
    volumeUsd: rows.reduce((sum, row) => sum + (row.market.volume24hUsd ?? 0), 0),
    liquidityUsd: rows.reduce((sum, row) => sum + (row.market.liquidityUsd ?? 0), 0),
    session: majority ? { period: majority[0], nextChangeAt: majority[1].nextChangeAt, exchangeOpen: majority[1].exchangeOpen } : { period: "unknown", nextChangeAt: null, exchangeOpen: null },
    fetchedAt: universe.fetchedAt,
    issuerCatalogue: universe.issuerCatalogue.ok,
    preIpo: rows.filter((row) => row.representation.instrument?.class === "pre-ipo").length,
    /* Only the catalogues Ryntra reads: a copy answered before a catalogue was disconnected may still name it. */
    cataloguesDown: (Object.entries(universe.issuerCatalogues ?? {}) as Array<[string, StockUniverse["issuerCatalogues"]["xstocks"]]>)
      .filter((entry): entry is ["xstocks" | "prestocks", StockUniverse["issuerCatalogues"]["xstocks"]] => entry[0] === "xstocks" || entry[0] === "prestocks")
      .filter(([, state]) => !state.ok || state.stale)
      .map(([issuer, state]) => ({ issuer, stale: state.ok && state.stale })),
  };
}

/** `HH:MM` in UTC, the one clock every figure on the surface shares; null when the source gave no time. */
export function clockOf(iso: string | null, locale: WorkspaceLocale): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleTimeString(locale === "uk" ? "uk-UA" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false });
}

/* ---------------------------------------------------------------- words */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const STOCK_WORDS = {
  title: bi("Stocks", "Акції"),
  screenerTitle: bi("Screener", "Скринер"),
  tradeInSpot: bi("Trade in Spot", "Торгувати у Споті"),
  createStrategy: bi("Create plan", "Створити план"),
  research: bi("Research", "Дослідити"),
  search: bi("Company, ticker or token", "Компанія, тікер або токен"),
  searchLabel: bi("Search stocks", "Пошук акцій"),
  noMatch: bi("Nothing among the confirmed stock tokens matches that.", "Серед підтверджених токенів акцій нічого не знайдено."),
  noRows: bi("No stock matches these filters.", "Жодна акція не підходить під ці фільтри."),
  unavailableTitle: bi("The stock catalogue is not answering", "Каталог акцій не відповідає"),
  unavailable: bi("Spot still trades every listed stock from its live quote.", "Спот і далі торгує кожною акцією за живим котируванням."),
  openSpot: bi("Open Spot", "Відкрити Спот"),
  /* An unknown ticker, inside the product. */
  notFoundTitle: bi("We couldn't find this stock", "Такої акції не знайдено"),
  notFoundBody: bi("Check the ticker or pick a stock from the list. A token that is not on the list can still be found in Spot.", "Перевір тікер або обери акцію зі списку. Токен, якого немає у списку, можна знайти у Споті."),
  browseStocks: bi("Browse stocks", "До акцій"),
  allInScreener: bi("All in the screener", "Усі в скринері"),
  showMore: bi("Show more", "Показати ще"),
  showing: bi("Showing", "Показано"),
  of: bi("of", "з"),
  sources: bi("Sources", "Джерела"),
  updated: bi("Updated", "Оновлено"),
  utc: bi("UTC", "UTC"),
  /* strip */
  usSession: bi("US session", "Сесія США"),
  listed: bi("Listed", "У каталозі"),
  stocksAndEtfs: bi("stocks & ETFs", "акцій та ETF"),
  issuersN: bi("issuers", "емітентів"),
  tradedToday: bi("Traded today", "Торгується сьогодні"),
  volume24h: bi("Volume 24h", "Обсяг 24h"),
  liquidity: bi("Liquidity", "Ліквідність"),
  inPools: bi("in pools", "у пулах"),
  tokensN: bi("tokens", "токенів"),
  nextChange: bi("Next change", "Наступна зміна"),
  calendarUnknown: bi("No issuer calendar answered", "Календар емітента не відповів"),
  /* collections */
  traded: bi("Most traded", "Найбільше торгуються"),
  liquid: bi("Most liquid", "Найліквідніші"),
  gainers: bi("Gainers", "Зростання"),
  losers: bi("Losers", "Падіння"),
  preipo: bi("Pre-IPO", "До IPO"),
  preipoRule: bi("Exposure to private companies before an IPO — PreStocks tokens, not shares. Priced per token; the figure beside the price is the token against PreStocks' own valuation, not a market reference.", "Прив'язка до приватних компаній до IPO — токени PreStocks, а не акції. Ціна за токен; число поруч — токен проти власної оцінки PreStocks, не ринковий референс."),
  searching: bi("Searching every listed stock…", "Шукаємо серед усіх акцій…"),
  moversRule: bi("Among tokens with at least $10,000 of pool liquidity.", "Серед токенів із ліквідністю пулу від $10 000."),
  /* columns */
  colStock: bi("Stock", "Акція"),
  colPrice: bi("Price", "Ціна"),
  col24h: bi("24h", "24h"),
  colReference: bi("Reference", "Референс"),
  colDeviation: bi("Deviation", "Відхилення"),
  colSession: bi("Session", "Сесія"),
  colVolume: bi("Volume 24h", "Обсяг 24h"),
  colLiquidity: bi("Liquidity", "Ліквідність"),
  perShare: bi("per share", "за акцію"),
  perToken: bi("per token", "за токен"),
  noPool: bi("No pool", "Без пулу"),
  halted: bi("Halted", "Торги зупинено"),
  preIpoFlag: bi("Pre-IPO", "До IPO"),
  notOffered: bi("Not offered", "Не пропонується"),
  issuerMark: bi("Issuer's mark", "Оцінка емітента"),
  issuerMarkShort: bi("mark", "оцінка"),
  issuerValuation: bi("Issuer's valuation", "Оцінка компанії емітентом"),
  impliedValuation: bi("Valuation the token price implies", "Оцінка за ціною токена"),
  vsMark: bi("Token vs issuer's mark", "Токен проти оцінки емітента"),
  vsMarkNote: bi("the token's market price against the issuer's own mark · context, not a deviation from a market reference", "ринкова ціна токена проти власної оцінки емітента · контекст, не відхилення від ринкового референсу"),
  markFetched: bi("the issuer's figure · no observation time stated · fetched", "цифра емітента · час спостереження не зазначено · отримано"),
  noExchangeReference: bi("private company — no exchange reference", "приватна компанія — без біржового референсу"),
  transferFee: bi("Token transfer fee", "Комісія переказу токена"),
  transferFeeNote: bi("withheld by the token's own mint on every transfer, by the issuer's rule · already inside the route's figures · not Ryntra's fee", "утримує сам mint токена при кожному переказі за правилом емітента · вже всередині цифр маршруту · не комісія Ryntra"),
  transferFeePending: bi("changes to", "зміниться на"),
  fromEpoch: bi("from epoch", "з епохи"),
  noTransferFee: bi("none on this mint", "на цьому mint немає"),
  status: bi("Status", "Стан"),
  lifecycleRecheck: bi("due for a check", "перевірити до"),
  lifecycleUntil: bi("until", "до"),
  issuerNotice: bi("issuer's notice", "повідомлення емітента"),
  exitTermsPreStocks: bi("Exit: sell on chain any time (the issuer promises no liquidity); after an IPO the issuer opens a conversion into the tokenized public stock for up to nine months, after which the token expires — the issuer's terms.", "Вихід: продати в ланцюзі будь-коли (емітент ліквідності не обіцяє); після IPO емітент відкриває конвертацію в токенізовану публічну акцію на строк до дев'яти місяців, після чого токен втрачає силу — умови емітента."),
  premiumToMark: bi("to the issuer's valuation", "до оцінки емітента"),
  notOwnership: bi("Not ownership of the company.", "Не власність у компанії."),
  issuerPage: bi("Issuer's page", "Сторінка емітента"),
  company: bi("Company", "Компанія"),
  sameCompany: bi("Same company, another issuer", "Та сама компанія, інший емітент"),
  sameCompanyNote: bi("A different instrument with different rights and its own unit — shown, not compared. Cheaper is not the same thing.", "Інший інструмент з іншими правами та власною одиницею — показано, не порівнюється. Дешевше не означає те саме."),
  notPurchasable: bi("Not offered for purchase now", "Зараз не пропонується для купівлі"),
  chainFacts: bi("Token-2022 facts", "Факти Token-2022"),
  permanentDelegate: bi("permanent delegate — the issuer can move or burn holder balances", "постійний делегат — емітент може переміщувати чи спалювати баланси"),
  pausable: bi("pausable — the issuer can stop every transfer", "з паузою — емітент може зупинити всі перекази"),
  pausedNow: bi("paused now", "зупинено зараз"),
  defaultFrozen: bi("new accounts start frozen — allow-listed holders", "нові рахунки створюються замороженими — лише дозволені власники"),
  tokensAsShown: bi("tokens as the wallet shows them", "токени, як їх показує гаманець"),
  chainMultiplier: bi("chain multiplier", "множник ланцюга"),
  /* filters */
  allIssuers: bi("All issuers", "Усі емітенти"),
  anyKind: bi("Listed and pre-IPO", "Лістинг і до IPO"),
  listedOnly: bi("Listed only", "Лише лістинг"),
  preIpoOnly: bi("Pre-IPO only", "Лише до IPO"),
  kind: bi("Kind", "Тип"),
  anySession: bi("Any session", "Будь-яка сесія"),
  exchangeOpen: bi("Exchange open", "Біржа відкрита"),
  exchangeClosed: bi("Exchange closed", "Біржа закрита"),
  anyMarket: bi("Every token", "Усі токени"),
  tradedOnly: bi("Traded today", "Торгується сьогодні"),
  liquidOnly: bi("Liquid pools", "Ліквідні пули"),
  sortBy: bi("Sort", "Сортування"),
  /* sources */
  srcToken: bi("Token price, 24h change, volume and liquidity — Jupiter Tokens API, the venue Spot trades on.", "Ціна токена, зміна за 24h, обсяг і ліквідність — Jupiter Tokens API, майданчик, де торгує Спот."),
  srcReference: bi("Reference per share and the exchange session — the issuer's public API (xStocks · Backed Finance); the reference is the issuer's cached figure with its fetch time, never an executable price.", "Референс за акцію та біржова сесія — публічний API емітента (xStocks · Backed Finance); референс — кешована цифра емітента з часом отримання, не ціна виконання."),
  srcUnits: bi("Units — the Scaled UI Amount multiplier read from the mint on the Solana chain.", "Одиниці — множник Scaled UI Amount, прочитаний із mint у ланцюзі Solana."),
  srcTagOnly: bi("Backpack Securities and Ondo Global Markets publish no catalogue Ryntra reads; their rows are known by the venue's tag and carry the venue's figures, with a market-feed reference where one is configured.", "Backpack Securities і Ondo Global Markets не публікують каталог, який читає Ryntra; їхні рядки відомі за тегом майданчика й несуть його цифри, з референсом ринкового фіду там, де він налаштований."),
  srcPreIpo: bi("Pre-IPO — PreStocks only: the mint confirmed by the issuer's public API; the issuer's mark of a token and of the company is the issuer's own figure with Ryntra's fetch time (the issuer states no observation time) and is never a market reference; the transfer fee is read from the mint on chain.", "До IPO — лише PreStocks: mint підтверджено публічним API емітента; оцінка емітента для токена й компанії — власна цифра емітента з часом отримання Ryntra (емітент не зазначає часу спостереження) і ніколи не ринковий референс; комісія переказу читається з mint у ланцюзі."),
  catalogueStale: bi("catalogue served from the last complete read", "каталог із останнього повного читання"),
  catalogueMissing: bi("catalogue did not answer — its rows are absent", "каталог не відповів — його рядків немає"),
  srcDeviation: bi("Deviation — the token's per-share price against the reference on the list basis: an orientation, not a quote. The quote for your amount is on the asset page; Spot's Review quotes it again.", "Відхилення — ціна токена за акцію проти референсу на базі списку: орієнтир, не котирування. Котирування для твоєї суми — на сторінці активу; Review у Споті котирує її заново."),
  srcNotAdvice: bi("The list is not a ranking and not advice to buy; who may hold a token is the issuer's rule.", "Список — не рейтинг і не порада купувати; хто може тримати токен, визначає емітент."),
  catalogueDown: bi("The issuer's catalogue did not answer on this read — xStocks rows may be missing.", "Каталог емітента не відповів на цьому читанні — рядки xStocks можуть бути відсутні."),
  /* asset page */
  market: bi("Market", "Ринок"),
  quoteForAmount: bi("Quote for an amount", "Котирування для суми"),
  whatYouBuy: bi("What you are buying", "Що ти купуєш"),
  onchain: bi("Onchain", "Ончейн"),
  chart: bi("Chart", "Графік"),
  referencePerShare: bi("Reference per share", "Референс за акцію"),
  tokenPrice: bi("Token price", "Ціна токена"),
  session: bi("Session", "Сесія"),
  deviation: bi("Deviation", "Відхилення"),
  pool: bi("Pool", "Пул"),
  issuer: bi("Issuer", "Емітент"),
  underlying: bi("Underlying", "Базовий актив"),
  reserves: bi("Issuer's reserves", "Резерви емітента"),
  rights: bi("Rights", "Права"),
  /* The purchase with a loss limit, prepared by the published rules from the person's amount and preset. */
  lossLimit: bi("Loss limit", "Межа збитку"),
  noLimit: bi("None", "Без межі"),
  presetCareful: bi("Careful", "Обережно"),
  presetBalanced: bi("Balanced", "Збалансовано"),
  preparedBy: bi("Ryntra prepared the purchase", "Ryntra підготувала покупку"),
  fromYourFigures: bi("from your figures", "за твоїми цифрами"),
  canLose: bi("You can lose", "Можеш втратити"),
  /* An estimate at the limit, never «до» — a limit is not a ceiling on the loss. */
  approx: bi("≈", "≈"),
  limitAt: bi("limit", "межа"),
  sellIfReaches: bi("Sell if it reaches", "Продати, якщо дійде"),
  protection: bi("Protection", "Захист"),
  ryntraWarns: bi("Ryntra will warn you", "Ryntra попередить"),
  noProtection: bi("No protection", "Без захисту"),
  connectTelegramToWarn: bi("connect Telegram so Ryntra can warn you", "підключи Telegram, щоб Ryntra могла попередити"),
  protectionAfterProof: bi("Telegram, once the wallet is confirmed", "у Telegram, коли гаманець підтверджено"),
  cardStatus: bi("Status", "Статус"),
  proposed: bi("Proposed · nothing bought", "Запропоновано · нічого не куплено"),
  preparing: bi("Writing the plan…", "Записуємо план…"),
  canLoseAll: bi("You can lose everything", "Можна втратити все"),
  acceptAndSign: bi("Accept and sign", "Прийняти й підписати"),
  confirmWalletToAccept: bi("Confirm wallet", "Підтвердити гаманець"),
  confirmingWallet: bi("Confirming…", "Підтверджуємо…"),
  planPriceUnavailable: bi("The price for the plan could not be read right now.", "Ціну для плану зараз не вдалося прочитати."),
  planWriteFailed: bi("The plan could not be written right now; nothing was bought.", "План зараз не вдалося записати; нічого не куплено."),
  loopIntent: bi("Intent", "Намір"),
  loopLimits: bi("Limits", "Межі"),
  loopPermission: bi("Permission", "Дозвіл"),
  loopExecution: bi("Execution", "Виконання"),
  loopProof: bi("Proof", "Доказ"),
  loopOversight: bi("Oversight", "Нагляд"),
  /* The multiplier explained where the issuer reinvests dividends into the amount. */
  dividends: bi("Dividends", "Дивіденди"),
  dividendsInAmount: bi("Already in your amount", "Вже в твоїй кількості"),
  dividendsHow: bi("The issuer reinvests them by raising the multiplier", "Емітент реінвестує їх, збільшуючи множник"),
  dividendsNotPayout: bi("not a payout to an account", "це не виплата на рахунок"),
  mint: bi("Mint", "Mint"),
  units: bi("Units", "Одиниці"),
  authorities: bi("Authorities", "Повноваження"),
  supply: bi("Token supply", "Емісія токена"),
  buy: bi("Buy", "Купити"),
  sell: bi("Sell", "Продати"),
  yourAmount: bi("Your amount, $", "Своя сума, $"),
  quote: bi("Quote", "Котирувати"),
  asking: bi("Asking for the quote…", "Питаємо котирування…"),
  quoteUnavailable: bi("The quote is unavailable.", "Котирування недоступне."),
  youPay: bi("You pay", "Ти платиш"),
  youReceive: bi("You receive", "Ти отримуєш"),
  youGive: bi("You give", "Ти віддаєш"),
  priceImpact: bi("Price impact", "Вплив на ціну"),
  feesInQuote: bi("Fees in the quote", "Комісії в котируванні"),
  presetsNote: bi("Example amounts for orientation; Spot's Review quotes your real amount again.", "Приклади сум для орієнтації; Review у Споті котирує твою реальну суму заново."),
  details: bi("Details", "Деталі"),
  backToStocks: bi("Stocks", "Акції"),
  /* the terms of the deal and the comparison */
  dealTerms: bi("Buy estimate", "Розрахунок купівлі"),
  sellEstimate: bi("Sell estimate", "Розрахунок продажу"),
  otherRepresentations: bi("Token alternatives", "Варіанти токена"),
  /* The estimate said the way a person reads it: what goes out, what comes back (the audit of 2026-09-16 found "you receive" on the sum being spent). */
  youSpend: bi("You spend", "Витрачаєш"),
  youSell: bi("You sell", "Продаєш"),
  aboutReceive: bi("you get about", "приблизно отримаєш"),
  reviewPurchase: bi("Review purchase", "Перевірити купівлю"),
  reviewSale: bi("Review sale", "Перевірити продаж"),
  planThisPurchase: bi("Plan this purchase", "Спланувати купівлю"),
  assetDetails: bi("Asset details", "Деталі активу"),
  assetDetailsSub: bi("mint · units · authorities · supply", "mint · одиниці · повноваження · емісія"),
  orderPerShare: bi("Price of this order, per share", "Ціна цієї заявки за акцію"),
  orderPerToken: bi("Price of this order, per token", "Ціна цієї заявки за токен"),
  minimumReceived: bi("Minimum received", "Мінімум отримання"),
  minimumNote: bi("the least a signature accepts, after slippage of", "найменше, що прийме підпис, після сліпеджу"),
  minimumAtReview: bi("set at the Review — its slippage bound applies to the amount you sign", "встановлює Review — його межа сліпеджу діє на суму, яку ти підписуєш"),
  quoteTime: bi("Quote time", "Час котирування"),
  reviewUntil: bi("review until", "перевірка до"),
  quoteNotPromise: bi("A quote for comparison, not a promise of execution: Spot's Review quotes your amount again before you sign.", "Котирування для порівняння, не обіцянка виконання: Review у Споті котирує твою суму заново перед підписом."),
  lowestCost: bi("Lowest quoted cost", "Найнижча котирувана вартість"),
  lowestFor: bi("for", "для"),
  notBestToken: bi("Cheaper is not the same rights or less risk — the issuers' terms differ.", "Дешевше — не ті самі права й не менший ризик: умови емітентів різні."),
  sameBasis: bi("The same amount, the same settlement asset (USDC), the same side, quoted together; per share through each token's own multiplier.", "Та сама сума, той самий актив розрахунку (USDC), той самий бік, котирування разом; за акцію через власний множник кожного токена."),
  confirmedByCatalogue: bi("issuer's catalogue", "каталог емітента"),
  impliedBySymbol: bi("by the token's symbol", "за символом токена"),
  noRouteAtSize: bi("No route at this size", "Немає маршруту для цієї суми"),
  venueRefused: bi("The venue could not quote this amount", "Майданчик не зміг котирувати цю суму"),
  notQuoted: bi("Not quoted", "Не котирувалося"),
  unitsUnknown: bi("units unknown — not compared", "одиниці невідомі — не порівнюється"),
  sellNote: bi("You sell the token you hold; other representations are not compared for a sale.", "Ти продаєш токен, який тримаєш; для продажу інші представлення не порівнюються."),
  onlyRepresentation: bi("No other confirmed representation of", "Інших підтверджених представлень"),
  onlyRepresentationTail: bi("is listed.", "у каталозі немає."),
  thisPage: bi("this page", "ця сторінка"),
  colRepresentation: bi("Representation", "Представлення"),
  colForAmount: bi("For your amount", "За твою суму"),
  colCosts: bi("Costs", "Витрати"),
  colTime: bi("Time, UTC", "Час, UTC"),
  versus: bi("vs", "проти"),
  trade: bi("Trade", "Торгувати"),
  plan: bi("Plan", "План"),
  comparing: bi("Quoting every representation…", "Котируємо кожне представлення…"),
} as const satisfies Record<string, Bi>;

export type StockWord = keyof typeof STOCK_WORDS;

export function wordsFor(locale: WorkspaceLocale): (word: StockWord) => string {
  return (word) => STOCK_WORDS[word][locale];
}

export function periodWord(period: SessionPeriod, locale: WorkspaceLocale): string {
  return SESSION_WORDS[period][locale];
}

export function referenceWord(state: ReferenceState, locale: WorkspaceLocale): string {
  return REFERENCE_STATE_WORDS[state][locale];
}

/**
 * The dot beside a session word. Green is the exchange open; blue is a
 * session the issuer trades in while the exchange is not (extended,
 * overnight) — information, never a caution; grey is closed. Orange never
 * stands in for a market state (DESIGN.md), and the word is always there.
 */
export function periodTone(period: SessionPeriod): "open" | "extended" | "closed" | null {
  switch (period) {
    case "market":
      return "open";
    case "extended":
    case "overnight":
      return "extended";
    case "closed":
      return "closed";
    case "unknown":
      return null;
  }
}
