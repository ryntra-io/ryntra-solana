/**
 * The coin's creator: the other coins this wallet launched, how each went, and what it did with this one.
 *
 * Pure and client-safe: the scan's request bodies, the creator's verdict on this coin from what moved, and the list of
 * coins from the launches the chain shows and the market's rows. `creator.server.ts` reads the network behind the
 * deployment's closed switch and calls these; the tests read recorded answers.
 *
 * Every figure is a source's own: the creator is the wallet Jupiter names (`dev`), with its counts of launches and of
 * coins that left their curve; the launches and the creator's moves are the chain's, through Helius's scan; a coin's
 * name, logo and capitalisation are Jupiter's; its highest capitalisation is the highest daily price GeckoTerminal
 * gives times its supply. What a source did not give is `null` — the page prints a dash, never a zero.
 */

import type { SpotMarket } from "./markets.ts";
import type { TokenFacts } from "./token-page.ts";
import type { CoinMove, Launch } from "./creator-chain.ts";

/* ------------------------------------------------------------- the scan */

/** The launch programs whose curves Market Radar watches (`pulse.ts`): pump.fun, Meteora DBC, Raydium LaunchLab. */
export const LAUNCH_PROGRAMS = ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"] as const;

/** Matches one page asks for: Helius's own ceiling for the parsed shape. */
export const SCAN_PAGE_LIMIT = 100;
/** The most history one call of the creator's scans reads: 10 credits a call, plus 1 per thousand scanned. */
export const CREATOR_SCAN_BUDGET = 10_000;

type Body = Record<string, unknown>;

/** What every scan of a wallet asks: newest first, succeeded only, the parsed shape, no raw bytes. */
function walletBody(wallet: string, match: Body, rest: Readonly<{ limit: number; budget: number; tokenAccounts: "none" | "balanceChanged"; sinceS?: number | null; paginationToken?: string | null }>): Body {
  return {
    address: wallet,
    match,
    returnShape: "transactions",
    limit: Math.max(1, Math.min(SCAN_PAGE_LIMIT, Math.floor(rest.limit))),
    commitment: "confirmed",
    sortOrder: "desc",
    status: "succeeded",
    tokenAccounts: rest.tokenAccounts,
    rawTransaction: "none",
    budget: { maxScannedTransactions: rest.budget },
    ...(rest.sinceS !== undefined && rest.sinceS !== null && Number.isFinite(rest.sinceS) ? { time: { gte: Math.max(0, Math.floor(rest.sinceS)) } } : {}),
    ...(rest.paginationToken ? { paginationToken: rest.paginationToken } : {}),
  };
}

/** The creator's transactions on the launch programs, newest first: where its launches are. */
export function launchesBody(creator: string, paginationToken: string | null = null): Body {
  return walletBody(creator, { programs: LAUNCH_PROGRAMS.map((programId) => ({ programId, scope: "transaction" })) }, { limit: SCAN_PAGE_LIMIT, budget: CREATOR_SCAN_BUDGET, tokenAccounts: "none", paginationToken });
}

/**
 * A wallet's transactions that moved its balance of one coin, newest first, since `sinceS` (the coin's birth, when
 * known). Its token accounts count: a transfer in that the wallet never signed is still its own.
 */
export function movesBody(wallet: string, mint: string, options: Readonly<{ sinceS?: number | null; limit?: number; budget?: number; paginationToken?: string | null }> = {}): Body {
  return walletBody(wallet, { mints: [{ mint, scope: "address" }] }, { limit: options.limit ?? SCAN_PAGE_LIMIT, budget: options.budget ?? CREATOR_SCAN_BUDGET, tokenAccounts: "balanceChanged", sinceS: options.sinceS, paginationToken: options.paginationToken });
}

/* ------------------------------------------------- what it did with this */

/**
 * What the creator did with this coin, in one word: holds it, sold part, sold all, moved it to other wallets, or never
 * held it. «Moved» stands over the rest: coins that left for other wallets without anything coming back are what a
 * person most needs to know of.
 */
export type CreatorDid = "holds" | "soldSome" | "soldAll" | "moved" | "never";

export type CreatorAction = Readonly<{
  did: CreatorDid;
  /** Of everything the creator got of the coin in the span read (bought, received, minted to it), the share sold, %. */
  soldPct: number | null;
  /** The same, the share moved to other wallets, %. */
  movedPct: number | null;
  /** The creator's balance of the coin now, tokens; null — not read. */
  holds: number | null;
  /** That balance as a share of the supply, %; null — not counted. */
  holdsPct: number | null;
  /** The wallets the creator moved the coin to, the most first. */
  movedTo: readonly string[];
  /** Moves read; and whether they reach the coin's birth (or the start of the creator's history). */
  moves: number;
  whole: boolean;
}>;

/** How many wallets a «moved to» names: the rest are counted, not listed. */
export const MOVED_TO_LISTED = 3;

/**
 * The creator's verdict from its moves and its balance now. A balance at most a thousandth of what it got is nothing
 * left (dust); without a balance read, a whole history's net stands for it, and an unfinished one says nothing of it.
 */
export function creatorActionOf(input: Readonly<{ moves: readonly CoinMove[]; balance: number | null; supply: number | null; whole: boolean }>): CreatorAction {
  let got = 0;
  let sold = 0;
  let moved = 0;
  let burned = 0;
  const to = new Map<string, number>();
  for (const move of input.moves) {
    if (move.dir === "in") {
      got += move.amount;
      continue;
    }
    if (move.kind === "trade") sold += move.amount;
    else if (move.kind === "burned") burned += move.amount;
    else {
      moved += move.amount;
      if (move.party) to.set(move.party, (to.get(move.party) ?? 0) + move.amount);
    }
  }
  const counted = input.balance !== null && Number.isFinite(input.balance) && input.balance >= 0 ? input.balance : input.whole ? Math.max(0, got - sold - moved - burned) : null;
  const dust = got > 0 ? got * 0.001 : 0;
  const left = counted === null ? null : counted <= dust ? 0 : counted;
  let did: CreatorDid;
  if (moved > dust && moved > 0) did = "moved";
  else if (sold > 0 && (left === 0 || (left === null && sold >= got - dust && got > 0))) did = "soldAll";
  else if (sold > 0) did = "soldSome";
  else if ((left !== null && left > 0) || (left === null && got > 0)) did = "holds";
  else did = "never";
  const share = (part: number) => (got > 0 ? Math.min(100, (part / got) * 100) : null);
  return {
    did,
    soldPct: sold > 0 ? share(sold) : got > 0 ? 0 : null,
    movedPct: moved > 0 ? share(moved) : got > 0 ? 0 : null,
    holds: left,
    holdsPct: left !== null && input.supply !== null && input.supply > 0 ? (left / input.supply) * 100 : null,
    movedTo: [...to.entries()].sort((a, b) => b[1] - a[1]).map(([wallet]) => wallet),
    moves: input.moves.length,
    whole: input.whole,
  };
}

/**
 * A wallet's balance of one coin from a `jsonParsed` token-accounts answer, in the unit the wallet shows: every account
 * added up. Null for an answer of any other shape — never a zero for a read that did not say.
 */
export function balanceOfParsedAccounts(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  let total = 0;
  for (const entry of value) {
    const amount = (entry as { account?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: unknown; decimals?: unknown } } } } } })?.account?.data?.parsed?.info?.tokenAmount;
    const raw = typeof amount?.amount === "string" && /^\d+$/u.test(amount.amount) ? Number(amount.amount) : null;
    const decimals = typeof amount?.decimals === "number" && Number.isInteger(amount.decimals) && amount.decimals >= 0 && amount.decimals <= 18 ? amount.decimals : null;
    if (raw === null || decimals === null) return null;
    total += raw / 10 ** decimals;
  }
  return total;
}

/* -------------------------------------------------------------- its coins */

export type CreatorCoin = Readonly<{
  mint: string;
  symbol: string | null;
  name: string | null;
  /** Whether Jupiter names a logo for it: the page draws it through `/api/icon/<mint>`. */
  icon: boolean;
  /** When it was launched (ISO): the chain's launch, else Jupiter's creation time. */
  launchedAt: string | null;
  /** Capitalisation now, dollars. */
  capUsd: number | null;
  /** The highest capitalisation the coin's daily prices show, dollars; never under `capUsd`; null — not read. */
  peakCapUsd: number | null;
  /** It left its curve for a pool (Jupiter's `graduatedAt`); false — still on its curve; null — not known. */
  listed: boolean | null;
  /** The coin this page is of. */
  current: boolean;
}>;

/** The most coins the tab lists: the newest. */
export const CREATOR_COINS_LISTED = 24;

/** The supply a coin's capitalisation is counted on: Jupiter's circulating supply, else its cap over its price. */
export function capSupplyOf(market: SpotMarket | null | undefined, facts: TokenFacts | null | undefined): number | null {
  if (facts?.circulatingSupply !== null && facts?.circulatingSupply !== undefined && facts.circulatingSupply > 0) return facts.circulatingSupply;
  if (market && market.price !== null && market.marketCapUsd !== null && market.price > 0 && market.marketCapUsd > 0) return market.marketCapUsd / market.price;
  return null;
}

/** The highest capitalisation of a coin's bars: the highest high times its supply; null without bars or a supply. */
export function peakOfBars(bars: readonly Readonly<{ high: number }>[], supply: number | null): number | null {
  if (supply === null || !(supply > 0)) return null;
  let high = 0;
  for (const bar of bars) if (Number.isFinite(bar.high) && bar.high > high) high = bar.high;
  return high > 0 ? high * supply : null;
}

const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

/**
 * The creator's coins, the newest first: every launch the chain showed and this coin even where it did not show it,
 * each with Jupiter's name, logo, capitalisation and whether it left its curve, and its highest capitalisation where it
 * was read. At most `limit`, this coin always among them.
 */
export function creatorCoinsOf(input: Readonly<{
  mint: string;
  launches: readonly Launch[];
  markets: ReadonlyMap<string, SpotMarket>;
  facts: ReadonlyMap<string, TokenFacts>;
  peaks: ReadonlyMap<string, number | null>;
  limit?: number;
}>): CreatorCoin[] {
  const rows = new Map<string, number | null>();
  for (const launch of input.launches) if (!rows.has(launch.mint)) rows.set(launch.mint, launch.at);
  if (!rows.has(input.mint)) {
    const born = input.facts.get(input.mint)?.createdAt ?? null;
    const at = born ? Date.parse(born) : Number.NaN;
    rows.set(input.mint, Number.isFinite(at) ? Math.floor(at / 1000) : null);
  }
  const coins = [...rows.entries()].map(([mint, at]): CreatorCoin => {
    const market = input.markets.get(mint) ?? null;
    const facts = input.facts.get(mint) ?? null;
    const cap = market?.marketCapUsd ?? null;
    const capUsd = cap !== null && Number.isFinite(cap) && cap > 0 ? cap : null;
    const peak = input.peaks.get(mint) ?? null;
    const born = at !== null ? iso(at) : (facts?.createdAt ?? null);
    return {
      mint,
      symbol: market?.symbol ?? null,
      name: market?.name ?? null,
      icon: Boolean(market?.icon),
      launchedAt: born,
      capUsd,
      peakCapUsd: peak !== null && Number.isFinite(peak) && peak > 0 ? Math.max(peak, capUsd ?? 0) : null,
      listed: facts ? (facts.graduatedAt ? true : facts.launchpad ? false : null) : null,
      current: mint === input.mint,
    };
  });
  coins.sort((a, b) => (b.launchedAt ?? "").localeCompare(a.launchedAt ?? ""));
  const limit = input.limit ?? CREATOR_COINS_LISTED;
  const kept = coins.slice(0, limit);
  if (!kept.some((coin) => coin.current)) {
    const current = coins.find((coin) => coin.current);
    if (current) kept.splice(kept.length - 1, 1, current);
  }
  return kept;
}

/**
 * The coins whose highest capitalisation is worth a read, best first: those that left their curve, then the largest
 * now. A coin without a capitalisation is not read — there is nothing to multiply.
 */
export function peakCandidates(coins: readonly CreatorCoin[], most: number): string[] {
  return coins
    .filter((coin) => coin.capUsd !== null)
    .sort((a, b) => Number(b.listed === true) - Number(a.listed === true) || (b.capUsd ?? 0) - (a.capUsd ?? 0))
    .slice(0, Math.max(0, most))
    .map((coin) => coin.mint);
}

/* --------------------------------------------------------------- answer */

/** What the creator's tab reads: the creator, its coins, what it did with this one. */
export type CreatorAnswer = Readonly<{
  creator: string;
  /** How many coins the creator launched, as Jupiter counts them; else how many the chain showed; null — neither. */
  launched: number | null;
  /** How many of them left their curve, as Jupiter counts them; else of those listed; null — not known. */
  listed: number | null;
  coins: readonly CreatorCoin[];
  /** The coins listed are every launch counted (nothing left out). */
  coinsWhole: boolean;
  /** What the creator did with this coin; null — the chain was not read for it. */
  action: CreatorAction | null;
  observedAt: string;
  stale: boolean;
}>;

/** The counts the tab says: Jupiter's own where it gives them, else what the list shows. */
export function creatorCountsOf(facts: TokenFacts | null, coins: readonly CreatorCoin[], scanned: boolean): Readonly<{ launched: number | null; listed: number | null; whole: boolean }> {
  const shown = coins.length;
  const listedShown = coins.filter((coin) => coin.listed === true).length;
  const known = coins.every((coin) => coin.listed !== null);
  const counted = facts?.devMints ?? null;
  const migrated = facts?.devMigrations ?? null;
  /* Jupiter's counts can stand behind the chain by a launch: the larger of the two is said. */
  const launched = counted !== null ? Math.max(counted, scanned ? shown : 0) : scanned ? shown : null;
  const listed = migrated !== null ? Math.max(migrated, scanned ? listedShown : 0) : scanned && known ? listedShown : null;
  return { launched, listed, whole: scanned && (counted === null || shown >= counted) };
}
