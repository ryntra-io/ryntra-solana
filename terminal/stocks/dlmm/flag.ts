/**
 * Whether the terminal offers a position in a stock's DLMM pool, from
 * `NEXT_PUBLIC_RYNTRA_EARN_DLMM_STOCKS` (what the server serves is its own switch, `RYNTRA_EARN_DLMM_STOCKS`):
 *
 * - `open` (exactly): the pool's page draws the ticket wherever the server reads the pool as a stock's — closed to a
 *   wallet, it says so under the form;
 * - `canary` (exactly): the ticket stands only for a wallet the server lets put money in now (the operator's first try); to
 *   everyone else the page stays as it was;
 * - anything else: off — the page asks nothing and stays exactly as it was.
 *
 * Pure.
 */

export type DlmmStocksScreen = 'off' | 'canary' | 'open';

export function dlmmStocksScreen(value: string | undefined): DlmmStocksScreen {
  const v = value?.trim();
  return v === 'open' || v === 'canary' ? v : 'off';
}

/** The mode this build was made with. */
export const DLMM_STOCKS_SCREEN: DlmmStocksScreen = dlmmStocksScreen(process.env.NEXT_PUBLIC_RYNTRA_EARN_DLMM_STOCKS);

/** Whether a pool read for this wallet gets the ticket under the screen's mode. */
export function stockTicketShown(screen: DlmmStocksScreen, read: Readonly<{ add: 'on' | 'off' }> | null): boolean {
  if (screen === 'off' || !read) return false;
  return screen === 'open' || read.add === 'on';
}
