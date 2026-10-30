import { digits, wordsNow } from '../../i18n/dict.ts';
import { sideName, usd } from './markets.ts';
import { REFUSAL, type Refusal } from './practice.ts';
import { realBuyRefusal, REAL_REFUSAL, type Live, type OrderState, type Review } from './real.ts';
import type { TradePhase } from './real-store.ts';
import { PREDICT } from './words.ts';

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
  const w = wordsNow(PREDICT);
  if (input.action === 'sell') {
    if (!input.held || !input.sideLabel) return view(w.nothingToSell, 'none', { disabled: true });
    return view(w.sellSide(sideName(input.sideLabel)), 'sell', { disabled: input.sellBack === null, note: w.practiceNoFee });
  }
  if (!input.sideLabel) return view(w.pickSide, 'none', { disabled: true });
  const refused = input.refusal && input.refusal !== 'side' ? input.refusal : null;
  return view(w.buySide(sideName(input.sideLabel)), 'buy', { disabled: input.refusal !== null, note: refused ? REFUSAL[refused] : w.practiceNoFee, warn: Boolean(refused) });
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
  const w = wordsNow(PREDICT);
  if (blockedBy.includes('balance')) return w.blockedBalance;
  if (blockedBy.includes('amount')) return w.blockedAmount;
  if (blockedBy.includes('quote_age')) return w.blockedQuote;
  if (blockedBy.includes('live_venues')) return w.blockedVenues;
  return w.blockedOther;
}

/** The Review in one line, before the signature: the fee, what it pays, what it can lose. */
export function reviewLine(r: Review): string {
  const w = wordsNow(PREDICT);
  if (r.side === 'sell') return w.sellNote(usd(r.feesUsd), digits(r.shares.toLocaleString('en-US', { maximumFractionDigits: 2 })), r.shares);
  return w.buyNote(usd(r.feesUsd), usd(r.toWinUsd), usd(r.maxLossUsd));
}

export function realView(i: RealInput): TicketView {
  const w = wordsNow(PREDICT);
  if (!i.connected) return view(i.connecting ? w.connecting : w.connectWallet, 'connect', { waiting: i.connecting });
  if (i.opening) return view(w.confirmIn(i.walletName ?? w.yourWallet), 'none', { disabled: true, waiting: true });
  if (i.liveRead === 'reading' && !i.live) return view(w.readingAccount, 'none', { disabled: true, waiting: true });
  if (!i.live) return view(w.signIn, 'start', { note: i.openError, warn: Boolean(i.openError) });
  if (i.live.access.state !== 'open') return view(i.live.access.state === 'off' ? w.realSoon : w.notAvailable, 'none', { disabled: true });
  if (!i.live.linked) return view(w.openAccount, 'start', { note: i.openError, warn: Boolean(i.openError) });
  if (i.action === 'buy' && (i.live.available ?? 0) < 1) return view(w.depositUsdc, 'deposit');
  const t = i.trade;
  if (t?.step === 'quoting') return view(w.gettingPrice, 'none', { disabled: true, waiting: true });
  if (t?.step === 'placing') return view(w.placing, 'none', { disabled: true, waiting: true, note: reviewLine(t.review) });
  if (t?.step === 'review') {
    const r = t.review;
    if (Date.parse(r.expiresAt) <= i.now) return view(w.newPrice, 'quote', { note: w.priceMovedShort });
    const label = r.side === 'buy' ? w.confirmBuy(usd(r.totalUsd)) : w.confirmSell(usd(r.totalUsd));
    if (!r.canPlace) return view(label, 'none', { disabled: true, note: blockedWords(r.blockedBy), warn: true });
    return view(label, 'place', { note: reviewLine(r) });
  }
  const failed = t?.step === 'failed' ? t.text : null;
  if (i.action === 'buy') {
    const why = realBuyRefusal({ spendUsd: i.amount, access: i.live.access, available: i.live.available, tradable: i.tradable });
    if (!i.sideLabel) return view(w.pickSide, 'none', { disabled: true });
    return view(w.buySide(sideName(i.sideLabel)), 'quote', { disabled: why !== null, note: why ? REAL_REFUSAL[why] : failed, warn: Boolean(why) || Boolean(failed) });
  }
  if (!i.sellable) return view(i.spread ? w.notSellable : w.nothingToSell, 'none', { disabled: true });
  return view(i.sideLabel ? w.sellSide(sideName(i.sideLabel)) : w.sell, 'quote', { disabled: !i.tradable, note: failed, warn: Boolean(failed) });
}

/** What an order came to, in one line. */
export function doneNotice(state: OrderState, review: Review): Readonly<{ tone: 'ok' | 'warn'; text: string }> {
  const w = wordsNow(PREDICT);
  const said = sideName(review.label);
  if (state === 'filled') return { tone: 'ok', text: review.side === 'buy' ? w.bought(said, usd(review.totalUsd)) : w.sold(said, usd(review.totalUsd)) };
  if (state === 'partially_filled') return { tone: 'ok', text: w.partlyFilled };
  if (state === 'submitted') return { tone: 'ok', text: w.orderSent };
  return { tone: 'warn', text: w.notFilled };
}
