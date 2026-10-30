'use client';

import { useEffect, useMemo } from 'react';
import { useCity } from '@/city/lib/city/store';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useMine } from '@/city/lib/trade/mine-store';
import { orderRow, sortOrders, stopRow, type OrderRow, type StopRow } from '@/city/lib/trade/orders-view';
import type { Stop } from '@/city/lib/trade/stops';
import { ownOrders, useSpot } from '@/city/lib/trade/spot-store';
import type { LimitOrderView } from '@/city/lib/trade/limits';
import { useWallet } from '@/city/lib/trade/wallet';
import { MINE } from './words';
import s from './mine.module.css';

const NO_STOPS: readonly Stop[] = [];

/**
 * «My orders» in the Mine panel: the wallet's limit orders as the engine reads them from Jupiter and its own records —
 * each with its state and a Cancel that the wallet signs — and the stops kept on this device, with what each waits
 * for. A reached stop's sale opens on the trade card at the market price; nothing sells by itself.
 */
export function MyOrders({ now }: { now: number }) {
  const w = useWords(MINE);
  const address = useWallet((st) => st.connection?.address ?? null);
  // Only the connected wallet's orders and stops: another wallet's never show, not even for a moment.
  const orders = useSpot((st) => ownOrders(st.orders, address));
  const stops = useSpot((st) => (st.stopsOwner === address ? st.stops : NO_STOPS));
  const cancelling = useSpot((st) => st.cancelling);
  const notice = useSpot((st) => st.ordersNotice);

  // Read when the list opens, and again for another wallet.
  useEffect(() => {
    if (!address) return;
    void useSpot.getState().readOrders();
    useSpot.getState().loadStops();
  }, [address]);

  const sorted = useMemo(() => sortOrders(orders?.list ?? []), [orders]);
  const tokens = orders?.tokens ?? {};
  // `w` stands for the language: a switch writes the rows again in it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stopRows = useMemo(() => stops.map((stop) => stopRow(stop, now)), [stops, now, w]);
  const reading = !orders || (orders.status === 'reading' && orders.at === null);
  const nothing = !reading && orders?.status !== 'failed' && !sorted.open.length && !sorted.closed.length && !stopRows.length;

  const cancel = (order: LimitOrderView) => void useSpot.getState().cancelOrder({ key: order.key, venue: order.venue, order: order.order });
  const reviewSale = (id: string) => {
    const stop = stops.find((item) => item.id === id);
    if (!stop) return;
    useMine.getState().close();
    const city = useCity.getState();
    city.select(city.layout.towers.some((placed) => placed.tower.id === stop.base.mint) ? stop.base.mint : null);
    useSpot.getState().openSale(stop);
  };

  return (
    <>
      {reading ? (
        <div className={s.empty}>{w.readingOrders}</div>
      ) : orders?.status === 'failed' ? (
        <div className={s.empty}>
          {w.ordersUnavailable}{' '}
          <button className={s.link} onClick={() => void useSpot.getState().readOrders(true)}>
            {w.tryAgain}
          </button>
        </div>
      ) : null}
      {nothing && <div className={s.empty}>{w.noOrders}</div>}
      {notice && <div className={`${s.note} ${notice.tone === 'error' ? s.noteError : notice.tone === 'warn' ? s.noteWarn : ''}`}>{notice.text}</div>}

      {sorted.open.length > 0 && (
        <ul className={s.rows} aria-label={w.openOrders}>
          {sorted.open.map((order) => (
            <OrderItem key={order.key} row={orderRow(order, tokens)} busy={cancelling?.key === order.key ? cancelling.phase : null} locked={Boolean(cancelling)} onCancel={() => cancel(order)} />
          ))}
        </ul>
      )}
      {orders && !orders.complete && orders.status === 'ready' && <div className={s.note}>{w.someOrders}</div>}

      {stopRows.length > 0 && (
        <>
          <div className={s.section}>{w.stops}</div>
          <ul className={s.rows} aria-label={w.stops}>
            {stopRows.map((row) => (
              <StopItem key={row.id} row={row} onCancel={() => useSpot.getState().cancelStop(row.id)} onSale={() => reviewSale(row.id)} />
            ))}
          </ul>
        </>
      )}

      {sorted.closed.length > 0 && (
        <>
          <div className={s.section}>{w.closed}</div>
          <ul className={s.rows} aria-label={w.closedOrders}>
            {sorted.closed.map((order) => (
              <OrderItem key={order.key} row={orderRow(order, tokens)} busy={null} locked onCancel={() => {}} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

const TONE: Record<string, string> = { live: s.live, done: s.up, danger: s.down, quiet: '' };

function OrderItem({ row, busy, locked, onCancel }: { row: OrderRow; busy: 'building' | 'wallet' | 'sending' | null; locked: boolean; onCancel: () => void }) {
  const w = useWords(MINE);
  const action = row.canCancel || row.canClaim;
  return (
    <li className={s.row}>
      <span className={s.names}>
        <b className={s.symbol}>
          <span className={row.side === 'buy' ? s.up : s.down}>{row.side === 'buy' ? w.sideBuy : w.sideSell}</span> {row.coin}
        </b>
        <span className={s.amount}>{w.amountAt(row.amount === null ? '—' : digits(row.amount), row.price === null ? '—' : digits(row.price), row.unit)}</span>
      </span>
      <span className={s.figures}>
        <span className={`${s.change} ${TONE[row.tone] ?? ''}`}>{row.state}</span>
        {row.filledPct !== null && <span className={s.since}>{w.filled(digits(String(row.filledPct)))}</span>}
      </span>
      {action ? (
        <button className={`${s.display} ${s.sell}`} onClick={onCancel} disabled={locked} aria-label={row.canClaim ? w.takeBackOf(row.side === 'buy', row.coin) : w.cancelOf(row.side === 'buy', row.coin)}>
          {busy === 'wallet' ? w.sign : busy ? w.wait : row.canClaim ? w.takeBack : w.cancel}
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}

function StopItem({ row, onCancel, onSale }: { row: StopRow; onCancel: () => void; onSale: () => void }) {
  const w = useWords(MINE);
  const live = row.view === 'watching' || row.view === 'reached';
  return (
    <li className={s.row}>
      <span className={s.names}>
        <b className={s.symbol}>
          <span className={row.side === 'buy' ? s.up : s.down}>{w.stop}</span> {row.coin}
        </b>
        <span className={s.amount}>
          {row.side === 'sell' ? w.stopSell : w.stopBuyWith} {digits(row.spends)} {row.side === 'sell' ? '≤' : '≥'} {digits(row.price)} {row.unit}
        </span>
      </span>
      {row.view === 'reached' ? (
        // Reached: the amber Check says it; the row keeps its room for the coin and the price.
        <span />
      ) : (
        <span className={s.figures}>
          <span className={`${s.change} ${TONE[row.tone] ?? ''}`}>{row.state}</span>
          {live && <span className={s.since}>{row.until}</span>}
        </span>
      )}
      <span className={s.actions}>
        {row.view === 'reached' && (
          <button className={`${s.display} ${s.sell} ${s.attention}`} onClick={onSale} aria-label={w.checkOf(row.side === 'sell', row.coin)}>
            {w.check}
          </button>
        )}
        <button className={`${s.display} ${s.sell}`} onClick={onCancel} aria-label={live ? w.cancelStopOn(row.coin) : w.removeStopOn(row.coin)}>
          {live ? w.cancel : w.remove}
        </button>
      </span>
    </li>
  );
}
