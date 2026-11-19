import { create } from 'zustand';
import type { DepositNetwork } from '../../lib/relay/deposit-address.ts';
import { useMoney } from '../../city/lib/money/open.ts';
import { BUSY, useTrade, type CoinRef, type Phase } from '../../city/lib/trade/store.ts';
import { SOL, type Side } from '../../city/lib/trade/tiles.ts';

/**
 * The Swap and Bridge screens' own state — what they show, never what they trade: the coin the ticket stands on and its
 * side, the bridge's direction and the network on its other end, whether the money panel shows the bridge or a transfer
 * (the Portfolio's panels read it), and a sentence's fill waiting for the ticket. The trade itself is the trade card's
 * store (`city/lib/trade/store.ts`), the bridge and the transfer the money store (`city/lib/money/store.ts`).
 *
 * A store, not a component's state, because the agent's line writes into it from outside the screen (`./doors.ts`).
 */

/** The bridge's direction: into Solana from another network, or out of Solana to it. */
export type Way = 'in' | 'out';

/** What the money panel shows: the bridge, or a transfer to a Solana address. */
export type MoneyView = 'bridge' | 'send';

export { BRIDGE_PATH } from './leave.ts';

/**
 * The trade card under a signature — a swap's in the wallet, being sent or read back (`BUSY`), or a sent swap whose
 * outcome is still unread (`unknown`, with its «Check again»). An order the card builds by itself, or a result already
 * said, never holds it.
 */
export function tradeBusy(): boolean {
  return cardBusy(useTrade.getState());
}

/** The same rule for a card read in a screen's own selector. */
export function cardBusy(card: Readonly<{ held: boolean; phase: Phase }>): boolean {
  return card.held || BUSY.has(card.phase) || card.phase === 'unknown';
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
  fill: Fill | null;
};

export const useSwapScreen = create<SwapScreen>(() => ({ subject: SOL_REF, side: 'buy', way: 'in', network: 'ethereum', money: 'bridge', fill: null }));

let fills = 0;

/** A sentence's coin and side for the ticket: the screen opens the card on them and the fill waits for it. */
export function sayTrade(subject: CoinRef, side: Side, now: number): void {
  fills += 1;
  useSwapScreen.setState({ subject, side, fill: { id: fills, side, pay: null, amount: null, share: null, at: now } });
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
 * The money panel on the bridge in this direction, or on a transfer. While money is mid-way — the wallet is open, a
 * transfer is being sent — the panel stays on it (the money store's own `busy`): the person sees how it ends.
 */
export function showMoney(money: MoneyView, way?: Way): void {
  if (useMoney.getState().busy) return;
  useSwapScreen.setState(way ? { money, way } : { money });
}

/** The Portfolio's own panels turn the money panel the same way. */
export const turnMoney = showMoney;

/** A transfer let go: the money panel turns back to the bridge, as its closing always did (the Portfolio listens for it). */
export function showSwap(): void {
  if (useMoney.getState().busy) return;
  useSwapScreen.setState({ money: 'bridge' });
}
