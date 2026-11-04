'use client';

import { useCallback, useEffect, useRef } from 'react';
import { openTower, standsInCity } from '@/city/lib/coin/open';
import { EARN_OPEN } from '@/city/lib/earn/flag';
import { isEarnNoteKind } from '@/city/lib/earn/notes';
import { openEarn } from '@/city/lib/earn/open';
import { EXCHANGE_SHOWN } from '@/city/lib/exchange/flag';
import { useExchange } from '@/city/lib/exchange/store';
import { useWords } from '@/city/lib/i18n/dict';
import { kindOf } from '@/city/lib/notify/kinds';
import { useNotify, type Banner } from '@/city/lib/notify/store';
import { NOTE_WORDS } from './words';
import s from './notify.module.css';

/** How long a banner stands, unless the pointer rests on it. The liquidation risk stays until closed. */
const STAND_MS = 6_000;

/** What a tap on a banner opens: its tower, the Exchange for the liquidation risk, Earn's «Mine» for Earn's notes. */
function openBanner(banner: Banner): boolean {
  if (banner.kind === 'liquidation') {
    if (!EXCHANGE_SHOWN) return false;
    useExchange.getState().show();
    return true;
  }
  if (isEarnNoteKind(banner.kind)) {
    if (!EARN_OPEN) return false;
    openEarn('mine');
    return true;
  }
  if (banner.tower && standsInCity(banner.tower)) {
    openTower(banner.tower);
    return true;
  }
  return false;
}

/**
 * The centre's banners (CITY-87): where the person put them — a corner, or the top's middle — at most three, the newest
 * nearest the edge. A tap opens what it is about; × closes it. Nothing about money is decided here: a banner only says.
 */
export function Banners() {
  const w = useWords(NOTE_WORDS);
  const banners = useNotify((st) => st.banners);
  const corner = useNotify((st) => st.prefs.corner);
  if (!banners.length) return null;
  const bottom = corner.startsWith('bottom');
  const list = bottom ? [...banners].reverse() : banners;
  return (
    <div className={s.banners} data-corner={corner} role="region" aria-label={w.notes} aria-live="polite" data-city-banners="">
      {list.map((banner) => (
        <BannerCard key={banner.id} banner={banner} />
      ))}
    </div>
  );
}

function BannerCard({ banner }: { banner: Banner }) {
  const w = useWords(NOTE_WORDS);
  const group = kindOf(banner.kind).group;
  // The time left to stand, paused while the pointer rests on the banner.
  const clock = useRef<{ left: number; started: number; timer: ReturnType<typeof setTimeout> | null }>({ left: STAND_MS, started: 0, timer: null });
  const run = useCallback(() => {
    if (banner.sticky) return;
    const c = clock.current;
    c.started = Date.now();
    c.timer = setTimeout(() => useNotify.getState().dismiss(banner.id), c.left);
  }, [banner.id, banner.sticky]);
  const pause = () => {
    const c = clock.current;
    if (!c.timer) return;
    clearTimeout(c.timer);
    c.timer = null;
    c.left = Math.max(1_500, c.left - (Date.now() - c.started));
  };
  useEffect(() => {
    run();
    const c = clock.current;
    return () => {
      if (c.timer) clearTimeout(c.timer);
    };
  }, [run]);
  return (
    <div className={s.banner} data-group={group} role={banner.sticky ? 'alert' : 'status'} onPointerEnter={pause} onPointerLeave={() => !clock.current.timer && run()}>
      <button
        type="button"
        className={s.bannerBody}
        onClick={() => {
          if (openBanner(banner)) useNotify.getState().dismiss(banner.id);
        }}
      >
        <span className={s.bannerTitle}>{banner.title}</span>
        {banner.line ? <span className={s.bannerLine}>{banner.line}</span> : null}
      </button>
      <button type="button" className={s.bannerClose} aria-label={w.close} onClick={() => useNotify.getState().dismiss(banner.id)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
