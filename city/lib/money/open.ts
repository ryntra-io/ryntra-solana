import { create } from 'zustand';
import { isMoneyAsk, type MoneyAsk, type MoneyTab } from './flag.ts';

/** Send's two ways: to a Solana address, or to another network through the Bridge's engine. */
export type SendWay = 'solana' | 'network';

/**
 * Whether the Money window is open and on which tab — the one light piece of money in the city, so any window can open
 * it without pulling the flows in: `openMoney('send')` from «Mine», a tower card or a district. The flows themselves
 * load with the window.
 *
 * While money is mid-way — the wallet is open, a transfer is being sent — the window does not close: the person sees
 * how it ends.
 */

type MoneyWindow = {
  open: boolean;
  tab: MoneyTab;
  way: SendWay;
  /** Set by a flow while a signature is out or bytes are on their way. */
  busy: boolean;
  show: (tab?: MoneyAsk) => void;
  setWay: (way: SendWay) => void;
  setTab: (tab: MoneyTab) => void;
  close: () => void;
  setBusy: (busy: boolean) => void;
};

export const useMoney = create<MoneyWindow>((set, get) => ({
  open: false,
  tab: 'portfolio',
  way: 'solana',
  busy: false,
  show: (tab) => {
    if (!tab || !isMoneyAsk(tab)) return set({ open: true });
    // «bridge» is Send's way to another network now (CITY-155).
    if (tab === 'bridge') return set({ open: true, tab: 'send', way: 'network' });
    set({ open: true, tab });
  },
  setWay: (way) => (get().busy ? undefined : set({ way })),
  // Mid-way the tab stays: the flow on screen is the one the person is waiting on.
  setTab: (tab) => (get().busy ? undefined : set({ tab })),
  close: () => (get().busy ? undefined : set({ open: false })),
  setBusy: (busy) => set({ busy }),
}));

/**
 * Open the Money window on a tab: `topup`, `send`, `bridge`, `activity` or `portfolio`. Without one it opens where it
 * was last. While a transfer is mid-way the window stays on that transfer.
 */
export function openMoney(tab?: MoneyAsk): void {
  const money = useMoney.getState();
  if (money.busy) return money.show();
  money.show(tab);
}

export function closeMoney(): void {
  useMoney.getState().close();
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __money: useMoney, __openMoney: openMoney });
