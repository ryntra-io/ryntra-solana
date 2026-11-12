'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Archetype } from '@/lib/ring/contract';
import type { DuelView } from '@/lib/ring/duel/service';
import type { PublicRound } from '@/lib/ring/duel/spectate';
import { num, useWords } from '@/city/lib/i18n/dict';
import { useCityAccount, useReadiness } from '@/city/lib/quarter/account-live';
import { arenaStore, entryWord, fighterOf, useArena, type ArenaTab } from '@/city/lib/ring/arena';
import { HOUSE, HOUSE_BODY, RING_DUELS_OPEN, useDuels, type DuelFormat } from '@/city/lib/ring/duels';
import { agentLabel } from '@/city/lib/ring/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { AgentTab } from '../arena/AgentTab';
import { BoardTab } from '../arena/BoardTab';
import a from '../arena/arena.module.css';
import { AgentBody } from '../AgentBody';
import { DUEL_UI, ENTRY_WORDS } from './words';
import s from './duel.module.css';

type W = ReturnType<typeof useWords<(typeof DUEL_UI)['en']>>;
type Seat = DuelView['seats'][number];

const nameOf = (seat: Seat, w: W): string =>
  seat.kind === 'house' ? (w[seat.id as 'wall' | 'chatty' | 'trend' | 'holder'] ?? seat.name) : seat.archetype ? agentLabel(seat.archetype) : seat.name;
const bodyOf = (seat: Seat): Archetype => seat.archetype ?? HOUSE_BODY[seat.id] ?? 'fighter';
const pct = (size: number) => `${Math.round(size * 100)}%`;
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/** The tabs on screen: the fight only where the duels' own switch is open. */
const TABS: readonly ArenaTab[] = RING_DUELS_OPEN ? ['fight', 'agent', 'board'] : ['agent', 'board'];
const TAB_WORD = { fight: 'tabFight', agent: 'tabAgent', board: 'tabBoard' } as const;

/**
 * The Arena's Ring window (CITY-51, CITY-217): three tabs — «Fight», «Agent», «Rating». The fight: two agents face
 * each other, the rounds land between them once both moves are fixed — each with its line of thought behind a tap —
 * and the result with the judge's word behind «Details». Your agent spars with the house or fights a rival of its
 * class for rating; one action: «Fight». No stakes, no entry, no prize anywhere on it.
 */
export default function ArenaWindow() {
  const w = useWords(DUEL_UI);
  const tab = useArena((st) => (TABS.includes(st.tab) ? st.tab : TABS[0]!));
  const readiness = useReadiness();

  // A sign-in anywhere in the city (the top bar's wallet too) changes whose agent stands here.
  useEffect(() => {
    if (readiness === 'ready' || readiness === 'wallet') void arenaStore.getState().readMine();
  }, [readiness]);

  return (
    <div className={s.framed} aria-label={w.title}>
      <nav className={a.tabs} role="tablist" aria-label={w.title}>
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={[a.tab, tab === id && a.tabOn].filter(Boolean).join(' ')} onClick={() => arenaStore.getState().setTab(id)} data-arena-tab={id}>
            {w[TAB_WORD[id]]}
          </button>
        ))}
      </nav>
      {tab === 'fight' ? <FightTab /> : tab === 'agent' ? <AgentTab /> : <BoardTab />}
    </div>
  );
}

/** The fight: your agent (or the house) in the left corner, the house or a rival across. */
function FightTab() {
  const w = useWords(DUEL_UI);
  const format = useDuels((st) => st.format);
  const formats = useDuels((st) => st.formats);
  const mode = useDuels((st) => st.mode);
  const duel = useDuels((st) => st.duel);
  const shown = useDuels((st) => st.shown);
  const starting = useDuels((st) => st.starting);
  const error = useDuels((st) => st.error);
  const details = useDuels((st) => st.details);
  const mineRead = useArena((st) => st.mine);
  const signing = useArena((st) => st.signing);
  // A wallet already connected is asked to sign in, not to connect again (CITY-239).
  const connected = useWallet((st) => Boolean(st.connection));
  // The sign-in also runs from the wallet's own list and panel: the button follows it there too.
  const entering = useCityAccount((st) => st.step === 'connecting' || st.step === 'signing' || st.step === 'opening');
  const mine = fighterOf(mineRead);
  const signedOut = mineRead.status === 'read' && !mineRead.signedIn;

  const rounds = useMemo(() => (duel ? duel.duel.rounds.slice(0, shown ?? undefined) : []), [duel, shown]);
  const live = duel?.status === 'live';
  const over = !!duel && duel.status !== 'live' && shown === null;
  const rated = !!mine && mode === 'rated';
  const [house, across] = HOUSE[format];
  const left: Seat = duel?.seats[0] ?? (mine ? { kind: 'agent', id: mine.id, name: mine.name, archetype: mine.archetype, weight: mine.brain.weight } : { kind: 'house', id: house, name: house, archetype: null, weight: null });
  const right: Seat | null = duel?.seats[1] ?? (rated ? null : { kind: 'house', id: across, name: across, archetype: null, weight: null });
  const winner = over && duel?.duel.result ? duel.duel.result.winner : null;
  const stateOf = (seat: 0 | 1) => (live ? 'thinking' : over ? (winner === seat ? 'acting' : 'done') : 'ready');
  const yours = !!duel && !!mine && duel.seats.some((seat) => seat.id === mine.id);

  // A rated fight of yours that ends moves your rating: read your agent and the board again, and show the move.
  const ratingNow = mine?.ratings.find((r) => r.format === format)?.rating ?? null;
  const [before, setBefore] = useState<number | null>(null);
  const ended = !!duel && duel.status !== 'live';
  useEffect(() => {
    if (!ended || !yours || duel?.practice !== false) return;
    void arenaStore.getState().readMine();
    void arenaStore.getState().readBoard(duel.format);
  }, [ended, yours, duel?.practice, duel?.format, duel?.id]);
  const delta = over && yours && duel?.practice === false && before !== null && ratingNow !== null ? ratingNow - before : null;

  const fight = () => {
    if (signedOut || error === 'signIn') return void arenaStore.getState().signIn();
    setBefore(rated ? ratingNow : null);
    void useDuels.getState().start(mine?.id ?? null);
  };

  return (
    <>
      <div className={s.formats}>
        <div className={a.pills} role="tablist" aria-label={w.title}>
          {formats.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={format === id} className={`${s.format} ${format === id ? s.formatOn : ''}`} onClick={() => useDuels.getState().setFormat(id)}>
              {id === 'duo-crack' ? w.duoCrack : w.marketReplay}
            </button>
          ))}
        </div>
        {mine ? (
          <div className={a.mode} role="radiogroup" aria-label={w.tabFight}>
            {(['practice', 'rated'] as const).map((id) => (
              <button key={id} type="button" role="radio" aria-checked={mode === id} className={[a.modeOption, mode === id && a.modeOn].filter(Boolean).join(' ')} disabled={live || starting} onClick={() => useDuels.getState().setMode(id)} data-duel-mode={id}>
                {id === 'practice' ? w.practice : w.rated}
              </button>
            ))}
          </div>
        ) : mineRead.signedIn && !duel ? (
          <button type="button" className={s.bring} onClick={() => void arenaStore.getState().makeAgent()}>
            {w.makeAgent}
          </button>
        ) : duel ? (
          <span className={s.badge}>{duel.practice === false ? w.live : yours ? w.practice : w.exhibition}</span>
        ) : null}
      </div>

      <section className={s.stage} data-format={format}>
        <Corner seat={left} side="left" state={stateOf(0)} won={over && winner === 0} w={w} you={left.kind === 'agent' && left.id === mine?.id} />
        <div className={s.middle}>
          <span className={s.vs}>{w.vs}</span>
          {duel ? <span className={s.count}>{format === 'duo-crack' ? w.round(rounds.length, duel.duel.total) : w.step(rounds.length, duel.duel.total)}</span> : null}
        </div>
        {right ? <Corner seat={right} side="right" state={stateOf(1)} won={over && winner === 1} w={w} you={false} /> : <Unknown w={w} />}
      </section>

      <div className={s.feed} data-format={format}>
        {over && duel && details ? (
          <Details duel={duel} w={w} />
        ) : duel ? (
          <>
            {format === 'market-replay' ? <MarketChart duel={duel} rounds={rounds} /> : null}
            <Rounds rounds={rounds} names={[nameOf(left, w), right ? nameOf(right, w) : w.rival]} w={w} live={live} />
          </>
        ) : (
          <Latest format={format} w={w} />
        )}
      </div>

      <footer className={s.foot}>
        {error && error !== 'signIn' ? (
          <p className={s.error} role="alert">
            {w[error]}
          </p>
        ) : null}
        {over && duel ? (
          <div className={s.outcome}>
            <Result duel={duel} names={[nameOf(left, w), right ? nameOf(right, w) : w.rival]} w={w} />
            {delta !== null && ratingNow !== null ? (
              <span className={[a.delta, delta > 0 && a.deltaUp, delta < 0 && a.deltaDown].filter(Boolean).join(' ')}>
                {w.rating(num(ratingNow))} {delta > 0 ? `+${num(delta)}` : delta < 0 ? `−${num(-delta)}` : '±0'}
              </span>
            ) : null}
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
          {duel && !live && !yours && !starting ? (
            <button type="button" className={s.quiet} onClick={() => useDuels.getState().clear()}>
              {w.newFight}
            </button>
          ) : null}
          <button type="button" className={s.primary} disabled={starting || live || signing || (entering && signedOut) || mineRead.status === 'reading'} aria-busy={starting || signing} onClick={fight} data-duel-fight="">
            {signedOut || error === 'signIn' ? w[ENTRY_WORDS[entryWord(connected, signing || entering)]] : starting ? w.starting : over && yours ? w.again : w.fight}
          </button>
        </div>
      </footer>
    </>
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

/** The rival's corner before the draw: a dim body and a question. */
function Unknown({ w }: { w: W }) {
  return (
    <div className={`${s.corner} ${s.right}`}>
      <div className={s.halo} aria-hidden />
      <AgentBody archetype="fighter" dim size={120} />
      <b className={s.name}>{w.rival}</b>
    </div>
  );
}

/** Before a fight: the latest duels anyone may watch, live ones first; a tap puts one on the stage. */
function Latest({ format, w }: { format: DuelFormat; w: W }) {
  const recent = useDuels((st) => st.recent);
  const list = [...recent.duels].sort((x, y) => Number(y.status === 'live') - Number(x.status === 'live'));
  if (recent.status === 'failed' && !list.length) {
    return (
      <div className={a.note}>
        <span>{w.readFailed}</span>
        <button type="button" className={a.retry} onClick={() => void useDuels.getState().readRecent()}>
          {w.tryAgain}
        </button>
      </div>
    );
  }
  if (!list.length) return <div className={s.empty} data-format={format} aria-busy={recent.status === 'reading'} aria-hidden />;
  return (
    <section className={a.latest} aria-label={w.latest}>
      <h3 className={a.latestTitle}>{w.latest}</h3>
      <ol className={a.latestList}>
        {list.slice(0, 8).map((d) => {
          const [l, r] = d.seats;
          const result = d.duel.result;
          return (
            <li key={d.id}>
              <button type="button" className={a.latestRow} aria-label={w.watch(nameOf(l, w), nameOf(r, w))} onClick={() => useDuels.getState().watch(d)}>
                <span className={[a.latestSeat, result?.winner === 0 && a.latestWon].filter(Boolean).join(' ')}>
                  <AgentBody archetype={bodyOf(l)} size={28} />
                  {nameOf(l, w)}
                </span>
                <span className={a.latestMid}>{d.status === 'live' ? <i className={a.liveDot}>{w.liveNow}</i> : d.format === 'duo-crack' ? w.duoCrack : w.marketReplay}</span>
                <span className={[a.latestSeat, a.latestRight, result?.winner === 1 && a.latestWon].filter(Boolean).join(' ')}>
                  {nameOf(r, w)}
                  <AgentBody archetype={bodyOf(r)} size={28} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
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
