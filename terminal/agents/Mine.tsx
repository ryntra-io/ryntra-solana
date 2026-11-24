'use client';

import { useState, type ReactNode } from 'react';
import type { AgentView } from '@/city/lib/autopilot/store';
import { dateText, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { Cell, Chip, CoinLogo, Icon, Info, Panel, Quiet, Table, TableHead, TableRow, Tile, Title } from '@/terminal/ui';
import { budgetUse, resultShown, solPlain, usdShown, type Shown } from './figures';
import { RoleBadge } from './glyphs';
import { SignOnce, useSignOnce } from './SignOnce';
import { tradeHistory, workerPath, type MineRow, type PastRow, type RowState } from './rows';
import { AGENTS } from './words';
import a from './agents.module.css';

type W = ReturnType<typeof useWords<(typeof AGENTS)['en']>>;

const WHEN: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
/** The row's end holds «i», «Stop» and «Share»: at least their width, more while «Stop» waits on the wallet. */
const COLUMNS = 'minmax(190px, 1.5fr) minmax(150px, 1.2fr) repeat(2, minmax(90px, 1fr)) minmax(172px, auto)';
const HISTORY_COLUMNS = 'minmax(150px, 1.2fr) minmax(150px, 1.4fr) minmax(110px, 1fr)';

/** A row's state in a word: «Working» — or why it is not. */
function stateWord(w: W, state: RowState): string {
  return { working: w.working, paused: w.statePaused, frozen: w.stateFrozen, confirming: w.stateConfirming, done: w.stateDone, stopped: w.stateStopped }[state];
}

/** The line under an agent's name: its coin or its pool's state, then its time left — or what holds it. */
function subline(w: W, row: MineRow): string {
  if (row.left) return w.notWithdrawn;
  const first = row.coin?.symbol ?? (row.pool === 'moving' ? w.movingRange : row.pool === 'earning' ? w.earning : null);
  const second = row.state !== 'working' ? stateWord(w, row.state) : row.daysLeft === null ? w.noTerm : w.daysLeft(String(row.daysLeft));
  return [first, second].filter(Boolean).join(' · ');
}

/** The row's result as the screen says it; null — not read. */
function resultOf(row: MineRow, solUsd: number | null, lang: Lang): Shown | null {
  if (!row.result) return null;
  return 'usd' in row.result ? usdShown(row.result.usd, lang) : resultShown(row.result.raw, solUsd, lang);
}

/** The day's budget in words: what is spent of it, or the budget alone while the spend is not read. */
function budgetLine(w: W, budget: NonNullable<MineRow['budget']>, lang: Lang): string {
  return budget.spentRaw === null ? `${solPlain(budget.perDayRaw, lang)} SOL` : w.spentOf(solPlain(budget.spentRaw, lang), solPlain(budget.perDayRaw, lang));
}

function Who({ row, name, sub, large = false }: { row: MineRow; name: string; sub: string; large?: boolean }) {
  return (
    <>
      {row.coin ? <CoinLogo src={`/api/icon/${row.coin.mint}`} symbol={row.coin.symbol} size={large ? 'l' : 'm'} /> : <RoleBadge role={row.role} />}
      <span className={large ? a.cardHeadWords : a.whoWords}>
        <span className={large ? a.cardTitle : a.name}>{name}</span>
        {sub ? <span className={a.sub}>{sub}</span> : null}
      </span>
    </>
  );
}

function Bar({ ratio }: { ratio: number | null }) {
  return (
    <span className={a.bar} aria-hidden="true">
      <i style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }} />
    </span>
  );
}

/** What the row's «i» holds: its limits, its money in one line, plain holding beside its result. */
function More({ row, view }: { row: MineRow; view: AgentView | null }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const record = row.stop && 'record' in row.stop ? row.stop.record : null;
  if (row.role !== 'trader' || !record) return null;
  const books = view?.books;
  const hold = view?.net?.holdRaw ?? null;
  const holdShown = hold === null ? null : resultShown(hold, null, lang);
  return (
    <Info label={w.more}>
      <span className={a.facts}>
        <span>{w.limits(solPlain(record.perTrade, lang), solPlain(record.perDay, lang))}</span>
        {books && books.state === 'exact' && books.leftRaw !== null ? <span>{w.money(solPlain(books.budgetRaw, lang), solPlain(books.spentRaw, lang), solPlain(books.leftRaw, lang))}</span> : null}
        {view?.net ? <span>{w.resultAfterFees}</span> : null}
        {holdShown ? <span>{w.holdBeside(holdShown.text)}</span> : null}
        {row.state === 'paused' ? <span>{w.pausedSelf}</span> : null}
      </span>
    </Info>
  );
}

export type MineProps = Readonly<{
  rows: readonly MineRow[];
  owner: string | null;
  /** The traders' books, by policy. */
  views: Readonly<Record<string, AgentView>>;
  solUsd: number | null;
  /** One line after a stop: what happened, in the screen's words. */
  note: ReactNode;
  /** The row whose «Stop» waits on the wallet: one at a time, the others stand still. */
  stopping: string | null;
  onStop: (row: MineRow) => void;
  /** Under the AI trader's plan — «My agents», never «My bots». */
  agent?: boolean;
}>;

/** A trader's book for its row; null for the others. */
const viewOf = (row: MineRow, views: MineProps['views']): AgentView | null => (row.stop && 'record' in row.stop && row.role === 'trader' ? (views[row.stop.record.policy] ?? null) : null);

/**
 * «My bots» of the budget on a desk: one row a bot — the day's budget and what is spent of it, the day's trades, the
 * result as its own book counts it, and «Stop». No wallet, or none at work: one quiet line.
 */
export function MineTable({ rows, owner, views, solUsd, note, stopping, onStop, agent = false }: MineProps) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const names: Readonly<Record<MineRow['role'], string>> = { trader: w.trader, pilot: w.pilot, keeper: w.keeper };
  // The engine said nothing of this wallet for want of its proof — «sign once» stands in place of «none».
  const locked = useSignOnce(owner).shown;
  return (
    // None at work: the name and its one line stand in one row — no wide strip of empty panel (QA 20.11, вада 110).
    <Panel pad="none" label={agent ? w.mineAgents : w.mine} className={rows.length || note ? undefined : a.mineQuiet}>
      <div className={a.mineHead}>
        <Title as="h2" className={a.mineTitle}>
          {agent ? w.mineAgents : w.mine}
        </Title>
        {rows.some((row) => row.state === 'working') ? (
          <Chip tone="ok" dot>
            {w.workingMany}
          </Chip>
        ) : null}
      </div>
      {rows.length ? (
        <Table columns={COLUMNS} minWidth={740} label={w.mine}>
          <TableHead>
            <Cell head>{w.agent}</Cell>
            <Cell head>{w.budgetToday}</Cell>
            <Cell head end>
              {w.trades}
            </Cell>
            <Cell head end>
              {w.result}
            </Cell>
            <Cell head />
          </TableHead>
          {rows.map((row) => {
            const result = resultOf(row, solUsd, lang);
            return (
              <TableRow key={row.key}>
                <Cell className={a.who}>
                  <Who row={row} name={names[row.role]} sub={subline(w, row)} />
                </Cell>
                {row.budget || row.role === 'keeper' ? (
                  <Cell className={a.budget}>
                    <Bar ratio={row.budget ? budgetUse(row.budget.perDayRaw, row.budget.spentRaw) : null} />
                    <span className={a.cap}>{row.budget ? budgetLine(w, row.budget, lang) : w.feeOnly}</span>
                  </Cell>
                ) : (
                  <Cell tone="dim">—</Cell>
                )}
                <Cell end>{row.trades ?? '—'}</Cell>
                <Cell end tone={result?.tone} className={a.resultCell}>
                  <span>{result?.text ?? '—'}</span>
                  {result && row.span !== 'all' ? <span className={a.cap}>{row.span === 'week' ? w.resultWeek : w.today}</span> : null}
                </Cell>
                <Cell className={a.rowEnd}>
                  <More row={row} view={viewOf(row, views)} />
                  {row.stop ? (
                    <Quiet size="s" disabled={stopping !== null} aria-busy={stopping === row.key || undefined} onClick={() => onStop(row)} data-agent-stop={row.role}>
                      {stopping === row.key ? w.stopping : row.left ? w.withdraw : w.stop}
                    </Quiet>
                  ) : null}
                  {result ? <Share text={w.shareText(names[row.role], result.text, row.span)} path={workerPath(row.role)} /> : null}
                </Cell>
              </TableRow>
            );
          })}
        </Table>
      ) : locked ? null : (
        <p className={a.empty}>{owner ? (agent ? w.noAiAgents : w.noAgents) : agent ? w.connectToSeeAgents : w.connectToSee}</p>
      )}
      {/* Under the rows too: a pool the keeper looks after reads without the proof, the bots behind it do not. */}
      <SignOnce owner={owner} variant="row" />
      {note ? <div className={a.notePad}>{note}</div> : null}
    </Panel>
  );
}

/**
 * «Share»: the bot's result as one line and its page's address — the phone's own share sheet, else copied. The result
 * is what the bot's own book counts; nothing is promised.
 */
function Share({ text, path }: { text: string; path: string }) {
  const w = useWords(AGENTS);
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}${path}`;
    try {
      if (typeof navigator.share === 'function') return await navigator.share({ text, url });
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The sheet closed, or the clipboard refused: nothing to say.
    }
  };
  return (
    <Quiet size="s" aria-label={copied ? w.shared : w.share} onClick={() => void share()} className={a.share}>
      <Icon name="share" size="s" />
    </Quiet>
  );
}

/** One agent at work as a card: «my agent» on a phone, and the desk's panel for the agent the screen is about. */
export function AgentCard({
  row,
  view,
  solUsd,
  stopping,
  onStop,
  children,
}: {
  row: MineRow;
  view: AgentView | null;
  solUsd: number | null;
  stopping: string | null;
  onStop: (row: MineRow) => void;
  children?: ReactNode;
}) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const names: Readonly<Record<MineRow['role'], string>> = { trader: w.trader, pilot: w.pilot, keeper: w.keeper };
  const result = resultOf(row, solUsd, lang);
  return (
    <Panel gap={12} label={names[row.role]}>
      <div className={a.cardHead}>
        <Who row={row} name={names[row.role]} sub={row.left ? '' : subline(w, row)} large />
        <More row={row} view={view} />
        <Chip tone={row.state === 'working' ? 'ok' : 'warn'} dot={row.state === 'working'}>
          {row.left ? w.notWithdrawn : stateWord(w, row.state)}
        </Chip>
      </div>
      {row.budget ? (
        <div className={a.budget}>
          <Bar ratio={budgetUse(row.budget.perDayRaw, row.budget.spentRaw)} />
          <span className={a.between}>
            <span className={a.cap}>{w.budgetToday}</span>
            <span className={a.capStrong}>{budgetLine(w, row.budget, lang)}</span>
          </span>
        </div>
      ) : null}
      {/* Stopped, not withdrawn: nothing works today — its one figure would be an empty «—»; only «Withdraw» stands. */}
      {row.left ? null : (
        <div className={a.tiles}>
          {row.trades !== null ? <Tile label={w.tradesToday} value={row.trades} /> : null}
          <Tile label={row.span === 'week' ? w.resultWeek : row.span === 'day' ? w.today : w.result} value={result?.text ?? '—'} tone={result?.tone} />
        </div>
      )}
      {children}
      {row.stop ? (
        <Quiet full disabled={stopping !== null} aria-busy={stopping === row.key || undefined} onClick={() => onStop(row)} data-agent-stop={row.role}>
          {stopping === row.key ? w.stopping : row.left ? w.withdraw : w.stop}
        </Quiet>
      ) : null}
    </Panel>
  );
}

/** «My agents» on a phone: one card an agent, as the approved design draws it. */
export function MineCards({ rows, owner, views, solUsd, note, stopping, onStop, agent = false }: MineProps) {
  const w = useWords(AGENTS);
  const locked = useSignOnce(owner).shown;
  return (
    <div className={a.cards}>
      {rows.length || locked ? null : <p className={a.emptyPhone}>{owner ? (agent ? w.noAiAgents : w.noAgents) : agent ? w.connectToSeeAgents : w.connectToSee}</p>}
      {rows.map((row) => (
        <AgentCard key={row.key} row={row} view={viewOf(row, views)} solUsd={solUsd} stopping={stopping} onStop={onStop} />
      ))}
      <SignOnce owner={owner} variant="card" />
      {note}
    </div>
  );
}

/**
 * «History»: the trader's last trades as its book keeps them — each by what it really is, a trade still being confirmed
 * never called a failure — and the agents that are over.
 */
export function History({ views, past }: { views: Readonly<Record<string, AgentView>>; past: readonly PastRow[] }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  const trades = tradeHistory(Object.values(views));
  const what: Readonly<Record<ReturnType<typeof tradeHistory>[number]['what'], string>> = { bought: w.bought, confirming: w.confirming, failed: w.notGone, skipped: w.skipped, held: w.dayUsed };
  return (
    <Panel pad="none" label={w.history}>
      <div className={a.mineHead}>
        <Title as="h2" className={a.mineTitle}>
          {w.history}
        </Title>
      </div>
      {trades.length || past.length ? (
        <Table columns={HISTORY_COLUMNS} minWidth={460} label={w.history}>
          <TableHead>
            <Cell head>{w.when}</Cell>
            <Cell head>{w.what}</Cell>
            <Cell head end>
              {w.amount}
            </Cell>
          </TableHead>
          {trades.map((trade) => (
            <TableRow key={trade.key}>
              <Cell tone="dim">{dateText(trade.at, WHEN, lang)}</Cell>
              <Cell>{what[trade.what]}</Cell>
              <Cell end>{trade.spentRaw ? `${solPlain(trade.spentRaw, lang)} SOL` : '—'}</Cell>
            </TableRow>
          ))}
          {past.map((agent) => (
            <TableRow key={agent.key}>
              <Cell tone="dim">{agent.createdAt ? dateText(agent.createdAt, WHEN, lang) : '—'}</Cell>
              <Cell>{w.pastAgent(String(agent.trades))}</Cell>
              <Cell end tone="dim">
                {stateWord(w, agent.state)}
              </Cell>
            </TableRow>
          ))}
        </Table>
      ) : (
        <p className={a.empty}>{w.historyEmpty}</p>
      )}
    </Panel>
  );
}
