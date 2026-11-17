'use client';

import { useEffect, useState } from 'react';
import { Mark } from '@/city/components/hud/Mark';
import { useWords } from '@/city/lib/i18n/dict';
import { AgentLine } from './AgentLine';
import { Events } from './Events';
import { PHONE_HEAD, togglePanel, useFrame } from './frame';
import { WalletButton } from './Wallet';
import { SHELL } from './words';
import s from './shell.module.css';

/**
 * The header of every screen: the agent's line, the events and the wallet. On a phone the mark stands first and opens
 * the sections sheet (the shelves outside the tab bar, the wallet, the city, «More»). Once the page scrolls, the
 * header keeps its place over the screen on a ground of its own.
 */
export function Header() {
  const w = useWords(SHELL);
  const sheet = useFrame((st) => st.panel === 'sheet');
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const look = () => setStuck(window.scrollY > 2);
    look();
    window.addEventListener('scroll', look, { passive: true });
    return () => window.removeEventListener('scroll', look);
  }, []);
  return (
    <header className={s.top} data-stuck={stuck ? '' : undefined}>
      <button type="button" className={s.phoneMark} data-terminal="mark" aria-label={w.allSections} aria-expanded={sheet} aria-haspopup="dialog" onClick={() => togglePanel('sheet')}>
        {/* With its light, as the city's top bar draws it — and with gradients of its own: the rail's flat mark is hidden on
            a phone, and a hidden copy's gradients paint nothing. */}
        <Mark size={32} />
      </button>
      {/* A phone's place for the screen in front: filled by a screen with its own line for the agent, empty otherwise. */}
      <div id={PHONE_HEAD} className={s.phoneHead} />
      <AgentLine />
      <div className={s.spacer} />
      <Events />
      <WalletButton />
    </header>
  );
}
