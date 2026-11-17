'use client';

import { useEffect, useState } from 'react';

/**
 * Seconds on the person's own clock, ticking every `everyMs`: for a countdown and the time a choice opens at. Null on
 * the server's render and the first one in the browser, so the two agree; the clock starts once the page is live.
 */
export function useSeconds(everyMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
