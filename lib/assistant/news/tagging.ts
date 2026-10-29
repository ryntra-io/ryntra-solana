/**
 * Which tokens a news item is about, and what kind of news it is (AI-09).
 *
 * Two steps, and the second can only narrow the first. The words find the
 * candidates: a token is a candidate of an item when its headline or
 * summary names it — `$SYMBOL`, the symbol in capitals where a capital word
 * is not an ordinary one, or the project's name — from the list below
 * (verified mints, checked against Jupiter on 17.10.2026) and the tokens
 * people follow (`followedTerms`). Then the everyday model reads a batch of
 * items with their candidates and returns, for each, the candidates it is
 * really about and one topic from a fixed list — enums and ids, never words
 * of its own, so a headline that tries to steer it can at most mislabel
 * itself (`holdTags`). Without a model only the strong candidates stand.
 *
 * Identity is the mint, never the ticker: a tag is a mint the term names.
 *
 * Pure.
 */

import { AGENT_NEWS_TOPICS, type AgentNewsTopic } from "../../api/v1/contract.ts";

export type TokenTerm = Readonly<{
  mint: string;
  symbol: string;
  /** Names a headline uses for the project or the token, and that mean nothing else in crypto news. */
  names: readonly string[];
  /** Names that are also ordinary words or other things (Jupiter, Helium, Tensor): a candidate only the model may confirm. */
  weakNames?: readonly string[];
  /** The symbol in capitals means the token; false where the capital word is a person, a company or a common word. */
  capitalSymbol: boolean;
}>;

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const CBBTC_MINT = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";

export const TOKEN_TERMS: readonly TokenTerm[] = [
  { mint: SOL_MINT, symbol: "SOL", names: ["Solana"], capitalSymbol: true },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", names: ["Jupiter Exchange", "Jupiter DEX", "Jupiter aggregator", "Jupiter Lend", "Jupiter Perps"], weakNames: ["Jupiter"], capitalSymbol: true },
  { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", names: ["Bonk"], capitalSymbol: true },
  { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", names: ["dogwifhat"], capitalSymbol: true },
  { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", symbol: "JTO", names: ["Jito"], capitalSymbol: true },
  { mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", symbol: "PYTH", names: ["Pyth Network", "Pyth"], capitalSymbol: true },
  { mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", names: ["Raydium"], capitalSymbol: true },
  { mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", symbol: "ORCA", names: ["Orca DEX", "Orca Whirlpools"], weakNames: ["Orca"], capitalSymbol: true },
  { mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", symbol: "RENDER", names: ["Render Network"], capitalSymbol: false },
  { mint: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux", symbol: "HNT", names: ["Helium Network", "Helium Mobile"], weakNames: ["Helium"], capitalSymbol: true },
  { mint: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ", symbol: "W", names: ["Wormhole"], capitalSymbol: false },
  { mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL", names: ["JitoSOL"], capitalSymbol: false },
  { mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "mSOL", names: ["Marinade Finance", "Marinade"], capitalSymbol: false },
  { mint: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", symbol: "TRUMP", names: ["Official Trump token", "TRUMP memecoin", "Trump memecoin", "Trump meme coin"], capitalSymbol: false },
  { mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT", names: ["Popcat"], capitalSymbol: true },
  { mint: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7", symbol: "DRIFT", names: ["Drift Protocol"], weakNames: ["Drift"], capitalSymbol: false },
  { mint: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS", symbol: "KMNO", names: ["Kamino"], capitalSymbol: true },
  { mint: "TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6", symbol: "TNSR", names: [], weakNames: ["Tensor"], capitalSymbol: true },
  { mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", symbol: "MEW", names: ["cat in a dogs world"], capitalSymbol: true },
  { mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", symbol: "PENGU", names: [], weakNames: ["Pudgy Penguins"], capitalSymbol: true },
  { mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", symbol: "Fartcoin", names: ["Fartcoin"], capitalSymbol: false },
  { mint: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL", symbol: "MET", names: ["Meteora"], capitalSymbol: false },
  { mint: CBBTC_MINT, symbol: "cbBTC", names: ["cbBTC"], capitalSymbol: false },
];

/** What kind of news an item is. Fixed: the model chooses one, it never names one. */
export const NEWS_TOPICS = AGENT_NEWS_TOPICS;
export type NewsTopic = AgentNewsTopic;

/* The order is the precedence: a hack announced with a price drop is a security story. */
const TOPIC_WORDS: readonly (readonly [NewsTopic, RegExp])[] = [
  ["security", /\b(hack(ed|s|er|ers)?|exploit(ed|s)?|drain(ed|er)?|stolen|breach|vulnerab\w*|attack(ed|er|s)?|rug ?pull|phishing|outage|halt(ed|s)?)\b/i],
  ["etf", /\bETFs?\b/],
  ["regulation", /\b(SEC|CFTC|regulat\w*|lawsuit|sue[sd]?|court|judge|bill|senat\w*|congress\w*|MiCA|law(s|makers)?|sanction\w*|ban(s|ned)?|licen[cs]\w*)\b/i],
  ["listing", /\b(list(s|ed|ing)? on|listing|delist\w*)\b/i],
  ["funding", /\b(raise[sd]?|raising|funding|seed round|series [a-d]|valuation|acqui(re[sd]?|sition)|treasury (company|firm))\b/i],
  ["partnership", /\b(partner(s|ship|ed)?|integrat\w*|collaborat\w*|teams up|joins forces)\b/i],
  ["upgrade", /\b(upgrade[sd]?|mainnet|testnet|hard fork|SIMD|Firedancer|Alpenglow|validator(s)?|release[sd]?|v\d+(\.\d+)?)\b/i],
  ["launch", /\b(launch(es|ed)?|airdrop(s|ped)?|debut(s|ed)?|introduc(es|ed)|unveil(s|ed)?|rolls out)\b/i],
  ["macro", /\b(Fed|FOMC|inflation|rate (cut|hike)s?|interest rates?|tariff\w*|CPI|jobs report|treasur(y|ies) yields?|recession|dollar index)\b/i],
  ["market", /\b(price|rall(y|ies|ied)|surg(e|es|ed)|plung(e|es|ed)|drop(s|ped)?|fall(s|en)?|fell|ris(e|es|en)|jump(s|ed)?|slid(es)?|whales?|liquidat\w*|outflows?|inflows?|market(s)?|all-time high|ATH|bull|bear)\b/i],
];

export function topicFromWords(text: string): NewsTopic {
  for (const [topic, words] of TOPIC_WORDS) if (words.test(text)) return topic;
  return "other";
}

/** Words that make an item about the market as a whole, beside the tokens it names. */
const MARKET_WIDE = /\b(bitcoin|BTC|ether(eum)?|ETH|crypto (market|prices?)|crypto market|altcoins?|digital assets?|stablecoins?|Fed|FOMC|SEC|CFTC|ETFs?|tariffs?|inflation|liquidations?)\b/i;

export function marketWide(text: string, topic: NewsTopic): boolean {
  return topic === "macro" || topic === "etf" || topic === "regulation" || MARKET_WIDE.test(text);
}

/** English words a symbol in capitals may also be; such a symbol needs `$` or its name. */
const COMMON = new Set(["THE", "AND", "FOR", "NEW", "ALL", "ONE", "TOP", "BIG", "WIN", "NOW", "HOT", "BUY", "SELL", "MOON", "PUMP", "SAFE", "REAL", "BEST", "COIN", "CAT", "DOG", "AI", "US", "CEO", "IPO", "ETF", "SEC", "FED", "API", "NFT", "DAO", "DEX", "CEX", "TVL", "APY", "USD", "EUR", "GDP", "CPI", "WEN", "ME", "IT", "OK", "GO", "UP"]);

export type Candidate = Readonly<{ mint: string; symbol: string; strong: boolean }>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (text: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}_$])${escape(text)}(?![\\p{L}\\p{N}_])`, flags);

/**
 * The tokens an item's words name, each strong (a `$SYMBOL`, a capital
 * symbol that is not an ordinary word, a project's full name) or weak (a
 * short name that is also a word, a followed token's name) — a weak one
 * stands only when the model confirms it.
 */
export function candidatesIn(text: string, terms: readonly TokenTerm[]): readonly Candidate[] {
  const out = new Map<string, Candidate>();
  for (const term of terms) {
    const symbol = term.symbol;
    const dollar = new RegExp(`\\$${escape(symbol)}(?![\\p{L}\\p{N}_])`, "iu").test(text);
    const capital = term.capitalSymbol && symbol.length >= 3 && !COMMON.has(symbol.toUpperCase()) && word(symbol.toUpperCase(), "u").test(text);
    const named = term.names.some((name) => word(name, "iu").test(text));
    const weak = (term.weakNames ?? []).some((name) => word(name, "u").test(text));
    if (!dollar && !capital && !named && !weak) continue;
    const strong = dollar || capital || named;
    /* One mint per symbol in an item: the model answers with symbols, so a second token of the same symbol would borrow the first one's news. */
    if ([...out.values()].some((candidate) => candidate.mint !== term.mint && candidate.symbol.toLowerCase() === symbol.toLowerCase())) continue;
    const kept = out.get(term.mint);
    out.set(term.mint, { mint: term.mint, symbol, strong: strong || (kept?.strong ?? false) });
  }
  return [...out.values()].slice(0, 8);
}

/** A followed token as a term: its symbol and name from the catalogue, every match weak until the model confirms it. */
export function followedTerm(input: Readonly<{ mint: string; symbol: string; name: string }>): TokenTerm | null {
  const symbol = input.symbol.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 16);
  const name = input.name.normalize("NFKC").replace(/[^\p{L}\p{N} .'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 48);
  if (symbol.length < 2) return null;
  /* Every match of a followed token is weak: a name in the catalogue is anyone's to pick, the model confirms it. */
  return { mint: input.mint, symbol, names: [], weakNames: [...(name.length >= 5 && name.toLowerCase() !== symbol.toLowerCase() ? [name] : []), ...(symbol.length >= 3 && symbol === symbol.toUpperCase() && !COMMON.has(symbol) ? [symbol] : [])], capitalSymbol: false };
}

/** A model's labels of a batch, as the schema allows them. */
export type ModelTag = Readonly<{ id: string; tokens: readonly string[]; topic: string }>;

export type HeldTags = Readonly<{ mints: readonly string[]; topic: NewsTopic; byModel: boolean }>;

/**
 * The model's labels held to the words: a token it names must be one of the
 * item's candidates (by symbol, any case), a topic must be one of the list;
 * anything else it said is dropped. Without its label the strong candidates
 * and the words' topic stand.
 */
export function holdTags(candidates: readonly Candidate[], wordsTopic: NewsTopic, tag: ModelTag | null): HeldTags {
  if (tag === null) return { mints: candidates.filter((candidate) => candidate.strong).map((candidate) => candidate.mint), topic: wordsTopic, byModel: false };
  const wanted = new Set(tag.tokens.map((token) => token.replace(/^\$/, "").trim().toLowerCase()));
  const mints = candidates.filter((candidate) => wanted.has(candidate.symbol.toLowerCase())).map((candidate) => candidate.mint);
  const topic = (NEWS_TOPICS as readonly string[]).includes(tag.topic) ? (tag.topic as NewsTopic) : wordsTopic;
  return { mints, topic, byModel: true };
}

/**
 * The followed tokens that may stand beside the verified list: none whose
 * symbol or name is a verified token's, and none that shares a symbol with
 * another followed token — a look-alike gets no real token's news (identity
 * is the mint, and the model is only ever handed one mint per symbol).
 */
export function safeFollowedTerms(followed: readonly TokenTerm[]): TokenTerm[] {
  const verifiedWords = new Set(TOKEN_TERMS.flatMap((term) => [term.symbol, ...term.names, ...(term.weakNames ?? [])].map((word) => word.toLowerCase())));
  const bySymbol = new Map<string, number>();
  for (const term of followed) bySymbol.set(term.symbol.toLowerCase(), (bySymbol.get(term.symbol.toLowerCase()) ?? 0) + 1);
  return followed.filter((term) => {
    if (TOKEN_TERMS.some((known) => known.mint === term.mint)) return false;
    if ((bySymbol.get(term.symbol.toLowerCase()) ?? 0) > 1) return false;
    const words = [term.symbol, ...term.names, ...(term.weakNames ?? [])].map((word) => word.toLowerCase());
    return !words.some((word) => verifiedWords.has(word));
  });
}
