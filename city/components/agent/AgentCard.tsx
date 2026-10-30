'use client';

import { useMemo } from 'react';
import { playTick } from '@/city/lib/audio/engine';
import { askRyntra } from '@/city/lib/agent/advice';
import { AREA_ORDER, AREAS, BUDGETS, factShown, LIQUIDITY, ruleLine, SIGNAL_ORDER, SIGNALS, usd as usdRaw, windowText, withSignal, type Rule } from '@/city/lib/agent/rule';
import { dateText, digits, useWords, type TextKey } from '@/city/lib/i18n/dict';
import { leftInWeek } from '@/city/lib/agent/scout';
import { useAgent, type Find } from '@/city/lib/agent/store';
import { useCity } from '@/city/lib/city/store';
import { ticker } from '@/city/lib/trade/format';
import { useTrade } from '@/city/lib/trade/store';
import { AgentGlyph, CloseGlyph } from '../hud/glyphs';
import hud from '../hud/hud.module.css';
import s from './agent.module.css';
import { AGENT } from './words';

/** Dollars for the eye, in the language on screen. */
const usd = (v: number) => digits(usdRaw(v));

/** The buy from a find is the tower's own trade card, with the same switch as the tower card's button. */
const TRADE_OPEN = process.env.NEXT_PUBLIC_RYNTRA_CITY_TRADE !== 'closed';

/** The scout owns the card above the dock: its rule or status is open, or the drone hangs over a find. */
export function useAgentCard(): boolean {
  return useAgent((st) => st.panel !== 'none' || (st.find !== null && st.arrived));
}

/** The scout's one card: a find when the drone is over it, else the rule or the status the person opened. */
export function AgentCard() {
  const find = useAgent((st) => (st.arrived ? st.find : null));
  const panel = useAgent((st) => st.panel);
  if (find) return <FindCard find={find} />;
  if (panel === 'rule') return <RuleCard />;
  if (panel === 'status') return <StatusCard />;
  return null;
}

const tick = () => {
  if (useCity.getState().sound) playTick();
};

function Head({ kicker, title, live }: { kicker: string; title: string; live?: boolean }) {
  const close = useAgent((st) => st.closePanel);
  const w = useWords(AGENT);
  return (
    <div className={s.head}>
      <div className={s.headText}>
        <div className={hud.kicker}>
          {live ? <span className={`${hud.pulse} ${s.pulseAmber}`} aria-hidden="true" /> : <span className={s.kickGlyph}><AgentGlyph /></span>}
          {kicker}
        </div>
        <div className={`${hud.display} ${hud.slotTitle}`}>{title}</div>
      </div>
      <button className={hud.close} aria-label={w.close} onClick={close}>
        <CloseGlyph />
      </button>
    </div>
  );
}

function Choices<T extends string | number>({ label, hint, options, value, name, onPick }: { label: string; hint?: string; options: readonly T[]; value: T; name: (v: T) => string; onPick: (v: T) => void }) {
  return (
    <div className={s.group} role="radiogroup" aria-label={label}>
      <div className={s.groupLabel}>{label}</div>
      <div className={s.chips}>
        {options.map((o) => (
          <button
            key={String(o)}
            role="radio"
            aria-checked={o === value}
            className={`${s.chip} ${o === value ? s.chipOn : ''}`}
            onClick={() => {
              tick();
              onPick(o);
            }}
          >
            {name(o)}
          </button>
        ))}
      </div>
      {hint && <div className={s.groupHint}>{hint}</div>}
    </div>
  );
}

/** The rule, from fixed choices only: there is nothing to type, so nothing typed can become an amount. */
function RuleCard() {
  const draft = useAgent((st) => st.draft);
  const on = useAgent((st) => st.on);
  const setDraft = useAgent((st) => st.setDraft);
  const launch = useAgent((st) => st.launch);
  const set = (next: Partial<Rule>) => setDraft({ ...draft, ...next });
  const signal = SIGNALS[draft.signal];
  const sign = draft.signal === 'dip24h' ? '−' : '+';
  const w = useWords(AGENT);
  return (
    <div className={`${hud.panel} ${hud.slot} ${s.slot}`}>
      <Head kicker={w.scout} title={on ? w.changeRule : w.yourRule} />
      <Choices label={w.lookFor} options={SIGNAL_ORDER} value={draft.signal} name={(v) => SIGNALS[v].label} onPick={(v) => setDraft(withSignal(draft, v))} />
      <Choices label={w.moveIn(windowText(signal.window))} options={signal.moves} value={draft.move} name={(v) => `${sign}${v}%`} onPick={(v) => set({ move: v })} />
      <Choices label={w.liquidityFrom} options={LIQUIDITY} value={draft.liquidity} name={usd} onPick={(v) => set({ liquidity: v })} />
      <Choices label={w.where} options={AREA_ORDER} value={draft.area} name={(v) => AREAS[v]} onPick={(v) => set({ area: v })} />
      <Choices
        label={w.pauseAfter}
        hint={w.pauseHint}
        options={BUDGETS}
        value={draft.budget}
        name={usd}
        onPick={(v) => set({ budget: v })}
      />
      <button
        className={`${hud.display} ${hud.action}`}
        onClick={() => {
          tick();
          launch();
        }}
      >
        {on ? w.flyWithRule : w.launchScout}
      </button>
      <div className={hud.note}>{w.ruleNote}</div>
    </div>
  );
}

const STATUS: Record<'patrol' | 'quiet' | 'waiting' | 'resting' | 'found' | 'off', TextKey<typeof AGENT>> = {
  patrol: 'patrol',
  found: 'found',
  quiet: 'quiet',
  waiting: 'waiting',
  resting: 'resting',
  off: 'off',
};

function StatusCard() {
  const rule = useAgent((st) => st.rule);
  const phase = useAgent((st) => st.phase);
  const until = useAgent((st) => st.until);
  const ledger = useAgent((st) => st.ledger);
  const edit = useAgent((st) => st.edit);
  const stop = useAgent((st) => st.stop);
  const w = useWords(AGENT);
  const left = leftInWeek(rule.budget, ledger, Date.now());
  const line =
    phase === 'resting'
      ? w.looksAgain(until ? dateText(new Date(until), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null)
      : phase === 'waiting'
        ? w.waitingLine
        : phase === 'quiet'
          ? w.quietLine
          : w.patrolLine;
  return (
    <div className={`${hud.panel} ${hud.slot} ${s.slot}`}>
      <Head kicker={w.flying} title={w[STATUS[phase]]} live />
      <div className={hud.hotLine}>{line}</div>
      <div className={s.rule}>{ruleLine(rule)}</div>
      <Budget left={left} budget={rule.budget} />
      <div className={hud.pair}>
        <button
          className={`${hud.display} ${hud.action}`}
          onClick={() => {
            tick();
            edit();
          }}
        >
          {w.changeRule}
        </button>
        <button className={hud.quiet} onClick={stop}>
          {w.land}
        </button>
      </div>
    </div>
  );
}

function Budget({ left, budget }: { left: number; budget: number }) {
  const share = budget > 0 ? Math.max(0, Math.min(1, left / budget)) : 0;
  const w = useWords(AGENT);
  return (
    <div className={s.budget}>
      <div className={s.budgetLine}>
        <span>{w.untilPause}</span>
        <b>
          {usd(left)} <small>{w.of(usd(budget))}</small>
        </b>
      </div>
      <div className={s.bar} aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

/** The find: why this tower, in the city's own figures, and one button to the tower's trade card. */
function FindCard({ find }: { find: Find }) {
  const rule = useAgent((st) => st.rule);
  const ledger = useAgent((st) => st.ledger);
  const advice = useAgent((st) => st.advice);
  const layout = useCity((st) => st.layout);
  // The tower as the city reads it now; the find's own copy if it has left the read.
  const tower = useMemo(() => layout.towers.find((p) => p.tower.id === find.tower.id)?.tower ?? find.tower, [layout, find]);
  const left = leftInWeek(rule.budget, ledger, Date.now());
  const sym = ticker(tower.symbol);
  const w = useWords(AGENT);

  const open = () => {
    tick();
    useAgent.getState().bring();
    useCity.getState().select(tower.id);
    // The person's own trade card for this tower: they pick the amount and sign in their wallet. The scout signs nothing.
    if (TRADE_OPEN) useTrade.getState().openFor(tower);
  };
  const ask = async () => {
    useAgent.getState().setAdvice({ status: 'loading', mint: tower.id });
    const answer = await askRyntra(tower, find.facts);
    // A skip or a new find while Ryntra was thinking: this answer is for a card that is gone.
    if (useAgent.getState().find?.tower.id !== tower.id) return;
    useAgent.getState().setAdvice(answer.ok ? { status: 'ready', mint: tower.id, lines: answer.lines } : { status: 'error', mint: tower.id, message: answer.message });
  };
  const said = advice.status !== 'none' && advice.mint === tower.id ? advice : null;

  return (
    <div className={`${hud.panel} ${hud.slot} ${s.slot} ${s.find}`} role="dialog" aria-label={w.scoutFoundOf(sym)}>
      <div className={s.head}>
        <div className={s.headText}>
          <div className={`${hud.kicker} ${s.kickMint}`}>
            <span className={s.kickGlyph}>
              <AgentGlyph />
            </span>
            {w.scoutFound}
          </div>
          <div className={s.findRow}>
            <span className={`${hud.display} ${hud.hotSym}`}>{sym}</span>
            <span className={s.findName}>{tower.name}</span>
          </div>
        </div>
        <button className={hud.close} aria-label={w.skip} onClick={() => useAgent.getState().skip()}>
          <CloseGlyph />
        </button>
      </div>
      <div className={s.whyTitle}>{w.whyTower}</div>
      <div className={s.facts}>
        {find.facts.map((f) => {
          const shown = factShown(f);
          return (
            <div className={s.fact} key={f.label}>
              <div className={hud.cellLabel}>{shown.label}</div>
              <div className={hud.cellValue}>{shown.value}</div>
              <div className={s.factNote}>{shown.note}</div>
            </div>
          );
        })}
      </div>
      <Budget left={left} budget={rule.budget} />
      {said && (
        <div className={s.advice} aria-live="polite">
          <div className={s.adviceTitle}>{w.adviceTitle}</div>
          {said.status === 'loading' ? <p>{w.asking}</p> : said.status === 'error' ? <p>{said.message}</p> : said.lines.map((l) => <p key={l}>{l}</p>)}
        </div>
      )}
      <div className={hud.pair}>
        <button className={`${hud.display} ${hud.action} ${s.buy}`} onClick={open}>
          {TRADE_OPEN ? w.buy(sym) : w.open(sym)}
        </button>
        {!said && (
          <button className={`${hud.quiet} ${s.ask}`} onClick={() => void ask()}>
            {w.ask}
          </button>
        )}
      </div>
      <div className={hud.note}>{w.findNote}</div>
    </div>
  );
}
