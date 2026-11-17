import { create } from 'zustand';
import type { DepositNetwork } from '../../lib/relay/deposit-address.ts';
import { useMoney } from '../../city/lib/money/open.ts';
import { BUSY, useTrade, type CoinRef, type Phase } from '../../city/lib/trade/store.ts';
import { SOL, type Side } from '../../city/lib/trade/tiles.ts';

/**
 * The Swap screen's own state — what it shows, never what it trades: the coin the ticket stands on and its side, the
 * bridge's direction and the network on its other end, whether the money panel shows the bridge or a transfer, and a
 * sentence's fill waiting for the ticket. The trade itself is the trade card's store (`city/lib/trade/store.ts`), the
 * bridge and the transfer the money store (`city/lib/money/store.ts`).
 *
 * A store, not a component's state, because the agent's line writes into it from outside the screen (`./doors.ts`).
 */

/** The bridge's direction: into Solana from another network, or out of Solana to it. */
export type Way = 'in' | 'out';

/** What the money panel shows: the bridge, or a transfer to a Solana address. */
export type MoneyView = 'bridge' | 'send';

/**
 * The screen's tab on its one card: the swap at the market price, a limit on the same card, or the money panel
 * on the bridge or a transfer. Every tab turns in place; none leads to another screen.
 */
export type Tab = 'swap' | 'limit' | MoneyView;

/** The tabs in the order the card draws them; an address's `?tab=` names one of them. */
export const TABS: readonly Tab[] = ['swap', 'limit', 'bridge', 'send'];

/**
 * The trade card under a signature — a swap's in the wallet, being sent or read back (`BUSY`), a sent swap whose outcome
 * is still unread (`unknown`, with its «Check again»), or a limit's (`held`). An order the card builds by itself, or a
 * result already said, never holds the tabs: the card lets them go (`close`).
 */
export function tradeBusy(): boolean {
  return cardBusy(useTrade.getState());
}

/** The same rule for a card read in a screen's own selector. */
export function cardBusy(card: Readonly<{ held: boolean; phase: Phase }>): boolean {
  return card.held || BUSY.has(card.phase) || card.phase === 'unknown';
}

/**
 * A limit on its way keeps the card on the Limit tab: the swap and the limit share one trade card, and the limit's
 * fields are the only place its signature and its result are said. A sentence or a tab turns nothing away from it.
 */
function limitBusy(): boolean {
  return useSwapScreen.getState().tab === 'limit' && tradeBusy();
}

/** A tab named in an address, or null when it names none. */
export function tabOf(value: string | null | undefined): Tab | null {
  return TABS.find((tab) => tab === value) ?? null;
}

/**
 * The tab an address turns the card to on arrival: the one it names, when the card does not already stand on it — so a
 * return to the screen («Back») keeps the card as the person left it, its coin and its fields.
 */
export function arrivalOf(value: string | null | undefined, current: Tab): Tab | null {
  const named = tabOf(value);
  return named && named !== current ? named : null;
}

/**
 * What a sentence said for the ticket — its side, what pays or is paid, the amount or a share — written once the ticket
 * stands on the sentence's coin. A fill older than a minute is let go unwritten.
 */
export type Fill = Readonly<{ id: number; side: Side; pay: 'SOL' | 'USDC' | null; amount: string | null; share: number | null; at: number }>;

export const FILL_LIFE_MS = 60_000;

/** The coin the screen opens on: SOL, paid for in USDC by the card's own rule. */
export const SOL_REF: CoinRef = { id: SOL.mint, symbol: 'SOL', name: 'Solana', icon: `/api/icon/${SOL.mint}` };

type SwapScreen = {
  subject: CoinRef;
  side: Side;
  way: Way;
  network: DepositNetwork;
  money: MoneyView;
  tab: Tab;
  /** The coin the Limit tab stands on: the swap's coin that is not a dollar, taken when the tab is turned to. */
  limit: CoinRef;
  /** The limit's side as the swap left it: a sale stays a sale. */
  limitSide: Side;
  /** What pays on the limit, as the trade card names it (`payKey`): the swap's other coin; null — the card's own choice. */
  limitPay: string | null;
  fill: Fill | null;
};

export const useSwapScreen = create<SwapScreen>(() => ({ subject: SOL_REF, side: 'buy', way: 'in', network: 'ethereum', money: 'bridge', tab: 'swap', limit: SOL_REF, limitSide: 'buy', limitPay: null, fill: null }));

let fills = 0;

/** A sentence's coin and side for the ticket: the screen opens the card on them and the fill waits for it. */
export function sayTrade(subject: CoinRef, side: Side, now: number): void {
  fills += 1;
  // Money mid-way keeps its panel in front; the fill waits for the swap tab all the same.
  const tab = useMoney.getState().busy || limitBusy() ? useSwapScreen.getState().tab : 'swap';
  useSwapScreen.setState({ subject, side, tab, fill: { id: fills, side, pay: null, amount: null, share: null, at: now } });
}

/** More of the same sentence: what pays, the amount or a share — written into the waiting fill. */
export function addFill(patch: Partial<Pick<Fill, 'pay' | 'amount' | 'share'>>): void {
  const fill = useSwapScreen.getState().fill;
  if (fill) useSwapScreen.setState({ fill: { ...fill, ...patch } });
}

/** The person picked a coin themselves: a sentence's fill still waiting is let go. */
export function pickSubject(subject: CoinRef, side: Side): void {
  useSwapScreen.setState({ subject, side, fill: null });
}

/**
 * The money panel on the bridge in this direction, or on a transfer — its tab in front. While money is mid-way — the wallet is open, a
 * transfer is being sent — the panel stays on it (the money store's own `busy`): the person sees how it ends.
 */
export function showMoney(money: MoneyView, way?: Way): void {
  if (useMoney.getState().busy || limitBusy()) return;
  useSwapScreen.setState(way ? { money, way, tab: money } : { money, tab: money });
}

/** The swap's own tab; a transfer or a bridge mid-way keeps its panel, as `showMoney` does. A transfer let go turns the
 * money panel back to the bridge, as its closing always did (the Portfolio listens for it). */
export function showSwap(): void {
  if (useMoney.getState().busy || limitBusy()) return;
  useSwapScreen.setState({ tab: 'swap', money: 'bridge' });
}

/**
 * The Limit tab on this coin. While money is mid-way the panel in front stays, as `showMoney` keeps it; a swap under way
 * keeps its tab too (the trade card refuses another coin until it rests).
 */
export function showLimit(coin: CoinRef, side: Side = 'buy', pay: string | null = null): void {
  if (useMoney.getState().busy || tradeBusy()) return;
  useSwapScreen.setState({ tab: 'limit', limit: coin, limitSide: side, limitPay: pay });
}

/** The money panel turned for another screen (the Portfolio's own panels): the Swap screen's tab stays where it was. */
export function turnMoney(money: MoneyView, way?: Way): void {
  if (useMoney.getState().busy) return;
  useSwapScreen.setState(way ? { money, way } : { money });
}
