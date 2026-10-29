import { usd } from './markets.ts';
import { REFUSAL, type Refusal } from './practice.ts';
import { realBuyRefusal, REAL_REFUSAL, type Live, type OrderState, type Review } from './real.ts';
import type { TradePhase } from './real-store.ts';

/**
 * What the ticket's one orange button says and does, and the one line under it — for every state the ticket can be
 * in, in Practice and with real money. Pure, so every state is tested (`ticket.test.mjs`); the ticket draws it.
 *
 * Real money in order: a wallet, the wallet's proof, the account opened, USDC in it, then the engine's Review — the
 * fee and what it pays in one line, before anything is signed — and the order the person confirms on it.
 */

export type Act = 'none' | 'connect' | 'start' | 'deposit' | 'quote' | 'place' | 'buy' | 'sell';

export type TicketView = Readonly<{
  label: string;
  act: Act;
  disabled: boolean;
  waiting: boolean;
  /** The line under the action: the fee before a signature, or why the action waits. */
  note: string | null;
  warn: boolean;
}>;

const view = (label: string, act: Act, more: Partial<Omit<TicketView, 'label' | 'act'>> = {}): TicketView => ({ label, act, disabled: false, waiting: false, note: null, warn: false, ...more });

export type PracticeInput = Readonly<{
  action: 'buy' | 'sell';
  sideLabel: string | null;
  refusal: Refusal | null;
  /** On Sell: what the holding returns at the fresh price; null with nothing held or no price. */
  sellBack: number | null;
  held: boolean;
}>;

/** Practice: taken at the page's price with one tap, no fee. */
export function practiceView(input: PracticeInput): TicketView {
  if (input.action === 'sell') {
    if (!input.held || !input.sideLabel) return view('Nothing to sell', 'none', { disabled: true });
    return view(`Sell ${input.sideLabel}`, 'sell', { disabled: input.sellBack === null, note: 'Practice · no fee' });
  }
  if (!input.sideLabel) return view('Pick a side', 'none', { disabled: true });
  const refused = input.refusal && input.refusal !== 'side' ? input.refusal : null;
  return view(`Buy ${input.sideLabel}`, 'buy', { disabled: input.refusal !== null, note: refused ? REFUSAL[refused] : 'Practice · no fee', warn: Boolean(refused) });
}

export type RealInput = Readonly<{
  action: 'buy' | 'sell';
  sideLabel: string | null;
  amount: number;
  tradable: boolean;
  connected: boolean;
  connecting: boolean;
  walletName: string | null;
  opening: boolean;
  liveRead: 'none' | 'reading' | 'ready' | 'failed';
  live: Live | null;
  openError: string | null;
  /** The trade phase of this very ticket (the same market, side, action and amount); null for another's. */
  trade: TradePhase | null;
  /** Whether a position can be sold here: held on one venue. */
  sellable: boolean;
  /** Held, but across venues: shown, not sold as one order yet. */
  spread: boolean;
  now: number;
}>;

/** Why the engine's Review will not place, in a few words. */
export function blockedWords(blockedBy: readonly string[]): string {
  if (blockedBy.includes('balance')) return 'Not enough USDC for this order.';
  if (blockedBy.includes('amount')) return 'This amount is outside the limits.';
  if (blockedBy.includes('quote_age')) return 'The price is old. Get a new one.';
  if (blockedBy.includes('live_venues')) return 'Not open for real money here yet.';
  return 'This order cannot go through right now.';
}

/** The Review in one line, before the signature: the fee, what it pays, what it can lose. */
export function reviewLine(r: Review): string {
  if (r.side === 'sell') return `Fee ${usd(r.feesUsd)} · ${r.shares.toLocaleString('en-US', { maximumFractionDigits: 2 })} shares`;
  return `Fee ${usd(r.feesUsd)} · wins ${usd(r.toWinUsd)} · max loss ${usd(r.maxLossUsd)}`;
}

export function realView(i: RealInput): TicketView {
  if (!i.connected) return view(i.connecting ? 'Connecting…' : 'Connect wallet', 'connect', { waiting: i.connecting });
  if (i.opening) return view(`Confirm in ${i.walletName ?? 'your wallet'}`, 'none', { disabled: true, waiting: true });
  if (i.liveRead === 'reading' && !i.live) return view('Reading your account…', 'none', { disabled: true, waiting: true });
  if (!i.live) return view('Sign in to trade', 'start', { note: i.openError, warn: Boolean(i.openError) });
  if (i.live.access.state !== 'open') return view(i.live.access.state === 'off' ? 'Real money opens soon' : 'Not available right now', 'none', { disabled: true });
  if (!i.live.linked) return view('Open your account', 'start', { note: i.openError, warn: Boolean(i.openError) });
  if (i.action === 'buy' && (i.live.available ?? 0) < 1) return view('Deposit USDC', 'deposit');
  const t = i.trade;
  if (t?.step === 'quoting') return view('Getting the price…', 'none', { disabled: true, waiting: true });
  if (t?.step === 'placing') return view('Placing…', 'none', { disabled: true, waiting: true, note: reviewLine(t.review) });
  if (t?.step === 'review') {
    const r = t.review;
    if (Date.parse(r.expiresAt) <= i.now) return view('Get a new price', 'quote', { note: 'The price moved.' });
    if (!r.canPlace) return view(r.side === 'buy' ? `Confirm · ${usd(r.totalUsd)}` : `Confirm · get ${usd(r.totalUsd)}`, 'none', { disabled: true, note: blockedWords(r.blockedBy), warn: true });
    return view(r.side === 'buy' ? `Confirm · ${usd(r.totalUsd)}` : `Confirm · get ${usd(r.totalUsd)}`, 'place', { note: reviewLine(r) });
  }
  const failed = t?.step === 'failed' ? t.text : null;
  if (i.action === 'buy') {
    const why = realBuyRefusal({ spendUsd: i.amount, access: i.live.access, available: i.live.available, tradable: i.tradable });
    if (!i.sideLabel) return view('Pick a side', 'none', { disabled: true });
    return view(`Buy ${i.sideLabel}`, 'quote', { disabled: why !== null, note: why ? REAL_REFUSAL[why] : failed, warn: Boolean(why) || Boolean(failed) });
  }
  if (!i.sellable) return view(i.spread ? 'Not sellable here yet' : 'Nothing to sell', 'none', { disabled: true });
  return view(`Sell ${i.sideLabel ?? ''}`.trim(), 'quote', { disabled: !i.tradable, note: failed, warn: Boolean(failed) });
}

/** What an order came to, in one line. */
export function doneNotice(state: OrderState, review: Review): Readonly<{ tone: 'ok' | 'warn'; text: string }> {
  const verb = review.side === 'buy' ? 'Bought' : 'Sold';
  if (state === 'filled') return { tone: 'ok', text: `${verb} ${review.label} · ${usd(review.totalUsd)}` };
  if (state === 'partially_filled') return { tone: 'ok', text: 'Partly filled. See your positions.' };
  if (state === 'submitted') return { tone: 'ok', text: 'Order sent. It shows in your positions.' };
  return { tone: 'warn', text: 'The order did not fill. Nothing was spent.' };
}
