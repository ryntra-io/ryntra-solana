'use client';

import { useEffect, useRef, useState } from 'react';
import { CARD_SIZES, districtFrame, srcSet, type DistrictId } from '@/city/lib/art/frames';
import a from './art.module.css';

/**
 * A district's frame at the head of its card above the dock (CITY-64): the cinematic still of the district, full
 * bleed across the card's top and fading into its glass where the card's words begin. `tone="warm"` gives it the warm
 * edge of a card that opens soon. Decorative: the card's own words name the district. The same element on a phone,
 * where the card is the bottom sheet.
 */
// Frames this page has already shown: a card that mounts again (the hot tower changes) shows its frame at once
// instead of fading it in a second time.
const seen = new Set<DistrictId>();

export function DistrictArt({ id, tone = 'violet' }: { id: DistrictId; tone?: 'violet' | 'warm' }) {
  const frame = districtFrame(id);
  const img = useRef<HTMLImageElement>(null);
  const [shown, setShown] = useState(() => seen.has(id));
  const show = () => {
    seen.add(id);
    setShown(true);
  };
  // An image already in the cache can finish before React listens for its load.
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`${a.head} ${tone === 'warm' ? a.warm : ''}`} data-city-art={id} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={img}
        className={`${a.img} ${shown ? a.shown : ''}`}
        src={frame.files[0]!.src}
        srcSet={srcSet(frame)}
        sizes={CARD_SIZES}
        alt=""
        decoding="async"
        fetchPriority="low"
        onLoad={show}
      />
    </div>
  );
}
