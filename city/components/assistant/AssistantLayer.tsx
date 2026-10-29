'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { startersFor, moveOf, type Details } from '@/city/lib/assistant/answer';
import { QUESTION_MAX } from '@/city/lib/assistant/ask';
import { useAssistant } from '@/city/lib/assistant/store';
import { useCity } from '@/city/lib/city/store';
import { useKeyboardInset } from '@/city/lib/keyboard';
import type { Tower } from '@/city/lib/market/types';
import { useQuarter } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { useWindows } from '@/city/lib/window/store';
import { TokenIcon } from '../hud/bits';
import hud from '../hud/hud.module.css';
import s from './assistant.module.css';

/**
 * Ryntra in the city (CITY-10): one button in the top bar (`AssistantButton`), one glass panel. A question goes to the assistant; the answer is the towers
 * — the camera flies to them and they light up — with one short line. Why, the risks, what to check and the sources
 * wait behind «Details». Advice only: a tower in the answer opens that tower's own card, where the person decides.
 */
export function AssistantLayer() {
  const open = useAssistant((st) => st.open);
  const running = useRun((st) => st.phase !== 'off');
  const building = useQuarter((st) => st.mode !== 'city');

  // The logo's way home, a run or a tower picked on the skyline: the panel steps aside and its towers go dark.
  useEffect(
    () =>
      useCity.subscribe((city, before) => {
        if (!useAssistant.getState().open) return;
        if (city.homeAt !== before.homeAt || (city.selectedId && city.selectedId !== before.selectedId)) useAssistant.getState().hide();
      }),
    [],
  );
  useEffect(() => {
    if ((running || building) && useAssistant.getState().open) useAssistant.getState().hide();
  }, [running, building]);
  // A window of the city's frame (CITY-65) opened over the city: the panel steps aside, one thing in front at a time.
  useEffect(
    () =>
      useWindows.subscribe((st, before) => {
        if (st.layout.windows.length > before.layout.windows.length && useAssistant.getState().open) useAssistant.getState().hide();
      }),
    [],
  );

  if (running || building || !open) return null;
  return <Panel />;
}

/** Closing the panel by its own controls hands the focus back to the button that opened it. */
let refocus = false;
const close = () => {
  refocus = true;
  useAssistant.getState().hide();
};

/**
 * «Ask Ryntra» in the city's top bar, beside the search: the spark, and its words where the bar has room. A second tap
 * closes the panel.
 */
export function AssistantButton() {
  const open = useAssistant((st) => st.open);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open && refocus) button.current?.focus({ preventScroll: true });
    refocus = false;
  }, [open]);
  const ask = () => {
    if (useAssistant.getState().open) return close();
    const city = useCity.getState();
    const subject = city.snapshot.towers.find((t) => t.id === city.selectedId) ?? null;
    // The tower card gives way to Ryntra; the question is about that tower.
    if (subject) city.select(null);
    useAssistant.getState().show(subject);
  };
  return (
    <button ref={button} type="button" className={`${hud.panel} ${s.entry} ${open ? hud.iconOn : ''}`} aria-label="Ask Ryntra" aria-expanded={open} onClick={ask}>
      <SparkGlyph />
      <span className={s.entryWord}>Ask Ryntra</span>
    </button>
  );
}

function Panel() {
  const phase = useAssistant((st) => st.phase);
  const subject = useAssistant((st) => st.subject);
  const line = useAssistant((st) => st.line);
  const voice = useAssistant((st) => st.voice);
  const busy = useAssistant((st) => st.busy);
  const shown = useAssistant((st) => st.shown);
  const details = useAssistant((st) => st.details);
  const day = useAssistant((st) => st.day);
  const [text, setText] = useState('');
  const [more, setMore] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const moreId = useId();
  const keyboard = useKeyboardInset();

  const send = (q: string) => {
    if (!q.trim()) return;
    setMore(false);
    setText('');
    input.current?.blur();
    void useAssistant.getState().ask(q, useCity.getState().snapshot.towers);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // One press does one thing: never the press the frame or another window already took.
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    // A desk types at once; a phone's keyboard waits for a tap on the field, so the city stays in view.
    if (window.matchMedia?.('(pointer: fine)').matches) input.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const answered = phase === 'answered';
  return (
    // On a phone the panel is a sheet at the bottom, above the keyboard (`--kb`) while it is up.
    <div className={s.layer} style={{ ['--kb' as string]: `${keyboard}px` }}>
      <section className={`${hud.panel} ${s.panel}`} role="dialog" aria-label="Ryntra" aria-busy={phase === 'asking'}>
        <header className={s.head}>
          <span className={s.title}>
            <SparkGlyph />
            Ryntra
          </span>
          <button type="button" className={s.close} aria-label="Close" onClick={close}>
            <CloseGlyph />
          </button>
        </header>

        {phase === 'idle' && (
          <div className={s.starters}>
            {startersFor(subject).map((st) => (
              <button key={st.id} type="button" className={s.starter} onClick={() => send(st.question)}>
                {st.label}
              </button>
            ))}
          </div>
        )}

        {phase === 'asking' && (
          <div className={s.thinking} role="status" aria-label="Ryntra is reading the market">
            <span />
            <span />
            <span />
          </div>
        )}

        <div aria-live="polite">{answered && line && <p className={s.line}>{line}</p>}</div>

        {answered && shown.length > 0 && (
          <ul className={s.towers} aria-label="Towers in the answer">
            {shown.map((t) => (
              <li key={t.id}>
                <TowerChip t={t} />
              </li>
            ))}
          </ul>
        )}

        {answered && (
          <>
            <button type="button" className={s.more} aria-expanded={more} aria-controls={moreId} onClick={() => setMore((v) => !v)}>
              Details
              <ChevronGlyph />
            </button>
            {more && <More id={moreId} details={details} voice={voice} busy={busy} day={day} />}
          </>
        )}

        <form className={s.ask} onSubmit={submit}>
          <input
            ref={input}
            className={s.input}
            value={text}
            maxLength={QUESTION_MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder={answered ? 'Ask more' : 'Ask about any coin'}
            aria-label="Your question"
            enterKeyHint="send"
            autoComplete="off"
          />
          <button type="submit" className={s.send} aria-label="Ask" disabled={!text.trim() || phase === 'asking'}>
            <SendGlyph />
          </button>
        </form>
      </section>
    </div>
  );
}

/** A tower of the answer: its logo, symbol and move; a tap opens its own card on the skyline. */
function TowerChip({ t: asked }: { t: Tower }) {
  // The tower as the city reads it now: the figure follows the market's refresh, not the moment of the question.
  const t = useCity((st) => st.snapshot.towers.find((x) => x.id === asked.id)) ?? asked;
  const move = moveOf(t.change24h);
  return (
    <button type="button" className={s.chip} aria-label={`Open ${t.symbol}`} onClick={() => useCity.getState().select(t.id)}>
      <TokenIcon t={t} className={s.chipIcon} />
      <span className={s.chipSym}>{t.symbol}</span>
      {move && <span className={t.change24h >= 0 ? s.chipUp : s.chipDown}>{move}</span>}
    </button>
  );
}

const MARK: Record<Details['why'][number]['mark'], string> = { fact: 'Fact', unverified: 'Reported', inference: 'Ryntra’s read', unknown: 'Unknown' };

/** Behind «Details»: why it moved, what could make the reading wrong, what to check, the sources, and how Ryntra answers. */
function More({ id, details, voice, busy, day }: { id: string; details: Details | null; voice: 'ryntra' | 'city'; busy: boolean; day: { used: number; allowance: number } | null }) {
  return (
    <div id={id} className={s.details}>
      {details && details.why.length > 0 && (
        <Part title="Why">
          {details.why.map((w, i) => (
            <li key={i}>
              <span className={s.mark}>{MARK[w.mark]}</span> {w.text}
            </li>
          ))}
        </Part>
      )}
      {details && details.risks.length > 0 && <Part title="Could be wrong">{details.risks.map((r, i) => <li key={i}>{r}</li>)}</Part>}
      {details && details.checks.length > 0 && <Part title="Worth checking">{details.checks.map((c, i) => <li key={i}>{c}</li>)}</Part>}
      {details && details.sources.length > 0 && (
        <Part title="Sources">
          {details.sources.map((src) => (
            <li key={src.source}>
              {src.source}
              {src.at ? ` · ${clock(src.at)}` : ''}
            </li>
          ))}
        </Part>
      )}
      <Part title="How Ryntra answers">
        <li>Ryntra reads the market and explains it. Advice only: it never trades, signs or holds keys.</li>
        {voice === 'city' && <li>{busy ? 'Ryntra has had many questions this minute' : 'Ryntra could not answer just now'}, so the city shows its own read of the market.</li>}
        {day && day.allowance > 0 && (
          <li>
            Answers today: {Math.min(day.used, day.allowance)} of {day.allowance}
          </li>
        )}
      </Part>
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s.part}>
      <h3 className={s.partTitle}>{title}</h3>
      <ul className={s.partList}>{children}</ul>
    </div>
  );
}

const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/** Ryntra's spark: the eclipse ring with a light breaking out of it, drawn for 24 px like the HUD's glyphs. */
const SparkGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 4.5l1.6 4.4 4.4 1.6-4.4 1.6L10 16.5l-1.6-4.4L4 10.5l4.4-1.6z" />
    <path d="M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
  </svg>
);

const CloseGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const SendGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M5 12h13M13 6l6 6-6 6" />
  </svg>
);

const ChevronGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 10l5 5 5-5" />
  </svg>
);
