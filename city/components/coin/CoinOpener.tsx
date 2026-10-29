'use client';

import { useEffect } from 'react';
import { openCoin, openTower, standsInCity } from '@/city/lib/coin/open';
import { useCity } from '@/city/lib/city/store';
import { useLaunch } from '@/city/lib/launch/district';
import type { CoinFacts } from '@/city/lib/search/sources';

/** The bundled city paints at once; the live read and the launches' feed can add the coin's tower a few seconds later. */
const LIVE_GRACE_MS = 1_200;
const LAUNCH_WAIT_MS = 7_000;
const MAX_WAIT_MS = 8_000;

/**
 * `/c/<mint>` opens on its coin: the tower when the city holds it — at once from the bundled city, or when the live read
 * or the Launch Docks bring it — and otherwise, once the city has read what it holds, the coin's trade card. A coin the
 * engine does not name leaves just the city.
 */
export function CoinOpener({ mint, coin }: { mint: string; coin: CoinFacts | null }) {
  useEffect(() => {
    const started = Date.now();
    let liveAt = 0;
    let done = false;
    const abort = new AbortController();
    const step = () => {
      if (done) return;
      if (standsInCity(mint)) {
        done = true;
        clearInterval(timer);
        openTower(mint);
        return;
      }
      const now = Date.now();
      if (!liveAt && useCity.getState().snapshot.source === 'live') liveAt = now;
      const launches = useLaunch.getState().status;
      /* A Ryntra launch stands in the docks once the feed is read; any other coin is in the live city or nowhere. */
      const settled = coin?.launch ? launches === 'unavailable' || now - started > LAUNCH_WAIT_MS : liveAt > 0 && now - liveAt > LIVE_GRACE_MS;
      if (settled || now - started > MAX_WAIT_MS) {
        done = true;
        clearInterval(timer);
        void openCoin(mint, coin, abort.signal);
      }
    };
    const timer = setInterval(step, 200);
    step();
    return () => {
      done = true;
      clearInterval(timer);
      abort.abort();
    };
  }, [mint, coin]);
  return null;
}
