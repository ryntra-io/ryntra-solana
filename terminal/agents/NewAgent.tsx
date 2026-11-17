'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { presetFor } from '@/city/lib/autopilot/plan';
import { planLine, planOfText, signedPct, testedLine } from '@/city/lib/autopilot/plan-line';
import { readPaper, signTrade, startPaper, testNow, useAutopilot } from '@/city/lib/autopilot/store';
import { AUTOPILOT } from '@/city/lib/autopilot/words';
import { agentFeeFigures } from '@/city/lib/bots/agent-fee';
import { MANDATE_NET, MANDATE_PRESETS, useMandate, type MandateNote } from '@/city/lib/bots/mandate';
import { agentCoins, bookOf, type Coin } from '@/city/lib/command/parse';
import { fundsFor, shortOfFunds, solAbout } from '@/city/lib/crew/funds';
import { funnelSay } from '@/city/lib/crew/funnel-say';
import { PILOT_STARTER } from '@/city/lib/crew/hire';
import type { Role } from '@/city/lib/crew/read';
import { sayCoin } from '@/city/lib/crew/say';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { readPilotAsk } from '@/city/lib/pilot/read';
import { goLive, PILOT_NET, startPaper as startPilotPaper, usePilot } from '@/city/lib/pilot/store';
import { walletShort } from '@/city/lib/pilot/wallet-check';
import type { AgentView } from '@/city/lib/autopilot/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { BUDGET_PRESETS, type BudgetPresetId } from '@/lib/mandate/presets';
import { legsOf, legsUsd, PILOT_PARTS, type PilotPart, type PilotPlanData } from '@/lib/pilot/plan';
import type { PilotView } from '@/lib/pilot/view';
import { openPanel } from '@/terminal/shell/frame';
import { useMarket } from '@/terminal/shell/useMarket';
import { NARROW } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { WALLET } from '@/terminal/shell/words';
import { Action, AmountField, CoinLogo, Figure, Icon, Info, Kick, Panel, Quiet, Search, Shares, Title, usdText } from '@/terminal/ui';
import { budgetText, lamportsTyped, solPlain, usdShown } from './figures';
import { PlusIcon, RoleBadge } from './glyphs';
import { AgentCard } from './Mine';
import type { MineRow } from './rows';
import { AGENTS } from './words';
import a from './agents.module.css';

type W = ReturnType<typeof useWords<(typeof AGENTS)['en']>>;

/** The wallet's door, where this width keeps it: a phone's sections sheet, a desk's header. */
function connect(): void {
  if (window.matchMedia(NARROW).matches) openPanel('sheet');
  connectWallet();
}

/** Lamports as the decimal the city's budget reader takes: «0.250000000». */
const solSaid = (lamports: bigint) => `${lamports / 1_000_000_000n}.${(lamports % 1_000_000_000n).toString().padStart(9, '0')}`;

const perDayOf = (id: BudgetPresetId) => BUDGET_PRESETS[id].perDay;

/** What a step answered, in the screen's words. */
export function noteWords(w: W, kind: NonNullable<MandateNote>['kind']): string {
  return { on: w.noteOn, stopped: w.noteStopped, walletNo: w.noteWalletNo, refused: w.noteRefused, unreachable: w.noteUnreachable }[kind];
}

export function Note({ children, warn = false }: { children: ReactNode; warn?: boolean }) {
  return (
    <p className={a.note} data-tone={warn ? 'warn' : undefined} role="status">
      {children}
    </p>
  );
}

function Head({ role, kick, children }: { role: Role; kick: string; children?: ReactNode }) {
  const w = useWords(AGENTS);
  return (
    <div className={a.asideHead}>
      <RoleBadge role={role} on />
      <div className={a.asideWords}>
        <Kick>{kick}</Kick>
        <Title as="h2" className={a.asideTitle}>
          {w[role]}
        </Title>
      </div>
      {children}
    </div>
  );
}

/** The «i» of an agent's card: how it works, how it is stopped, where it trades, what it costs. */
export function How({ extra }: { extra?: string | null }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const fee = agentFeeFigures(lang);
  return (
    <Info label={w.how}>
      <span className={a.facts}>
        <span>{w.howBudget}</span>
        <span>{w.howSafe}</span>
        <span>{w.howSpot}</span>
        <span>{w.howFee(fee.major, fee.stock, fee.trending, fee.meme)}</span>
        {extra ? (
          <span>
            {extra} · {w.onHistory}
          </span>
        ) : null}
      </span>
    </Info>
  );
}

/** One fact with its label, the size the approved design gives the new agent's limits. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={a.fact}>
      <Kick>{label}</Kick>
      <Figure value={value} size="s" />
    </div>
  );
}

/** The amber action, or the wallet's door while no wallet is connected. */
function Give({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled: boolean; onPress: (who: Readonly<{ wallet: string; owner: string }>) => void }) {
  const w = useWords(AGENTS);
  const wallet = useWords(WALLET);
  const connection = useWallet((st) => st.connection);
  if (!connection) {
    return (
      <Action onClick={connect} data-agent-connect="">
        {wallet.connect}
      </Action>
    );
  }
  return (
    <Action busy={busy} disabled={disabled || busy} onClick={() => onPress({ wallet: connection.wallet, owner: connection.address })} data-agent-give="">
      {busy ? w.signing : label}
    </Action>
  );
}

/* ---------------------------------------------------------------- the trader: a new agent */

/** The coins the agent may buy on mainnet: the person names one — a tap, or another from the market's list. */
function Coins({ book }: { book: ReturnType<typeof bookOf> }) {
  const w = useWords(AGENTS);
  const coin = useMandate((st) => st.coin);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  // Two coins at hand, as the approved design shows them: the one picked, the first sentence's, the market's best; «+» finds any other.
  const first = sayCoin(book);
  const shown = [...(coin ? [coin] : []), ...(first ? [first] : []), ...agentCoins(book, 4)].filter((c, at, all) => all.findIndex((one) => one.mint === c.mint) === at).slice(0, 2);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\$/u, '');
    const all = agentCoins(book, 80);
    return (q ? all.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : all).slice(0, 6);
  }, [book, query]);
  const pick = (c: Pick<Coin, 'mint' | 'symbol' | 'icon'>) => {
    useMandate.getState().setCoin({ mint: c.mint, symbol: c.symbol, icon: c.icon });
    setAdding(false);
    setQuery('');
    void testNow();
  };
  return (
    <>
      <div className={a.pills} role="radiogroup" aria-label={w.coinGroup}>
        {shown.map((c) => (
          <button key={c.mint} type="button" role="radio" aria-checked={c.mint === coin?.mint} className={a.pill} onClick={() => pick(c)} data-agent-coin={c.symbol}>
            <CoinLogo src={c.icon} symbol={c.symbol} size="s" />
            {c.symbol}
          </button>
        ))}
        <button type="button" className={`${a.pill} ${a.pillAdd}`} aria-label={w.addCoin} aria-expanded={adding} onClick={() => setAdding((was) => !was)}>
          {adding ? <Icon name="close" size="s" /> : <PlusIcon />}
        </button>
      </div>
      {adding ? (
        <div className={a.coinList}>
          <Search value={query} onChange={setQuery} placeholder={w.searchCoin} />
          <div className={a.pills}>
            {found.map((c) => (
              <button key={c.mint} type="button" className={a.pill} data-quiet="" onClick={() => pick(c)}>
                <CoinLogo src={c.icon} symbol={c.symbol} size="s" />
                {c.symbol}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The day's budget. The field takes what a person types and reads it the city's own way: the largest of the budgets
 * the engine offers that is not above what was typed — never more than said — and «new agents start at …» when more was
 * typed than a new agent starts with. Less than the smallest budget is no budget; leaving the field puts the last
 * budget back, so the field always shows exactly what the signature will give.
 */
function Budget() {
  const w = useWords(AGENTS);
  const lang = useLang();
  const preset = useAutopilot((st) => st.preset);
  const capped = useAutopilot((st) => st.capped);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  const [text, setText] = useState('');
  const typing = useRef(false);
  const last = useRef<BudgetPresetId | null>(null);
  const smallest = perDayOf(MANDATE_PRESETS[0]!);
  const largest = perDayOf(MANDATE_PRESETS.at(-1)!);

  // The agent's card with its budget is shown: the funnel's moment.
  useEffect(() => funnelSay('agent_card'), []);

  // The wallet's SOL beside the budget — mainnet's: it says nothing of a test network's budget.
  useEffect(() => {
    if (owner && MANDATE_NET === 'mainnet') useWallet.getState().refreshHoldings();
  }, [owner]);

  useEffect(() => {
    if (preset) last.current = preset;
    if (!typing.current) setText(preset ? budgetText(perDayOf(preset), lang) : '');
  }, [preset, lang]);

  const type = (typed: string) => {
    typing.current = true;
    setText(typed);
    const raw = lamportsTyped(typed);
    const said = raw === null ? { preset: null, capped: false } : presetFor(solSaid(raw), MANDATE_PRESETS);
    useAutopilot.setState({ preset: said.preset, capped: said.capped });
    if (said.preset) {
      useMandate.getState().setPreset(said.preset);
      void testNow();
    }
  };
  const leave = () => {
    if (!typing.current) return;
    typing.current = false;
    const now = useAutopilot.getState();
    const keep = now.preset ?? last.current ?? MANDATE_PRESETS[0]!;
    if (!now.preset) {
      useAutopilot.setState({ capped: false });
      now.pick(keep);
    }
    setText(budgetText(perDayOf(keep), lang));
  };
  const pick = (id: BudgetPresetId) => {
    typing.current = false;
    useAutopilot.setState({ capped: false });
    useAutopilot.getState().pick(id);
    void testNow();
  };

  return (
    <>
      <div onBlur={leave}>
        <AmountField label={w.budgetDay} aside={MANDATE_NET === 'mainnet' && spendable ? w.balance(solPlain(spendable, lang)) : undefined} value={text} onChange={type} asset={{ symbol: 'SOL', icon: '/api/icon/So11111111111111111111111111111111111111112' }} />
      </div>
      {MANDATE_PRESETS.length > 1 ? <Shares label={w.budgets} value={preset} onPick={pick} options={MANDATE_PRESETS.map((id) => ({ id, label: budgetText(perDayOf(id), lang) }))} /> : null}
      {capped ? (
        <Note>{w.startsSmall(budgetText(largest, lang))}</Note>
      ) : !preset ? (
        <Note warn>{w.least(budgetText(smallest, lang))}</Note>
      ) : typing.current && lamportsTyped(text) !== perDayOf(preset) ? (
        <Note>{w.willGive(budgetText(perDayOf(preset), lang))}</Note>
      ) : null}
    </>
  );
}

function TraderForm({ note, onAct }: { note: ReactNode; onAct: () => void }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const preset = useAutopilot((st) => st.preset);
  const plan = useAutopilot((st) => st.plan);
  const tested = useAutopilot((st) => st.tested);
  const coin = useMandate((st) => st.coin);
  const busy = useMandate((st) => st.busy === 'enable');
  const owner = useWallet((st) => st.connection?.address ?? null);
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  const towers = useMarket().towers;
  const book = useMemo(() => bookOf(towers), [towers]);
  const needsCoin = MANDATE_NET === 'mainnet';
  const fee = agentFeeFigures(lang);
  const limits = preset ? BUDGET_PRESETS[preset] : null;
  const line = planLine(plan, AUTOPILOT[lang], lang);
  // A wallet that cannot hold the budget and the agent's network fees cannot sign it: the card says what is needed.
  const short = needsCoin && Boolean(owner) && shortOfFunds(spendable, preset);
  return (
    <Panel tone="hi" gap={12} label={w.newAgent}>
      <Head role="trader" kick={w.newAgent}>
        <How extra={testedLine(tested?.run ?? null, AUTOPILOT[lang], lang)} />
      </Head>
      {needsCoin ? <Coins book={book} /> : null}
      {line ? <span className={a.plan}>{line}</span> : null}
      <Budget />
      {limits ? (
        <div className={a.tiles}>
          <Fact label={w.perTrade} value={`${w.upTo(solPlain(limits.perTrade.toString(), lang))} SOL`} />
          <Fact label={w.term} value={w.days(String(limits.days))} />
        </div>
      ) : null}
      <span className={a.cap}>{w.feeLine(fee.low, fee.high)}</span>
      {needsCoin && !coin && owner ? <Note>{w.pickCoin}</Note> : null}
      {short && preset ? <Note warn>{w.needSol(digits(solAbout(fundsFor(preset).about), lang))}</Note> : null}
      {note}
      <Give
        label={w.give}
        busy={busy}
        disabled={!preset || (needsCoin && !coin) || short}
        onPress={(who) => {
          onAct();
          void signTrade(who);
        }}
      />
      {needsCoin ? (
        <Quiet full disabled={!tested || !coin || !preset} onClick={() => startPaper()} data-agent-practice="">
          {w.practice}
        </Quiet>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------------------------------------- the trader: practice without money */

function TraderPaper({ note, onAct }: { note: ReactNode; onAct: () => void }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const paper = useAutopilot((st) => st.paper);
  const run = useAutopilot((st) => st.paperRun);
  const preset = useAutopilot((st) => st.preset);
  const busy = useMandate((st) => st.busy === 'enable');
  const owner = useWallet((st) => st.connection?.address ?? null);
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  const short = MANDATE_NET === 'mainnet' && Boolean(owner) && shortOfFunds(spendable, preset);
  useEffect(() => {
    if (!paper) return;
    void readPaper();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void readPaper();
    }, 60_000);
    return () => clearInterval(timer);
  }, [paper]);
  if (!paper) return null;
  const plan = planOfText(paper.plan);
  const line = planLine(plan, AUTOPILOT[lang], lang);
  const pct = run && run.buys > 0 ? run.resultPct : null;
  return (
    <Panel tone="hi" gap={12} label={w.paperKick}>
      <Head role="trader" kick={w.paperKick}>
        <How />
      </Head>
      {paper.symbol ? (
        <div className={a.pills}>
          <span className={a.pill}>
            <CoinLogo src={`/api/icon/${paper.coin}`} symbol={paper.symbol} size="s" />
            {paper.symbol}
          </span>
        </div>
      ) : null}
      {line ? <span className={a.plan}>{line}</span> : null}
      <div className={a.figureCol}>
        <Kick>{w.onPaper}</Kick>
        {run && pct !== null ? (
          <>
            <Figure value={signedPct(pct, lang)} tone={pct > 0 ? 'up' : pct < 0 ? 'down' : undefined} />
            <span className={a.cap}>
              {w.paperTrades(String(run.buys))}
              {run.holdPct !== null ? ` · ${w.vsHold(signedPct(run.holdPct, lang))}` : ''}
            </span>
          </>
        ) : (
          <span className={a.cap}>{w.paperNone}</span>
        )}
      </div>
      {short && preset ? <Note warn>{w.needSol(digits(solAbout(fundsFor(preset).about), lang))}</Note> : null}
      {note}
      <Give
        label={w.give}
        busy={busy}
        disabled={!preset || short}
        onPress={(who) => {
          // Live, the agent takes the very plan and coin it practised.
          onAct();
          useAutopilot.setState({ plan });
          useMandate.getState().setCoin({ mint: paper.coin, symbol: paper.symbol ?? paper.coin.slice(0, 4), icon: null });
          void signTrade(who);
        }}
      />
      <Quiet full onClick={() => useAutopilot.getState().setPaper(null)} data-agent-end-practice="">
        {w.endPractice}
      </Quiet>
    </Panel>
  );
}

function Trader({ note, onAct }: { note: ReactNode; onAct: () => void }) {
  const paper = useAutopilot((st) => st.paper);
  const coin = useMandate((st) => st.coin);
  const towers = useMarket().towers;
  // The practice is kept in this browser: it shows from the first paint after hydration, never in the server's page.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // The card stands on the city's own ask of the agent: a budget a day, the budget the city starts a new agent on.
  useEffect(() => {
    const before = useAutopilot.getState();
    if (before.ask?.kind !== 'trade') before.show({ kind: 'trade', said: '', perDaySol: null });
    if (!useAutopilot.getState().preset) useAutopilot.getState().pick(useMandate.getState().preset);
  }, []);
  // On mainnet the agent buys a coin the person names: the first sentence's coin stands picked, one tap changes it.
  useEffect(() => {
    if (MANDATE_NET !== 'mainnet' || coin || !towers.length) return;
    const first = sayCoin(bookOf(towers));
    if (!first) return;
    useMandate.getState().setCoin({ mint: first.mint, symbol: first.symbol, icon: first.icon });
    void testNow();
  }, [towers, coin]);
  return paper && mounted ? <TraderPaper note={note} onAct={onAct} /> : <TraderForm note={note} onAct={onAct} />;
}

/* ---------------------------------------------------------------- the autopilot: one plan for the whole budget */

const pctOf = (bps: number, lang: 'en' | 'uk') => digits(`${Math.round(bps / 100)}%`, lang);

/** The plan's parts as one bar and a line each: a name, a share, and — before the signature — what it holds. */
function Split({ shares, plan, solUsd }: { shares: Readonly<Record<PilotPart, number>>; plan: PilotPlanData; solUsd: number | null }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const names: Readonly<Record<PilotPart, string>> = { trade: w.partTrade, save: w.partSave, pool: w.partPool, reserve: w.partReserve };
  const values = solUsd !== null ? legsUsd(legsOf(plan), solUsd) : null;
  const shown = PILOT_PARTS.filter((part) => shares[part] > 0);
  return (
    <>
      <div className={a.split} role="img" aria-label={shown.map((part) => `${names[part]} ${pctOf(shares[part], lang)}`).join(', ')}>
        {shown.map((part) => (
          <span key={part} className={a.seg} data-part={part} style={{ flexGrow: shares[part] }} />
        ))}
      </div>
      <ul className={a.legend} aria-label={w.plan}>
        {shown.map((part) => (
          <li key={part}>
            <span className={a.dot} data-part={part} />
            <span className={a.legendName}>{names[part]}</span>
            <span className={a.legendFigure}>
              {pctOf(shares[part], lang)}
              {values ? ` · ${usdText(values[part], lang)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function PilotInfo() {
  const w = useWords(AGENTS);
  return (
    <Info label={w.how}>
      <span className={a.facts}>
        <span>{w.pilotHow}</span>
        <span>{w.howSafe}</span>
        <span>{w.howSpot}</span>
      </span>
    </Info>
  );
}

function PilotPropose({ solUsd }: { solUsd: number | null }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const ask = usePilot((st) => st.ask);
  const split = usePilot((st) => st.split);
  const plan = usePilot((st) => st.plan);
  const priced = usePilot((st) => st.solUsd);
  const coin = usePilot((st) => st.coin);
  const phase = usePilot((st) => st.phase);
  const paper = usePilot((st) => st.paper);
  const note = usePilot((st) => st.note);
  const holdings = useWallet((st) => st.holdings);
  const towers = useMarket().towers;
  const fee = agentFeeFigures(lang);

  // Nothing said yet: the city's own starter plan, for the person to read before anything is signed.
  useEffect(() => {
    if (usePilot.getState().ask) return;
    const book = bookOf(towers);
    const starter = readPilotAsk(PILOT_STARTER[lang], book) ?? readPilotAsk(PILOT_STARTER.en, book);
    const first = agentCoins(book)[0] ?? null;
    if (starter) usePilot.getState().show(starter, solUsd, first ? { mint: first.mint, symbol: first.symbol, icon: first.icon } : null);
  }, [towers, lang, solUsd]);
  useEffect(() => usePilot.getState().reprice(solUsd), [solUsd]);

  if (!ask || !split || !plan) {
    return (
      <Panel tone="hi" gap={12} label={w.newAgent}>
        <Head role="pilot" kick={w.newAgent}>
          <PilotInfo />
        </Head>
        <span className={a.cap}>{w.readingPrices}</span>
      </Panel>
    );
  }
  const short = walletShort(split.legs, PILOT_NET, holdings);
  const total = priced !== null && !short ? PILOT_PARTS.reduce((sum, part) => sum + legsUsd(split.legs, priced)[part], 0) : null;
  const onPaper = phase === 'paper' || phase === 'signing';
  const result = paper ? usdShown(paper.totalUsd, lang) : null;
  const noCoin = Boolean(split.preset) && PILOT_NET === 'mainnet' && !coin;
  const said: Readonly<Record<NonNullable<typeof note>['kind'], string>> = { on: w.pilotOn, partial: w.pilotPartial, stopped: w.pilotStopped, walletNo: w.noteWalletNo, refused: w.noteRefused, unreachable: w.noteUnreachable };
  return (
    <Panel tone="hi" gap={12} label={w.newAgent}>
      <Head role="pilot" kick={w.newAgent}>
        <PilotInfo />
      </Head>
      {total !== null ? <span className={a.plan}>{w.toWork(usdText(total, lang))}</span> : null}
      <Split shares={split.shares} plan={plan} solUsd={short ? null : priced} />
      {onPaper ? (
        <div className={a.figureCol}>
          <Kick>{w.onPaper}</Kick>
          {paper ? (
            <>
              <Figure value={result?.text ?? '—'} tone={result?.tone} />
              <span className={a.cap}>{w.pilotPaperLine(String(paper.days))}</span>
            </>
          ) : (
            <span className={a.cap}>{w.readingPrices}</span>
          )}
        </div>
      ) : null}
      {split.preset ? <span className={a.cap}>{w.pilotPay(fee.low, fee.high)}</span> : null}
      <span className={a.cap}>{w.pilotRisk}</span>
      {noCoin ? <Note>{w.pickCoin}</Note> : null}
      {short ? <Note warn>{w.pilotShort(short)}</Note> : null}
      {note ? <Note warn={note.kind !== 'on' && note.kind !== 'stopped'}>{said[note.kind]}</Note> : null}
      {onPaper ? (
        <Give label={w.give} busy={phase === 'signing'} disabled={noCoin || Boolean(short)} onPress={(who) => void goLive(who)} />
      ) : (
        <Action onClick={() => void startPilotPaper()} data-agent-practice="">
          {w.practice}
        </Action>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- the panel beside the list */

export type NewAgentProps = Readonly<{
  role: Role | null;
  rows: readonly MineRow[];
  /** The traders' books, by policy. */
  views: Readonly<Record<string, AgentView>>;
  pilot: PilotView | null;
  solUsd: number | null;
  /** The line a step of this panel answered with. */
  note: ReactNode;
  /** A step of this panel began: its answer belongs here. */
  onAct: () => void;
  /** The row whose «Stop» waits on the wallet. */
  stopping: string | null;
  onStop: (row: MineRow) => void;
}>;

/**
 * The panel for the agent the screen is about: at work — its card with its figures and «Stop»; not hired yet — the new
 * agent: what it buys, the day's budget, the limits that follow from it, one line on the fee and the stop, and the one
 * action. «Give the budget» is one signature in the person's own wallet.
 */
export function NewAgent({ role, rows, views, pilot, solUsd, note, onAct, stopping, onStop }: NewAgentProps) {
  if (!role) return null;
  const working = rows.find((row) => row.role === role) ?? null;
  if (working) {
    const shares = role === 'pilot' && pilot ? (pilot.care?.shares ?? pilot.plan.shares) : null;
    return (
      <>
        <AgentCard row={working} view={working.role === 'trader' && working.stop && 'record' in working.stop ? (views[working.stop.record.policy] ?? null) : null} solUsd={solUsd} stopping={stopping} onStop={onStop}>
          {shares && pilot ? <Split shares={shares} plan={pilot.plan} solUsd={null} /> : null}
        </AgentCard>
        {note}
      </>
    );
  }
  if (role === 'pilot') return <PilotPropose solUsd={solUsd} />;
  if (role === 'trader') return <Trader note={note} onAct={onAct} />;
  return null;
}
