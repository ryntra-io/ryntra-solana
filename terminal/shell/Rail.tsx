'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { Mark } from '@/city/components/hud/Mark';
import { BRAND } from '@/city/lib/brand';
import { useWords } from '@/city/lib/i18n/dict';
import { Icon } from '@/terminal/ui';
import { closePanel, togglePanel, useFrame, useWhere } from './frame';
import { More } from './More';
import { setRailFolded, useRailFolded } from './rail-fold';
import { CITY_PATH, KIT_PATH, shelfHref, shelvesShown } from './shelves';
import { useDismiss } from './useDismiss';
import { SHELF_WORDS, SHELL } from './words';
import s from './shell.module.css';

/**
 * The rail: the mark, the shelves that are on — on the kit page every shelf — each by its name, and at its foot «City»,
 * «More» and the button that folds the rail to its icons (the browser remembers; a narrow desk folds it itself).
 * A shelf is a link: the screen changes inside the page, and the browser's Back walks the same way.
 */
export function Rail() {
  const { view, shelf } = useWhere();
  const names = useWords(SHELF_WORDS);
  const w = useWords(SHELL);
  const shown = shelvesShown(view);
  const home = view === 'preview' ? KIT_PATH : shown.length ? shelfHref(shown[0]!, view) : null;
  const moreOpen = useFrame((st) => st.panel === 'more');
  const folded = useRailFolded();
  const moreWrap = useRef<HTMLDivElement>(null);
  useDismiss(moreOpen, moreWrap, () => closePanel('more'));
  return (
    <nav className={s.rail} data-terminal="rail" aria-label={w.sections}>
      {home ? (
        <Link className={s.brand} href={home} aria-label={w.home}>
          <Mark size={30} glow={false} />
          <b className={s.brandWord} aria-hidden="true">
            {BRAND.name}
          </b>
        </Link>
      ) : (
        <span className={s.brand} aria-label={w.home} role="img">
          <Mark size={30} glow={false} />
          <b className={s.brandWord} aria-hidden="true">
            {BRAND.name}
          </b>
        </span>
      )}
      {shown.map((id) => (
        <Link key={id} className={s.nav} href={shelfHref(id, view)} aria-current={id === shelf ? 'page' : undefined} title={names[id]}>
          <Icon name={id} />
          <span className={s.quietName}>{names[id]}</span>
        </Link>
      ))}
      <div className={s.grow} />
      <div className={s.railSep} />
      {/* The city is its own view: a page of its own, loaded whole. */}
      <a className={s.nav} href={CITY_PATH} title={w.city}>
        <Icon name="city" />
        <span className={s.quietName}>{w.city}</span>
      </a>
      <div className={s.railMore} ref={moreWrap}>
        <button type="button" className={s.nav} data-terminal="more" aria-expanded={moreOpen} aria-haspopup="dialog" title={w.more} onClick={() => togglePanel('more')}>
          <Icon name="more" />
          <span className={s.quietName}>{w.more}</span>
        </button>
        {moreOpen ? (
          <div className={`${s.pop} ${s.popUp}`} role="dialog" aria-label={w.more}>
            <More />
          </div>
        ) : null}
      </div>
      {/* Its name says what a press does — «Collapse menu», then «Expand menu»: no pressed state beside it. */}
      <button type="button" className={`${s.nav} ${s.railFold}`} data-terminal="rail-fold" title={folded ? w.railOpen : w.railFold} onClick={() => setRailFolded(!folded)}>
        <Icon name="railFold" />
        <span className={s.quietName}>{folded ? w.railOpen : w.railFold}</span>
      </button>
    </nav>
  );
}
