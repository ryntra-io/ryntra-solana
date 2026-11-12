'use client';

import { useEffect, useRef } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { hydrateTrade } from '@/city/lib/settings/trade';
import { SECTIONS, useSettingsView, type Section } from '@/city/lib/settings/view';
import { BellGlyph, BoltGlyph, GlobeGlyph, LayoutGlyph, ScreenGlyph, ShieldGlyph, SpeakerGlyph, WalletGlyph } from './glyphs';
import { NotifySection } from './NotifySection';
import { DisplaySection, LanguageSection, LayoutsSection, SecuritySection, SoundSection, TradingSection, WalletSection } from './Sections';
import { SETTINGS } from './words';
import s from './settings.module.css';

const ICON: Readonly<Record<Section, () => React.JSX.Element>> = {
  wallet: WalletGlyph,
  trading: BoltGlyph,
  notifications: BellGlyph,
  layouts: LayoutGlyph,
  language: GlobeGlyph,
  sound: SpeakerGlyph,
  display: ScreenGlyph,
  security: ShieldGlyph,
};

/**
 * The settings window's contents (CITY-87, `docs/research/ryntra-city-helm-2026-10-29/SPEC.md` §10): eight sections —
 * a rail on the side where the window is wide, a row of tabs over the section where it is narrow (a phone's sheet).
 * Every choice is kept at once, on this device; nothing here signs or moves money.
 */
export default function SettingsWindow({ onSound }: { onSound: (on: boolean) => void }) {
  const w = useWords(SETTINGS);
  const section = useSettingsView((st) => st.section);
  const body = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  useEffect(() => {
    hydrateTrade();
  }, []);
  // Another section starts at its top. A block, never the call's answer: a newer browser's scrollTo returns a promise.
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    // CITY-237: on a phone the sections are one row that scrolls sideways — the open section's tab comes to the row's
    // middle. «Notifications», opened from the menu or the bell's gear, stood cut by the sheet's edge («Сповіще»). The
    // row alone is moved: `scrollIntoView` would move every clipped ancestor too, the city's page among them.
    const row = rail.current;
    const tab = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row && tab && row.scrollWidth > row.clientWidth) {
      const at = tab.getBoundingClientRect();
      row.scrollLeft += at.left - row.getBoundingClientRect().left - (row.clientWidth - at.width) / 2;
    }
  }, [section]);
  return (
    <div className={s.root} data-city-settings="">
      <nav className={s.rail} aria-label={w.sections} ref={rail}>
        {SECTIONS.map((id) => {
          const Icon = ICON[id];
          return (
            <button key={id} type="button" className={`${s.railItem} ${section === id ? s.railOn : ''}`} aria-current={section === id ? 'page' : undefined} onClick={() => useSettingsView.getState().show(id)}>
              <Icon />
              <span>{w[id]}</span>
            </button>
          );
        })}
      </nav>
      <div className={s.body} ref={body}>
        {section === 'wallet' ? (
          <WalletSection />
        ) : section === 'trading' ? (
          <TradingSection />
        ) : section === 'notifications' ? (
          <NotifySection />
        ) : section === 'layouts' ? (
          <LayoutsSection />
        ) : section === 'language' ? (
          <LanguageSection />
        ) : section === 'sound' ? (
          <SoundSection onSound={onSound} />
        ) : section === 'display' ? (
          <DisplaySection />
        ) : (
          <SecuritySection />
        )}
      </div>
    </div>
  );
}
