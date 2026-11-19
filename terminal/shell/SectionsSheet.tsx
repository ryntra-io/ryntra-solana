'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { Icon } from '@/terminal/ui';
import { closePanel, MENU_SHEET, useFrame } from './frame';
import { More } from './More';
import { isOuter, itemHref, MARKET_ITEM, type MenuGroup, type MenuItem, type MenuItemId } from './menu';
import { groupOpen, toggleGroup, useMenuChoice } from './menu-fold';
import { MenuIcon } from './menu-icons';
import { useBotsWorking } from './bots-count';
import { handTo, useMenu } from './Rail';
import { CITY_PATH, type View } from './shelves';
import { isSheetEntry, pullCloses, PULL_SLOP_PX, sheetEntry, withoutSheet } from './sheet-moves';
import { WalletPanel, cancelWallet } from './Wallet';
import { MENU_WORDS, SHELL } from './words';
import s from './shell.module.css';

/** How long the sheet takes to go: the frame's sheet pace (DESIGN.md `motion.sheet`). */
const LEAVE_MS = 200;

/**
 * The phone's menu, opened by the menu's button in the header: a sheet over the whole screen but a strip at its
 * top, with the wallet, the Market and the menu's groups — the same as the rail's (decision 109), folded but for the one
 * the person is in, each opened with a tap and remembered as the rail remembers it — then the city, the language and the
 * site's pages. The place the person is in is lit. It goes with its close control, a pull down, the phone's «Back», a tap
 * on the strip above it and Escape; it rises and leaves smoothly.
 */
export function SectionsSheet() {
  const open = useFrame((st) => st.panel === 'sheet');
  const { view, groups, marketOn, at } = useMenu();
  const bots = useBotsWorking();
  const w = useWords(SHELL);
  const names = useWords(MENU_WORDS);
  const router = useRouter();
  const sheet = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  // A page loaded on the sheet's entry (reloaded while the sheet was open): the entry keeps no mark of a sheet that is
  // not there — the page's own state stays, without a second load of the page. The entry under it stays a copy of this
  // page (Back from here loads it again): a step back now would load the page twice before the person did anything.
  useEffect(() => {
    if (useFrame.getState().panel === 'sheet') return;
    const state: unknown = window.history.state;
    if (isSheetEntry(state)) window.history.replaceState(withoutSheet(state), '');
  }, []);
  // Still drawn while it leaves.
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) return setPresent(true);
    if (!present) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setPresent(false);
    const timer = window.setTimeout(() => setPresent(false), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useEffect(() => {
    if (!open) return;
    // The keyboard's stops: a choice that keeps one stop for its group (the language) is reached through that one.
    const stops = () => Array.from(sheet.current?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), [tabindex="0"]') ?? []);
    stops()[0]?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void closeSheet();
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
    // The phone's «Back» closes the sheet: it stands on an entry of the history of its own, the same address.
    window.history.pushState(sheetEntry(window.history.state), '');
    const back = () => closePanel('sheet');
    window.addEventListener('popstate', back);
    const box = sheet.current;
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('popstate', back);
      // Closed by anything that did not give its entry back (the agent's keys, another panel): given back here.
      if (!returning && isSheetEntry(window.history.state)) void giveBack();
      // However the sheet goes — its close, a move to another screen, Back, the agent's keys — a list of wallets it left
      // open goes with it, and the keyboard returns to the menu's button only if it was still in the sheet.
      cancelWallet();
      if (box?.contains(document.activeElement)) document.querySelector<HTMLElement>('[data-terminal="menu-button"]')?.focus({ preventScroll: true });
    };
  }, [open]);

  // A pull down — on the head, or on the list at its top — follows the finger and takes the sheet away.
  useEffect(() => {
    const box = sheet.current;
    const list = scroll.current;
    if (!open || !box || !list) return;
    // Opened again while it was still leaving a pull: it rises from its own place, not from where the finger let it go.
    box.style.transition = '';
    box.style.transform = '';
    let from = 0;
    let since = 0;
    let pulled = 0;
    let watching = false;
    let pulling = false;
    let settling: number | null = null;
    const settle = () => {
      settling = null;
      box.style.transition = '';
      box.style.transform = '';
    };
    const down = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      // A new pull while the last one settles back: the settle's end does not snap the new one to its place.
      if (settling !== null) window.clearTimeout(settling);
      settling = null;
      watching = !list.contains(event.target as Node) || list.scrollTop <= 0;
      pulling = false;
      from = event.touches[0].clientY;
      since = performance.now();
      pulled = 0;
    };
    const move = (event: TouchEvent) => {
      if (!watching) return;
      const dy = event.touches[0].clientY - from;
      if (!pulling) {
        // Up, or the list scrolled meanwhile: the list's own scroll, not a pull.
        if (dy < -PULL_SLOP_PX || (list.contains(event.target as Node) && list.scrollTop > 0)) {
          watching = false;
          return;
        }
        if (dy < PULL_SLOP_PX) return;
        pulling = true;
        box.style.transition = 'none';
      }
      event.preventDefault();
      pulled = Math.max(0, dy - PULL_SLOP_PX);
      box.style.transform = `translateY(${pulled}px)`;
    };
    const up = () => {
      if (!watching) return;
      watching = false;
      if (!pulling) return;
      pulling = false;
      if (pullCloses(pulled, performance.now() - since)) {
        // It leaves from where the finger let it go.
        box.style.transition = '';
        void closeSheet();
        return;
      }
      box.style.transition = 'transform 0.2s ease-out';
      box.style.transform = '';
      settling = window.setTimeout(settle, LEAVE_MS);
    };
    box.addEventListener('touchstart', down, { passive: true });
    box.addEventListener('touchmove', move, { passive: false });
    box.addEventListener('touchend', up);
    box.addEventListener('touchcancel', up);
    return () => {
      if (settling !== null) window.clearTimeout(settling);
      box.removeEventListener('touchstart', down);
      box.removeEventListener('touchmove', move);
      box.removeEventListener('touchend', up);
      box.removeEventListener('touchcancel', up);
    };
  }, [open]);

  // A screen of the terminal: the sheet goes and gives its entry back first, then the screen opens — «Back» from it
  // returns to the page the menu was opened on.
  const go = (item: MenuItem, event: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    const href = itemHref(item, view);
    void closeSheet().then((back) => {
      // The screen in front, another tab of it: its top comes into view, once the step back has restored the scroll.
      handTo(item, view);
      // The step back never landed: the screen takes the sheet's entry instead of stacking on it.
      if (back) router.push(href);
      else router.replace(href);
    });
  };

  // A page of this site loaded whole (the city, the docs, help, «About»): the same order — the entry back, then the page.
  const leave = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !plainClick(event)) return;
    const link = (event.target as Element).closest?.('a[href]');
    if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    // Another site — a wallet's own app above all — opens from the tap itself: a phone hands an app link over only then.
    if (link.origin !== window.location.origin) return;
    event.preventDefault();
    const href = link.href;
    void closeSheet().then((back) => (back ? window.location.assign(href) : window.location.replace(href)));
  };

  if (!open && !present) return null;
  const leaving = !open;
  return (
    <>
      <div className={s.scrim} data-leaving={leaving ? '' : undefined} aria-hidden="true" onClick={() => void closeSheet()} />
      <div
        ref={sheet}
        id={MENU_SHEET}
        className={s.sheet}
        data-terminal="menu-sheet"
        data-leaving={leaving ? '' : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={w.menu}
      >
        <div className={s.sheetHead}>
          <span className={s.sheetTitle}>{w.menu}</span>
          <button type="button" className={s.closeBtn} aria-label={w.close} onClick={() => void closeSheet()}>
            <Icon name="close" size="l" />
          </button>
        </div>
        <div ref={scroll} className={s.sheetScroll} data-terminal="sheet-scroll" onClick={leave}>
          <WalletPanel inSheet />
          {marketOn ? (
            // The Market above the groups, as on the rail: a row of the list, lit while the person is on it.
            <Link className={s.sheetMarket} href={itemHref(MARKET_ITEM, view)} aria-current={at === 'market' ? 'page' : undefined} onClick={(event) => go(MARKET_ITEM, event)}>
              <span className={s.ghIcon}>
                <MenuIcon name="market" />
              </span>
              <span className={s.ghName}>{names.market}</span>
            </Link>
          ) : null}
          {groups.map((group) => (
            <SheetGroup key={group.id} group={group} view={view} at={at} count={group.count === 'bots' ? bots : 0} go={go} />
          ))}
          <a className={s.door} href={CITY_PATH}>
            <Icon name="city" />
            <span>{w.city}</span>
            <Icon name="arrow" size="s" />
          </a>
          <div className={s.sheetSep} />
          <More />
        </div>
      </div>
    </>
  );
}

/** One group of the sheet: its name — a tap opens or folds it — and its items, two a row. */
function SheetGroup({
  group,
  view,
  at,
  count,
  go,
}: {
  group: MenuGroup;
  view: View;
  at: MenuItemId | null;
  count: number;
  go: (item: MenuItem, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const names = useWords(MENU_WORDS);
  const lang = useLang();
  const choice = useMenuChoice();
  const lit = group.items.some((item) => item.id === at);
  const open = groupOpen(group.id, lit, choice);
  const list = `sheet-${group.id}`;
  const working = count > 0 ? names.working(digits(String(count), lang)) : null;
  return (
    <section className={s.sheetGroup} data-open={open ? '' : undefined} data-lit={lit ? '' : undefined}>
      <button type="button" className={s.sheetGroupName} aria-expanded={open} aria-controls={list} aria-label={[names[group.id], working].filter(Boolean).join(', ')} onClick={() => toggleGroup(group.id, lit)}>
        <span className={s.ghIcon}>
          <MenuIcon name={`group-${group.id}`} />
        </span>
        <span className={s.ghName}>{names[group.id]}</span>
        {count > 0 ? (
          <span className={s.run} aria-hidden="true">
            <i className={s.live} />
            {digits(String(count), lang)}
          </span>
        ) : null}
        <span className={s.ghArrow}>
          <Icon name="chevron" size="s" />
        </span>
      </button>
      {open ? (
        <div className={s.sheetItems} id={list} role="group" aria-label={names[group.id]}>
          {group.items.map((item) =>
            isOuter(item) ? (
              // Another site: its name, where it opens, and the arrow out.
              <a key={item.id} className={`${s.door} ${s.tile}`} href={item.out} target="_blank" rel="noopener noreferrer" aria-label={names.elsewhere(names[item.id])}>
                <MenuIcon name={item.id} />
                <span className={s.tileWords}>
                  <span>{names[item.id]}</span>
                  <span className={s.tileWhere} aria-hidden="true">
                    {hostOf(item.out)}
                  </span>
                </span>
                <MenuIcon name="out" small />
              </a>
            ) : (
              <Link key={item.id} className={`${s.door} ${s.tile}`} href={itemHref(item, view)} aria-current={item.id === at ? 'page' : undefined} onClick={(event) => go(item, event)}>
                <MenuIcon name={item.id} />
                <span>{names[item.id]}</span>
              </Link>
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}

/** The site an outside item opens: `rxn.gg`. */
function hostOf(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./, '');
  } catch {
    return href;
  }
}

/** A press that opens a link here: the main button, no key held (those open a new tab or window). */
function plainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** A step back of the sheet's own on its way. */
let returning = false;

/** How long a step back may take before the sheet stops waiting for it (as the city's back stack waits). */
const TRAVEL_MS = 1_000;

/**
 * The sheet's entry of the history given back. Resolves once the page stands on the entry under it — true — or, if the
 * step never landed in time, false: whatever opens next then takes the sheet's entry rather than stacking on it.
 */
function giveBack(): Promise<boolean> {
  if (returning || !isSheetEntry(window.history.state)) return Promise.resolve(true);
  returning = true;
  return new Promise((done) => {
    const landed = () => {
      window.removeEventListener('popstate', landed);
      window.clearTimeout(timer);
      returning = false;
      done(!isSheetEntry(window.history.state));
    };
    const timer = window.setTimeout(landed, TRAVEL_MS);
    window.addEventListener('popstate', landed);
    window.history.back();
  });
}

/** The sheet put away, its entry of the history with it (the list of wallets it left open closes in the effect above). */
function closeSheet(): Promise<boolean> {
  closePanel('sheet');
  return giveBack();
}
