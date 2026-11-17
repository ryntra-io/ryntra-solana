import { create } from 'zustand';
import type { CoinRef } from '../../city/lib/trade/store.ts';
import type { Side } from '../../city/lib/trade/tiles.ts';

/**
 * The Portfolio screen's own state — what it shows, never what it trades: the wallet looked at by its address, and the
 * one panel the screen acts in — the ticket on a coin, the top-up, the transfer, the wallet's own address, the wallet's
 * clean, the exit. The trade itself is the trade card's store (`city/lib/trade/store.ts`); the top-up and the transfer
 * are the money store (`city/lib/money/store.ts`), as the Swap screen shows them; the clean and the exit keep their own
 * (`./clean.ts`, `./exit.ts`).
 */

export type Act =
  | Readonly<{ kind: 'trade'; coin: CoinRef; side: Side }>
  | Readonly<{ kind: 'topUp' }>
  | Readonly<{ kind: 'send' }>
  | Readonly<{ kind: 'receive' }>
  | Readonly<{ kind: 'clean' }>
  /** «Exit everything» or «Collect fees»: which one, and for what, is the exit's own state. */
  | Readonly<{ kind: 'exit' }>;

type PortfolioScreen = {
  /** A wallet looked at by its address, read only; null — the connected one. */
  watch: string | null;
  act: Act | null;
};

export const usePortfolioScreen = create<PortfolioScreen>(() => ({ watch: null, act: null }));

export function setWatch(watch: string | null): void {
  usePortfolioScreen.setState({ watch });
}

export function setAct(act: Act | null): void {
  usePortfolioScreen.setState({ act });
}
