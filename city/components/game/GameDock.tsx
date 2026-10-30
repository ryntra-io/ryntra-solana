'use client';

import type { ReactNode } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { shownItems, GAME_ITEMS, GAME_WORDS, type GameItem } from '@/city/lib/game/layer';
import { useGameMap } from '@/city/lib/game/map';
import { RING_OPEN } from '@/city/lib/ring/flag';
import { RUN_OPEN } from '@/city/lib/run/flag';
import { QuarterCard } from '../quarter/QuarterCard';
import { HallDockItem } from '../launch/HallDockItem';
import { VaultDockItem } from '../vault/VaultDockItem';
import { HomeGlyph, RunGlyph } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import { MapGlyph, RingGlyph } from './glyphs';
import { MapPanel } from './MapPanel';
import { goQuarter, goRing } from './play';

const tick = () => {
  if (useCity.getState().sound) playTick();
};

/**
 * The dock in Play (CITY-81): My quarter, the Ring, the Vault, the Hall, the Run and the Map — each only once its switch
 * is open; a closed one is not drawn at all. The Vault and the Hall bring their own items, which stand only when open.
 */
export function GameDock({ onRun }: { onRun: () => void }) {
  const map = useGameMap((st) => st.open);
  const w = useWords(GAME_WORDS);
  const items = shownItems(GAME_ITEMS, { quarter: true, ring: RING_OPEN, vault: true, hall: true, run: RUN_OPEN, map: true });
  const item: Record<GameItem, () => ReactNode> = {
    quarter: () => <Item key="quarter" label={w.quarter} short={w.home} glyph={<HomeGlyph />} hint={w.quarterHint} onClick={goQuarter} />,
    ring: () => <Item key="ring" label={w.ring} glyph={<RingGlyph />} hint={w.ringHint} onClick={goRing} />,
    vault: () => <VaultDockItem key="vault" />,
    hall: () => <HallDockItem key="hall" />,
    run: () => <Item key="run" label={w.run} glyph={<RunGlyph />} hint={w.runHint} onClick={onRun} />,
    map: () => <Item key="map" label={w.map} glyph={<MapGlyph />} hint={w.mapHint} on={map} onClick={() => useGameMap.getState().toggle()} />,
  };
  return (
    <nav className={s.dock} aria-label={w.play}>
      {items.map((id) => item[id]())}
    </nav>
  );
}

/** One item: its name for the screen reader, and on the dock the same or, where it would not fit, its short form. */
function Item({ label, short, glyph, hint, on, onClick }: { label: string; short?: string; glyph: ReactNode; hint: string; on?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={[s.dockItem, on && s.dockOn].filter(Boolean).join(' ')}
      aria-label={label}
      aria-pressed={on}
      data-hint={hint}
      onClick={() => {
        tick();
        onClick();
      }}
    >
      <span className={s.dockGlyph}>{glyph}</span>
      <span className={s.dockLabel}>{short ?? label}</span>
    </button>
  );
}

/** The card slot in Play: the Map while it is open, else your quarter's card when it is asked for or switched on. */
export function GameSlot() {
  const map = useGameMap((st) => st.open);
  return map ? <MapPanel /> : <QuarterCard hot={null} />;
}
