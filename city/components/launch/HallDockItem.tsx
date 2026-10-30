'use client';

import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { hallShown, useHall } from '@/city/lib/launch/hall-store';
import s from '../hud/hud.module.css';
import h from './hall.module.css';
import { LAUNCH } from './words';

/** The Hall's glyph, drawn like the HUD's: one stroke weight, square joins, 24 px — a billboard on its mast. */
const HallGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 4h18v10H3zM12 14v7M8 21h8" />
    <path d="M7 11l3-3 2 2 4-4" />
  </svg>
);

/**
 * The Hall of Fame in the city's dock, once it stands in the city: one more district beside the others, drawn as they
 * are. A tap opens the week's boards; a second tap closes them.
 */
export function HallDockItem() {
  const shown = useHall(hallShown);
  const open = useHall((st) => st.panel);
  const w = useWords(LAUNCH);
  if (!shown) return null;
  return (
    <button
      className={[s.dockItem, h.dockHall, open && s.dockOn].filter(Boolean).join(' ')}
      aria-label={w.hallOfFame}
      aria-pressed={open}
      data-hint={w.hallHint}
      onClick={() => {
        if (useCity.getState().sound) playTick();
        const hall = useHall.getState();
        if (hall.panel) return hall.close();
        useCity.getState().select(null);
        hall.show();
      }}
    >
      <span className={s.dockGlyph}>
        <HallGlyph />
      </span>
      <span className={s.dockLabel}>{w.hall}</span>
    </button>
  );
}
