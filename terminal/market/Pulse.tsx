'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang, type Lang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import type { PulseRow } from '@/lib/spot/pulse';
import { coinHref } from '@/terminal/shell/shelves';
import { useDismiss } from '@/terminal/shell/useDismiss';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { STOCK_COPY } from '@/terminal/stocks/words';
import { CoinLogo, Quiet, Segment, SwitchRow, Tabs, changeText, changeTone, usdText } from '@/terminal/ui';
import { ageParts, countText, sumField } from './depth-view';
import { DEPTH, UNIT_WORD } from './depth-words';
import { Bars, People, Sliders, Warn } from './glyphs';
import {
  PULSE_AGES,
  PULSE_COLUMNS,
  PULSE_LIQUIDITY,
  PULSE_LIST,
  PULSE_MOVE,
  bornAt,
  cardLogo,
  cardName,
  cardOneTap,
  cardRisks,
  columnFilterOn,
  columnState,
  curvePct,
  freshMints,
  heldCards,
  padWord,
  passesColumn,
  pulseBoard,
  pulseLive,
  pulseLogo,
  riskLineOf,
  shareText,
  type CardRisk,
  type PulseAge,
  type PulseColumn,
} from './pulse-view';
import { readPulseAgain, setColumnFilter, startPulseFilters, usePulse, usePulseRead, type PulseFeed } from './pulse-store';
import { QuickSum, ZapButton, type QuickCoin } from './QuickBuy';
import { ScoutLine } from '@/terminal/agents/scout/ScoutLine';
import d from './depth.module.css';

const TITLE = { new: 'colNew', soon: 'colSoon', dex: 'colDex' } as const;
type W = (typeof DEPTH)['en'];

/** How long a column holds still after the finger lifts: long enough to reach the card it rested on. */
const TOUCH_HOLD_MS = 4000;

/**
 * The Pulse: what is being born on Solana right now, in three live columns of the engine's
 * feeds — New · Almost on a DEX · Out on a DEX — Ryntra's own launches first while they live. A card is its coin's
 * page; its ⚡ buys with the screen's one sum, right there; its last line tells who holds the coin and what its creator
 * launched before. A column scrolls past five cards, has its own filter, and holds still under the pointer or the
 * finger: a new coin waits until the column is let go, so nothing jumps under the hand. A phone shows one column at a
 * time, by tabs. «live» stands only while a feed answers; a feed that does not answer says so, with «Try again» — a quiet
 * market and a failure never look alike.
 */
export function Pulse({ towers }: { towers: readonly Tower[] }) {
  const w = useWords(DEPTH);
  const narrow = useNarrow();
  usePulseRead();
  useEffect(() => startPulseFilters(), []);
  const feeds = usePulse((st) => st.feeds);
  const filters = usePulse((st) => st.filters);
  const [tab, setTab] = useState<PulseColumn>('soon');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const board = useMemo(() => pulseBoard({ new: feeds.new.rows, soon: feeds.soon.rows, dex: feeds.dex.rows }), [feeds]);
  // The logo the market's list already knows for a mint: a card tries it when the feed's own picture does not come.
  const known = useMemo(() => new Map(towers.flatMap((tower) => (tower.icon ? [[tower.id, tower.icon] as const] : []))), [towers]);
  const live = pulseLive(feeds);
  const cards = useMemo(() => {
    const out = {} as Record<PulseColumn, PulseRow[]>;
    for (const id of PULSE_COLUMNS) out[id] = board[id].filter((row) => passesColumn(row, filters[id], now)).slice(0, PULSE_LIST);
    return out;
  }, [board, filters, now]);

  return (
    <section className={d.pulse} aria-labelledby="pulse-title" data-terminal="pulse">
      <div className={d.sectionHead}>
        <h2 id="pulse-title" className={d.h2}>
          {w.pulse}
        </h2>
        {live === 'live' ? (
          <span className={d.live} data-pulse-live="live">
            <i aria-hidden="true" />
            {w.live}
          </span>
        ) : live === 'down' && PULSE_COLUMNS.some((id) => cards[id].length) ? (
          // The cards on screen are from before: said so in one quiet line, and read again on a tap.
          <span className={d.live} data-pulse-live="down">
            <i aria-hidden="true" />
            {w.notUpdating}
            <Quiet size="s" data-again="" onClick={readPulseAgain}>
              {w.again}
            </Quiet>
          </span>
        ) : null}
        <span className={d.grow} />
        {narrow ? <ColumnFilter id={tab} /> : null}
        <QuickSum />
      </div>
      {narrow ? (
        <>
          <Tabs
            fill
            label={w.pulse}
            value={tab}
            onChange={setTab}
            className={d.pulseTabs}
            items={PULSE_COLUMNS.map((id) => ({ id, label: id === 'dex' ? w.colDexShort : w[TITLE[id]] }))}
          />
          <Column key={tab} id={tab} rows={cards[tab]} filterKey={JSON.stringify(filters[tab])} inFeed={board[tab].length} feed={feeds[tab]} known={known} now={now} head={false} />
        </>
      ) : (
        <div className={d.pulseCols}>
          {PULSE_COLUMNS.map((id) => (
            <Column key={id} id={id} rows={cards[id]} filterKey={JSON.stringify(filters[id])} inFeed={board[id].length} feed={feeds[id]} known={known} now={now} head />
          ))}
        </div>
      )}
    </section>
  );
}

/** A column's own filter: the pool from, the age under, no coin with a fact against it — applied at once, kept. */
function ColumnFilter({ id }: { id: PulseColumn }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const filter = usePulse((st) => st.filters[id]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  const on = columnFilterOn(filter);
  const title = w[TITLE[id]];
  const liq = filter.liquidity === null ? 'any' : String(filter.liquidity);
  return (
    <div className={d.pop} ref={box}>
      <Quiet size="s" className={d.colFilterBtn} aria-label={w.colFilter(title)} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <Sliders />
        {on ? <span className={d.n1}>{digits(String(on), lang)}</span> : null}
      </Quiet>
      {open ? (
        <div className={d.colPop} role="dialog" aria-label={w.colFilter(title)}>
          <div className={d.group}>
            <span className={d.groupWord}>{w.pulseLiq}</span>
            <Segment
              className={d.colSeg}
              label={w.pulseLiq}
              value={liq}
              onChange={(next) => setColumnFilter(id, { ...filter, liquidity: next === 'any' ? null : Number(next) })}
              items={PULSE_LIQUIDITY.map((sum) => ({ id: sum === null ? 'any' : String(sum), label: sum === null ? w.anyShort : w.liqFrom(digits(`$${sumField(sum)}`, lang)) }))}
            />
          </div>
          <div className={d.group}>
            <span className={d.groupWord}>{w.pulseAge}</span>
            <Segment
              className={d.colSeg}
              label={w.pulseAge}
              value={filter.age}
              onChange={(age: PulseAge) => setColumnFilter(id, { ...filter, age })}
              items={PULSE_AGES.map((age) => ({ id: age, label: age === 'any' ? w.anyShort : w.ageUnder(ageWord(age, w, lang)) }))}
            />
          </div>
          <div className={d.switches}>
            <SwitchRow label={w.hideRisky} on={filter.safe} onChange={(safe) => setColumnFilter(id, { ...filter, safe })} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ageWord = (age: Exclude<PulseAge, 'any'>, w: W, lang: Lang) =>
  digits(age === '10m' ? `10 ${w.uMin}` : age === '1h' ? `1 ${w.uH}` : `24 ${w.uH}`, lang);

function Column({ id, rows, filterKey, inFeed, feed, known, now, head }: { id: PulseColumn; rows: readonly PulseRow[]; filterKey: string; inFeed: number; feed: PulseFeed; known: ReadonlyMap<string, string>; now: number; head: boolean }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  // The column holds still while the pointer rests on it, a finger touched it a moment ago, it is scrolled down, or a
  // card's facts are open in it: the cards stay where they are and a new coin waits above them.
  const [pointer, setPointer] = useState(false);
  const [finger, setFinger] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [focus, setFocus] = useState(false);
  const [, release] = useState(0);
  const lift = useRef<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => () => void (lift.current !== null && window.clearTimeout(lift.current)), []);
  const held = pointer || finger || scrolled || focus;
  const shown = useRef<readonly PulseRow[]>(rows);
  // A filter the person just set applies at once, held or not: it is their own change, not the feed's.
  const setBy = useRef(filterKey);
  const refiltered = setBy.current !== filterKey;
  setBy.current = filterKey;
  let waiting = 0;
  if (!held || refiltered) shown.current = rows;
  else {
    const kept = heldCards(shown.current, rows);
    shown.current = kept.cards;
    waiting = kept.waiting;
  }
  const list = shown.current;
  const state = columnState(feed, list.length, inFeed);
  // The cards that came after the column was first drawn flash once, quietly; nothing slides or fades from nothing (flaw 11).
  const seen = useRef<Set<string>>(new Set());
  const fresh = freshMints(seen.current, list);
  useEffect(() => {
    for (const row of list) seen.current.add(row.mint);
  }, [list]);
  // «More below»: the column's lower edge fades while cards stand under it (flaw 13: a card cut in half, no hint).
  const [below, setBelow] = useState(false);
  const measure = (el: HTMLDivElement | null) => setBelow(Boolean(el && el.scrollHeight - el.scrollTop - el.clientHeight > 4));
  useLayoutEffect(() => measure(body.current), [list]);
  const touched = () => {
    if (lift.current !== null) window.clearTimeout(lift.current);
    lift.current = null;
    setFinger(true);
  };
  const lifted = () => {
    if (lift.current !== null) window.clearTimeout(lift.current);
    lift.current = window.setTimeout(() => setFinger(false), TOUCH_HOLD_MS);
  };
  // «N new»: the waiting coins come in now, and the column goes back to its top.
  const showNew = () => {
    shown.current = rows;
    body.current?.scrollTo({ top: 0 });
    setScrolled(false);
    release((n) => n + 1);
  };
  const more = waiting ? (
    <button type="button" className={d.waiting} onClick={showNew}>
      {w.waiting(digits(String(waiting), lang))}
    </button>
  ) : null;
  return (
    <section
      className={d.pulseCol}
      aria-label={w[TITLE[id]]}
      data-held={held ? '' : undefined}
      onPointerEnter={(event) => event.pointerType === 'mouse' && setPointer(true)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && setPointer(false)}
      onPointerDown={(event) => event.pointerType !== 'mouse' && touched()}
      onPointerUp={(event) => event.pointerType !== 'mouse' && lifted()}
      onPointerCancel={(event) => event.pointerType !== 'mouse' && lifted()}
      onFocus={() => setFocus(true)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setFocus(false)}
    >
      {head ? (
        <div className={d.pulseHead}>
          <b>{w[TITLE[id]]}</b>
          {state === 'cards' && !feed.missed ? <span>{digits(String(list.length), lang)}</span> : null}
          <span className={d.grow} />
          {more}
          <ColumnFilter id={id} />
        </div>
      ) : more ? (
        <div className={d.pulseHead}>
          <span className={d.grow} />
          {more}
        </div>
      ) : null}
      {list.length ? (
        <div
          className={d.pulseBody}
          ref={body}
          data-pulse-body=""
          data-more={below ? '' : undefined}
          onScroll={(event) => {
            setScrolled(event.currentTarget.scrollTop > 4);
            measure(event.currentTarget);
          }}
        >
          {list.map((row) => (
            <Card key={row.mint} row={row} column={id} now={now} known={known.get(row.mint)} fresh={fresh.has(row.mint)} />
          ))}
        </div>
      ) : state === 'down' ? (
        <div className={d.pulseNone} role="status" data-down="">
          <span>{w.pulseDown}</span>
          <Quiet size="s" data-again="" onClick={readPulseAgain}>
            {w.again}
          </Quiet>
        </div>
      ) : (
        <p className={d.pulseNone} role="status">
          {state === 'reading' ? <span className={d.shimmer} /> : state === 'filtered' ? w.none : w.pulseNone}
        </p>
      )}
    </section>
  );
}

function Card({ row, column, now, known, fresh }: { row: PulseRow; column: PulseColumn; now: number; known: string | undefined; fresh: boolean }) {
  const w = useWords(DEPTH);
  const c = useWords(STOCK_COPY);
  const lang = useLang();
  const router = useRouter();
  const href = coinHref(row.mint, 'live');
  const born = bornAt(row);
  const age = born === null ? null : ageParts(Math.max(0, now - born));
  const pad = padWord(row);
  const name = cardName(row);
  const move = row.windows[PULSE_MOVE[column]].changePct;
  const volume = row.windows.h1.volumeUsd;
  const pct = column === 'soon' ? curvePct(row) : null;
  const logo = cardLogo(row);
  const quick: QuickCoin = { id: row.mint, symbol: row.symbol, name: row.name, icon: row.icon, logo };
  return (
    <div className={d.card} data-card="" data-ours={row.ryntra ? '' : undefined} data-fresh={fresh ? '' : undefined} onClick={() => router.push(href)}>
      <CoinLogo {...pulseLogo(row, known)} symbol={row.symbol} size="m" className={d.cardLogo} />
      <span className={d.cardWords}>
        {/* The ticker whole; the name takes what room is left. */}
        <span className={d.cardLine}>
          <Link href={href} className={d.cardSym} onClick={(event) => event.stopPropagation()}>
            {row.symbol}
          </Link>
          {name ? <span className={d.cardName}>{name}</span> : null}
          {/* A coin passing for a stock says so, and is never bought in one tap. */}
          {row.passesFor ? (
            <span className={d.copy} title={c.says(row.passesFor.company)} aria-label={c.says(row.passesFor.company)}>
              {c.mark(row.passesFor.ticker)}
            </span>
          ) : null}
        </span>
        {/* A fact the feed did not measure is left out, not dashed; what does not fit drops whole. */}
        <span className={d.cardFacts}>
          {age ? <span className={d.age}>{digits(`${age.n} ${w[UNIT_WORD[age.unit]]}`, lang)}</span> : null}
          {pad ? (
            <span className={d.pad} data-ours={row.ryntra ? '' : undefined}>
              {pad}
            </span>
          ) : null}
          {row.holders === null ? null : (
            <span>
              <People />
              {countText(row.holders, lang)}
            </span>
          )}
          {volume === null ? null : (
            <span>
              <Bars />
              {usdText(volume, lang)}
            </span>
          )}
          {pct !== null ? <span className={d.curve}>{digits(`${pct}%`, lang)}</span> : null}
        </span>
      </span>
      <span className={d.cardFig}>
        {row.marketCapUsd === null || row.marketCapUsd <= 0 ? null : <b>{usdText(row.marketCapUsd, lang)}</b>}
        {move === null ? null : <span data-tone={changeTone(move)}>{changeText(move, lang)}</span>}
      </span>
      {cardOneTap(row) ? <ZapButton coin={quick} /> : <span aria-hidden="true" />}
      <RiskRow row={row} />
      {/* The Scout's check of a new coin, in one line. */}
      {column === 'new' ? <ScoutLine mint={row.mint} /> : null}
      {pct !== null ? (
        <span className={d.bar} role="img" aria-label={w.toDex(digits(`${pct}%`, lang))}>
          <i style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * A card's last line: the top ten's share, the creator's share, how many coins the creator launched and how many
 * reached a DEX — what the engine read, nothing for what it did not, each as a label and its figures. «⚠ N» at its end
 * when facts count against the coin, with the facts in words behind it; with none, the line says it all and no sign
 * stands (flaw 12: a faint «ı» at the end of every quiet line).
 */
function RiskRow({ row }: { row: PulseRow }) {
  const w = useWords(DEPTH);
  const lang = useLang();
  const line = riskLineOf(row);
  const risks = cardRisks(row);
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useDismiss(open, box, () => setOpen(false));
  if (!line && !risks.length) return null;
  const warn = (risk: CardRisk) => (risks.includes(risk) ? '' : undefined);
  const share = (pct: number) => digits(shareText(pct), lang);
  const made = line?.launched == null ? null : { n: countText(line.launched, lang), out: line.out === null ? null : countText(line.out, lang) };
  const label = w.riskOf(digits(String(risks.length), lang));
  const toggle = (button: HTMLElement) => {
    if (!open) {
      // The facts open where there is room: upward near the column's lower edge.
      const frame = button.closest('[data-pulse-body]')?.getBoundingClientRect();
      const at = button.getBoundingClientRect();
      setUp(Boolean(frame && frame.bottom - at.bottom < 170 && at.top - frame.top > frame.bottom - at.bottom));
    }
    setOpen((was) => !was);
  };
  return (
    <span className={d.cardRisk}>
      {/* What does not fit the card's width drops whole; the sign at the end always stands, and holds every fact. */}
      <span className={d.cardRiskFacts}>
        {line?.top10 != null ? <span data-warn={warn('top')}>{w.riskTop(share(line.top10))}</span> : null}
        {line?.dev != null ? <span data-warn={warn('dev')}>{w.riskDev(share(line.dev))}</span> : null}
        {made ? <span data-warn={warn('serial')}>{w.riskMade(made.n, made.out)}</span> : null}
      </span>
      {risks.length ? (
      <span className={d.cardRiskSign} ref={box} onClick={(event) => event.stopPropagation()}>
        <button type="button" className={d.risk} data-level="warn" aria-label={label} aria-expanded={open} onClick={(event) => toggle(event.currentTarget)}>
          <Warn />
          {digits(String(risks.length), lang)}
        </button>
        {open ? (
          <span className={d.riskPop} data-up={up ? '' : undefined} role="note">
            <b>{label}</b>
            {line?.top10 != null ? <span data-warn={warn('top')}>{w.factTop10(share(line.top10))}</span> : null}
            {line?.dev != null ? <span data-warn={warn('dev')}>{w.factDev(share(line.dev))}</span> : null}
            {made ? <span data-warn={warn('serial')}>{w.factMade(made.n, made.out)}</span> : null}
            {risks.includes('mint') ? <span data-warn="">{w.factMint}</span> : null}
            {risks.includes('freeze') ? <span data-warn="">{w.factFreeze}</span> : null}
            {risks.includes('flagged') ? <span data-warn="">{w.factFlagged}</span> : null}
          </span>
        ) : null}
      </span>
      ) : null}
    </span>
  );
}
