'use client';

import { useEffect, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { Mark } from '../hud/Mark';
import { HUD } from '../hud/words';
import { useSkyline } from './skyline/store';
import s from './loading.module.css';

/** The canvas fades in over 900 ms (`CityCanvas`): the dusk stays under it a little longer, then leaves the page. */
const LEAVE_MS = 1_100;

/**
 * The dusk and the mark painted on the page itself, from the very first frame (CITY-243): the page streams, and in 4 of
 * 9 loads on ryntra.io the browser painted the body's flat blue for 0.2–0.8 s before this component's markup arrived.
 * React hoists this sheet into the page's head, so it applies before any of the body is drawn: the body wears the same
 * dusk, horizon, ring and mark at the same place, and the component's own layer lands on it without a seam. The
 * city's root covers it once the page stands.
 */
const RING_AND_MARK = encodeURIComponent(
  [
    "<svg xmlns='http://www.w3.org/2000/svg' width='124' height='124' viewBox='0 0 100 100'>",
    "<defs><linearGradient id='r' x1='0' y1='1' x2='1' y2='0'><stop offset='0' stop-color='#9945FF'/><stop offset='0.65' stop-color='#C9A2FF'/><stop offset='1' stop-color='#FFE7C2'/></linearGradient>",
    "<linearGradient id='s' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='#FFB23F'/><stop offset='1' stop-color='#FFF6E6'/></linearGradient>",
    "<filter id='g' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='2.2' result='b'/><feMerge><feMergeNode in='b'/><feMergeNode in='SourceGraphic'/></feMerge></filter></defs>",
    "<circle cx='50' cy='50' r='46' fill='none' stroke='rgba(153,69,255,0.28)' stroke-width='1'/>",
    "<circle cx='50' cy='50' r='46' fill='none' stroke='#FFB23F' stroke-width='1.8' stroke-linecap='round' stroke-dasharray='24 76' pathLength='100'/>",
    "<g transform='translate(29.03 29.03) scale(0.6553)'><g filter='url(#g)'><circle cx='32' cy='34' r='19' fill='none' stroke='url(#r)' stroke-width='4.2'/><circle cx='32' cy='34' r='16.6' fill='#0B0A14'/>",
    "<path d='M32 2 L37.2 30 L36.2 60 L27.8 60 L26.8 30 Z' fill='url(#s)'/><path d='M32 2 L34.2 30 L33.4 60 L30.6 60 L29.8 30 Z' fill='#FFFFFF' opacity='0.35'/></g></g></svg>",
  ].join(''),
);

const DUSK = [
  `url("data:image/svg+xml,${RING_AND_MARK}") center / 124px 124px no-repeat`,
  'linear-gradient(90deg, rgba(255, 178, 63, 0), rgba(255, 178, 63, 0.55) 30%, rgba(255, 231, 194, 0.8) 50%, rgba(255, 178, 63, 0.55) 70%, rgba(255, 178, 63, 0)) 0 61% / 100% 1px no-repeat',
  'radial-gradient(60% 34% at 50% 61%, rgba(255, 150, 70, 0.2), rgba(255, 150, 70, 0) 72%)',
  'radial-gradient(85% 52% at 50% 36%, rgba(153, 69, 255, 0.24), rgba(153, 69, 255, 0) 74%)',
  'linear-gradient(180deg, #0a0717 0%, #150c2b 36%, #2a1640 57%, #1a0f2a 61%, #0b0a14 70%, #06050c 100%) #06050c',
].join(', ');

/** The body's dusk, as the head carries it (exported for its test). */
export const DUSK_SHEET = `html:root > body { background: ${DUSK}; background-attachment: fixed; }`;

/**
 * While the scene builds (CITY-241): the city's dusk and its mark with a turning ring of light, never a black screen.
 * Drawn on the server's page, so it is there from the first paint, before the canvas's code arrives — and since CITY-243
 * the page's body wears the same dusk from its head, before this markup has arrived at all. It stands under the canvas,
 * which fades in over it once the city stands in its final form (or the procedural one does), and under the HUD. No
 * words on the screen; a screen reader hears that the city is loading.
 */
export function CityLoading() {
  const shown = useSkyline((st) => (st.ready && st.lit) || st.fallback);
  const w = useWords(HUD);
  const [gone, setGone] = useState(false);
  // A city drawn again from nothing (its skyline torn down) brings the dusk back under it.
  useEffect(() => {
    if (!shown) {
      setGone(false);
      return;
    }
    const timer = setTimeout(() => setGone(true), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  // Hoisted into the head by React (a sheet with a `precedence`), once, for the page's life.
  const sheet = (
    <style href="city-dusk" precedence="default">
      {DUSK_SHEET}
    </style>
  );
  if (gone) return sheet;
  return (
    <>
      {sheet}
      <div className={`${s.loading} ${shown ? s.leaving : ''}`} role="status" aria-busy={!shown} data-city-loading={shown ? 'leaving' : ''}>
        <span className={s.horizon} aria-hidden="true" />
        <span className={s.core} aria-hidden="true">
          <svg className={s.orbit} viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" className={s.track} />
            <circle cx="50" cy="50" r="46" className={s.arc} pathLength={100} />
          </svg>
          <span className={s.mark}>
            <Mark size={52} />
          </span>
        </span>
        {!shown && <span className={s.said}>{w.cityLoading}</span>}
      </div>
    </>
  );
}
