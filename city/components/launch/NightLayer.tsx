'use client';

import { useEffect, useState } from 'react';
import { useCity } from '@/city/lib/city/store';
import { useFeedPanel } from '@/city/lib/feed/panel';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useLaunch } from '@/city/lib/launch/district';
import type { NightEntry, NightShow } from '@/city/lib/launch/night';
import { actName, entryCap, entryLine, liveText, ruleText } from '@/city/lib/launch/night-words';
import { nightReady, startNight, useNight } from '@/city/lib/launch/night-store';
import { LAUNCH_NIGHT } from '@/city/lib/launch/words';
import { useRun } from '@/city/lib/run/store';
import { CloseGlyph, InfoGlyph } from '../hud/glyphs';
import { useWindowOpen } from '../hud/useWindowOpen';
import s from './night.module.css';

/**
 * Launch Night over the city (CITY-146): the show of the night's confirmed launches. The camera frames one launch at a
 * time in the Docks (`NightSpot` lights it); the stage below says its coin, its market cap and one line, with one amber
 * action — Buy, which opens the tower's own window. The acts run as segments along the top. The rule the show keeps sits
 * behind one quiet «i». Nothing of it exists until the night has enough confirmed launches (`night.ts`).
 */
export function NightLayer() {
  useEffect(() => startNight(), []);
  const playing = useNight((st) => st.playing);
  const show = useNight((st) => (nightReady(st) ? st.show : null));
  const running = useRun((st) => st.phase !== 'off');
  const selectedId = useCity((st) => st.selectedId);
  const sheet = useLaunch((st) => st.sheet);
  const windowOpen = useWindowOpen();
  const feedOpen = useFeedPanel((st) => st.open);
  const homeAt = useCity((st) => st.homeAt);

  // A tower picked, a window or the events opened, the logo pressed, the launch sheet opened or a run started: the city
  // has the screen, the show steps aside.
  useEffect(() => {
    if (selectedId || running || sheet || windowOpen || feedOpen) useNight.getState().stop();
  }, [selectedId, running, sheet, windowOpen, feedOpen]);
  useEffect(() => {
    if (homeAt) useNight.getState().stop();
  }, [homeAt]);

  useEffect(() => {
    if (!playing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Arrows inside a field move its caret, not the stage.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === 'Escape') useNight.getState().stop();
      else if (event.key === 'ArrowRight') useNight.getState().step(1);
      else if (event.key === 'ArrowLeft') useNight.getState().step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);

  if (!playing || !show || running || windowOpen) return null;
  return (
    <div className={s.layer} data-launch-night="">
      <Stage show={show} />
    </div>
  );
}

function Stage({ show }: { show: NightShow }) {
  const index = useNight((st) => Math.min(st.index, show.entries.length - 1));
  const movedAt = useNight((st) => st.movedAt);
  const stub = useNight((st) => st.stub);
  const [more, setMore] = useState(false);
  const w = useWords(LAUNCH_NIGHT);
  useLang();
  const entry = show.entries[index]!;
  return (
    <section className={s.stage} aria-label={w.title}>
      <div className={s.bars} role="group" aria-label={w.acts}>
        {show.acts.map((act) => (
          <div key={act.id} className={s.act}>
            {act.entries.map((item) => {
              const at = show.entries.indexOf(item);
              const state = at < index ? s.barDone : at === index ? s.barOn : '';
              return (
                <button key={item.token} aria-current={at === index ? 'step' : undefined} aria-label={w.stage(item.symbol)} className={`${s.bar} ${state}`} onClick={() => useNight.getState().go(at)}>
                  <span key={at === index ? movedAt : 0} className={s.fill} />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className={s.head}>
        <div className={s.kicker}>
          <span className={s.pulse} aria-hidden="true" />
          <span className={s.display}>{w.title}</span>
          {show.network === 'solana:devnet' && <span className={s.tag}>{w.devnet}</span>}
          {stub && <span className={`${s.tag} ${s.tagStub}`}>{w.stub}</span>}
        </div>
        <button className={`${s.icon} ${more ? s.iconOn : ''}`} aria-label={w.details} aria-expanded={more} aria-controls="city-night-more" onClick={() => setMore((v) => !v)}>
          <InfoGlyph />
        </button>
        <button className={s.icon} aria-label={w.close} onClick={() => useNight.getState().stop()}>
          <CloseGlyph />
        </button>
      </div>

      <Coin key={entry.token} entry={entry} />

      {more && (
        <div id="city-night-more" className={s.more}>
          <p>{ruleText()}</p>
          <p>{w.notAdvice}</p>
        </div>
      )}

      <div className={s.controls}>
        <button className={s.step} aria-label={w.previous} onClick={() => useNight.getState().step(-1)}>
          <Chevron back />
        </button>
        <button
          className={`${s.display} ${s.buy}`}
          data-night-buy=""
          onClick={() => {
            useNight.getState().stop();
            useCity.getState().select(entry.token);
          }}
        >
          {w.buy(entry.symbol)}
        </button>
        <button className={s.step} aria-label={w.next} onClick={() => useNight.getState().step(1)}>
          <Chevron />
        </button>
      </div>
    </section>
  );
}

/** The launch on the stage: its face, its ticker, the market cap and one line; the curve's way to the DEX below. */
function Coin({ entry }: { entry: NightEntry }) {
  const w = useWords(LAUNCH_NIGHT);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className={s.coinRow}>
      <Face symbol={entry.symbol} image={entry.image} size="stage" />
      <div className={s.names} aria-live="polite">
        <span className={s.actLabel}>{actName(entry.act)}</span>
        <div className={`${s.display} ${s.symbol}`}>${entry.symbol}</div>
        <div className={s.line}>{entryLine(entry, now)}</div>
      </div>
      <div className={s.cap}>
        <span className={s.capLabel}>{w.marketCap}</span>
        <b className={s.display}>{entryCap(entry)}</b>
      </div>
      {entry.act !== 'graduated' && (
        <div className={s.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(entry.progress)}>
          <span style={{ width: `${Math.max(2, Math.floor(entry.progress))}%` }} />
        </div>
      )}
    </div>
  );
}

/** The coin's own logo as Ryntra keeps it, or its first letter on the launchpad's disc: never an empty circle. */
function Face({ symbol, image, size }: { symbol: string; image: string | null; size: 'stage' | 'chip' }) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = image && failed !== image ? image : null;
  return (
    <span className={`${s.face} ${size === 'chip' ? s.faceChip : ''}`} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" draggable={false} onError={() => setFailed(src)} />
      ) : (
        <span className={s.letter}>{symbol.slice(0, 1)}</span>
      )}
    </span>
  );
}

function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={back ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/** Whether Launch Night owns the card slot now: a show stands ready and is not playing. */
export function useNightCard(): boolean {
  return useNight((st) => nightReady(st) && !st.playing);
}

/** Whether the show plays over the city now: the menu and the card slot give way to the stage. */
export function useNightPlaying(): boolean {
  return useNight((st) => st.playing);
}

/**
 * The card that opens the show, in the home's card slot: the night's name with a live pulse, how many launches are on,
 * their faces, and one amber action — Watch.
 */
export function NightCard() {
  const show = useNight((st) => (nightReady(st) ? st.show : null));
  const stub = useNight((st) => st.stub);
  const w = useWords(LAUNCH_NIGHT);
  useLang();
  if (!show) return null;
  const faces = show.entries.slice(0, 5);
  return (
    <div className={`${s.panel} ${s.card}`} data-night-card="">
      <div className={s.kicker}>
        <span className={s.pulse} aria-hidden="true" />
        <span className={s.display}>{w.title}</span>
        {show.network === 'solana:devnet' && <span className={s.tag}>{w.devnet}</span>}
        {stub && <span className={`${s.tag} ${s.tagStub}`}>{w.stub}</span>}
      </div>
      <div className={s.cardRow}>
        <div className={`${s.display} ${s.cardTitle}`}>{liveText(show.entries.length)}</div>
        <div className={s.faces}>
          {faces.map((entry) => (
            <Face key={entry.token} symbol={entry.symbol} image={entry.image} size="chip" />
          ))}
        </div>
      </div>
      <button className={`${s.display} ${s.buy} ${s.watch}`} data-night-watch="" onClick={() => useNight.getState().play()}>
        {w.watch}
      </button>
    </div>
  );
}
