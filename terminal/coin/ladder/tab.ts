import { create } from 'zustand';
import type { LadderAsk } from '../../../city/lib/trade/pro-read.ts';
import { LADDER_BUSY, LADDER_OPEN, askLadder, takeLadderAsk, useLadder } from '../../../city/lib/trade/pro-store.ts';

/**
 * Whether the coin's ticket stands on its Limit tab — the coin's ladders — by a tap, or by a sentence that asked for a
 * ladder. The sentence fills the ladder's fields; the person reads it and signs there.
 */

/** Whether the ticket of `mint` stands on its Limit tab. */
export const useLimitTab = create<Readonly<{ mint: string | null; on: boolean }>>(() => ({ mint: null, on: false }));

export function setLimitTab(mint: string, on: boolean): void {
  useLimitTab.setState({ mint, on });
}

/** How long a sentence's ladder waits at most for the coin's market to be read. */
const ASK_WAIT_MS = 30_000;

/**
 * A ladder a sentence asked for, on the coin's screen: the Limit tab comes forward and its fields are filled — on the
 * market now, or once it is read. The person reads the ladder and signs there.
 */
export function fillLadder(mint: string, ask: LadderAsk): void {
  if (!LADDER_OPEN || ask.coin.mint !== mint || LADDER_BUSY.has(useLadder.getState().phase)) return;
  setLimitTab(mint, true);
  askLadder(ask);
  const now = useLadder.getState();
  if (now.mint !== mint || now.market.status !== 'loading') return;
  // The market is still being read: the ask waits for it, then fills the panel once.
  let stop = () => {};
  const timer = setTimeout(() => stop(), ASK_WAIT_MS);
  const unsubscribe = useLadder.subscribe((state) => {
    if (state.mint !== mint) return stop();
    if (state.market.status === 'loading') return;
    stop();
    const waiting = takeLadderAsk(mint);
    if (waiting && state.market.status === 'ready' && state.market.value) state.open({ mint, symbol: ask.coin.symbol }, waiting);
  });
  stop = () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
