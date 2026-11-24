'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { planLine, planOfText, signedPct, testedLine } from '@/city/lib/autopilot/plan-line';
import { readPaper, signTrade, startPaper, testNow, useAutopilot } from '@/city/lib/autopilot/store';
import { AUTOPILOT } from '@/city/lib/autopilot/words';
import { agentFeeFigures } from '@/city/lib/bots/agent-fee';
import { MANDATE_NET, useMandate, type MandateNote } from '@/city/lib/bots/mandate';
import { agentCoins, bookOf, type Coin } from '@/city/lib/command/parse';
import { fundsFor, shortOfFunds, solAbout } from '@/city/lib/crew/funds';
import { funnelSay } from '@/city/lib/crew/funnel-say';
import { PILOT_STARTER } from '@/city/lib/crew/hire';
import type { Role } from '@/city/lib/crew/read';
import { sayCoin, sayCoins } from '@/city/lib/crew/say';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { readPilotAsk, type PilotAsk } from '@/city/lib/pilot/read';
import { goLive, PILOT_NET, startPaper as startPilotPaper, usePilot } from '@/city/lib/pilot/store';
import { walletShort } from '@/city/lib/pilot/wallet-check';
import { useWallet } from '@/city/lib/trade/wallet';
import { budgetIssue, budgetTotal, DAYS_MAX, defaultDays, defaultTrade, HANDY_SHARES, handyBudget, leastTradeOf, roundUp, TRADE_MIN_LAMPORTS, type AgentBudget, type BudgetIssue, type HandyShare } from '@/lib/mandate/budget';
import { legsOf, legsUsd, PILOT_PARTS, type PilotPart, type PilotPlanData } from '@/lib/pilot/plan';
import { passesForStock } from '@/lib/stocks/stock-book';
import { openPanel } from '@/terminal/shell/frame';
import type { MenuIconName } from '@/terminal/shell/menu-icons';
import { useMarket } from '@/terminal/shell/useMarket';
import { NARROW } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { Action, AmountField, CoinLogo, Figure, Icon, Info, Kick, Panel, Quiet, Search, Shares, Title, usdText } from '@/terminal/ui';
import { FEE } from '@/terminal/ui/words';
import { ExitLine, sellsOnItsOwn } from './Exit';
import { exitRulesOf } from '@/lib/bots/money/gates';
import { budgetText, lamportsTyped, solPlain, usdShown } from './figures';
import { PlusIcon, RoleBadge } from './glyphs';
import { ConnectOnly, Edge, Limit } from './Limit';
import { PaperNote, PaperWeek } from './paper/PaperWeek';
import { PAPER_OPEN, startPaperWeek, usePaperWeekShown } from './paper/store';
import { AGENTS } from './words';
import a from './agents.module.css';

type W = ReturnType<typeof useWords<(typeof AGENTS)['en']>>;

/** A card's own head: its name and line; the AI trader's plan also its kick («New agent») and the menu's mark. */
export type TraderHead = Readonly<{ title: string; job: string; kick?: string; icon?: MenuIconName }>;

/** The wallet's door, where this width keeps it: a phone's sections sheet, a desk's header. */
function connect(): void {
  if (window.matchMedia(NARROW).matches) openPanel('sheet');
  connectWallet();
}

/** «Practice first» with no wallet: the agent on paper in this browser — and the funnel's moment of the new way. */
function practise(): void {
  funnelSay('agent_practice');
  startPaper();
}

/** A press before the budget is written puts the cursor in the card's first field: nothing starts before she writes one. */
function focusField({ currentTarget }: { currentTarget: HTMLElement }): void {
  currentTarget.closest('section')?.querySelector<HTMLInputElement>('input:not([readonly])')?.focus();
}


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

function Head({ role, kick, children, own }: { role: Role; kick: string; children?: ReactNode; own?: TraderHead }) {
  const w = useWords(AGENTS);
  return (
    <div className={a.asideHead}>
      <RoleBadge role={role} on icon={own?.icon} />
      <div className={a.asideWords}>
        <Kick>{own?.kick ?? kick}</Kick>
        <Title as="h2" className={a.asideTitle}>
          {own?.title ?? w[role]}
        </Title>
        <span className={a.job}>{own?.job ?? w[`${role}Job`]}</span>
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

/** The amber action, or — while no wallet is connected — the last step: connect, then sign the budget. */
function Give({ label, busy, disabled, onPress, empty = false }: { label: string; busy: boolean; disabled: boolean; onPress: (who: Readonly<{ wallet: string; owner: string }>) => void; empty?: boolean }) {
  const w = useWords(AGENTS);
  const connection = useWallet((st) => st.connection);
  if (!connection) {
    return (
      <>
        <Action onClick={connect} data-agent-connect="">
          {w.connectSign}
        </Action>
        <ConnectOnly />
      </>
    );
  }
  // Nothing written in the budget yet and nothing else in the way: the action stays lit and puts the cursor in the
  // budget's field (QA 20.11, вада 29: a pale action read as switched off) — nothing is signed before she writes one.
  if (empty && !busy) {
    return (
      <Action onClick={focusField} data-agent-give="">
        {label}
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

/**
 * The coins the agent may buy on mainnet: the person names one. At hand — the one she picked and the two an example may
 * name, JUP and MET (decision 108: no coin advertised); «+» finds any other, the coins her wallet holds first. A coin
 * that passes for a tokenized stock it is not is never offered; `apart` —
 * the coins a group of their own shows (the stocks), left out of these pills.
 */
function Coins({ book, apart }: { book: ReturnType<typeof bookOf>; apart?: ReadonlySet<string> }) {
  const w = useWords(AGENTS);
  const coin = useMandate((st) => st.coin);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const held = useWallet((st) => (st.holdings && st.holdings.owner === owner ? st.holdings.tokens : null));
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const named = useMemo(() => sayCoins(book), [book]);
  const shown = [...(coin && !apart?.has(coin.mint) ? [coin] : []), ...named].filter((c, at, all) => all.findIndex((one) => one.mint === c.mint) === at).slice(0, 3);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\$/u, '');
    const all = agentCoins(book, Number.MAX_SAFE_INTEGER).filter((c) => passesForStock(c) === null);
    if (q) return all.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(0, 6);
    // Nothing typed: her own coins, then JUP and MET — never the market's best.
    const hers = held ? all.filter((c) => held.has(c.mint)) : [];
    return [...hers, ...named].filter((c, at, list) => list.findIndex((one) => one.mint === c.mint) === at).slice(0, 6);
  }, [book, query, held, named]);
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

const SOL_ASSET = { symbol: 'SOL', icon: '/api/icon/So11111111111111111111111111111111111111112' } as const;

type Fields = Readonly<{ day: string; trade: string; days: string }>;

/** What the fields say when their numbers are not a budget the agent takes yet; null — they are, or the day is empty. */
function issueLine(w: W, lang: Lang, issue: BudgetIssue | 'noTrade' | null, perDay: bigint | null): string | null {
  switch (issue) {
    case 'noTrade':
    case 'zero':
      return w.needTrade;
    case 'tradeMin':
      return w.tradeMin(budgetText(TRADE_MIN_LAMPORTS, lang));
    case 'tradeOverDay':
      return w.tradeOverDay;
    case 'buys':
      return perDay === null ? null : w.tradeLeast(budgetText(roundUp(leastTradeOf(perDay)), lang));
    case 'term':
      return w.termRange(digits(String(DAYS_MAX), lang));
    case 'tooLarge':
      return w.tooLarge;
    default:
      return null;
  }
}

/**
 * The person's budget: the day she writes, and the trade and the term that follow from it —
 * each hers to write over; no ceiling of Ryntra's. Beside the day, shares of her own wallet (10 · 25 · 50 % · all),
 * never a sum of ours. The numbers become the card's budget the moment the agent takes them; until then one short line
 * says what is wrong. A sentence's day («trade 1 SOL a day») or a share tapped fills the fields.
 */
export function Budget() {
  const w = useWords(AGENTS);
  const lang = useLang();
  const budget = useAutopilot((st) => st.budget);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  // The wallet's SOL is mainnet's: it says nothing of a test network's budget.
  const spendRaw = MANDATE_NET === 'mainnet' && spendable && /^\d{1,20}$/u.test(spendable) ? BigInt(spendable) : null;
  const [fields, setFields] = useState<Fields>({ day: '', trade: '', days: '' });
  const [share, setShare] = useState<string | null>(null);
  // The fields the person wrote herself: what follows from the day never writes over them.
  const own = useRef({ trade: false, days: false });
  const typing = useRef(false);
  const test = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (test.current && clearTimeout(test.current)), []);

  // The agent's card with its budget is shown: the funnel's moment.
  useEffect(() => funnelSay('agent_card'), []);

  // The wallet's SOL beside the budget — mainnet's.
  useEffect(() => {
    if (owner && MANDATE_NET === 'mainnet') useWallet.getState().refreshHoldings();
  }, [owner]);

  // The card's budget into the fields — a sentence's day, a share tapped — while the person is not writing.
  useEffect(() => {
    if (typing.current) return;
    own.current = { trade: false, days: false };
    setFields(budget ? { day: budgetText(budget.perDay, lang), trade: budgetText(budget.perTrade, lang), days: String(budget.days) } : { day: '', trade: '', days: '' });
  }, [budget, lang]);

  /** The day, the trade and the term the fields make, what follows from the day filled in where she wrote nothing. */
  const read = (text: Fields) => {
    const perDay = lamportsTyped(text.day);
    if (perDay === null) return { perDay: null, perTrade: null, term: null };
    const perTrade = own.current.trade ? lamportsTyped(text.trade) : defaultTrade(perDay);
    const typed = /^\d{1,6}$/u.test(text.days) ? Number(text.days) : null;
    const term = own.current.days ? typed : perTrade === null ? null : defaultDays({ perDay, perTrade }, spendRaw);
    return { perDay, perTrade, term };
  };

  const write = (text: Fields) => {
    typing.current = true;
    setShare(null);
    const next = read(text);
    setFields({
      day: text.day,
      trade: own.current.trade ? text.trade : next.perTrade === null ? '' : budgetText(next.perTrade, lang),
      days: own.current.days ? text.days : next.term === null ? '' : String(next.term),
    });
    const made = next.perDay !== null && next.perTrade !== null && next.term !== null ? { perDay: next.perDay, perTrade: next.perTrade, days: next.term } : null;
    const taken: AgentBudget | null = made && budgetIssue(made) === null ? made : null;
    useAutopilot.getState().setBudget(taken);
    if (test.current) clearTimeout(test.current);
    if (taken) test.current = setTimeout(() => void testNow(), 700);
  };

  const pickShare = (id: string) => {
    const b = spendRaw === null ? null : handyBudget(spendRaw, Number(id) as HandyShare);
    if (!b) return;
    own.current = { trade: false, days: false };
    typing.current = false;
    setShare(id);
    useAutopilot.getState().setBudget(b);
    void testNow();
  };

  const now = read(fields);
  const issue = now.perDay === null ? null : now.perTrade === null ? 'noTrade' : now.term === null ? 'term' : budgetIssue({ perDay: now.perDay, perTrade: now.perTrade, days: now.term });
  const line = issueLine(w, lang, issue, now.perDay);
  const shares = spendRaw === null ? [] : HANDY_SHARES.filter((s) => handyBudget(spendRaw, s) !== null);

  return (
    <div
      className={a.budgetFields}
      onBlur={() => {
        typing.current = false;
      }}
    >
      <AmountField label={w.budgetDay} aside={spendRaw !== null ? w.balance(solPlain(spendRaw.toString(), lang)) : undefined} value={fields.day} onChange={(day) => write({ ...fields, day })} asset={SOL_ASSET} />
      {shares.length ? <Shares label={w.shares} value={share} onPick={pickShare} options={shares.map((s) => ({ id: String(s), label: s === 100 ? w.max : digits(`${s}%`, lang) }))} /> : null}
      {/* The trade and the term follow from the day: until a day is written they say so with «—», never a 0 that reads
          as a limit of nothing — and no sum of Ryntra's is put in (decision 108). */}
      <div className={a.tiles}>
        <AmountField
          size="s"
          label={w.perTrade}
          unit="SOL"
          placeholder="—"
          value={fields.trade}
          onChange={(trade) => {
            own.current.trade = true;
            write({ ...fields, trade });
          }}
        />
        <AmountField
          size="s"
          label={w.term}
          unit={w.daysUnit(fields.days || '0')}
          whole
          placeholder="—"
          value={fields.days}
          onChange={(days) => {
            own.current.days = true;
            write({ ...fields, days });
          }}
        />
      </div>
      {line ? <Note warn>{line}</Note> : null}
    </div>
  );
}

/** Before the signature: the risk's edge — her day once she wrote one — and the fee, as the engine's policy states it. */
function Terms({ budget }: { budget: AgentBudget | null }) {
  const lang = useLang();
  const fee = agentFeeFigures(lang);
  const fw = useWords(FEE);
  return (
    <>
      <Limit budget={budget} />
      <span className={a.cap}>{fw.perTrade(fee.low, fee.high)}</span>
    </>
  );
}

/** «Give 30 SOL»: the action says what the signature takes — the vault's part and the agent's network fees. */
const giveLabel = (w: W, lang: Lang, budget: AgentBudget | null) => (budget ? w.giveSum(budgetText(budgetTotal(budget), lang)) : w.give);

/**
 * What a bot's own page adds to the card («Recurring buys» of a stock): a group of coins under the pills, the
 * budget's fields in place of the day's, lines before the signature, and — while the coin picked is one the agent's
 * engine does not buy yet — the line that says so, in place of the signature.
 */
export type TraderParts = Readonly<{
  coins?: ReactNode;
  budget?: ReactNode;
  terms?: ReactNode;
  apart?: ReadonlySet<string>;
  closed?: string | null;
  /** False — this card's buys hold (a stock's regular buys): no exit line, no sale signed. */
  exit?: boolean;
  /** A bot of the budget's own name and line, and its rule's choices under them (the grid's, a signal's). */
  head?: TraderHead;
  rule?: ReactNode;
}>;

function TraderForm({ note, onAct, parts }: { note: ReactNode; onAct: () => void; parts?: TraderParts }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const budget = useAutopilot((st) => st.budget);
  const plan = useAutopilot((st) => st.plan);
  const tested = useAutopilot((st) => st.tested);
  const coin = useMandate((st) => st.coin);
  const busy = useMandate((st) => st.busy === 'enable');
  const owner = useWallet((st) => st.connection?.address ?? null);
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  const towers = useMarket().towers;
  const book = useMemo(() => bookOf(towers), [towers]);
  const needsCoin = MANDATE_NET === 'mainnet';
  const line = planLine(plan, AUTOPILOT[lang], lang);
  // A wallet that cannot hold the budget and the agent's network fees cannot sign it: the card says what is needed.
  const short = needsCoin && Boolean(owner) && shortOfFunds(spendable, budget);
  // The agent's own exit — shown in one line before the signature, and signed only when shown.
  const sells = sellsOnItsOwn(coin?.mint ?? null, parts?.exit) && !(coin && parts?.apart?.has(coin.mint));
  return (
    <Panel tone="hi" pad="l" gap={16} label={w.newAgent}>
      <Head role="trader" kick={w.newAgent} {...(parts?.head ? { own: parts.head } : {})}>
        <How extra={testedLine(tested?.run ?? null, AUTOPILOT[lang], lang)} />
      </Head>
      {parts?.rule}
      {needsCoin ? <Coins book={book} apart={parts?.apart} /> : null}
      {needsCoin ? parts?.coins : null}
      {line ? <span className={a.plan}>{line}</span> : null}
      {parts?.budget ?? <Budget />}
      <Terms budget={budget} />
      {sells ? <ExitLine rules={exitRulesOf(plan)} /> : null}
      {parts?.terms}
      {needsCoin && !coin && owner ? <Note>{w.pickCoin}</Note> : null}
      {short && budget ? <Note warn>{w.needSol(digits(solAbout(fundsFor(budget).about), lang))}</Note> : null}
      {parts?.closed ? <Note>{parts.closed}</Note> : null}
      {note}
      {needsCoin && !owner ? (
        // The
        // wallet is the last step and says all it does. Before a budget is written, «Practice» puts the cursor in it.
        <>
          <Action onClick={(event) => (coin && budget ? practise() : focusField(event))} data-agent-practice="">
            {w.practice}
          </Action>
          {parts?.closed ? null : (
            <>
              <Quiet full onClick={connect} data-agent-connect="">
                {w.connectSign}
              </Quiet>
              <ConnectOnly />
            </>
          )}
        </>
      ) : (
        <>
          <Give
            label={giveLabel(w, lang, budget)}
            busy={busy}
            disabled={!budget || (needsCoin && !coin) || short || Boolean(parts?.closed)}
            empty={!budget && !(needsCoin && !coin) && !parts?.closed}
            onPress={(who) => {
              onAct();
              void signTrade(who, { exit: sells });
            }}
          />
          {needsCoin ? (
            <Quiet
              full
              disabled={!tested || !coin || !budget}
              onClick={() => {
                funnelSay('agent_practice');
                if (PAPER_OPEN) void startPaperWeek({ connect });
                else startPaper();
              }}
              data-agent-practice=""
            >
              {w.practice}
            </Quiet>
          ) : null}
        </>
      )}
      {needsCoin ? <PaperNote /> : null}
    </Panel>
  );
}

/* ---------------------------------------------------------------- the trader: practice without money */

function TraderPaper({ note, onAct, parts }: { note: ReactNode; onAct: () => void; parts?: TraderParts }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const paper = useAutopilot((st) => st.paper);
  const run = useAutopilot((st) => st.paperRun);
  const budget = useAutopilot((st) => st.budget);
  const busy = useMandate((st) => st.busy === 'enable');
  const owner = useWallet((st) => st.connection?.address ?? null);
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  const short = MANDATE_NET === 'mainnet' && Boolean(owner) && shortOfFunds(spendable, budget);
  useEffect(() => {
    if (!paper) return;
    void readPaper();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void readPaper();
    }, 60_000);
    return () => clearInterval(timer);
  }, [paper, budget]);
  if (!paper) return null;
  const plan = planOfText(paper.plan);
  const line = planLine(plan, AUTOPILOT[lang], lang);
  const pct = run && run.buys > 0 ? run.resultPct : null;
  return (
    <Panel tone="hi" pad="l" gap={16} label={w.paperKick}>
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
      {parts?.budget ?? <Budget />}
      <Terms budget={budget} />
      {parts?.terms}
      {short && budget ? <Note warn>{w.needSol(digits(solAbout(fundsFor(budget).about), lang))}</Note> : null}
      {parts?.closed ? <Note>{parts.closed}</Note> : null}
      {note}
      <Give
        label={giveLabel(w, lang, budget)}
        busy={busy}
        disabled={!budget || short || Boolean(parts?.closed)}
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

/**
 * «Recurring buys» (decision 109: a rule, so a bot): the card that was the Agents screen's «Trader», as it
 * was — the coin, the budget a day and what follows from it, one signature; or the practice on paper.
 */
export function Trader({ note, onAct, parts }: { note: ReactNode; onAct: () => void; parts?: TraderParts }) {
  const paper = useAutopilot((st) => st.paper);
  // The week on paper, where the deployment opens it (`./paper/**`).
  const week = usePaperWeekShown();
  const coin = useMandate((st) => st.coin);
  const towers = useMarket().towers;
  // The practice is kept in this browser: it shows from the first paint after hydration, never in the server's page.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // The card stands on the city's own ask of the agent; a budget she already wrote stays — no sum of Ryntra's is put in.
  useEffect(() => {
    const kept = useAutopilot.getState().budget ?? useMandate.getState().budget;
    const before = useAutopilot.getState();
    if (before.ask?.kind !== 'trade') before.show({ kind: 'trade', said: '', perDaySol: null });
    if (!useAutopilot.getState().budget && kept) useAutopilot.getState().setBudget(kept);
  }, []);
  // On mainnet the agent buys a coin the person names: an example's coin (JUP, else MET) stands picked, one tap changes it.
  useEffect(() => {
    // The store's coin, not this render's: a sentence that named one a moment ago is never written over.
    if (MANDATE_NET !== 'mainnet' || useMandate.getState().coin || !towers.length) return;
    const first = sayCoin(bookOf(towers));
    if (!first) return;
    useMandate.getState().setCoin({ mint: first.mint, symbol: first.symbol, icon: first.icon });
    void testNow();
  }, [towers, coin]);
  if (week && mounted) return <PaperWeek note={note} onAct={onAct} />;
  return paper && mounted ? <TraderPaper note={note} onAct={onAct} parts={parts} /> : <TraderForm note={note} onAct={onAct} parts={parts} />;
}

/* ---------------------------------------------------------------- the autopilot: one plan for the whole budget */

const pctOf = (bps: number, lang: 'en' | 'uk') => digits(`${Math.round(bps / 100)}%`, lang);

/** The plan's parts as one bar and a line each: a name, a share, and — before the signature — what it holds. */
export function Split({ shares, plan, solUsd }: { shares: Readonly<Record<PilotPart, number>>; plan: PilotPlanData; solUsd: number | null }) {
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

/** The city's example sum in its starter's words («0.2 SOL»): the person's own sum takes its place. */
const STARTER_SUM: Readonly<Record<Lang, string>> = { en: '0.2', uk: '0,2' };
const LANG_IDS: readonly Lang[] = ['en', 'uk'];
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The starter's words with the person's own sum, for the plan's record. */
function starterSaid(lang: Lang, sum: string): string {
  return PILOT_STARTER[lang].split(STARTER_SUM[lang]).join(sum);
}

/** The longest words a plan keeps — the agent's line's own (`COMMAND_MAX`); the book takes no more. */
const SAID_MAX = 140;

/**
 * A sentence's words with the sum the person typed in place of its SOL sum (any way the line reads SOL: «SOL», «sol»,
 * «сол», «солана», «2sol»); none, when its sum is not in SOL or the words would grow past what the book keeps.
 */
function sentenceSaid(said: string, sum: string): string {
  const at = /\d[\d.,]*(?=\s*(?:sol|сол|солан\p{L}*|соль)(?![\p{L}\d]))/iu;
  if (!at.test(said)) return '';
  const words = said.replace(at, sum);
  return words.length <= SAID_MAX ? words : '';
}

/** Whether a plan's words are the starter's — none yet, or the starter's with a sum the person typed. */
function isStarter(said: string): boolean {
  return said === '' || LANG_IDS.some((lang) => new RegExp(`^${escaped(PILOT_STARTER[lang]).split(escaped(STARTER_SUM[lang])).join('[\\d.,]+')}$`, 'u').test(said));
}

/**
 * The sum the autopilot puts to work: the person's own — never a sum of Ryntra's (decision 108). A sentence's sum stands
 * in it; a sum typed here spreads by the plan's parts as they are — the sentence's, or the city's starter ones.
 */
function PilotSum({ shape }: { shape: PilotAsk | null }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const ask = usePilot((st) => st.ask);
  const towers = useMarket().towers;
  const owner = useWallet((st) => st.connection?.address ?? null);
  const spendable = useWallet((st) => (st.holdingsRead === 'ready' && st.holdings && st.holdings.owner === owner ? (st.holdings.sol?.spendableRaw ?? null) : null));
  const spendRaw = PILOT_NET === 'mainnet' && spendable && /^\d{1,20}$/u.test(spendable) ? spendable : null;
  const phase = usePilot((st) => st.phase);
  const working = usePilot((st) => st.view?.status === 'working');
  // While the wallet signs, the plan works or stops, the sum at work is the one signed: the field only shows it. A plan
  // stopped gives the field back.
  const locked = phase === 'signing' || phase === 'stopping' || (phase === 'live' && working);
  const [text, setText] = useState('');
  const typing = useRef(false);
  // The plan's sum into the field — a sentence's — while the person is not writing.
  useEffect(() => {
    if (typing.current) return;
    setText(ask?.solRaw ? budgetText(BigInt(ask.solRaw), lang) : '');
  }, [ask, lang]);
  const write = (typed: string) => {
    const st = usePilot.getState();
    if (st.phase === 'signing' || st.phase === 'stopping' || (st.phase === 'live' && st.view?.status === 'working')) return;
    typing.current = true;
    setText(typed);
    const base = st.ask ?? shape;
    if (!base) return;
    const raw = lamportsTyped(typed);
    // The starter's words carry the person's own sum; a sentence she said keeps its words with the sum she typed now
    // (its SOL sum rewritten; a sentence whose sum is not in SOL keeps no words rather than a sum that is not at work).
    const said = isStarter(base.said) ? (raw === null ? '' : starterSaid(lang, budgetText(raw, lang))) : raw === null ? base.said : sentenceSaid(base.said, budgetText(raw, lang));
    const first = st.coin ?? sayCoin(bookOf(towers));
    // The field is the whole sum, in SOL: a sentence's USDC sum gives way to it.
    st.show({ ...base, said, solRaw: raw === null ? null : raw.toString(), usdcRaw: raw === null ? base.usdcRaw : null }, st.solUsd, first ? { mint: first.mint, symbol: first.symbol, icon: first.icon } : null);
  };
  return (
    <div
      onBlur={() => {
        typing.current = false;
      }}
    >
      <AmountField label={w.pilotSum} aside={spendRaw !== null ? w.balance(solPlain(spendRaw, lang)) : undefined} value={text} onChange={write} asset={SOL_ASSET} readOnly={locked} />
    </div>
  );
}

/**
 * The money autopilot's plan for the whole budget, before the signature: the sum the person puts to work, its shares and
 * what they hold, its one action. Before a sum is written — the parts the plan will spread it into, in words, and the
 * action waits for the sum (QA 19.11: a «$15 to put to work» nobody wrote, with no field to change it).
 */
export function PilotPropose({ solUsd }: { solUsd: number | null }) {
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
  const fw = useWords(FEE);

  // The city's own starter plan — its parts, not its sum: the sum is the person's (decision 108).
  const shape = useMemo<PilotAsk | null>(() => {
    const book = bookOf(towers);
    const starter = readPilotAsk(PILOT_STARTER[lang], book) ?? readPilotAsk(PILOT_STARTER.en, book);
    return starter ? { ...starter, said: '', solRaw: null, usdcRaw: null } : null;
  }, [towers, lang]);
  // Nothing said yet: the starter's parts, for the person to read and give a sum to before anything is signed.
  useEffect(() => {
    if (usePilot.getState().ask || !shape) return;
    const first = sayCoin(bookOf(towers));
    usePilot.getState().show(shape, solUsd, first ? { mint: first.mint, symbol: first.symbol, icon: first.icon } : null);
  }, [shape, towers, solUsd]);
  useEffect(() => usePilot.getState().reprice(solUsd), [solUsd]);

  const sized = Boolean(ask && (ask.solRaw || ask.usdcRaw));
  if (!ask || !sized || !split || !plan) {
    return (
      <Panel tone="hi" pad="l" gap={16} label={w.newAgent}>
        <Head role="pilot" kick={w.newAgent}>
          <PilotInfo />
        </Head>
        <PilotSum shape={shape} />
        <span className={a.cap}>{sized ? w.readingPrices : w.pilotParts}</span>
        <Edge text={w.pilotRisk} />
        {/* The one action is always lit (QA 20.11, вада 29: a pale «Practice first» read as switched off): with no sum yet
            it puts the cursor in the sum's field — nothing starts before the person writes one. */}
        <Action onClick={(event) => event.currentTarget.closest('section')?.querySelector<HTMLInputElement>('input')?.focus()} data-agent-practice="">
          {w.practice}
        </Action>
      </Panel>
    );
  }
  const short = walletShort(split.legs, PILOT_NET, holdings);
  const total = priced !== null && !short ? PILOT_PARTS.reduce((sum, part) => sum + legsUsd(split.legs, priced)[part], 0) : null;
  const onPaper = phase === 'paper' || phase === 'signing';
  const result = paper ? usdShown(paper.totalUsd, lang) : null;
  const noCoin = Boolean(split.budget) && PILOT_NET === 'mainnet' && !coin;
  const said: Readonly<Record<NonNullable<typeof note>['kind'], string>> = { on: w.pilotOn, partial: w.pilotPartial, stopped: w.pilotStopped, walletNo: w.noteWalletNo, refused: w.noteRefused, unreachable: w.noteUnreachable };
  return (
    <Panel tone="hi" pad="l" gap={16} label={w.newAgent}>
      <Head role="pilot" kick={w.newAgent}>
        <PilotInfo />
      </Head>
      <PilotSum shape={shape} />
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
      {split.budget ? <span className={a.cap}>{`${fw.perTrade(fee.low, fee.high)} · ${w.pilotPayWhen}`}</span> : null}
      <Edge text={ask.solRaw ? w.pilotEdge(budgetText(BigInt(ask.solRaw), lang)) : w.pilotRisk} />
      {noCoin ? <Note>{w.pickCoin}</Note> : null}
      {short ? <Note warn>{w.pilotShort(short)}</Note> : null}
      {note ? <Note warn={note.kind !== 'on' && note.kind !== 'stopped'}>{said[note.kind]}</Note> : null}
      {onPaper ? (
        <Give label={w.give} busy={phase === 'signing'} disabled={noCoin || Boolean(short)} onPress={(who) => void goLive(who)} />
      ) : (
        <Action
          onClick={() => {
            funnelSay('agent_practice');
            void startPilotPaper();
          }}
          data-agent-practice=""
        >
          {w.practice}
        </Action>
      )}
    </Panel>
  );
}
