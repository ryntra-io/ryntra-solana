'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { ADVICE_PER_DAY } from '@/city/lib/agent/garage/budget';
import type { MyTower } from '@/city/lib/agent/garage/mine';
import type { Reminder } from '@/city/lib/agent/garage/reminders';
import type { Change, Report } from '@/city/lib/agent/garage/report';
import { NAME_MAX, TOPIC_ORDER, type Topic } from '@/city/lib/agent/garage/settings';
import { flyTo } from '@/city/lib/agent/garage/show';
import { useGarage, type AdviceState } from '@/city/lib/agent/garage/store';
import { useCity } from '@/city/lib/city/store';
import { openCommand } from '@/city/lib/command/store';
import { locale, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { sym } from '../../hud/bits';
import { AgentGlyph } from '../../hud/glyphs';
import { Coin } from './Coin';
import { BackGlyph, BeaconGlyph, ChevronGlyph, FlyGlyph, GearGlyph } from './glyphs';
import { useBody } from './useBody';
import { GARAGE } from './words';
import s from './garage.module.css';

type Words = (typeof GARAGE)['en'];

const tick = () => {
  if (useCity.getState().sound) playTick();
};

/** A clock time and a weekday-and-time in the language on screen. */
const clockOf = (at: number, tag: string) => new Date(at).toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' });
const dayOf = (at: number, tag: string) => new Date(at).toLocaleString(tag, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** How long ago, the way a person says it: «now», «12m», «3h». */
function ago(at: number, now: number, w: Words): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return w.now;
  if (m < 60) return w.minutes(m);
  return w.hours(Math.round(m / 60));
}

const TOPIC_WORD = { moves: 'moves', liquidity: 'liquidity', beacons: 'beacons', scout: 'scout' } as const satisfies Record<Topic, keyof Words>;

/**
 * The garage agent's window (CITY-29), inside the city's one window frame (CITY-65, in a bay since CITY-84): what changed
 * on your towers since you last looked, a few heads-ups on your beacons and the scout, and one action — ask the agent,
 * then show its towers. Every tower here flies the camera to itself and lights up; nothing here buys, sells or signs.
 * Its name, what it reports on and its switch wait behind the gear.
 */
export function GarageWindow({ mine, live, reminders }: { mine: readonly MyTower[]; live: boolean; reminders: readonly Reminder[] }) {
  const view = useGarage((st) => st.view);
  const on = useGarage((st) => st.settings.on);
  // With no towers the window stands as tall as its words and its one button (`fit`, CITY-221), not as an empty pane.
  return (
    <div className={`${s.framed} ${mine.length ? '' : s.flow}`}>
      {view === 'settings' ? <Settings /> : on ? <Home mine={mine} live={live} reminders={reminders} /> : <Off />}
    </div>
  );
}

/** Fly to towers: the city shows them beside the window; where the window covers the city it steps aside first. */
function fly(towers: readonly Tower[]) {
  if (!towers.length) return;
  tick();
  flyTo(towers);
}

const BODIES = ['ready', 'thinking', 'acting', 'done'] as const;

/**
 * The agent itself at the head of its window: stills of the characters line's robot (CITY-57), rendered from the model
 * in its own studio, one for each state; the one shown is what the agent is doing now (`useBody`), crossfaded.
 */
function Portrait({ line, live }: { line: string; live: boolean }) {
  const w = useWords(GARAGE);
  const body = useBody();
  const shown = body ?? 'ready';
  return (
    <div className={`${s.portrait} ${body === null ? s.portraitOff : ''}`}>
      {BODIES.map((b) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={b} className={`${s.still} ${b === shown ? s.stillOn : ''}`} src={`/city/agent/garage-${b}.webp`} alt="" aria-hidden="true" decoding="async" />
      ))}
      <div className={s.portraitShade} aria-hidden="true" />
      <div className={s.status}>
        <span className={`${s.dot} ${live ? s.dotLive : ''}`} aria-hidden="true" />
        <span className={s.statusLine}>{line}</span>
      </div>
      <button type="button" className={`${s.icon} ${s.gear}`} aria-label={w.settings} onClick={() => useGarage.getState().setView('settings')} data-garage-gear="">
        <GearGlyph />
      </button>
    </div>
  );
}

function Home({ mine, live, reminders }: { mine: readonly MyTower[]; live: boolean; reminders: readonly Reminder[] }) {
  const w = useWords(GARAGE);
  const report = useGarage((st) => st.report);
  const advice = useGarage((st) => st.advice);
  const name = useGarage((st) => st.settings.name);
  const now = useNow(30_000);
  return (
    <>
      <Portrait line={mine.length ? w.watching(mine.length) : w.onDuty} live={live} />
      <div className={s.scroll}>
        {mine.length === 0 ? <Empty /> : <ReportBlock report={report} />}
        {reminders.length > 0 && <Reminders reminders={reminders} now={now} />}
        <AdviceBlock advice={advice} name={name} />
      </div>
      <Action mine={mine} advice={advice} name={name} />
    </>
  );
}

function Empty() {
  const w = useWords(GARAGE);
  return (
    <div className={s.empty}>
      <div className={s.emptyMark} aria-hidden="true">
        <AgentGlyph />
      </div>
      <div className={s.emptyTitle}>{w.emptyTitle}</div>
      <div className={s.emptyLine}>{w.emptyLine}</div>
    </div>
  );
}

function ReportBlock({ report }: { report: Report | null }) {
  const w = useWords(GARAGE);
  const tag = locale(useLang());
  if (!report || report.status === 'waiting') {
    return (
      <div className={s.block} aria-busy="true">
        <div className={s.kicker}>{w.report}</div>
        <div className={`${s.quiet} ${s.breathe}`}>{w.waiting}</div>
      </div>
    );
  }
  return (
    <div className={s.block} data-garage-report="">
      <div className={s.kicker}>{report.since ? w.since(clockOf(report.since, tag)) : w.today}</div>
      {report.changes.length === 0 ? (
        <div className={s.quiet}>{w.allQuiet}</div>
      ) : (
        <ul className={s.rows}>
          {report.changes.map((c) => (
            <ChangeRow key={c.tower.id} change={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChangeRow({ change }: { change: Change }) {
  const w = useWords(GARAGE);
  const good = change.kind === 'up' || change.kind === 'deeper';
  const liquidity = change.kind === 'deeper' || change.kind === 'thinner';
  return (
    <li>
      <button type="button" className={s.row} onClick={() => fly([change.tower])} aria-label={w.showIn(sym(change.tower))}>
        <Coin t={change.tower} />
        <span className={s.rowSym}>{sym(change.tower)}</span>
        {liquidity && <span className={s.tag}>{w.liquidity}</span>}
        {change.window === '24H' && <span className={s.tag}>24H</span>}
        <span className={`${s.value} ${good ? s.up : s.down}`}>{change.value}</span>
        <span className={s.fly} aria-hidden="true">
          <FlyGlyph />
        </span>
      </button>
    </li>
  );
}

function reminderLine(r: Reminder, now: number, w: Words, tag: string): { glyph: ReactNode; text: string; when: string | null; mint: string | null } {
  const beacon = <BeaconGlyph />;
  const scout = <AgentGlyph />;
  switch (r.kind) {
    case 'fired':
      return { glyph: beacon, text: w.beaconLit(sym(r)), when: ago(r.at, now, w), mint: r.mint };
    case 'ending':
      return { glyph: beacon, text: w.beaconEnds(sym(r)), when: clockOf(r.at, tag), mint: r.mint };
    case 'spent':
      return { glyph: beacon, text: w.beaconSpent(sym(r)), when: w.finished, mint: r.mint };
    case 'off':
      return { glyph: beacon, text: w.beaconOff(sym(r)), when: null, mint: r.mint };
    case 'scout-paused':
      return { glyph: scout, text: w.scoutPaused, when: r.until ? dayOf(r.until, tag) : null, mint: null };
    case 'scout-find':
      return { glyph: scout, text: w.scoutFound(sym(r)), when: null, mint: r.mint };
  }
}

function Reminders({ reminders, now }: { reminders: readonly Reminder[]; now: number }) {
  const w = useWords(GARAGE);
  const tag = locale(useLang());
  const towers = useCity((st) => st.snapshot.towers);
  return (
    <div className={s.block}>
      <div className={s.kicker}>{w.heads}</div>
      <ul className={s.rows}>
        {reminders.map((r, i) => {
          const line = reminderLine(r, now, w, tag);
          const tower = line.mint ? towers.find((t) => t.id === line.mint) : undefined;
          const inner = (
            <>
              <span className={`${s.remGlyph} ${r.kind === 'fired' ? s.remLit : ''}`}>{line.glyph}</span>
              <span className={s.remText}>{line.text}</span>
              {line.when && <span className={s.when}>{line.when}</span>}
              {tower && (
                <span className={s.fly} aria-hidden="true">
                  <FlyGlyph />
                </span>
              )}
            </>
          );
          return (
            <li key={`${r.kind}:${'mint' in r ? r.mint : i}`}>
              {tower ? (
                <button type="button" className={s.row} onClick={() => fly([tower])} aria-label={w.reminderShow(line.text)}>
                  {inner}
                </button>
              ) : (
                <div className={s.row}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AdviceBlock({ advice, name }: { advice: AdviceState; name: string }) {
  const w = useWords(GARAGE);
  const [details, setDetails] = useState(false);
  const left = useGarage((st) => st.answersLeft());
  if (advice.status === 'none') return null;
  if (advice.status === 'asking') {
    return (
      <div className={`${s.advice} ${s.breathe}`} aria-live="polite">
        <div className={s.kicker}>{w.thinking(name)}</div>
      </div>
    );
  }
  if (advice.status === 'spent') {
    return (
      <div className={s.advice} aria-live="polite">
        <div className={s.adviceLine}>{w.spent}</div>
      </div>
    );
  }
  if (advice.status === 'failed') {
    return (
      <div className={s.advice} aria-live="polite">
        <div className={s.adviceLine}>{advice.busy ? w.busy : w.noAnswer}</div>
      </div>
    );
  }
  return (
    <div className={s.advice} aria-live="polite" data-garage-advice="">
      <div className={s.kicker}>{w.says(name)}</div>
      <p className={s.adviceLine}>{advice.line}</p>
      {advice.towers.length > 0 && (
        <div className={s.chips}>
          {advice.towers.map((t) => (
            <button key={t.id} type="button" className={s.chip} onClick={() => fly([t])} aria-label={w.showIn(sym(t))}>
              <Coin t={t} size="chip" />
              {sym(t)}
            </button>
          ))}
        </div>
      )}
      <button type="button" className={s.details} aria-expanded={details} onClick={() => setDetails((d) => !d)} data-garage-details="">
        {w.details} <ChevronGlyph open={details} />
      </button>
      {details && (
        <div className={s.more}>
          {advice.more.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className={s.fine}>{w.notSignal}</p>
          <p className={s.fine}>{w.budgetsComing}</p>
          <p className={s.fine} data-garage-left="">
            {w.asksLeft(left, ADVICE_PER_DAY)}
          </p>
        </div>
      )}
    </div>
  );
}

/** The window's one action: ask, then show what the answer is about. */
function Action({ mine, advice, name }: { mine: readonly MyTower[]; advice: AdviceState; name: string }) {
  const w = useWords(GARAGE);
  const left = useGarage((st) => st.answersLeft());
  // No towers yet: the one way on is to get one — Ryntra's line takes «buy SOL» or «launch a token» (CITY-221: the
  // window used to end on its empty words with nothing to press).
  if (!mine.length) {
    return (
      <div className={s.cta}>
        <button
          type="button"
          className={s.action}
          onClick={() => {
            tick();
            openCommand();
          }}
          data-garage-action="start"
        >
          {w.emptyAction}
        </button>
      </div>
    );
  }
  const ask = () => {
    tick();
    void useGarage.getState().ask(mine);
  };
  if (advice.status === 'ready' && advice.towers.length > 0) {
    return (
      <div className={s.cta}>
        <button type="button" className={s.action} onClick={() => fly(advice.towers)} data-garage-action="show">
          {advice.towers.length === 1 ? w.showOne(sym(advice.towers[0]!)) : w.showMany(advice.towers.length)}
        </button>
        {left > 0 && (
          <button type="button" className={s.again} onClick={ask}>
            {w.again}
          </button>
        )}
      </div>
    );
  }
  const asking = advice.status === 'asking';
  const spent = left <= 0 && !asking;
  return (
    <div className={s.cta}>
      <button type="button" className={`${s.action} ${asking ? s.breathe : ''}`} disabled={asking || spent} aria-busy={asking} onClick={ask} data-garage-action="ask">
        {asking ? w.asking : spent ? w.backTomorrow : w.ask(name)}
      </button>
    </div>
  );
}

function Off() {
  const w = useWords(GARAGE);
  const name = useGarage((st) => st.settings.name);
  return (
    <>
      <Portrait line={w.offDuty} live={false} />
      <div className={s.empty}>
        <div className={s.emptyTitle}>{w.resting(name)}</div>
      </div>
      <div className={s.cta}>
        <button
          type="button"
          className={s.action}
          onClick={() => {
            tick();
            useGarage.getState().setOn(true);
          }}
        >
          {w.turnOn}
        </button>
      </div>
    </>
  );
}

function Settings() {
  const w = useWords(GARAGE);
  const settings = useGarage((st) => st.settings);
  const [draft, setDraft] = useState(settings.name);
  const [refused, setRefused] = useState(false);
  useEffect(() => setDraft(settings.name), [settings.name]);
  const keep = () => {
    if (draft.trim() === settings.name) return true;
    const ok = useGarage.getState().rename(draft);
    setRefused(!ok);
    if (!ok) setDraft(settings.name);
    return ok;
  };
  const done = () => {
    tick();
    keep();
    useGarage.getState().setView('home');
  };
  return (
    <>
      <div className={`${s.status} ${s.statusBar}`}>
        <button type="button" className={s.icon} aria-label={w.back} onClick={done}>
          <BackGlyph />
        </button>
        <span className={s.statusLine}>{w.settings}</span>
      </div>
      <div className={s.scroll}>
        <label className={s.block}>
          <span className={s.kicker}>{w.name}</span>
          <input
            className={`${s.input} ${refused ? s.inputRefused : ''}`}
            value={draft}
            maxLength={NAME_MAX}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setRefused(false);
              setDraft(e.target.value);
            }}
            onBlur={keep}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            aria-invalid={refused || undefined}
          />
        </label>
        <div className={s.block} role="group" aria-label={w.reportsOn}>
          <span className={s.kicker}>{w.reportsOn}</span>
          <div className={s.toggles}>
            {TOPIC_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                role="switch"
                aria-checked={settings.topics[t]}
                className={`${s.toggle} ${settings.topics[t] ? s.toggleOn : ''}`}
                onClick={() => {
                  tick();
                  useGarage.getState().setTopic(t, !settings.topics[t]);
                }}
              >
                {w[TOPIC_WORD[t]]}
              </button>
            ))}
          </div>
        </div>
        <div className={s.block}>
          <button
            type="button"
            role="switch"
            aria-checked={settings.on}
            className={s.switchRow}
            onClick={() => {
              tick();
              useGarage.getState().setOn(!settings.on);
            }}
          >
            <span>{w.onDuty}</span>
            <span className={`${s.switch} ${settings.on ? s.switchOn : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={s.cta}>
        <button type="button" className={s.action} onClick={done}>
          {w.done}
        </button>
      </div>
    </>
  );
}

function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}
