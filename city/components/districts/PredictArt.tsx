'use client';

import { useState } from 'react';
import { coverSrc } from '@/city/lib/districts/predict/cover';
import { artOf, type Market } from '@/city/lib/districts/predict/markets';
import { ArtGlyph } from './predictGlyphs';
import s from './predict.module.css';

/** The size each place draws a cover at, CSS px: a row takes AGG's square sharp at twice it, the rest the original. */
const PX = { card: 92, row: 56, hero: 0 } as const;

/**
 * A market's picture: the event's own, from the engine, through the city's own origin (`cover.ts` — the site's policy
 * refuses AGG's image host, and every cover asked for straight from it failed); while it loads, or where the event has
 * none, its category's emblem on the night glass — never a blank box and never a picture of another event.
 */

export function PredictArt({ market, size = 'card' }: { market: Pick<Market, 'image' | 'categories' | 'title'>; size?: 'card' | 'row' | 'hero' }) {
  const [broken, setBroken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const art = artOf(market);
  const src = coverSrc(market.image, PX[size]);
  const image = src && src !== broken ? src : null;
  return (
    <span className={`${s.art} ${s[`art_${size}`]}`} data-art={art}>
      <span className={s.artGlyph}>
        <ArtGlyph art={art} />
      </span>
      {image ? (
        // The event's cover, as the venue serves it; on an error (a host the page may not load) the emblem stays.
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.artImg} src={image} alt="" loading="lazy" decoding="async" data-on={loaded === image ? '' : undefined} onLoad={() => setLoaded(image)} onError={() => setBroken(image)} />
      ) : null}
    </span>
  );
}
