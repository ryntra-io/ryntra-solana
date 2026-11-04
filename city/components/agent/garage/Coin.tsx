'use client';

import { useState } from 'react';
import type { Tower } from '@/city/lib/market/types';
import s from './garage.module.css';

/** A coin's picture from the city's icon route; until it loads, or when there is none, its letter on the violet disc the feed uses. */
export function Coin({ t, size = 'row' }: { t: Pick<Tower, 'id' | 'symbol' | 'icon'>; size?: 'row' | 'chip' }) {
  const [failed, setFailed] = useState<string | null>(null);
  const cls = size === 'chip' ? s.chipCoin : s.coin;
  if (t.icon && failed !== t.id) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={cls} src={`/api/icon/${t.id}`} alt="" onError={() => setFailed(t.id)} />;
  }
  return (
    <span className={`${cls} ${s.letter}`} aria-hidden="true">
      {t.symbol.replace(/^\$/, '').slice(0, 1).toUpperCase()}
    </span>
  );
}
