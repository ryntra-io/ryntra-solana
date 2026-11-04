/**
 * Earn in the city (CITY-92, `docs/research/ryntra-earn-2026-10-29/SPEC.md`): one window with three tabs — the Shelf
 * of products, the Piers and Mine. It opens to people only where the deployment's switch says `open`
 * (`NEXT_PUBLIC_RYNTRA_CITY_EARN`), after the owner's eyes and the SOL Saver's canary with a small sum (spec §18.3).
 * Until then nothing of Earn is drawn and its routes answer «closed».
 */

export const EARN_TABS = ['shelf', 'piers', 'mine'] as const;
export type EarnTab = (typeof EARN_TABS)[number];

export function earnOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const EARN_OPEN = earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN);

/**
 * Whether Earn reads a loan of the wallet. None yet: the first loan read — Kamino's, for «Dollars for Stocks»: Kamino is not wired. Loan health (CITY-100) stands ready behind it: its judge and words
 * (`notes.ts`), the city's source and the server's watch read loans as soon as there is a reader; until then the
 * notification window does not list it.
 */
export const EARN_LOANS = false;

export function isEarnTab(value: unknown): value is EarnTab {
  return typeof value === 'string' && (EARN_TABS as readonly string[]).includes(value);
}

/**
 * The products of the Shelf, in the order the spec names them. The SOL Pier
 * opens the Harbor's own flow where the Harbor's switch is open; the Stock Pier (CITY-98) builds where its own switch
 * is open (`NEXT_PUBLIC_RYNTRA_CITY_STOCK_PIER`) and otherwise shows its verified pairs with «tell me when it opens»;
 * the rest stand as real cards with live context and one «tell me when it opens».
 */
export const PRODUCTS = ['saver', 'pier', 'dollar', 'sell', 'stockpier', 'stocks', 'captain'] as const;
export type ProductId = (typeof PRODUCTS)[number];

/** Risk dots, 1 to 3: how much a person can lose to the product's main risk, as the spec's styles rank it. */
export const RISK: Readonly<Record<ProductId, 1 | 2 | 3>> = {
  saver: 1,
  pier: 2,
  dollar: 1,
  sell: 2,
  stockpier: 3,
  stocks: 3,
  captain: 2,
};

export function isProduct(value: unknown): value is ProductId {
  return typeof value === 'string' && (PRODUCTS as readonly string[]).includes(value);
}
