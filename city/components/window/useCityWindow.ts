'use client';

import { useEffect, useRef } from 'react';
import { goOutAgain } from '@/city/lib/window/out';
import { closeWindow, openWindow, updateWindow, type WindowSpec } from '@/city/lib/window/store';

/**
 * A window of the city in the one frame (CITY-65), for a window whose own store says whether it is open: the frame opens
 * it while `shown` and closes it when not; a new title, contents or hold in `spec` reach the open window where it stands,
 * never bringing it to the front. `spec` is the caller's memoised value: a new object is an update.
 *
 * «Close» in the frame calls `spec.onClose` — the owner's own close, which a signature holds — and a window the owner
 * closes (Escape, a run, home) leaves the frame with it. A window with `spec.detach` that was out on another screen the
 * last time goes out there again (CITY-75).
 */
export function useCityWindow(shown: boolean, spec: WindowSpec): void {
  const latest = useRef(spec);
  latest.current = spec;
  const id = spec.id;

  useEffect(() => {
    if (!shown) return;
    openWindow(latest.current);
    // Out on another screen last time (CITY-75): out again, while the tap that opened it still counts.
    if (latest.current.detach) goOutAgain(id);
    return () => closeWindow(id);
  }, [shown, id]);

  useEffect(() => {
    if (shown) updateWindow(spec);
  }, [shown, spec]);
}
