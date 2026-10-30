'use client';

import { useEffect, useRef, useState } from 'react';
import { openRunShare } from '@/city/lib/moments/MomentsLayer';
import { onRunEvent, runLive } from '@/city/lib/run/bus';
import { useCity } from '@/city/lib/city/store';
import { track } from '@/city/lib/run/track';
import { useRun, type RunResult } from '@/city/lib/run/store';
import { digits, useWords, wordsNow } from '@/city/lib/i18n/dict';
import r from './run.module.css';
import { CUE_KEYS, RUN } from './words';

/** A cue of the course, in the language on screen. */
function cueShown(text: string, w: (typeof RUN)['en']): string {
  const key = CUE_KEYS.find((k) => RUN.en[k] === text);
  return key ? w[key] : text;
}

/**
 * The run's HUD: one screen, one goal. While running: the timer, a thin progress line with your ghost on it,
 * the gap to your best, and at most one hint. After: the record, one consequence and three actions.
 * Numbers are painted straight into the DOM every frame (runLive), so the 60 Hz run never re-renders React.
 */
export function RunHud({ onSound }: { onSound: (on: boolean) => void }) {
  const phase = useRun((s) => s.phase);
  const result = useRun((s) => s.result);
  if (phase === 'off') return null;
  return (
    <div className={r.layer}>
      <HitFlash />
      <TopRow onSound={onSound} />
      {phase === 'countdown' && <Countdown />}
      {(phase === 'running' || phase === 'countdown' || phase === 'ending') && <Clock />}
      {(phase === 'running' || phase === 'countdown') && <Hint />}
      {phase === 'result' && result && <Result result={result} />}
    </div>
  );
}

function TopRow({ onSound }: { onSound: (on: boolean) => void }) {
  const sound = useCity((s) => s.sound);
  const best = useRun((s) => s.best);
  const showGhost = useRun((s) => s.showGhost);
  const toggleGhost = useRun((s) => s.toggleGhost);
  const exit = useRun((s) => s.exit);
  const w = useWords(RUN);
  return (
    <div className={r.top}>
      <button className={r.icon} aria-label={sound ? w.mute : w.soundOn} onClick={() => onSound(!sound)}>
        {sound ? <SpeakerOn /> : <SpeakerOff />}
      </button>
      <span className={r.spacer} />
      {best && (
        <button className={`${r.icon} ${showGhost ? r.iconOn : ''}`} aria-label={showGhost ? w.hideGhost : w.showGhost} aria-pressed={showGhost} onClick={toggleGhost}>
          <GhostIcon />
        </button>
      )}
      <button className={r.icon} aria-label={w.backToCity} onClick={exit}>
        <CloseIcon />
      </button>
    </div>
  );
}

/** A phone or tablet (a coarse pointer) rather than a mouse: the controls are named the way you will use them. */
function useTouch(): boolean {
  const [touch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
  return touch;
}

/** The screen's edges flash red when a hit costs a shield. */
function HitFlash() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      onRunEvent((ev) => {
        const el = ref.current;
        if (ev.kind !== 'hit' || !el) return;
        el.classList.remove(r.flashOn!);
        void el.offsetWidth;
        el.classList.add(r.flashOn!);
      }),
    [],
  );
  return <div ref={ref} className={r.flash} aria-hidden="true" />;
}

/** The first countdown says how to play: the move, and that a hit costs a shield rather than the run. */
function HowTo() {
  const form = useRun((s) => s.form);
  const touch = useTouch();
  const w = useWords(RUN);
  const move = form === 'flight' ? (touch ? w.dragToFly : w.mouseToFly) : touch ? w.swipeToRun : w.keysToRun;
  return (
    <div className={r.howto}>
      <div className={r.howtoMove}>
        <span className={r.hintIcon}>{form === 'flight' ? <DragIcon /> : <SwipeIcon />}</span>
        {move}
      </div>
      {form === 'roofs' && (
        <div className={r.keys}>
          <span>{w.lane}</span>
          <span>{w.jump}</span>
          <span>{w.slide}</span>
        </div>
      )}
      <div className={r.howtoNote}>
        <span className={r.shields} aria-hidden="true">
          <i className={r.pip} />
          <i className={r.pip} />
          <i className={r.pip} />
        </span>
        {w.hitCosts}
      </div>
    </div>
  );
}

function Countdown() {
  const attempt = useRun((s) => s.attempt);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const paint = () => {
      const { countdownAt, countdownLen } = useRun.getState();
      const left = countdownLen - (performance.now() - countdownAt) / 1000;
      const beat = Math.ceil(left / (countdownLen / 3));
      const el = ref.current;
      if (el) {
        const text = beat > 0 ? String(beat) : wordsNow(RUN).go;
        if (el.textContent !== text) {
          el.textContent = text;
          el.classList.remove(r.pop!);
          void el.offsetWidth;
          el.classList.add(r.pop!);
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={r.count} aria-live="polite">
      <div ref={ref} className={r.countNum} />
      {attempt === 1 && <HowTo />}
    </div>
  );
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
};

function Clock() {
  const time = useRef<HTMLSpanElement>(null);
  const delta = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const shields = useRef<HTMLDivElement>(null);
  const challenge = useRun((s) => s.challenge);
  const w = useWords(RUN);
  useEffect(() => {
    let raf = 0;
    let shown = 3;
    const paint = () => {
      if (time.current) time.current.textContent = digits(fmt(runLive.t));
      const box = shields.current;
      if (box && runLive.shields !== shown) {
        // A lost shield cracks red; one that comes back pops in.
        const pips = Array.from(box.children);
        pips.forEach((pip, i) => pip.classList.toggle(r.pipOff!, i >= runLive.shields));
        const changed = pips[runLive.shields < shown ? runLive.shields : runLive.shields - 1];
        if (changed) {
          const cls = runLive.shields < shown ? r.pipCrack! : r.pipBack!;
          changed.classList.remove(r.pipCrack!, r.pipBack!);
          void (changed as HTMLElement).offsetWidth;
          changed.classList.add(cls);
        }
        box.setAttribute('aria-label', wordsNow(RUN).shields(runLive.shields));
        shown = runLive.shields;
      }
      if (fill.current) fill.current.style.transform = `scaleX(${runLive.progress})`;
      if (ghost.current) {
        ghost.current.style.opacity = runLive.ghostProgress >= 0 ? '1' : '0';
        ghost.current.style.left = `${Math.max(0, runLive.ghostProgress) * 100}%`;
      }
      if (delta.current) {
        const d = runLive.delta;
        if (Number.isNaN(d) || runLive.t < 1) {
          delta.current.textContent = '';
        } else {
          delta.current.textContent = digits(`${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`);
          delta.current.dataset.ahead = d <= 0 ? 'yes' : 'no';
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className={r.clock}>
      <span ref={time} className={r.time}>
        {digits('00:00.0')}
      </span>
      <div className={r.track} aria-hidden="true">
        <div ref={fill} className={r.fill} />
        <div ref={ghost} className={r.ghostMark} />
      </div>
      <div ref={shields} className={r.shields} role="img" aria-label={w.shields(3)}>
        <i className={r.pip} />
        <i className={r.pip} />
        <i className={r.pip} />
      </div>
      <span ref={delta} className={r.delta} aria-label={w.gap} />
      {challenge && <div className={r.target}>{w.toBeat(digits(challenge.beat.toFixed(1)))}</div>}
    </div>
  );
}

function Hint() {
  const form = useRun((s) => s.form);
  const phase = useRun((s) => s.phase);
  const attempt = useRun((s) => s.attempt);
  const touch = useTouch();
  const w = useWords(RUN);
  const [hint, setHint] = useState<string>('');
  useEffect(() => {
    let raf = 0;
    const watch = () => {
      const now = runLive.hint === 'cue' ? `cue:${runLive.cue}` : runLive.hint;
      setHint((h) => (h === now ? h : now));
      raf = requestAnimationFrame(watch);
    };
    raf = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (hint === 'steer' || hint === 'swipe') {
    // The first countdown already shows the how-to card.
    if (phase === 'countdown' && attempt === 1) return null;
    return (
      <div className={r.hint} key="learn">
        <span className={r.hintIcon}>{form === 'flight' ? <DragIcon /> : <SwipeIcon />}</span>
        {form === 'flight' ? (touch ? w.dragToFly : w.mouseToFly) : w.keysLine}
      </div>
    );
  }
  if (hint.startsWith('cue:')) {
    return (
      <div className={`${r.hint} ${r.cue}`} key={hint}>
        {cueShown(hint.slice(4), w)}
      </div>
    );
  }
  if (hint === 'fork') {
    return (
      <div className={r.routes} key="fork">
        <span className={r.route}>{w.safe}</span>
        <span className={`${r.route} ${r.routeFast}`}>{w.fast}</span>
        <span className={`${r.route} ${r.routeRisky}`}>{w.risky}</span>
      </div>
    );
  }
  if (hint === 'node') {
    return (
      <div className={r.routes} key="node">
        <span className={`${r.route} ${r.routeRisky}`}>{form === 'flight' ? w.breakIt : w.breakDown}</span>
        <span className={r.routeGap} />
        <span className={`${r.route} ${r.routeSave}`}>{w.save}</span>
      </div>
    );
  }
  return null;
}

function consequence(res: RunResult, w: (typeof RUN)['en']): string {
  if (res.status === 'crash') return res.reason === 'the drop' ? w.fell : w.hit(res.reason);
  const hits = res.hits === 0 ? w.clean : w.hits(res.hits);
  const sec = (v: number) => digits(v.toFixed(1));
  if (res.toBeat !== null && res.toBeat < -0.05) return w.beaten(sec(-res.toBeat), hits);
  if (res.toBeat !== null && Math.abs(res.toBeat) <= 0.05) return w.tiedChallenge(hits);
  if (res.toBeat !== null) return w.toBeatChallenge(sec(res.toBeat), hits);
  if (res.newBest && res.toBest === null) return w.firstFinish(hits);
  if (res.newBest) return w.newBest(hits);
  if (res.toBest !== null && Math.abs(res.toBest) < 0.05) return w.tiedBest(hits);
  if (res.toBest !== null) return w.toBest(sec(res.toBest), hits);
  if (res.node === 'break') return w.broke(hits);
  if (res.node === 'save') return w.saved(hits);
  return w.finished(hits);
}

function Result({ result }: { result: RunResult }) {
  const start = useRun((s) => s.start);
  const exit = useRun((s) => s.exit);
  const form = useRun((s) => s.form);
  const course = useRun((s) => s.course);
  const finished = result.status === 'finish';
  const w = useWords(RUN);

  // The challenge: the link with this run's world and ghost, the run's clip and card, in one sheet.
  const challenge = () => {
    if (course) track({ ev: 'challenge', form, course: course.id });
    void openRunShare();
  };

  // Enter or Space runs again: the fastest way back in.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        start('result');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [start]);

  return (
    <div className={r.result} role="dialog" aria-label={finished ? w.runFinished : w.runCrashed}>
      <div className={`${r.kicker} ${finished ? r.kickerFinish : r.kickerCrash}`}>{finished ? w.finish : w.crashed}</div>
      <div className={r.big}>{finished ? w.seconds(digits(result.time.toFixed(1))) : `${Math.round(result.progress * 100)}%`}</div>
      <div className={r.line}>{consequence(result, w)}</div>
      <div className={finished ? r.actions : `${r.actions} ${r.actionsTwo}`}>
        <button className={r.again} onClick={() => start('result')} autoFocus>
          {w.runAgain}
        </button>
        {finished && (
          <button className={r.second} onClick={challenge}>
            {w.challenge}
          </button>
        )}
        <button className={r.quiet} onClick={exit}>
          {w.city}
        </button>
      </div>
    </div>
  );
}

const SpeakerOn = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" />
  </svg>
);
const SpeakerOff = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const GhostIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 20V11a7 7 0 0 1 14 0v9l-2.4-1.8L14.2 20 12 18.2 9.8 20l-2.4-1.8z" />
    <circle cx="9.5" cy="11" r="1" fill="currentColor" />
    <circle cx="14.5" cy="11" r="1" fill="currentColor" />
  </svg>
);
const DragIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
  </svg>
);
const SwipeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4" />
  </svg>
);
