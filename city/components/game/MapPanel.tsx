'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { GAME_WORDS } from '@/city/lib/game/layer';
import { useWords, type TextKey } from '@/city/lib/i18n/dict';
import { districtViews, mapPoint, spreadLabels, topMovers, useGameMap } from '@/city/lib/game/map';
import type { District } from '@/city/lib/market/types';
import { signed, sym, TokenIcon } from '../hud/bits';
import { CloseGlyph } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import g from './game.module.css';

/** The map's own square, in its drawing units: the island and a ring of water around it. */
const SIZE = 200;
/** A name on the map, in pixels: its height, and its width from its letters (11 px capitals, the dot and the padding). */
const LABEL_H = 30;
const labelWidth = (text: string) => text.length * 9 + 32;
/** A district's name and its short form on the Map, by the dictionary's keys. */
const NAME: Readonly<Record<District, TextKey<typeof GAME_WORDS>>> = { core: 'nameCore', heights: 'nameHeights', strip: 'nameStrip', avenue: 'nameAvenue', docks: 'nameDocks' };
const SHORT: Readonly<Record<District, TextKey<typeof GAME_WORDS>>> = { core: 'shortCore', heights: 'shortHeights', strip: 'shortStrip', avenue: 'shortAvenue', docks: 'shortDocks' };
const DOT: Readonly<Record<District, string>> = {
  core: 'var(--amber)',
  heights: 'var(--violet)',
  strip: 'var(--mint)',
  avenue: 'var(--ice)',
  docks: 'var(--warm)',
};

/**
 * The Map (CITY-81): the live city from above — each tower a point where it stands, its size by its height — and the
 * districts named on it. A district's name flies the camera over it; a mover below flies to that tower. The camera
 * only: no card opens, nothing is bought.
 */
export function MapPanel() {
  const layout = useCity((st) => st.layout);
  const view = useGameMap((st) => st.view);
  const radius = layout.islandRadius + 6;
  const w = useWords(GAME_WORDS);
  // The names in the language on screen: the map's own names are only the English fallback.
  const districts = useMemo(() => districtViews(layout).map((d) => ({ ...d, name: w[NAME[d.id]], short: w[SHORT[d.id]] })), [layout, w]);
  const movers = useMemo(() => topMovers(layout), [layout]);
  const tallest = useMemo(() => Math.max(1, ...layout.towers.map((t) => t.height)), [layout]);
  // The island's size on this screen, so the names are spread apart in the pixels they take.
  const island = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(240);
  useEffect(() => {
    const el = island.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => setPx(el.clientWidth || 240));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const places = useMemo(
    () =>
      spreadLabels(
        districts.map((d) => {
          const p = mapPoint(d.x, d.z, radius, px);
          return { left: p.left, top: p.top, width: labelWidth(d.short), height: LABEL_H };
        }),
        px,
      ),
    [districts, radius, px],
  );
  const looking = (ids: readonly string[]) => !!view && view.ids.length === ids.length && view.ids.every((id, i) => id === ids[i]);
  const fly = (ids: readonly string[]) => {
    if (useCity.getState().sound) playTick();
    useCity.getState().select(null);
    useGameMap.getState().look(ids);
    // A phone held upright: the Map stands over the lower half of the city, so it gives the view to the flight.
    if (window.matchMedia?.('(max-aspect-ratio: 1/1)').matches) useGameMap.getState().close();
  };
  return (
    <div className={`${s.panel} ${s.slot} ${g.map}`} role="region" aria-label={w.map} data-game-map="">
      <div className={g.mapHead}>
        <span className={s.kicker}>{w.map}</span>
        <button type="button" className={g.mapClose} aria-label={w.close} onClick={() => useGameMap.getState().close()}>
          <CloseGlyph />
        </button>
      </div>
      <div className={g.island} ref={island}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={g.islandArt} aria-hidden="true">
          <defs>
            <radialGradient id="game-map-sea" cx="50%" cy="50%" r="50%">
              <stop offset="0.82" stopColor="rgba(153,69,255,0.16)" />
              <stop offset="1" stopColor="rgba(153,69,255,0)" />
            </radialGradient>
          </defs>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} fill="url(#game-map-sea)" />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={(SIZE / 2) * (layout.islandRadius / radius)} className={g.shore} />
          {layout.towers.map((t) => {
            const p = mapPoint(t.x, t.z, radius, SIZE);
            return <circle key={t.tower.id} cx={p.left} cy={p.top} r={0.9 + 2.6 * (t.height / tallest)} fill={DOT[t.tower.district]} opacity={0.85} />;
          })}
        </svg>
        {districts.map((d, i) => {
          const p = places[i]!;
          return (
            <button
              key={d.id}
              type="button"
              className={g.place}
              style={{ left: p.left, top: p.top, ['--dot' as string]: DOT[d.id] }}
              aria-label={d.name}
              title={d.name}
              aria-pressed={looking(d.ids)}
              onClick={() => fly(d.ids)}
            >
              {d.short}
            </button>
          );
        })}
      </div>
      {movers.length > 0 && (
        <div className={g.movers} role="group" aria-label={w.movers}>
          {movers.map((m) => {
            const t = m.tower;
            return (
              <button key={t.id} type="button" className={g.mover} aria-pressed={looking([t.id])} onClick={() => fly([t.id])}>
                <TokenIcon t={t} className={g.moverIcon} />
                <span className={g.moverWords}>
                  <span className={g.moverSym}>{sym(t)}</span>
                  <span className={t.change24h >= 0 ? s.up : s.down}>{signed(t.change24h)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
