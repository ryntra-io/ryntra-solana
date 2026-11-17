'use client';

import { useState } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

/**
 * A coin's logo, from Ryntra's own proxy (`/api/icon/<mint>`) or the address given. A logo that cannot be brought, or a
 * coin without one, leaves a quiet disc with the ticker's first letter — never a broken image. Logos are the engine's:
 * nothing here is drawn for a coin.
 */
export function CoinLogo({ src, symbol, size = 'm', className }: { src: string | null; symbol: string; size?: 's' | 'm' | 'l' | 'xl'; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const sized = cx(s.logo, size === 's' && s.logoS, size === 'l' && s.logoL, size === 'xl' && s.logoXl, className);
  if (!src || failed === src) {
    return (
      <span className={cx(sized, s.logoMark)} aria-hidden="true">
        {symbol.replace(/^\$+/u, '').slice(0, 1).toUpperCase()}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={sized} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />;
}

/** The engine's logo address for a coin of the market read, or none. */
export function coinIcon(coin: Readonly<{ id: string; icon: string | null }>): string | null {
  return coin.icon ? `/api/icon/${coin.id}` : null;
}
