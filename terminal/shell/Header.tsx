'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Mark } from '@/city/components/hud/Mark';
import { useWords } from '@/city/lib/i18n/dict';
import { Icon } from '@/terminal/ui';
import { AgentLine } from './AgentLine';
import { Events } from './Events';
import { MENU_SHEET, PHONE_HEAD, togglePanel, useFrame } from './frame';
import { MARKET_ITEM, itemHref } from './menu';
import { useMenu } from './Rail';
import { KIT_PATH } from './shelves';
import { WalletButton } from './Wallet';
import { SHELL } from './words';
import s from './shell.module.css';

/**
 * The header of every screen: the agent's line, the events and the wallet. On a phone the menu's button stands first —
 * three lines, where a person looks for a menu — and opens the menu's sheet; the mark beside it leads home, as
 * it does on every site. Once the page scrolls, the header keeps its place over the screen on a ground of its own.
 */
export function Header() {
  const w = useWords(SHELL);
  const sheet = useFrame((st) => st.panel === 'sheet');
  const { view, marketOn } = useMenu();
  const home = view === 'preview' ? KIT_PATH : marketOn ? itemHref(MARKET_ITEM, view) : null;
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const look = () => setStuck(window.scrollY > 2);
    look();
    window.addEventListener('scroll', look, { passive: true });
    return () => window.removeEventListener('scroll', look);
  }, []);
  return (
    <header className={s.top} data-stuck={stuck ? '' : undefined}>
      <button
        type="button"
        className={`${s.iconBtn} ${s.menuBtn}`}
        data-terminal="menu-button"
        aria-label={w.menu}
        aria-expanded={sheet}
        aria-haspopup="dialog"
        aria-controls={sheet ? MENU_SHEET : undefined}
        onClick={() => togglePanel('sheet')}
      >
        <Icon name="menu" size="l" />
      </button>
      {/* With its light, as the city's top bar draws it — and with gradients of its own: the rail's flat mark is hidden on
          a phone, and a hidden copy's gradients paint nothing. */}
      {home ? (
        <Link className={s.phoneMark} data-terminal="mark" href={home} aria-label={w.home}>
          <Mark size={26} />
        </Link>
      ) : (
        <span className={s.phoneMark} data-terminal="mark" role="img" aria-label={w.home}>
          <Mark size={26} />
        </span>
      )}
      {/* A phone's place for the screen in front: filled by a screen with its own line for the agent, empty otherwise. */}
      <div id={PHONE_HEAD} className={s.phoneHead} />
      <AgentLine />
      <div className={s.spacer} />
      <Events />
      <WalletButton />
    </header>
  );
}
