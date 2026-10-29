'use client';

import { useLayoutEffect, useState } from 'react';
import { clock, funding, leverage, price, signedPercent } from '@/city/lib/exchange/format';
import { marketFacts, STATE_WORDS } from '@/city/lib/exchange/markets';
import { currentMarket, LOCKED, useExchange, type Tab } from '@/city/lib/exchange/store';
import { useWindows } from '@/city/lib/window/store';
import { hasBook, type AccountKind } from '@/city/lib/exchange/account';
import { AccountPanel, useAccountKind, WalletLine } from './Account';
import { ArtImage } from './Art';
import { HistoryList, Orders, Positions, useOrderCount, usePositionCount } from './Book';
import { OrderBook } from './Depth';
import { ChevronGlyph } from './glyphs';
import { MarketPicker } from './Picker';
import { PriceChart } from './PriceChart';
import { TradePane } from './Ticket';
import s from './exchange.module.css';

/** Whether the phone's ticket stands under the account card: not while there is no account to trade from. */
const ticketShown = (kind: AccountKind): boolean => kind !== 'invite' && kind !== 'frozen';

/**
 * The Exchange's contents: Phoenix's perpetuals in one window. The city's one window frame (CITY-65) brings the head
 * with «Exchange», the moving, the sticking and the whole screen; inside, in a window wide enough the account and the
 * book on the left under the market's price chart and the ticket on the right, and in a narrow one — the phone's bottom sheet, or a window pulled
 * narrow among others — five tabs. The market's order book is a tab of its own. A signature holds the frame open.
 */
export function ExchangeWindow() {
  const desk = useWindows((st) => st.desk);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const columns = useWide(root, COLUMNS_FROM) && desk;
  return (
    <div ref={setRoot} className={s.framed} aria-label="Exchange" data-city-exchange={columns ? 'columns' : 'tabs'}>
      <ArtImage art="head" className={s.headArt} sizes={desk ? '1120px' : '100vw'} />
      <Head />
      <Strip />
      <div className={s.body}>{columns ? <Columns /> : <Stacked />}</div>
      <WalletLine />
    </div>
  );
}

/** The width from which the account and the book stand beside the ticket: both columns at their least. */
const COLUMNS_FROM = 680;

/**
 * Whether the window's own contents are at least `min` wide, followed as the frame is stretched or stuck. Measured before
 * the first paint, so a narrow window never shows the two columns for a frame first.
 */
function useWide(node: HTMLElement | null, min: number): boolean {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    if (!node) return;
    setWide(node.getBoundingClientRect().width >= min);
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= min);
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, [node, min]);
  return wide;
}

function Columns() {
  const tab = useExchange((st) => st.tab);
  const picking = useExchange((st) => st.picking);
  const setTab = useExchange((st) => st.setTab);
  const positions = usePositionCount();
  const orders = useOrderCount();
  const kind = useAccountKind();
  const left: Tab = tab === 'trade' ? 'positions' : tab;
  return (
    <div className={s.columns}>
      <div className={`${s.pane} ${s.chartLed}`}>
        {picking ? (
          <MarketPicker />
        ) : !hasBook(kind) ? (
          // No wallet, no Phoenix account, or Phoenix silent: one card, one action first, the market's price under it
          // — the positions, orders and history come with an account.
          <>
            <AccountPanel />
            <PriceChart />
          </>
        ) : (
          <>
            <PriceChart />
            <AccountPanel />
            <div className={s.block}>
              <Tabs
                tabs={[
                  ['positions', 'Positions', positions],
                  ['orders', 'Orders', orders],
                  ['history', 'History'],
                  ['book', 'Book'],
                ]}
                on={left}
                onPick={setTab}
              />
              {left === 'orders' ? <Orders /> : left === 'history' ? <HistoryList /> : left === 'book' ? <OrderBook /> : <Positions />}
            </div>
          </>
        )}
      </div>
      <div className={`${s.pane} ${s.side}`}>
        <TradePane />
      </div>
    </div>
  );
}

function Stacked() {
  const tab = useExchange((st) => st.tab);
  const setTab = useExchange((st) => st.setTab);
  const picking = useExchange((st) => st.picking);
  const pending = useExchange((st) => st.pending);
  const result = useExchange((st) => st.result);
  const asking = useExchange((st) => st.asking);
  const positions = usePositionCount();
  const orders = useOrderCount();
  const kind = useAccountKind();
  // A Review or an outcome owns the sheet, whichever tab it came from.
  const acting = Boolean(pending || result || asking);
  // Without an account there is no book to list: the trade view alone, with the one thing to do.
  const book = hasBook(kind);
  const view: Tab = book ? tab : 'trade';
  return (
    <div className={s.stack}>
      {!picking && !acting && book && (
        <Tabs
          tabs={[
            ['trade', 'Trade'],
            ['book', 'Book'],
            ['positions', 'Positions', positions],
            ['orders', 'Orders', orders],
            ['history', 'History'],
          ]}
          on={view}
          onPick={setTab}
        />
      )}
      <div className={`${s.pane} ${s.flow}`}>
        {picking ? (
          <MarketPicker />
        ) : acting ? (
          <TradePane />
        ) : view === 'positions' ? (
          <Positions />
        ) : view === 'orders' ? (
          <Orders />
        ) : view === 'history' ? (
          <HistoryList />
        ) : view === 'book' ? (
          <OrderBook toTicket />
        ) : (
          <>
            <AccountPanel compact />
            {ticketShown(kind) && <TradePane />}
          </>
        )}
      </div>
    </div>
  );
}

/** The window's tabs; a count rides beside its label as a small figure, so five tabs still stand in a phone's width. */
function Tabs({ tabs, on, onPick }: { tabs: readonly (readonly [Tab, string, number?])[]; on: Tab; onPick: (tab: Tab) => void }) {
  return (
    <div className={s.tabs} role="tablist" aria-label="Exchange">
      {tabs.map(([id, label, count]) => (
        <button key={id} role="tab" aria-selected={on === id} className={`${s.tab} ${on === id ? s.tabOn : ''}`} onClick={() => onPick(id)}>
          {label}
          {count ? <span className={s.tabCount}>{count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** The market and its price: the frame's head says «Exchange», this row which market and how it moves. */
function Head() {
  const symbol = useExchange((st) => st.symbol);
  const picking = useExchange((st) => st.picking);
  const setPicking = useExchange((st) => st.setPicking);
  const phase = useExchange((st) => st.phase);
  return (
    <div className={s.head}>
      <div className={s.titleBlock}>
        <div className={s.headRow}>
          <button
            className={s.marketButton}
            aria-expanded={picking}
            aria-label="Choose a market"
            onClick={() => setPicking(!picking)}
            disabled={LOCKED.has(phase)}
          >
            <span className={`${s.display} ${s.marketName}`}>{symbol ? `${symbol}-PERP` : 'Markets'}</span>
            <ChevronGlyph className={s.chevron} />
          </button>
          <Quote />
        </div>
      </div>
    </div>
  );
}

/** The market's price beside its name: Phoenix's mark and the day's move. */
function Quote() {
  const market = useExchange((st) => currentMarket(st));
  if (!market) return null;
  const facts = marketFacts(market, null);
  return (
    <span className={s.quote}>
      <span className={`${s.display} ${s.quotePrice}`}>{price(facts.mark)}</span>
      <span className={facts.changePercent === null ? s.quoteMove : `${s.quoteMove} ${facts.changePercent >= 0 ? s.up : s.down}`}>
        {signedPercent(facts.changePercent, 2)}
      </span>
    </span>
  );
}

/**
 * One quiet line of what else the market is now — the funding and the highest leverage, a state only when it is not
 * trading — and «i» for the rest: the index, who pays the funding, when Phoenix was read. Opened by a tap, on a phone too.
 */
function Strip() {
  const market = useExchange((st) => currentMarket(st));
  const fundingRead = useExchange((st) => st.funding.value);
  const markets = useExchange((st) => st.markets);
  const [details, setDetails] = useState(false);
  if (!market) return <div className={s.strip}>{markets.status === 'failed' ? 'Phoenix isn’t answering' : 'Reading Phoenix…'}</div>;
  const facts = marketFacts(market, fundingRead);
  const payer = facts.funding?.payer === 'long' ? 'Longs pay' : facts.funding?.payer === 'short' ? 'Shorts pay' : null;
  return (
    <div className={s.strip}>
      <span className={s.fact}>
        Funding <b>{funding(facts.funding ? { ...facts.funding, payer: null } : null)}</b>
      </span>
      <span className={s.fact}>
        Max <b>{leverage(facts.maxLeverage)}</b>
      </span>
      {!facts.tradable && <span className={`${s.fact} ${s.warnText}`}>{STATE_WORDS[facts.state]}</span>}
      {markets.status === 'failed' && <span className={`${s.fact} ${s.warnText}`}>Delayed</span>}
      <button className={`${s.info} ${details ? s.infoOn : ''}`} aria-expanded={details} aria-label="Market details" onClick={() => setDetails((v) => !v)}>
        i
      </button>
      {details && (
        <span className={s.details}>
          Index <b>{price(facts.index)}</b>
          {payer && <> · {payer}</>} · Phoenix, read {clock(markets.at)}
        </span>
      )}
    </div>
  );
}
