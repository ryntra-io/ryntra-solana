import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { addressOf, takeAsk, useAsk, type Ask } from './ask.ts';

/**
 * For a screen: `handle` gets each reading left for the address the screen stands at, once — the one waiting when the
 * screen opens and every one after while it stays open.
 */
export function useAskHere(handle: (ask: Ask) => void): void {
  const here = addressOf(usePathname() ?? '/');
  const waiting = useAsk((st) => (st.ask?.href === here ? st.ask : null));
  const handler = useRef(handle);
  handler.current = handle;
  useEffect(() => {
    if (!waiting) return;
    const taken = takeAsk(here);
    if (taken) handler.current(taken);
  }, [waiting, here]);
}
