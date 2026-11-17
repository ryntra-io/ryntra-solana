'use client';

import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { formatUnits } from '@/city/lib/trade/format';
import type { Market, Order } from '@/city/lib/trade/pro-ladder';
import { LADDER_BUSY, useLadder, type OrderStep } from '@/city/lib/trade/pro-store';
import { Cell, Quiet, Table, TableHead, TableRow } from '@/terminal/ui';
import { bare } from '../parts';
import { quotePrice, failureWords } from './LadderTicket';
import { orderRow, type OrderAct } from './ladder-view';
import { LIMIT } from './words';
import l from './ladder.module.css';
import u from '../coin.module.css';

const COLUMNS = 'minmax(150px, 1.3fr) minmax(64px, 0.6fr) repeat(3, minmax(96px, 1fr)) minmax(120px, auto)';

const STEP: Readonly<Record<OrderAct, OrderStep>> = { take: 'collect', deposit: 'close', cancel: 'close', resume: 'agent-on' };

/**
 * The person's orders of this coin in its DLMM Pro pool, under the chart: one price or a ladder, how far along, from
 * which price to which, what rests, and what can be done — take what filled, cancel, take the deposit back, let the
 * agent collect again. Each is the engine's Review, the wallet's one approval and the relay (`pro-store.ts` `act`).
 * Null where the wallet has none: the tab says its own calm line.
 */
export function LadderOrders({ market, symbol }: { market: Market; symbol: string }) {
  const w = useWords(LIMIT);
  const lang = useLang();
  const orders = useLadder((st) => (st.mint === market.coin.mint ? st.orders : null));
  const acting = useLadder((st) => st.acting);
  const phase = useLadder((st) => st.phase);
  const act = useLadder((st) => st.act);
  const list = orders?.value ?? [];
  if (!list.length) return null;
  const sym = bare(symbol);
  const held = LADDER_BUSY.has(phase) || (acting !== null && LADDER_BUSY.has(acting.phase));
  const failed = acting?.phase === 'failed' && acting.failure ? acting : null;
  const amount = (order: Order, raw: string, inQuote: boolean) => `${digits(formatUnits(raw, inQuote ? order.quote.decimals : order.coin.decimals, 'down'), lang)} ${inQuote ? market.quote.symbol : sym}`;
  const price = (value: number | null) => (value === null ? '—' : quotePrice(value, market.quote.symbol, lang));
  return (
    <>
      {failed ? (
        <p className={u.underNote} data-tone="error" role="alert">
          {failed.failure === 'PRO_LIMIT_SUBMIT_FAILED' ? w.notDone : failureWords(w, failed.failure!)}
        </p>
      ) : null}
      <Table columns={COLUMNS} minWidth={680} label={w.myOrders}>
        <TableHead>
          <Cell head>{w.colOrder}</Cell>
          <Cell head end>
            {w.colPrices}
          </Cell>
          <Cell head end>
            {w.colFrom}
          </Cell>
          <Cell head end>
            {w.colTo}
          </Cell>
          <Cell head end>
            {w.colSum}
          </Cell>
          <Cell head />
        </TableHead>
        {list.map((order) => {
          const row = orderRow(order, market.collector !== null);
          const mine = acting?.nftMint === order.nftMint ? acting : null;
          const working = mine !== null && LADDER_BUSY.has(mine.phase) ? mine : null;
          const sub = row.taken ? w.collected : row.agent === 'collects' ? w.agentCollects : row.agent === 'paused' ? w.agentPaused : w.resting;
          const words: Readonly<Record<OrderAct, string>> = { take: w.take, deposit: w.depositBack, cancel: w.cancel, resume: w.agentResume };
          return (
            <TableRow key={row.key}>
              <Cell tone={row.side === 'buy' ? 'up' : row.side === 'sell' ? 'down' : undefined}>
                <span className={l.orderName}>
                  <span>{`${row.kind === 'one' ? w.orderOne : w.orderLadder}${row.side ? ` · ${row.side === 'buy' ? w.orderBuy : w.orderSell}` : ''}`}</span>
                  <span className={l.orderSub}>{sub}</span>
                </span>
              </Cell>
              <Cell end>{digits(w.progress(row.filled, row.of), lang)}</Cell>
              <Cell end>{price(row.from)}</Cell>
              <Cell end>{price(row.to)}</Cell>
              <Cell end>{row.taken ? '—' : amount(order, row.restsRaw, row.inQuote)}</Cell>
              <Cell end className={u.act}>
                <span className={l.acts}>
                  {row.actions.map((what) => {
                    const step = STEP[what];
                    // «Cancel» and «Deposit back» are one step of the engine; the row says which was pressed.
                    const pressed = working !== null && working.step === step && (what !== 'cancel' || !row.taken);
                    return (
                      <Quiet
                        key={what}
                        size="s"
                        disabled={held}
                        aria-busy={pressed || undefined}
                        aria-label={what === 'take' ? w.takeOf(sym) : what === 'cancel' ? w.cancelOf(sym) : undefined}
                        onClick={() => void act(order, step)}
                      >
                        {pressed ? (working.phase === 'wallet' ? w.confirm : working.phase === 'sending' ? w.sending : w.preparing) : words[what]}
                      </Quiet>
                    );
                  })}
                </span>
              </Cell>
            </TableRow>
          );
        })}
      </Table>
    </>
  );
}

/** How many of the person's orders of this coin stand in its pool: what «Orders» counts beside the other orders. */
export function useLadderCount(mint: string): number {
  return useLadder((st) => (st.mint === mint ? (st.orders.value?.length ?? 0) : 0));
}
