'use client';

import { useEffect, useState } from 'react';
import { bodyOf, nextChange, type Body } from '@/city/lib/agent/garage/character';
import { useGarage } from '@/city/lib/agent/garage/store';

/**
 * What the agent's body is doing now (`bodyOf`), for its figure in the quarter and its portrait in the window: it looks
 * again by itself only when an act or a nod runs out. Null while the agent is off duty.
 */
export function useBody(): Body | null {
  const on = useGarage((st) => st.settings.on);
  const advice = useGarage((st) => st.advice);
  const showing = useGarage((st) => st.showing);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [advice, showing]);
  useEffect(() => {
    const at = nextChange({ advice, showing, now: Date.now() });
    if (at === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, at - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [advice, showing, now]);
  return bodyOf({ on, advice, showing, now });
}
