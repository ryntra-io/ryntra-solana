'use client';

import { useMemo } from 'react';
import { cancelAllMarkets, orderRows, positionRows, reducesFrom, type OrderRow, type PositionRow } from '@/city/lib/exchange/account';
import { cancelAllBody, cancelBody, closeBody, ISSUE_WORDS, protectBody, protectIssue } from '@/city/lib/exchange/ticket';
import { leverage, percent, plainPrice, price, signedUsd, units, usd, when } from '@/city/lib/exchange/format';
import { levelStrip, perpLayers, type LayerTone } from '@/city/lib/exchange/layers';
import { BUSY, useExchange } from '@/city/lib/exchange/store';
import { useWallet } from '@/city/lib/trade/wallet';
import type { HistoryKind } from '@/lib/phoenix/history';
import { symbolKey } from '@/lib/phoenix/market-data';
import { walletSignsV1 } from '@/lib/solana/wallet.client';
import { ConnectCard, useAccountKind } from './Account';
import { ArtState } from './Art';
import s from './exchange.module.css';

const TONE: Readonly<Record<LayerTone, string>> = { ice: 'var(--ice)', flare: 'var(--flare)', mint: 'var(--mint)', warm: 'var(--warm)', violet: '#C9A2FF' };

const v1Of = (wallet: string): boolean => {
  try {
    return walletSignsV1(wallet);
  } catch {
    return false;
  }
};

function usePositions(): readonly PositionRow[] {
  const account = useExchange((st) => st.account.value);
  const markets = useExchange((st) => st.markets.value?.markets);
  return useMemo(() => positionRows(account, markets ?? []), [account, markets]);
}

function useOrders(): readonly OrderRow[] {
  const account = useExchange((st) => st.account.value);
  return useMemo(() => orderRows(account), [account]);
}

export function usePositionCount(): number {
  return usePositions().length;
}

export function useOrderCount(): number {
  return useOrders().length;
}

/** The account's positions with Phoenix's figures, each with its close and its TP/SL, and its levels on one strip. */
export function Positions() {
  const rows = usePositions();
  const account = useExchange((st) => st.account.value);
  const orders = useOrders();
  const connected = useWallet((st) => Boolean(st.connection));
  const read = useExchange((st) => st.account.status);
  if (!connected) return <ConnectCard />;
  if (!account && read === 'failed') return <div className={s.empty}>Phoenix isn’t answering</div>;
  if (read === 'loading' || read === 'idle') return <span className={s.shimmer} />;
  if (rows.length === 0) return <ArtState art="empty" title="No open positions" />;
  return (
    <div className={s.list}>
      {rows.map((row) => (
        <PositionItem key={row.key} row={row} orders={orders} />
      ))}
    </div>
  );
}

function PositionItem({ row, orders }: { row: PositionRow; orders: readonly OrderRow[] }) {
  const kind = useAccountKind();
  const connection = useWallet((st) => st.connection);
  const phase = useExchange((st) => st.phase);
  const form = useExchange((st) => st.protectForm);
  const openProtect = useExchange((st) => st.openProtect);
  const review = useExchange((st) => st.review);
  const states = useExchange((st) => st.orderStates);
  const layers = useMemo(() => perpLayers(row.symbol, [row], orders), [row, orders]);
  const strip = useMemo(() => levelStrip(layers, row.mark), [layers, row.mark]);
  const busy = BUSY.has(phase);
  const can = Boolean(connection) && row.manageable && reducesFrom(kind) && Boolean(states?.open);
  const editing = form !== null && symbolKey(form.symbol) === symbolKey(row.symbol);
  const pnlTone = row.pnlUsd === null ? '' : row.pnlUsd >= 0 ? s.up : s.down;
  const liquidation =
    row.liquidation === 'unread' ? '—' : row.liquidationUsd === null ? '—' : `${price(row.liquidationUsd)}${row.liquidationAwayPercent === null ? '' : ` (${percent(row.liquidationAwayPercent)})`}`;
  return (
    <div className={s.item}>
      <div className={`${s.display} ${s.itemName}`}>
        <span>{row.symbol}</span>
        <span className={`${s.tag} ${row.side === 'long' ? s.tagLong : s.tagShort}`}>
          {row.side} {leverage(row.leverage)}
        </span>
        {!row.manageable && <span className={s.tag}>Isolated</span>}
      </div>
      <div className={`${s.itemFigure} ${pnlTone}`} title="At the mark price">
        {signedUsd(row.pnlUsd)}
      </div>
      <div className={s.itemLine}>
        <b>{units(row.size, row.symbol)}</b> · entry <b>{price(row.entry)}</b>
      </div>
      <div className={s.itemLine}>
        Liq. <b className={row.liquidationUsd !== null ? s.down : undefined}>{liquidation}</b>
        {row.tp !== null && (
          <>
            {' '}
            · TP <b>{price(row.tp)}</b>
          </>
        )}
        {row.sl !== null && (
          <>
            {' '}
            · SL <b>{price(row.sl)}</b>
          </>
        )}
      </div>
      {strip.marks.length > 0 && (
        <>
          <div className={s.levels} aria-label={strip.marks.map((mark) => `${mark.label} ${price(mark.price)}`).join(', ')}>
            {strip.marks.map((mark) => (
              <span key={mark.id} className={`${s.level} ${mark.dashed ? s.levelDashed : ''}`} style={{ left: `${mark.at * 100}%`, ['--tone' as string]: TONE[mark.tone] }} title={`${mark.label} ${price(mark.price)}`} />
            ))}
            {strip.markAt !== null && <span className={s.levelMark} style={{ left: `${strip.markAt * 100}%` }} title={`Mark ${price(row.mark)}`} />}
          </div>
        </>
      )}
      {row.manageable ? (
        <div className={s.itemActions}>
          <button className={`${s.small} ${s.smallDanger}`} disabled={!can || busy} onClick={() => connection && void review(connection, { kind: 'close', symbol: row.symbol }, closeBody(connection.address, row.symbol, undefined, v1Of(connection.wallet)))}>
            Close
          </button>
          <button
            className={`${s.small} ${editing ? s.chipOn : ''}`}
            disabled={!can || busy}
            onClick={() => openProtect(editing ? null : { symbol: row.symbol, side: row.side, tp: plainPrice(row.tp), sl: plainPrice(row.sl) })}
          >
            TP/SL
          </button>
        </div>
      ) : null}
      {editing && <ProtectForm />}
    </div>
  );
}

function ProtectForm() {
  const form = useExchange((st) => st.protectForm)!;
  const setProtect = useExchange((st) => st.setProtect);
  const review = useExchange((st) => st.review);
  const phase = useExchange((st) => st.phase);
  const market = useExchange((st) => st.markets.value?.markets.find((entry) => symbolKey(entry.symbol) === symbolKey(form.symbol)) ?? null);
  const connection = useWallet((st) => st.connection);
  const issue = market ? protectIssue(form.side, market, form.tp, form.sl) : 'UNITS';
  const body = connection && market && issue === null ? protectBody(connection.address, market, form.side, form.tp, form.sl, v1Of(connection.wallet)) : null;
  return (
    <div className={s.itemForm}>
      <div className={s.pairFields}>
        <label className={s.field}>
          <span className={s.fieldUnit}>TP</span>
          <input className={s.input} inputMode="decimal" placeholder="None" aria-label={`${form.symbol} take profit, USD`} value={form.tp} onChange={(event) => setProtect({ tp: event.target.value })} />
        </label>
        <label className={s.field}>
          <span className={s.fieldUnit}>SL</span>
          <input className={s.input} inputMode="decimal" placeholder="None" aria-label={`${form.symbol} stop loss, USD`} value={form.sl} onChange={(event) => setProtect({ sl: event.target.value })} />
        </label>
      </div>
      {issue && <div className={`${s.notice} ${s.noticeWarn}`}>{ISSUE_WORDS[issue]}</div>}
      <button className={`${s.choice} ${s.choiceOn} ${s.formAction}`} disabled={!body || BUSY.has(phase)} onClick={() => connection && body && void review(connection, { kind: 'protect', symbol: form.symbol }, body)}>
        Review TP/SL
      </button>
    </div>
  );
}

/** The account's resting orders: each one's cancel where it can be named alone, and «Cancel all» of a market. */
export function Orders() {
  const rows = useOrders();
  const account = useExchange((st) => st.account.value);
  const connection = useWallet((st) => st.connection);
  const phase = useExchange((st) => st.phase);
  const states = useExchange((st) => st.orderStates);
  const review = useExchange((st) => st.review);
  const read = useExchange((st) => st.account.status);
  const kind = useAccountKind();
  if (!connection) return <ConnectCard />;
  if (!account && read === 'failed') return <div className={s.empty}>Phoenix isn’t answering</div>;
  if (read === 'loading' || read === 'idle') return <span className={s.shimmer} />;
  if (rows.length === 0) return <ArtState art="empty" title="No open orders" />;
  const can = reducesFrom(kind) && Boolean(states?.open) && !BUSY.has(phase);
  const v1 = v1Of(connection.wallet);
  return (
    <>
      <div className={s.list}>
        {rows.map((row) => (
          <div key={row.key} className={s.item}>
            <div className={`${s.display} ${s.itemName}`}>
              <span>{row.symbol}</span>
              <span className={`${s.tag} ${row.side === 'buy' ? s.tagLong : s.tagShort}`}>
                {row.side} {row.leg ? (row.leg === 'tp' ? 'take profit' : 'stop loss') : row.type}
              </span>
            </div>
            <div className={s.itemFigure}>{price(row.price)}</div>
            <div className={s.itemLine}>
              <b>{units(row.size, row.symbol)}</b> left{row.reduceOnly ? ' · reduce only' : ''}
            </div>
            {row.cancel && (
              <div className={s.itemActions}>
                <button className={s.small} disabled={!can} onClick={() => void review(connection, { kind: 'cancel', symbol: row.symbol, leg: row.leg }, cancelBody(connection.address, row, v1))}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={s.itemActions}>
        {cancelAllMarkets(account).map((symbol) => (
          <button key={symbol} className={`${s.small} ${s.smallDanger}`} disabled={!can} onClick={() => void review(connection, { kind: 'cancelAll', symbol }, cancelAllBody(connection.address, symbol, v1))}>
            Cancel all {symbol}
          </button>
        ))}
      </div>
    </>
  );
}

const KINDS: readonly { id: HistoryKind; label: string }[] = [
  { id: 'trades', label: 'Fills' },
  { id: 'orders', label: 'Orders' },
  { id: 'funding', label: 'Funding' },
];

/** The wallet's own history on Phoenix: its fills, its orders and what became of each, and the funding it paid or got. */
export function HistoryList() {
  const connection = useWallet((st) => st.connection);
  const kind = useExchange((st) => st.historyKind);
  const setKind = useExchange((st) => st.setHistoryKind);
  const history = useExchange((st) => st.history);
  if (!connection) return <ConnectCard />;
  const value = history.value;
  return (
    <>
      <div className={s.chips} role="tablist" aria-label="History">
        {KINDS.map((entry) => (
          <button key={entry.id} role="tab" aria-selected={kind === entry.id} className={`${s.chip} ${kind === entry.id ? s.chipOn : ''}`} onClick={() => setKind(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>
      {history.status === 'failed' && !value ? (
        <div className={s.empty}>Phoenix isn’t answering</div>
      ) : !value || value.kind !== kind ? (
        <span className={s.shimmer} />
      ) : value.kind === 'trades' ? (
        value.value.trades.length === 0 ? (
          <div className={s.empty}>No fills yet.</div>
        ) : (
          <>
            <div className={s.line}>
              Realised <b className={value.value.realizedPnlUsd === null ? undefined : value.value.realizedPnlUsd >= 0 ? s.up : s.down}>{signedUsd(value.value.realizedPnlUsd)}</b> · fees <b>{usd(value.value.feesUsd)}</b> · last {value.value.trades.length} fills
            </div>
            <div className={s.list}>
              {value.value.trades.map((trade) => (
                <div key={trade.id} className={s.item}>
                  <div className={`${s.display} ${s.itemName}`}>
                    <span>{trade.symbol}</span>
                    <span className={`${s.tag} ${trade.kind === 'liquidation' || trade.kind === 'adl' ? s.tagDanger : trade.side === 'buy' ? s.tagLong : s.tagShort}`}>{trade.kind === 'liquidation' || trade.kind === 'adl' ? trade.kind : trade.side}</span>
                  </div>
                  <div className={`${s.itemFigure} ${trade.realizedPnlUsd === null || trade.realizedPnlUsd === 0 ? '' : trade.realizedPnlUsd > 0 ? s.up : s.down}`}>{trade.realizedPnlUsd === null || trade.realizedPnlUsd === 0 ? '' : signedUsd(trade.realizedPnlUsd)}</div>
                  <div className={s.itemLine}>
                    {when(trade.at)} · <b>{units(trade.sizeUnits, trade.symbol)}</b> at <b>{price(trade.priceUsd)}</b> · fee {usd(trade.feeUsd)} · {trade.liquidity}
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      ) : value.kind === 'orders' ? (
        value.value.orders.length === 0 ? (
          <div className={s.empty}>No orders yet.</div>
        ) : (
          <div className={s.list}>
            {value.value.orders.map((order) => (
              <div key={order.id} className={s.item}>
                <div className={`${s.display} ${s.itemName}`}>
                  <span>{order.symbol}</span>
                  <span className={`${s.tag} ${order.side === 'buy' ? s.tagLong : s.tagShort}`}>{order.side}</span>
                </div>
                <div className={s.itemFigure}>{order.status}</div>
                <div className={s.itemLine}>
                  {when(order.endedAt ?? order.placedAt)} · <b>{units(order.filledUnits, order.symbol)}</b> of {units(order.sizeUnits, order.symbol)} at <b>{price(order.priceUsd)}</b>
                  {order.reduceOnly ? ' · reduce only' : ''}
                  {order.stop ? ' · stop' : ''}
                </div>
              </div>
            ))}
          </div>
        )
      ) : value.value.events.length === 0 ? (
        <div className={s.empty}>No funding yet.</div>
      ) : (
        <>
          <div className={s.line}>
            Paid <b>{usd(value.value.paidUsd)}</b> · received <b>{usd(value.value.receivedUsd)}</b>
          </div>
          <div className={s.list}>
            {value.value.events.map((event, index) => (
              <div key={`${event.at}:${event.symbol}:${index}`} className={s.item}>
                <div className={`${s.display} ${s.itemName}`}>
                  <span>{event.symbol}</span>
                </div>
                <div className={`${s.itemFigure} ${event.amountUsd >= 0 ? s.up : s.down}`}>{signedUsd(event.amountUsd)}</div>
                <div className={s.itemLine}>
                  {when(event.at)}
                  {event.ratePercent !== null ? ` · rate ${event.ratePercent.toFixed(4)}%` : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
