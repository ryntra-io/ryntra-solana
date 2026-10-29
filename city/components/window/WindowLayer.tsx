'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { windowsDemo } from '@/city/lib/window/demo';
import { seamsIn, togetherIn } from '@/city/lib/window/layout';
import { startOut } from '@/city/lib/window/out';
import { useWindows } from '@/city/lib/window/store';
import type { Guide } from '@/city/lib/window/geometry';
import { GridGlyph } from './glyphs';
import { OutHosts, OutTray } from './OutWindow';
import { WindowFrame } from './WindowFrame';
import { WindowSheet } from './WindowSheet';
import s from './window.module.css';

// The stand with four empty windows: development builds only, never in the production bundle.
const Demo = process.env.NODE_ENV === 'production' ? null : dynamic(() => import('./WindowDemo').then((m) => m.WindowDemo), { ssr: false });

/**
 * The city's windows (CITY-65), over the city and under the trade card: on a computer the frames, the seams' grips,
 * the orange guides of a drag and «Snap together»; on a phone the bottom sheet. Nothing is drawn while no window is
 * open. Escape brings a window back from the whole screen. A window out on another screen (CITY-75) is drawn there,
 * and a quiet button in the city brings it back.
 */
export function WindowLayer() {
  const desk = useWindows((st) => st.desk);
  const count = useWindows((st) => st.layout.windows.length);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    const measure = () => useWindows.getState().setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => setDemo(Boolean(windowsDemo())), []);

  // The windows out on another screen (CITY-75): their browser windows are watched from here.
  useEffect(() => startOut(), []);

  // Escape gives the whole screen back before anything else hears it: heard first (a capture registered with the city)
  // and marked as taken, so a window's own Escape, the chart's and the HUD's — they read `defaultPrevented` — close
  // nothing with the same press.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const { layout, exitFull } = useWindows.getState();
      if (!layout.full) return;
      const id = layout.full;
      event.preventDefault();
      exitFull();
      // The keyboard stays in the window that gave the screen back.
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-window="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <>
      {demo && Demo && <Demo />}
      {count > 0 && (desk ? <Desk /> : <WindowSheet />)}
      <OutHosts />
      <OutTray />
    </>
  );
}

function Desk() {
  // Ids in the order they were opened: the frames keep their place in the page and only their depth changes, so a
  // chart's canvas or a live form inside is never moved in the page when another window comes to the front.
  const order = useWindows((st) => [...st.layout.windows].sort((a, b) => a.seq - b.seq).map((w) => w.id).join(' '));
  const depth = useWindows((st) => st.layout.windows.map((w) => w.id).join(' '));
  const full = useWindows((st) => st.layout.full);
  const ids = order ? order.split(' ') : [];
  const z = depth ? depth.split(' ') : [];
  return (
    <div className={`${s.layer} ${full ? s.layerFull : ''}`}>
      {full && <div className={s.scrim} aria-hidden="true" />}
      {!full && <Seams />}
      {ids.map((id) => (
        <WindowFrame key={id} id={id} z={z.indexOf(id)} />
      ))}
      <Guides />
      {!full && ids.length > 1 && <SnapTogether />}
    </div>
  );
}

/** The small orange grips on the seams between windows that stick: what to pull to stretch both. */
function Seams() {
  const key = useWindows((st) => JSON.stringify(seamsIn(st.layout)));
  const dragging = useWindows((st) => st.guides.length > 0);
  if (dragging) return null;
  return (
    <>
      {(JSON.parse(key) as Guide[]).map((g) => (
        <span key={`${g.axis}${g.at}:${g.from}`} className={`${s.grip} ${g.axis === 'x' ? s.gripUpright : s.gripLevel}`} style={gripAt(g)} aria-hidden="true" />
      ))}
    </>
  );
}

function gripAt(g: Guide) {
  const middle = (g.from + g.to) / 2;
  return g.axis === 'x' ? { left: g.at, top: middle } : { left: middle, top: g.at };
}

/** The orange lines of the edges a dragged window sticks to. */
function Guides() {
  const guides = useWindows((st) => st.guides);
  return (
    <>
      {guides.map((g) => (
        <span
          key={`${g.axis}${g.at}:${g.from}:${g.to}`}
          className={`${s.guide} ${g.axis === 'x' ? s.guideUpright : s.guideLevel}`}
          style={g.axis === 'x' ? { left: g.at, top: g.from, height: g.to - g.from } : { top: g.at, left: g.from, width: g.to - g.from }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/** «Snap together»: every open window stuck into one grid (macet M2); hidden once they all stick. */
function SnapTogether() {
  const together = useWindows((st) => togetherIn(st.layout));
  if (together) return null;
  return (
    <button type="button" className={s.snap} onClick={() => useWindows.getState().grid()}>
      <GridGlyph />
      Snap together
    </button>
  );
}
