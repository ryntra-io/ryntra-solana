'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCity } from '@/city/lib/city/store';
import { openEvent, reachable, startFeed } from '@/city/lib/feed/driver';
import { visibleEvents, type FeedEvent } from '@/city/lib/feed/feed';
import { ago, clock } from '@/city/lib/feed/format';
import { shownKinds, SWITCHES } from '@/city/lib/feed/settings';
import { sparkPath } from '@/city/lib/feed/spark';
import { useFeed } from '@/city/lib/feed/store';
import s from './feed.module.css';

/** Events on screen at most: a column on a desk; on a phone one in the strip and this many in its open list. */
const SHOWN = 5;
const SPARK = { w: 64, h: 24 } as const;

/**
 * The live event feed on the home (CITY-66, mock M1): on a desk a column on the left under the top bar, on a phone a
 * strip with the newest event that opens into the list. A tap on an event flies to its tower and opens its card, or
 * opens its pool in the Harbor. «Show on home» lives in the menu's «Settings»; the phone's opened list keeps a gear to
 * the same switches. While any window is open (`hidden`, city/lib/city/windows.ts) the feed and its controls step aside,
 * so nothing of it stands over the window.
 */
export function LiveFeed({ hidden = false }: { hidden?: boolean }) {
  useEffect(() => startFeed(), []);
  const ready = useFeed((st) => st.ready);
  const settings = useFeed((st) => st.settings);
  const events = useFeed((st) => st.memory.events);
  // The city's layout changes with every read: what a tap can reach is asked again then.
  useCity((st) => st.layout);
  const [gear, setGear] = useState(false);
  const [open, setOpen] = useState(false);
  // A window opening folds the phone's list and the gear's panel: the feed comes back as a strip.
  useEffect(() => {
    if (!hidden) return;
    setGear(false);
    setOpen(false);
  }, [hidden]);
  // Each event's source and clock time, behind one quiet control.
  const [details, setDetails] = useState(false);
  const now = useNow(30_000);

  const shown = useMemo(() => shownKinds(settings), [settings]);
  const list = useMemo(() => visibleEvents(events, shown, SHOWN), [events, shown]);

  // The first events fill the feed quietly; the ones after them glow once as they arrive, if the flashing is on.
  const firstBatch = useRef<number | null>(null);
  if (firstBatch.current === null && events.length) firstBatch.current = events[0]!.id;

  // The column shows whole events only: one the screen has no room for waits out of sight. Each card is followed as it
  // grows in, so the one pushed past the edge goes the moment it crosses it.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const fit = () => {
      const bottom = el.getBoundingClientRect().bottom;
      for (const li of Array.from(el.children)) li.toggleAttribute('data-over', (li.firstElementChild ?? li).getBoundingClientRect().bottom > bottom + 1);
      el.toggleAttribute('data-overflow', el.scrollHeight > el.clientHeight + 1);
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(el);
    for (const li of Array.from(el.children)) observer?.observe(li);
    return () => observer?.disconnect();
    // Again when the events change or a panel opens; between those the observer follows every size.
  }, [list, gear, open, details]);

  // Escape closes the gear's panel, then the phone's open list, and nothing under them. The listener is the city's first
  // (it is set when the page opens), so it decides before the cards and sheets below it — but a modal window open over
  // the city, or the focus held by something else (the search, a sheet), owns its Escape, and the feed stays as it is.
  const panels = useRef({ gear, open });
  panels.current = { gear, open };
  const moreRef = useRef<HTMLButtonElement>(null);
  const feedRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const focus = document.activeElement;
      if (focus && focus !== document.body && !feedRef.current?.contains(focus)) return;
      // The open list counts only where it shows: on a phone held upright, where the chevron stands.
      const list = panels.current.open && !!moreRef.current?.offsetParent;
      if (!panels.current.gear && !list) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (panels.current.gear) setGear(false);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // One state in words, only when the person switched everything off; a feed still waiting stays empty (the top bar
  // already says when the market's data is delayed).
  const empty = !shown.size && ready ? 'Everything is off.' : null;

  const tap = (event: FeedEvent) => {
    if (openEvent(event)) setOpen(false);
  };

  return (
    <section
      ref={feedRef}
      className={s.feed}
      aria-label="Live event feed"
      data-city-feed=""
      data-open={open ? '' : undefined}
      data-details={details ? '' : undefined}
      data-flash={settings.flashing ? 'on' : 'off'}
      data-hidden={hidden ? '' : undefined}
      aria-hidden={hidden || undefined}
    >
      <div className={s.head}>
        {/* The gear lives inside the opened list only; the menu's «Settings» is the switches' home. */}
        {open && (
          <button
            className={s.gear}
            aria-label="Show on home"
            aria-expanded={gear}
            aria-controls="city-feed-settings"
            onClick={() => setGear((v) => !v)}
          >
            <GearGlyph />
          </button>
        )}
        <span className={s.kicker}>
          <BoltGlyph />
        </span>
        <button className={s.info} aria-label="Sources and times" aria-pressed={details} onClick={() => setDetails((v) => !v)}>
          <InfoGlyph />
        </button>
        <button className={s.more} ref={moreRef} aria-label={open ? 'Fewer events' : 'All events'} aria-expanded={open} onClick={() => (setOpen((v) => !v), setGear(false))}>
          <ChevronGlyph />
        </button>
      </div>
      {gear && open && <FeedSettingsPanel onClose={() => setGear(false)} />}
      {list.length ? (
        <ol className={s.list} ref={listRef}>
          {list.map((event) => (
            <FeedItem key={event.id} event={event} now={now} fresh={firstBatch.current !== null && event.id > firstBatch.current} onOpen={tap} />
          ))}
        </ol>
      ) : empty ? (
        <p className={s.empty}>{empty}</p>
      ) : null}
    </section>
  );
}

function FeedItem({ event, now, fresh, onOpen }: { event: FeedEvent; now: number; fresh: boolean; onOpen: (event: FeedEvent) => void }) {
  const when = ago(event.at, now);
  const at = new Date(event.at);
  const body = (
    <>
      <EventIcon event={event} />
      <span className={s.title}>{event.title}</span>
      <time className={s.time} dateTime={at.toISOString()}>
        {when}
      </time>
      <span className={s.line}>{event.line}</span>
      <span className={s.meta}>
        {event.source} · {clock(event.at)}
        {event.detail ? ` · ${event.detail}` : ''}
      </span>
      {event.spark && (
        <svg className={s.spark} viewBox={`0 0 ${SPARK.w} ${SPARK.h}`} width={SPARK.w} height={SPARK.h} aria-hidden="true">
          <polyline points={sparkPath(event.spark, SPARK.w, SPARK.h)} />
        </svg>
      )}
    </>
  );
  const words = `${event.title}, ${event.line}${event.detail ? `, ${event.detail}` : ''}. ${event.source}, ${when === 'now' ? 'just now' : `${when} ago`}, at ${clock(event.at)}.`;
  return (
    <li className={s.item} data-fresh={fresh ? '' : undefined}>
      {reachable(event) ? (
        <button className={s.card} data-tone={event.tone} onClick={() => onOpen(event)} aria-label={`${words} ${'tower' in event.target ? 'Fly to it.' : 'Open the pool.'}`}>
          {body}
        </button>
      ) : (
        <div className={s.card} data-tone={event.tone} aria-label={words} role="group">
          {body}
        </div>
      )}
    </li>
  );
}

function EventIcon({ event }: { event: FeedEvent }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (event.image && failed !== event.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={s.icon} src={event.image} alt="" onError={() => setFailed(event.image)} />;
  }
  return <span className={`${s.icon} ${s.iconGlyph}`}>{event.kind === 'coins' ? <SparkGlyph /> : event.kind === 'pools' ? <PoolGlyph /> : <span>{event.title.slice(0, 1)}</span>}</span>;
}

function FeedSettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useFeed((st) => st.settings);
  const flip = useFeed((st) => st.set);
  return (
    <div className={s.settings} id="city-feed-settings" role="group" aria-labelledby="city-feed-settings-title">
      <div className={s.settingsHead}>
        <span className={s.settingsTitle} id="city-feed-settings-title">
          Show on home
        </span>
        <button className={s.close} aria-label="Close" onClick={onClose}>
          <CloseGlyph />
        </button>
      </div>
      {SWITCHES.map(({ id, label }) => (
        <div className={s.row} key={id}>
          <span id={`city-feed-${id}`}>{label}</span>
          <button className={s.switch} role="switch" aria-checked={settings[id]} aria-labelledby={`city-feed-${id}`} onClick={() => flip(id, !settings[id])}>
            <span className={s.knob} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** The time now, again every `ms`: the corner times stay right without a read. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M10.3 2.8h3.4l.5 2.6a7.4 7.4 0 0 1 1.8 1l2.5-.9 1.7 2.9-2 1.8a7.4 7.4 0 0 1 0 2l2 1.8-1.7 2.9-2.5-.9a7.4 7.4 0 0 1-1.8 1l-.5 2.6h-3.4l-.5-2.6a7.4 7.4 0 0 1-1.8-1l-2.5.9-1.7-2.9 2-1.8a7.4 7.4 0 0 1 0-2l-2-1.8 1.7-2.9 2.5.9a7.4 7.4 0 0 1 1.8-1z"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function BoltGlyph() {
  return (
    <svg className={s.bolt} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M13.5 2 5 13.5h6L9.5 22 19 9.8h-6.2z" />
    </svg>
  );
}

function InfoGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 11v5.5M12 7.6v.1" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function SparkGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2.5c.6 4.6 2.4 7.2 7 8.5-4.6 1.3-6.4 3.9-7 9.5-.6-5.6-2.4-8.2-7-9.5 4.6-1.3 6.4-3.9 7-8.5z" />
    </svg>
  );
}

function PoolGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M3 9c2.2 0 2.2-1.6 4.5-1.6S9.8 9 12 9s2.2-1.6 4.5-1.6S18.8 9 21 9M3 13c2.2 0 2.2-1.6 4.5-1.6S9.8 13 12 13s2.2-1.6 4.5-1.6S18.8 13 21 13M3 17c2.2 0 2.2-1.6 4.5-1.6S9.8 17 12 17s2.2-1.6 4.5-1.6S18.8 17 21 17" />
    </svg>
  );
}
