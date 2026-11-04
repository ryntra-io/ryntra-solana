'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { CITY_GUIDE_FLAGS, tryParam, withoutTry, type GuideId } from '@/city/lib/how/guides';
import { useGuides } from '@/city/lib/how/store';
import { CITY_LAUNCH_SWITCH } from '@/city/lib/launch/gate';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useCityWindow } from '../window/useCityWindow';
import { PlayGlyph } from './glyphs';
import g from './guides.module.css';
import { ON_A_TOWER, tryGuide } from './try';
import { useLessons } from './useLessons';
import { GUIDE_WORDS } from './words';

// The lessons load the first time the window opens: the city's first frame carries none of them.
const GuidesBody = dynamic(() => import('./GuidesBody'), { ssr: false, loading: () => <div className={g.pending} aria-busy="true" /> });

const renderGuides = () => <GuidesBody />;
const closeGuides = () => useGuides.getState().hide();

/**
 * «How it works» (CITY-43) in the city's one window frame (CITY-65): a window on a computer, the bottom sheet on a
 * phone. Opened from the menu (☰), only while there is a lesson to show. It also opens the window `?try=<id>` asks for
 * — the page's own «Try» (`/how-it-works`) — once the city stands.
 */
export function GuidesLayer() {
  const open = useGuides((st) => st.open);
  const count = useLessons().length;
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const title = useWords(GUIDE_WORDS).title;
  const shown = open && count > 0 && !(running || filming);

  useEffect(() => {
    if (!shown) return;
    const key = (event: KeyboardEvent) => {
      // A lesson on the whole screen takes this Escape itself.
      if (event.key !== 'Escape' || event.defaultPrevented || document.fullscreenElement) return;
      event.preventDefault();
      useGuides.getState().hide();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [shown]);

  const spec = useMemo(
    () => ({
      id: 'guides',
      title,
      icon: <PlayGlyph />,
      render: renderGuides,
      size: { width: 560, height: 700 },
      min: { width: 340, height: 440 },
      onClose: closeGuides,
    }),
    // A new language is a new title: the open window's head follows it.
    [title],
  );
  useCityWindow(shown, spec);
  return <TryFromAddress />;
}

/**
 * `?try=<id>`: the function's window opens once the city stands (a tower to try it on), and the address forgets the
 * ask at once, so a reload is the plain city. A function that is not live here is ignored. Launch is asked of the
 * district itself, which opens its sheet only on the network where Launch is open.
 */
function TryFromAddress() {
  const [asked] = useState<GuideId | null>(() => {
    if (typeof window === 'undefined') return null;
    return tryParam(window.location.search, { ...CITY_GUIDE_FLAGS, launch: CITY_LAUNCH_SWITCH });
  });
  const towers = useCity((st) => st.layout.towers.length);
  const done = useRef(false);
  useEffect(() => {
    if (!asked) return;
    history.replaceState(history.state, '', withoutTry(location.pathname, location.search, location.hash));
  }, [asked]);
  useEffect(() => {
    if (!asked || done.current) return;
    if (ON_A_TOWER.has(asked) && !towers) return;
    done.current = tryGuide(asked);
  }, [asked, towers]);
  return null;
}
