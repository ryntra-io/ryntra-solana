'use client';

import { useMemo } from 'react';
import { cancelAllMarkets, orderRows, positionRows, reducesFrom, type OrderRow, type PositionRow } from '@/city/lib/exchange/account';
import { cancelAllBody, cancelBody, closeBody, ISSUE_WORDS, protectBody, protectIssue } from '@/city/lib/exchange/ticket';
import { leverage, percent, plainPrice, price, signedUsd, units, usd, when } from '@/city/lib/exchange/format';
import { levelStrip, perpLayers, type LayerTone } from '@/city/lib/exchange/layers';
import { BUSY, useExchange } from '@/city/lib/exchange/store';
import { digits, useWords, type TextKey } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { useWallet } from '@/city/lib/trade/wallet';
import type { HistoryKind } from '@/lib/phoenix/history';
import { symbolKey } from '@/lib/phoenix/market-data';
import { walletSignsV1 } from '@/lib/solana/wallet.client';
import { ConnectCard, useAccountKind } from './Account';
import { ArtState } from './Art';
import { EX } from './words';
import s from './exchange.module.css';

type W = (typeof EX)['en'];

/** Phoenix's own words for an order's type and status, a fill's cause and side, in the language on screen; a word this
 * release does not know is shown as Phoenix wrote it. */
const PHOENIX_WORDS: Readonly<Record<string, TextKey<typeof EX>>> = {
  limit: 'typeLimit',
  market: 'typeMarket',
  postOnly: 'typePostOnly',
  post_only: 'typePostOnly',
  active: 'statusActive',
  open: 'statusOpen',
  filled: 'statusFilled',
  cancelled: 'statusCancelled',
  canceled: 'statusCancelled',
  expired: 'statusExpired',
  liquidation: 'liquidation',
  adl: 'adl',
  buy: 'buy',
  sell: 'sell',
  long: 'long',
  short: 'short',
  maker: 'maker',
  taker: 'taker',
};
const phoenixWord = (w: W, word: string): string => (Object.hasOwn(PHOENIX_WORDS, word) ? w[PHOENIX_WORDS[word]!] : word);

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
  const w = useWords(EX);
  if (!connected) return <ConnectCard />;
  if (!account && read === 'failed') return <div className={s.empty}>{w.phoenixSilent}</div>;
  if (read === 'loading' || read === 'idle') return <span className={s.shimmer} />;
  if (rows.length === 0) return <ArtState art="empty" title={w.noPositions} />;
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
  const w = useWords(EX);
  // The levels are named in the language on screen: a switch names them again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layers = useMemo(() => perpLayers(row.symbol, [row], orders), [row, orders, w]);
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
          {phoenixWord(w, row.side)} {leverage(row.leverage)}
        </span>
        {!row.manageable && <span className={s.tag}>{w.isolated}</span>}
      </div>
      <div className={`${s.itemFigure} ${pnlTone}`} title={w.atMark}>
        {signedUsd(row.pnlUsd)}
      </div>
      <div className={s.itemLine}>
        <b>{units(row.size, row.symbol)}</b> · {w.entry} <b>{price(row.entry)}</b>
      </div>
      <div className={s.itemLine}>
        {w.liq} <b className={row.liquidationUsd !== null ? s.down : undefined}>{liquidation}</b>
        {row.tp !== null && (
          <>
            {' '}
            · {w.tp} <b>{price(row.tp)}</b>
          </>
        )}
        {row.sl !== null && (
          <>
            {' '}
            · {w.sl} <b>{price(row.sl)}</b>
          </>
        )}
      </div>
      {strip.marks.length > 0 && (
        <>
          <div className={s.levels} aria-label={strip.marks.map((mark) => `${mark.label} ${price(mark.price)}`).join(', ')}>
            {strip.marks.map((mark) => (
              <span key={mark.id} className={`${s.level} ${mark.dashed ? s.levelDashed : ''}`} style={{ left: `${mark.at * 100}%`, ['--tone' as string]: TONE[mark.tone] }} title={`${mark.label} ${price(mark.price)}`} />
            ))}
            {strip.markAt !== null && <span className={s.levelMark} style={{ left: `${strip.markAt * 100}%` }} title={w.mark(price(row.mark))} />}
          </div>
        </>
      )}
      {row.manageable ? (
        <div className={s.itemActions}>
          <button className={`${s.small} ${s.smallDanger}`} disabled={!can || busy} onClick={() => connection && void review(connection, { kind: 'close', symbol: row.symbol }, closeBody(connection.address, row.symbol, undefined, v1Of(connection.wallet)))}>
            {w.close}
          </button>
          <button
            className={`${s.small} ${editing ? s.chipOn : ''}`}
            disabled={!can || busy}
            onClick={() => openProtect(editing ? null : { symbol: row.symbol, side: row.side, tp: plainPrice(row.tp), sl: plainPrice(row.sl) })}
          >
            {w.tpsl}
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
  const w = useWords(EX);
  const issue = market ? protectIssue(form.side, market, form.tp, form.sl) : 'UNITS';
  const body = connection && market && issue === null ? protectBody(connection.address, market, form.side, form.tp, form.sl, v1Of(connection.wallet)) : null;
  return (
    <div className={s.itemForm}>
      <div className={s.pairFields}>
        <label className={s.field}>
          <span className={s.fieldUnit}>{w.tp}</span>
          <input className={s.input} inputMode="decimal" placeholder={w.none} aria-label={w.takeProfitOf(form.symbol)} value={fieldText(form.tp)} onChange={(event) => setProtect({ tp: fieldValue(event.target.value) })} />
        </label>
        <label className={s.field}>
          <span className={s.fieldUnit}>{w.sl}</span>
          <input className={s.input} inputMode="decimal" placeholder={w.none} aria-label={w.stopLossOf(form.symbol)} value={fieldText(form.sl)} onChange={(event) => setProtect({ sl: fieldValue(event.target.value) })} />
        </label>
      </div>
      {issue && <div className={`${s.notice} ${s.noticeWarn}`}>{ISSUE_WORDS[issue]}</div>}
      <button className={`${s.choice} ${s.choiceOn} ${s.formAction}`} disabled={!body || BUSY.has(phase)} onClick={() => connection && body && void review(connection, { kind: 'protect', symbol: form.symbol }, body)}>
        {w.reviewTpsl}
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
  const w = useWords(EX);
  if (!connection) return <ConnectCard />;
  if (!account && read === 'failed') return <div className={s.empty}>{w.phoenixSilent}</div>;
  if (read === 'loading' || read === 'idle') return <span className={s.shimmer} />;
  if (rows.length === 0) return <ArtState art="empty" title={w.noOrders} />;
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
                {phoenixWord(w, row.side)} {row.leg ? (row.leg === 'tp' ? w.takeProfitLower : w.stopLossLower) : phoenixWord(w, row.type)}
              </span>
            </div>
            <div className={s.itemFigure}>{price(row.price)}</div>
            <div className={s.itemLine}>
              <b>{units(row.size, row.symbol)}</b> {w.left}
              {row.reduceOnly ? ` · ${w.reduceOnly}` : ''}
            </div>
            {row.cancel && (
              <div className={s.itemActions}>
                <button className={s.small} disabled={!can} onClick={() => void review(connection, { kind: 'cancel', symbol: row.symbol, leg: row.leg }, cancelBody(connection.address, row, v1))}>
                  {w.cancel}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={s.itemActions}>
        {cancelAllMarkets(account).map((symbol) => (
          <button key={symbol} className={`${s.small} ${s.smallDanger}`} disabled={!can} onClick={() => void review(connection, { kind: 'cancelAll', symbol }, cancelAllBody(connection.address, symbol, v1))}>
            {w.cancelAll(symbol)}
          </button>
        ))}
      </div>
    </>
  );
}

const KINDS: readonly { id: HistoryKind; label: TextKey<typeof EX> }[] = [
  { id: 'trades', label: 'fills' },
  { id: 'orders', label: 'orders' },
  { id: 'funding', label: 'funding' },
];

/** The wallet's own history on Phoenix: its fills, its orders and what became of each, and the funding it paid or got. */
export function HistoryList() {
  const connection = useWallet((st) => st.connection);
  const kind = useExchange((st) => st.historyKind);
  const setKind = useExchange((st) => st.setHistoryKind);
  const history = useExchange((st) => st.history);
  const w = useWords(EX);
  if (!connection) return <ConnectCard />;
  const value = history.value;
  return (
    <>
      <div className={s.chips} role="tablist" aria-label={w.history}>
        {KINDS.map((entry) => (
          <button key={entry.id} role="tab" aria-selected={kind === entry.id} className={`${s.chip} ${kind === entry.id ? s.chipOn : ''}`} onClick={() => setKind(entry.id)}>
            {w[entry.label]}
          </button>
        ))}
      </div>
      {history.status === 'failed' && !value ? (
        <div className={s.empty}>{w.phoenixSilent}</div>
      ) : !value || value.kind !== kind ? (
        <span className={s.shimmer} />
      ) : value.kind === 'trades' ? (
        value.value.trades.length === 0 ? (
          <div className={s.empty}>{w.noFills}</div>
        ) : (
          <>
            <div className={s.line}>
              {w.realised} <b className={value.value.realizedPnlUsd === null ? undefined : value.value.realizedPnlUsd >= 0 ? s.up : s.down}>{signedUsd(value.value.realizedPnlUsd)}</b> · {w.fees} <b>{usd(value.value.feesUsd)}</b> · {w.lastFills(value.value.trades.length)}
            </div>
            <div className={s.list}>
              {value.value.trades.map((trade) => (
                <div key={trade.id} className={s.item}>
                  <div className={`${s.display} ${s.itemName}`}>
                    <span>{trade.symbol}</span>
                    <span className={`${s.tag} ${trade.kind === 'liquidation' || trade.kind === 'adl' ? s.tagDanger : trade.side === 'buy' ? s.tagLong : s.tagShort}`}>{phoenixWord(w, trade.kind === 'liquidation' || trade.kind === 'adl' ? trade.kind : trade.side)}</span>
                  </div>
                  <div className={`${s.itemFigure} ${trade.realizedPnlUsd === null || trade.realizedPnlUsd === 0 ? '' : trade.realizedPnlUsd > 0 ? s.up : s.down}`}>{trade.realizedPnlUsd === null || trade.realizedPnlUsd === 0 ? '' : signedUsd(trade.realizedPnlUsd)}</div>
                  <div className={s.itemLine}>
                    {when(trade.at)} · <b>{units(trade.sizeUnits, trade.symbol)}</b> {w.at} <b>{price(trade.priceUsd)}</b> · {w.fee} {usd(trade.feeUsd)} · {phoenixWord(w, trade.liquidity)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      ) : value.kind === 'orders' ? (
        value.value.orders.length === 0 ? (
          <div className={s.empty}>{w.noOrdersYet}</div>
        ) : (
          <div className={s.list}>
            {value.value.orders.map((order) => (
              <div key={order.id} className={s.item}>
                <div className={`${s.display} ${s.itemName}`}>
                  <span>{order.symbol}</span>
                  <span className={`${s.tag} ${order.side === 'buy' ? s.tagLong : s.tagShort}`}>{phoenixWord(w, order.side)}</span>
                </div>
                <div className={s.itemFigure}>{phoenixWord(w, order.status)}</div>
                <div className={s.itemLine}>
                  {when(order.endedAt ?? order.placedAt)} · <b>{units(order.filledUnits, order.symbol)}</b> {w.of} {units(order.sizeUnits, order.symbol)} {w.at} <b>{price(order.priceUsd)}</b>
                  {order.reduceOnly ? ` · ${w.reduceOnly}` : ''}
                  {order.stop ? ` · ${w.stop}` : ''}
                </div>
              </div>
            ))}
          </div>
        )
      ) : value.value.events.length === 0 ? (
        <div className={s.empty}>{w.noFunding}</div>
      ) : (
        <>
          <div className={s.line}>
            {w.paid} <b>{usd(value.value.paidUsd)}</b> · {w.received} <b>{usd(value.value.receivedUsd)}</b>
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
                  {event.ratePercent !== null ? ` · ${w.rate(digits(event.ratePercent.toFixed(4)))}` : ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
