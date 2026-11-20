'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { startFeed } from '@/city/lib/feed/driver';
import { visibleEvents, type FeedEvent } from '@/city/lib/feed/feed';
import { ago } from '@/city/lib/feed/format';
import { hasNews, useFeedPanel } from '@/city/lib/feed/panel';
import { shownKinds } from '@/city/lib/feed/settings';
import { useFeed } from '@/city/lib/feed/store';
import { FEED, retell } from '@/city/lib/feed/words';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { spotIcon } from '@/city/lib/search/rank';
import { shownText } from '@/lib/world/text-safety/clean';
import { lookalikeOf } from '@/lib/world/text-safety/lookalike';
import { logoChain } from '@/terminal/market/depth-view';
import { CoinLogo, Icon, cx } from '@/terminal/ui';
import { closePanel, togglePanel, useFrame, useWhere } from './frame';
import { coinHref, shelfHref, shelfOn } from './shelves';
import { useDismiss } from './useDismiss';
import { useMarket } from './useMarket';
import { SHELL } from './words';
import s from './shell.module.css';

/** Events in the panel at most. */
const LISTED = 8;

/** The time now, again every half minute, so «4 min» stays right without a read. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The events under the bell: the city's own live feed — what rose, what fell, where the money traded, a new pool —
 * each built only from what the engine read (`city/lib/feed/**`). A quiet amber dot says something arrived since the
 * panel was last open. A coin's event opens the coin's screen once the Market is on.
 */
export function Events() {
  const w = useWords(SHELL);
  const open = useFrame((st) => st.panel === 'events');
  const seen = useFeedPanel((st) => st.seen);
  const newest = useFeed((st) => (st.memory.events.length ? Math.max(...st.memory.events.map((event) => event.id)) : null));
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => startFeed(), []);
  // The visit's first events are taken as seen; while the panel is open, so is everything that arrives.
  useEffect(() => {
    if (newest === null) return;
    if (open) useFeedPanel.setState((st) => ({ seen: Math.max(st.seen ?? 0, newest) }));
    else useFeedPanel.getState().settle(newest);
  }, [newest, open]);
  useDismiss(open, wrap, () => closePanel('events'));
  const news = hasNews(seen, newest);
  return (
    <div className={s.anchor} ref={wrap}>
      <button type="button" className={s.iconBtn} data-terminal="bell" aria-label={news ? w.eventsNew : w.events} aria-expanded={open} aria-haspopup="dialog" onClick={() => togglePanel('events')}>
        <Icon name="bell" />
        {news ? <span className={s.pip} aria-hidden="true" /> : null}
      </button>
      {open ? <EventsPanel /> : null}
    </div>
  );
}

function EventsPanel() {
  const w = useWords(SHELL);
  const settings = useFeed((st) => st.settings);
  const events = useFeed((st) => st.memory.events);
  // No market read yet: the panel shows where the events will stand, never «quiet» before it has looked.
  const waiting = useFeed((st) => st.memory.readAt === null);
  const list = useMemo(() => visibleEvents(events, shownKinds(settings), LISTED), [events, settings]);
  const now = useNow();
  return (
    <div className={cx(s.pop, s.events)} role="dialog" aria-label={w.events}>
      <div className={s.popHead}>
        <span>{w.events}</span>
        <button type="button" className={s.closeBtn} aria-label={w.close} onClick={() => closePanel('events')}>
          <Icon name="close" size="s" />
        </button>
      </div>
      {list.length ? (
        list.map((event) => <EventRow key={event.id} event={event} now={now} />)
      ) : waiting ? (
        <div className={s.bones} aria-busy="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <p className={s.quietLine}>{w.quiet}</p>
      )}
    </div>
  );
}

/** «4 min», «2 h», «now» in the language on screen. */
function sayAgo(short: string, f: (typeof FEED)['en']): string {
  const m = /^(\d+)([mhd])$/.exec(short);
  if (!m) return f.now;
  const n = Number(m[1]);
  return m[2] === 'm' ? f.minutes(n) : m[2] === 'h' ? f.hours(n) : f.days(n);
}

/**
 * A new pool of a coin nobody verified (QA 19.11: «N · Новий пул», «Не перевірено» in green): the city's feed keeps such
 * a coin nameless, so the row names it from the market's own read — its ticker as the search shows tickers (cleaned,
 * never one that passes for a known coin's) — with its logo through the engine's proxy, and says «unverified» quietly.
 */
function useLoosePool(event: FeedEvent): Readonly<{ ticker: string | null; logo: string | null; icon: string | null; mint: string }> | null {
  const towers = useMarket().towers;
  const mint = 'tower' in event.target ? event.target.tower : null;
  return useMemo(() => {
    if (event.kind !== 'pools' || !mint) return null;
    const tower = towers.find((each) => each.id === mint);
    if (!tower || tower.verified) return null;
    const cleaned = shownText(tower.symbol?.replace(/^\$+/u, ''), 'symbol', 16);
    const ticker = cleaned && !lookalikeOf(cleaned, mint) ? cleaned : null;
    return { ticker, logo: ticker ? spotIcon(mint, tower.icon) : null, icon: tower.icon, mint };
  }, [event.kind, mint, towers]);
}

function EventRow({ event, now }: { event: FeedEvent; now: number }) {
  const f = useWords(FEED);
  const lang = useLang();
  const { view } = useWhere();
  const loose = useLoosePool(event);
  // Written in English when it arrived; told in the language on screen.
  const said = retell(event.title, lang);
  const title = loose?.ticker ?? said;
  const line = loose?.ticker ? `${said} · ${retell(event.line, lang)}` : retell(event.line, lang);
  const when = sayAgo(ago(event.at, now), f);
  const symbol = event.title.replace(/^\$/, '');
  // A coin's event opens its screen in the Market, a pool's the Earn shelf — each once its shelf is on.
  const href =
    'tower' in event.target
      ? view === 'preview' || shelfOn('market')
        ? coinHref(event.target.tower, view)
        : null
      : view === 'preview' || shelfOn('earn')
        ? shelfHref('earn', view)
        : null;
  const body = (
    <>
      {loose ? (
        loose.ticker ? (
          <CoinLogo {...logoChain(loose.mint, loose.icon, loose.logo)} symbol={loose.ticker} />
        ) : (
          <span className={s.eventGlyph} aria-hidden="true">
            <Icon name="depth" size="s" />
          </span>
        )
      ) : (
        <CoinLogo src={event.image} symbol={symbol} />
      )}
      <span className={s.eventWords}>
        <span className={s.eventTitle}>{title}</span>
        <span className={s.eventLine}>{line}</span>
      </span>
      <time className={s.eventTime} dateTime={new Date(event.at).toISOString()}>
        {when}
      </time>
    </>
  );
  return href ? (
    <Link className={cx(s.event, s.eventLink)} href={href} data-tone={loose ? 'quiet' : event.tone} onClick={() => closePanel('events')}>
      {body}
    </Link>
  ) : (
    <div className={s.event} data-tone={loose ? 'quiet' : event.tone}>
      {body}
    </div>
  );
}
