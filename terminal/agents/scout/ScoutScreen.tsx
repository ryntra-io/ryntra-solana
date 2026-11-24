'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { PaperPosition } from '@/lib/scout/paper';
import type { ScoutView } from '@/lib/scout/view';
import { MenuIcon } from '@/terminal/shell/menu-icons';
import { coinHref } from '@/terminal/shell/shelves';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Action, ActionBody, AmountField, Cell, Chip, CoinLogo, Figure, Info, Kick, Page, PageHead, Panel, Quiet, Table, TableHead, TableRow, Tile, Title, changeText, changeTone, priceText } from '@/terminal/ui';
import { AgentTabs } from './AgentTabs';
import { readView, setBudget, startBudget, useScout, useScoutView } from './store';
import { codeWord, decisionRows, exitWords, minutesSince, personPaper, reasonWord, solField, solSigned, solTyped, stateWord, whyWord } from './view';
import { SCOUT, type ScoutWords } from './words';
import sc from './scout.module.css';

const COLUMNS = 'minmax(150px, 1.1fr) minmax(170px, 1.4fr) minmax(130px, 1fr) minmax(120px, 0.9fr) 44px';
const DECISIONS_SHOWN = 8;

/** How the Scout works: what it reads, what the model does and what code does, how it leaves, how money joins later. */
function HowInfo() {
  const w = useWords(SCOUT);
  return (
    <Info label={w.how}>
      <span className={sc.facts}>
        <span>{w.howRead}</span>
        <span>{w.howModel}</span>
        <span>{w.howPaper}</span>
        <span>{exitWords(w)}</span>
        <span>{w.howMoney}</span>
      </span>
    </Info>
  );
}

/**
 * The Scout — the agent that finds new coins by itself. It reads every new coin, leaves the traps out by their numbers
 * and the chain, has a model write a short thesis, and lets code size the trade inside the person's budget — on paper
 * with live prices. The person sets a day and a trade, starts it in one tap and sees what it bought and why; the details
 * of each trade stand behind its «i». Nothing here signs or moves money.
 */
export function ScoutScreen() {
  const w = useWords(SCOUT);
  const lang = useLang();
  useScoutView();
  useEffect(() => startBudget(), []);
  const state = useScout((st) => st.view);
  const budget = useScout((st) => st.budget);
  const started = useScout((st) => st.started);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [perDay, setPerDay] = useState('');
  const [perTrade, setPerTrade] = useState('');
  const [editing, setEditing] = useState(false);
  // The fields show the kept numbers until the person types.
  useEffect(() => {
    setPerDay(solField(budget.perDayLamports, lang));
    setPerTrade(solField(budget.perTradeLamports, lang));
  }, [budget, lang]);
  const typed = useMemo(() => {
    const day = solTyped(perDay);
    const trade = solTyped(perTrade);
    return day && trade ? { perDayLamports: day, perTradeLamports: trade } : null;
  }, [perDay, perTrade]);
  const dayTyped = solTyped(perDay);
  const view = state.view;
  const paper = useMemo(() => personPaper(view, typed ?? budget, now), [view, typed, budget, now]);
  const open = paper.positions.filter((row) => row.position.closedAt === null).length;
  const locked = started && !editing;

  return (
    <Page className={sc.screen} data-scout="">
      <PageHead title={w.agents} tabs={<AgentTabs value="scout" />} />

      <ActionBody sideLabel={w.today} side={<Side view={view} failed={state.status === 'failed'} now={now} />}>
        <Panel tone="hi" pad="l" gap={16} label={w.scout}>
          <div className={sc.head}>
            <span className={sc.badge}>
              <MenuIcon name="scout" />
            </span>
            <div className={sc.headWords}>
              <Title as="h2" className={sc.title}>
                {w.scout}
              </Title>
              <span className={sc.job}>{w.job}</span>
            </div>
            <HowInfo />
          </div>

          {/* The one figure: the result on the person's budget once the Scout has traded; before that, the budget a day she
              wrote — or, with none written, what to do — never a bare «— SOL» (QA 20.11, as вада 91 of the wallet). */}
          <div className={sc.result} data-scout-result="">
            {paper.positions.length ? (
              <>
                <Kick>{w.resultKick}</Kick>
                <Figure value={solSigned(paper.resultLamports, lang)} unit="SOL" size="xl" tone={paper.resultLamports > 0n ? 'up' : paper.resultLamports < 0n ? 'down' : undefined} />
                <span className={sc.resultLine}>{w.resultLine(digits(String(paper.positions.length), lang), digits(String(open), lang))}</span>
              </>
            ) : (
              <>
                <Kick>{w.budgetKick}</Kick>
                {dayTyped ? <Figure value={solField(dayTyped, lang)} unit="SOL" size="xl" /> : <Figure value={w.writeBudget} size="l" />}
                <span className={sc.resultLine}>{w.noResult}</span>
              </>
            )}
          </div>

          <div className={sc.fields}>
            <AmountField label={w.perDay} size="s" unit="SOL" value={perDay} onChange={setPerDay} readOnly={locked} />
            <AmountField label={w.perTrade} size="s" unit="SOL" value={perTrade} onChange={setPerTrade} readOnly={locked} />
          </div>

          <div className={sc.actions}>
            {locked ? (
              <>
                <Chip tone="ok" dot>
                  {w.working}
                </Chip>
                <span className={sc.grow} />
                <Quiet onClick={() => setEditing(true)} data-scout-change="">
                  {w.change}
                </Quiet>
                <Quiet onClick={() => setBudget(budget, false)} data-scout-stop="">
                  {w.stopIt}
                </Quiet>
              </>
            ) : (
              <Action
                disabled={!typed}
                onClick={() => {
                  if (!typed) return;
                  setBudget(typed, true);
                  setEditing(false);
                }}
                data-scout-start=""
              >
                {w.start}
              </Action>
            )}
          </div>
          <span className={sc.paperLine}>{w.paperLine}</span>
        </Panel>

        <Bought rows={paper.positions} ready={state.status !== 'reading'} />
      </ActionBody>
    </Page>
  );
}

/** What the Scout bought on the person's numbers — the newest first — and why; the details behind each row's «i». */
function Bought({ rows, ready }: { rows: ReturnType<typeof personPaper>['positions']; ready: boolean }) {
  const w = useWords(SCOUT);
  const lang = useLang();
  const narrow = useNarrow();
  return (
    <Panel gap={10} label={w.bought}>
      <Kick>{w.bought}</Kick>
      {!ready ? (
        <span className={sc.bones} aria-hidden="true" />
      ) : !rows.length ? (
        <p className={sc.empty} role="status">
          {w.emptyBought}
        </p>
      ) : narrow ? (
        <div className={sc.list} aria-label={w.boughtLabel}>
          {rows.map((row) => (
            <div key={`${row.position.mint}:${row.position.openedAt}`} className={sc.listRow} data-scout-row="">
              <CoinLogo src={row.position.icon} symbol={row.position.symbol} />
              <span className={sc.listWords}>
                <Link className={sc.sym} href={coinHref(row.position.mint, 'live')}>
                  {row.position.symbol}
                </Link>
                <span className={sc.dim}>{whyWord(w, row.position)}</span>
              </span>
              <span className={sc.listFigures}>
                <span data-tone={changeTone(row.resultPct)}>{changeText(row.resultPct, lang)}</span>
                <span className={sc.dim}>{stateWord(w, row.position)}</span>
              </span>
              <Details w={w} position={row.position} spent={row.spentLamports} />
            </div>
          ))}
        </div>
      ) : (
        <Table columns={COLUMNS} minWidth={640} label={w.boughtLabel}>
          <TableHead>
            <Cell head>{w.coin}</Cell>
            <Cell head>{w.why}</Cell>
            <Cell head end>
              {w.result}
            </Cell>
            <Cell head>{w.state}</Cell>
            <Cell head />
          </TableHead>
          {rows.map((row) => (
            <TableRow key={`${row.position.mint}:${row.position.openedAt}`}>
              <span role="cell" className={sc.coinCell}>
                <CoinLogo src={row.position.icon} symbol={row.position.symbol} />
                <Link className={sc.sym} href={coinHref(row.position.mint, 'live')}>
                  {row.position.symbol}
                </Link>
              </span>
              <Cell>{whyWord(w, row.position)}</Cell>
              <Cell end tone={changeTone(row.resultPct)}>
                <span className={sc.stack}>
                  <span>{changeText(row.resultPct, lang)}</span>
                  <span className={sc.dim}>{`${solSigned(row.resultLamports, lang)} SOL`}</span>
                </span>
              </Cell>
              <Cell tone="dim">{stateWord(w, row.position)}</Cell>
              <span role="cell" className={sc.infoCell}>
                <Details w={w} position={row.position} spent={row.spentLamports} />
              </span>
            </TableRow>
          ))}
        </Table>
      )}
    </Panel>
  );
}

/** A trade's «i»: every reason, what would prove it wrong, what it cost and each sale. */
function Details({ w, position, spent }: { w: ScoutWords; position: PaperPosition; spent: bigint }) {
  const lang = useLang();
  const reasons = position.why.map((code) => codeWord(w, 'f', code)).filter((word): word is string => Boolean(word));
  const wrong = position.invalidation ? codeWord(w, 'i', position.invalidation) : null;
  return (
    <Info label={w.details(position.symbol)}>
      <span className={sc.facts}>
        {reasons.length ? <span>{reasons.join(' · ')}</span> : null}
        {wrong ? <span>{w.wrongIf(wrong)}</span> : null}
        <span>{w.spent(solField(spent, lang), priceText(position.entryPrice, lang))}</span>
        {position.sales.map((sale) => (
          <span key={`${sale.at}:${sale.reason}`}>{w.sold(codeWord(w, 'x', sale.reason) ?? sale.reason, priceText(sale.price, lang))}</span>
        ))}
      </span>
    </Info>
  );
}

/** The side: what the Scout read and left out today, and its latest decisions in one line each. */
function Side({ view, failed, now }: { view: ScoutView | null; failed: boolean; now: number }) {
  const w = useWords(SCOUT);
  const lang = useLang();
  const pass = view?.pass ?? null;
  const decisions = decisionRows(w, view?.decisions ?? [], DECISIONS_SHOWN);
  return (
    <>
      <Panel gap={12} label={w.today}>
        <Kick>{w.today}</Kick>
        {failed && !view ? (
          <span className={sc.failed} role="alert">
            {w.failed}
            <Quiet size="s" onClick={() => void readView()}>
              {w.again}
            </Quiet>
          </span>
        ) : null}
        <div className={sc.tiles}>
          <Tile label={w.seen} value={pass ? digits(String(pass.seen), lang) : '—'} />
          <Tile label={w.passed} value={pass ? digits(String(pass.screened), lang) : '—'} />
        </div>
        {view?.refusals.length ? (
          <div className={sc.cut}>
            <span className={sc.dim}>{w.cutMost}</span>
            {view.refusals.slice(0, 3).map(([code, count]) => {
              const word = reasonWord(w, code);
              return word ? (
                <span key={code} className={sc.cutRow}>
                  <span>{word}</span>
                  <span className={sc.count}>{digits(String(count), lang)}</span>
                </span>
              ) : null;
            })}
          </div>
        ) : null}
        <span className={sc.dim}>{pass ? w.lastPass(digits(String(minutesSince(pass.at, now)), lang)) : w.notYet}</span>
      </Panel>
      <Panel gap={10} label={w.decisions}>
        <Kick>{w.decisions}</Kick>
        {decisions.length ? (
          <div className={sc.decisions}>
            {decisions.map(({ entry, line }) => (
              <Link key={`${entry.mint}:${entry.at}:${entry.outcome}`} className={sc.decision} href={coinHref(entry.mint, 'live')} data-outcome={entry.outcome}>
                <span className={sc.sym}>{entry.symbol}</span>
                <span className={sc.dim}>{line}</span>
              </Link>
            ))}
          </div>
        ) : (
          <span className={sc.dim}>{w.noDecisions}</span>
        )}
      </Panel>
    </>
  );
}
