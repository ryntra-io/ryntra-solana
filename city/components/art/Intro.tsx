'use client';

import { useEffect } from 'react';
import { CARD_DISTRICTS, CARD_SIZES, districtFrame, skylineReady, srcSet } from '@/city/lib/art/frames';
import { readViewer } from '@/city/lib/art/viewer';
import { cityDrawn } from '@/city/lib/city/drawn';

/**
 * Nothing goes before the live city. What stays of the intro is its after-work: once the city is drawn, the cards above the dock get
 * their frames in the background, so they open with them already here.
 */
export function WarmCards() {
  useEffect(() => {
    let frame = 0;
    let timer = 0;
    const start = performance.now();
    const watch = () => {
      if (skylineReady(cityDrawn(), (window as Window & { __skyline?: unknown }).__skyline)) {
        warmCards();
        return;
      }
      // Every frame while the city is loading; a city that has not drawn in ten seconds (no WebGL) is asked twice a second.
      if (performance.now() - start < 10_000) frame = requestAnimationFrame(watch);
      else timer = window.setTimeout(watch, 500);
    };
    frame = requestAnimationFrame(watch);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);
  return null;
}

/**
 * The cards above the dock open with their frames already here: fetched once the city is drawn, when the page is
 * idle, in the width the card draws them — unless the visitor's browser asks to save data.
 */
function warmCards() {
  if (readViewer().saveData) return;
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const go = () => {
    for (const id of CARD_DISTRICTS) {
      const img = new Image();
      img.decoding = 'async';
      img.fetchPriority = 'low';
      img.sizes = CARD_SIZES;
      img.srcset = srcSet(districtFrame(id));
    }
  };
  if (idle) idle(go, { timeout: 5000 });
  else setTimeout(go, 1500);
}
