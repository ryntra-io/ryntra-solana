'use client';

import Link from 'next/link';
import { Fragment, useId, useState, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { USDC } from '@/city/lib/trade/tiles';
import { resultShown, solPlain, usdShown, type Shown } from '@/terminal/agents/figures';
import { RoleBadge } from '@/terminal/agents/glyphs';
import { workerPath, type MineRow, type RowState } from '@/terminal/agents/rows';
import { AGENTS } from '@/terminal/agents/words';
import { TICKET_OPEN } from '@/terminal/coin/Ticket';
import { USDC_LOGO, spotLogo } from '@/terminal/coin/staples';
import { logoOf as marketLogo } from '@/terminal/market/depth-view';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { sumText } from '@/terminal/earn/rows';
import { coinHref, shelfOn } from '@/terminal/shell/shelves';
import { Cell, Chip, CoinLogo, Icon, Panel, Quiet, Table, TableHead, TableRow, changeText, changeTone, priceText } from '@/terminal/ui';
import { NATIVE_SOL_MINT, PROTOCOL_NAME, exitLines, loanShare, mintOf, platformName, stakeState, type ExitLine, type Group, type GroupId, type MarketFact, type Row } from './all-view';
import { ALL } from './all-words';
import { RiskMark } from './CleanBlock';
import { solFigure, type CleanRead, type RiskReason } from './clean-view';
import { CLEAN } from './clean-words';
import type { ExitDoor } from './exit-view';
import { unitsFigure } from './portfolio-view';
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
}>;

/** SOL's own picture, kept with the site — native SOL is no tower, and the logo route answers nothing for it. */
const SOL_LOGO = '/site/universe/SOL.png';

/**
 * A coin's logo and the addresses tried after it, each once (as the pool's desk does): SOL's and USDC's own
 * pictures kept with the site; the picture the market lists for the mint, through the engine's proxy; the engine's
 * logo of a market coin; the catalogue's logo by the mint. The first that loads stands; none — the ticker's letter.
 */
export function logosFor(mint: string, fact: MarketFact | null = null): readonly string[] {
  const all = [mint === USDC.mint ? USDC_LOGO : null, mint === NATIVE_SOL_MINT ? SOL_LOGO : null, fact?.icon ? marketLogo({ id: mint, icon: fact.icon }) : null, `/api/icon/${mint}`, spotLogo(mint)];
  return [...new Set(all.filter((src): src is string => Boolean(src)))];
}

/** A coin's logo with its whole queue of addresses. */
function Logo({ mint, symbol, fact, size = 'm' }: { mint: string; symbol: string; fact: MarketFact | null; size?: 's' | 'm' }) {
  const list = logosFor(mint, fact);
  return <CoinLogo src={list[0] ?? null} also={list.slice(1)} symbol={symbol} size={size} />;
}

/** The ticket's own logo address for a coin: the first of its queue. */
export const logoFor = (mint: string, fact: MarketFact | null = null): string | null => logosFor(mint, fact)[0] ?? null;

const unitsText = (units: number, lang: Lang): string => digits(unitsFigure(units), lang);

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
  const lines = new Map(exitLines(data.groups).map((line) => [line.id, line]));
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

function NameCell({ row, name, sub, tone, fact }: { row: Row; name: string; sub: string | null; tone?: 'warn'; fact: (mint: string) => MarketFact | null }) {
  return (
    <Cell className={a.nameCell}>
      <Logos row={row} fact={fact} />
      <span className={a.words}>
        <span className={a.name}>{name}</span>
        {sub ? (
          <span className={a.sub} data-tone={tone}>
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
    <li>
      {onPress ? (
        <button type="button" className={a.row} data-marked={marked ? '' : undefined} onClick={onPress}>
          {inner}
        </button>
      ) : href ? (
        <Link href={href} className={a.row} data-marked={marked ? '' : undefined}>
          {inner}
        </Link>
      ) : (
        <div className={a.row} data-marked={marked ? '' : undefined}>
          {inner}
        </div>
      )}
      {foot}
    </li>
  );
}

type Lines = ReadonlyMap<string, ExitLine>;

/* ── pools ────────────────────────────────────────────────────────────── */

const POOL_COLUMNS = 'minmax(150px, 1.4fr) minmax(130px, 1.2fr) minmax(84px, 0.8fr) minmax(76px, 0.7fr) minmax(184px, auto)';
/** A wallet only looked at: no «Collect · Close» — only the «i» of a position that does not leave in one step. */
const POOL_COLUMNS_READ = 'minmax(150px, 1.4fr) minmax(130px, 1.2fr) minmax(84px, 0.8fr) minmax(76px, 0.7fr) minmax(44px, auto)';

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
          <Table columns={own ? POOL_COLUMNS : POOL_COLUMNS_READ} minWidth={own ? 680 : 540} label={w.pools}>
            <TableHead>
              <Cell head>{w.position}</Cell>
              <Cell head>{w.range}</Cell>
              <Cell head end sorted>
                {w.now}
              </Cell>
              <Cell head end>
                {w.earned}
              </Cell>
              <Cell head />
            </TableHead>
            {rows.map((row) => {
              const why = isOpen(row.id) ? reasonOf(lines.get(row.id), w, lang) : null;
              const mark = rangeOf(row);
              return (
                <Fragment key={row.id}>
                  <TableRow>
                    <NameCell row={row} fact={data.fact} name={nameOf(row, w)} sub={withAge(PROTOCOL_NAME[row.position.protocol], row, w, lang)} />
                    <Cell className={a.rangeCell}>
                      {row.position.inRange === null ? null : <Chip tone={row.position.inRange ? 'ok' : 'warn'}>{row.position.inRange ? w.inRange : w.outOfRange}</Chip>}
                      {mark ? <span className={a.rangeMark}>{mark}</span> : null}
                    </Cell>
                    <Cell end>{valueText(row.usd, lang, p.noPrice)}</Cell>
                    <Cell end tone={row.earnedUsd !== null && row.earnedUsd > 0 ? 'up' : 'dim'}>
                      {row.earnedUsd === null ? '—' : sumText(row.earnedUsd, lang)}
                    </Cell>
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

const STAKE_COLUMNS = 'minmax(180px, 1.5fr) minmax(130px, 1fr) minmax(110px, 1fr) minmax(84px, 0.8fr) minmax(110px, auto)';

function stakeWord(row: Row, w: W): Readonly<{ word: string; tone: 'ok' | 'warn' | 'plain' }> | null {
  const state = stakeState(row.position);
  if (state === 'coin') return null;
  if (state === 'active') return { word: w.stakeActive, tone: 'ok' };
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
          <Table columns={STAKE_COLUMNS} minWidth={640} label={w.staking}>
            <TableHead>
              <Cell head>{w.position}</Cell>
              <Cell head>{w.state}</Cell>
              <Cell head end>
                {p.amount}
              </Cell>
              <Cell head end sorted>
                {w.now}
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
                    <Cell>{state ? <Chip tone={state.tone}>{state.word}</Chip> : null}</Cell>
                    <Cell end tone="dim">
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

const LEND_COLUMNS = 'minmax(150px, 1.2fr) minmax(200px, 1.5fr) minmax(84px, 0.8fr) minmax(84px, 0.8fr) minmax(110px, auto)';

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
          <Table columns={LEND_COLUMNS} minWidth={660} label={w.lendingGroup}>
            <TableHead>
              <Cell head>{w.position}</Cell>
              <Cell head>{w.state}</Cell>
              <Cell head end sorted>
                {w.now}
              </Cell>
              <Cell head end>
                {w.interest}
              </Cell>
              <Cell head />
            </TableHead>
            {rows.map((row) => {
              const why = isOpen(row.id) ? reasonOf(lines.get(row.id), w, lang) : null;
              return (
                <Fragment key={row.id}>
                  <TableRow>
                    <NameCell row={row} fact={data.fact} name={nameOf(row, w)} sub={withAge(PROTOCOL_NAME[row.position.protocol], row, w, lang)} />
                    <Cell className={a.plain}>{kind(row)}</Cell>
                    <Cell end>{valueText(row.usd, lang, p.noPrice)}</Cell>
                    <Cell end tone={row.earnedUsd !== null && row.earnedUsd > 0 ? 'up' : 'dim'}>
                      {row.earnedUsd === null ? '—' : sumText(row.earnedUsd, lang)}
                    </Cell>
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

const OTHER_COLUMNS = 'minmax(200px, 1.6fr) minmax(150px, 1.2fr) minmax(96px, 0.8fr)';

function OtherGroup({ data, group, narrow }: GroupsProps & { group: Group }) {
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
        <Table columns={OTHER_COLUMNS} minWidth={520} label={w.other}>
          <TableHead>
            <Cell head>{w.position}</Cell>
            <Cell head>{w.platform}</Cell>
            <Cell head end sorted>
              {w.now}
            </Cell>
          </TableHead>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <NameCell row={row} fact={data.fact} name={nameOf(row, w)} sub={null} />
              <Cell tone="dim">{platformName(row.position.platform) ?? '—'}</Cell>
              <Cell end>{valueText(row.usd, lang, p.noPrice)}</Cell>
            </TableRow>
          ))}
        </Table>
      )}
    </GroupPanel>
  );
}

/* ── the coins ────────────────────────────────────────────────────────── */

/* The whole page's width, or 720 beside an open panel: the columns fit both without a sideways scroll. */
const COIN_COLUMNS = 'minmax(140px, 1.6fr) minmax(80px, 0.9fr) minmax(84px, 0.9fr) minmax(60px, 0.6fr) minmax(96px, 1fr) minmax(164px, auto)';
/** A wallet only looked at has no «Buy · Sell»: its table keeps no empty column for them. */
const COIN_COLUMNS_READ = 'minmax(170px, 1.6fr) minmax(96px, 0.9fr) minmax(96px, 0.9fr) minmax(72px, 0.6fr) minmax(120px, 1fr)';

type CoinView = Readonly<{ row: Row; mint: string; symbol: string; name: string; dayPct: number | null; risk: readonly RiskReason[]; ask: CoinAsk; fact: MarketFact | null }>;

/** Native SOL is Solana itself — never «Wrapped SOL», the market's name of the token account's coin. */
const isNative = (row: Row): boolean => row.position.id === 'wallet:sol';

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

/** A coin's first cell: its logo, its ticker and its name — or, for a coin better left alone, its mark where the name would stand. */
function CoinNameCell({ coin, href }: { coin: CoinView; href?: string }) {
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
        {coin.risk.length ? <RiskMark symbol={coin.symbol} risk={coin.risk} /> : coin.name !== coin.symbol ? <span className={a.sub}>{coin.name}</span> : null}
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
  const all = readRows(group).flatMap((row) => coinView(row, data, risk, p.solana) ?? []);
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
    <GroupPanel title={w.coins} count={group.count} usd={group.usd}>
      {coins.length ? (
        narrow ? (
          <ul className={a.rows}>
            {coins.map((coin) => (
              <PhoneRow
                key={coin.row.id}
                logos={<Logo mint={coin.mint} fact={coin.fact} symbol={coin.symbol} />}
                name={coin.symbol}
                sub={coin.row.units === null ? null : `${unitsText(coin.row.units, lang)} ${coin.symbol}`}
                foot={coin.risk.length ? <MarkFoot coin={coin} /> : undefined}
                marked={coin.risk.length > 0}
                value={valueText(coin.row.usd, lang, p.noPrice)}
                second={coin.dayPct !== null ? changeText(coin.dayPct, lang) : null}
                secondTone={coin.dayPct !== null ? changeTone(coin.dayPct) : undefined}
                onPress={trades ? () => onTrade(coin.ask, 'buy') : undefined}
              />
            ))}
          </ul>
        ) : (
          <Table columns={trades ? COIN_COLUMNS : COIN_COLUMNS_READ} minWidth={trades ? 680 : 580} label={w.coins}>
            <TableHead>
              <Cell head>{p.coin}</Cell>
              <Cell head end>
                {p.amount}
              </Cell>
              <Cell head end>
                {p.price}
              </Cell>
              <Cell head end>
                {p.change}
              </Cell>
              <Cell head end sorted>
                {p.value}
              </Cell>
              {trades ? <Cell head /> : null}
            </TableHead>
            {coins.map((coin) => (
              <TableRow key={coin.row.id}>
                <CoinNameCell coin={coin} href={linked ? coinHref(coin.mint, 'live') : undefined} />
                <Cell end tone="dim">
                  {coin.row.units === null ? '—' : unitsText(coin.row.units, lang)}
                </Cell>
                <Cell end tone="dim">
                  {coin.row.price === null ? '—' : priceText(coin.row.price, lang)}
                </Cell>
                <Cell end tone={coin.dayPct === null ? 'dim' : changeTone(coin.dayPct)}>
                  {coin.dayPct === null ? '—' : changeText(coin.dayPct, lang)}
                </Cell>
                <Cell end>{valueText(coin.row.usd, lang, p.noPrice)}</Cell>
                {trades ? (
                  <Cell end className={a.rowActs}>
                    <Quiet size="s" aria-label={p.buyCoin(coin.symbol)} onClick={() => onTrade(coin.ask, 'buy')}>
                      {p.buy}
                    </Quiet>
                    <Quiet size="s" aria-label={p.sellCoin(coin.symbol)} onClick={() => onTrade(coin.ask, 'sell')}>
                      {p.sell}
                    </Quiet>
                  </Cell>
                ) : null}
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

const DUST_COLUMNS = 'minmax(190px, 1.6fr) minmax(110px, 1fr) minmax(96px, 0.8fr)';

function DustGroup({ data, group, own, narrow, risk, cleanRead, onClean }: GroupsProps & { group: Group }) {
  const w = useWords(ALL);
  const p = useWords(PORTFOLIO);
  const c = useWords(CLEAN);
  const lang = useLang();
  const coins = readRows(group).flatMap((row) => coinView(row, data, risk, p.solana) ?? []);
  const empty = (cleanRead?.items ?? []).filter((item) => item.kind === 'empty');
  const emptySol = empty.reduce((sum, item) => sum + item.lamports, 0) / 1e9;
  const emptyLine = empty.length ? { name: w.emptyAccounts, count: String(empty.length), value: `≈ ${digits(solFigure(emptySol), lang)} SOL` } : null;
  const action = own && cleanRead?.canClean ? (
    <Quiet size="s" aria-label={c.cleanNow} onClick={onClean}>
      {c.clean}
    </Quiet>
  ) : null;
  return (
    <GroupPanel title={w.dust} count={group.count} usd={group.usd} action={action} info={{ label: w.dustInfo, text: w.dustText }} startFolded={narrow}>
      {narrow ? (
        <ul className={a.rows}>
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
          {emptyLine ? <PhoneRow logos={null} name={emptyLine.name} sub={emptyLine.count} value={emptyLine.value} /> : null}
        </ul>
      ) : (
        <Table columns={DUST_COLUMNS} minWidth={520} label={w.dust}>
          <TableHead>
            <Cell head>{p.coin}</Cell>
            <Cell head end>
              {p.amount}
            </Cell>
            <Cell head end sorted>
              {p.value}
            </Cell>
          </TableHead>
          {coins.map((coin) => (
            <TableRow key={coin.row.id}>
              <CoinNameCell coin={coin} />
              <Cell end tone="dim">
                {coin.row.units === null ? '—' : unitsText(coin.row.units, lang)}
              </Cell>
              <Cell end>{valueText(coin.row.usd, lang, p.noPrice)}</Cell>
            </TableRow>
          ))}
          {emptyLine ? (
            <TableRow>
              <Cell className={a.nameCell}>
                <span className={a.words}>
                  <span className={a.name}>{emptyLine.name}</span>
                </span>
              </Cell>
              <Cell end tone="dim">
                {emptyLine.count}
              </Cell>
              <Cell end>{emptyLine.value}</Cell>
            </TableRow>
          ) : null}
        </Table>
      )}
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
 * own. Each row leads to its own bot's page, where it is managed and stopped; the keeper's to Earn.
 */
function AgentsGroup({ data, agents, narrow }: GroupsProps) {
  const w = useWords(ALL);
  const p = useWords(PORTFOLIO);
  const aw = useWords(AGENTS);
  const lang = useLang();
  const hrefOf = (row: MineRow) => (shelfOn(row.role === 'keeper' ? 'earn' : 'agents') ? workerPath(row.role) : undefined);
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

