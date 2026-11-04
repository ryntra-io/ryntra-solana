'use client';

import { useEffect, useState } from 'react';
import { useBackPanels } from '@/city/lib/back/panels';
import { useChrome } from '@/city/lib/deck/chrome';
import { useWords } from '@/city/lib/i18n/dict';
import { framesIn, top, type Layout } from '@/city/lib/window/layout';
import { useWindows, type Chip as ChipSpec } from '@/city/lib/window/store';
import { ChipTitle, FIGURES } from './figures';
import { unfoldChip } from './openers';
import { WINDOW } from './words';
import s from './window.module.css';

/** Room for the chips, as `left right` in px: on a computer the city between the bays that hold a frame; else none. */
function stripOf(layout: Layout, desk: boolean): string {
  if (!desk) return '';
  const frames = framesIn(layout);
  const left = frames.find((f) => f.bay === 'left')?.rect;
  const right = frames.find((f) => f.bay === 'right')?.rect;
  const x0 = left ? left.x + left.width + 16 : layout.area.x;
  const x1 = right ? right.x - 16 : layout.area.x + layout.area.width;
  return `${x0} ${x1}`;
}

/**
 * The tray over the Deck (CITY-84, helm §4): every folded window as one glass chip — its glyph and its live figure (a
 * price, a balance), the title when there is none yet. A tap opens the window again on what it showed, where it stood.
 * On a computer it keeps to the city between the bays; on a phone it stands over the sheet when one is up. It steps
 * aside while nothing is folded, while a window has the whole screen and while the Deck's doors are open over it.
 */
export function Tray() {
  const w = useWords(WINDOW);
  const chips = useWindows((st) => st.chips);
  const away = useWindows((st) => st.layout.full !== null);
  const sheet = useWindows((st) => !st.desk && top(st.layout) !== null);
  const strip = useWindows((st) => stripOf(st.layout, st.desk));
  const doors = useBackPanels((st) => st.open.includes('tray'));
  const deck = useChrome((st) => st.bottom);
  // The chips look at their figures again every half minute: an old one gives way to the title in time.
  const [, setTick] = useState(0);
  const any = chips.length > 0;
  useEffect(() => {
    if (!any) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [any]);
  if (!chips.length || away || doors) return null;
  const [x0, x1] = strip ? strip.split(' ').map(Number) : [];
  const style = x0 !== undefined && x1 !== undefined ? { left: (x0 + x1) / 2, maxWidth: Math.max(0, x1 - x0) } : undefined;
  return (
    <div className={`${s.fold} ${sheet ? s.foldOverSheet : deck ? '' : s.foldLow}`} style={style} role="group" aria-label={w.tray} data-window-tray="">
      {chips.map((chip) => (
        <Chip key={chip.id} chip={chip} />
      ))}
    </div>
  );
}

function Chip({ chip }: { chip: ChipSpec }) {
  const w = useWords(WINDOW);
  const figure = chip.figure ? chip.figure(chip.title, chip.params) : FIGURES[chip.id] ? FIGURES[chip.id]!(chip.title, chip.params) : <ChipTitle title={chip.title} />;
  return (
    <button type="button" className={s.chip} aria-label={w.unfold(chip.title)} title={chip.title} onClick={() => unfoldChip(chip.id)} data-window-chip={chip.id}>
      {chip.icon && <span className={s.icon}>{chip.icon}</span>}
      <span className={s.chipText}>{figure}</span>
    </button>
  );
}
