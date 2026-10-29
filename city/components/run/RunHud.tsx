'use client';

import { useEffect, useRef, useState } from 'react';
import { openRunShare } from '@/city/lib/moments/MomentsLayer';
import { onRunEvent, runLive } from '@/city/lib/run/bus';
import { useCity } from '@/city/lib/city/store';
import { track } from '@/city/lib/run/track';
import { useRun, type RunResult } from '@/city/lib/run/store';
import r from './run.module.css';

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
  return (
    <div className={r.top}>
      <button className={r.icon} aria-label={sound ? 'Mute' : 'Sound on'} onClick={() => onSound(!sound)}>
        {sound ? <SpeakerOn /> : <SpeakerOff />}
      </button>
      <span className={r.spacer} />
      {best && (
        <button className={`${r.icon} ${showGhost ? r.iconOn : ''}`} aria-label={showGhost ? 'Hide your ghost' : 'Show your ghost'} aria-pressed={showGhost} onClick={toggleGhost}>
          <GhostIcon />
        </button>
      )}
      <button className={r.icon} aria-label="Back to the city" onClick={exit}>
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
  const move = form === 'flight' ? (touch ? 'Drag to fly' : 'Move the mouse to fly') : touch ? 'Swipe to run' : 'Arrow keys to run';
  return (
    <div className={r.howto}>
      <div className={r.howtoMove}>
        <span className={r.hintIcon}>{form === 'flight' ? <DragIcon /> : <SwipeIcon />}</span>
        {move}
      </div>
      {form === 'roofs' && (
        <div className={r.keys}>
          <span>← → lane</span>
          <span>↑ jump</span>
          <span>↓ slide</span>
        </div>
      )}
      <div className={r.howtoNote}>
        <span className={r.shields} aria-hidden="true">
          <i className={r.pip} />
          <i className={r.pip} />
          <i className={r.pip} />
        </span>
        A hit costs a shield, not the run
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
        const text = beat > 0 ? String(beat) : 'GO';
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
  useEffect(() => {
    let raf = 0;
    let shown = 3;
    const paint = () => {
      if (time.current) time.current.textContent = fmt(runLive.t);
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
        box.setAttribute('aria-label', `${runLive.shields} of 3 shields`);
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
          delta.current.textContent = `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
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
        00:00.0
      </span>
      <div className={r.track} aria-hidden="true">
        <div ref={fill} className={r.fill} />
        <div ref={ghost} className={r.ghostMark} />
      </div>
      <div ref={shields} className={r.shields} role="img" aria-label="3 of 3 shields">
        <i className={r.pip} />
        <i className={r.pip} />
        <i className={r.pip} />
      </div>
      <span ref={delta} className={r.delta} aria-label="Gap to your best" />
      {challenge && <div className={r.target}>To beat {challenge.beat.toFixed(1)} s</div>}
    </div>
  );
}

function Hint() {
  const form = useRun((s) => s.form);
  const phase = useRun((s) => s.phase);
  const attempt = useRun((s) => s.attempt);
  const touch = useTouch();
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
        {form === 'flight' ? (touch ? 'Drag to fly' : 'Move the mouse to fly') : '← → lane · ↑ jump · ↓ slide'}
      </div>
    );
  }
  if (hint.startsWith('cue:')) {
    return (
      <div className={`${r.hint} ${r.cue}`} key={hint}>
        {hint.slice(4)}
      </div>
    );
  }
  if (hint === 'fork') {
    return (
      <div className={r.routes} key="fork">
        <span className={r.route}>Safe</span>
        <span className={`${r.route} ${r.routeFast}`}>Fast</span>
        <span className={`${r.route} ${r.routeRisky}`}>Risky</span>
      </div>
    );
  }
  if (hint === 'node') {
    return (
      <div className={r.routes} key="node">
        <span className={`${r.route} ${r.routeRisky}`}>{form === 'flight' ? 'Break' : '↓ Break'}</span>
        <span className={r.routeGap} />
        <span className={`${r.route} ${r.routeSave}`}>Save</span>
      </div>
    );
  }
  return null;
}

function consequence(res: RunResult): string {
  if (res.status === 'crash') return res.reason === 'the drop' ? 'No shields left · you fell' : `No shields left · you hit ${res.reason}`;
  const hits = res.hits === 0 ? 'clean run' : `${res.hits} ${res.hits === 1 ? 'hit' : 'hits'}`;
  if (res.toBeat !== null && res.toBeat < -0.05) return `Challenge beaten by ${(-res.toBeat).toFixed(1)} s · ${hits}`;
  if (res.toBeat !== null && Math.abs(res.toBeat) <= 0.05) return `Tied the challenge · ${hits}`;
  if (res.toBeat !== null) return `+${res.toBeat.toFixed(1)} s to beat the challenge · ${hits}`;
  if (res.newBest && res.toBest === null) return `First finish today · ${hits}`;
  if (res.newBest) return `New best · ${hits}`;
  if (res.toBest !== null && Math.abs(res.toBest) < 0.05) return `Tied your best · ${hits}`;
  if (res.toBest !== null) return `+${res.toBest.toFixed(1)} s to your best · ${hits}`;
  if (res.node === 'break') return `You broke the bridge · ${hits}`;
  if (res.node === 'save') return `You saved the bridge · ${hits}`;
  return `Finished · ${hits}`;
}

function Result({ result }: { result: RunResult }) {
  const start = useRun((s) => s.start);
  const exit = useRun((s) => s.exit);
  const form = useRun((s) => s.form);
  const course = useRun((s) => s.course);
  const finished = result.status === 'finish';

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
    <div className={r.result} role="dialog" aria-label={finished ? 'Run finished' : 'Run crashed'}>
      <div className={`${r.kicker} ${finished ? r.kickerFinish : r.kickerCrash}`}>{finished ? 'Finish' : 'Crashed'}</div>
      <div className={r.big}>{finished ? `${result.time.toFixed(1)} s` : `${Math.round(result.progress * 100)}%`}</div>
      <div className={r.line}>{consequence(result)}</div>
      <div className={finished ? r.actions : `${r.actions} ${r.actionsTwo}`}>
        <button className={r.again} onClick={() => start('result')} autoFocus>
          Run again
        </button>
        {finished && (
          <button className={r.second} onClick={challenge}>
            Challenge
          </button>
        )}
        <button className={r.quiet} onClick={exit}>
          City
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
