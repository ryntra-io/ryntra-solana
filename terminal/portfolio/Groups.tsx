'use client';

import Link from 'next/link';
import { Fragment, useId, useState, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { resultShown, solPlain, usdShown, type Shown } from '@/terminal/agents/figures';
import { RoleBadge } from '@/terminal/agents/glyphs';
import { workerPath, type MineRow, type RowState } from '@/terminal/agents/rows';
import { AGENTS } from '@/terminal/agents/words';
import { TICKET_OPEN } from '@/terminal/coin/Ticket';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { sumText } from '@/terminal/earn/rows';
import { coinHref, shelfOn } from '@/terminal/shell/shelves';
import { Cell, Chip, CoinLogo, Icon, Panel, Quiet, Table, TableHead, TableRow, changeText, changeTone, priceText, type FoldStep } from '@/terminal/ui';
import { NATIVE_SOL_MINT, PROTOCOL_NAME, exitLines, foldWrapped, loanShare, mintOf, platformName, stakeState, type ExitLine, type Group, type GroupId, type MarketFact, type Row } from './all-view';
import { ALL } from './all-words';
import { RiskMark } from './CleanBlock';
import { solFigure, type CleanRead, type RiskReason } from './clean-view';
import { CLEAN } from './clean-words';
import { useExit } from './exit';
import type { ExitDoor } from './exit-view';
import { logoFor, logosFor } from './logos';
import { tinyPrice, unitsFigure } from './portfolio-view';
import type { AllData } from './useAll';
import type { AgentsHeld } from './useAgentsHeld';
import { PORTFOLIO } from './words';
import a from './all.module.css';

type W = ReturnType<typeof useWords<(typeof ALL)['en']>>;
type AW = ReturnType<typeof useWords<(typeof AGENTS)['en']>>;

/** A coin as the ticket takes it. */
export type CoinAsk = Readonly<{ mint: string; symbol: string; name: string; icon: string | null }>;

export type GroupsProps = Readonly<{
  data: AllData;
  /** The wallet on screen is the connected one: its rows can be acted on. */
  own: boolean;
  narrow: boolean;
  door: ExitDoor;
  risk: ReadonlyMap<string, readonly RiskReason[]>;
  cleanRead: CleanRead | null;
  agents: AgentsHeld;
  onTrade: (coin: CoinAsk, side: 'buy' | 'sell') => void;
  onCollect: (id: string) => void;
  onExit: (id: string) => void;
  onClean: () => void;
  /** «Show my agents», where the agents would stand on a device that has not proven the wallet (`./AgentsAsk.tsx`). */
  agentsAsk?: ReactNode;
}>;

export { logoFor, logosFor };

/** A coin's logo with its whole queue of addresses. */
function Logo({ mint, symbol, fact, size = 'm' }: { mint: string; symbol: string; fact: MarketFact | null; size?: 's' | 'm' }) {
  const list = logosFor(mint, fact);
  return <CoinLogo src={list[0] ?? null} also={list.slice(1)} symbol={symbol} size={size} />;
}

const unitsText = (units: number, lang: Lang): string => digits(unitsFigure(units), lang);

/** A coin's price: a tiny one with its zeros folded («$0,0₅1036»), the rest as the terminal writes a price. */
export const coinPrice = (price: number, lang: Lang): string => {
  const tiny = tinyPrice(price);
  return tiny === null ? priceText(price, lang) : digits(tiny, lang);
};

/** A row's name: its coin or its pair; a row without one is named by what it is. */
function nameOf(row: Row, w: W): string {
  if (row.position.protocol === 'native-stake') return w.stake;
  return row.name ?? PROTOCOL_NAME[row.position.protocol] ?? platformName(row.position.platform) ?? '—';
}

/** Whose row it is, for a row that only says its source was not read. */
function sourceName(row: Row, w: W): string {
  if (row.position.protocol === 'wallet') return w.wallet;
  if (row.position.protocol === 'native-stake') return w.stake;
  return PROTOCOL_NAME[row.position.protocol] ?? w.other;
}

function timeOf(iso: string | null, lang: Lang): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleTimeString(lang === 'uk' ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** A row's second line: what stands under its name, and «as of» for a read kept from before. */
function withAge(line: string | null, row: Row, w: W, lang: Lang): string | null {
  const time = row.position.state === 'stale' ? timeOf(row.position.readAt, lang) : null;
  return [line, time ? w.asOf(time) : null].filter(Boolean).join(' · ') || null;
}

const valueText = (usd: number | null, lang: Lang, none: string): string => (usd === null ? none : sumText(usd, lang));

/**
 * Everything the wallet holds, group by group in one order: pools, staking, deposits and loans, other platforms, the
 * agents, the coins, the dust. A group with nothing in it is not on screen. A position is acted on in its own row —
 * «Collect», «Close», «Exit» — where the engine's door is open and the wallet is the person's own; a coin is bought and
 * sold on its ticket; a coin better left alone is lit and says so. On a phone the same groups stand as rows and fold.
 */
export function Groups(props: GroupsProps) {
  const { data, agents } = props;
  // A coin Jupiter carries no route for now has no «Exit» on its row: its «i» says why.
  const unrouted = useExit((st) => st.unrouted);
  const lines = new Map(exitLines(data.groups, unrouted).map((line) => [line.id, line]));
  const group = (id: GroupId) => data.groups.find((entry) => entry.id === id) ?? null;
  const pools = group('pools');
  const staking = group('staking');
  const lending = group('lending');
  const other = group('other');
  const coins = group('coins');
  const dust = group('dust');
  return (
    <div id="positions" className={a.groups}>
      {pools ? <PoolsGroup {...props} group={pools} lines={lines} /> : null}
      {staking ? <StakingGroup {...props} group={staking} lines={lines} /> : null}
      {lending ? <LendingGroup {...props} group={lending} lines={lines} /> : null}
      {other ? <OtherGroup {...props} group={other} /> : null}
      {agents.rows.length ? <AgentsGroup {...props} /> : null}
      {/* Beside the rows too, where the engine refused the wallet for want of this device's proof. */}
      {props.agentsAsk ?? null}
      {coins ? <CoinsGroup {...props} group={coins} /> : null}
      {dust ? <DustGroup {...props} group={dust} /> : null}
    </div>
  );
}

/* ── a group's frame ──────────────────────────────────────────────────── */

function GroupPanel({
  title,
  count,
  usd,
  action,
  info,
  startFolded = false,
  children,
}: {
  title: string;
  count: number;
  usd: number | null;
  action?: ReactNode;
  info?: Readonly<{ label: string; text: string }>;
  startFolded?: boolean;
  children: ReactNode;
}) {
  const w = useWords(ALL);
  const lang = useLang();
  const [open, setOpen] = useState<boolean | null>(null);
  const [how, setHow] = useState(false);
  const howId = useId();
  const bodyId = useId();
  const shown = open ?? !startFolded;
  return (
    <Panel pad="none" edge label={title} className={a.group}>
      <div className={a.groupHead}>
        <h2 className={a.groupName}>
          {title}
          {count > 0 ? <span className={a.groupCount}>{count}</span> : null}
        </h2>
        <span className={a.grow} />
        {usd !== null ? <span className={a.groupSum}>{sumText(usd, lang)}</span> : null}
        {action}
        {info ? <ExplainButton label={info.label} open={how} controls={howId} onToggle={() => setHow((was) => !was)} /> : null}
        <button type="button" className={a.foldBtn} aria-expanded={shown} aria-controls={shown ? bodyId : undefined} aria-label={shown ? w.fold(title) : w.unfold(title)} onClick={() => setOpen(!shown)}>
          <Icon name="chevron" size="s" />
        </button>
      </div>
      {how && info ? (
        <div className={a.groupNote}>
          <ExplainBox id={howId}>{info.text}</ExplainBox>
        </div>
      ) : null}
      {shown ? (
        <div id={bodyId} className={a.groupBody}>
          {children}
        </div>
      ) : null}
    </Panel>
  );
}

/** The rows that only say a source did not answer: one line each, and «Read again». */
function Unread({ rows, reread, busy }: { rows: readonly Row[]; reread: () => void; busy: boolean }) {
  const w = useWords(ALL);
  const unread = rows.filter((row) => row.position.state === 'unread');
  if (!unread.length) return null;
  return (
    <>
      {unread.map((row) => (
        <div key={row.id} className={a.blank}>
          <p className={a.blankLine}>{w.sourceUnread(sourceName(row, w))}</p>
          <Quiet size="s" disabled={busy} onClick={reread}>
            {w.again}
          </Quiet>
        </div>
      ))}
    </>
  );
}

const readRows = (group: Group): Row[] => group.rows.filter((row) => row.position.state !== 'unread');

function Logos({ row, fact }: { row: Row; fact: (mint: string) => MarketFact | null }) {
  if (!row.coins.length) return null;
  return (
    <span className={a.pair} aria-hidden="true">
      {row.coins.map((coin) => (
        <Logo key={coin.mint} mint={coin.mint} fact={fact(coin.mint)} symbol={coin.symbol ?? '?'} size={row.coins.length > 1 ? 's' : 'm'} />
      ))}
    </span>
  );
}

/**
 * `unfold` — a short state the row must not lose once its own column is gone (a pool's «Out of range»): it
 * leads the line under the name, shown only from the table's step `unfold.step` on (`Table fold`).
 */
function NameCell({ row, name, sub, tone, fact, unfold }: { row: Row; name: string; sub: string | null; tone?: 'warn'; fact: (mint: string) => MarketFact | null; unfold?: Readonly<{ step: FoldStep; word: string; tone?: 'warn' }> | null }) {
  return (
    <Cell className={a.nameCell}>
      <Logos row={row} fact={fact} />
      <span className={a.words}>
        <span className={a.name}>{name}</span>
        {sub || unfold ? (
          <span className={a.sub} data-tone={tone}>
            {unfold ? (
              <span className={a.subState} data-unfold={unfold.step} data-tone={unfold.tone}>
                {unfold.word}
                {sub ? ' · ' : null}
              </span>
            ) : null}
            {sub}
          </span>
        ) : null}
      </span>
    </Cell>
  );
}

/** Why a position does not leave in one step, in a person's words. */
function reasonOf(line: ExitLine | undefined, w: W, lang: Lang): string | null {
  if (!line || line.can === 'now' || !line.reason) return null;
  const date = line.untilTime ? new Date(line.untilTime) : null;
  return w.reason(line.reason, {
    pct: line.partPct,
    epoch: line.untilEpoch,
    date: date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(lang === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
  });
}

/** Which rows have their «why» open: one set per group. */
function useOpen(): readonly [(id: string) => boolean, (id: string) => void] {
  const [open, setOpen] = useState<readonly string[]>([]);
  return [(id) => open.includes(id), (id) => setOpen((was) => (was.includes(id) ? was.filter((other) => other !== id) : [...was, id]))];
}

/**
 * A position's own controls: «Collect» where there is something to collect, the way out where one step takes it — and,
 * where it does not, the «i» that says why. Nothing to press on a wallet that is only looked at, or behind a shut door.
 */
function PositionActs({
  row,
  line,
  own,
  door,
  size,
  exitWord,
  whyOpen,
  whyId,
  onWhy,
  onCollect,
  onExit,
}: {
  row: Row;
  line: ExitLine | undefined;
  own: boolean;
  door: ExitDoor;
  size: 's' | 'm';
  exitWord: 'closeRow' | 'exitRow';
  whyOpen: boolean;
  whyId: string;
  onWhy: () => void;
  onCollect: (id: string) => void;
  onExit: (id: string) => void;
}) {
  const w = useWords(ALL);
  const name = nameOf(row, w);
  const leaves = Boolean(line && line.can !== 'no');
  const blocked = Boolean(line && line.can !== 'now' && line.reason);
  return (
    <>
      {blocked ? <ExplainButton label={w.why(name)} open={whyOpen} controls={whyId} onToggle={onWhy} /> : null}
      {own && door.canCollect && row.group === 'pools' && (row.earnedUsd ?? 0) > 0 ? (
        <Quiet size={size} aria-label={w.collectFrom(name)} onClick={() => onCollect(row.id)}>
          {w.collect}
        </Quiet>
      ) : null}
      {own && door.canExit && leaves ? (
        <Quiet size={size} aria-label={exitWord === 'closeRow' ? w.closeOf(name) : w.exitOf(name)} onClick={() => onExit(row.id)}>
          {w[exitWord]}
        </Quiet>
      ) : null}
    </>
  );
}

/** Under a row on a desk: why it does not leave in one step. */
function WhyRow({ id, text }: { id: string; text: string }) {
  return (
    <div id={id} role="note" className={a.groupNote}>
      <p className={a.whyLine}>{text}</p>
    </div>
  );
}

/** A phone's row: logos, a name with its line, the worth with a second figure — and, under it, the row's own controls. */
function PhoneRow({ logos, name, sub, tone, value, second, secondTone, marked = false, onPress, href, foot }: { logos: ReactNode; name: string; sub: ReactNode; tone?: 'warn'; value: string; second?: string | null; secondTone?: 'up' | 'down'; marked?: boolean; onPress?: () => void; href?: string; foot?: ReactNode }) {
  const inner = (
    <>
      {logos}
      <span className={a.words}>
        <span className={a.rowName}>{name}</span>
        {sub ? (
          <span className={a.sub} data-tone={tone}>
            {sub}
          </span>
        ) : null}
      </span>
      <span className={a.rowSide}>
        <span className={a.rowValue}>{value}</span>
        {second ? (
          <span className={a.rowMove} data-tone={secondTone}>
            {second}
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <li data-marked={marked ? '' : undefined}>
      {onPress ? (
        <button type="button" className={a.row} onClick={onPress}>
          {inner}
        </button>
      ) : href ? (
        <Link href={href} className={a.row}>
          {inner}
        </Link>
      ) : (
        <div className={a.row}>{inner}</div>
      )}
      {foot}
    </li>
  );
}

type Lines = ReadonlyMap<string, ExitLine>;

/*
 * Every group's table ends the same way: the worth, then the row's own controls — one width for each on every table,
 * so «Value» stands on one axis from the pools down to the dust, and a wide screen never stretches a short table's
 * middle (eyes 20.11, 90 and 127). The controls' column is as wide as the widest of them («i · Collect · Close», in Ukrainian too) on the
 * person's own wallet, and as wide as one «i» on a wallet only looked at — kept empty where a group has nothing to press.
 */
const VALUE_COLUMN = '128px';
const ACTS_COLUMN = '240px';
const READ_ACTS_COLUMN = '44px';
/** A group's columns: its own first ones, then the worth and the controls every table shares. */
const columnsOf = (lead: string, own: boolean): string => `${lead} ${VALUE_COLUMN} ${own ? ACTS_COLUMN : READ_ACTS_COLUMN}`;
/**
 * A group's steps on a narrower panel: its own first columns with the quieter ones gone, then the
 * same worth and controls — the table takes the first that fits (`Table fold`), so the row's controls stay whole.
 */
const foldOf = (leads: readonly string[], own: boolean): string[] => leads.map((lead) => columnsOf(lead, own));

/* ── pools ────────────────────────────────────────────────────────────── */

/* Position · Range · To collect, then the worth; a wallet only looked at keeps only the «i» of a position that does not leave in one step. */
const POOL_LEAD = 'minmax(170px, 2fr) minmax(150px, 1.4fr) minmax(96px, 128px)';
/** Narrower: the range goes first, then what is to collect. */
const POOL_FOLD = ['minmax(170px, 2fr) minmax(96px, 128px)', 'minmax(170px, 2fr)'] as const;

function PoolsGroup({ data, group, lines, own, door, narrow, onCollect, onExit }: GroupsProps & { group: Group; lines: Lines }) {
  const w = useWords(ALL);
  const p = useWords(PORTFOLIO);
  const lang = useLang();
  const [isOpen, toggle] = useOpen();
  const whyBase = useId();
  const rows = readRows(group);
  const rangeOf = (row: Row): string | null => {
    const mark = row.position.refs.position ? data.ranges.get(row.position.refs.position) : undefined;
    return mark ? digits(mark, lang) : null;
  };
  const acts = (row: Row, size: 's' | 'm') => (
    <PositionActs row={row} line={lines.get(row.id)} own={own} door={door} size={size} exitWord="closeRow" whyOpen={isOpen(row.id)} whyId={`${whyBase}-${row.id}`} onWhy={() => toggle(row.id)} onCollect={onCollect} onExit={onExit} />
  );
  return (
    <GroupPanel title={w.pools} count={group.count} usd={group.usd}>
      {rows.length ? (
        narrow ? (
          <ul className={a.rows}>
            {rows.map((row) => {
              const state = row.position.inRange === null ? null : row.position.inRange ? w.inRange : w.outOfRange;
              const why = isOpen(row.id) ? reasonOf(lines.get(row.id), w, lang) : null;
              return (
                <PhoneRow
                  key={row.id}
                  logos={<Logos row={row} fact={data.fact} />}
                  name={nameOf(row, w)}
                  sub={withAge([state, rangeOf(row)].filter(Boolean).join(' · ') || PROTOCOL_NAME[row.position.protocol], row, w, lang)}
                  tone={row.position.inRange === false ? 'warn' : undefined}
                  value={valueText(row.usd, lang, p.noPrice)}
                  second={row.earnedUsd !== null && row.earnedUsd > 0 ? sumText(row.earnedUsd, lang, true) : null}
                  secondTone="up"
                  foot={
                    <div className={a.rowFoot}>
                      {acts(row, 'm')}
                      {why ? (
                        <p id={`${whyBase}-${row.id}`} role="note" className={a.whyLine}>
                          {why}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              );
            })}
          </ul>
        ) : (
          <Table columns={columnsOf(POOL_LEAD, own)} fold={foldOf(POOL_FOLD, own)} minWidth={own ? 740 : 540} label={w.pools}>
            <TableHead>
              <Cell head>{w.position}</Cell>
              <Cell head fold={1}>
                {w.range}
              </Cell>
              <Cell head end fold={2}>
                {w.earned}
              </Cell>
              <Cell head end sorted>
                {p.value}
              </Cell>
              <Cell head />
            </TableHead>
            {rows.map((row) => {
              const why = isOpen(row.id) ? reasonOf(lines.get(row.id), w, lang) : null;
              const mark = rangeOf(row);
              return (
                <Fragment key={row.id}>
                  <TableRow>
                    <NameCell
                      row={row}
                      fact={data.fact}
                      name={nameOf(row, w)}
                      sub={withAge(PROTOCOL_NAME[row.position.protocol], row, w, lang)}
                      unfold={row.position.inRange === null ? null : { step: 1, word: row.position.inRange ? w.inRange : w.outOfRange, tone: row.position.inRange ? undefined : 'warn' }}
                    />
                    <Cell className={a.rangeCell} fold={1}>
                      {row.position.inRange === null ? null : <Chip tone={row.position.inRange ? 'ok' : 'warn'}>{row.position.inRange ? w.inRange : w.outOfRange}</Chip>}
                      {mark ? <span className={a.rangeMark}>{mark}</span> : null}
                    </Cell>
                    <Cell end tone={row.earnedUsd !== null && row.earnedUsd > 0 ? 'up' : 'dim'} fold={2}>
                      {row.earnedUsd === null ? '—' : sumText(row.earnedUsd, lang)}
                    </Cell>
                    <Cell end>{valueText(row.usd, lang, p.noPrice)}</Cell>
                    <Cell end className={a.rowActs}>
                      {acts(row, 's')}
                    </Cell>
                  </TableRow>
                  {why ? <WhyRow id={`${whyBase}-${row.id}`} text={why} /> : null}
                </Fragment>
              );
            })}
          </Table>
        )
      ) : null}
      <Unread rows={group.rows} reread={data.reread} busy={data.rereading} />
    </GroupPanel>
  );
}

/* ── staking ──────────────────────────────────────────────────────────── */

/* Position · State · Amount, then the worth: the middle stays as wide as it holds, never a gap a wide screen opens. */
const STAKE_LEAD = 'minmax(180px, 2.4fr) minmax(130px, 1fr) minmax(110px, 1fr)';
/** Narrower: the amount goes first, then the state. */
const STAKE_FOLD = ['minmax(180px, 2.4fr) minmax(130px, 1fr)', 'minmax(180px, 2.4fr)'] as const;

function stakeWord(row: Row, w: W): Readonly<{ word: string; tone: 'ok' | 'warn' | 'plain' }> | null {
  const state = stakeState(row.position);
  // A staked coin (JitoSOL, mSOL…) earns as it is held: its «State» says so, never an empty cell (QA 19.11, B-19).
  if (state === 'coin' || state === 'active') return { word: w.stakeActive, tone: 'ok' };
  if (state === 'cooling') return { word: w.stakeCooling, tone: 'warn' };
  return { word: state === 'free' ? w.stakeFree : w.stakeHeld, tone: 'plain' };
}

function StakingGroup({ data, group, lines, own, door, narrow, onCollect, onExit }: GroupsProps & { group: Group; lines: Lines }) {
  const w = useWords(ALL);
  const p = useWords(PORTFOLIO);
  const lang = useLang();
  const [isOpen, toggle] = useOpen();
  const whyBase = useId();
  const rows = readRows(group);
  const amount = (row: Row): string | null => (row.units === null ? null : `${unitsText(row.units, lang)} ${row.coins[0]?.symbol ?? 'SOL'}`);
  const acts = (row: Row, size: 's' | 'm') => (
    <PositionActs row={row} line={lines.get(row.id)} own={own} door={door} size={size} exitWord="exitRow" whyOpen={isOpen(row.id)} whyId={`${whyBase}-${row.id}`} onWhy={() => toggle(row.id)} onCollect={onCollect} onExit={onExit} />
  );
  return (
    <GroupPanel title={w.staking} count={group.count} usd={group.usd}>
      {rows.length ? (
        narrow ? (
          <ul className={a.rows}>
            {rows.map((row) => {
              const state = stakeWord(row, w);
              const why = isOpen(row.id) ? reasonOf(lines.get(row.id), w, lang) : null;
              return (
                <PhoneRow
                  key={row.id}
                  logos={<Logos row={row} fact={data.fact} />}
                  name={nameOf(row, w)}
                  sub={withAge(state?.word ?? amount(row), row, w, lang)}
                  tone={state?.tone === 'warn' ? 'warn' : undefined}
                  value={valueText(row.usd, lang, p.noPrice)}
                  second={state ? amount(row) : null}
                  foot={
                    <div className={a.rowFoot}>
                      {acts(row, 'm')}
                      {why ? (
                        <p id={`${whyBase}-${row.id}`} role="note" className={a.whyLine}>
                          {why}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              );
            })}
          </ul>
        ) : (
          <Table columns={columnsOf(STAKE_LEAD, own)} fold={foldOf(STAKE_FOLD, own)} minWidth={own ? 740 : 560} label={w.staking}>
            <TableHead>
              <Cell head>{w.position}</Cell>
              <Cell head fold={2}>
                {w.state}
              </Cell>
              <Cell head end fold={1}>
                {p.amount}
              </Cell>
              <Cell head end sorted>
                {p.value}
              </Cell>
              <Cell head />
            </TableHead>
            {rows.map((row) => {
              const state = stakeWord(row, w);
              const why = isOpen(row.id) ? reasonOf(lines.get(row.id), w, lang) : null;
              return (
                <Fragment key={row.id}>
                  <TableRow>
                    <NameCell row={row} fact={data.fact} name={nameOf(row, w)} sub={withAge(null, row, w, lang)} />
                    <Cell fold={2}>{state ? <Chip tone={state.tone}>{state.word}</Chip> : null}</Cell>
                    <Cell end tone="dim" fold={1}>
                      {amount(row) ?? '—'}
                    </Cell>
                    <Cell end>{valueText(row.usd, lang, p.noPrice)}</Cell>
                    <Cell end className={a.rowActs}>
                      {acts(row, 's')}
                    </Cell>
                  </TableRow>
                  {why ? <WhyRow id={`${whyBase}-${row.id}`} text={why} /> : null}
                </Fragment>
              );
            })}
          </Table>
        )
      ) : null}
      <Unread rows={group.rows} reread={data.reread} busy={data.rereading} />
    </GroupPanel>
  );
}

/* ── deposits and loans ───────────────────────────────────────────────── */

/* Position · State · Earned, then the worth. */
const LEND_LEAD = 'minmax(170px, 2fr) minmax(200px, 1.6fr) minmax(96px, 128px)';
/** Narrower: the state goes first, then the interest. */
const LEND_FOLD = ['minmax(170px, 2fr) minmax(96px, 128px)', 'minmax(170px, 2fr)'] as const;

function LendingGroup({ data, group, lines, own, door, narrow, onCollect, onExit }: GroupsProps & { group: Group; lines: Lines }) {
  const w = useWords(ALL);
  const p = useWords(PORTFOLIO);
  const lang = useLang();
  const [isOpen, toggle] = useOpen();
  const whyBase = useId();
  const rows = readRows(group);
  const kind = (row: Row): string => {
    if (row.position.kind !== 'borrow') return w.deposit;
    const share = loanShare(row, rows);
    return share === null ? w.loan : `${w.loan} · ${w.loanShare(digits(String(Math.round(share)), lang))}`;
  };
  const acts = (row: Row, size: 's' | 'm') => (
    <PositionActs row={row} line={lines.get(row.id)} own={own} door={door} size={size} exitWord="exitRow" whyOpen={isOpen(row.id)} whyId={`${whyBase}-${row.id}`} onWhy={() => toggle(row.id)} onCollect={onCollect} onExit={onExit} />
  );
  return (
    <GroupPanel title={w.lendingGroup} count={group.count} usd={group.usd}>
      {rows.length ? (
        narrow ? (
          <ul className={a.rows}>
            {rows.map((row) => {
              const why = isOpen(row.id) ? reasonOf(lines.get(row.id), w, lang) : null;
              return (
                <PhoneRow
                  key={row.id}
                  logos={<Logos row={row} fact={data.fact} />}
                  name={nameOf(row, w)}
                  sub={withAge([PROTOCOL_NAME[row.position.protocol], kind(row)].filter(Boolean).join(' · '), row, w, lang)}
                  value={valueText(row.usd, lang, p.noPrice)}
                  second={row.earnedUsd !== null && row.earnedUsd > 0 ? sumText(row.earnedUsd, lang, true) : null}
                  secondTone="up"
                  foot={
                    <div className={a.rowFoot}>
                      {acts(row, 'm')}
                      {why ? (
                        <p id={`${whyBase}-${row.id}`} role="note" className={a.whyLine}>
                          {why}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              );
            })}
          </ul>
        ) : (
          <Table columns={columnsOf(LEND_LEAD, own)} fold={foldOf(LEND_FOLD, own)} minWidth={own ? 760 : 580} label={w.lendingGroup}>
            <TableHead>
              <Cell head>{w.position}</Cell>
              <Cell head fold={1}>
                {w.state}
              </Cell>
              <Cell head end fold={2}>
                {w.interest}
              </Cell>
              <Cell head end sorted>
                {p.value}
              </Cell>
              <Cell head />
            </TableHead>
            {rows.map((row) => {
              const why = isOpen(row.id) ? reasonOf(lines.get(row.id), w, lang) : null;
              return (
                <Fragment key={row.id}>
                  <TableRow>
                    <NameCell row={row} fact={data.fact} name={nameOf(row, w)} sub={withAge(PROTOCOL_NAME[row.position.protocol], row, w, lang)} />
                    <Cell className={a.plain} fold={1}>
                      {kind(row)}
                    </Cell>
                    <Cell end tone={row.earnedUsd !== null && row.earnedUsd > 0 ? 'up' : 'dim'} fold={2}>
                      {row.earnedUsd === null ? '—' : sumText(row.earnedUsd, lang)}
                    </Cell>
                    <Cell end>{valueText(row.usd, lang, p.noPrice)}</Cell>
                    <Cell end className={a.rowActs}>
                      {acts(row, 's')}
                    </Cell>
                  </TableRow>
                  {why ? <WhyRow id={`${whyBase}-${row.id}`} text={why} /> : null}
                </Fragment>
              );
            })}
          </Table>
        )
      ) : null}
      <Unread rows={group.rows} reread={data.reread} busy={data.rereading} />
    </GroupPanel>
  );
}

/* ── other platforms ──────────────────────────────────────────────────── */

/* Position · Platform, then the worth; nothing to press — the controls' column stays empty, for the axis. */
const OTHER_LEAD = 'minmax(200px, 2.4fr) minmax(150px, 1.6fr)';
/** Narrower: the platform goes. */
const OTHER_FOLD = ['minmax(200px, 2.4fr)'] as const;

function OtherGroup({ data, group, own, narrow }: GroupsProps & { group: Group }) {
  const w = useWords(ALL);
  const p = useWords(PORTFOLIO);
  const lang = useLang();
  const rows = readRows(group);
  if (!rows.length) return null;
  return (
    <GroupPanel title={w.other} count={group.count} usd={group.usd} info={{ label: w.otherInfo, text: w.otherText }}>
      {narrow ? (
        <ul className={a.rows}>
          {rows.map((row) => (
            <PhoneRow key={row.id} logos={<Logos row={row} fact={data.fact} />} name={nameOf(row, w)} sub={platformName(row.position.platform)} value={valueText(row.usd, lang, p.noPrice)} />
          ))}
        </ul>
      ) : (
        <Table columns={columnsOf(OTHER_LEAD, own)} fold={foldOf(OTHER_FOLD, own)} minWidth={520} label={w.other}>
          <TableHead>
            <Cell head>{w.position}</Cell>
            <Cell head fold={1}>
              {w.platform}
            </Cell>
            <Cell head end sorted>
              {p.value}
            </Cell>
            <Cell head />
          </TableHead>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <NameCell row={row} fact={data.fact} name={nameOf(row, w)} sub={null} />
              <Cell tone="dim" fold={1}>
                {platformName(row.position.platform) ?? '—'}
              </Cell>
              <Cell end>{valueText(row.usd, lang, p.noPrice)}</Cell>
              <Cell />
            </TableRow>
          ))}
        </Table>
      )}
    </GroupPanel>
  );
}

/* ── the coins ────────────────────────────────────────────────────────── */

/* Coin · Amount · Price · 24h, then the worth; the whole page's width, or 720 beside an open panel, without a sideways scroll. */
const COIN_LEAD = 'minmax(140px, 2fr) minmax(80px, 1fr) minmax(84px, 1fr) minmax(60px, 0.6fr)';
/** Narrower: the amount and the price go; the day's move, the worth and «Buy · Sell» stay, as on a phone. */
const COIN_FOLD = ['minmax(140px, 2fr) minmax(60px, 0.6fr)'] as const;

type CoinView = Readonly<{ row: Row; mint: string; symbol: string; name: string; dayPct: number | null; risk: readonly RiskReason[]; ask: CoinAsk; fact: MarketFact | null }>;

/** How much of SOL's row is wrapped SOL folded into it, in a few words; null for any other row. */
const wrappedLine = (row: Row, p: ReturnType<typeof useWords<(typeof PORTFOLIO)['en']>>, lang: Lang): string | null => (row.wrapped ? p.withWrapped(unitsText(row.wrapped, lang)) : null);

/** Native SOL is Solana itself — never «Wrapped SOL», the market's name of the token account's coin. */
const isNative = (row: Row): boolean => row.position.id === 'wallet:sol';
/** Wrapped SOL: SOL's ticket trades native SOL, so its row has no «Buy · Sell» — «Clean wallet» unwraps it. */
const isWrapped = (row: Row): boolean => !isNative(row) && mintOf(row.position) === NATIVE_SOL_MINT;

function coinView(row: Row, data: AllData, risk: GroupsProps['risk'], solana: string): CoinView | null {
  const mint = mintOf(row.position);
  if (!mint) return null;
  const market = data.coin(mint);
  const fact = data.fact(mint);
  const symbol = (row.name ?? row.coins[0]?.symbol ?? fact?.symbol ?? '?').replace(/^\$+/, '');
  const name = isNative(row) ? solana : (market?.name ?? symbol);
  // A day's move only for a coin with a price: a coin listed «No price» says nothing of its day.
  const dayPct = row.usd === null ? null : (market?.dayPct ?? null);
  return { row, mint, symbol, name, dayPct, risk: risk.get(mint) ?? [], ask: { mint, symbol, name, icon: logoFor(mint, fact) }, fact };
}

/** A coin's first cell: its logo, its ticker and its name — or, for a coin better left alone, its mark where the name would stand. Always two lines. */
function CoinNameCell({ coin, href, note = null }: { coin: CoinView; href?: string; note?: string | null }) {
  const ticker = href ? (
    <Link href={href} className={a.name}>
      {coin.symbol}
    </Link>
  ) : (
    <span className={a.name}>{coin.symbol}</span>
  );
  return (
    <span role="cell" className={coin.risk.length ? a.marked : a.nameCell}>
      <Logo mint={coin.mint} fact={coin.fact} symbol={coin.symbol} />
      <span className={a.words}>
        {ticker}
        {/* Every row has its second line, as the kit's coin cell does — a coin the market names by its ticker (USDT)
            says it twice rather than stand a line shorter than its neighbours (QA 19.11, eyes 30). */}
        {coin.risk.length ? <RiskMark symbol={coin.symbol} risk={coin.risk} /> : <span className={a.sub}>{note ? `${coin.name} · ${note}` : coin.name}</span>}
      </span>
    </span>
  );
}

/** Under a marked coin's row on a phone: its word, and why behind it. */
function MarkFoot({ coin }: { coin: CoinView }) {
  return (
    <div className={a.rowMark}>
      <RiskMark symbol={coin.symbol} risk={coin.risk} wide />
    </div>
  );
}

function CoinsGroup({ data, group, own, narrow, risk, onTrade }: GroupsProps & { group: Group }) {
  const w = useWords(ALL);
  const p = useWords(PORTFOLIO);
  const lang = useLang();
  const linked = shelfOn('market');
  const trades = own && TICKET_OPEN;
  const [unpricedOpen, setUnpricedOpen] = useState(false);
  const read = readRows(group);
  const shown = foldWrapped(read);
  const all = shown.flatMap((row) => coinView(row, data, risk, p.solana) ?? []);
  // The coins nobody prices stand folded at the list's end: a wallet's spam never buries what it holds.
  const priced = all.filter((coin) => coin.row.usd !== null);
  const unpriced = all.filter((coin) => coin.row.usd === null);
  const coins = unpricedOpen ? all : priced;
  const fold = unpriced.length ? (
    <button type="button" className={a.moreRow} aria-expanded={unpricedOpen} onClick={() => setUnpricedOpen((was) => !was)}>
      <span>{unpricedOpen ? p.noPriceFold : p.noPriceMore(digits(String(unpriced.length), lang))}</span>
      <Icon name="chevron" size="s" />
    </button>
  ) : null;
  return (
    <GroupPanel title={w.coins} count={group.count - (read.length - shown.length)} usd={group.usd}>
      {coins.length ? (
        narrow ? (
          <ul className={a.rows}>
            {coins.map((coin) => (
              <PhoneRow
                key={coin.row.id}
                logos={<Logo mint={coin.mint} fact={coin.fact} symbol={coin.symbol} />}
                name={coin.symbol}
                sub={[coin.row.units === null ? null : `${unitsText(coin.row.units, lang)} ${coin.symbol}`, wrappedLine(coin.row, p, lang)].filter(Boolean).join(' · ') || null}
                foot={coin.risk.length ? <MarkFoot coin={coin} /> : undefined}
                marked={coin.risk.length > 0}
                value={valueText(coin.row.usd, lang, p.noPrice)}
                second={coin.dayPct !== null ? changeText(coin.dayPct, lang) : null}
                secondTone={coin.dayPct !== null ? changeTone(coin.dayPct) : undefined}
                onPress={trades && !isWrapped(coin.row) ? () => onTrade(coin.ask, 'buy') : undefined}
              />
            ))}
          </ul>
        ) : (
          <Table columns={columnsOf(COIN_LEAD, own)} fold={foldOf(COIN_FOLD, own)} minWidth={own ? 740 : 580} label={w.coins}>
            <TableHead>
              <Cell head>{p.coin}</Cell>
              <Cell head end fold={1}>
                {p.amount}
              </Cell>
              <Cell head end fold={1}>
                {p.price}
              </Cell>
              <Cell head end>
                {p.change}
              </Cell>
              <Cell head end sorted>
                {p.value}
              </Cell>
              <Cell head />
            </TableHead>
            {coins.map((coin) => (
              <TableRow key={coin.row.id}>
                <CoinNameCell coin={coin} href={linked ? coinHref(coin.mint, 'live') : undefined} note={wrappedLine(coin.row, p, lang)} />
                <Cell end tone="dim" fold={1}>
                  {coin.row.units === null ? '—' : unitsText(coin.row.units, lang)}
                </Cell>
                <Cell end tone="dim" fold={1}>
                  {coin.row.price === null ? '—' : coinPrice(coin.row.price, lang)}
                </Cell>
                <Cell end tone={coin.dayPct === null ? 'dim' : changeTone(coin.dayPct)}>
                  {coin.dayPct === null ? '—' : changeText(coin.dayPct, lang)}
                </Cell>
                <Cell end>{valueText(coin.row.usd, lang, p.noPrice)}</Cell>
                <Cell end className={trades ? a.rowActs : undefined}>
                  {trades && !isWrapped(coin.row) ? (
                    <>
                      <Quiet size="s" aria-label={p.buyCoin(coin.symbol)} onClick={() => onTrade(coin.ask, 'buy')}>
                        {p.buy}
                      </Quiet>
                      <Quiet size="s" aria-label={p.sellCoin(coin.symbol)} onClick={() => onTrade(coin.ask, 'sell')}>
                        {p.sell}
                      </Quiet>
                    </>
                  ) : null}
                </Cell>
              </TableRow>
            ))}
          </Table>
        )
      ) : null}
      {fold}
      <Unread rows={group.rows} reread={data.reread} busy={data.rereading} />
    </GroupPanel>
  );
}

/* ── the dust ─────────────────────────────────────────────────────────── */

/* Coin · Amount, then the worth on the same axis as every group above. */
const DUST_LEAD = 'minmax(190px, 2.4fr) minmax(110px, 1fr)';
/** Narrower: the amount goes. */
const DUST_FOLD = ['minmax(190px, 2.4fr)'] as const;
/** The dust rows an opened group shows at once; the rest wait behind «N more» (QA 19.11, eyes 26: 307 rows, 17 130 px). */
export const DUST_SHOWN = 12;

/**
 * The dust: folded on a desk as on a phone — it is what matters least, and a wallet's hundreds of them would bury the
 * page under them. Opened, its first rows and «N more».
 */
function DustGroup({ data, group, own, narrow, risk, cleanRead, onClean }: GroupsProps & { group: Group }) {
  const w = useWords(ALL);
  const p = useWords(PORTFOLIO);
  const c = useWords(CLEAN);
  const lang = useLang();
  const [whole, setWhole] = useState(false);
  const all = readRows(group).flatMap((row) => coinView(row, data, risk, p.solana) ?? []);
  const coins = whole ? all : all.slice(0, DUST_SHOWN);
  const more =
    all.length > DUST_SHOWN ? (
      <button type="button" className={a.moreRow} aria-expanded={whole} onClick={() => setWhole((was) => !was)}>
        <span>{whole ? p.dustFewer : p.dustMore(digits(String(all.length - DUST_SHOWN), lang))}</span>
        <Icon name="chevron" size="s" />
      </button>
    ) : null;
  const empty = (cleanRead?.items ?? []).filter((item) => item.kind === 'empty');
  const emptySol = empty.reduce((sum, item) => sum + item.lamports, 0) / 1e9;
  const emptyLine = empty.length ? { name: w.emptyAccounts, count: String(empty.length), value: `≈ ${digits(solFigure(emptySol), lang)} SOL` } : null;
  const action = own && cleanRead?.canClean ? (
    <Quiet size="s" aria-label={c.cleanNow} onClick={onClean}>
      {c.clean}
    </Quiet>
  ) : null;
  return (
    <GroupPanel title={w.dust} count={group.count} usd={group.usd} action={action} info={{ label: w.dustInfo, text: w.dustText }} startFolded>
      {narrow ? (
        <ul className={a.rows}>
          {/* The empty accounts first — what a clean gives back for nothing — so «N more» stands right under the coins it opens. */}
          {emptyLine ? <PhoneRow logos={null} name={emptyLine.name} sub={emptyLine.count} value={emptyLine.value} /> : null}
          {coins.map((coin) => (
            <PhoneRow
              key={coin.row.id}
              logos={<Logo mint={coin.mint} fact={coin.fact} symbol={coin.symbol} />}
              name={coin.symbol}
              sub={coin.row.units === null ? null : `${unitsText(coin.row.units, lang)} ${coin.symbol}`}
              foot={coin.risk.length ? <MarkFoot coin={coin} /> : undefined}
              marked={coin.risk.length > 0}
              value={valueText(coin.row.usd, lang, p.noPrice)}
            />
          ))}
        </ul>
      ) : (
        <Table columns={columnsOf(DUST_LEAD, own)} fold={foldOf(DUST_FOLD, own)} minWidth={520} label={w.dust}>
          <TableHead>
            <Cell head>{p.coin}</Cell>
            <Cell head end fold={1}>
              {p.amount}
            </Cell>
            <Cell head end sorted>
              {p.value}
            </Cell>
            <Cell head />
          </TableHead>
          {emptyLine ? (
            <TableRow>
              <Cell className={a.nameCell}>
                <span className={a.words}>
                  <span className={a.name}>{emptyLine.name}</span>
                </span>
              </Cell>
              <Cell end tone="dim" fold={1}>
                {emptyLine.count}
              </Cell>
              <Cell end>{emptyLine.value}</Cell>
              <Cell />
            </TableRow>
          ) : null}
          {coins.map((coin) => (
            <TableRow key={coin.row.id}>
              <CoinNameCell coin={coin} />
              <Cell end tone="dim" fold={1}>
                {coin.row.units === null ? '—' : unitsText(coin.row.units, lang)}
              </Cell>
              <Cell end>{valueText(coin.row.usd, lang, p.noPrice)}</Cell>
              <Cell />
            </TableRow>
          ))}
        </Table>
      )}
      {more}
    </GroupPanel>
  );
}

/* ── the agents ───────────────────────────────────────────────────────── */

const AGENT_COLUMNS = 'minmax(190px, 1.6fr) minmax(110px, 1fr) minmax(96px, 0.9fr) minmax(96px, 0.9fr)';

function stateWord(aw: AW, state: RowState): string {
  return { working: aw.working, paused: aw.statePaused, frozen: aw.stateFrozen, confirming: aw.stateConfirming, done: aw.stateDone, stopped: aw.stateStopped }[state];
}

/** An agent's name and its line, as the Agents screen says them: its coin or its pool, then its state or its time left. */
function agentWords(aw: AW, row: MineRow): Readonly<{ name: string; sub: string }> {
  // A pool stopped but not withdrawn says so; its pool's page carries «Withdraw».
  if (row.left) return { name: aw[row.role], sub: aw.notWithdrawn };
  const first = row.coin?.symbol ?? (row.pool === 'moving' ? aw.movingRange : row.pool === 'earning' ? aw.earning : null);
  const second = row.state !== 'working' ? stateWord(aw, row.state) : row.daysLeft === null ? aw.noTerm : aw.daysLeft(String(row.daysLeft));
  return { name: aw[row.role], sub: [first, second].filter(Boolean).join(' · ') };
}

function resultOf(row: MineRow, solUsd: number | null, lang: Lang): Shown | null {
  if (!row.result) return null;
  return 'usd' in row.result ? usdShown(row.result.usd, lang) : resultShown(row.result.raw, solUsd, lang);
}

/**
 * The person's bots on a budget and what each holds: their money stands outside the wallet, so it has a group of its
 * own. Each row leads to its own bot's page, where it is managed and stopped; the keeper's to its pool's page.
 */
function AgentsGroup({ data, agents, narrow }: GroupsProps) {
  const w = useWords(ALL);
  const p = useWords(PORTFOLIO);
  const aw = useWords(AGENTS);
  const lang = useLang();
  const hrefOf = (row: MineRow) => (shelfOn(row.role === 'keeper' ? 'earn' : 'agents') ? workerPath(row.role, row.poolAddress ?? null) : undefined);
  const solUsd = data.answer?.solUsd ?? null;
  const logo = (row: MineRow) => (row.coin ? <Logo mint={row.coin.mint} fact={data.fact(row.coin.mint)} symbol={row.coin.symbol} /> : <RoleBadge role={row.role} />);
  return (
    <GroupPanel title={w.agents} count={agents.rows.length} usd={agents.usd}>
      {narrow ? (
        <ul className={a.rows}>
          {agents.rows.map((row) => {
            const held = agents.held.get(row.key)?.usd ?? null;
            const result = resultOf(row, solUsd, lang);
            const named = agentWords(aw, row);
            return <PhoneRow key={row.key} logos={logo(row)} name={named.name} sub={named.sub} value={held === null ? (row.budget ? `${solPlain(row.budget.perDayRaw, lang)} SOL` : '—') : sumText(held, lang)} second={result?.text ?? null} secondTone={result?.tone} href={hrefOf(row)} />;
          })}
        </ul>
      ) : (
        <Table columns={AGENT_COLUMNS} minWidth={600} label={w.agents}>
          <TableHead>
            <Cell head>{p.agent}</Cell>
            <Cell head end>
              {p.budgetDay}
            </Cell>
            <Cell head end sorted>
              {p.held}
            </Cell>
            <Cell head end>
              {p.result}
            </Cell>
          </TableHead>
          {agents.rows.map((row) => {
            const held = agents.held.get(row.key)?.usd ?? null;
            const result = resultOf(row, solUsd, lang);
            const named = agentWords(aw, row);
            return (
              <TableRow key={row.key}>
                <Cell href={hrefOf(row)} className={a.nameCell}>
                  {logo(row)}
                  <span className={a.words}>
                    <span className={a.name}>{named.name}</span>
                    <span className={a.sub}>{named.sub}</span>
                  </span>
                </Cell>
                <Cell end tone="dim">
                  {row.budget ? `${solPlain(row.budget.perDayRaw, lang)} SOL` : '—'}
                </Cell>
                <Cell end>{held === null ? '—' : sumText(held, lang)}</Cell>
                <Cell end tone={result?.tone ?? 'dim'}>
                  {result?.text ?? '—'}
                </Cell>
              </TableRow>
            );
          })}
        </Table>
      )}
    </GroupPanel>
  );
}

