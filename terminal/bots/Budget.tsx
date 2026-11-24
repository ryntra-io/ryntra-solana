'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { signedPct } from '@/city/lib/autopilot/plan-line';
import { testNow, useAutopilot } from '@/city/lib/autopilot/store';
import { MANDATE_EXIT, MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { NOTE_YES_MS, noteLeftMs } from '@/city/lib/bots/note-hold';
import { bookOf } from '@/city/lib/command/parse';
import { sayCoin } from '@/city/lib/crew/say';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { usePilot } from '@/city/lib/pilot/store';
import { SOL } from '@/city/lib/trade/tiles';
import { lamportsOf } from '@/lib/sentence/plan';
import { lamportsOfUsd, readSchedule } from '@/lib/sentence/schedule';
import { KNOWN_STOCKS } from '@/lib/stocks/known-stocks';
import { AgentCard, History, MineCards, MineTable } from '@/terminal/agents/Mine';
import { Note, noteWords, PilotPropose, Split, Trader, type TraderParts } from '@/terminal/agents/NewAgent';
import type { MineRow } from '@/terminal/agents/rows';
import { stopAgent, useAgentsData, type StopResult } from '@/terminal/agents/useAgentsData';
import { refusalLine } from '@/terminal/agents/refusal';
import { AGENTS } from '@/terminal/agents/words';
import { DriveWeek } from '@/terminal/agents/drive/DriveWeek';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { useMarket } from '@/terminal/shell/useMarket';
import { Figure, Kick, Panel } from '@/terminal/ui';
import { BotChart } from './BotChart';
import { SOL_COIN, coinOf, useTowers } from './parts';
import type { BotParts } from './Paper';
import { BOTS_STOCKS_OPEN, ENGINE_BUYS_STOCKS, planWithHours, stockPartsOn, unitOnCoin, weekBudget, WEEKS_DEFAULT } from './stock-buys';
import { RecurringBudget, StockPicks, StockTerms, useBotStocks, useBudgetUnit } from './StockBuys';
import { BOTS, RECURRING_STOCKS } from './words';
import { rowBot } from './budget-bots';
import b from './bots.module.css';

/** SOL's price in the market's read, for the dollars beside the bots' SOL. */
export function useSolUsd(): number | null {
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
export function useStop(onPilotGone: () => void) {
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

/**
 * What the mandate's last step answered, under the card, for as long as it is said. A stop before the wallet says why,
 * in the person's language (the engine's reason reached no one, and only in English) — a reason the screen does
 * not know is the plain «stopped before your wallet».
 */
export function useMandateNote(agent = false): ReactNode {
  const w = useWords(AGENTS);
  const lang = useLang();
  const note = useMandate((st) => st.note);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => {
      if (useMandate.getState().note === note) useMandate.getState().say(null);
    }, noteLeftMs(note, Date.now()) ?? NOTE_YES_MS);
    return () => clearTimeout(timer);
  }, [note]);
  if (!note) return null;
  const why = note.kind === 'refused' ? refusalLine(note.reason, lang) : null;
  return (
    <Note warn={note.kind !== 'on' && note.kind !== 'stopped'}>
      <span data-bot-refusal={why ? '' : undefined}>{why ?? (agent && note.kind === 'on' ? w.noteOnAgent : noteWords(w, note.kind))}</span>
    </Note>
  );
}

/** «My bots» of the budget: a desk's table and a phone's cards, one row a bot, each with its own «Stop». */
export function BudgetMine({ rows, owner, views, solUsd, note, stopping, onStop, agent }: Parameters<typeof MineTable>[0]) {
  const mine = { rows, owner, views, solUsd, note, stopping, onStop, agent };
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

/** Lamports as SOL in a point-decimal the card's own reading takes («0.3571»). */
function solDecimal(lamports: bigint): string {
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/u, '');
  return fraction ? `${lamports / 1_000_000_000n}.${fraction}` : `${lamports / 1_000_000_000n}`;
}

/** The listed stocks of the static book — a company's share or a fund — that a coin picked by search may be. */
const LISTED_STOCKS: ReadonlySet<string> = new Set(KNOWN_STOCKS.filter((one) => one.kind !== 'private').map((one) => one.mint));

/**
 * «Recurring buys» (decision 109, p. 3: a rule, so a bot — the card that was the Agents screen's «Trader», its engine as
 * it is): the coin, the budget a day and what follows from it, one signature in the person's wallet; or practice on
 * paper first. Beside it, the coin and what the plan did on its history; under it, every recurring buy at work for the
 * wallet — as many as she started — each with its own «Stop». A sentence for this bot from the agent's line fills the
 * card; it never signs.
 *
 * A stock, on the same bot: the stocks engine's verified companies as a group of their own among the coins,
 * the budget a day or a week, «only while the exchange is open» on for a stock (the plan's `hours`, a wait and never a
 * buy), the exchange's state over the chart and the issuer's rights before the signature. A coin that is no stock keeps
 * the card exactly as it was.
 *
 * `agent`: the same card as the AI trader's plan on the Agents shelf (`/agent?ai=trader`), where a sentence
 * such as «Trade JUP every day» opens: the agent's name and what it does over the coin, the budget a day, the trade, the
 * term and the fee, «Practice first» and «Connect and give the budget». A bot's own parts — the stocks' group, a week's
 * budget — stay the bot's.
 */
export function RecurringBot({ lay, agent = false }: { lay: (parts: BotParts) => ReactNode; agent?: boolean }) {
  const w = useWords(BOTS);
  const aw = useWords(AGENTS);
  const lang = useLang();
  const towers = useMarket().towers;
  const solUsd = useSolUsd();
  const data = useAgentsData();
  // A budget of the grid that sells or of a signal stands on its own bot's page, not here.
  const rows = useMemo(() => data.rows.filter((row) => row.role === 'trader' && rowBot(row, data.views) === null), [data.rows, data.views]);
  const { stopping, stop, note: stopNote } = useStop(() => undefined);
  const mandateNote = useMandateNote(agent);
  const coin = useMandate((st) => st.coin);
  const tested = useAutopilot((st) => st.tested);
  const s = useWords(RECURRING_STOCKS);
  // The stocks' group stands behind its own switch: closed, the shelf is not read and the card is as it always was.
  const stocks = useBotStocks(BOTS_STOCKS_OPEN && !agent);
  const stockMints = useMemo(() => new Set(stocks.map((one) => one.mint)), [stocks]);
  const isStock = BOTS_STOCKS_OPEN && !agent && coin !== null && (stockMints.has(coin.mint) || LISTED_STOCKS.has(coin.mint));
  const [hours, setHours] = useState(true);
  const plan = useAutopilot((st) => st.plan);
  // The exchange's hours ride the plan the card signs: on for a stock while the switch is, never on any other coin.
  useEffect(() => {
    const current = useAutopilot.getState().plan;
    const next = planWithHours(current, isStock && hours);
    // None said yet is the steady plan: it is written only once the hours are on.
    if (current === null ? next.hours === true : next !== current) useAutopilot.setState({ plan: next });
  }, [isStock, hours, plan]);

  // Back from a stock to a coin, the budget is counted as the coin's is — a day (QA 20.11: «A week» stayed on after JUP
  // was picked again); a unit a sentence chose for this very coin stays.
  const wasStock = useRef(isStock);
  useEffect(() => {
    const unit = useBudgetUnit.getState();
    if (unitOnCoin(unit.unit, { wasStock: wasStock.current, isStock, said: unit.said, mint: coin?.mint ?? null }) !== unit.unit) unit.reset();
    wasStock.current = isStock;
  }, [isStock, coin]);

  const towerMap = useTowers();

  // A budget a day said to the agent («trade JUP for me, 1 SOL a day»): the card fills with it, as said.
  useAskHere((ask) => {
    const command = ask.command;
    // A regular purchase: the coin, the rhythm
    // and the sum as said — a sum in dollars at SOL's price now, the dollars beside the field; nothing said, nothing put in.
    if (command.kind === 'instruct' && command.instruction.kind === 'recurring') {
      const instruction = command.instruction;
      const again = readSchedule(instruction.said, bookOf(towers).coins);
      const named = instruction.coin ?? again?.coin ?? null;
      const cadence = instruction.cadence ?? again?.cadence ?? null;
      const amount = instruction.usd ? ({ unit: 'usd', text: instruction.usd } as const) : (again?.amount ?? null);
      const lamports = amount === null ? null : amount.unit === 'sol' ? lamportsOf(amount.text) : lamportsOfUsd(amount.text, solUsd);
      const before = useMandate.getState().coin;
      const tower = named ? towerMap.get(named.mint) : undefined;
      const picked = named ? (tower ? coinOf(tower) : { mint: named.mint, symbol: named.symbol, icon: named.icon }) : null;
      const day = cadence === 'daily' && lamports !== null ? lamports : null;
      useAutopilot.getState().show({ kind: 'trade', said: instruction.said, perDaySol: day === null ? null : solDecimal(day), coin: named });
      // The coin as the market writes it («TSLAx»), or — none named — the one she had.
      useMandate.getState().setCoin(picked ? { mint: picked.mint, symbol: picked.symbol, icon: picked.icon } : before);
      if (cadence === 'weekly') {
        const made = lamports === null ? null : weekBudget(lamports, WEEKS_DEFAULT);
        if (made) useAutopilot.getState().setBudget(made);
      }
      if (cadence === 'weekly' || cadence === 'daily') useBudgetUnit.getState().fromSentence(cadence === 'weekly' ? 'week' : 'day', picked?.mint ?? before?.mint ?? null);
      void testNow();
      return;
    }
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

  const shownCoin = coin ? (towerMap.get(coin.mint) ? coinOf(towerMap.get(coin.mint)!) : { mint: coin.mint, symbol: coin.symbol, icon: coin.icon ?? null }) : null;
  const run = tested?.run ?? null;
  const days = run && run.toMs > run.fromMs ? String(Math.max(1, Math.round((run.toMs - run.fromMs) / 86_400_000))) : null;

  const parts: TraderParts = agent
    ? /* It says «sells on its own» only where the deployment lets the agent sell (`RYNTRA_AGENT_EXIT`); else her stop brings it all home. */
      { head: { title: aw.aiTraderTitle, job: MANDATE_EXIT ? aw.aiTraderJob : aw.aiTraderJobBuys, kick: aw.newAiAgent, icon: 'aiTrader' }, exit: true }
    : {
    coins: <StockPicks stocks={stocks} />,
    budget: <RecurringBudget solUsd={solUsd} />,
    terms: isStock && coin ? <StockTerms mint={coin.mint} hours={hours} onHours={setHours} /> : null,
    apart: stockMints,
    closed: isStock && !ENGINE_BUYS_STOCKS ? s.coming : null,
    // A stock's regular buys hold — the agent's own stop never sells it without her choosing so.
    exit: !isStock,
  };
  const form = <Trader note={mandateNote} onAct={() => undefined} parts={agent ? parts : stockPartsOn(BOTS_STOCKS_OPEN, parts)} />;
  // What the plan did on the coin's history, once it was tried on paper; nothing before — the chart says the coin.
  const side =
    run && days && run.resultPct !== null ? (
      <div className={b.side}>
        <Panel gap={10} label={w.picture}>
          <Kick>{w.picture}</Kick>
          <div className={b.figureCol} data-bot-tested="">
            <Figure value={signedPct(run.resultPct, lang)} tone={run.resultPct > 0 ? 'up' : run.resultPct < 0 ? 'down' : undefined} />
            {run.holdPct !== null ? <span className={b.cap}>{w.weekHold(signedPct(run.holdPct, lang))}</span> : null}
          </div>
        </Panel>
      </div>
    ) : null;
  // The coin's chart beside the form: the terminal's own — SOL until a coin is picked.
  const chart = <BotChart coin={shownCoin ?? (towerMap.get(SOL.mint) ? coinOf(towerMap.get(SOL.mint)!) : SOL_COIN)} label={agent ? aw.aiTraderTitle : w.recurring} stock={isStock} />;
  // Under the bots at work, their trades as their books keep them and the ones that are over — once there is any.
  const past = Object.values(data.views).some((view) => view.last?.length) || data.past.length > 0;
  const mine = (
    <>
      <BudgetMine rows={rows} owner={data.owner} views={data.views} solUsd={solUsd} note={stopNote} stopping={stopping} onStop={stop} agent={agent} />
      {past ? <History views={data.views} past={data.past} /> : null}
      <DriveWeek />
    </>
  );
  return lay({ chart, form, side, mine });
}

/**
 * The money autopilot (decision 109: one plan a person sets for her whole budget — a bot), where its engine is open: the plan's shares and what they hold, on paper first, then one signature. Beside it,
 * the plan at work; under it, its row with «Stop». A sentence for one plan fills the card; it never signs.
 */
export function AutopilotBot({ lay }: { lay: (parts: BotParts) => ReactNode }) {
  const w = useWords(BOTS);
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
  // The plan at work beside the form; none yet — nothing: the chart says the coin.
  const side = working ? (
    <div className={b.side}>
      <AgentCard row={working} view={null} solUsd={solUsd} stopping={stopping} onStop={stop}>
        {shares && pilot ? <Split shares={shares} plan={pilot.plan} solUsd={null} /> : null}
      </AgentCard>
    </div>
  ) : null;
  // The chart of the coin the plan trades — SOL from the first paint until the plan names one.
  const traded = usePilot((st) => st.coin);
  const tradedTower = traded ? towerMap.get(traded.mint) : undefined;
  const chart = <BotChart coin={tradedTower ? coinOf(tradedTower) : traded ? { mint: traded.mint, symbol: traded.symbol, icon: traded.icon ?? null } : sol ? coinOf(sol) : SOL_COIN} label={w.autopilot} />;
  const mine = <BudgetMine rows={rows} owner={data.owner} views={data.views} solUsd={solUsd} note={note} stopping={stopping} onStop={stop} />;
  return lay({ chart, form, side, mine });
}
