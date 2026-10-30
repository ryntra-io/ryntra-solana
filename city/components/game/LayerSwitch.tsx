'use client';

import { useEffect, type ReactNode } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { PLAY_OPEN } from '@/city/lib/game/flag';
import { GAME_WORDS, useLayer, type Layer } from '@/city/lib/game/layer';
import { useWords } from '@/city/lib/i18n/dict';
import { Mark } from '../hud/Mark';
import { PlayGlyph } from './glyphs';
import { installPlay } from './play';
import g from './game.module.css';

const LAYERS: readonly Layer[] = ['city', 'play'];

/**
 * The brand and, beside it, «City / Play» (CITY-81): two segments in one glass pill, the layer on now lit in amber.
 * City is money; Play is the game over the same city — only where Play's switch is open (`city/lib/game/flag.ts`). A
 * phone has no room for both the logo and the words: there the City segment carries the mark and is the way home, as
 * the logo is, and Play carries its glyph.
 */
export function BrandWithLayers({ children, onHome }: { children: ReactNode; onHome: () => void }) {
  // Play's switch waits behind its flag (decision 86): the brand alone, the way home on a phone too.
  if (!PLAY_OPEN) return children;
  return (
    <div className={g.lead}>
      {children}
      <LayerSwitch onHome={onHome} />
    </div>
  );
}

function LayerSwitch({ onHome }: { onHome: () => void }) {
  const layer = useLayer((st) => st.layer);
  const w = useWords(GAME_WORDS);
  useEffect(() => installPlay(), []);
  return (
    <div className={g.switch} role="group" aria-label={w.layers} data-layer={layer}>
      <span className={g.thumb} aria-hidden="true" />
      {LAYERS.map((id) => (
        <button
          key={id}
          type="button"
          className={g.segment}
          aria-label={w[id]}
          aria-pressed={layer === id}
          onClick={() => {
            if (useCity.getState().sound) playTick();
            // City pressed in City: the city's overview, as the logo gives it.
            if (useLayer.getState().layer === id) return id === 'city' ? onHome() : undefined;
            useLayer.getState().set(id);
          }}
        >
          <span className={g.word}>{w[id]}</span>
          <span className={g.icon} aria-hidden="true">
            {id === 'city' ? <Mark size={22} glow={false} /> : <PlayGlyph />}
          </span>
        </button>
      ))}
    </div>
  );
}
