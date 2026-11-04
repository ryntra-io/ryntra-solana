import type { LaunchCabinetRow, LaunchMarketResponse } from '../../../lib/api/v1/contract.ts';
import type { Network } from './engine.ts';

/**
 * The launch's share cards (L8 · CITY-145, `docs/research/ryntra-launch-2026-10-29/SPEC.md` §9): «Народилась» and
 * «Вийшла» for the creator, and the trader's round trip — «купив на народженні — продав на виході». Every figure on a
 * card is the engine's: the cabinet's launch time and curve, the chart's mark of the move to the DEX, the feed's
 * holders, the market's own trades and the wallet's balance as the chain reads them. Nothing is estimated, rounded up
 * or made up; a figure that was not read is left off the card, and a round trip that cannot be counted whole is no
 * card at all. Pure, so the tests read it; the drawing is `card-draw.ts`.
 */

/** The coin on a card: its ticker, and whether the engine serves its picture (`/api/icon/<mint>`). */
export type CoinFace = Readonly<{ token: string; symbol: string; logo: boolean }>;

/** A card made on devnet or on the stand says so on its face: test money is never shared as real money. */
export type CardTag = 'devnet' | 'stub' | null;

export function cardTag(network: Network | null, stub: boolean): CardTag {
  if (stub) return 'stub';
  return network === 'solana:devnet' ? 'devnet' : null;
}

/* ---------------------------------------------------------------- the creator's two cards */

export type CreatorCard = Readonly<{
  kind: 'born' | 'graduated';
  coin: CoinFace;
  /** When it happened, ms: the launch for «Born», the move to the DEX for «Graduated». */
  at: number;
  /** People holding it, as the city's feed last read them; null when not read. */
  holders: Readonly<{ count: number; atLeast: boolean }> | null;
  /** «Born» while still on its curve: the way to the DEX, whole per cent rounded down; null otherwise. */
  progressPct: number | null;
  /** «Graduated»: how long from the launch to the move, ms; null when the two marks disagree. */
  flewMs: number | null;
  tag: CardTag;
}>;

type CreatorRow = Pick<LaunchCabinetRow, 'token' | 'symbol' | 'image' | 'launchedAt' | 'migrated' | 'progressBps'>;

export type CreatorFacts = Readonly<{
  /** The move to the DEX as the market's chart marks it (`graduationOf`); null before it, or not read. */
  graduation: Readonly<{ at: number }> | null;
  holders: Readonly<{ count: number; atLeast: boolean }> | null;
  tag: CardTag;
}>;

/**
 * A creator's card, or null when its moment has not come: «Born» from the launch's own time, «Graduated» only once the
 * coin moved to the DEX and the chain's mark of the move was read.
 */
export function creatorCard(kind: CreatorCard['kind'], row: CreatorRow, facts: CreatorFacts): CreatorCard | null {
  const born = Date.parse(row.launchedAt);
  if (!Number.isFinite(born)) return null;
  const coin: CoinFace = { token: row.token, symbol: tickerOf(row.symbol), logo: Boolean(row.image) };
  const holders = facts.holders && facts.holders.count > 0 ? facts.holders : null;
  if (kind === 'born') {
    const onCurve = row.migrated !== true && row.progressBps !== null;
    return { kind, coin, at: born, holders, progressPct: onCurve ? Math.floor(row.progressBps! / 100) : null, flewMs: null, tag: facts.tag };
  }
  if (row.migrated !== true || !facts.graduation) return null;
  const flew = facts.graduation.at - born;
  return { kind, coin, at: facts.graduation.at, holders, progressPct: null, flewMs: flew >= 0 ? flew : null, tag: facts.tag };
}

/* ---------------------------------------------------------------- the trader's round trip */

/** A buy within this long of the launch, on the curve, was bought «at birth». */
export const BIRTH_MS = 15 * 60_000;

/**
 * One trade of the wallet: the market's own row (`clock: 'chain'`, the chain's time), or the city's own fill from the
 * engine's answer (`clock: 'device'`, this device's time when the answer came).
 */
export type Leg = Readonly<{ signature: string; at: number; side: 'buy' | 'sell'; venue: 'curve' | 'pool'; tokensRaw: string; pairRaw: string; clock: 'chain' | 'device' }>;

/** Where the round trip was bought: in the coin's first minutes, later on its curve, in its pool after the move, or both. */
export type BoughtAt = 'birth' | 'curve' | 'pool' | 'mixed';
/** Where it was sold: on the curve, at the exit (in the pool, bought before the move), or in the pool throughout. */
export type SoldAt = 'curve' | 'exit' | 'dex';

export type RoundTrip = Readonly<{
  kind: 'pnl';
  coin: CoinFace;
  pair: Readonly<{ symbol: string; decimals: number; dollar: boolean }>;
  /** What the sold tokens cost, first bought first sold, fee included — rounded up, so the gain never reads better. */
  paidRaw: string;
  /** What the sales brought, fee taken. */
  receivedRaw: string;
  /** received − paid; negative for a loss. */
  gainRaw: string;
  up: boolean;
  /** received ÷ paid. */
  multiple: number;
  bought: BoughtAt;
  sold: SoldAt;
  tag: CardTag;
}>;

export type RoundTripInput = Readonly<{
  market: Pick<LaunchMarketResponse, 'token' | 'pair' | 'trades'>;
  symbol: string;
  logo: boolean;
  wallet: string;
  /** The launch's time, ms; null when not known (no buy is then said to be «at birth»). */
  launchedAt: number | null;
  /** What the wallet holds of the coin now, as the engine read it; null when not read. */
  heldRaw: string | null;
  /** The wallet's own trades the market's newest rows may not carry yet: the fill just now, the city's own earlier fills. */
  extra?: readonly Leg[];
  /** The sale the card is for: without it among the trades (its fill not read yet) there is no card. */
  sale: string;
  tag: CardTag;
}>;

const legKey = (leg: Pick<Leg, 'signature' | 'side'>) => `${leg.signature}:${leg.side}`;

/** Oldest first; in the same moment a buy before a sale, so a quick flip is never read as selling first. */
const byTime = (a: Leg, b: Leg) => a.at - b.at || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1);

/**
 * The wallet's realized round trip on a coin, or null when it cannot be counted whole. The trades are the market's own
 * rows where the wallet's tokens moved (two of one transaction on the same side summed), with the wallet's own fills
 * the rows do not carry yet, one per transaction and side.
 *
 * Whole means every buy behind the sold tokens is known. Either every trade of the coin was read and is in the rows —
 * the sale just made may still be missing from them, nothing else — or the trades found add up to the balance the
 * chain shows now (bought − sold = held): a buy that was not found — an older one past the rows, a buy elsewhere, tokens
 * sent in — breaks the sum, and the card is not made. The sold tokens cost what their buys paid, first bought first
 * sold; a sale of more than the buys found is never counted.
 *
 * «At birth» only when every sold token was bought on the curve within `BIRTH_MS` of the launch by the chain's own clock;
 * «at the exit» only when every sale was in the pool.
 */
export function roundTrip(input: RoundTripInput): RoundTrip | null {
  const { market, wallet } = input;
  const legs = new Map<string, Leg>();
  for (const row of market.trades.rows) {
    if (row.trader !== wallet) continue;
    const at = Date.parse(row.at);
    if (!Number.isFinite(at)) continue;
    const key = legKey(row);
    const known = legs.get(key);
    legs.set(
      key,
      known
        ? { ...known, at: Math.min(known.at, at), tokensRaw: (BigInt(known.tokensRaw) + BigInt(row.tokensRaw)).toString(), pairRaw: (BigInt(known.pairRaw) + BigInt(row.pairRaw)).toString() }
        : { signature: row.signature, at, side: row.side, venue: row.venue, tokensRaw: row.tokensRaw, pairRaw: row.pairRaw, clock: 'chain' },
    );
  }
  /* The market's row wins over the city's own fill of the same trade: its time is the chain's. */
  let unlisted = false;
  for (const leg of input.extra ?? []) {
    const key = legKey(leg);
    if (legs.has(key)) continue;
    legs.set(key, leg);
    if (leg.signature !== input.sale) unlisted = true;
  }
  if (![...legs.values()].some((leg) => leg.signature === input.sale && leg.side === 'sell')) return null;
  const ordered = [...legs.values()].sort(byTime);

  let bought = 0n;
  let sold = 0n;
  for (const leg of ordered) {
    if (leg.side === 'buy') bought += BigInt(leg.tokensRaw);
    else sold += BigInt(leg.tokensRaw);
  }
  if (bought === 0n || sold === 0n) return null;
  /* A fill kept here that the complete rows do not list is not taken on trust: the balance has to close the sum. */
  const everyTrade = market.trades.complete && market.trades.read <= market.trades.rows.length && !unlisted;
  if (!everyTrade && (input.heldRaw === null || bought - sold !== BigInt(input.heldRaw))) return null;

  /* First bought, first sold: each sale takes its tokens from the oldest buy still holding some, at that buy's price. */
  const bornAt = input.launchedAt;
  const atBirth = (leg: Leg) => leg.venue === 'curve' && leg.clock === 'chain' && bornAt !== null && leg.at - bornAt <= BIRTH_MS;
  const lots: { tokens: bigint; pair: bigint; leg: Leg }[] = [];
  let paid = 0n;
  let received = 0n;
  let allBirth = true;
  let allPoolBuys = true;
  let allCurveBuys = true;
  let anyCurveSale = false;
  let sales = 0;
  for (const leg of ordered) {
    const tokens = BigInt(leg.tokensRaw);
    if (leg.side === 'buy') {
      if (tokens > 0n) lots.push({ tokens, pair: BigInt(leg.pairRaw), leg });
      continue;
    }
    let need = tokens;
    while (need > 0n) {
      const lot = lots[0];
      if (!lot) return null;
      allBirth &&= atBirth(lot.leg);
      allPoolBuys &&= lot.leg.venue === 'pool';
      allCurveBuys &&= lot.leg.venue === 'curve';
      const take = need < lot.tokens ? need : lot.tokens;
      /* The share of the lot's price these tokens carry, rounded up: the cost never reads lower than it was. */
      const cost = take === lot.tokens ? lot.pair : ceilDiv(lot.pair * take, lot.tokens);
      paid += cost;
      lot.pair -= cost;
      lot.tokens -= take;
      need -= take;
      if (lot.tokens === 0n) lots.shift();
    }
    received += BigInt(leg.pairRaw);
    anyCurveSale ||= leg.venue === 'curve';
    sales += 1;
  }
  if (!sales || paid <= 0n) return null;

  const boughtAt: BoughtAt = allBirth ? 'birth' : allPoolBuys ? 'pool' : allCurveBuys ? 'curve' : 'mixed';
  const soldAt: SoldAt = anyCurveSale ? 'curve' : allPoolBuys ? 'dex' : 'exit';
  const gain = received - paid;
  return {
    kind: 'pnl',
    coin: { token: market.token, symbol: tickerOf(input.symbol), logo: input.logo },
    pair: { symbol: market.pair.symbol, decimals: market.pair.decimals, dollar: market.pair.dollar },
    paidRaw: paid.toString(),
    receivedRaw: received.toString(),
    gainRaw: gain.toString(),
    up: gain > 0n,
    multiple: ratio(received, paid),
    bought: boughtAt,
    sold: soldAt,
    tag: input.tag,
  };
}

/** The city's own fill of a trade as a leg of the round trip: the engine's `filled`, timed by this device when it answered. */
export function legOf(done: Readonly<{ signature: string; side: 'buy' | 'sell'; venue: 'curve' | 'pool'; filled: Readonly<{ tokensRaw: string; pairRaw: string }> | null }>, at: number): Leg | null {
  if (!done.filled || BigInt(done.filled.tokensRaw) <= 0n) return null;
  return { signature: done.signature, at, side: done.side, venue: done.venue, tokensRaw: done.filled.tokensRaw, pairRaw: done.filled.pairRaw, clock: 'device' };
}

/* ---------------------------------------------------------------- shared */

/**
 * The agent's card (CITY-175): what the person's agent bought for her, from its own trades in the agent's book — what
 * it spent, and what the coins it bought are worth at the pool's price now. Every figure is the engine's; a card is made
 * only once the agent traded and the worth was read.
 */
export type AgentCard = Readonly<{
  kind: 'agent';
  coin: CoinFace;
  pair: Readonly<{ symbol: string; decimals: number; dollar: boolean }>;
  trades: number;
  spentRaw: string;
  worthRaw: string;
  /** worth − spent; negative for a loss. */
  gainRaw: string;
  up: boolean;
  /** worth ÷ spent. */
  multiple: number;
  tag: CardTag;
  /** CITY-194: the card over a span — today, or while the person was away; absent, all the agent did. */
  span?: AgentSpan;
}>;

export type AgentSpan = 'today' | 'away';

/** The agent's card from its result, or null when there is nothing whole to show yet. */
export function agentCard(input: Readonly<{ coin: CoinFace; trades: number; spentRaw: string; worthRaw: string | null; tag: CardTag; span?: AgentSpan }>): AgentCard | null {
  if (input.worthRaw === null || input.trades === 0) return null;
  const spent = BigInt(input.spentRaw);
  const worth = BigInt(input.worthRaw);
  if (spent <= 0n) return null;
  const gain = worth - spent;
  return {
    kind: 'agent',
    coin: input.coin,
    pair: { symbol: 'SOL', decimals: 9, dollar: false },
    trades: input.trades,
    spentRaw: spent.toString(),
    worthRaw: worth.toString(),
    gainRaw: gain.toString(),
    up: gain > 0n,
    multiple: Number((worth * 1_000_000n) / spent) / 1_000_000,
    tag: input.tag,
    ...(input.span ? { span: input.span } : {}),
  };
}

export type ShareCard = CreatorCard | RoundTrip | AgentCard;

/** The ticker as the cards write it: no leading «$», capitals. */
export function tickerOf(symbol: string): string {
  return symbol.replace(/^\$/, '').toUpperCase();
}

/** The card's file name: ryntra-moth-graduated.png. */
export function cardFile(card: ShareCard): string {
  const name = card.coin.symbol.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'coin';
  return `ryntra-${name}-${card.kind === 'pnl' ? 'x' : card.kind}.png`;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/** a ÷ b of two raw amounts of the same currency, as a number, to six places. */
function ratio(a: bigint, b: bigint): number {
  return Number((a * 1_000_000n) / b) / 1_000_000;
}
