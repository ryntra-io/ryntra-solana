'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { cityLine, startersFor, moveOf, type Details } from '@/city/lib/assistant/answer';
import { QUESTION_MAX } from '@/city/lib/assistant/ask';
import { useAssistant } from '@/city/lib/assistant/store';
import { useCity } from '@/city/lib/city/store';
import { bookNow, cityDoors, contextNow, gatesNow, withCoinOnScreen } from '@/city/lib/command/doors';
import { toggleCommand, useCommand } from '@/city/lib/command/store';
import { dateText, useWords, type TextKey } from '@/city/lib/i18n/dict';
import { ONE_SENTENCE_OPEN } from '@/city/lib/instruct/flag';
import { readAsk } from '@/city/lib/autopilot/read';
import { readDollarAsk } from '@/city/lib/earn/dollar-read';
import { readPilotAsk } from '@/city/lib/pilot/read';
import { useAutopilot } from '@/city/lib/autopilot/store';
import { fit } from '@/city/lib/command/parse';
import { readInstruction } from '@/city/lib/instruct/read';
import { hireFit, readHire, type Role } from '@/city/lib/crew/read';
import { crewGatesNow } from '@/city/lib/crew/hire';
import { CREW_WORDS } from '@/city/lib/crew/words';
import { JobCard } from '../crew/JobCard';
import crew from '../crew/crew.module.css';
import { useInstruct } from '@/city/lib/instruct/store';
import { useKeyboardInset } from '@/city/lib/keyboard';
import type { Tower } from '@/city/lib/market/types';
import { useQuarter } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { useWindows } from '@/city/lib/window/store';
import { TokenIcon } from '../hud/bits';
import hud from '../hud/hud.module.css';
import s from './assistant.module.css';
import { ASSISTANT } from './words';

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
 * «Ask Ryntra» in the city's top bar, beside the search: the spark, and its words where the bar has room. Since CITY-85
 * it opens the command line (helm SPEC §1: Ryntra lives in the command line) — say what to open, or ask; on a phone it
 * is the line's own way in, on a computer ⌘K is the other. A second tap closes the line, or Ryntra's panel.
 */
export function AssistantButton() {
  const open = useAssistant((st) => st.open);
  const command = useCommand((st) => st.open);
  const button = useRef<HTMLButtonElement>(null);
  const w = useWords(ASSISTANT);
  const keys = useCommandKeys();
  useEffect(() => {
    if (!open && refocus) button.current?.focus({ preventScroll: true });
    refocus = false;
  }, [open]);
  const ask = () => {
    if (useAssistant.getState().open) return close();
    toggleCommand();
  };
  return (
    <button
      ref={button}
      type="button"
      className={`${hud.panel} ${s.entry} ${open || command ? hud.iconOn : ''}`}
      aria-label={w.ask}
      aria-expanded={open || command}
      aria-keyshortcuts={keys ? (keys === '⌘K' ? 'Meta+K' : 'Control+K') : undefined}
      onClick={ask}
    >
      <SparkGlyph />
      <span className={s.entryWord}>{w.ask}</span>
      {keys && (
        <kbd className={s.entryKey} aria-hidden="true">
          {keys}
        </kbd>
      )}
    </button>
  );
}

/** The command line's keys as this computer writes them, once mounted (the server paints none); none on a touch screen. */
function useCommandKeys(): string | null {
  const [keys, setKeys] = useState<string | null>(null);
  useEffect(() => {
    if (!window.matchMedia?.('(pointer: fine)').matches) return;
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
    setKeys(/mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K');
  }, []);
  return keys;
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
  const intent = useAssistant((st) => st.intent);
  const w = useWords(ASSISTANT);
  const [text, setText] = useState('');
  const [more, setMore] = useState(false);
  // A job for an agent said to the consultant (CITY-205): the agent and «Hire» instead of words.
  const [job, setJob] = useState<{ role: Role | null } | null>(null);
  const c = useWords(CREW_WORDS);
  const input = useRef<HTMLInputElement>(null);
  const moreId = useId();
  const keyboard = useKeyboardInset();

  const send = (q: string) => {
    if (!q.trim()) return;
    // «Trade 1 SOL a day», «launch me a token» said to Ryntra is the agent on its word (CITY-175): the card opens.
    const gates = gatesNow();
    // «Поклади 0,2 SOL і 5 USDC працювати» said to Ryntra opens the money autopilot's card (CITY-204), as from the line.
    const pilot = gates.pilot ? readPilotAsk(q, bookNow()) : null;
    if (pilot && fit({ kind: 'pilot', ask: pilot }, gates)) {
      setText('');
      useAssistant.getState().hide();
      cityDoors.openPilot(pilot);
      return;
    }
    // «Put my USDC to work», «поклади 50 USDC під відсоток» said to Ryntra opens the Dollar Saver's card (CITY-192).
    const saver = gates.dollar ? readDollarAsk(q) : null;
    if (saver) {
      setText('');
      useAssistant.getState().hide();
      cityDoors.openDollar(saver);
      return;
    }
    const ask = gates.agentTrade || gates.agentLaunch ? readAsk(q, bookNow()) : null;
    if (ask && fit({ kind: 'autopilot', ask }, gates)) {
      setText('');
      useAssistant.getState().hide();
      useAutopilot.getState().show(withCoinOnScreen(ask));
      return;
    }
    // «Buy $20 of SOL every week» said to Ryntra is the agent's card (CITY-176): Ryntra steps aside, the card opens.
    const instruction = ONE_SENTENCE_OPEN && gatesNow().instruct ? readInstruction(q, bookNow(), contextNow()) : null;
    if (instruction) {
      setText('');
      useAssistant.getState().hide();
      useInstruct.getState().show(instruction);
      return;
    }
    // «Торгуй за мене», «доглядай мій пул», «запусти бота»: the consultant advises — the work is an agent's.
    const hired = readHire(q);
    if (hired) {
      setText('');
      setMore(false);
      input.current?.blur();
      setJob({ role: hireFit(hired, crewGatesNow()).role });
      return;
    }
    setJob(null);
    setMore(false);
    setText('');
    input.current?.blur();
    void useAssistant.getState().ask(q, () => useCity.getState().snapshot.towers);
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
  // The city's own line is its read of the towers on screen: written again in the language on screen. Ryntra's line
  // stays as Ryntra wrote it, in the language it was asked in.
  const said = voice === 'city' && answered ? cityLine(intent, shown) : line;
  return (
    // On a phone the panel is a sheet at the bottom, above the keyboard (`--kb`) while it is up.
    <div className={s.layer} style={{ ['--kb' as string]: `${keyboard}px` }}>
      <section className={`${hud.panel} ${s.panel}`} role="dialog" aria-label="Ryntra" aria-busy={phase === 'asking'}>
        <header className={s.head}>
          <span className={s.title}>
            <SparkGlyph />
            Ryntra
            <span className={crew.consultant}>{c.consultant}</span>
          </span>
          <button type="button" className={s.close} aria-label={w.close} onClick={close}>
            <CloseGlyph />
          </button>
        </header>

        {job && (
          <JobCard
            role={job.role}
            onHire={() => {
              setJob(null);
              useAssistant.getState().hide();
              cityDoors.openCrew(job.role);
            }}
          />
        )}

        {!job && phase === 'idle' && (
          <div className={s.starters}>
            {startersFor(subject).map((st) => (
              <button key={st.id} type="button" className={s.starter} onClick={() => send(st.question)}>
                {st.label}
              </button>
            ))}
          </div>
        )}

        {!job && phase === 'asking' && (
          <div className={s.thinking} role="status" aria-label={w.reading}>
            <span />
            <span />
            <span />
          </div>
        )}

        <div aria-live="polite">{!job && answered && said && <p className={s.line}>{said}</p>}</div>

        {!job && answered && shown.length > 0 && (
          <ul className={s.towers} aria-label={w.towers}>
            {shown.map((t) => (
              <li key={t.id}>
                <TowerChip t={t} />
              </li>
            ))}
          </ul>
        )}

        {!job && answered && (
          <>
            <button type="button" className={s.more} aria-expanded={more} aria-controls={moreId} onClick={() => setMore((v) => !v)}>
              {w.details}
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
            placeholder={answered ? w.askMore : w.askAny}
            aria-label={w.yourQuestion}
            enterKeyHint="send"
            autoComplete="off"
          />
          <button type="submit" className={s.send} aria-label={w.send} disabled={!text.trim() || phase === 'asking'}>
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
  const w = useWords(ASSISTANT);
  const move = moveOf(t.change24h);
  return (
    <button type="button" className={s.chip} aria-label={w.open(t.symbol)} onClick={() => useCity.getState().select(t.id)}>
      <TokenIcon t={t} className={s.chipIcon} />
      <span className={s.chipSym}>{t.symbol}</span>
      {move && <span className={t.change24h >= 0 ? s.chipUp : s.chipDown}>{move}</span>}
    </button>
  );
}

const MARK: Record<Details['why'][number]['mark'], TextKey<typeof ASSISTANT>> = { fact: 'markFact', unverified: 'markReported', inference: 'markRead', unknown: 'markUnknown' };

/** Behind «Details»: why it moved, what could make the reading wrong, what to check, the sources, and how Ryntra answers. */
function More({ id, details, voice, busy, day }: { id: string; details: Details | null; voice: 'ryntra' | 'city'; busy: boolean; day: { used: number; allowance: number } | null }) {
  const w = useWords(ASSISTANT);
  const c = useWords(CREW_WORDS);
  return (
    <div id={id} className={s.details}>
      {details && details.why.length > 0 && (
        <Part title={w.why}>
          {details.why.map((row, i) => (
            <li key={i}>
              <span className={s.mark}>{w[MARK[row.mark]]}</span> {row.text}
            </li>
          ))}
        </Part>
      )}
      {details && details.risks.length > 0 && <Part title={w.couldBeWrong}>{details.risks.map((r, i) => <li key={i}>{r}</li>)}</Part>}
      {details && details.checks.length > 0 && <Part title={w.worthChecking}>{details.checks.map((c, i) => <li key={i}>{c}</li>)}</Part>}
      {details && details.sources.length > 0 && (
        <Part title={w.sources}>
          {details.sources.map((src) => (
            <li key={src.source}>
              {src.source}
              {src.at ? ` · ${clock(src.at)}` : ''}
            </li>
          ))}
        </Part>
      )}
      <Part title={w.how}>
        <li>{w.adviceOnly}</li>
        <li>{c.credits}</li>
        {voice === 'city' && <li>{busy ? w.busyRead : w.awayRead}</li>}
        {day && day.allowance > 0 && <li>{w.answersToday(Math.min(day.used, day.allowance), day.allowance)}</li>}
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
  return Number.isNaN(d.getTime()) ? '' : dateText(d, { hour: '2-digit', minute: '2-digit' });
};

/** Ryntra's spark: the eclipse ring with a light breaking out of it, drawn for 24 px like the HUD's glyphs. */
export const SparkGlyph = () => (
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
