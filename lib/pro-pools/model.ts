/**
 * Meteora DLMM Pro pools as a person reads them: every pool of the program on the network, its pair with
 * names and logos, its price, how deep it is in dollars, the fee a swap pays now and what a limit order earns on top.
 *
 * DLMM Pro has no Data API: the pools are the program's own accounts, the reserves are their vaults, the names and the
 * dollar prices are Jupiter's catalogue. Nothing here is a history — no «volume of the day» — because nobody keeps one
 * for DLMM Pro yet, and it is not made up.
 *
 * Pure and client-safe: the server builds the answer from it, the screens and the tests read it alike.
 */

export type ProPoolNetwork = "devnet" | "mainnet";

export type ProPoolCoin = Readonly<{
  mint: string;
  /** Jupiter's ticker; null where the catalogue does not know the coin. */
  symbol: string | null;
  name: string | null;
  decimals: number;
  /** The catalogue's own logo address; the screen draws the engine's `/api/icon/<mint>` in any case. */
  icon: string | null;
  verified: boolean | null;
  /** The coin's dollar price; null where nobody prices it. */
  usd: number | null;
}>;

export type ProPoolFee = Readonly<{
  /** What a swap pays now, basis points to two decimals: the base step and the volatility part together. */
  totalBps: number;
  baseBps: number;
  dynamicBps: number;
  /** How the base fee moves: fixed, by time or by market cap. */
  mode: "fixed" | "time" | "marketCap";
  /** Meteora's share of what liquidity earns, basis points. */
  protocolShareBps: number;
  /** The coin the fee is taken in: the one a swap pays out, or always token Y. */
  collectedIn: "output" | "tokenY";
}>;

export type ProPoolRow = Readonly<{
  address: string;
  /** From a public config, from a partner's config, or a launch pool. */
  kind: "static" | "dynamic" | "launch";
  x: ProPoolCoin;
  y: ProPoolCoin;
  /** Token Y per token X, in whole coins. */
  price: number;
  tickSpacing: number;
  /** One step of the price, basis points. */
  stepBps: number;
  fee: ProPoolFee;
  /** What a limit order keeps of the fee on what it fills, basis points: the owner's part after Ryntra's referral. */
  bonusBps: number;
  /** The two vaults, base units; null where a vault did not read. */
  reserves: Readonly<{ xRaw: string | null; yRaw: string | null }>;
  /** The two vaults in dollars; null where a coin has no dollar price or a vault did not read. */
  tvlUsd: number | null;
  /** Reward slots of liquidity mining that run now. */
  rewards: number;
  /** What is open to everyone now: swaps, and new liquidity and orders. */
  open: Readonly<{ swap: boolean; deposits: boolean }>;
}>;

export type ProPoolsAnswer = Readonly<{ network: ProPoolNetwork; at: string; pools: readonly ProPoolRow[] }>;
export type ProPoolAnswer = Readonly<{ network: ProPoolNetwork; at: string; pool: ProPoolRow }>;

/**
 * The coins a pair is priced in, the most a price's coin first: the two dollars, then SOL. A pool of one of them against
 * anything else is that coin's market; SOL against a dollar is SOL's.
 */
export const QUOTE_MINTS: readonly string[] = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "So11111111111111111111111111111111111111112",
];

const rank = (mint: string): number => {
  const at = QUOTE_MINTS.indexOf(mint);
  return at < 0 ? -1 : QUOTE_MINTS.length - at;
};

/**
 * Which side of the pool is the coin a person trades, and which the coin it is priced in: the side that is not SOL or
 * a dollar; between two such, the one priced in the other (MET/SOL — MET; JitoSOL/SOL — JitoSOL; SOL/USDC — SOL).
 */
export function coinSideOf(row: Pick<ProPoolRow, "x" | "y">): "x" | "y" {
  return rank(row.x.mint) > rank(row.y.mint) ? "y" : "x";
}

/** The coin's own price in the other coin: the pool's price for X, turned over for Y. */
export function coinPriceIn(row: Pick<ProPoolRow, "x" | "y" | "price">): number {
  return coinSideOf(row) === "x" ? row.price : row.price > 0 ? 1 / row.price : 0;
}

/** A coin's short name: its ticker, else the start of its address. */
export const tickerOf = (coin: Pick<ProPoolCoin, "symbol" | "mint">): string => coin.symbol?.trim() || `${coin.mint.slice(0, 4)}…`;

/** The pair as people write it: the coin first, then what it is priced in — «MET / SOL». */
export function pairOf(row: Pick<ProPoolRow, "x" | "y">): Readonly<{ coin: ProPoolCoin; quote: ProPoolCoin; name: string }> {
  const side = coinSideOf(row);
  const coin = side === "x" ? row.x : row.y;
  const quote = side === "x" ? row.y : row.x;
  return { coin, quote, name: `${tickerOf(coin)} / ${tickerOf(quote)}` };
}

/** The two vaults in dollars: each in whole coins at its dollar price. Null where either part is not known. */
export function tvlUsdOf(x: Pick<ProPoolCoin, "decimals" | "usd">, y: Pick<ProPoolCoin, "decimals" | "usd">, xRaw: string | null, yRaw: string | null): number | null {
  if (xRaw === null || yRaw === null) return null;
  const part = (raw: string, coin: Pick<ProPoolCoin, "decimals" | "usd">): number | null => {
    const amount = Number(raw) / 10 ** coin.decimals;
    if (!Number.isFinite(amount)) return null;
    if (amount === 0) return 0;
    return coin.usd !== null && coin.usd > 0 ? amount * coin.usd : null;
  };
  const a = part(xRaw, x);
  const b = part(yRaw, y);
  return a === null || b === null ? null : a + b;
}

/* ── names a list keeps out of sight ──────────────────────────────────────────────────────────────────── */

/** Crude words: a stem long enough to count anywhere in a name, and short ones only as a word of their own. */
const CRUDE_ANYWHERE = ["butthole", "titty", "titties", "pussy", "penis", "vagina", "porn", "hentai", "dildo", "fuck", "shit", "boner", "boobies"];
const CRUDE_WORDS = new Set(["ass", "tits", "boob", "boobs", "cock", "dick", "cum", "sex", "anal", "nude", "nudes", "milf", "horny", "butt"]);
const LATIN = /[a-z]/i;
const OTHER_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}]/u;

/** Whether a word mixes Latin letters with another alphabet's — «Nеil» with a Cyrillic «е», «TTWО» with a Cyrillic «О». */
export function mixedLetters(text: string | null): boolean {
  if (!text) return false;
  return text.split(/[\s\-_.·/]+/u).some((word) => LATIN.test(word) && OTHER_SCRIPT.test(word));
}

/** Whether a name or ticker carries a crude word («BUTTHOLE», «Big Titty Coin»). */
export function crudeName(text: string | null): boolean {
  if (!text) return false;
  const lower = text.normalize("NFKC").toLowerCase();
  if (CRUDE_ANYWHERE.some((stem) => lower.includes(stem))) return true;
  return lower.split(/[^\p{L}]+/u).some((word) => CRUDE_WORDS.has(word));
}

const TEST_NAME = /^test(?:\b|$)|\btest token\b/i;

/**
 * Why a pool stays out of «Active», where a person looks first (the QA of 19.11: «TEST · SOL», a coin with no name
 * «Cx9c…», «BUTTHOLE · SOL», «Nеil» beside the real one): a coin with no name, a test coin, a crude name, or a ticker that
 * passes for another — letters of two alphabets in one word, or a known coin's ticker in other letters
 * (`isLookalike`, `lib/world/text-safety/lookalike.ts`). Null — nothing; the pool stays listed under «All» either way.
 */
export function quietReason(row: Pick<ProPoolRow, "x" | "y">, isLookalike: (symbol: string, mint: string) => boolean = () => false): "unnamed" | "test" | "crude" | "lookalike" | null {
  for (const coin of [row.x, row.y]) {
    if (!coin.symbol?.trim()) return "unnamed";
    if (TEST_NAME.test(coin.symbol) || TEST_NAME.test(coin.name ?? "")) return "test";
    if (crudeName(coin.symbol) || crudeName(coin.name)) return "crude";
    if (mixedLetters(coin.symbol) || mixedLetters(coin.name) || isLookalike(coin.symbol, coin.mint)) return "lookalike";
  }
  return null;
}

/** Deepest first; a pool whose depth is not known goes after every known one, then by address so the order holds. */
export function byDepth(a: ProPoolRow, b: ProPoolRow): number {
  const da = a.tvlUsd ?? -1;
  const db = b.tvlUsd ?? -1;
  return db - da || a.address.localeCompare(b.address);
}

const isCoin = (value: unknown): value is ProPoolCoin => {
  if (typeof value !== "object" || value === null) return false;
  const coin = value as Record<string, unknown>;
  return typeof coin.mint === "string" && typeof coin.decimals === "number";
};

/** Whether a body is one row of the answer, as far as a screen relies on it. */
export function isProPoolRow(value: unknown): value is ProPoolRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const fee = row.fee as Record<string, unknown> | undefined;
  return typeof row.address === "string" && isCoin(row.x) && isCoin(row.y) && typeof row.price === "number" && typeof row.tickSpacing === "number" && typeof fee?.totalBps === "number" && typeof row.bonusBps === "number";
}

export function isProPoolsAnswer(value: unknown): value is ProPoolsAnswer {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body.pools) && body.pools.every(isProPoolRow);
}

export function isProPoolAnswer(value: unknown): value is ProPoolAnswer {
  if (typeof value !== "object" || value === null) return false;
  return isProPoolRow((value as Record<string, unknown>).pool);
}
