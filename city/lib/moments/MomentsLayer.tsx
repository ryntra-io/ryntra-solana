'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { requestFrame } from '@/city/lib/capture';
import { useCity, useCityEvents } from '@/city/lib/city/store';
import { useRun } from '@/city/lib/run/store';
import { shareImage } from '@/city/lib/share';
import { challengePayload, openChallenge, readChallengeHead, worldFromVersion } from './challenge';
import { cityFonts, composeMomentCard } from './draw';
import { DraftsDesk, useDeskAsked } from './drafts/Desk';
import { momentFileName, momentFromCityEvent, momentFromRun, momentFromWorldEvent, momentText, sourceTime, type Moment, type WorldEventLike } from './moment';
import { clipCodec } from './recorder';
import { addMoments, cancelFilming, filmMoment, isFilming, runChallengeLink, runClipReady, useMoments, watchRuns, type Made } from './stage';
import { resolveWorld } from './world-code';
import m from './moments.module.css';

/**
 * Moments in the city, always mounted beside the HUD: it opens challenge links (`#c=`), films every run in the
 * background, collects the city's moments, and shows the filming frame, the share sheet and, at `#drafts`, the desk
 * of post drafts for X. The HUD only shows its
 * button (MomentsButton) and the run's result calls openRunShare.
 */

let cancel: AbortController | null = null;

/** Films a moment and opens its share sheet. */
export async function clipMoment(moment: Moment): Promise<void> {
  if (isFilming()) return;
  useMoments.setState({ sheet: null });
  cancel = new AbortController();
  const made = await filmMoment(moment, cancel.signal);
  cancel = null;
  if (made) useMoments.setState({ sheet: { kind: 'share', made, link: null } });
}

/** The run's result asks for this: its clip (filmed while it was played), its card and the challenge link. */
export async function openRunShare(): Promise<void> {
  const [made, link] = await Promise.all([runClipReady(), runChallengeLink()]);
  const run = useRun.getState();
  if (made && made.moment.run?.time === run.last?.time) {
    useMoments.setState({ sheet: { kind: 'share', made, link } });
    return;
  }
  // Not filmed here (no video encoder, or a device short of frames): the card alone, from the city as it stands.
  const result = run.result;
  if (!result || result.status !== 'finish' || !run.course) return;
  const moment = momentFromRun({ time: result.time, newBest: result.newBest, form: run.form, day: run.course.day, course: run.course.id });
  if (!moment) return;
  const [frame, fonts] = await Promise.all([requestFrame(), cityFonts()]);
  const card = await composeMomentCard(frame, frame.width, frame.height, moment, fonts);
  useMoments.setState({ sheet: { kind: 'share', made: { moment, clip: null, card, hero: null }, link } });
}

/**
 * The server's city of a day for a challenge that points to it. The world contract routes the front through its world
 * client; until the quarter front brings that client, this one read lives here.
 */
async function fetchWorldVersion(id: string) {
  const res = await fetch(`/api/world/version/${encodeURIComponent(id)}`, { cache: 'force-cache' });
  return res.ok ? worldFromVersion(await res.json()) : null;
}

/** A challenge link names its time at once; its world and ghost follow a moment later. */
function useChallengeLink() {
  useLayoutEffect(() => {
    const payload = challengePayload(location.hash);
    const head = payload ? readChallengeHead(payload) : null;
    if (!payload || !head) return;
    useRun.setState({ challenge: head });
    let alive = true;
    void openChallenge(payload, { known: useCity.getState().snapshot.towers, fetchVersion: fetchWorldVersion }).then((opened) => {
      if (!alive || !opened) return;
      // Names come from whatever this device has read by now; the live read names the rest when it lands.
      const world = opened.world ? resolveWorld(opened.world, useCity.getState().snapshot.towers) : null;
      useRun.setState({ challenge: { ...head, world, ghost: opened.ghost } });
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(
    () =>
      useCity.subscribe((st, prev) => {
        if (st.snapshot === prev.snapshot || st.snapshot.source !== 'live') return;
        const run = useRun.getState();
        const c = run.challenge;
        if (!c?.world || run.phase !== 'off') return;
        useRun.setState({ challenge: { ...c, world: resolveWorld(c.world, st.snapshot.towers) } });
      }),
    [],
  );
}

export function MomentsLayer() {
  useChallengeLink();
  useEffect(() => watchRuns(), []);
  // Development only: the studio for X (CITY-38, `city/lib/x/film.mjs`) films its posts through this hook.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') void import('../x/studio');
  }, []);
  useCityEvents((e) => addMoments(momentFromCityEvent(e, useCity.getState().snapshot.towers)));
  // Development hook: lets the screenshot scripts stage any moment with real towers and read the result.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    Object.assign(window, {
      __moments: {
        state: useMoments,
        add: addMoments,
        clip: clipMoment,
        film: filmMoment,
        fromWorldEvent: (e: WorldEventLike) => momentFromWorldEvent(e, useCity.getState().snapshot.towers),
        fromRun: momentFromRun,
        runShare: openRunShare,
      },
    });
  }, []);
  const filming = useMoments((s) => s.filming);
  const sheet = useMoments((s) => s.sheet);
  // The desk for X (`/#drafts`): only an operator or the desk's key opens it.
  const desk = useDeskAsked();
  return (
    <>
      {desk && <DraftsDesk />}
      {filming && <Filming moment={filming.moment} progress={filming.progress} />}
      {sheet?.kind === 'list' && <ListSheet />}
      {sheet?.kind === 'share' && <ShareSheet made={sheet.made} link={sheet.link} />}
    </>
  );
}

/** While a clip is filmed: the 9:16 frame being recorded, its progress, and a way out. The city waits for it. */
function Filming({ moment, progress }: { moment: Moment; progress: number }) {
  return (
    <div className={m.rec} role="status" aria-live="polite">
      <div className={m.finder} aria-hidden="true" />
      <div className={m.recBar}>
        <span className={m.recDot} aria-hidden="true" />
        <span className={m.recLabel}>Filming · {moment.kicker.toLowerCase()}</span>
        <span className={m.recTrack} aria-hidden="true">
          <i style={{ transform: `scaleX(${progress})` }} />
        </span>
        <button className={m.recCancel} onClick={cancelFilming}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const close = () => useMoments.setState({ sheet: null });

/** The sheets swallow keys, so Enter on their buttons never also restarts the run behind them. */
function Sheet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className={m.backdrop}
      onClick={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close();
      }}
    >
      <div className={m.sheet} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function CloseButton() {
  return (
    <button className={m.close} aria-label="Close" onClick={close}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

const ACCENT_VAR = { mint: 'var(--mint)', amber: 'var(--amber)', flare: 'var(--flare)', violet: '#c9a2ff' } as const;

/** The moments of this visit, newest first, each one tap from its clip. */
function ListSheet() {
  const moments = useMoments((s) => s.moments);
  const run = useMoments((s) => s.run);
  const [film, setFilm] = useState(true);
  useEffect(() => {
    void clipCodec().then((c) => setFilm(!!c));
  }, []);
  return (
    <Sheet label="Moments">
      <div className={m.head}>
        <div className={m.kicker}>Moments</div>
        <CloseButton />
      </div>
      <ul className={m.list}>
        {run && <Row moment={run.moment} action="Share" onAction={() => void openRunShare()} />}
        {moments.map((x) => (
          <Row key={x.id} moment={x} action={film ? 'Clip' : 'Card'} onAction={() => void clipMoment(x)} />
        ))}
      </ul>
      <p className={m.small}>{film ? 'A clip is 9:16 with the moment’s real figure, ready for X.' : 'This browser cannot film video; each moment makes a card for X.'}</p>
    </Sheet>
  );
}

function Row({ moment, action, onAction }: { moment: Moment; action: string; onAction: () => void }) {
  return (
    <li className={m.row} style={{ ['--accent' as string]: ACCENT_VAR[moment.accent] }}>
      <div className={m.rowText}>
        <div className={m.rowKicker}>{moment.kicker}</div>
        <div className={m.rowTitle}>{moment.title}</div>
        <div className={m.rowFigure}>
          {moment.figure} · {sourceTime(moment.sourceAt)}
        </div>
      </div>
      <button className={m.rowAction} onClick={onAction}>
        {action}
      </button>
    </li>
  );
}

function canShareFiles(type: string, name: string): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    return !!nav.canShare?.({ files: [new File([new Uint8Array(1)], name, { type })] });
  } catch {
    return false;
  }
}

/** One moment made: the clip's frame, the words, and the ways out — the phone's share sheet, a download, the link. */
function ShareSheet({ made, link }: { made: Made; link: string | null }) {
  const { moment, clip, card, hero } = made;
  const text = momentText(moment, link ?? undefined);
  const [done, setDone] = useState<string | null>(null);
  const [phone] = useState(() => canShareFiles('video/mp4', 'clip.mp4'));
  const preview = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = preview.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !hero) return;
    ctx.drawImage(hero, 0, 0, c.width, c.height);
  }, [hero]);
  const send = async (blob: Blob | null, ext: 'mp4' | 'png', what: string) => {
    if (!blob) return;
    const outcome = await shareImage(blob, momentFileName(moment, ext), text);
    setDone(outcome === 'shared' ? `${what} shared` : outcome === 'downloaded' ? `${what} saved` : null);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(link ? 'Link copied' : 'Words copied');
    } catch {
      setDone(null);
    }
  };
  const label = moment.kind === 'record' ? (link ? 'Challenge' : 'Your run') : 'Moment';
  return (
    <Sheet label={label}>
      <div className={m.head}>
        <div className={m.kicker} style={{ color: ACCENT_VAR[moment.accent] }}>
          {label}
        </div>
        <CloseButton />
      </div>
      <div className={m.made}>
        {hero ? <canvas ref={preview} className={m.preview} width={180} height={320} aria-label="The clip's frame" /> : null}
        <div className={m.madeText}>
          <div className={m.madeKicker}>{moment.kicker}</div>
          <div className={m.madeTitle}>{moment.title}</div>
          <div className={m.madeFigure}>{moment.figure}</div>
          <div className={m.madeMeta}>{clip ? `Clip 9:16 · ${Math.round(clip.size / 100_000) / 10} MB · no sound` : 'Card 4:5 for X'}</div>
          <p className={m.words}>{text}</p>
        </div>
      </div>
      <div className={m.actions}>
        {clip ? (
          <button className={m.primary} onClick={() => void send(clip, 'mp4', 'Clip')} autoFocus>
            {phone ? 'Share clip' : 'Save clip'}
          </button>
        ) : (
          <button className={m.primary} onClick={() => void send(card, 'png', 'Card')} autoFocus>
            {phone ? 'Share card' : 'Save card'}
          </button>
        )}
        {clip && card && (
          <button className={m.secondary} onClick={() => void send(card, 'png', 'Card')}>
            Card
          </button>
        )}
        <button className={m.secondary} onClick={() => void copy()}>
          {link ? 'Copy link' : 'Copy words'}
        </button>
      </div>
      <p className={m.small} aria-live="polite">
        {done ?? (link ? 'The link opens the same city and your run as a ghost.' : 'Nothing is posted for you: you choose where it goes.')}
      </p>
    </Sheet>
  );
}

/** True while a clip is filmed: the HUD steps aside, so the screen shows what the clip shows. */
export function useFilming(): boolean {
  return useMoments((s) => s.filming !== null);
}

/** The HUD's button for this visit's moments; it appears once there is one. */
export function MomentsButton({ onOpen }: { onOpen?: () => void }) {
  const count = useMoments((s) => s.moments.length + (s.run ? 1 : 0));
  const open = useMoments((s) => s.sheet?.kind === 'list');
  if (!count) return null;
  return (
    <button
      className={m.button}
      aria-label={`Moments, ${count}`}
      aria-expanded={open}
      onClick={() => {
        onOpen?.();
        useMoments.setState({ sheet: open ? null : { kind: 'list' } });
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 3h10v18H7z" />
        <path d="M11 9.5v5l4-2.5z" fill="currentColor" />
      </svg>
      <span className={m.badge}>{count}</span>
    </button>
  );
}
