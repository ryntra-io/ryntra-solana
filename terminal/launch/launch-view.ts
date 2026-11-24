import type { LaunchMarketRow, LaunchPresetView } from '../../lib/api/v1/contract.ts';
import { LINK_KINDS, type FieldProblem, type FormCheck, type LinkKind } from '../../lib/launch/form.ts';
import { bookOf, parse, type Command } from '../../city/lib/command/parse.ts';
import { wordsNow, type Same } from '../../city/lib/i18n/dict.ts';
import { POOL_FEE, POOL_LADDER, POOL_SPLIT, phaseAt, poolChoiceOf, type PoolChoice, type PoolListed } from '../../city/lib/launch/pool.ts';
import { poolAskOf, withoutPoolWords } from '../../city/lib/launch/pool-ask.ts';
import { readRefusal, type LaunchFailure, type Refusal } from '../../city/lib/launch/refusal.ts';
import { sameOriginImage } from '../../city/lib/launch/towers.ts';
import { REFUSAL_WORDS } from '../../city/lib/launch/words.ts';
import type { Tower } from '../../city/lib/market/types.ts';
import { listed } from '../market/market-view.ts';
import { launchNameHits } from '../../lib/core/launch/moderation.ts';
import { rudeName } from './rude.ts';
import type { LAUNCH_SCREEN } from './words.ts';

/**
 * The Launch screen's rules, over the city's own launch logic (`city/lib/launch/**`): which way a launch goes, what its
 * tiles and its one line say, what people will see on its card, which launches are new on the market and which are the
 * creator's, and how a stopped launch is said in the terminal's words. Every figure is the engine's — its presets, its
 * format's terms, its lists; nothing here counts a fee, builds or signs.
 *
 * Pure: the screen and the tests read it as it is.
 */

type W = Same<(typeof LAUNCH_SCREEN)['en']>;

/** The two ways a coin starts: on its curve (the launch every deployment serves), or straight into its own pool. */
export type Format = 'curve' | 'pool';

/** The way the launch goes: into a pool while that door is open here and the creator chose it; on its curve otherwise. */
export function formatOf(choice: PoolChoice | null, poolOpen: boolean): Format {
  return poolOpen && choice !== null ? 'pool' : 'curve';
}

/** How many times the creator's wallet signs: once on the curve; the coin, the pool and the supply for a pool. */
export function signaturesOf(format: Format): number {
  return format === 'pool' ? 3 : 1;
}

/**
 * The creator's part of the fees, in basis points: the locked liquidity's split for a pool, the part of every trading
 * fee on the curve — the engine's own figures. Null where the engine did not say it.
 */
export function shareBpsOf(format: Format, preset: Pick<LaunchPresetView, 'terms'> | null): number | null {
  if (format === 'pool') return POOL_SPLIT.creatorBps;
  return preset?.terms?.curveSplit.creatorBps ?? null;
}

/** The creator's part of a fee paid through Ryntra, as the line before the signature says it (the city's own line). */
export function lineShareBpsOf(preset: Pick<LaunchPresetView, 'terms'> | null): number | null {
  return preset?.terms?.curveSplitThroughRyntra.creatorBps ?? preset?.terms?.curveSplit.creatorBps ?? null;
}

/** What the first buyers pay: a fee that falls over the first seconds on the curve, or as the price grows in a pool. */
export type Sniper = Readonly<{ startBps: number; endBps: number; seconds: number | null; multiple: number | null }>;

export function sniperOf(format: Format, preset: Pick<LaunchPresetView, 'sniperFee'> | null): Sniper | null {
  if (format === 'pool') return { startBps: POOL_FEE.startBps, endBps: POOL_FEE.endBps, seconds: null, multiple: POOL_FEE.priceMultiple };
  return preset ? { startBps: preset.sniperFee.startBps, endBps: preset.sniperFee.endBps, seconds: preset.sniperFee.seconds, multiple: null } : null;
}

/** The ladder's share of the supply and where it sells, as multiples of the first price — the format's own terms. */
export const LADDER = POOL_LADDER;

/** Who earns the locked liquidity's fees in a pool, basis points — the format's own split. */
export const POOL_SPLIT_BPS = { creator: POOL_SPLIT.creatorBps, ryntra: POOL_SPLIT.ryntraBps } as const;

/**
 * About what a launch into a pool leaves with the network before its first step is built: the city's figure, measured
 * on the program (rent of the pool and the locked positions). The step's own figure replaces it at the first build.
 */
export const POOL_COST_ABOUT_LAMPORTS = '100000000';

/** The network deposit a tile shows: the pool's step figure (or about it), the curve's simulated cost — null until said. */
export function costOf(format: Format, curve: string | null, pool: string | null): string | null {
  if (format === 'pool') return pool !== null && /^\d+$/.test(pool) ? pool : POOL_COST_ABOUT_LAMPORTS;
  return curve !== null && /^\d+$/.test(curve) ? curve : null;
}

/** Lamports as a figure of SOL, rounded up so it is never less than the network takes: two places, four below 0.01. */
export function solOf(lamports: string): number {
  const value = Number(lamports);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value >= 10_000_000 ? Math.ceil(value / 10_000_000) / 100 : Math.ceil(value / 100_000) / 10_000;
}

/** A wait as a clock: «03:51:20», hours unbounded; never negative. */
export function clockLeft(seconds: number): string {
  const left = Math.max(0, Math.floor(seconds));
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(Math.floor(left / 3_600))}:${two(Math.floor((left % 3_600) / 60))}:${two(left % 60)}`;
}

/** Which day a moment falls on, as the creator's own clock reads it: today, tomorrow, or later. */
export function dayOf(at: number, now: number): 'today' | 'tomorrow' | 'later' {
  const day = new Date(at * 1000);
  const today = new Date(now * 1000);
  if (day.toDateString() === today.toDateString()) return 'today';
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  return day.toDateString() === tomorrow.toDateString() ? 'tomorrow' : 'later';
}

/* ------------------------------------------------------------------ the form */

export type Field = 'name' | 'symbol' | 'picture' | 'description' | LinkKind;
export type Shown = Readonly<{ field: Field; words: string }>;

/**
 * The first thing to fix, in one line — the city's own order: a bad or borrowed name at once, an empty field only after
 * the first press, then the picture, then the words about the coin — a link once its field was left or pressed past
 * (`touched`), never while it is being typed —, then the engine's own refusal of the stored picture or name.
 */
export function problemOf(w: W, check: Pick<FormCheck, 'problems' | 'hits'>, picture: Readonly<{ has: boolean; bad: boolean }>, attempted: boolean, refused: Shown | null, touched: ReadonlySet<string> = new Set()): Shown | null {
  const words = (field: 'name' | 'symbol', problem: FieldProblem): string => {
    if (problem === 'BORROWED') return w.readsAs(check.hits.find((hit) => hit.field === field)?.label ?? w.aKnownName);
    if (problem === 'OFFENSIVE') return field === 'name' ? w.anotherName : w.anotherTicker;
    if (problem === 'TOO_LONG') return field === 'name' ? w.nameLong : w.tickerLong;
    if (problem === 'SYMBOL_CHARS') return w.tickerChars;
    return field === 'name' ? w.nameIt : w.tickerIt;
  };
  for (const field of ['name', 'symbol'] as const) {
    const problem = check.problems[field];
    if (problem && (problem !== 'REQUIRED' || attempted)) return { field, words: words(field, problem) };
  }
  if (picture.bad) return { field: 'picture', words: w.pictureKind };
  if (attempted && !picture.has) return { field: 'picture', words: w.pictureNeeded };
  if (check.problems.description) return { field: 'description', words: w.descriptionLong };
  for (const kind of LINK_KINDS) {
    if (check.problems[kind] && (attempted || touched.has(kind))) return { field: kind, words: kind === 'x' ? w.linkX : kind === 'telegram' ? w.linkTelegram : w.linkWebsite };
  }
  return refused;
}

/* ------------------------------------------------------------------ the showcase */

/** A right a new coin's mint keeps or gave up, as Jupiter reads it; null — not said. */
export type Right = 'on' | 'off' | null;

/**
 * A new coin as the Launch screen's lists read it, from the market's depth list or the Pulse. `out` — the source says it
 * is never shown here (a stock, a stablecoin, a coin Jupiter flagged, one passing for a stock, Ryntra's own test): it is
 * still read, so that it takes its older record off the screen (the critic: a coin flagged after it first
 * showed stood on with its old figures).
 */
export type FreshCoin = Readonly<{
  id: string;
  symbol: string;
  name: string;
  icon: string | null;
  mcap: number | null;
  holders: number | null;
  bornAt: string | null;
  mint: Right;
  freeze: Right;
  out?: true;
}>;

const right = (value: unknown): Right => (value === 'on' || value === 'off' ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/**
 * The market's own «New» list (`/api/v1/market/depth?list=fresh`), read defensively: a row it cannot read is left out; a
 * company's stock, a private company's token and a stablecoin — as the depth list itself marks them — are `out`.
 */
export function freshOf(body: unknown): FreshCoin[] {
  const coins = body && typeof body === 'object' && Array.isArray((body as { coins?: unknown }).coins) ? (body as { coins: unknown[] }).coins : [];
  const out: FreshCoin[] = [];
  for (const coin of coins) {
    if (!coin || typeof coin !== 'object') continue;
    const c = coin as Record<string, unknown>;
    if (typeof c.id !== 'string' || typeof c.symbol !== 'string') continue;
    out.push({
      id: c.id,
      symbol: c.symbol,
      name: typeof c.name === 'string' ? c.name : c.symbol,
      icon: typeof c.icon === 'string' ? c.icon : null,
      mcap: count(c.mcap),
      holders: count(c.holders),
      bornAt: typeof c.bornAt === 'string' ? c.bornAt : null,
      mint: right(c.mint),
      freeze: right(c.freeze),
      ...(c.stock === true || c.stable === true || c.kind === 'stock' || c.kind === 'preipo' ? { out: true as const } : {}),
    });
  }
  return out;
}

/** A Pulse feed's rights, where Jupiter stated the token's audit: «on» — the creator kept it; unread — not said. */
const pulseRight = (row: Record<string, unknown>, notice: string): Right => (row.auditRead === true ? (Array.isArray(row.notices) && row.notices.includes(notice) ? 'on' : 'off') : null);

/**
 * The Pulse's feeds of new coins (`/api/spot/pulse?feed=new|soon`, pump.fun and the launchpads, what the Market's Pulse
 * shows), read defensively for the showcase: a row it cannot read is left out; one Jupiter flagged, one passing for a
 * stock and one of Ryntra's own test launches are `out`.
 */
export function pulseFresh(body: unknown): FreshCoin[] {
  const rows = body && typeof body === 'object' && Array.isArray((body as { rows?: unknown }).rows) ? (body as { rows: unknown[] }).rows : [];
  const out: FreshCoin[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.mint !== 'string' || typeof r.symbol !== 'string') continue;
    const flagged = Boolean(r.passesFor) || (Array.isArray(r.notices) && r.notices.includes('FLAGGED'));
    const test = Boolean(r.ryntra && typeof r.ryntra === 'object' && (r.ryntra as { technicalValidation?: unknown }).technicalValidation === true);
    out.push({
      id: r.mint,
      symbol: r.symbol,
      name: typeof r.name === 'string' ? r.name : r.symbol,
      icon: typeof r.icon === 'string' ? r.icon : null,
      mcap: count(r.marketCapUsd),
      holders: count(r.holders),
      bornAt: typeof r.firstPoolAt === 'string' ? r.firstPoolAt : null,
      mint: pulseRight(r, 'MINT_AUTHORITY'),
      freeze: pulseRight(r, 'FREEZE_AUTHORITY'),
      ...(flagged || test ? { out: true as const } : {}),
    });
  }
  return out;
}

/** Newest first by birth; a coin whose birth is not said goes last. */
export const byAge = (a: Readonly<{ bornAt: string | null }>, b: Readonly<{ bornAt: string | null }>): number => (Date.parse(b.bornAt ?? '') || 0) - (Date.parse(a.bornAt ?? '') || 0);

/** A coin's record with the figures `b` measured wherever `a` measured none. */
const filled = (a: FreshCoin, b: FreshCoin): FreshCoin => ({
  ...a,
  icon: a.icon ?? b.icon,
  mcap: a.mcap ?? b.mcap,
  holders: a.holders ?? b.holders,
  bornAt: a.bornAt ?? b.bornAt,
  mint: a.mint ?? b.mint,
  freeze: a.freeze ?? b.freeze,
});

/**
 * The coins the showcase stands after a read: what the sources answered now, newest first, through the
 * showcase's rules, then the coins shown before that no source answered this time. A coin answered now replaces its
 * older record — with its new figures, or gone when it no longer passes (a dump, a flag, a stock) —, and the cap and the
 * one-per-ticker rule fall on the newest. A coin any source marks `out` is out, whatever another source says of it; a
 * figure no source measured now keeps the one shown before, so a row never goes and comes back for a figure not read.
 * At most `max`.
 */
export function freshMerge(was: readonly FreshCoin[], read: readonly FreshCoin[], max: number): FreshCoin[] {
  const answered = new Set(read.map((coin) => coin.id));
  const out = new Set(read.filter((coin) => coin.out).map((coin) => coin.id));
  const before = new Map(was.map((coin) => [coin.id, coin]));
  const merged = new Map<string, FreshCoin>();
  for (const coin of read) {
    if (out.has(coin.id)) continue;
    const same = merged.get(coin.id);
    merged.set(coin.id, same ? filled(same, coin) : coin);
  }
  const records = [...merged.values()].map((coin) => {
    const had = before.get(coin.id);
    return had ? filled(coin, had) : coin;
  });
  const now = showcase(records.sort(byAge), (coin) => ({ ...coin, kept: coin.mint === 'on' || coin.freeze === 'on' }), max);
  return showcase([...now, ...was.filter((coin) => !answered.has(coin.id))].sort(byAge), (coin) => coin, max);
}

/** A ticker as a key beside the addresses a list leaves out: «$NWI» and «nwi» are one; no address starts with «$». */
export const tickerKey = (symbol: string): string => `$${symbol.trim().replace(/^\$+/, '').toUpperCase()}`;

/**
 * What the market's new coins leave out beside the launches on Ryntra: every launch Ryntra took down
 * or launched as its own test — wherever it is listed —, and, where the launches on Ryntra stand above the list (a phone),
 * the ones shown there, by address and by ticker, so no coin stands twice.
 */
export function freshSkip(rows: readonly Readonly<{ token: string; symbol: string; hidden?: true; technicalValidation: boolean }>[], shown: readonly Readonly<{ token: string; symbol: string }>[] | null): ReadonlySet<string> {
  const skip = new Set<string>();
  for (const row of rows) if (row.hidden || row.technicalValidation) skip.add(row.token);
  for (const row of shown ?? []) {
    skip.add(row.token);
    skip.add(tickerKey(row.symbol));
  }
  return skip;
}

/** What the Launch screen reads of a new coin to decide whether it stands in its lists. */
export type Showcased = Readonly<{ symbol: string; name: string; icon: string | null; mcap: number | null; holders?: number | null; kept?: boolean }>;

/** The fewest people holding a new coin for it to stand beside a launch: below it, a list is mostly tests and spam. */
export const SHOWCASE_HOLDERS = 5;
/** The least market cap, dollars, of a coin the showcase shows: below it a coin is a test nobody bought. */
export const SHOWCASE_MCAP_USD = 1_000;

/* Names the showcase leaves out as borrowed beside the form's own list, anywhere inside a word of the ticker or the name
   («SUPERGROK», «GTAVI», «BASEDCLAWD» — never across two words: «Frog Tank» is not «gta», «Puma Gang» not «maga»): a game,
   its studio and its people, an assistant («clawd» — EYES 19.11), an «official», a politician's slogan, a company. */
const BORROWED = ['gta', 'leonida', 'rockstar', 'nintendo', 'mario', 'yoshi', 'pikachu', 'pokemon', 'claude', 'clawd', 'grok', 'intel', 'nvidia', 'broadcom', 'sandisk', 'hynix', 'tesla', 'neuralink', 'anduril', 'microstrategy', 'nasdaq', 'proshares', 'polymarket', 'kalshi', 'official', 'maga', 'wwgwga'];
/* Ordinary words that hold a borrowed one: «Grokking Cat», «Clawdia». */
const BORROWED_NOT = /grokk|clawdia/g;
/* Names of several words, borrowed across them within the ticker or the name: «Grand Theft Auto», «Take-Two», «Open AI». */
const BORROWED_SPAN = ['grandtheftauto', 'theftauto', 'vicecity', 'taketwo', 'carljohnson', 'doctordoom', 'advancedmicro', 'openai', 'chatgpt', 'spacex', 'weknowthetruth'];
/* Borrowed only as a word of its own, or with a meme word glued on («JUPITERDOG», «ZELLEPAY»), being part of ordinary
   words too: a game's heroine («Lucia's Feet» in the feed of 17.11 — never «Lucian»), a payment brand («ZelleUSD» — never
   «Gazelle»), a partner's name, a trader's, a camera, a studio, a stock issuer. */
const BORROWED_WORDS: readonly string[] = ['lucia', 'zelle', 'jupiter', 'ansem', 'gopro', 'marvel', 'ondo'];
const MEME_AFFIXES: ReadonlySet<string> = new Set(['coin', 'token', 'inu', 'dog', 'cat', 'ai', 'pay', 'sol', 'x', 'baby', 'pepe', 'bot', 'fi']);
/* «Grand … Auto», whatever stands between. */
const BORROWED_GAME = /grand\p{L}{0,12}auto/u;
/* Not a coin someone launched, as its name says it where the source did not: a company's share on the chain («Apple
   xStock», «Kalshi PreStocks», «Snap - Backpack Securities», «SpaceX (Ondo Tokenized)») — never «Six Stocks» — or a coin of
   another chain wrapped («Wrapped NEAR», ticker «wNEAR») — never «Gift Wrapped». */
const NOT_A_LAUNCH = /(?:^|[\s(-])(?:x|pre)stocks?\b|\bsecurities\b|\btokenized\b|\((?:sollet|wormhole|portal|allbridge)\b/i;
const WRAPPED = (coin: Showcased) => /^wrapped\s/i.test(coin.name.trim()) && /^w[a-z0-9]{2,5}$/i.test(coin.symbol.trim());
/* A dollar at the ticker's end, with at most one sign after it, is a stablecoin («ZLUSD», «JupUSD», «USDG», «sUSDe»,
   «syrupUSDC»), and so is a euro's («EURC») — never «BUSDRIVER», «USDUCK». */
const STABLE_TICKER = /usd[a-z0-9]?$|^\$?eur[ct]?$/i;

/* Names that are a test or an advert, never a coin: «test», «awd awd», «asdf», «Sponsored». */
const JUNK = /^(?:test(?:ing)?\d*|awd(?:\s*awd)*|asdf+|qwe(?:rty)?|sponsored|promo|ad|scam|rug|honeypot|airdrop)$/i;
/* An advert anywhere in the name: a casino's token («1win Token» in the feed of 17.11). */
const ADVERT = /\b1\s?win\b|casino/i;

/** A name's words, lower case: split on what is not a letter and on camel case («ZelleUSD» → «zelle», «usd»). */
const wordsOf = (text: string): string[] =>
  text
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);

/** A name's words as written, lower case: split on what is not a letter only («SanDisk» → «sandisk»). */
const plainWordsOf = (text: string): string[] => text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

/** A word that is the brand, or the brand with meme words glued on either side («jupiterdog», «babyzelle»). */
function wordIs(word: string, brand: string): boolean {
  if (word === brand) return true;
  const at = word.indexOf(brand);
  if (at < 0) return false;
  const glued = (rest: string) => rest === '' || MEME_AFFIXES.has(rest) || [...MEME_AFFIXES].some((affix) => rest.startsWith(affix) && MEME_AFFIXES.has(rest.slice(affix.length)));
  return glued(word.slice(0, at)) && glued(word.slice(at + brand.length));
}

/**
 * Whether a new coin stands in the Launch screen's lists: the screen shows what a launch looks like beside the
 * others, so only a coin with a logo of its own, a market cap of at least $1K and a few people holding it (where the
 * list says how many), a ticker of letters, no test or advert for a name, whose creator gave up minting and freezing
 * (`kept` — either right kept), and whose name and ticker are neither crude nor hateful (`rude.ts`) nor borrowed from a
 * known brand or person (the form's own `launchNameHits`). The market's own lists are not changed.
 */
export function showcased(coin: Showcased): boolean {
  if (coin.icon === null || coin.mcap === null || coin.mcap < SHOWCASE_MCAP_USD || coin.kept === true) return false;
  if (coin.holders !== undefined && (coin.holders ?? 0) < SHOWCASE_HOLDERS) return false;
  // A ticker of signs or figures alone («******», «34%») or a test or an advert is not a coin to show.
  if ((coin.symbol.match(/\p{L}/gu) ?? []).length < 2) return false;
  if (JUNK.test(coin.symbol.trim().replace(/^\$+/, '')) || JUNK.test(coin.name.trim()) || ADVERT.test(`${coin.symbol} ${coin.name}`)) return false;
  // A stablecoin, a company's share or a wrapped coin is not a launch.
  if (STABLE_TICKER.test(coin.symbol.trim()) || NOT_A_LAUNCH.test(coin.name) || WRAPPED(coin)) return false;
  if (rudeName(coin.symbol, coin.name)) return false;
  // Borrowed in the ticker or the name — here a false match only hides a coin.
  for (const field of [coin.symbol, coin.name]) {
    const glued = field.toLowerCase().replace(/[^\p{L}]+/gu, '');
    if (BORROWED_SPAN.some((name) => glued.includes(name)) || BORROWED_GAME.test(glued)) return false;
  }
  // Inside a word as it is written («SanDisk», «GoPro» stay one word here), and a short brand also as camel case splits it.
  const plain = [...plainWordsOf(coin.symbol), ...plainWordsOf(coin.name)];
  if (plain.some((word) => BORROWED.some((name) => word.replace(BORROWED_NOT, '').includes(name)))) return false;
  if ([...plain, ...wordsOf(coin.symbol), ...wordsOf(coin.name)].some((word) => BORROWED_WORDS.some((brand) => wordIs(word, brand)))) return false;
  return launchNameHits({ name: coin.name, symbol: coin.symbol }).length === 0;
}

/** The coins that stand in a list, in their order, at most `max`, one per ticker. */
export function showcase<T>(coins: readonly T[], read: (coin: T) => Showcased, max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const coin of coins) {
    const said = read(coin);
    if (!showcased(said)) continue;
    const ticker = said.symbol.trim().replace(/^\$+/, '').toUpperCase();
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(coin);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The rows a list of new coins shows, at most `max`, newest first as they came: only coins whose logo was read before the
 * row was drawn (`seen` — true, read; false, did not come), and none that failed after (`missed`). A row is never drawn and
 * then let go as its logo fails, so the rows around it never move (the «New» tab jumped 0.12 of a desk's
 * screen), and the order stays the age order the tab writes.
 */
export function logoRows<T extends Readonly<{ id: string }>>(coins: readonly T[], seen: ReadonlyMap<string, boolean>, missed: ReadonlySet<string>, max = Number.POSITIVE_INFINITY): T[] {
  return coins.filter((coin) => seen.get(coin.id) === true && !missed.has(coin.id)).slice(0, max);
}

/* ------------------------------------------------------------------ the agent's sentence */

/** The command line reads whether a pool was asked for, never when (the city's own epoch for it). */
const POOL_EPOCH = new Date(0);

/**
 * A sentence handed from the agent's line, read again for the pool's words: «… в пул о 20:00» keeps its name and ticker
 * clean — a coin's name is written on chain for ever — and, where the pool's door is open, its time and pair go to the
 * form. Where that door is shut the launch goes on its curve, without the pool's words in its name.
 */
export function launchCommandOf(said: string, command: Command, towers: readonly Tower[], poolOpen: boolean): Command {
  if (command.kind !== 'launch' || !poolAskOf(said, POOL_EPOCH).asked) return command;
  if (poolOpen) {
    const again = parse(said, bookOf(towers), { subject: null, pools: true });
    return again.kind === 'launch' ? again : command;
  }
  const plain = withoutPoolWords(said);
  const again = plain ? parse(plain, bookOf(towers), { subject: null }) : null;
  return again?.kind === 'launch' ? again : command;
}

/** What a sentence writes into the form: the ticker and the name it said, and the pool's choice where its door is open. */
export type Fill = Readonly<{ symbol: string | null; name: string | null; pool: PoolChoice | null }>;

export function fillOf(draft: Readonly<{ symbol: string | null; name: string | null; pool?: string }>, poolOpen: boolean, now: Date): Fill {
  return { symbol: draft.symbol, name: draft.name, pool: draft.pool && poolOpen ? poolChoiceOf(draft.pool, now) : null };
}

/* ------------------------------------------------------------------ a stopped launch */

/**
 * A stopped launch in the terminal's words: the city's reading of the engine's code — one sentence, the money, one
 * way on — with the few sentences that name the city said plainly, and the pool's «the whole launch needs more SOL».
 */
export function refusalOf(w: W, failure: LaunchFailure, wallet: string | null, at: Date | null): Refusal {
  const base = readRefusal(failure, wallet, at);
  // A pool's later step refused for SOL stops the launch half-way: it waits for «Continue», and says what it needs.
  const lowHalfWay = failure.code === 'POOL_HALF_WAY' && /^LAUNCH_BALANCE_LOW\b/.test(failure.message);
  const said =
    failure.code === 'LAUNCH_BALANCE_LOW'
      ? { ...base, kind: 'lowSol' as const, what: w.lowSol, action: 'topUp' as const, act: wordsNow(REFUSAL_WORDS).actTopUp }
      : lowHalfWay
        ? { ...base, what: w.lowSol }
        : base.kind === 'closed'
          ? { ...base, what: w.closed }
          : base;
  if (said.moneyKind === 'maybeLanded') return { ...said, money: w.maybeLanded };
  if (said.moneyKind === 'landing') return { ...said, money: w.landing };
  return said;
}

/* ------------------------------------------------------------------ the lists */

/** The launches new on the market, newest first: the market's own «New» launches (the coins launched in the last hours). */
export function freshLaunches(towers: readonly Tower[], max = Number.POSITIVE_INFINITY): Tower[] {
  return listed(towers)
    .filter((tower) => tower.district === 'docks')
    .sort((a, b) => (Date.parse(b.launchedAt ?? '') || 0) - (Date.parse(a.launchedAt ?? '') || 0))
    .slice(0, max);
}

/** A figure of a tower the market measured, or null — an unmeasured figure is never shown as zero. */
export function measured(tower: Tower, figure: 'holders' | 'mcap'): number | null {
  if (tower.unread?.includes(figure)) return null;
  const value = tower[figure];
  return Number.isFinite(value) && value > 0 ? value : null;
}

export type Age = Readonly<{ unit: 'now' | 'min' | 'hour' | 'day'; n: number }>;

/** How long ago a coin launched: «just now» in its first two minutes, then minutes, hours, days. */
export function ageOf(launchedAt: string | null, now: number): Age | null {
  const at = Date.parse(launchedAt ?? '');
  if (!Number.isFinite(at)) return null;
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 120) return { unit: 'now', n: 0 };
  if (seconds < 3_600) return { unit: 'min', n: Math.floor(seconds / 60) };
  if (seconds < 86_400) return { unit: 'hour', n: Math.floor(seconds / 3_600) };
  return { unit: 'day', n: Math.floor(seconds / 86_400) };
}

export function ageText(w: W, age: Age | null): string | null {
  if (!age) return null;
  if (age.unit === 'now') return w.justNow;
  return age.unit === 'min' ? w.minutesAgo(age.n) : age.unit === 'hour' ? w.hoursAgo(age.n) : w.daysAgo(age.n);
}

/** A coin the creator launched: on its curve — its way to the pool —, or in its own pool — its opening. */
export type Mine = Readonly<{
  token: string;
  symbol: string;
  name: string;
  image: string | null;
  kind: 'curve' | 'pool';
  /** The curve's way to the pool, 0…10 000; null when not read. */
  progressBps: number | null;
  migrated: boolean;
  /** When a pool's trading opens, unix seconds. */
  opensAt: number | null;
  phase: 'BUILDING' | 'COUNTDOWN' | 'OPEN' | null;
  at: number;
}>;

/** The creator's coins: the engine's list of launches on the curve and of launches into a pool, newest first. */
export function mineOf(rows: readonly LaunchMarketRow[] | null, pools: readonly PoolListed[], creator: string | null, now: number): Mine[] {
  if (!creator) return [];
  const curve: Mine[] = (rows ?? [])
    .filter((row) => row.creator === creator)
    .map((row) => ({
      token: row.token,
      symbol: row.symbol,
      name: row.name,
      image: row.hidden ? null : sameOriginImage(row.image),
      kind: 'curve',
      progressBps: row.progress?.bps ?? null,
      migrated: row.progress?.migrated === true,
      opensAt: null,
      phase: null,
      at: Date.parse(row.launchedAt) || 0,
    }));
  const pooled: Mine[] = pools
    .filter((launch) => launch.creator === creator)
    .map((launch) => ({
      token: launch.mint,
      symbol: launch.symbol,
      name: launch.name,
      image: null,
      kind: 'pool',
      progressBps: null,
      migrated: false,
      opensAt: launch.opensAt,
      phase: phaseAt(launch, Math.floor(now / 1000)),
      at: Date.parse(launch.createdAt) || 0,
    }));
  const seen = new Set<string>();
  return [...pooled, ...curve]
    .filter((mine) => (seen.has(mine.token) ? false : (seen.add(mine.token), true)))
    .sort((a, b) => b.at - a.at);
}
