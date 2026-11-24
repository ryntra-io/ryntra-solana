'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { pctText } from '@/city/lib/autopilot/plan-line';
import { testNow, useAutopilot } from '@/city/lib/autopilot/store';
import { useMandate } from '@/city/lib/bots/mandate';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { SOL } from '@/city/lib/trade/tiles';
import type { MoneyBot } from '@/lib/bots/money/gates';
import type { SignalKind } from '@/lib/bots/money/rules';
import { planFrom, planText } from '@/lib/mandate/plans';
import { Trader } from '@/terminal/agents/NewAgent';
import { History } from '@/terminal/agents/Mine';
import { useAgentsData } from '@/terminal/agents/useAgentsData';
import { Kick, Segment } from '@/terminal/ui';
import { BotChart } from './BotChart';
import { BudgetMine, useMandateNote, useSolUsd, useStop } from './Budget';
import { botMoneyShown, GRID_LEVEL_PICKS, GRID_START, GRID_STEPS, gridPlanOf, publicMoney, rowBot, SIGNAL_NUMBERS, SIGNAL_PICKS, signalPlanOf, triggerNumber, triggerOf } from './budget-bots';
import { BOT_BUDGET } from './budget-words';
import type { BotParts } from './Paper';
import { SOL_COIN, coinOf, useTowers } from './parts';
import { BOTS } from './words';
import s from './budget.module.css';

/**
 * «Сітка» and «Сигнали» on the person's budget: the bot's rule in a few
 * choices — a grid's step and levels, a signal's condition and its number — over the budget card every bot of the budget
 * shares (`terminal/agents/NewAgent.tsx` `Trader`): the coin, the budget a day, the week on paper at live prices first,
 * then «Start with money» — one signature of the very plan. The agent trades it within her budget, every trade told with
 * «Stop»; money lands only in her wallet, as the chain holds it. Where the deployment keeps a bot's money
 * closed, the card says «coming» and the week on paper stays open.
 */
export function BotBudget({ bot, lay, top }: { bot: MoneyBot; lay: (parts: BotParts) => ReactNode; top?: ReactNode }) {
  const w = useWords(BOT_BUDGET);
  const bw = useWords(BOTS);
  const lang = useLang();
  const solUsd = useSolUsd();
  const data = useAgentsData();
  const rows = useMemo(() => data.rows.filter((row) => rowBot(row, data.views) === bot), [data.rows, data.views, bot]);
  const { stopping, stop, note: stopNote } = useStop(() => undefined);
  const mandateNote = useMandateNote();
  const coin = useMandate((st) => st.coin);
  const towerMap = useTowers();

  const [step, setStep] = useState<number>(GRID_START.stepBps);
  const [levels, setLevels] = useState<number>(GRID_START.levels);
  const [kind, setKind] = useState<SignalKind>('cross');
  const [number, setNumber] = useState<number | null>(null);
  const trigger = triggerOf(kind, number);
  const text = planText(bot === 'grid' ? gridPlanOf(step, levels) : signalPlanOf(trigger));

  // The card signs the plan the page shows, tried on the coin's history again on every choice.
  useEffect(() => {
    useAutopilot.setState({ plan: planFrom(text) });
    void testNow();
  }, [text]);
  // Leaving the page leaves no plan behind for another bot's card.
  useEffect(() => () => useAutopilot.setState({ plan: null }), []);

  const pct = (bps: number) => w.pct(digits(pctText(bps, lang), lang));
  const picks =
    bot === 'grid' ? (
      <div className={s.picks} data-bot-picks="grid">
        <div className={s.pick}>
          <Kick>{w.stepLabel}</Kick>
          <Segment label={w.stepLabel} items={GRID_STEPS.map((bps) => ({ id: String(bps), label: pct(bps) }))} value={String(step)} onChange={(id) => setStep(Number(id))} />
        </div>
        <div className={s.pick}>
          <Kick>{w.levelsLabel}</Kick>
          <Segment label={w.levelsLabel} items={GRID_LEVEL_PICKS.map((n) => ({ id: String(n), label: digits(String(n), lang) }))} value={String(levels)} onChange={(id) => setLevels(Number(id))} />
        </div>
      </div>
    ) : (
      <div className={s.picks} data-bot-picks="signals">
        <div className={s.pick}>
          <Kick>{w.signalLabel}</Kick>
          <Segment
            label={w.signalLabel}
            items={SIGNAL_PICKS.map((id) => ({ id, label: w[id] }))}
            value={kind}
            onChange={(id) => {
              setKind(id);
              setNumber(null);
            }}
          />
        </div>
        {trigger.kind !== 'cross' ? (
          <div className={s.pick}>
            <Kick>{w.numberLabel}</Kick>
            <Segment
              label={w.numberLabel}
              items={SIGNAL_NUMBERS[trigger.kind].map((value) => ({ id: String(value), label: trigger.kind === 'volume' ? w.times(digits(pctText(value, lang), lang)) : pct(value) }))}
              value={String(triggerNumber(trigger))}
              onChange={(id) => setNumber(Number(id))}
            />
          </div>
        ) : null}
      </div>
    );

  const open = botMoneyShown(bot, publicMoney());
  const form = (
    <div className={s.form} data-bot-budget={bot}>
      {top}
      <Trader note={mandateNote} onAct={() => undefined} parts={{ closed: open ? null : w.moneyComing, exit: true, head: { title: bw[bot], job: bw[`${bot}Job`] }, rule: picks }} />
    </div>
  );
  const tower = coin ? towerMap.get(coin.mint) : undefined;
  const sol = towerMap.get(SOL.mint);
  const chart = <BotChart coin={tower ? coinOf(tower) : coin ? { mint: coin.mint, symbol: coin.symbol, icon: coin.icon ?? null } : sol ? coinOf(sol) : SOL_COIN} label={bw[bot]} />;
  const past = rows.some((row) => row.stop && 'record' in row.stop && data.views[row.stop.record.policy]?.last?.length);
  const mine = (
    <>
      <BudgetMine rows={rows} owner={data.owner} views={data.views} solUsd={solUsd} note={stopNote} stopping={stopping} onStop={stop} />
      {past ? <History views={Object.fromEntries(rows.flatMap((row) => (row.stop && 'record' in row.stop && data.views[row.stop.record.policy] ? [[row.stop.record.policy, data.views[row.stop.record.policy]!]] : [])))} past={[]} /> : null}
    </>
  );
  return lay({ chart, form, side: null, mine });
}
