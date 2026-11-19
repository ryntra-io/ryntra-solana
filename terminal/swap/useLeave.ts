'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { flowLive } from '@/city/lib/money/flag';
import { setAct } from '@/terminal/portfolio/state';
import { shelfHref } from '@/terminal/shell/shelves';
import type { Place } from './doors';
import { BRIDGE_PATH, showMoney } from './state';

/**
 * Where a door of the Swap and Bridge screens leads (decision 109): the bridge to its own page, a transfer to the
 * Portfolio's panel — one step, the address replaced, so «Back» never returns to a screen that only passed it on. A way
 * the engine keeps shut leads nowhere, and the page a door already stands on is not opened again.
 */
export function useLeave(here: Place | null = null): (place: Place) => void {
  const router = useRouter();
  return useCallback(
    (place: Place) => {
      if (place === here) return;
      if (place === 'bridge') {
        if (flowLive('bridge') || flowLive('deposit')) router.replace(BRIDGE_PATH);
        return;
      }
      if (!flowLive('send')) return;
      showMoney('send');
      setAct({ kind: 'send' });
      router.replace(`${shelfHref('portfolio', 'live')}?act=send`);
    },
    [router, here],
  );
}
