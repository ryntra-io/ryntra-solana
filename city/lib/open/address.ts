import { isMoneyAsk, type MoneyAsk } from '../money/flag.ts';
import { OPEN_KEY, OPEN_WINDOWS, type OpenWindow } from './old-addresses.ts';

/**
 * What the city's home address asks to open: `/?open=<window>`, with the window's own detail — Money's tab, the
 * Oracle's market or its positions. An old address of the cabinet lands here (`old-addresses.ts`); nothing else in the
 * city writes it. Anything the city does not know is ignored, and the home simply opens.
 */
export type OpenAsk = Readonly<{
  window: OpenWindow;
  /** Money's tab (`bridge` opens Send's way to another network). */
  tab?: MoneyAsk;
  /** A prediction market's event, for the Oracle. */
  market?: string;
  /** The Oracle's positions. */
  positions?: boolean;
}>;

/** The query keys an ask is made of; the city takes them off the address once the window is open. */
export const ASK_KEYS = [OPEN_KEY, 'tab', 'market', 'page'] as const;

const EVENT = /^[A-Za-z0-9_.:-]{1,128}$/;

export function isOpenWindow(value: unknown): value is OpenWindow {
  return typeof value === 'string' && (OPEN_WINDOWS as readonly string[]).includes(value);
}

/** The ask in a query string, or null when it names no window of the city. */
export function readOpenAsk(search: string): OpenAsk | null {
  const query = new URLSearchParams(search);
  const window = query.get(OPEN_KEY);
  if (!isOpenWindow(window)) return null;
  if (window === 'money') {
    const tab = query.get('tab');
    return isMoneyAsk(tab) ? { window, tab } : { window };
  }
  if (window === 'oracle') {
    const market = query.get('market');
    if (market && EVENT.test(market)) return { window, market };
    if (query.get('page') === 'positions') return { window, positions: true };
  }
  return { window };
}

/** The address without the ask: the same page, its other query keys and its fragment kept. */
export function withoutAsk(pathname: string, search: string, hash: string): string {
  const query = new URLSearchParams(search);
  for (const key of ASK_KEYS) query.delete(key);
  const rest = query.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}
