'use client';

import { useEffect, useState } from 'react';
import { iconAttempt, ICON_RETRY_MS, iconSource, monogram } from '@/city/lib/chart/icon';
import type { Tower } from '@/city/lib/market/types';
import c from './chart.module.css';

/**
 * The coin's logo in the chart's head: the engine's own logo of it (`/api/icon/<mint>`, the URL Jupiter lists for the
 * coin). A busy logo gateway is asked once more a moment later; until the logo arrives, and for a coin that has none,
 * the coin's first letter stands in its circle — never an empty ring.
 */
export function CoinIcon({ tower }: { tower: Pick<Tower, 'id' | 'icon' | 'symbol'> }) {
  const [state, setState] = useState(() => ({ mint: tower.id, attempt: 0 }));
  const attempt = state.mint === tower.id ? state.attempt : 0;
  const src = iconSource(tower, attempt);

  useEffect(() => {
    if (attempt !== 1) return;
    const timer = setTimeout(() => setState({ mint: tower.id, attempt: 2 }), ICON_RETRY_MS);
    return () => clearTimeout(timer);
  }, [attempt, tower.id]);

  return (
    <span className={c.icon} aria-hidden="true">
      <span className={c.monogram}>{monogram(tower.symbol)}</span>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} className={c.logo} src={src} alt="" onError={() => setState({ mint: tower.id, attempt: iconAttempt(attempt) })} />
      ) : null}
    </span>
  );
}
