'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

/** A frame that held the page's thread longer than this leaves the next screen refresh free. */
const HEAVY_MS = 50;

/**
 * The city's frame loop (CITY-6a): one frame per screen refresh, except after a frame that held the page's thread
 * longer than `HEAVY_MS` — then one refresh is left free, so a tap waiting behind that frame is answered before the
 * next one is drawn. A device that keeps up never skips; one that cannot draws half as often and still answers the
 * finger. Starts when `on` (the shaders are ready, `Warmup`).
 */
export function Pacer({ on }: { on: boolean }) {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    if (!on) return;
    let id = 0;
    let rest = false;
    const loop = (t: number) => {
      id = requestAnimationFrame(loop);
      if (rest) {
        rest = false;
        return;
      }
      const start = performance.now();
      // With frameloop "never" the scene's clock takes this time as is, and every animation counts it in seconds;
      // the refresh's milliseconds ran them a thousand times too fast (the orbit shook the city, windows blinked).
      advance(t / 1000, true);
      rest = performance.now() - start > HEAVY_MS;
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [on, advance]);
  return null;
}
