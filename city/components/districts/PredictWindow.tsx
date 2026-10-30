'use client';

import { useEffect, useRef, useState } from 'react';
import { PREDICT_REAL } from '@/city/lib/districts/predict/flag';
import { artOf, cents, chance, closesIn, ENDING, headSide, isDelayed, leadOf, sideName, tabName, TRENDING, usd, volumeText, type Market, type Tab } from '@/city/lib/districts/predict/markets';
import { linesOn, statusWord, type Line } from '@/city/lib/districts/predict/positions';
import { realBusy, useReal } from '@/city/lib/districts/predict/real-store';
import { usePredict, type ListState, type Mode, type Page } from '@/city/lib/districts/predict/store';
import { PREDICT } from '@/city/lib/districts/predict/words';
import { useWords, wordsNow } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import { PredictArt } from './PredictArt';
import { PredictMarket } from './PredictMarket';
import { PredictMoney } from './PredictMoney';
import { useNow, usePositions } from './predictHooks';
import { PositionsAside, PredictPositions } from './PredictPositions';
import { ArtGlyph, BackGlyph, ClockGlyph, CloseGlyph, FlameGlyph, PracticeCoin, SearchGlyph, StackGlyph, UsdcCoin, VolumeGlyph } from './predictGlyphs';
import s from './predict.module.css';

/**
 * The window's contents in the city's frame: under the frame's head, back and the money — the mode, your positions,
 * your balance, Deposit where money is real — and one page under it: the markets by tab with your positions beside
 * them, a market's page, all your positions, or money in and out.
 */
export function PredictWindow() {
  const page = usePredict((st) => st.page);
  const notice = usePredict((st) => st.notice);
  const say = usePredict((st) => st.say);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => say(null), 3200);
    return () => clearTimeout(timer);
  }, [notice, say]);
  return (
    <>
      <Head />
      <div className={s.body} data-page={page.kind}>
        {page.kind === 'market' ? <PredictMarket key={page.eventId} /> : page.kind === 'positions' ? <PredictPositions /> : page.kind === 'money' ? <PredictMoney tab={page.tab} /> : <Markets />}
      </div>
      {notice ? (
        <div className={`${s.notice} ${notice.tone === 'warn' ? s.noticeWarn : ''}`} role="status" key={notice.text}>
          {notice.text}
        </div>
      ) : null}
    </>
  );
}

/** The words in the frame's head for a page of the window. */
export function windowTitle(page: Page['kind'], mode: Mode, w: (typeof PREDICT)['en'] = wordsNow(PREDICT)): string {
  return page === 'positions' ? w.positions : page === 'money' ? (mode === 'real' ? w.money : w.practice) : w.predictions;
}

/** Under the frame's head (the name, full screen, close): back from a page, and the money — mode, positions, balance, Deposit. */
function Head() {
  const page = usePredict((st) => st.page);
  const mode = usePredict((st) => st.mode);
  const back = usePredict((st) => st.back);
  const go = usePredict((st) => st.go);
  const w = useWords(PREDICT);
  const sub = page.kind !== 'markets';
  return (
    <header className={s.head} data-sub={sub ? '' : undefined}>
      {sub ? (
        <button className={s.iconButton} aria-label={w.backToMarkets} onClick={() => !realBusy() && back()}>
          <BackGlyph />
        </button>
      ) : (
        <Tabs />
      )}
      <div className={s.headRight}>
        {PREDICT_REAL ? <ModeSwitch /> : null}
        {page.kind !== 'positions' ? <PositionsButton onOpen={() => go({ kind: 'positions' })} /> : null}
        <Balance onOpen={() => go(mode === 'real' ? { kind: 'money', tab: 'deposit' } : { kind: 'positions' })} />
        {mode === 'real' ? (
          <button className={`${s.primary} ${s.deposit}`} onClick={() => go({ kind: 'money', tab: 'deposit' })}>
            {w.deposit}
          </button>
        ) : null}
      </div>
    </header>
  );
}

/** Practice or Real: offered only where the real switch is open. */
function ModeSwitch() {
  const mode = usePredict((st) => st.mode);
  const setMode = usePredict((st) => st.setMode);
  const reset = useReal((st) => st.resetTrade);
  const w = useWords(PREDICT);
  return (
    <div className={s.modeSwitch} role="radiogroup" aria-label={w.money}>
      {(['practice', 'real'] as const).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          className={mode === m ? s.modeOn : undefined}
          onClick={() => {
            reset();
            setMode(m);
          }}
        >
          {m === 'practice' ? w.practice : w.real}
        </button>
      ))}
    </div>
  );
}

/** Your positions, on every page and every width: how many are open, a pulse while an order is on its way. */
function PositionsButton({ onOpen }: { onOpen: () => void }) {
  const { summary } = usePositions();
  const w = useWords(PREDICT);
  const count = summary.count + summary.pending;
  return (
    <button className={s.posButton} onClick={onOpen} aria-label={count ? `${w.yourPositions}, ${count}` : w.yourPositions} data-pending={summary.pending ? '' : undefined}>
      <StackGlyph />
      {count ? <span className={s.posCount}>{count}</span> : null}
    </button>
  );
}

/** Your balance: practice dollars, or the USDC the account can spend now. */
function Balance({ onOpen }: { onOpen: () => void }) {
  const mode = usePredict((st) => st.mode);
  const cash = usePredict((st) => st.book.cash);
  const available = useReal((st) => (st.live?.linked ? st.live.available : null));
  const connected = useWallet((st) => Boolean(st.connection));
  const real = mode === 'real';
  const w = useWords(PREDICT);
  return (
    <button className={s.balance} onClick={onOpen} aria-label={real ? w.usdcBalance : w.practiceBalance}>
      <span className={s.balanceCoin}>{real ? <UsdcCoin /> : <PracticeCoin />}</span>
      <span className={s.balanceLabel}>{real ? 'USDC' : w.practice}</span>
      <span className={s.balanceFigure}>{real ? (available !== null && connected ? usd(available).slice(1) : '—') : usd(cash).slice(1)}</span>
    </button>
  );
}

function TabGlyph({ tab }: { tab: Tab }) {
  if (tab.id === TRENDING.id) return <FlameGlyph />;
  if (tab.id === ENDING.id) return <ClockGlyph />;
  if (tab.q) return <SearchGlyph />;
  const art = artOf({ categories: tab.category ? [tab.category] : [], title: '' });
  return art === 'market' ? null : <ArtGlyph art={art} />;
}

/** Search, then the tabs: Trending and Ending soon, then the engine's categories — in the head's row beside the money. */
function Tabs() {
  const tabs = usePredict((st) => st.tabs);
  const tab = usePredict((st) => st.tab);
  const setTab = usePredict((st) => st.setTab);
  const search = usePredict((st) => st.search);
  const find = usePredict((st) => st.find);
  const [open, setOpen] = useState(Boolean(search));
  const [words, setWords] = useState(search?.q ?? '');
  const w = useWords(PREDICT);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    field.current?.focus();
  }, [open]);
  // A pause in typing searches; an emptied field closes the search.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => find(words), 350);
    return () => clearTimeout(timer);
  }, [words, open, find]);
  const shown = search && !tabs.some((t) => t.id === search.id) ? [search, ...tabs] : tabs;
  return (
    <div className={s.tabsRow}>
      <div className={s.search} data-open={open ? '' : undefined}>
        <button
          className={s.searchButton}
          aria-label={open ? w.closeSearch : w.searchMarkets}
          aria-expanded={open}
          onClick={() => {
            if (open) {
              setWords('');
              find('');
            }
            setOpen((v) => !v);
          }}
        >
          {open ? <CloseGlyph /> : <SearchGlyph />}
        </button>
        {open ? (
          <input
            ref={field}
            className={s.searchInput}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={w.search}
            aria-label={w.searchMarkets}
            value={words}
            maxLength={80}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') find(words);
            }}
          />
        ) : null}
      </div>
      <nav className={s.tabs} role="tablist" aria-label={w.categories}>
        {shown.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab} className={`${s.tab} ${t.id === tab ? s.tabOn : ''}`} onClick={() => setTab(t.id)}>
            <span className={s.tabGlyph} aria-hidden="true">
              <TabGlyph tab={t} />
            </span>
            {tabName(t)}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** The markets of a tab with your positions beside them on a desk. */
function Markets() {
  const list = usePredict((st) => st.lists[st.tab]) as ListState | undefined;
  return (
    <div className={s.markets}>
      <div className={s.main}>
        <Cards list={list} />
      </div>
      <PositionsAside />
    </div>
  );
}

function Cards({ list }: { list: ListState | undefined }) {
  const loadList = usePredict((st) => st.loadList);
  const search = usePredict((st) => st.search);
  const tab = usePredict((st) => st.tab);
  const { open } = usePositions();
  const now = useNow();
  const w = useWords(PREDICT);
  if (!list || (list.status !== 'ready' && list.status !== 'error')) {
    return (
      <div className={s.grid} aria-label={w.readingMarkets}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`${s.card} ${s.cardLoading}`}>
            <span className={s.shimmer} />
          </div>
        ))}
      </div>
    );
  }
  if (list.status === 'error') {
    return (
      <div className={s.empty}>
        <span>{w.marketsDown}</span>
        <button className={s.quiet} onClick={() => void loadList()}>
          {w.tryAgain}
        </button>
      </div>
    );
  }
  if (!list.markets.length) return <div className={s.empty}>{search?.id === tab ? w.nothingFound : w.noMarket}</div>;
  const delayed = isDelayed(list.readAt, now);
  return (
    <div className={s.grid} data-delayed={delayed ? '' : undefined}>
      {list.markets.map((m) => (
        <Card key={m.eventId} market={m} held={linesOn(open, m.eventId)} now={now} />
      ))}
    </div>
  );
}

/** What you hold on a market, on its card: the side and its value — or that the order is on its way. */
function HoldChip({ lines }: { lines: readonly Line[] }) {
  const line = lines[0];
  if (!line) return null;
  const word = statusWord(line.status);
  const more = lines.length > 1 ? ` +${lines.length - 1}` : '';
  return (
    <span className={s.holdChip} data-status={line.status}>
      <span className={s.holdDot} aria-hidden="true" />
      {`${sideName(line.label)} · ${word ?? usd(line.value ?? line.cost ?? 0)}`}
      {more}
    </span>
  );
}

/**
 * One market: its picture and question, the chance as a split bar, and a button per side with its price. On a phone
 * the chance and the volume move beside the picture, under the question (the mock P3). What you hold on it shows on it.
 */
function Card({ market, held, now }: { market: Market; held: readonly Line[]; now: number }) {
  const openMarket = usePredict((st) => st.openMarket);
  const w = useWords(PREDICT);
  const head = headSide(market);
  const lead = leadOf(market);
  const [a, b] = market.binary ? market.sides : [lead, market.sides.find((x) => x.id !== lead.id)!];
  const split = market.binary ? head.p / Math.max(1e-9, market.sides[0]!.p + market.sides[1]!.p) : lead.p;
  const pick = (sideId: string) => openMarket(market.eventId, sideId);
  const soon = market.closes ? Date.parse(market.closes) - now < 48 * 3_600_000 : false;
  const odds = (
    <>
      <div className={s.odds}>
        <span className={s.oddsLead}>{market.binary ? (market.question ? chance(head.p) : w.chanceOf(chance(head.p))) : `${sideName(lead.label)} ${chance(lead.p)}`}</span>
        <span className={s.oddsTrail}>{market.binary ? chance(market.sides[1]!.p) : `${sideName(b!.label)} ${chance(b!.p)}`}</span>
      </div>
      <div className={s.bar} aria-hidden="true" data-multi={market.binary ? undefined : ''}>
        <span className={s.barYes} style={{ width: `${Math.max(3, Math.min(97, split * 100))}%` }} />
        <span className={s.barNo} />
      </div>
    </>
  );
  const meta = (
    <span className={s.vol}>
      <VolumeGlyph />
      {volumeText(market.volume)}
      {market.closes ? (
        <span className={s.ends} data-soon={soon ? '' : undefined}>
          <ClockGlyph />
          {closesIn(market.closes, now)}
        </span>
      ) : null}
    </span>
  );
  return (
    <article className={s.card} data-held={held.length ? '' : undefined}>
      <button className={s.cardTop} onClick={() => openMarket(market.eventId)} aria-label={market.title}>
        <PredictArt market={market} />
        <span className={s.cardInfo}>
          <span className={s.cardHeading}>
            <span className={s.cardTitle}>{market.title}</span>
            {market.question ? (
              <span className={s.cardQuestion}>
                {market.question}
                {market.marketCount > 1 ? <span className={s.moreMarkets}> · {w.marketsCount(market.marketCount)}</span> : null}
              </span>
            ) : null}
          </span>
          <span className={s.cardMeta}>
            {odds}
            {meta}
          </span>
        </span>
      </button>
      <div className={s.cardOdds}>{odds}</div>
      <div className={s.sides}>
        {market.binary ? (
          <>
            <button className={s.yes} onClick={() => pick(a!.id)}>
              {w.yesAt(cents(a!.p))}
            </button>
            <button className={s.no} onClick={() => pick(b!.id)}>
              {w.noAt(cents(b!.p))}
            </button>
          </>
        ) : (
          [a!, b!].map((side) => (
            <button key={side.id} className={s.alt} onClick={() => pick(side.id)}>
              <span className={s.altLabel}>{sideName(side.label)}</span> {cents(side.p)}
            </button>
          ))
        )}
      </div>
      <div className={s.cardFoot}>
        {meta}
        <HoldChip lines={held} />
      </div>
      {held.length ? (
        <div className={s.cardHeldPhone}>
          <HoldChip lines={held} />
        </div>
      ) : null}
    </article>
  );
}
