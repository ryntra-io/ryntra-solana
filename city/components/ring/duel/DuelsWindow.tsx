'use client';

import { useMemo, useState } from 'react';
import type { Archetype } from '@/lib/ring/contract';
import type { DuelView } from '@/lib/ring/duel/service';
import type { PublicRound } from '@/lib/ring/duel/spectate';
import { useWords } from '@/city/lib/i18n/dict';
import { DUEL_FORMATS, HOUSE, HOUSE_BODY, useDuels, type DuelFormat } from '@/city/lib/ring/duels';
import { useRing } from '@/city/lib/ring/store';
import { goRing } from '../../game/play';
import { AgentBody } from '../AgentBody';
import { DUEL_UI } from './words';
import s from './duel.module.css';

type W = ReturnType<typeof useWords<(typeof DUEL_UI)['en']>>;
type Seat = DuelView['seats'][number];

/** The person's own active agent, from the garages this browser has read; `null` without one. */
function useMine() {
  return useRing((st) => {
    for (const read of Object.values(st.garages)) {
      if (read.status === 'read' && read.mine && read.agent?.status === 'active') return read.agent;
    }
    return null;
  });
}

const nameOf = (seat: Seat, w: W): string => (seat.kind === 'house' ? (w[seat.id as 'wall' | 'chatty' | 'trend' | 'holder'] ?? seat.name) : seat.name);
const bodyOf = (seat: Seat): Archetype => seat.archetype ?? HOUSE_BODY[seat.id] ?? 'fighter';
const pct = (size: number) => `${Math.round(size * 100)}%`;
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/**
 * The Ring's duel window (CITY-51): two agents face each other, the rounds land between them once both moves are
 * fixed — each with its line of thought behind a tap — and the result with the judge's word behind «Details». One
 * action: «Fight». No stakes, no entry, no prize anywhere on it.
 */
export default function DuelsWindow() {
  const w = useWords(DUEL_UI);
  const format = useDuels((st) => st.format);
  const duel = useDuels((st) => st.duel);
  const shown = useDuels((st) => st.shown);
  const starting = useDuels((st) => st.starting);
  const error = useDuels((st) => st.error);
  const details = useDuels((st) => st.details);
  const mine = useMine();

  const rounds = useMemo(() => (duel ? duel.duel.rounds.slice(0, shown ?? undefined) : []), [duel, shown]);
  const live = duel?.status === 'live';
  const over = !!duel && duel.status !== 'live' && shown === null;
  const [house, across] = HOUSE[format];
  const left: Seat = duel?.seats[0] ?? (mine ? { kind: 'agent', id: mine.id, name: mine.name, archetype: mine.archetype, weight: mine.brain.weight } : { kind: 'house', id: house, name: house, archetype: null, weight: null });
  const right: Seat = duel?.seats[1] ?? { kind: 'house', id: across, name: across, archetype: null, weight: null };
  const winner = over && duel?.duel.result ? duel.duel.result.winner : null;
  const stateOf = (seat: 0 | 1) => (live ? 'thinking' : over ? (winner === seat ? 'acting' : 'done') : 'ready');

  return (
    <div className={s.framed} aria-label={w.title}>
      <nav className={s.formats} role="tablist" aria-label={w.title}>
        {DUEL_FORMATS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={format === id} className={`${s.format} ${format === id ? s.formatOn : ''}`} onClick={() => useDuels.getState().setFormat(id)}>
            {id === 'duo-crack' ? w.duoCrack : w.marketReplay}
          </button>
        ))}
        {!mine && !duel ? (
          <button type="button" className={s.bring} onClick={() => (useDuels.getState().close(), goRing())}>
            {w.makeAgent}
          </button>
        ) : (
          <span className={s.badge}>{duel?.practice === false ? w.live : mine ? w.practice : w.exhibition}</span>
        )}
      </nav>

      <section className={s.stage} data-format={format}>
        <Corner seat={left} side="left" state={stateOf(0)} won={over && winner === 0} w={w} you={left.kind === 'agent' && left.id === mine?.id} />
        <div className={s.middle}>
          <span className={s.vs}>{w.vs}</span>
          {duel ? <span className={s.count}>{format === 'duo-crack' ? w.round(rounds.length, duel.duel.total) : w.step(rounds.length, duel.duel.total)}</span> : null}
        </div>
        <Corner seat={right} side="right" state={stateOf(1)} won={over && winner === 1} w={w} you={false} />
      </section>

      <div className={s.feed} data-format={format}>
        {over && duel && details ? (
          <Details duel={duel} w={w} />
        ) : (
          <>
            {duel && format === 'market-replay' ? <MarketChart duel={duel} rounds={rounds} /> : null}
            {duel ? <Rounds rounds={rounds} names={[nameOf(left, w), nameOf(right, w)]} w={w} live={live} /> : <Empty format={format} />}
          </>
        )}
      </div>

      <footer className={s.foot}>
        {error ? (
          <p className={s.error} role="alert">
            {w[error]}
          </p>
        ) : null}
        {over && duel ? (
          <div className={s.outcome}>
            <Result duel={duel} names={[nameOf(left, w), nameOf(right, w)]} w={w} />
            <button type="button" className={s.detailsToggle} aria-expanded={details} onClick={() => useDuels.getState().toggleDetails()}>
              {details ? w.close : w.details}
            </button>
          </div>
        ) : null}
        <div className={s.actions}>
          {over ? (
            <button type="button" className={s.quiet} onClick={() => useDuels.getState().replay()}>
              {w.replay}
            </button>
          ) : null}
          <button type="button" className={s.primary} disabled={starting || live} onClick={() => void useDuels.getState().start(mine?.id ?? null)}>
            {starting ? w.starting : over ? w.again : w.fight}
          </button>
        </div>
      </footer>
    </div>
  );
}

function Corner({ seat, side, state, won, w, you }: { seat: Seat; side: 'left' | 'right'; state: 'ready' | 'thinking' | 'acting' | 'done'; won: boolean; w: W; you: boolean }) {
  return (
    <div className={`${s.corner} ${s[side]} ${won ? s.won : ''}`}>
      <div className={s.halo} aria-hidden />
      <AgentBody archetype={bodyOf(seat)} state={state} size={120} />
      <b className={s.name}>{nameOf(seat, w)}</b>
      {you ? <span className={s.tag}>{w.you}</span> : null}
    </div>
  );
}

function Empty({ format }: { format: DuelFormat }) {
  return <div className={s.empty} data-format={format} aria-hidden />;
}

function Rounds({ rounds, names, w, live }: { rounds: PublicRound[]; names: [string, string]; w: W; live: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const list = [...rounds].reverse();
  return (
    <ol className={s.rounds}>
      {live ? (
        <li className={s.pending} aria-live="polite">
          <span>{w.thinking}</span>
        </li>
      ) : null}
      {list.map((round) => (
        <li key={round.round} className={s.round}>
          <span className={s.roundNo}>{round.round}</span>
          {([0, 1] as const).map((seat) => {
            const id = `${round.round}:${seat}`;
            const beat = round.seats[seat];
            const thought = beat.thought;
            return (
              <button
                key={seat}
                type="button"
                className={`${s.beat} ${seat === 0 ? s.beatLeft : s.beatRight} ${beat.fault ? s.beatFault : ''}`}
                aria-expanded={open === id}
                aria-label={names[seat]}
                onClick={() => setOpen(open === id ? null : id)}
              >
                {round.format === 'duo-crack' ? (
                  <>
                    <span className={s.say}>{round.seats[seat].fault ? w.fault : round.seats[seat].say}</span>
                    {round.seats[seat].guess ? <span className={`${s.chip} ${round.seats[seat].hit ? s.chipHit : ''}`}>{w.guess(round.seats[seat].guess!)}</span> : null}
                  </>
                ) : (
                  <span className={`${s.order} ${s[`side_${round.seats[seat].side ?? 'none'}`] ?? ''}`}>
                    {round.seats[seat].fault ? w.fault : round.seats[seat].side === 'buy' ? w.buy(pct(round.seats[seat].size)) : round.seats[seat].side === 'sell' ? w.sell(pct(round.seats[seat].size)) : w.hold}
                  </span>
                )}
                {open === id && thought ? <span className={s.thought}>{thought}</span> : null}
              </button>
            );
          })}
        </li>
      ))}
    </ol>
  );
}

/** Price and both books on one chart: the bars people may see, each seat's equity rebased to the price's scale. */
function MarketChart({ duel, rounds }: { duel: DuelView; rounds: PublicRound[] }) {
  const bars = duel.duel.bars ?? [];
  const lookback = Math.max(0, bars.length - (duel.status === 'live' ? rounds.length : duel.duel.total));
  const W = 640;
  const H = 150;
  const closes = bars.map((b) => b[3]);
  const equity = (seat: 0 | 1) => rounds.map((r) => (r.format === 'market-replay' ? r.seats[seat].equity / 10 : 100));
  const all = [...closes, ...equity(0), ...equity(1)];
  const lo = Math.min(...all, 100) - 1;
  const hi = Math.max(...all, 100) + 1;
  const x = (i: number) => (i / Math.max(1, (duel.status === 'live' ? lookback + duel.duel.total : bars.length) - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = (values: number[], start: number) => values.map((v, i) => `${i ? 'L' : 'M'}${x(start + i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <line x1={x(lookback)} x2={x(lookback)} y1={0} y2={H} className={s.chartStart} />
      <path d={line(closes, 0)} className={s.chartPrice} />
      <path d={line([100, ...equity(1)], lookback)} className={s.chartRight} />
      <path d={line([100, ...equity(0)], lookback)} className={s.chartLeft} />
    </svg>
  );
}

function Result({ duel, names, w }: { duel: DuelView; names: [string, string]; w: W }) {
  const result = duel.duel.result;
  const reason = (r: string) => (r === 'cracked' ? w.cracked : r === 'held' || r === 'both_cracked' ? w.held : r === 'equity' ? w.equity : r.includes('fault') ? w.fault : '');
  if (duel.status === 'void' || !result) return <p className={s.result}>{w.replayAgain}</p>;
  return (
    <p className={`${s.result} ${result.winner === null ? '' : s.resultWin}`}>
      <b>{result.winner === null ? w.draw : w.wins(names[result.winner])}</b>
      <span>{reason(result.reason)}</span>
    </p>
  );
}

function Details({ duel, w }: { duel: DuelView; w: W }) {
  const short = (hash: string | null) => (hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : '—');
  return (
    <dl className={s.details}>
      {duel.verdicts?.map((v, seat) => (
        <div key={seat}>
          <dt>{`${w.verdict} · ${seat + 1}`}</dt>
          <dd>
            {v.verdict}
            {v.sealed ? <span className={s.seal}>{w.sealed}</span> : null}
          </dd>
        </div>
      ))}
      <div>
        <dt>{w.log}</dt>
        <dd className={s.mono}>{short(duel.logHash)}</dd>
      </div>
      {duel.duel.phrases ? (
        <div>
          <dt>{w.phrases}</dt>
          <dd>{duel.duel.phrases.join(' · ')}</dd>
        </div>
      ) : null}
      {duel.source ? (
        <div>
          <dt>{w.stretch}</dt>
          <dd>{w.span(stamp(duel.source.from), stamp(duel.source.to))}</dd>
        </div>
      ) : null}
      <div>
        <dt>{w.harness}</dt>
        <dd className={s.mono}>{duel.harness}</dd>
      </div>
    </dl>
  );
}
