'use client';

import { useEffect, useRef } from 'react';
import { howStore } from '@/city/lib/art/how';
import { useGuides } from '@/city/lib/how/store';
import { useCity } from '@/city/lib/city/store';
import { useHudPanels } from '@/city/lib/city/windows';
import { openBerth } from '@/city/lib/launch/berth-store';
import { launchOpenHere, useLaunch } from '@/city/lib/launch/district';
import { openPartners } from '@/city/lib/partners/store';
import { openScouts } from '@/city/lib/scouts/store';
import { openLearn } from '@/city/lib/learn/store';
import { useWords } from '@/city/lib/i18n/dict';
import { LANG_LABEL, LANGS, setLang, useLang } from '@/city/lib/i18n/lang';
import { MENU_LEGAL, MENU_PAGES, MENU_SITE_DOCS, SITE_DOC_PATHS, type PageId } from '@/city/lib/pages/pages';
import { openPage } from '@/city/lib/pages/store';
import { openSettings } from '@/city/lib/settings/view';
import { CONTACTS } from '@/lib/site/contacts';
import { BerthGlyph } from '../berth/glyphs';
import { PlayGlyph } from '../how/glyphs';
import { LearnGlyph } from '../learn/glyphs';
import { useLessons } from '../how/useLessons';
import { XGlyph } from '../pages/glyphs';
import { PAGES } from '../pages/words';
import { PartnersGlyph } from '../partners/glyphs';
import { PARTNERS } from '../partners/words';
import { FlagGlyph } from '../scouts/glyphs';
import { SpeakerOff, SpeakerOn } from './glyphs';
import { MENU } from './words';
import s from './hud.module.css';

/** One menu on the page: a fixed id, the same on the server and in the browser (a useId differs where the tree above does). */
const MENU_ID = 'city-menu';

export const MenuGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

const ArrowGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
    <path d="M8 16L16 8M9 8h7v7" />
  </svg>
);

/**
 * The one menu of the top bar (☰): «My tower» — the creator's coin and earnings (CITY-168), «Scouts» — your link and your friends (CITY-8), «Partners» — the programme and
 * «Мій район» (CITY-126, CITY-127), «How it works» — a film for every live function, shown only while there is one
 * (CITY-43, city/components/how), how the city works (its own window, city/components/art), the settings, the sound,
 * the language, and the city's pages — «What we're building» and the roadmap at their own addresses (CITY-177), then
 * Docs, Developers, Help, About, the Terms and the Privacy Policy, each its own window over the city (CITY-157). Everything that is not a district lives here, so the bar keeps four things: the
 * status, the search, the wallet and this.
 */
export function CityMenu({ onSound }: { onSound: (on: boolean) => void }) {
  const open = useHudPanels((st) => st.menu);
  const wrap = useRef<HTMLDivElement>(null);
  const w = useWords(MENU);
  // A tap anywhere else closes it, as the city's other panels do. Settings is a window of its own (CITY-87): a tap in
  // it never closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) useHudPanels.getState().closeMenu();
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div ref={wrap} className={s.menuWrap} data-city-menu="">
      <button className={`${s.panel} ${s.iconBtn} ${open ? s.iconOn : ''}`} aria-label={w.menu} aria-expanded={open} aria-controls={MENU_ID} onClick={() => useHudPanels.getState().toggleMenu()}>
        <MenuGlyph />
      </button>
      {open && <MenuPanel onSound={onSound} onClose={useHudPanels.getState().closeMenu} />}
    </div>
  );
}

/** A page of the city from the menu: the menu steps away and the page opens as a window. */
function openFromMenu(id: PageId, onClose: () => void) {
  onClose();
  openPage(id);
}

function MenuPanel({ onSound, onClose }: { onSound: (on: boolean) => void; onClose: () => void }) {
  const sound = useCity((st) => st.sound);
  const w = useWords(MENU);
  const pw = useWords(PAGES);
  const partners = useWords(PARTNERS).title;
  const lessons = useLessons().length;
  const launching = useLaunch(launchOpenHere);
  return (
    <div id={MENU_ID} className={`${s.panel} ${s.menu}`} role="dialog" aria-label={w.menu}>
      {launching && (
        <button
          className={s.menuRow}
          aria-haspopup="dialog"
          data-city-menu-tower=""
          onClick={() => {
            onClose();
            openBerth();
          }}
        >
          <span className={s.menuSound}>
            <BerthGlyph />
            {w.myTower}
          </span>
          <span className={s.menuChevron} aria-hidden="true" />
        </button>
      )}
      <button
        className={s.menuRow}
        aria-haspopup="dialog"
        onClick={() => {
          onClose();
          openScouts();
        }}
      >
        <span className={s.menuSound}>
          <FlagGlyph />
          {w.scouts}
        </span>
        <span className={s.menuChevron} aria-hidden="true" />
      </button>
      <button
        className={s.menuRow}
        aria-haspopup="dialog"
        onClick={() => {
          onClose();
          openPartners();
        }}
      >
        <span className={s.menuSound}>
          <PartnersGlyph />
          {partners}
        </span>
        <span className={s.menuChevron} aria-hidden="true" />
      </button>
      {/* «Learn» (CITY-202): every function from A to Z, chapter by chapter. */}
      <button
        className={s.menuRow}
        aria-haspopup="dialog"
        onClick={() => {
          onClose();
          openLearn();
        }}
        data-city-menu-learn=""
      >
        <span className={s.menuSound}>
          <LearnGlyph />
          {w.learn}
        </span>
        <span className={s.menuChevron} aria-hidden="true" />
      </button>
      {/* The lessons (CITY-43): the row stands once there is a lesson to watch — never an empty window. */}
      {lessons > 0 && (
        <button
          className={s.menuRow}
          aria-haspopup="dialog"
          onClick={() => {
            onClose();
            useGuides.getState().show();
          }}
          data-city-menu-guides=""
        >
          <span className={s.menuSound}>
            <PlayGlyph />
            {w.howItWorks}
          </span>
          <span className={s.menuChevron} aria-hidden="true" />
        </button>
      )}
      <button
        className={s.menuRow}
        aria-haspopup="dialog"
        onClick={() => {
          onClose();
          howStore.getState().show();
        }}
      >
        <span>{w.how}</span>
        <span className={s.menuChevron} aria-hidden="true" />
      </button>
      <button className={s.menuRow} aria-haspopup="dialog" onClick={() => openSettings()}>
        <span>{w.settings}</span>
        <span className={s.menuChevron} aria-hidden="true" />
      </button>
      <button className={s.menuRow} aria-pressed={sound} onClick={() => onSound(!sound)}>
        <span className={s.menuSound}>
          {sound ? <SpeakerOn /> : <SpeakerOff />}
          {w.sound}
        </span>
        <span className={`${s.menuState} ${sound ? s.menuStateOn : ''}`}>{sound ? w.on : w.off}</span>
      </button>
      <LanguageRow />
      {/* The city's pages open as its own windows, over the city (CITY-157): never a tab of the old site. «What we're
          building» and the roadmap are documents of their own address, first among them (CITY-177). */}
      <div className={s.menuLinks}>
        {MENU_SITE_DOCS.map((id) => (
          <a key={id} className={s.menuLink} href={SITE_DOC_PATHS[id]} data-city-menu-doc={id}>
            <span className={s.menuLinkName}>{pw[id]}</span>
            <span className={s.menuChevron} aria-hidden="true" />
          </a>
        ))}
        {MENU_PAGES.map((id) => (
          <button key={id} className={s.menuLink} aria-haspopup="dialog" onClick={() => openFromMenu(id, onClose)}>
            <span className={s.menuLinkName}>{pw[id]}</span>
            <span className={s.menuChevron} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className={s.menuLegal}>
        {MENU_LEGAL.map((id) => (
          <button key={id} aria-haspopup="dialog" onClick={() => openFromMenu(id, onClose)}>
            {pw[id]}
          </button>
        ))}
        <a className={s.menuX} href={CONTACTS.companyX} target="_blank" rel="noopener" aria-label={w.onX}>
          <XGlyph />
          <ArrowGlyph />
        </a>
      </div>
    </div>
  );
}

/** The language: EN · UA, one tap; the city repaints its words in place and keeps the choice on this device. */
function LanguageRow() {
  const w = useWords(MENU);
  const lang = useLang();
  return (
    <div className={s.menuLang} role="group" aria-labelledby={`${MENU_ID}-lang`}>
      <span id={`${MENU_ID}-lang`}>{w.language}</span>
      <span className={s.menuLangPair}>
        {LANGS.map((code) => (
          <button key={code} lang={code} aria-pressed={lang === code} onClick={() => lang !== code && setLang(code)}>
            {LANG_LABEL[code]}
          </button>
        ))}
      </span>
    </div>
  );
}
