'use client';

import { useEffect } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { useCity } from '@/city/lib/city/store';
import { startFeed } from '@/city/lib/feed/driver';
import { hasNews, useFeedPanel } from '@/city/lib/feed/panel';
import { useFeed } from '@/city/lib/feed/store';
import { FEED } from '@/city/lib/feed/words';
import { useWords } from '@/city/lib/i18n/dict';
import { useNotify } from '@/city/lib/notify/store';
import hud from '../hud/hud.module.css';
import s from './feed.module.css';

/**
 * The bell in the top bar: the city's events in one panel under it (`LiveFeed`, panel mode). A quiet amber dot says an
 * event arrived since the panel was last open. `aria-pressed`, not `aria-expanded`: the top bar's open menus hide the
 * feed, and this one is the feed.
 */
export function EventsBell({ hidden = false }: { hidden?: boolean }) {
  const w = useWords(FEED);
  const open = useFeedPanel((st) => st.open);
  const seen = useFeedPanel((st) => st.seen);
  const newest = useFeed((st) => (st.memory.events.length ? Math.max(...st.memory.events.map((event) => event.id)) : null));
  // The feed is read while the city is open, so the dot can say when something new arrives.
  useEffect(() => startFeed(), []);
  useEffect(() => {
    if (newest !== null) useFeedPanel.getState().settle(newest);
  }, [newest]);
  // A window opening folds the panel away: nothing of the feed stands over a window.
  useEffect(() => {
    if (hidden) useFeedPanel.getState().close();
  }, [hidden]);
  const news = hasNews(seen, newest);
  // «Event feed: hidden» in Settings (CITY-87): no bell; the feed still reads, for what goes to the computer.
  const side = useNotify((st) => st.prefs.feed);
  useEffect(() => {
    if (side === 'hidden') useFeedPanel.getState().close();
  }, [side]);
  if (side === 'hidden') return null;
  return (
    <button
      type="button"
      className={`${hud.panel} ${hud.iconBtn} ${s.bell} ${open ? hud.iconOn : ''}`}
      aria-label={news ? w.eventsNew : w.events}
      aria-pressed={open}
      aria-controls="city-feed"
      data-feed-bell=""
      onClick={() => {
        if (useCity.getState().sound) playTick();
        useFeedPanel.getState().toggle(newest ?? 0);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 2H4.2zM10 21.2h4"
        />
      </svg>
      {news && <span className={s.bellDot} aria-hidden="true" />}
    </button>
  );
}
