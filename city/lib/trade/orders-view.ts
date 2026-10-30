import { typedPrice } from '../../../lib/solana/limits/model.ts';
import { SOLANA_MAINNET_USDC_MINT, WRAPPED_SOL_MINT } from '../../../lib/solana/send-kinds.ts';
import { dateText, wordsNow } from '../i18n/dict.ts';
import { formatUnits, ticker } from './format.ts';
import type { LimitOrderView, LimitToken } from './limits.ts';
import { stopView, type Stop, type StopView } from './stops.ts';
import { unitOf } from './tiles.ts';
import { ORDERS } from './words.ts';

/**
 * «My orders» as the panel writes them: the engine's limit orders of the wallet — open first, then the latest closed
 * ones — and the stops kept on this device. Every figure is the engine's: the amounts its records hold, the price it
 * reviewed (or, for an order found only at the venue, the ratio of its two amounts), the symbols and decimals its
 * orders read names.
 */

const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
/** The quote assets' names and scale, known without a read: a busy catalogue never leaves a SOL or a dollar order bare. */
const KNOWN: Readonly<Record<string, LimitToken>> = {
  [WRAPPED_SOL_MINT]: { symbol: 'SOL', decimals: 9 },
  [SOLANA_MAINNET_USDC_MINT]: { symbol: 'USDC', decimals: 6 },
  [USDT_MINT]: { symbol: 'USDT', decimals: 6 },
};

/** The orders that can still fill — what «Cancel» is about. */
export const OPEN_ORDER_STATES: ReadonlySet<string> = new Set(['PLACING', 'OPEN', 'PARTIAL', 'CANCELLING']);

const STATES = ['PLACING', 'OPEN', 'PARTIAL', 'FILLED', 'CANCELLING', 'CANCELLED', 'EXPIRED', 'FAILED'] as const;

/** An order's state in words, or the engine's own code for a state the panel does not know. */
function stateWords(state: string): string {
  return (STATES as readonly string[]).includes(state) ? wordsNow(ORDERS)[state as (typeof STATES)[number]] : state;
}

export type Tone = 'live' | 'done' | 'quiet' | 'danger';

export type OrderRow = Readonly<{
  key: string;
  side: 'buy' | 'sell';
  /** The coin bought or sold, as its ticker; its address cut short when the engine could not name it. */
  coin: string;
  /** What the price is counted in. */
  unit: string;
  /** How much of the coin the order buys or sells, short. */
  amount: string | null;
  /** Quote per base the order fills at. */
  price: string | null;
  state: string;
  tone: Tone;
  /** How much of what the order put in has filled, per cent, while it is part filled. */
  filledPct: number | null;
  open: boolean;
  canCancel: boolean;
  /** A converted DLMM order waits to be taken back: its cancellation also claims. */
  canClaim: boolean;
}>;

function tokenOf(tokens: Readonly<Record<string, LimitToken>>, mint: string): LimitToken {
  const read = tokens[mint];
  const known = KNOWN[mint];
  return { symbol: known?.symbol ?? read?.symbol ?? null, decimals: read?.decimals ?? known?.decimals ?? null };
}

const short = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/** One of the engine's orders as the panel's row. */
export function orderRow(order: LimitOrderView, tokens: Readonly<Record<string, LimitToken>>): OrderRow {
  const base = tokenOf(tokens, order.baseMint);
  const quote = tokenOf(tokens, order.quoteMint);
  const baseRaw = order.side === 'buy' ? order.takingRaw : order.makingRaw;
  const amount = base.decimals !== null && /^\d+$/.test(baseRaw) ? formatUnits(baseRaw, base.decimals, 'down') : null;
  let price: number | null = order.fillPrice !== null && Number.isFinite(order.fillPrice) && order.fillPrice > 0 ? order.fillPrice : null;
  if (price === null && base.decimals !== null && quote.decimals !== null && order.takingRaw !== '0') {
    const making = Number(order.makingRaw);
    const taking = Number(order.takingRaw);
    const ratio = order.side === 'buy' ? making / 10 ** quote.decimals / (taking / 10 ** base.decimals) : taking / 10 ** quote.decimals / (making / 10 ** base.decimals);
    price = Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  }
  const making = /^\d+$/.test(order.makingRaw) ? BigInt(order.makingRaw) : 0n;
  const filled = /^\d+$/.test(order.filledInputRaw) ? BigInt(order.filledInputRaw) : 0n;
  const filledPct = order.state === 'PARTIAL' && making > 0n ? Number((filled * 1000n) / making) / 10 : null;
  const open = OPEN_ORDER_STATES.has(order.state);
  return {
    key: order.key,
    side: order.side,
    coin: base.symbol ? ticker(base.symbol) : short(order.baseMint),
    unit: quote.symbol ? unitOf({ mint: order.quoteMint, symbol: quote.symbol }) : short(order.quoteMint),
    amount,
    price: price === null ? null : typedPrice(price),
    state: stateWords(order.state),
    tone: order.state === 'FAILED' ? 'danger' : order.state === 'FILLED' ? 'done' : open ? 'live' : 'quiet',
    filledPct,
    open,
    canCancel: order.canCancel && order.state !== 'CANCELLING' && order.state !== 'PLACING',
    canClaim: order.canClaim,
  };
}

/** Open orders first, as the engine listed them; then the latest closed ones, newest first, at most `closedLimit`. */
export function sortOrders(list: readonly LimitOrderView[], closedLimit = 6): Readonly<{ open: readonly LimitOrderView[]; closed: readonly LimitOrderView[] }> {
  const open = list.filter((order) => OPEN_ORDER_STATES.has(order.state) || order.canClaim);
  const closed = list
    .filter((order) => !OPEN_ORDER_STATES.has(order.state) && !order.canClaim)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, closedLimit);
  return { open, closed };
}

export type StopRow = Readonly<{
  id: string;
  side: 'buy' | 'sell';
  coin: string;
  unit: string;
  /** What the stop spends when reached, short, with its unit. */
  spends: string;
  price: string;
  view: StopView;
  state: string;
  tone: Tone;
  /** «until 4 Nov», or «until cancelled». */
  until: string;
}>;

/** A stop of this device as the panel's row. */
export function stopRow(stop: Stop, now: number): StopRow {
  const view = stopView(stop, now);
  const w = wordsNow(ORDERS);
  const unit = unitOf(stop.quote);
  const coin = ticker(stop.base.symbol);
  const spentDecimals = stop.side === 'buy' ? stop.quote.decimals : stop.base.decimals;
  return {
    id: stop.id,
    side: stop.side,
    coin,
    unit,
    spends: `${formatUnits(stop.amountRaw, spentDecimals)} ${stop.side === 'buy' ? unit : coin}`,
    price: stop.price,
    view,
    state: w[view],
    tone: view === 'reached' ? 'live' : view === 'watching' ? 'live' : view === 'done' ? 'done' : 'quiet',
    until: stop.expiresAt === null ? w.untilCancelled : w.until(dateText(stop.expiresAt, { day: 'numeric', month: 'short' })),
  };
}
