'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { useHudPanels } from '@/city/lib/city/windows';
import { useWords } from '@/city/lib/i18n/dict';
import { underWindow } from '@/city/lib/lens/cover';
import { LENSES, type LensId } from '@/city/lib/lens/lens';
import { startNewLaunches, useNewLaunches } from '@/city/lib/lens/new-store';
import { useLens } from '@/city/lib/lens/store';
import { cityAccount } from '@/city/lib/quarter/account-live';
import { SPOT_OPEN } from '@/city/lib/trade/gates';
import { useMine } from '@/city/lib/trade/mine-store';
import { useSpot } from '@/city/lib/trade/spot-store';
import { stopView } from '@/city/lib/trade/stops';
import { useWallet } from '@/city/lib/trade/wallet';
import { framesIn } from '@/city/lib/window/layout';
import { useWindows } from '@/city/lib/window/store';
import { LENS, NEW_WORDS } from '@/city/lib/lens/words';
import { ListGlyph, RingsGlyph } from './glyphs';
import { NewList } from './NewList';
import { useLensSet } from './useLensSet';
import s from './lens.module.css';

/** How long a tap on «Mine» waits for the wallet it opened. */
const MINE_WAIT_MS = 120_000;

/**
 * The Lens (CITY-86): a row of chips centred in the top bar — on a phone a strip under it that scrolls sideways — that
 * picks the kind of tower to look at. The picked chip says how many towers it found; the city does the rest. «Mine»
 * with no wallet here opens the wallet first and lights once it is connected; with one, it lights your towers and opens
 * your coins and orders under the bar — the one place for them.
 * «New» picked grows a toggle beside it: the three rings over the city, or the same launches of all Solana as a list
 * (CITY-142) — the city's window «New launches on Solana» since CITY-191.
 */
export function LensBar() {
  const lens = useLens((st) => st.lens);
  const ready = useLens((st) => st.ready);
  const pick = useLens((st) => st.pick);
  const connected = useWallet((st) => !!st.connection);
  // A stop that fired waits on «Mine» as one quiet dot.
  const reached = useSpot((st) => (SPOT_OPEN ? st.stops.some((stop) => stopView(stop, Date.now()) === 'reached') : false));
  // Whether «Mine»'s list was open when the chip was pressed: the tap closes it then, instead of opening it again.
  const wasOpen = useRef(false);
  const { set } = useLensSet();
  const w = useWords(LENS);
  const nw = useWords(NEW_WORDS);
  const list = useNewLaunches((st) => st.list);
  const row = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const place = usePlace(nav, row);
  // The phone's strip steps away under the open menu, so its chips never read through the menu's rows (CITY-188).
  const menuOpen = useHudPanels((st) => st.menu);
  // The strip under a window that covers most of it steps aside, never a sliver over the window's edge (CITY-243).
  const covered = useUnderWindow(row, place === null);
  // A strip wider than the screen fades at its edge (CITY-188).
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const strip = nav.current;
    if (place !== null || !strip) return setOverflows(false);
    const measure = () => setOverflows(strip.scrollWidth > strip.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    if (row.current) observer.observe(row.current);
    return () => observer.disconnect();
  }, [place]);
  useEffect(() => {
    useLens.getState().hydrate();
    // Every new launch of Solana, read once the city is up: the Docks fill, «New» has its rings (CITY-142).
    startNewLaunches();
  }, []);
  // The picked chip stays in view on a phone's strip — with «New»'s toggle beside it.
  useEffect(() => {
    const show = () => {
      const picked = row.current?.querySelector<HTMLElement>('[data-lens-list-toggle]') ?? row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      picked?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    show();
    // The toggle grows in over a quarter second: in view once it has its width.
    const toggle = row.current?.querySelector<HTMLElement>('[data-lens-list-toggle]');
    toggle?.addEventListener('animationend', show, { once: true });
    const timer = toggle ? setTimeout(show, 600) : null;
    return () => {
      toggle?.removeEventListener('animationend', show);
      if (timer) clearTimeout(timer);
    };
  }, [lens, ready]);
  // «Mine» with no wallet here opens the wallet and waits for it: the chip lights once there is a wallet to read, never
  // as an empty «Mine» over a city that has nothing to show.
  const waiting = useRef(0);
  useEffect(() => {
    if (connected && waiting.current && Date.now() - waiting.current < MINE_WAIT_MS) {
      pick('mine');
      useMine.setState({ open: true });
    }
    waiting.current = 0;
  }, [connected, pick]);
  const choose = (id: LensId) => {
    if (useCity.getState().sound) playTick();
    if (id === 'mine' && !connected) {
      waiting.current = Date.now();
      void cityAccount.getState().begin(null, 'top');
      return;
    }
    pick(id);
    if (id !== 'new') useNewLaunches.getState().setList(false);
    // Pressed by a pointer, the list closed on the press already (MinePanel); by a key, it is still open.
    const was = wasOpen.current || useMine.getState().open;
    wasOpen.current = false;
    if (id === 'mine') useMine.setState({ open: !was });
    else useMine.getState().close();
  };
  return (
    <nav
      ref={nav}
      className={`${s.lens} ${place === null ? s.below : s.inline} ${place === null && overflows ? s.overflows : ''} ${place === null && menuOpen ? s.away : ''} ${covered ? s.covered : ''}`}
      style={place === null ? undefined : ({ '--lens-x': `${place}px` } as CSSProperties)}
      aria-label={w.label}
      data-city-lens=""
      data-lens-place={place === null ? 'below' : 'inline'}
    >
      <div className={s.row} ref={row}>
        {LENSES.map((id) => {
          const on = ready && lens === id;
          return (
            <Fragment key={id}>
              <button
                type="button"
                className={`${s.chip} ${on ? s.on : ''}`}
                aria-pressed={on}
                onPointerDown={() => (wasOpen.current = id === 'mine' && useMine.getState().open)}
                onClick={() => choose(id)}
                data-lens={id}
              >
                <span>{w[id]}</span>
                {id === 'mine' && reached && <span className={s.alert} aria-hidden="true" />}
                {/* Every picked chip, «All» too, carries its count in a slot of one width: the row never shifts in the bar. */}
                {on && <span className={s.count}>{set.length}</span>}
              </button>
              {/* «New» picked: the rings over the city, or the same launches as a list — one toggle, grown beside the chip. */}
              {id === 'new' && on && (
                <button
                  type="button"
                  className={`${s.toggle} ${list ? s.toggleOn : ''}`}
                  aria-pressed={list}
                  aria-label={list ? nw.rings : nw.list}
                  onClick={() => {
                    if (useCity.getState().sound) playTick();
                    useNewLaunches.getState().setList(!list);
                  }}
                  data-lens-list-toggle=""
                >
                  {list ? <RingsGlyph /> : <ListGlyph />}
                </button>
              )}
            </Fragment>
          );
        })}
      </div>
      <NewList />
    </nav>
  );
}

/**
 * Whether the strip under the bar stands under a window of the desk (CITY-243): a window as wide as Spot or Earn opens
 * 5 px under the strip's top and covered all of it but a sliver over its own edge. Measured on the strip's capsule
 * against the windows' places; a window on the whole screen covers it too. Never on a phone: its windows are sheets.
 */
function useUnderWindow(row: RefObject<HTMLElement | null>, below: boolean): boolean {
  const layout = useWindows((st) => st.layout);
  const desk = useWindows((st) => st.desk);
  const [covered, setCovered] = useState(false);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || !below || !desk || (!layout.windows.length && !layout.full)) return setCovered(false);
    const measure = () => {
      const b = el.getBoundingClientRect();
      const box = { x: b.left, y: b.top, width: b.width, height: b.height };
      const over = layout.full ? [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }] : framesIn(layout).map((w) => w.rect);
      setCovered(underWindow(box, over));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [row, below, desk, layout]);
  return covered;
}

/** Room the row keeps from its neighbours in the bar. */
const AIR = 24;

/**
 * Where the row stands in the top bar: centred in the free stretch between the logo and the bar's other controls, with
 * air on both sides — its centre in pixels from the bar's left — or null when it does not fit and is a strip under the
 * bar. Measured, not guessed by the screen's width, because the controls change (a wallet's address, Ryntra's button,
 * the language).
 */
function usePlace(nav: RefObject<HTMLElement | null>, row: RefObject<HTMLElement | null>): number | null {
  const [place, setPlace] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = nav.current;
    const bar = el?.parentElement;
    if (!el || !bar || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const box = bar.getBoundingClientRect();
      const kids = [...bar.children].filter((kid): kid is HTMLElement => kid !== el && kid instanceof HTMLElement);
      const [brand, ...rest] = kids;
      const right = rest.map((kid) => kid.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      const from = brand ? brand.getBoundingClientRect().right : box.left;
      const to = right.length ? Math.min(...right.map((r) => r.left)) : box.right;
      const width = row.current?.scrollWidth ?? Infinity;
      if (width + AIR * 2 > to - from) return setPlace(null);
      // As near the bar's own centre as the stretch allows.
      const half = width / 2 + AIR;
      const centre = Math.min(Math.max(box.left + box.width / 2, from + half), to - half);
      setPlace(Math.round(centre - box.left));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    for (const kid of bar.children) if (kid !== el) observer.observe(kid);
    if (row.current) observer.observe(row.current);
    // A control that comes or goes (the wallet connecting) changes the children, not only their sizes.
    const mutations = new MutationObserver(() => {
      for (const kid of bar.children) if (kid !== el) observer.observe(kid);
      measure();
    });
    mutations.observe(bar, { childList: true });
    measure();
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [nav, row]);
  return place;
}
