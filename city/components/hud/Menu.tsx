'use client';

import { useEffect, useRef } from 'react';
import { howStore } from '@/city/lib/art/how';
import { useCity } from '@/city/lib/city/store';
import { useHudPanels } from '@/city/lib/city/windows';
import { SETTINGS_GROUPS, type FeedSwitch } from '@/city/lib/feed/settings';
import { FEED_SWITCHES } from '@/city/lib/feed/words';
import { hydrateFeed, useFeed } from '@/city/lib/feed/store';
import { openScouts } from '@/city/lib/scouts/store';
import { useWords, type TextKey } from '@/city/lib/i18n/dict';
import { LANG_LABEL, LANGS, setLang, useLang } from '@/city/lib/i18n/lang';
import { CONTACTS } from '@/lib/site/contacts';
import { FlagGlyph } from '../scouts/glyphs';
import { CloseGlyph, SpeakerOff, SpeakerOn } from './glyphs';
import { MENU } from './words';
import s from './hud.module.css';

type MenuText = TextKey<typeof MENU>;

/** The site's own public pages, as the footer of ryntra.io links them (lib/site/homepage-copy.ts). */
const LINKS: readonly { label: MenuText; href: string; line: MenuText }[] = [
  { label: 'docs', href: '/docs', line: 'docsLine' },
  { label: 'developers', href: '/developers', line: 'developersLine' },
  { label: 'support', href: '/support', line: 'supportLine' },
  { label: 'feedback', href: '/feedback', line: 'feedbackLine' },
  { label: 'onX', href: CONTACTS.companyX, line: 'onXLine' },
];
/** One menu on the page: a fixed id, the same on the server and in the browser (a useId differs where the tree above does). */
const MENU_ID = 'city-menu';
const SETTINGS_ID = 'city-settings';
const LEGAL: readonly { label: MenuText; href: string }[] = [
  { label: 'terms', href: '/legal/terms' },
  { label: 'privacy', href: '/legal/privacy' },
];

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
 * The one menu of the top bar (☰): «Scouts» — your link and your friends (CITY-8), how the city works (its own window, city/components/art), the settings, the sound,
 * the docs and the help, the terms. Everything that is not a district lives here, so the bar keeps four things: the
 * status, the search, the wallet and this.
 */
export function CityMenu({ onSound }: { onSound: (on: boolean) => void }) {
  const open = useHudPanels((st) => st.menu);
  const settings = useHudPanels((st) => st.settings);
  const wrap = useRef<HTMLDivElement>(null);
  const w = useWords(MENU);
  // A tap anywhere else closes it, as the city's other panels do.
  useEffect(() => {
    if (!open && !settings) return;
    const outside = (event: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) useHudPanels.setState({ menu: false, settings: false });
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open, settings]);
  return (
    <div ref={wrap} className={s.menuWrap} data-city-menu="">
      <button
        className={`${s.panel} ${s.iconBtn} ${open || settings ? s.iconOn : ''}`}
        aria-label={w.menu}
        aria-expanded={open || settings}
        aria-controls={settings ? SETTINGS_ID : MENU_ID}
        onClick={() => (settings ? useHudPanels.getState().closeSettings() : useHudPanels.getState().toggleMenu())}
      >
        <MenuGlyph />
      </button>
      {open && <MenuPanel onSound={onSound} onClose={useHudPanels.getState().closeMenu} />}
      {settings && <SettingsPanel />}
    </div>
  );
}

function MenuPanel({ onSound, onClose }: { onSound: (on: boolean) => void; onClose: () => void }) {
  const sound = useCity((st) => st.sound);
  const w = useWords(MENU);
  return (
    <div id={MENU_ID} className={`${s.panel} ${s.menu}`} role="dialog" aria-label={w.menu}>
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
          howStore.getState().show();
        }}
      >
        <span>{w.how}</span>
        <span className={s.menuChevron} aria-hidden="true" />
      </button>
      <button className={s.menuRow} aria-haspopup="dialog" aria-controls={SETTINGS_ID} onClick={() => useHudPanels.getState().openSettings()}>
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
      <div className={s.menuLinks}>
        {LINKS.map((l) => (
          <a key={l.href} className={s.menuLink} href={l.href} target="_blank" rel="noopener">
            <span className={s.menuLinkName}>
              {w[l.label]}
              <ArrowGlyph />
            </span>
            <span className={s.menuLinkLine}>{w[l.line]}</span>
          </a>
        ))}
      </div>
      <div className={s.menuLegal}>
        {LEGAL.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noopener">
            {w[l.label]}
          </a>
        ))}
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

/**
 * «Show on home», opened from the menu: what the event
 * feed shows, the two cards above the dock, and the flashing. Each switch is kept on this device.
 */
function SettingsPanel() {
  const settings = useFeed((st) => st.settings);
  const flip = useFeed((st) => st.set);
  const w = useWords(MENU);
  const feedWords = useWords(FEED_SWITCHES);
  useEffect(() => hydrateFeed(), []);
  const label = (id: FeedSwitch) => feedWords[id];
  return (
    <div id={SETTINGS_ID} className={`${s.panel} ${s.menu} ${s.settings}`} role="dialog" aria-labelledby={`${SETTINGS_ID}-title`} data-city-settings="">
      <div className={s.settingsHead}>
        <span className={s.settingsTitle} id={`${SETTINGS_ID}-title`}>
          {w.showOnHome}
        </span>
        <button className={s.settingsClose} aria-label={w.close} onClick={() => useHudPanels.getState().closeSettings()}>
          <CloseGlyph />
        </button>
      </div>
      {SETTINGS_GROUPS.map((group) => (
        <div className={s.settingsGroup} key={group.join()}>
          {group.map((id) => (
            <div className={s.settingsRow} key={id}>
              <span id={`${SETTINGS_ID}-${id}`}>{label(id)}</span>
              <button className={s.switch} role="switch" aria-checked={settings[id]} aria-labelledby={`${SETTINGS_ID}-${id}`} onClick={() => flip(id, !settings[id])}>
                <span className={s.knob} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
