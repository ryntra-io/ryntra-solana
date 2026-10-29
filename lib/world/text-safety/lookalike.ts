/**
 * A ticker that passes for a known coin's. Two cases (CITY-73):
 *   - `lookalike` — the ticker reads as a known one once look-alike letters and digits are folded («S0L», «UЅDC»
 *     with a Cyrillic «Ѕ», «JUР» with a Cyrillic «Р»), but is not written the same;
 *   - `impersonation` — the known ticker exactly, on another mint.
 * Either way the city does not vouch for the coin: no name, no logo, never «verified». The mints are the ones the
 * city's own curated list stands on (`city/lib/market/curated.ts`, Jupiter's verified list) and Circle's and Tether's
 * own stablecoin mints.
 *
 * Pure: no network. Relative imports with their extension only.
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

export type Lookalike = Readonly<{ famous: string; reason: "lookalike" | "impersonation" }>;

/**
 * Whether a coin's ticker passes for a known coin it is not: `null` when the ticker is its own, or the coin is the
 * known one. The ticker is compared as written, a leading «$» aside, case aside.
 */
export function lookalikeOf(symbol: string, mint: string): Lookalike | null {
  const famous = FAMOUS_SKELETONS.get(skeleton(symbol));
  if (!famous || FAMOUS_COINS[famous] === mint) return null;
  const plain = symbol.normalize("NFKC").replace(/^\$+/, "").trim().toUpperCase();
  return { famous, reason: plain === famous ? "impersonation" : "lookalike" };
}
