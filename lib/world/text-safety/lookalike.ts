/**
 * A ticker that passes for a known coin's — or a coin that passes for a tokenized stock. Two cases:
 *   - `lookalike` — the ticker reads as a known one once look-alike letters and digits are folded («S0L», «UЅDC»
 *     with a Cyrillic «Ѕ», «JUР» with a Cyrillic «Р»), but is not written the same;
 *   - `impersonation` — the known ticker exactly, on another mint.
 * Either way the city does not vouch for the coin: no name, no logo, never «verified». The mints are the ones the
 * city's own curated list stands on (`city/lib/market/curated.ts`, Jupiter's verified list) and Circle's and Tether's
 * own stablecoin mints.
 *
 * The stocks: a book of tokenized stocks known by their mint, handed in by the caller (`StockBook`,
 * `stockBookOf`). A coin on another mint with one of those tickers — written the same, or the same once look-alike
 * letters are folded — or, when the venue did not verify it, named as one of those companies («Tesla», «TESLA Stock»,
 * «Tеsla» with a Cyrillic «е»), is not that stock: `stockLookalikeOf`. Without a book no coin passes for a stock.
 *
 * Pure: no network, no data of its own beyond the coins above. Relative imports with their extension only.
 */

/** Known tickers and the one mint each belongs to. Public addresses only. */
export const FAMOUS_COINS: Readonly<Record<string, string>> = Object.freeze({
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  JLP: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
  PUMP: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
  PENGU: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
  POPCAT: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  BOME: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  JUPSOL: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
});

/** Letters of other scripts and the Latin letter each passes for, lower case. */
const FOLD: Readonly<Record<string, string>> = Object.freeze({
  /* Cyrillic */
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ѕ: "s", і: "i", ј: "j",
  ԁ: "d", һ: "h", ԛ: "q", ԝ: "w", ӏ: "l", ү: "y", ԍ: "g",
  /* Greek */
  α: "a", β: "b", ε: "e", ζ: "z", η: "n", ι: "i", κ: "k", μ: "m", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
  /* Armenian */
  օ: "o", ս: "u", հ: "h", ո: "n", ց: "g", զ: "q", լ: "l", յ: "j", ւ: "l",
  /* Cherokee (upper case only; lower-cased below) */
  ꭺ: "a", ꭼ: "e", ꮋ: "h", ꭵ: "i", ꮖ: "l", ꮮ: "l", ꮇ: "m", ꮢ: "r", ꮪ: "s", ꭲ: "t", ꮤ: "w", ꮯ: "c", ꭰ: "d", ꮐ: "g", ꭹ: "y", ꮟ: "b",
});
/** Digits and Latin letters that pass for one another in a ticker. */
const DIGITS: Readonly<Record<string, string>> = Object.freeze({ "0": "o", "1": "l", i: "l", "|": "l", "5": "s", "3": "e", "4": "a", "8": "b" });

/**
 * A ticker's skeleton: what it reads as once case, compatibility forms, look-alike letters and digits are folded and
 * everything that is not a letter or a digit is gone. Two tickers with one skeleton look the same to a person.
 */
export function skeleton(symbol: string): string {
  const folded = Array.from(symbol.normalize("NFKC").toLowerCase(), (ch) => FOLD[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}|]/gu, "");
  return Array.from(folded, (ch) => DIGITS[ch] ?? ch)
    .join("")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w");
}

const FAMOUS_SKELETONS: ReadonlyMap<string, string> = new Map(Object.keys(FAMOUS_COINS).map((symbol) => [skeleton(symbol), symbol]));

export type Lookalike = Readonly<{
  famous: string;
  reason: "lookalike" | "impersonation";
  /** Set when the ticker is a tokenized stock's: the company and the stock's own mint. */
  stock?: Readonly<{ company: string; mint: string }>;
}>;

/**
 * Whether a coin's ticker passes for a known coin — or a known tokenized stock — it is not: `null` when the ticker is
 * its own, or the coin is the known one. The ticker is compared as written, a leading «$» aside, case aside. A stock's
 * company name is not read here (only the ticker is given): `stockLookalikeOf` reads both.
 */
export function lookalikeOf(symbol: string, mint: string, book: StockBook = EMPTY_STOCK_BOOK): Lookalike | null {
  const famous = FAMOUS_SKELETONS.get(skeleton(symbol));
  if (famous) {
    if (FAMOUS_COINS[famous] === mint) return null;
    return { famous, reason: plainTicker(symbol) === famous ? "impersonation" : "lookalike" };
  }
  const stock = book.mints.has(mint) ? null : stockByTicker(symbol, book);
  if (!stock) return null;
  return { famous: stock.ticker, reason: stock.reason === "ticker" ? "impersonation" : "lookalike", stock: { company: stock.company, mint: stock.mint } };
}

const plainTicker = (symbol: string): string => symbol.normalize("NFKC").replace(/^\$+/, "").trim().toUpperCase();

/* ------------------------------------------------------------------ stocks */

/**
 * One tokenized stock a book knows: its mint, its ticker as the issuer names it, the company as a person names it, and
 * its kind — `company` (a listed share), `private` (a private company's token before its IPO) or `fund` (an index or
 * other fund, whose name is a common word and never matched as a company's).
 */
export type StockEntry = Readonly<{ mint: string; symbol: string; company: string; kind: "company" | "private" | "fund" }>;

/** The stocks a coin is checked against: every known stock's mint, and its ticker and company by their skeletons. */
export type StockBook = Readonly<{
  mints: ReadonlySet<string>;
  tickers: ReadonlyMap<string, StockEntry>;
  companies: ReadonlyMap<string, StockEntry>;
}>;

/**
 * The words a token's name adds to a company's when it passes for its stock — «Tesla Stock», «Tokenized Tesla», «Tesla
 * - Backpack Securities» — taken off before the name is compared, with the legal form.
 */
const STOCK_WORDS =
  /\b(?:x?stocks?|shares?|equity|equities|tokeni[sz]ed|tokens?|pre[\s-]?ipo|ipo|backpack securities|backpack|prestocks|ondo(?:\s+tokenized)?|ondo global markets|official|inc|corp|corporation|pbc|plc|ltd|co)\b/giu;

/** A company's name shorter than this, folded, is a common word («Meta», «Snap», «Oura») and is never matched by name. */
export const COMPANY_NAME_MIN = 5;

/** A name as it is compared with a company's: the stock words and the legal form off, then folded to its skeleton. */
export function companySkeleton(name: string): string {
  return skeleton(name.normalize("NFKC").replace(STOCK_WORDS, " "));
}

/**
 * The book from a list of known stocks. One ticker, one stock (the first listed keeps it); one company name, the
 * company's first listed share — a private token only where no share of the company is known — so a coin passing for
 * a company is pointed at the stock a person can buy.
 */
export function stockBookOf(stocks: readonly StockEntry[]): StockBook {
  const mints = new Set<string>();
  const tickers = new Map<string, StockEntry>();
  const companies = new Map<string, StockEntry>();
  for (const stock of stocks) {
    mints.add(stock.mint);
    const ticker = skeleton(stock.symbol);
    if (ticker.length > 0 && !tickers.has(ticker) && !FAMOUS_SKELETONS.has(ticker)) tickers.set(ticker, stock);
    if (stock.kind === "fund") continue;
    const company = companySkeleton(stock.company);
    if (company.length < COMPANY_NAME_MIN) continue;
    const held = companies.get(company);
    if (!held || (held.kind === "private" && stock.kind === "company")) companies.set(company, stock);
  }
  return { mints, tickers, companies };
}

/** No stock known: no coin passes for one. */
export const EMPTY_STOCK_BOOK: StockBook = stockBookOf([]);

/**
 * A coin passing for a tokenized stock: `ticker` — the stock's ticker as written; `lookalike` — the same once look-alike
 * letters are folded («ΤSLA» with a Greek «Τ», «TS​LA» with a hidden space); `company` — named as the company.
 */
export type StockLookalike = Readonly<{
  /** The stock's ticker. */
  ticker: string;
  /** The company, as a person names it. */
  company: string;
  /** The stock's own mint — the real one. */
  mint: string;
  reason: "ticker" | "lookalike" | "company";
}>;

/** The stock whose ticker a ticker passes for, as written or once folded; the mint is not checked here. */
function stockByTicker(symbol: string, book: StockBook): StockLookalike | null {
  const stock = book.tickers.get(skeleton(symbol));
  if (!stock) return null;
  return { ticker: stock.symbol, company: stock.company, mint: stock.mint, reason: plainTicker(symbol) === stock.symbol.toUpperCase() ? "ticker" : "lookalike" };
}

/**
 * Whether a coin passes for a tokenized stock it is not; `null` when the coin is the stock, or takes neither a stock's
 * ticker nor its company's name. The name is read only for a coin the venue did not verify: a verified coin keeps its
 * own name, and its ticker is still checked.
 */
export function stockLookalikeOf(
  coin: Readonly<{ symbol: string; mint: string; name?: string | null; verified?: boolean | null }>,
  book: StockBook = EMPTY_STOCK_BOOK,
): StockLookalike | null {
  if (book.mints.has(coin.mint)) return null;
  const byTicker = stockByTicker(coin.symbol, book);
  if (byTicker) return byTicker;
  if (coin.verified === true) return null;
  for (const text of [coin.name, coin.symbol]) {
    if (!text) continue;
    const byName = book.companies.get(companySkeleton(text));
    if (byName) return { ticker: byName.symbol, company: byName.company, mint: byName.mint, reason: "company" };
  }
  return null;
}
