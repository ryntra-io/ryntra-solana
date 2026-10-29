'use client';

import { useEffect, useMemo } from 'react';
import { useCity } from '@/city/lib/city/store';
import { useMine } from '@/city/lib/trade/mine-store';
import { orderRow, sortOrders, stopRow, type OrderRow, type StopRow } from '@/city/lib/trade/orders-view';
import type { Stop } from '@/city/lib/trade/stops';
import { ownOrders, useSpot } from '@/city/lib/trade/spot-store';
import type { LimitOrderView } from '@/city/lib/trade/limits';
import { useWallet } from '@/city/lib/trade/wallet';
import s from './mine.module.css';

const NO_STOPS: readonly Stop[] = [];

/**
 * «My orders» in the Mine panel: the wallet's limit orders as the engine reads them from Jupiter and its own records —
 * each with its state and a Cancel that the wallet signs — and the stops kept on this device, with what each waits
 * for. A reached stop's sale opens on the trade card at the market price; nothing sells by itself.
 */
export function MyOrders({ now }: { now: number }) {
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
  const stopRows = useMemo(() => stops.map((stop) => stopRow(stop, now)), [stops, now]);
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
        <div className={s.empty}>Reading your orders…</div>
      ) : orders?.status === 'failed' ? (
        <div className={s.empty}>
          Orders unavailable right now.{' '}
          <button className={s.link} onClick={() => void useSpot.getState().readOrders(true)}>
            Try again
          </button>
        </div>
      ) : null}
      {nothing && <div className={s.empty}>No orders yet</div>}
      {notice && <div className={`${s.note} ${notice.tone === 'error' ? s.noteError : notice.tone === 'warn' ? s.noteWarn : ''}`}>{notice.text}</div>}

      {sorted.open.length > 0 && (
        <ul className={s.rows} aria-label="Open orders">
          {sorted.open.map((order) => (
            <OrderItem key={order.key} row={orderRow(order, tokens)} busy={cancelling?.key === order.key ? cancelling.phase : null} locked={Boolean(cancelling)} onCancel={() => cancel(order)} />
          ))}
        </ul>
      )}
      {orders && !orders.complete && orders.status === 'ready' && <div className={s.note}>Some orders could not be read</div>}

      {stopRows.length > 0 && (
        <>
          <div className={s.section}>Stops</div>
          <ul className={s.rows} aria-label="Stops">
            {stopRows.map((row) => (
              <StopItem key={row.id} row={row} onCancel={() => useSpot.getState().cancelStop(row.id)} onSale={() => reviewSale(row.id)} />
            ))}
          </ul>
        </>
      )}

      {sorted.closed.length > 0 && (
        <>
          <div className={s.section}>Closed</div>
          <ul className={s.rows} aria-label="Closed orders">
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
  const action = row.canCancel || row.canClaim;
  return (
    <li className={s.row}>
      <span className={s.names}>
        <b className={s.symbol}>
          <span className={row.side === 'buy' ? s.up : s.down}>{row.side === 'buy' ? 'Buy' : 'Sell'}</span> {row.coin}
        </b>
        <span className={s.amount}>
          {row.amount ?? '—'} at {row.price ?? '—'} {row.unit}
        </span>
      </span>
      <span className={s.figures}>
        <span className={`${s.change} ${TONE[row.tone] ?? ''}`}>{row.state}</span>
        {row.filledPct !== null && <span className={s.since}>{row.filledPct}% filled</span>}
      </span>
      {action ? (
        <button className={`${s.display} ${s.sell}`} onClick={onCancel} disabled={locked} aria-label={`${row.canClaim ? 'Take back' : 'Cancel'} ${row.side} order of ${row.coin}`}>
          {busy === 'wallet' ? 'Sign…' : busy ? 'Wait…' : row.canClaim ? 'Take back' : 'Cancel'}
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}

function StopItem({ row, onCancel, onSale }: { row: StopRow; onCancel: () => void; onSale: () => void }) {
  const live = row.view === 'watching' || row.view === 'reached';
  return (
    <li className={s.row}>
      <span className={s.names}>
        <b className={s.symbol}>
          <span className={row.side === 'buy' ? s.up : s.down}>Stop</span> {row.coin}
        </b>
        <span className={s.amount}>
          {row.side === 'sell' ? 'Sell' : 'Buy with'} {row.spends} {row.side === 'sell' ? '≤' : '≥'} {row.price} {row.unit}
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
          <button className={`${s.display} ${s.sell} ${s.attention}`} onClick={onSale} aria-label={`Check the ${row.side === 'sell' ? 'sale' : 'purchase'} of ${row.coin}`}>
            Check
          </button>
        )}
        <button className={`${s.display} ${s.sell}`} onClick={onCancel} aria-label={live ? `Cancel the stop on ${row.coin}` : `Remove the stop on ${row.coin}`}>
          {live ? 'Cancel' : 'Remove'}
        </button>
      </span>
    </li>
  );
}
