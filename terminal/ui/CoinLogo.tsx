'use client';

import { useState } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

/**
 * A coin's logo, from Ryntra's own proxy (`/api/icon/<mint>`) or the address given. A logo that cannot be brought, or a
 * coin without one, leaves a quiet disc with the ticker's first letter — never a broken image. Logos are the engine's:
 * nothing here is drawn for a coin.
 *
 * `also`: the addresses tried in turn when `src` cannot be brought (the engine's logo route answers nothing
 * for some coins, the catalogue's does); the letter only when none of them loads.
 *
 * `eager`: the picture is asked at once — in a list that opens on a tap (what to pay with, the coin picker), where a lazy
 * picture inside a scrolled box waited for a scroll and the person saw letters instead of logos. Long tables
 * stay lazy.
 */
export function CoinLogo({ src, also, symbol, size = 'm', eager = false, className }: { src: string | null; also?: readonly string[]; symbol: string; size?: 's' | 'm' | 'l' | 'xl'; eager?: boolean; className?: string }) {
  const list = src ? [src, ...(also ?? [])] : [];
  const key = list.join(' ');
  // How many of the addresses failed, for this list: a new list starts again from its first.
  const [missed, setMissed] = useState<Readonly<{ key: string; n: number }>>({ key, n: 0 });
  const at = missed.key === key ? missed.n : 0;
  const now = list[at] ?? null;
  const sized = cx(s.logo, size === 's' && s.logoS, size === 'l' && s.logoL, size === 'xl' && s.logoXl, className);
  if (!now) {
    return (
      <span className={cx(sized, s.logoMark)} aria-hidden="true">
        {symbol.replace(/^\$+/u, '').slice(0, 1).toUpperCase()}
      </span>
    );
  }
  // A new address is a new picture: the last coin's logo never stands in while the next one loads.
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={now} className={sized} src={now} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setMissed({ key, n: at + 1 })} />;
}

/** The engine's logo address for a coin of the market read, or none. */
export function coinIcon(coin: Readonly<{ id: string; icon: string | null }>): string | null {
  return coin.icon ? `/api/icon/${coin.id}` : null;
}
