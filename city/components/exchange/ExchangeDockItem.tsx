'use client';

import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { EXCHANGE_OPEN } from '@/city/lib/exchange/flag';
import { LOCKED, useExchange } from '@/city/lib/exchange/store';
import s from '../hud/hud.module.css';
import { ExchangeGlyph } from './glyphs';

/**
 * The Exchange in the city's dock, once its switch is open: one more district beside the others, drawn as they are.
 * A tap opens the window on the market last open (Solana's own the first time); a second tap closes it, unless a
 * signature holds it.
 */
export function ExchangeDockItem() {
  if (!EXCHANGE_OPEN) return null;
  return <OpenExchangeDockItem />;
}

function OpenExchangeDockItem() {
  const open = useExchange((st) => st.open);
  return (
    <button
      className={[s.dockItem, open && s.dockOn].filter(Boolean).join(' ')}
      aria-label="Exchange"
      aria-pressed={open}
      data-hint="Perps on Phoenix, long or short"
      onClick={() => {
        if (useCity.getState().sound) playTick();
        const exchange = useExchange.getState();
        if (exchange.open) {
          if (!LOCKED.has(exchange.phase)) exchange.hide();
          return;
        }
        exchange.show();
      }}
    >
      <span className={s.dockGlyph}>
        <ExchangeGlyph />
      </span>
      <span className={s.dockLabel}>Exchange</span>
    </button>
  );
}
