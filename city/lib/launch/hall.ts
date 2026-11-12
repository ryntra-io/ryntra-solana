import type { LaunchMarketResponse, LaunchMarketRow, LaunchStatsResponse, LaunchTradeRow } from '../../../lib/api/v1/contract.ts';
import type { CityTrade, TradeJudgement } from '../../../lib/city-economy/honest-count.ts';
import { shownText } from '../../../lib/world/text-safety/clean.ts';
import type { Network } from './engine.ts';

/**
 * The Hall of Fame: the city's billboards of the week — the biggest × of the week, the top hunters, the top creators
 * and the top scouts — from the Launch engine's own answers, and only from trades the honest count lets a billboard
 * count (`lib/city-economy`).
 *
 * ## Every number says what it is
 *
 * A number on a billboard carries its type, its period and where anyone can check it:
 * - a **multiple** (`×3.4 since this buy`) — the coin's market cap now over the market cap the buy left, both the
 *   engine's own figures; a fact about the entry, never a profit and never a promise — a multiple shown as data;
 * - a **fee** (`creator fee · 7D · before costs`) — the engine's own total of what the creator's side earned over the
 *   engine's last seven days (`windowTotal` of `…/stats`); the city never adds money up.
 * Each has a transaction (the buy) or the account the engine names for it (the curve or the pool), and the time the
 * engine read it.
 *
 * ## What is never counted
 *
 * - A trade inside one wallet cluster — the buyer and the coin's creator are one wallet, one signer or one cluster as
 *   the Growth line sees it — and a trade nobody has checked yet: «not known» is not counted.
 * - A creator whose week rests on such a trade: the engine's figure is the whole week's, so a week with one trade
 *   inside, unchecked or not read whole is not shown at all, rather than shown with what should not count.
 * - Ryntra's own launches and wallets, and the wallets the Growth line keeps off every board (the owner's, the test
 *   wallets, and anyone who chose to be hidden).
 * The share of the week's trades left out this way is published with the boards.
 *
 * ## A quiet week reaches back (CITY-230)
 *
 * A board whose week counts nobody reaches back over the last 30 days, then over all time — the first span that counts
 * someone — and says which one on its sign: «this week», «this month», «all time». The same rules hold over every span:
 * the same honest count, the same types, a period and a proof for every number. The creators' board has no 30 days —
 * the engine counts a creator's fee over its day and its week, and over all time on the chain's own counters (the
 * cabinet's figure) — so it reaches from the week straight to all time, and only for a launch whose every trade was
 * read and counted. A board that counts nobody even over all time stays empty: the city shows it as one action, launch
 * your own, never a made-up row.
 *
 * ## Scouts
 *
 * A scout brings people and earns a share of their fees. The engine keeps those shares in the rewards ledger, whose
 * public boards show no one else's dollar figure and no transaction; until the engine publishes a scout's share per
 * trade, the scouts' billboard says it has no source rather than show a number it cannot back.
 *
 * Pure: the engine's answers, the honest count's judgements, the wallets left out and the clock are the caller's.
 */

export const HALL_VERSION = 'city-hall-1.1.0';

/** The week of the Hall: the last seven days up to the read, as the engine counts its own week. */
export const HALL_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** The month a quiet week reaches back over: the last 30 days up to the read. */
export const HALL_MONTH_MS = 30 * 24 * 60 * 60_000;

/** The spans a board reaches back over, in order: the week, the last 30 days, all time — the first that counts someone. */
export const HALL_SPANS = ['week', 'month', 'all'] as const;
export type HallSpan = (typeof HALL_SPANS)[number];
/** Rows a board shows. */
export const HALL_ROWS = 5;
/** Markets read whole for one Hall at most — the engine's own order: traded in the last day first, then the newest. */
export const HALL_MARKETS_MAX = 24;
/** A catch is shown from ×1.1: the coin is worth more than the buy left it. */
export const MIN_CATCH_TENTHS = 11;

export const HALL_BOARDS = ['catch', 'hunters', 'creators', 'scouts'] as const;
export type HallBoardId = (typeof HALL_BOARDS)[number];

/** The types a number on a billboard may have: three for money — revenue, fee, net result — and a multiple as data. */
export const FIGURE_KINDS = ['revenue', 'fee', 'net', 'multiple'] as const;
export type FigureKind = (typeof FIGURE_KINDS)[number];

export type HallPeriod = Readonly<{ from: string; to: string }>;

export type HallFigure =
  /** The market cap now over the market cap the buy left, in tenths, rounded down: 34 is ×3.4. */
  | Readonly<{ kind: 'multiple'; tenths: number; since: 'buy' }>
  /** The engine's total of the creator's side over its week, raw in the pair currency; `atLeast` — a floor. */
  | Readonly<{ kind: 'fee'; of: 'creator'; raw: string; atLeast: boolean; pair: Readonly<{ symbol: string; decimals: number; dollar: boolean }> }>;

/** Where anyone can check a number: the transaction itself, or the account the engine names for a week's figure. */
export type HallProof = Readonly<{ kind: 'tx' | 'account'; id: string; url: string }>;

export type HallRow = Readonly<{
  place: number;
  /** Four characters from each end of the wallet — the way every board of Ryntra names someone. */
  name: string;
  coin: Readonly<{ token: string; symbol: string; name: string }>;
  figure: HallFigure;
  period: HallPeriod;
  proof: HallProof;
  /** When the engine read the figure. */
  readAt: string;
  /** The engine's own labels of the wallet on this coin (a sniper bought in its opening minutes). */
  labels: readonly string[];
}>;

/** Why a creator's week is left off its board. */
export const LEFT_REASONS = ['cluster', 'unchecked', 'unread', 'no_dollar'] as const;
export type LeftReason = (typeof LEFT_REASONS)[number];

export type HallBoard = Readonly<{
  /** `live` — rows counted; `empty` — nothing counted even over all time; `no_source` — the engine publishes nothing to count. */
  state: 'live' | 'empty' | 'no_source';
  /** The span the rows are of: the week, else the last 30 days, else all time. An empty board is empty over all time. */
  span: HallSpan;
  /** The span's period: its start (all time — the oldest launch read) to the read. */
  period: HallPeriod;
  rows: readonly HallRow[];
  /** Creators' spans read and left off, by why — over the board's span. */
  left: Readonly<Record<LeftReason, number>>;
}>;

/** The week's trades on Ryntra's launches as the honest count judged them for billboards. */
export type HallTally = Readonly<{
  /** Every trade of the week read and judged, each once. */
  trades: number;
  counted: number;
  /** Inside one wallet cluster. */
  inside: number;
  /** Not known either way yet. */
  unchecked: number;
  /** Inside out of the trades checked either way, basis points, rounded down; null — nothing checked. */
  insideBps: number | null;
  /** Not checked out of all, basis points, rounded down; null — no trades. */
  uncheckedBps: number | null;
}>;

export type HallView = Readonly<{
  v: 1;
  network: Network;
  /** The week the Hall counts. */
  window: HallPeriod;
  /** The oldest engine read the Hall rests on; null when it rests on none. */
  readAt: string | null;
  computedAt: string;
  /** Ryntra's launches of people that could have traded this week, and how many of them were read. */
  markets: Readonly<{ listed: number; read: number }>;
  /** The week's tally — the same as `tallies.week`. */
  trades: HallTally;
  /** The tally over each span a board may reach back over. */
  tallies: Readonly<Record<HallSpan, HallTally>>;
  boards: Readonly<Record<HallBoardId, HallBoard>>;
  rules: string;
}>;

/** One market as the engine answered it: its row, its market read whole, its figures; null where a read failed. */
export type HallMarketRead = Readonly<{
  row: LaunchMarketRow;
  market: LaunchMarketResponse | null;
  stats: LaunchStatsResponse | null;
  /** The engine's own total of `stats.revenue.week` (`windowTotal`); null when stats were not read. */
  weekFee: Readonly<{ raw: string | null; atLeast: boolean }> | null;
  /**
   * What the creator's role earned over all time, raw in the pair currency, on the chain's own counters — the cabinet's
   * figure (`creatorEarnings(…).role.earnedRaw`) — and when it was read; null or absent when it was not read.
   */
  allFee?: Readonly<{ raw: string; at: string }> | null;
}>;

/* ------------------------------------------------------------------------------------------------
 * Which markets, which trades
 * --------------------------------------------------------------------------------------------- */

/** The week up to `now`. */
export function hallWindow(now: number): HallPeriod {
  return { from: new Date(now - HALL_WINDOW_MS).toISOString(), to: new Date(now).toISOString() };
}

/** A span's period up to `now`: the week, the last 30 days, or all time — from the oldest launch read (or the month's start). */
export function spanPeriod(span: HallSpan, now: number, reads: readonly Pick<HallMarketRead, 'row'>[] = []): HallPeriod {
  if (span === 'week') return hallWindow(now);
  const month = { from: new Date(now - HALL_MONTH_MS).toISOString(), to: new Date(now).toISOString() };
  if (span === 'month') return month;
  const oldest = reads.map((read) => Date.parse(read.row.launchedAt)).filter((at) => Number.isFinite(at) && at < Date.parse(month.from));
  return oldest.length ? { from: new Date(Math.min(...oldest)).toISOString(), to: month.to } : month;
}

/** All time as the reads see it: every trade up to the read, however old. */
const ALL_TIME: HallPeriod = { from: new Date(0).toISOString(), to: new Date(8.64e15).toISOString() };

/**
 * The markets worth reading for the week: people's launches (never Ryntra's own), launched before the week ended, in
 * the engine's own order — with a trade in the last day first, then by state and the newest — at most `max`.
 */
export function hallCandidates(rows: readonly LaunchMarketRow[], now: number, max: number = HALL_MARKETS_MAX): Readonly<{ listed: number; chosen: readonly LaunchMarketRow[] }> {
  const people = rows.filter((row) => !row.technicalValidation && Date.parse(row.launchedAt) <= now);
  return { listed: people.length, chosen: people.slice(0, max) };
}

const within = (at: string, period: HallPeriod) => {
  const time = Date.parse(at);
  return Number.isFinite(time) && time >= Date.parse(period.from) && time < Date.parse(period.to);
};

/** The trades of a market's read inside `period`, made and paid by nobody the Hall leaves out. */
function weekRows(market: LaunchMarketResponse, period: HallPeriod, exclude: ReadonlySet<string>): readonly LaunchTradeRow[] {
  return market.trades.rows.filter((row) => within(row.at, period) && !exclude.has(row.trader) && !exclude.has(row.payer));
}

/** Whether the read reaches back past `from`: every trade of the token, or the newest page reaching before it. */
function covers(market: LaunchMarketResponse, from: string): boolean {
  if (market.trades.complete) return true;
  const oldest = market.trades.rows.at(-1);
  return oldest !== undefined && Date.parse(oldest.at) <= Date.parse(from);
}

/** A raw amount of a currency with `decimals` as micro-units of it (USD micros for a dollar pair). */
export function rawToMicros(raw: string, decimals: number): bigint {
  const value = BigInt(raw);
  return decimals >= 6 ? value / 10n ** BigInt(decimals - 6) : value * 10n ** BigInt(6 - decimals);
}

/**
 * One trade of a launch as the honest count reads it: the wallet whose tokens moved is the one acting (the buyer of a
 * buy, the seller of a sale), the wallet that paid for it signed it, the coin's creator is the party it could credit,
 * and the dollar side is known only on a dollar pair. A launch trade starts in no quarter and names no friend.
 */
export function cityTradeOf(row: LaunchTradeRow, market: LaunchMarketResponse): CityTrade {
  return {
    tx: row.signature,
    at: row.at,
    mint: market.token,
    buyer: row.trader,
    signers: [row.payer],
    creator: market.creator.address,
    host: null,
    friend: null,
    usdMicros: market.pair.dollar ? rawToMicros(row.pairRaw, market.pair.decimals) : null,
  };
}

/** The engine's own week of a creator's figures: the seven days up to its read. */
function statsWeek(stats: LaunchStatsResponse): HallPeriod {
  return { from: new Date(Date.parse(stats.observedAt) - HALL_WINDOW_MS).toISOString(), to: stats.observedAt };
}

/**
 * Every trade the Hall asks the honest count about, each once: the Hall's week, and the engine's own week of a
 * creator's figures where its read is a little older — and, for a span reaching further back, every older trade read
 * after them, the newest first, so the week is always asked about first.
 */
export function hallTrades(reads: readonly HallMarketRead[], now: number, exclude: ReadonlySet<string>, span: HallSpan = 'week'): readonly CityTrade[] {
  const window = hallWindow(now);
  const seen = new Map<string, CityTrade>();
  for (const { market, stats } of reads) {
    if (!market) continue;
    const from = stats && statsWeek(stats).from < window.from ? statsWeek(stats).from : window.from;
    for (const row of weekRows(market, { from, to: window.to }, exclude)) if (!seen.has(row.signature)) seen.set(row.signature, cityTradeOf(row, market));
  }
  const week = [...seen.values()];
  if (span === 'week') return week;
  /* All time also reaches every trade read past the read's own clock, as the creators' all-time figure rests on them all. */
  const period = span === 'month' ? spanPeriod('month', now) : ALL_TIME;
  const older: CityTrade[] = [];
  for (const { market } of reads) {
    if (!market) continue;
    for (const row of weekRows(market, period, exclude)) {
      if (seen.has(row.signature)) continue;
      const trade = cityTradeOf(row, market);
      seen.set(row.signature, trade);
      older.push(trade);
    }
  }
  older.sort((a, b) => byText(b.at, a.at) || byText(a.tx, b.tx));
  return [...week, ...older];
}

/* ------------------------------------------------------------------------------------------------
 * The boards
 * --------------------------------------------------------------------------------------------- */

/** Where a transaction or an account opens: Solscan, as the engine's own links. */
export function explorerUrl(network: Network, kind: 'tx' | 'account', id: string): string {
  return `https://solscan.io/${kind}/${id}${network === 'solana:devnet' ? '?cluster=devnet' : ''}`;
}

/** Four characters from each end. */
export function maskWallet(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** The market cap now over the market cap a trade left, in tenths, rounded down; null when either is not a figure. */
export function catchTenths(capNow: number, capThen: number): number | null {
  if (!(capNow > 0) || !(capThen > 0) || !Number.isFinite(capNow) || !Number.isFinite(capThen)) return null;
  return Math.floor((capNow * 10) / capThen + 1e-9);
}

const counted = (judgement: TradeJudgement | undefined) => judgement?.counts.billboards.counted === true;

/** `whole` — the coin's every trade was read, so its catches may stand on an all-time board. */
type Catch = Readonly<{ wallet: string; at: string; whole: boolean; row: HallRow }>;

/** A creator's ticker and name on a billboard: somebody else's text (CITY-73). A held ticker stands on no billboard. */
function coinOf(token: string, row: Pick<LaunchMarketRow, 'symbol' | 'name'>): HallRow['coin'] | null {
  const symbol = shownText(row.symbol, 'symbol', 32);
  return symbol ? { token, symbol, name: shownText(row.name, 'name') ?? symbol } : null;
}
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const EMPTY_LEFT: Readonly<Record<LeftReason, number>> = Object.freeze({ cluster: 0, unchecked: 0, unread: 0, no_dollar: 0 });

function board(rows: readonly HallRow[], span: HallSpan, period: HallPeriod, left: Readonly<Record<LeftReason, number>> = EMPTY_LEFT): HallBoard {
  return { state: rows.length ? 'live' : 'empty', span, period, rows: rows.slice(0, HALL_ROWS).map((row, index) => ({ ...row, place: index + 1 })), left };
}

/** The first span whose rows count someone, or an empty board over all time. */
function firstFilled(spans: ReadonlyArray<Readonly<{ span: HallSpan; period: HallPeriod; rows: readonly HallRow[]; left?: Readonly<Record<LeftReason, number>> }>>): HallBoard {
  const filled = spans.find((entry) => entry.rows.length > 0) ?? spans[spans.length - 1]!;
  return board(filled.rows, filled.span, filled.period, filled.left);
}

/** Whether a board of this Hall reaches back past its week, or stands empty — the honest count is then asked about older trades too. */
export function hallReachesBack(view: Pick<HallView, 'boards'>): boolean {
  return HALL_BOARDS.some((id) => view.boards[id].state !== 'no_source' && (view.boards[id].state === 'empty' || view.boards[id].span !== 'week'));
}

/**
 * What a tap on a board's sign — or its panel's one action — does: a board nobody is on even over all time opens a
 * launch where the city can open one here; any other board opens the Hall's panel on that board.
 */
export function hallAction(board: Pick<HallBoard, 'rows' | 'left'>, launchable: boolean): 'launch' | 'panel' {
  return board.rows.length === 0 && launchable && hallSettled(board) ? 'launch' : 'panel';
}

/**
 * Whether an empty board is certainly empty: every trade it would count was read and checked. A board left empty by a
 * read cut short says it plainly and does not offer «Launch yours» as if nobody were there.
 */
export function hallSettled(board: Pick<HallBoard, 'left'>): boolean {
  return board.left.unchecked === 0 && board.left.unread === 0;
}

type Creator = Readonly<{ micros: bigint; at: string; row: HallRow }>;

/** Creators one row each, their best coin: the most first; a tie goes to the earlier launch, then the plain order of addresses. */
function rankCreators(best: ReadonlyMap<string, Creator>): HallRow[] {
  return [...best.entries()]
    .sort(([wa, a], [wb, b]) => (b.micros > a.micros ? 1 : b.micros < a.micros ? -1 : 0) || byText(a.at, b.at) || byText(wa, wb))
    .map(([, value]) => value.row);
}

function keepBest(best: Map<string, Creator>, creator: string, entry: Creator): void {
  const held = best.get(creator);
  if (!held || entry.micros > held.micros || (entry.micros === held.micros && entry.at < held.at)) best.set(creator, entry);
}

/**
 * The Hall: every trade read judged once, the counted buys ranked by how far the coin went since, the creators whose
 * whole span counts ranked by the engine's own fee, and the share left out — each board over its week, or reaching back
 * over the last 30 days and all time when the week counts nobody.
 */
export function hallView(
  args: Readonly<{
    network: Network;
    reads: readonly HallMarketRead[];
    /** The honest count's judgement of every trade `hallTrades` named, by signature; one missing is not checked. */
    judgements: ReadonlyMap<string, TradeJudgement>;
    /** Ryntra's own wallets and every wallet the Growth line keeps off the boards. */
    exclude: ReadonlySet<string>;
    /** Ryntra's launches of people this week could have traded (`hallCandidates`). */
    listed: number;
    now: number;
  }>,
): HallView {
  const { network, judgements, exclude, now } = args;
  const window = hallWindow(now);
  const reads = args.reads.filter((read) => !read.row.technicalValidation);
  const periods: Readonly<Record<HallSpan, HallPeriod>> = { week: window, month: spanPeriod('month', now), all: spanPeriod('all', now, reads) };
  const readTimes: string[] = [];

  /* Every trade read up to the read, each once, as judged — tallied by the spans it falls in. */
  const tallies = { week: { trades: 0, counted: 0, inside: 0, unchecked: 0 }, month: { trades: 0, counted: 0, inside: 0, unchecked: 0 }, all: { trades: 0, counted: 0, inside: 0, unchecked: 0 } };
  const judgedOnce = new Set<string>();
  const catches: Catch[] = [];

  for (const { row, market } of reads) {
    if (!market) continue;
    readTimes.push(market.observedAt);
    const capNow = market.marketCap.pair;
    for (const trade of weekRows(market, { from: ALL_TIME.from, to: window.to }, exclude)) {
      const judgement = judgements.get(trade.signature);
      if (!judgedOnce.has(trade.signature)) {
        judgedOnce.add(trade.signature);
        for (const span of HALL_SPANS) {
          if (span !== 'all' && !within(trade.at, periods[span])) continue;
          const tally = tallies[span];
          tally.trades += 1;
          if (counted(judgement)) tally.counted += 1;
          if (judgement?.cluster === 'inside') tally.inside += 1;
          else if (!judgement || judgement.cluster === 'unknown') tally.unchecked += 1;
        }
      }
      if (trade.side !== 'buy' || !counted(judgement)) continue;
      const tenths = catchTenths(capNow, trade.marketCapPair);
      if (tenths === null || tenths < MIN_CATCH_TENTHS) continue;
      const coin = coinOf(market.token, row);
      if (!coin) continue;
      catches.push({
        wallet: trade.trader,
        at: trade.at,
        whole: market.trades.complete,
        row: {
          place: 0,
          name: maskWallet(trade.trader),
          coin,
          figure: { kind: 'multiple', tenths, since: 'buy' },
          period: { from: trade.at, to: market.observedAt },
          proof: { kind: 'tx', id: trade.signature, url: explorerUrl(network, 'tx', trade.signature) },
          readAt: market.observedAt,
          labels: trade.traderLabels.filter((label) => label === 'sniper'),
        },
      });
    }
  }

  /* The biggest catches first; a tie goes to the earlier buy, then the plain order of addresses. */
  const tenthsOf = (c: Catch) => (c.row.figure.kind === 'multiple' ? c.row.figure.tenths : 0);
  catches.sort((a, b) => tenthsOf(b) - tenthsOf(a) || byText(a.at, b.at) || byText(a.wallet, b.wallet) || byText(a.row.proof.id, b.row.proof.id));
  /* «All time» is said only of coins whose every trade was read: a page of the latest trades is not all time. */
  const catchesOf = (span: HallSpan) => (span === 'all' ? catches.filter((c) => c.whole) : catches.filter((c) => within(c.at, periods[span])));
  /* What all time could not count — trades not yet checked, coins not read whole: an empty board then is not «nobody». */
  const leftCatchAll = { cluster: 0, unchecked: tallies.all.unchecked, unread: reads.filter((read) => read.market && !read.market.trades.complete).length, no_dollar: 0 };
  const huntersOf = (list: readonly Catch[]) => {
    const hunters: HallRow[] = [];
    const hunted = new Set<string>();
    for (const c of list) {
      if (hunted.has(c.wallet)) continue;
      hunted.add(c.wallet);
      hunters.push(c.row);
    }
    return hunters;
  };
  const catchSpans = HALL_SPANS.map((span) => ({ span, period: periods[span], list: catchesOf(span) }));

  /* Creators over the week: one row each, their best coin, and only a week that counts whole. */
  const left = { cluster: 0, unchecked: 0, unread: 0, no_dollar: 0 };
  const best = new Map<string, Creator>();
  /* Creators over all time, read only for a launch whose every trade was read and counted. */
  const leftAll = { cluster: 0, unchecked: 0, unread: 0, no_dollar: 0 };
  const bestAll = new Map<string, Creator>();
  for (const { row, market, stats, weekFee, allFee } of reads) {
    if (!market || exclude.has(market.creator.address)) continue;
    const coin = coinOf(market.token, row);
    const account = stats ? (stats.links.pool ?? stats.links.curve) : null;

    /* The whole history: every trade of the token read, each judged between two people. */
    if (!stats || !allFee || !account) leftAll.unread += 1;
    else {
      const judged = weekRows(market, ALL_TIME, exclude).map((trade) => judgements.get(trade.signature));
      if (judged.some((judgement) => judgement?.cluster === 'inside')) leftAll.cluster += 1;
      else if (judged.some((judgement) => !judgement || judgement.cluster === 'unknown')) leftAll.unchecked += 1;
      else if (!market.trades.complete) leftAll.unread += 1;
      else if (!market.pair.dollar || !stats.pair.dollar) leftAll.no_dollar += 1;
      else {
        const micros = rawToMicros(allFee.raw, stats.pair.decimals);
        if (micros > 0n && coin) {
          keepBest(bestAll, stats.creator, {
            micros,
            at: row.launchedAt,
            row: {
              place: 0,
              name: maskWallet(stats.creator),
              coin,
              figure: { kind: 'fee', of: 'creator', raw: allFee.raw, atLeast: false, pair: { symbol: stats.pair.symbol, decimals: stats.pair.decimals, dollar: stats.pair.dollar } },
              period: { from: row.launchedAt, to: allFee.at },
              proof: { kind: 'account', id: account, url: explorerUrl(network, 'account', account) },
              readAt: allFee.at,
              labels: [],
            },
          });
        }
      }
    }

    /* The engine's week. */
    if (!stats || !weekFee) {
      left.unread += 1;
      continue;
    }
    readTimes.push(stats.observedAt);
    const week = statsWeek(stats);
    const trades = weekRows(market, week, exclude);
    const judged = trades.map((trade) => judgements.get(trade.signature));
    if (judged.some((judgement) => judgement?.cluster === 'inside')) {
      left.cluster += 1;
      continue;
    }
    if (judged.some((judgement) => !judgement || judgement.cluster === 'unknown')) {
      left.unchecked += 1;
      continue;
    }
    if (!covers(market, week.from) || weekFee.raw === null) {
      left.unread += 1;
      continue;
    }
    if (!stats.pair.dollar) {
      left.no_dollar += 1;
      continue;
    }
    const micros = rawToMicros(weekFee.raw, stats.pair.decimals);
    if (micros <= 0n || !coin || !account) continue;
    keepBest(best, stats.creator, {
      micros,
      at: row.launchedAt,
      row: {
        place: 0,
        name: maskWallet(stats.creator),
        coin,
        figure: { kind: 'fee', of: 'creator', raw: weekFee.raw, atLeast: weekFee.atLeast, pair: { symbol: stats.pair.symbol, decimals: stats.pair.decimals, dollar: stats.pair.dollar } },
        period: week,
        proof: { kind: 'account', id: account, url: explorerUrl(network, 'account', account) },
        readAt: stats.observedAt,
        labels: [],
      },
    });
  }

  const tally = (span: HallSpan): HallTally => {
    const t = tallies[span];
    const checked = t.trades - t.unchecked;
    return { ...t, insideBps: checked ? Math.floor((t.inside * 10_000) / checked) : null, uncheckedBps: t.trades ? Math.floor((t.unchecked * 10_000) / t.trades) : null };
  };
  const counts = { week: tally('week'), month: tally('month'), all: tally('all') };
  return {
    v: 1,
    network,
    window,
    readAt: readTimes.length ? readTimes.reduce((oldest, at) => (at < oldest ? at : oldest)) : null,
    computedAt: new Date(now).toISOString(),
    markets: { listed: args.listed, read: reads.filter((read) => read.market !== null).length },
    trades: counts.week,
    tallies: counts,
    boards: {
      catch: firstFilled(catchSpans.map(({ span, period, list }) => ({ span, period, rows: list.map((c) => c.row), ...(span === 'all' ? { left: leftCatchAll } : {}) }))),
      hunters: firstFilled(catchSpans.map(({ span, period, list }) => ({ span, period, rows: huntersOf(list), ...(span === 'all' ? { left: leftCatchAll } : {}) }))),
      creators: firstFilled([
        { span: 'week', period: window, rows: rankCreators(best), left },
        { span: 'all', period: periods.all, rows: rankCreators(bestAll), left: leftAll },
      ]),
      scouts: { state: 'no_source', span: 'week', period: window, rows: [], left: EMPTY_LEFT },
    },
    rules: HALL_VERSION,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The switch, and the answer as the browser reads it
 * --------------------------------------------------------------------------------------------- */

/** The deployment's switch for people: the Hall opens only where `NEXT_PUBLIC_RYNTRA_CITY_HALL=open`. */
export function hallOpen(value: string | undefined): boolean {
  return value === 'open';
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is string => isText(value) && Number.isFinite(Date.parse(value));
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const PROOF_URL = /^https:\/\/solscan\.io\/(tx|account)\/[1-9A-HJ-NP-Za-km-z]{32,90}(\?cluster=devnet)?$/;

function readFigure(value: unknown): HallFigure | null {
  if (!isObject(value)) return null;
  if (value.kind === 'multiple' && isCount(value.tenths) && value.since === 'buy') return { kind: 'multiple', tenths: value.tenths, since: 'buy' };
  const pair = value.pair;
  if (value.kind === 'fee' && value.of === 'creator' && isText(value.raw) && /^\d+$/.test(value.raw) && typeof value.atLeast === 'boolean' && isObject(pair) && isText(pair.symbol) && isCount(pair.decimals) && typeof pair.dollar === 'boolean') {
    return { kind: 'fee', of: 'creator', raw: value.raw, atLeast: value.atLeast, pair: { symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar } };
  }
  return null;
}

function readRow(value: unknown): HallRow | null {
  if (!isObject(value) || !isCount(value.place) || !isText(value.name) || !isTime(value.readAt) || !Array.isArray(value.labels)) return null;
  const { coin, period, proof } = value;
  if (!isObject(coin) || !isText(coin.token) || !isText(coin.symbol) || !isText(coin.name)) return null;
  if (!isObject(period) || !isTime(period.from) || !isTime(period.to)) return null;
  if (!isObject(proof) || (proof.kind !== 'tx' && proof.kind !== 'account') || !isText(proof.id) || !isText(proof.url) || !PROOF_URL.test(proof.url)) return null;
  const figure = readFigure(value.figure);
  if (!figure) return null;
  return {
    place: value.place,
    name: value.name,
    coin: { token: coin.token, symbol: coin.symbol, name: coin.name },
    figure,
    period: { from: period.from, to: period.to },
    proof: { kind: proof.kind, id: proof.id, url: proof.url },
    readAt: value.readAt,
    labels: value.labels.filter(isText),
  };
}

const readPeriod = (value: unknown): HallPeriod | null => (isObject(value) && isTime(value.from) && isTime(value.to) ? { from: value.from, to: value.to } : null);
const isSpan = (value: unknown): value is HallSpan => (HALL_SPANS as readonly unknown[]).includes(value);

function readTally(value: unknown): HallTally | null {
  if (!isObject(value) || ![value.trades, value.counted, value.inside, value.unchecked].every(isCount)) return null;
  if (!(value.insideBps === null || isCount(value.insideBps)) || !(value.uncheckedBps === null || isCount(value.uncheckedBps))) return null;
  return {
    trades: value.trades as number,
    counted: value.counted as number,
    inside: value.inside as number,
    unchecked: value.unchecked as number,
    insideBps: value.insideBps as number | null,
    uncheckedBps: value.uncheckedBps as number | null,
  };
}

/**
 * The Hall as the browser reads it from `/api/city/hall`: every row whole — a type, a period, a proof on Solscan and a
 * read time — or the answer is not the Hall at all. A row that misses one of them is never drawn. A board without a
 * span is the week's (an answer from before CITY-230); a span the Hall does not know refuses the answer.
 */
export function readHallView(body: unknown): HallView | null {
  if (!isObject(body) || body.v !== 1 || (body.network !== 'solana:devnet' && body.network !== 'solana:mainnet')) return null;
  const { markets, boards } = body;
  const window = readPeriod(body.window);
  if (!window || !isTime(body.computedAt) || !(body.readAt === null || isTime(body.readAt))) return null;
  if (!isObject(markets) || !isCount(markets.listed) || !isCount(markets.read)) return null;
  const trades = readTally(body.trades);
  if (!trades) return null;
  let tallies: Record<HallSpan, HallTally> = { week: trades, month: trades, all: trades };
  if (body.tallies !== undefined) {
    if (!isObject(body.tallies)) return null;
    const given = body.tallies;
    const read = HALL_SPANS.map((span) => readTally(given[span]));
    if (read.some((tally) => tally === null)) return null;
    tallies = { week: read[0]!, month: read[1]!, all: read[2]! };
  }
  if (!isObject(boards)) return null;
  const read: Partial<Record<HallBoardId, HallBoard>> = {};
  for (const id of HALL_BOARDS) {
    const entry = boards[id];
    if (!isObject(entry) || (entry.state !== 'live' && entry.state !== 'empty' && entry.state !== 'no_source') || !Array.isArray(entry.rows) || !isObject(entry.left)) return null;
    if (entry.span !== undefined && !isSpan(entry.span)) return null;
    const span: HallSpan = entry.span === undefined ? 'week' : entry.span;
    const period = entry.period === undefined ? window : readPeriod(entry.period);
    if (!period) return null;
    const rows = entry.rows.map(readRow);
    if (rows.some((row) => row === null)) return null;
    const given = entry.left;
    const left = Object.fromEntries(LEFT_REASONS.map((reason) => [reason, isCount(given[reason]) ? given[reason] : 0])) as Record<LeftReason, number>;
    /* No source draws no rows; otherwise the rows decide whether the board is live. */
    read[id] = entry.state === 'no_source' ? { state: 'no_source', span, period, rows: [], left } : { state: rows.length ? 'live' : 'empty', span, period, rows: rows as HallRow[], left };
  }
  return {
    v: 1,
    network: body.network,
    window,
    readAt: body.readAt as string | null,
    computedAt: body.computedAt as string,
    markets: { listed: markets.listed, read: markets.read },
    trades,
    tallies,
    boards: read as Record<HallBoardId, HallBoard>,
    rules: isText(body.rules) ? body.rules : HALL_VERSION,
  };
}
