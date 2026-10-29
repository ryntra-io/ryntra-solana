import { create } from 'zustand';
import { isMoneyTab, type MoneyTab } from './flag.ts';

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
  /** Set by a flow while a signature is out or bytes are on their way. */
  busy: boolean;
  show: (tab?: MoneyTab) => void;
  setTab: (tab: MoneyTab) => void;
  close: () => void;
  setBusy: (busy: boolean) => void;
};

export const useMoney = create<MoneyWindow>((set, get) => ({
  open: false,
  tab: 'portfolio',
  busy: false,
  show: (tab) => set({ open: true, tab: tab && isMoneyTab(tab) ? tab : get().tab }),
  // Mid-way the tab stays: the flow on screen is the one the person is waiting on.
  setTab: (tab) => (get().busy ? undefined : set({ tab })),
  close: () => (get().busy ? undefined : set({ open: false })),
  setBusy: (busy) => set({ busy }),
}));

/**
 * Open the Money window on a tab: `topup`, `send`, `bridge`, `activity` or `portfolio`. Without one it opens where it
 * was last. While a transfer is mid-way the window stays on that transfer.
 */
export function openMoney(tab?: MoneyTab): void {
  const money = useMoney.getState();
  if (money.busy) return money.show();
  money.show(tab);
}

export function closeMoney(): void {
  useMoney.getState().close();
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __money: useMoney, __openMoney: openMoney });
