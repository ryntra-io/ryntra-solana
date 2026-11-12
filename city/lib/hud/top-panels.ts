import { feedTakesEscape } from '../feed/panel.ts';

/**
 * The panels that drop from the top bar and stand over a window: the wallet's (in a layer of its own, CITY-239) and the
 * events' under the bell. Each closes on Escape by its own listener — and that press is theirs alone (CITY-240): a
 * window under the panel, or a screen inside that window, stays as it is until the next press, as «Back» already
 * leaves it.
 *
 * A window's listener that would hear the key before the panel's own (one heard first, registered before the panel
 * opened) asks this rule and stands down: the Ring's making screen kept its draft, a bot's page its place. Pure, so the
 * rule is tested: the page comes in as the little of `document` it reads.
 */

/** The wallet's panel, wherever it is drawn (`WalletChip`). */
export const WALLET_PANEL = '[data-wallet-menu]';

/** Whether the wallet's panel is open: it takes Escape whatever holds the keyboard, as it always has. */
export function walletPanelOpen(doc: Pick<Document, 'querySelector'>): boolean {
  return doc.querySelector(WALLET_PANEL) !== null;
}

/** Whether this Escape belongs to a panel of the top bar: the wallet's when it is open, else the events' by its own rule. */
export function topPanelTakesEscape(feedOpen: boolean, doc: Pick<Document, 'querySelector' | 'activeElement' | 'body'>): boolean {
  return walletPanelOpen(doc) || feedTakesEscape(feedOpen, doc);
}
