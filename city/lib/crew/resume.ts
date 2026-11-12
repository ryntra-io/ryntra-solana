/**
 * Back to the agent's card (CITY-222): a person who taps «Connect wallet» on the card with no wallet in this browser
 * leaves to get one — the install page on a computer, the wallet app's own browser on a phone. Coming back should land on
 * the card they left, not on the plain city.
 *
 * - **The same browser** (a wallet installed on the computer, the page opened again): the card is kept here for two
 *   hours — the sentence said and the coin picked, nothing else — and the city opens it again on the next visit.
 * - **The wallet app's browser** (a phone: «Open in Phantom»): another browser keeps nothing of this one, so the link
 *   itself asks for the card — `/?open=agent`, the agent's own address (CITY-194).
 *
 * Kept in the viewer's own storage, read by nothing else; a refused storage keeps nothing and the card is one sentence
 * away as before. Pure but for the storage handed in.
 */

export type PendingCard = Readonly<{ said: string; coin: Readonly<{ mint: string; symbol: string; icon: string | null }> | null; at: number }>;

const KEY = 'ryntra.city.agentPending.v1';
/** How long the card waits for its person to come back with a wallet. */
export const PENDING_MS = 2 * 3_600_000;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const local = (): Store | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** The card left for a wallet: what was said and the coin, now. */
export function keepPending(card: Omit<PendingCard, 'at'>, now: number = Date.now(), storage: Store | null = local()): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ said: card.said.slice(0, 140), coin: card.coin, at: now }));
  } catch {
    /* Nothing kept: the card is one sentence away. */
  }
}

/** The card waiting for this browser, taken once: null when none, when it is older than two hours, or unreadable. */
export function takePending(now: number = Date.now(), storage: Store | null = local()): PendingCard | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    storage?.removeItem(KEY);
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.said !== 'string' || typeof v.at !== 'number' || now - v.at > PENDING_MS || v.at > now + 60_000) return null;
    const c = v.coin as Record<string, unknown> | null | undefined;
    const coin = c && typeof c.mint === 'string' && MINT.test(c.mint) && typeof c.symbol === 'string' && /^[A-Za-z0-9$.]{1,12}$/u.test(c.symbol) ? { mint: c.mint, symbol: c.symbol, icon: typeof c.icon === 'string' && c.icon.startsWith('/api/icon/') ? c.icon : null } : null;
    return { said: v.said.slice(0, 140), coin, at: v.at };
  } catch {
    return null;
  }
}

/** Signed, or the card came back: nothing waits any more. */
export function forgetPending(storage: Store | null = local()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* Nothing to forget. */
  }
}

/** The address a phone's wallet app opens to come back to the card: the city's own, asking for the agent. */
export function cardReturnUrl(origin: string): string {
  return `${origin.replace(/\/+$/u, '')}/?open=agent`;
}
