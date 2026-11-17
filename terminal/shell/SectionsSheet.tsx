'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { Icon } from '@/terminal/ui';
import { closePanel, useFrame, useWhere } from './frame';
import { More } from './More';
import { CITY_PATH, PHONE_SHEET, shelfHref, shelfOn } from './shelves';
import { WalletPanel, cancelWallet } from './Wallet';
import { SHELF_WORDS, SHELL } from './words';
import s from './shell.module.css';

/**
 * The phone's sections sheet, opened by the mark in its header: the wallet, the shelves that have no tab — Futures,
 * Predictions, Launch, each once it is on — the city, the language and the site's pages. A tap on the shade, the
 * close control or Escape puts it away.
 */
export function SectionsSheet() {
  const open = useFrame((st) => st.panel === 'sheet');
  const { view } = useWhere();
  const names = useWords(SHELF_WORDS);
  const w = useWords(SHELL);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // The keyboard's stops: a choice that keeps one stop for its group (the language) is reached through that one.
    const stops = () => Array.from(sheet.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), [tabindex="0"]') ?? []);
    stops()[0]?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      // A modal sheet: Tab walks its own controls, round and round.
      if (event.key !== 'Tab') return;
      const all = stops();
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : at === all.length - 1 ? 0 : at + 1;
      event.preventDefault();
      all[next]?.focus();
    };
    window.addEventListener('keydown', key);
    const box = sheet.current;
    return () => {
      window.removeEventListener('keydown', key);
      // However the sheet goes — its close, a move to another screen, Back, the agent's keys — a list of wallets it left
      // open goes with it, and the keyboard returns to the mark only if it was still in the sheet.
      cancelWallet();
      if (box?.contains(document.activeElement)) document.querySelector<HTMLElement>('[data-terminal="mark"]')?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  const shelves = PHONE_SHEET.filter((id) => view === 'preview' || shelfOn(id));
  return (
    <>
      <div className={s.scrim} aria-hidden="true" onClick={closeSheet} />
      <div ref={sheet} className={s.sheet} role="dialog" aria-modal="true" aria-label={w.allSections}>
        <div className={s.sheetHead}>
          <span className={s.sheetTitle}>{w.allSections}</span>
          <button type="button" className={s.closeBtn} aria-label={w.close} onClick={closeSheet}>
            <Icon name="close" />
          </button>
        </div>
        <WalletPanel inSheet />
        {shelves.map((id) => (
          <Link key={id} className={s.door} href={shelfHref(id, view)}>
            <Icon name={id} />
            <span>{names[id]}</span>
            <Icon name="arrow" size="s" />
          </Link>
        ))}
        <a className={s.door} href={CITY_PATH}>
          <Icon name="city" />
          <span>{w.city}</span>
          <Icon name="arrow" size="s" />
        </a>
        <div className={s.sheetSep} />
        <More />
      </div>
    </>
  );
}

/** The sheet put away (the list of wallets it left open closes with it, in the effect above). */
function closeSheet(): void {
  closePanel('sheet');
}
