'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useMandate } from '@/city/lib/bots/mandate';
import { useBotsWindow } from '@/city/lib/bots/open';
import { WORDS } from '@/city/lib/bots/words';
import { useLang } from '@/city/lib/i18n/lang';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { BotGlyph } from '../deck/glyphs';
import { useCityWindow } from '../window/useCityWindow';
import s from './bots.module.css';

// The window's contents, its store and its paper runs load the first time it opens: the city's first frame carries none.
const BotsWindow = dynamic(() => import('./BotsWindow'), { ssr: false, loading: () => <div className={s.pending} aria-busy="true" /> });

const renderBots = () => <BotsWindow />;
const closeBots = () => useBotsWindow.getState().close();

/**
 * The bots hub (B4) in the city's one window frame (CITY-65): Start · My bots · Strategies · History. The Deck's
 * «Agents» tray opens it with its «Bots» door (`openBots(tab)` from `city/lib/bots/open`), its icon the door's own.
 * The frame holds while the agent's budget waits on the wallet (CITY-174): a signature out is never closed away.
 */
export function BotsLayer() {
  const open = useBotsWindow((st) => st.open);
  const lang = useLang();
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const shown = open && !running && !filming;
  const held = useMandate((st) => st.busy !== null);

  // Escape closes the window from its first frame — a page inside it steps back first (the contents hear it then).
  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      useBotsWindow.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({ id: 'bots', title: WORDS[lang].title, icon: <BotGlyph />, render: renderBots, size: { width: 1040, height: 760 }, min: { width: 420, height: 520 }, held, onClose: closeBots }),
    // A new language is a new title: the open window's head follows it; a signature out holds the frame.
    [lang, held],
  );
  useCityWindow(shown, spec);
  return null;
}
