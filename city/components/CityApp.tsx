'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { quietInstall } from '@/city/lib/app-mode';
import { hydrateLang } from '@/city/lib/i18n/lang';
import { lookMode, type Look } from '@/city/lib/look';
import { MomentsLayer } from '@/city/lib/moments/MomentsLayer';
import { playMoment, prepareAudio, setMuted, startAudio } from '@/city/lib/audio/engine';
import { cityDrawn } from '@/city/lib/city/drawn';
import { ambient, diff, isStale, showcase, type EventDraft } from '@/city/lib/city/events';
import { useCity, useCityEvents } from '@/city/lib/city/store';
import type { CitySnapshot } from '@/city/lib/market/types';
import { RUN_OPEN } from '@/city/lib/run/flag';
import { useRun } from '@/city/lib/run/store';
import { track } from '@/city/lib/run/track';
import { Art } from './art/Art';
import { AssistantLayer } from './assistant/AssistantLayer';
import { ChartLayer } from './chart/ChartLayer';
import { HarborLayer } from './districts/HarborLayer';
import { MoneyLayer } from './money/MoneyLayer';
import { ScoutsLayer } from './scouts/ScoutsLayer';
import { PredictLayer } from './districts/PredictLayer';
import { ExchangeLayer } from './exchange/ExchangeLayer';
import { Hud } from './hud/Hud';
import { useBackLayers } from './hud/useBackLayers';
import { windowOpenNow } from './hud/useWindowOpen';
import { TradeLayer } from './trade/TradeLayer';
import { WindowLayer } from './window/WindowLayer';
import { QuarterLayer } from './quarter/QuarterLayer';
import { VaultLayer } from './vault/VaultLayer';
import { BeaconLayer } from './beacon/BeaconLayer';
import { HallLayer } from './launch/HallLayer';
import { OpenFromAddress } from './open/OpenFromAddress';

const CityCanvas = dynamic(() => import('./city/CityCanvas').then((m) => m.CityCanvas), { ssr: false });
// The concept screens of the steps still to build: development builds only, never in the production bundle.
const LookLayer = process.env.NODE_ENV === 'production' ? null : dynamic(() => import('./look/Look').then((m) => m.Look), { ssr: false });

const REFRESH_MS = 60_000;
const AMBIENT_MS = 26_000;
/** One moment owns the frame: the next waits at least this long. */
const MOMENT_GAP_MS = 6_500;

/**
 * Ryntra's home (decision 70): the bundled snapshot paints the city at once, the live read replaces it, and every
 * minute the difference between two reads becomes the city's moments. The visitor is in the city from the first
 * frame; sound starts only from a tap.
 */
export function CityApp({ initial }: { initial: CitySnapshot }) {
  const setSnapshot = useCity((s) => s.setSnapshot);
  const entered = useCity((s) => s.entered);
  const latest = useRef(initial);

  // Moments wait in line so only one plays at a time; the rest of the city stays calm around it,
  // and while a tower card or any window is open the line holds.
  const queue = useRef<EventDraft[]>([]);
  const play = useCallback((draft: EventDraft) => {
    if (queue.current.length < 4) queue.current.push(draft);
  }, []);
  useEffect(() => {
    let last = 0;
    const timer = setInterval(() => {
      // An open window owns the frame too: the line waits until it closes.
      if (!queue.current.length || Date.now() - last < MOMENT_GAP_MS || useCity.getState().selectedId || windowOpenNow()) return;
      // A run owns the frame: the city's moments wait, and stale ones are dropped.
      if (useRun.getState().phase !== 'off') {
        queue.current.length = 0;
        return;
      }
      last = Date.now();
      useCity.getState().play(queue.current.shift()!);
    }, 250);
    return () => clearInterval(timer);
  }, []);

  // The person's language before the first paint after hydration: the words repaint in it in the same frame (CITY-79).
  useLayoutEffect(() => void hydrateLang(), []);

  useEffect(() => {
    setSnapshot(initial);
  }, [initial, setSnapshot]);

  // During a run the city is today's frozen world (the course was planned in it); afterwards, the live city again.
  const running = useRun((s) => s.phase !== 'off');
  const world = useRun((s) => s.world);
  useEffect(() => {
    const shown = useCity.getState().snapshot.fetchedAt;
    // Swap the city only when the data really differs: rebuilding the skyline costs a few frames.
    if (running && world && world.fetchedAt !== shown) setSnapshot(world);
    else if (!running && latest.current.fetchedAt !== shown) setSnapshot(latest.current);
  }, [running, world, setSnapshot]);

  // Inside the Ryntra app the page never asks to be installed (docs/city/APP-BRIDGE.md).
  useEffect(() => quietInstall(), []);
  // «Back» closes the top window, sheet or panel; on the city's own view it leaves (CITY-6e).
  useBackLayers();

  useEffect(() => {
    useCity.getState().enter();
    // A touch screen or not: the report sets phone players apart from desktop ones.
    track({ ev: 'home', challenge: !!useRun.getState().challenge, touch: !!window.matchMedia?.('(pointer: coarse)').matches });
    // Assemble the score while the title screen is idle; the PLAY tap then only switches the sound on. It waits for the
    // city's first frame: on a phone the score's assembly would otherwise hold that frame back (CITY-6a).
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const go = () => void prepareAudio().catch(() => {});
    const wait = setInterval(() => {
      if (!cityDrawn()) return;
      clearInterval(wait);
      if (idle) idle(go, { timeout: 4000 });
      else setTimeout(go, 2500);
    }, 500);
    return () => clearInterval(wait);
  }, []);

  // Live reads.
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const res = await fetch('/api/city', { cache: 'no-store' });
        if (!res.ok) return;
        const next = (await res.json()) as CitySnapshot;
        if (!alive || !Array.isArray(next.towers) || !next.towers.length) return;
        const before = latest.current;
        latest.current = next;
        // Prices keep moving during a run, but the run's city stays frozen until it ends.
        if (useRun.getState().phase !== 'off') return;
        setSnapshot(next);
        // With the first live read, build today's course while the visitor looks at the city.
        if (RUN_OPEN && next.source === 'live' && before.source !== 'live') {
          const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
          if (idle) idle(() => useRun.getState().prepare());
          else setTimeout(() => useRun.getState().prepare(), 300);
        }
        if (useCity.getState().entered && before.source === 'live') for (const e of diff(before.towers, next.towers)) play(e);
      } catch {
        // The city keeps the last read; the top bar says SNAPSHOT when it is not live.
      }
    };
    void read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [play, setSnapshot]);

  // The opening show after entering, then a quiet-market moment every half minute.
  useEffect(() => {
    if (!entered) return;
    // Moments come only from live, fresh data: an old snapshot never plays as if it were happening now.
    const fresh = () => latest.current.source === 'live' && !isStale(latest.current.fetchedAt);
    const first = setTimeout(() => {
      if (fresh()) showcase(latest.current.towers).forEach(play);
    }, 2600);
    let turn = 0;
    const loop = setInterval(() => {
      if (Date.now() - (useCity.getState().feed[0]?.at ?? 0) < AMBIENT_MS * 0.8) return;
      if (!fresh()) return;
      const e = ambient(latest.current.towers, turn++);
      if (e) play(e);
    }, AMBIENT_MS);
    return () => {
      clearTimeout(first);
      clearInterval(loop);
    };
  }, [entered, play]);

  // Every moment has a sound.
  useCityEvents((e) => {
    if (useCity.getState().sound) playMoment(e.kind);
  });

  // RUN: the tap that starts the run also starts the sound (browsers need a tap), unless the visitor chose silence.
  const soundChosen = useRef(false);
  const startRun = (from: 'home' | 'city') => {
    if (!soundChosen.current) useCity.getState().setSound(true);
    if (useCity.getState().sound) void startAudio().then(() => setMuted(false));
    track({ ev: 'play', from, form: useRun.getState().challenge?.form ?? 'assigned' });
    useRun.getState().start(from);
  };

  const sound = (on: boolean) => {
    soundChosen.current = true;
    useCity.getState().setSound(on);
    if (on) void startAudio().then(() => setMuted(false));
    else setMuted(true);
  };

  // Development only: `?look=` shows the concept screens of the steps still to build instead of the HUD.
  const [look, setLook] = useState<Look | null>(null);
  useEffect(() => setLook(lookMode()), []);

  return (
    <>
      <CityCanvas />
      <Art />
      <MomentsLayer />
      {look && LookLayer ? <LookLayer mode={look} /> : <QuarterLayer onSound={sound}><Hud onPlay={startRun} onSound={sound} /></QuarterLayer>}
      <WindowLayer />
      <TradeLayer />
      <ChartLayer />
      <HarborLayer />
      <PredictLayer />
      <BeaconLayer />
      <VaultLayer />
      <HallLayer />
      <MoneyLayer />
      <ScoutsLayer />
      <ExchangeLayer />
      <AssistantLayer />
      <OpenFromAddress />
    </>
  );
}
