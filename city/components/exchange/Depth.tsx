'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { bookStale, depthView, type DepthRow } from '@/city/lib/exchange/depth';
import { percent, plainPrice, price, units, usd } from '@/city/lib/exchange/format';
import { currentMarket, useExchange } from '@/city/lib/exchange/store';
import { symbolKey } from '@/lib/phoenix/market-data';
import { useNow } from './Account';
import s from './exchange.module.css';

/**
 * The Book tab: Phoenix's order book of the open market — the asks above, the bids below, each level's depth as a bar
 * behind it, and between them the mark and how far the two best prices stand apart. A tap on a level puts its price
 * into a limit order on the ticket; on a phone, where the ticket is a tab of its own, the ticket comes forward with it.
 */
export function OrderBook({ toTicket = false }: { toTicket?: boolean }) {
  const symbol = useExchange((st) => st.symbol);
  const read = useExchange((st) => st.book);
  const market = useExchange((st) => currentMarket(st));
  const now = useNow(5_000);
  const view = useMemo(() => depthView(read.value, symbol), [read.value, symbol]);
  const empty = view.asks.length === 0 && view.bids.length === 0;
  // The middle — the mark and the spread — is where a book is read: the pane opens on it, once per market, and is then
  // left where the person scrolls it.
  const mid = useRef<HTMLDivElement | null>(null);
  const centred = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (empty || !symbol || centred.current === symbol || !mid.current) return;
    centred.current = symbol;
    mid.current.scrollIntoView({ block: 'center' });
  }, [empty, symbol]);
  if (empty) {
    if (read.status === 'failed') return <div className={s.empty}>Phoenix isn’t answering</div>;
    if (read.status === 'ready' && read.value && symbol && symbolKey(read.value.symbol) === symbolKey(symbol)) return <div className={s.empty}>The book is empty</div>;
    return (
      <div className={s.depth} aria-busy="true">
        <span className={s.shimmer} />
        <span className={`${s.shimmer} ${s.shimmerShort}`} />
      </div>
    );
  }
  const name = symbol ?? '';
  return (
    <div className={s.depth} aria-label={`${name}-PERP order book`}>
      <div className={s.depthHead} aria-hidden="true">
        <span>Price</span>
        <span>Size</span>
      </div>
      <div className={s.depthSide}>
        {[...view.asks].reverse().map((row) => (
          <Level key={`a${row.price}`} row={row} side="ask" symbol={name} toTicket={toTicket} />
        ))}
      </div>
      <div className={s.depthMid} ref={mid}>
        <span className={`${s.display} ${s.depthMark}`}>{price(market?.markPrice)}</span>
        <span className={s.depthSpread}>
          Spread {view.spreadUsd !== null && view.spreadUsd >= 0.01 ? usd(view.spreadUsd) : price(view.spreadUsd)}
          {view.spreadPercent !== null && ` · ${percent(view.spreadPercent, 3)}`}
        </span>
        {bookStale(read, now) && <span className={`${s.depthSpread} ${s.warnText}`}>Delayed</span>}
      </div>
      <div className={s.depthSide}>
        {view.bids.map((row) => (
          <Level key={`b${row.price}`} row={row} side="bid" symbol={name} toTicket={toTicket} />
        ))}
      </div>
    </div>
  );
}

function Level({ row, side, symbol, toTicket }: { row: DepthRow; side: 'ask' | 'bid'; symbol: string; toTicket: boolean }) {
  const setDraft = useExchange((st) => st.setDraft);
  const setTab = useExchange((st) => st.setTab);
  return (
    <button
      className={`${s.depthRow} ${side === 'ask' ? s.depthAsk : s.depthBid}`}
      style={{ ['--depth' as string]: `${Math.round(row.depth * 1000) / 10}%` }}
      aria-label={`${side === 'ask' ? 'Ask' : 'Bid'} ${price(row.price)}, ${units(row.size, symbol)}: limit at this price`}
      onClick={() => {
        setDraft({ type: 'limit', price: plainPrice(row.price) });
        if (toTicket) setTab('trade');
      }}
    >
      <span className={s.depthPrice}>{price(row.price)}</span>
      <span className={s.depthSize}>{units(row.size, '').trim()}</span>
    </button>
  );
}
