import { create } from 'zustand';
import { isEarnTab, isProduct, type EarnTab, type ProductId } from './flag.ts';

/**
 * Whether the Earn window is open, on which tab, and which product of the Shelf stands open inside it — the one light
 * piece of Earn in the city, so the menu, the Harbor and the Helm's «Earn» verb (CITY-89) open it without pulling its
 * contents in: `openEarn('mine')`. While a signature is out the window stays on that product and does not close.
 */

type EarnWindow = {
  open: boolean;
  tab: EarnTab;
  /** A product of the Shelf opened full in the window; null — the Shelf itself. */
  product: ProductId | null;
  /** Set by the SOL Saver while the wallet signs or the bytes are on their way. */
  busy: boolean;
  show: (tab?: EarnTab, product?: ProductId | null) => void;
  setTab: (tab: EarnTab) => void;
  openProduct: (product: ProductId | null) => void;
  close: () => void;
  setBusy: (busy: boolean) => void;
};

export const useEarn = create<EarnWindow>((set, get) => ({
  open: false,
  tab: 'shelf',
  product: null,
  busy: false,
  show: (tab, product) => {
    if (get().busy) return set({ open: true });
    const given = tab !== undefined && isEarnTab(tab);
    // A tab asked for opens on its own home (or the product asked for); no tab opens where it was.
    set({ open: true, tab: given ? tab : get().tab, product: isProduct(product) ? product : given ? null : get().product });
  },
  // Mid-way the product stays on screen: it is the one the person is waiting on.
  setTab: (tab) => (get().busy ? undefined : set({ tab, product: null })),
  openProduct: (product) => (get().busy ? undefined : set({ tab: 'shelf', product })),
  close: () => (get().busy ? undefined : set({ open: false })),
  setBusy: (busy) => set({ busy }),
}));

/**
 * Open the Earn window on a tab — `shelf`, `piers` or `mine` — and, on the Shelf, optionally on one product. Without a
 * tab it opens where it was last. While a signature is out it opens on that signature. The one door for every entry:
 * the menu row, the Harbor, and the Helm's verb (CITY-89).
 */
export function openEarn(tab?: EarnTab, product?: ProductId): void {
  useEarn.getState().show(tab, product);
}

export function closeEarn(): void {
  useEarn.getState().close();
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __earn: useEarn, __openEarn: openEarn });
