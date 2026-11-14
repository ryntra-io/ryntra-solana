import { sendEvent } from '../../../lib/analytics.ts';
import { isRyntraApp } from '../app-mode.ts';
import { langNow } from '../i18n/lang.ts';
import { funnelDevice, funnelEvent, funnelWord, onceStore, type FunnelName, type FunnelWord } from './funnel.ts';

/**
 * The funnel's one way out (CITY-222, CITY-246): a moment sent once a visit to `/api/track`. Kept apart from the stores'
 * watcher (`funnel-watch.ts`) so the wallet's sign-in and the command line can say their moment without loading the
 * agent's stores. Nothing here reads an address or an amount.
 */

let once: ReturnType<typeof onceStore> | null = null;

function device() {
  const coarse = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  return funnelDevice(typeof navigator !== 'undefined' && isRyntraApp(navigator.userAgent), coarse);
}

/** A browser robot drives this page (our own walks and shots): its moments say `bot`. */
const robot = () => typeof navigator !== 'undefined' && navigator.webdriver === true;

/** One moment of the path, the first time this visit reaches it. Never throws, never waits. */
export function funnelSay(name: FunnelName, word: FunnelWord | null = null): void {
  try {
    if (typeof window === 'undefined') return;
    once ??= onceStore(window.sessionStorage ?? null);
    if (!once.first(name)) return;
    sendEvent(funnelEvent(name, device(), langNow() === 'uk' ? 'uk' : 'en', funnelWord(word, robot())));
  } catch {
    // The funnel never stands in the way of the path.
  }
}
