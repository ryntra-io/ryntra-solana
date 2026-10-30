'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { LENSES, type LensId } from '@/city/lib/lens/lens';
import { useLens } from '@/city/lib/lens/store';
import { cityAccount } from '@/city/lib/quarter/account-live';
import { SPOT_OPEN } from '@/city/lib/trade/gates';
import { useMine } from '@/city/lib/trade/mine-store';
import { useSpot } from '@/city/lib/trade/spot-store';
import { stopView } from '@/city/lib/trade/stops';
import { useWallet } from '@/city/lib/trade/wallet';
import { LENS } from '@/city/lib/lens/words';
import { useLensSet } from './useLensSet';
import s from './lens.module.css';

/** How long a tap on «Mine» waits for the wallet it opened. */
const MINE_WAIT_MS = 120_000;

/**
 * The Lens (CITY-86): a row of chips centred in the top bar — on a phone a strip under it that scrolls sideways — that
 * picks the kind of tower to look at. The picked chip says how many towers it found; the city does the rest. «Mine»
 * with no wallet here opens the wallet first and lights once it is connected; with one, it lights your towers and opens
 * your coins and orders under the bar — the one place for them.
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
  const row = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const place = usePlace(nav, row);
  useEffect(() => useLens.getState().hydrate(), []);
  // The picked chip stays in view on a phone's strip.
  useEffect(() => {
    row.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    // Pressed by a pointer, the list closed on the press already (MinePanel); by a key, it is still open.
    const was = wasOpen.current || useMine.getState().open;
    wasOpen.current = false;
    if (id === 'mine') useMine.setState({ open: !was });
    else useMine.getState().close();
  };
  return (
    <nav
      ref={nav}
      className={`${s.lens} ${place === null ? s.below : s.inline}`}
      style={place === null ? undefined : ({ '--lens-x': `${place}px` } as CSSProperties)}
      aria-label={w.label}
      data-city-lens=""
    >
      <div className={s.row} ref={row}>
        {LENSES.map((id) => {
          const on = ready && lens === id;
          return (
            <button
              key={id}
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
          );
        })}
      </div>
    </nav>
  );
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
