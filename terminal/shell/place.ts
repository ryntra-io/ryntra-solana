import { useEffect } from 'react';
import { useAddressTail } from './address';
import { useWhere } from './frame';

/** How long a place named in the address is waited for: a screen draws it once its read is in. */
const WAIT_MS = 6000;

/**
 * A place on a screen the menu leads to — the Portfolio's positions or its history (`/portfolio#history`): the router
 * brings it into view when it is already drawn; when the screen draws it later (after its read), this does, once. A
 * fragment that names no place on the page (a phone's second step, `#new`) is left alone.
 */
export function usePlaceOnArrival(): void {
  const { pathname } = useWhere();
  const tail = useAddressTail();
  const hash = tail.includes('#') ? tail.slice(tail.indexOf('#') + 1) : '';
  useEffect(() => {
    if (!/^[a-z][a-z-]*$/.test(hash) || document.getElementById(hash)) return;
    let done = false;
    const look = () => {
      const place = document.getElementById(hash);
      if (!place || done) return;
      done = true;
      stop();
      place.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    const watch = new MutationObserver(look);
    watch.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => stop(), WAIT_MS);
    function stop() {
      watch.disconnect();
      window.clearTimeout(timer);
    }
    return stop;
  }, [pathname, hash]);
}
