'use client';

import { useEffect, useMemo, useState } from 'react';
import { simulate } from '@/city/lib/bots/sim';
import { ageDays, copyGate, groupByAge, latest, type Strategy } from '@/city/lib/bots/strategies';
import { useBotsWindow } from '@/city/lib/bots/open';
import { useBots } from '@/city/lib/bots/store';
import { day, pct, signedUsd } from '@/city/lib/bots/format';
import { Spark } from './BotChart';
import { Figure } from './BotDetail';
import { Empty } from './Hangar';
import { KindGlyph } from './glyphs';
import { useCoinByMint, useNow, useWords } from './hooks';
import s from './bots.module.css';

/**
 * «Стратегії»: yours and shared, oldest first, every one with its drawdown — closed and losing ones stay. Copying
 * another's settings waits for enough history; a paper twin shows the same settings run on paper from the day it was
 * saved.
 */
export function Strategies() {
  const strategies = useBots((st) => st.strategies);
  const now = useNow();
  const coinBy = useCoinByMint();
  const { w } = useWords();
  useEffect(() => {
    for (const mint of new Set(strategies.map((x) => latest(x).draft.pair.mint))) {
      const coin = coinBy(mint);
      if (coin) void useBots.getState().loadPath(coin);
    }
  }, [strategies, coinBy]);
  const groups = useMemo(() => groupByAge(strategies, now), [strategies, now]);
  if (!strategies.length) return <Empty title={w.noStrategies} action={w.startOne} onAction={() => useBotsWindow.getState().setTab('launch')} />;
  return (
    <div className={s.groups}>
      {groups.map((g) => (
        <section key={g.bucket} className={s.section} aria-label={w.bucket[g.bucket]}>
          <h3 className={s.kicker}>{w.bucket[g.bucket]}</h3>
          <ul className={s.list}>
            {g.strategies.map((x) => (
              <StrategyItem key={x.id} strategy={x} now={now} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StrategyItem({ strategy, now }: Readonly<{ strategy: Strategy; now: number }>) {
  const { w, lang } = useWords();
  const [twin, setTwin] = useState(false);
  const version = latest(strategy);
  const draft = version.draft;
  const gate = copyGate(strategy, now);
  const record = strategy.record;
  const closed = strategy.closedAt !== null;
  return (
    <li className={s.strategy} data-closed={closed ? '' : undefined}>
      <div className={s.strategyHead}>
        <span className={s.cardGlyph}>
          <KindGlyph kind={draft.kind} />
        </span>
        <span className={s.botText}>
          <span className={s.botName}>
            <b>{strategy.name}</b>
            <i className={s.version}>{w.version(strategy.versions.length)}</i>
            {closed ? <i className={s.status} data-status="stopped">{w.closed}</i> : null}
          </span>
          <span className={s.botFill}>
            {strategy.owner === 'me' ? w.yours : w.by(strategy.author ?? '—')} · {w.kind[draft.kind]} · <span translate="no">{draft.pair.symbol}</span> · {w.days(ageDays(strategy, now))}
            {strategy.forkOf ? ` · ${w.forkOf(strategy.forkOf.name)}` : ''}
          </span>
        </span>
      </div>
      <div className={s.figures}>
        <Figure label={w.record} value={record ? pct(record.returnPct, lang, true) : '—'} tone={record ? (record.returnPct >= 0 ? 'up' : 'down') : undefined} />
        <Figure label={w.drawdown} value={record ? pct(-record.maxDrawdownPct, lang) : '—'} />
        <Figure label={w.fills} value={record ? String(record.trades) : '—'} />
      </div>
      {!record ? <p className={s.hint}>{w.noRecord}</p> : null}
      <div className={s.controlRow}>
        <button type="button" className={gate.ok ? s.strong : s.control} disabled={!gate.ok} onClick={() => useBots.getState().copySettings(strategy.id)}>
          {gate.ok ? w.copy : w.copyIn(gate.daysLeft)}
        </button>
        <button type="button" className={s.control} disabled={!gate.ok} onClick={() => void useBots.getState().fork(strategy.id)}>
          {w.fork}
        </button>
        <button type="button" className={s.control} aria-pressed={twin} onClick={() => setTwin((v) => !v)}>
          {w.twin}
        </button>
        {strategy.owner === 'me' && !closed ? (
          <button type="button" className={s.control} onClick={() => useBots.getState().closeStrategy(strategy.id)}>
            {w.closeStrategy}
          </button>
        ) : null}
      </div>
      {twin ? <Twin strategy={strategy} /> : null}
    </li>
  );
}

function Twin({ strategy }: Readonly<{ strategy: Strategy }>) {
  const { w, lang } = useWords();
  const draft = latest(strategy).draft;
  const path = useBots((st) => st.paths[draft.pair.mint]);
  const from = strategy.twinFrom ?? strategy.createdAt;
  const run = useMemo(() => (path?.bars.length ? simulate(draft, path.bars.filter((b) => b.t >= from - 3_600_000)) : null), [draft, path, from]);
  return (
    <div className={s.twin}>
      <span className={s.kicker}>{w.twinSince(day(from, lang))}</span>
      <div className={s.twinRow}>
        <Spark run={run} width={140} height={40} />
        <Figure label={w.bot} value={run ? signedUsd(run.pnlUsd, lang) : '—'} tone={run ? (run.pnlUsd >= 0 ? 'up' : 'down') : undefined} />
        <Figure label={w.hold} value={run ? signedUsd(run.holdPnlUsd, lang) : '—'} />
        <Figure label={w.drawdown} value={run ? pct(-run.maxDrawdownPct, lang) : '—'} />
      </div>
    </div>
  );
}
