'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { signedPct } from '@/city/lib/autopilot/plan-line';
import { testNow, useAutopilot } from '@/city/lib/autopilot/store';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { NOTE_YES_MS, noteLeftMs } from '@/city/lib/bots/note-hold';
import { bookOf } from '@/city/lib/command/parse';
import { sayCoin } from '@/city/lib/crew/say';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { usePilot } from '@/city/lib/pilot/store';
import { SOL } from '@/city/lib/trade/tiles';
import { AgentCard, History, MineCards, MineTable } from '@/terminal/agents/Mine';
import { Note, noteWords, PilotPropose, Split, Trader } from '@/terminal/agents/NewAgent';
import type { MineRow } from '@/terminal/agents/rows';
import { stopAgent, useAgentsData, type StopResult } from '@/terminal/agents/useAgentsData';
import { AGENTS } from '@/terminal/agents/words';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { Figure, Kick, Panel } from '@/terminal/ui';
import { CoinCard, coinOf, useTowers } from './parts';
import type { BotParts } from './Paper';
import { BOTS } from './words';
import b from './bots.module.css';

/** SOL's price in the market's read, for the dollars beside the bots' SOL. */
function useSolUsd(): number | null {
  const towers = useMarket().towers;
  return useMemo(() => {
    const sol = towers.find((tower) => tower.id === SOL.mint);
    return sol && Number.isFinite(sol.price) && sol.price > 0 ? sol.price : null;
  }, [towers]);
}

/**
 * «Stop» on a bot of the budget, one at a time, the city's own way (`terminal/agents/useAgentsData.ts` `stopAgent`): one
 * signature, the rest back to the wallet; its answer stays long enough to be read.
 */
function useStop(onPilotGone: () => void) {
  const w = useWords(AGENTS);
  const [stopping, setStopping] = useState<string | null>(null);
  const [stopped, setStopped] = useState<Readonly<{ role: MineRow['role']; result: StopResult; at: number }> | null>(null);
  useEffect(() => {
    if (!stopped) return;
    const timer = setTimeout(() => setStopped(null), noteLeftMs({ kind: stopped.result, at: stopped.at }, Date.now()) ?? NOTE_YES_MS);
    return () => clearTimeout(timer);
  }, [stopped]);
  const stop = (row: MineRow) => {
    if (stopping) return;
    setStopping(row.key);
    setStopped(null);
    void stopAgent(row, onPilotGone)
      .then((result) => result && setStopped({ role: row.role, result, at: Date.now() }))
      .finally(() => setStopping(null));
  };
  const note = stopped ? <Note warn={stopped.result !== 'stopped'}>{stopped.result === 'stopped' && stopped.role === 'pilot' ? w.pilotStopped : noteWords(w, stopped.result)}</Note> : null;
  return { stopping, stop, note };
}

/** What the mandate's last step answered, under the card, for as long as it is said. */
function useMandateNote(): ReactNode {
  const w = useWords(AGENTS);
  const note = useMandate((st) => st.note);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => {
      if (useMandate.getState().note === note) useMandate.getState().say(null);
    }, noteLeftMs(note, Date.now()) ?? NOTE_YES_MS);
    return () => clearTimeout(timer);
  }, [note]);
  return note ? <Note warn={note.kind !== 'on' && note.kind !== 'stopped'}>{noteWords(w, note.kind)}</Note> : null;
}

/** «My bots» of the budget: a desk's table and a phone's cards, one row a bot, each with its own «Stop». */
function BudgetMine({ rows, owner, views, solUsd, note, stopping, onStop }: Parameters<typeof MineTable>[0]) {
  const mine = { rows, owner, views, solUsd, note, stopping, onStop };
  return (
    <>
      <div className={b.deskOnly}>
        <MineTable {...mine} />
      </div>
      <div className={b.cards}>
        <MineCards {...mine} />
      </div>
    </>
  );
}

/**
 * «Recurring buys» (decision 109, p. 3: a rule, so a bot — the card that was the Agents screen's «Trader», its engine as
 * it is): the coin, the budget a day and what follows from it, one signature in the person's wallet; or practice on
 * paper first. Beside it, the coin and what the plan did on its history; under it, every recurring buy at work for the
 * wallet — as many as she started — each with its own «Stop». A sentence for this bot from the agent's line fills the
 * card; it never signs.
 */
export function RecurringBot({ lay }: { lay: (parts: BotParts) => ReactNode }) {
  const w = useWords(BOTS);
  const lang = useLang();
  const towers = useMarket().towers;
  const solUsd = useSolUsd();
  const data = useAgentsData();
  const rows = useMemo(() => data.rows.filter((row) => row.role === 'trader'), [data.rows]);
  const { stopping, stop, note: stopNote } = useStop(() => undefined);
  const mandateNote = useMandateNote();
  const coin = useMandate((st) => st.coin);
  const tested = useAutopilot((st) => st.tested);

  // A budget a day said to the agent («trade JUP for me, 1 SOL a day»): the card fills with it, as said.
  useAskHere((ask) => {
    const command = ask.command;
    if (command.kind !== 'autopilot' || command.ask.kind !== 'trade') return;
    useAutopilot.getState().show(command.ask);
    // On mainnet the bot buys a named coin: a sentence that named none keeps an example's coin, at once.
    if (MANDATE_NET === 'mainnet' && !useMandate.getState().coin) {
      const first = sayCoin(bookOf(towers));
      if (first) {
        useMandate.getState().setCoin({ mint: first.mint, symbol: first.symbol, icon: first.icon });
        void testNow();
      }
    }
  });

  const towerMap = useTowers();
  const shownCoin = coin ? (towerMap.get(coin.mint) ? coinOf(towerMap.get(coin.mint)!) : { mint: coin.mint, symbol: coin.symbol, icon: coin.icon ?? null }) : null;
  const run = tested?.run ?? null;
  const days = run && run.toMs > run.fromMs ? String(Math.max(1, Math.round((run.toMs - run.fromMs) / 86_400_000))) : null;

  const form = <Trader note={mandateNote} onAct={() => undefined} />;
  const side = (
    <div className={b.side}>
      <CoinCard coin={shownCoin} />
      {run && days && run.resultPct !== null ? (
        <Panel gap={10} label={w.picture}>
          <Kick>{w.picture}</Kick>
          <div className={b.figureCol} data-bot-tested="">
            <Figure value={signedPct(run.resultPct, lang)} tone={run.resultPct > 0 ? 'up' : run.resultPct < 0 ? 'down' : undefined} />
            {run.holdPct !== null ? <span className={b.cap}>{w.weekHold(signedPct(run.holdPct, lang))}</span> : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
  // Under the bots at work, their trades as their books keep them and the ones that are over — once there is any.
  const past = Object.values(data.views).some((view) => view.last?.length) || data.past.length > 0;
  const mine = (
    <>
      <BudgetMine rows={rows} owner={data.owner} views={data.views} solUsd={solUsd} note={stopNote} stopping={stopping} onStop={stop} />
      {past ? <History views={data.views} past={data.past} /> : null}
    </>
  );
  return lay({ form, side, mine });
}

/**
 * The money autopilot (decision 109: one plan a person sets for her whole budget — a bot), where its engine is open: the plan's shares and what they hold, on paper first, then one signature. Beside it,
 * the plan at work; under it, its row with «Stop». A sentence for one plan fills the card; it never signs.
 */
export function AutopilotBot({ lay }: { lay: (parts: BotParts) => ReactNode }) {
  const towers = useMarket().towers;
  const solUsd = useSolUsd();
  const data = useAgentsData();
  const rows = useMemo(() => data.rows.filter((row) => row.role === 'pilot'), [data.rows]);
  const { stopping, stop, note } = useStop(() => data.owner && data.setPilot(data.owner, null));
  const towerMap = useTowers();
  const sol = towerMap.get(SOL.mint);

  useAskHere((ask) => {
    if (ask.command.kind !== 'pilot') return;
    const first = sayCoin(bookOf(towers));
    usePilot.getState().show(ask.command.ask, solUsd, first ? { mint: first.mint, symbol: first.symbol, icon: first.icon } : null);
  });

  const working = rows[0] ?? null;
  const pilot = data.pilot;
  const shares = working && pilot ? (pilot.care?.shares ?? pilot.plan.shares) : null;
  const form = <PilotPropose solUsd={solUsd} />;
  const side = (
    <div className={b.side}>
      {working ? (
        <AgentCard row={working} view={null} solUsd={solUsd} stopping={stopping} onStop={stop}>
          {shares && pilot ? <Split shares={shares} plan={pilot.plan} solUsd={null} /> : null}
        </AgentCard>
      ) : (
        <CoinCard coin={sol ? coinOf(sol) : null} />
      )}
    </div>
  );
  const mine = <BudgetMine rows={rows} owner={data.owner} views={data.views} solUsd={solUsd} note={note} stopping={stopping} onStop={stop} />;
  return lay({ form, side, mine });
}
