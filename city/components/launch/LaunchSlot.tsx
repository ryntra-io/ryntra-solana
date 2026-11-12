'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { launchOpenHere, launchTowerIn, startDistrict, useLaunch } from '@/city/lib/launch/district';
import { sheetClosable as closable } from '@/city/lib/launch/review-step';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { LaunchGlyph } from '../hud/glyphs';
import { top } from '@/city/lib/window/layout';
import { useWindows } from '@/city/lib/window/store';
import { useCityWindow } from '../window/useCityWindow';
import s from './launch.module.css';
import { LAUNCH } from './words';

/* The sheet and its wallet code load on the first tap of Launch, never with the city's first frame. */
const LaunchSheet = dynamic(() => import('./LaunchSheet').then((m) => m.LaunchSheet), {
  ssr: false,
  loading: () => <div className={s.framedLoading} aria-busy="true" />,
});

/* CITY-220: the people's early-access window loads only when a creator's link opens it. */
const EarlyEntry = dynamic(() => import('./EarlyEntry').then((m) => m.EarlyEntry), {
  ssr: false,
  loading: () => <div className={`${s.sheet} ${s.sheetLoading}`} aria-busy="true" />,
});

/**
 * The Launch district for the HUD: whether the dock's Launch opens here, whether the district owns the card slot now —
 * its sheet is open, or a launch's tower is picked (its Buy and Sell stand in the tower's one window, CITY-138) — and
 * the tap that opens it. A second tap closes the sheet, as Earn's and Money's do, unless a launch is under way.
 */
export function useLaunchDistrict(): Readonly<{ open: boolean; showing: boolean; start: () => void }> {
  useEffect(() => startDistrict(), []);
  const open = useLaunch(launchOpenHere);
  const sheet = useLaunch((st) => st.sheet);
  const entry = useLaunch((st) => st.entry !== null);
  const selectedId = useCity((st) => st.selectedId);
  const picked = useLaunch((st) => launchTowerIn(st, selectedId) !== null);
  return { open, showing: sheet || entry || picked, start: toggleSheet };
}

function toggleSheet(): void {
  const launch = useLaunch.getState();
  if (!launch.sheet) return launch.openSheet();
  // Standing behind another window: it comes to the front as it is — a launch just made keeps its card.
  if (top(useWindows.getState().layout)?.id !== 'launch') return useWindows.getState().raise('launch');
  if (closable(launch.phase)) launch.closeSheet();
}

/**
 * What the district shows in the card slot: an early launch's window for its people (CITY-220), opened by a creator's
 * link. The launch sheet is a window of the frame (`LaunchLayer`); a launch tower picked opens the tower's window
 * (`TradeLayer`).
 */
export function LaunchSlot() {
  const entry = useLaunch((st) => st.entry !== null);
  return entry ? <EarlyEntry /> : null;
}

const renderSheet = () => <LaunchSheet />;
const closeSheet = () => useLaunch.getState().closeSheet();

/**
 * «Raise your tower» in the city's one window frame (CITY-242), as the Deck's other places open: in the middle of a desk
 * or the phone's sheet, the Deck where it is, no longer a panel of its own that took the Deck's place. The frame stands
 * as tall as the step it shows; «Close» waits while a launch is under way (between the upload and the send). A run owns
 * the whole screen and a clip being filmed keeps the frame clean — unless a launch is under way, which stays in view.
 */
export function LaunchLayer() {
  const sheet = useLaunch((st) => st.sheet);
  const step = useLaunch((st) => st.step);
  const busy = useLaunch((st) => !closable(st.phase));
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const w = useWords(LAUNCH);
  const title = step === 'form' ? w.raise : w.review;
  const shown = sheet && (!(running || filming) || busy);
  // Asked to open again while it stands behind another window: the launch comes to the front.
  const opened = useLaunch((st) => st.opened);
  useEffect(() => {
    if (opened && useWindows.getState().layout.windows.some((win) => win.id === 'launch')) useWindows.getState().raise('launch');
  }, [opened]);
  const spec = useMemo(
    () => ({
      id: 'launch',
      title,
      icon: <LaunchGlyph />,
      render: renderSheet,
      fit: true,
      // As tall as the fields need, in the middle of the workspace: on a 900 px desk under the lens's row of filters,
      // not over it; the review, longer, scrolls inside.
      size: { width: 480, height: 640 },
      min: { width: 380, height: 420 },
      held: busy,
      onClose: closeSheet,
    }),
    // A new step or language is a new title: the open window's head follows it.
    [busy, title],
  );
  useCityWindow(shown, spec);
  return null;
}
