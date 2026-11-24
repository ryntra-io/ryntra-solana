'use client';

import { useEffect, useState } from 'react';

import { digits, useWords } from '@/city/lib/i18n/dict';
import { formatUnits } from '@/city/lib/trade/format';
import { useTrade } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { STOCK_BAND } from '@/lib/privacy/stocks/band';
import { useStockPrivate } from '@/lib/privacy/stocks/useStockPrivate';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import type { CardOrder } from '@/lib/privacy/swap/useSwap';
import { Info, PrivacyBand, PrivacyToggle, Quiet, privateModeOpen, usePrivateMode } from '@/terminal/ui';
import { useStockPoolFacts } from '@/terminal/stocks/useStockPoolFacts';
import { PrivateIssuerLine } from './IssuerLine';
import { flowLine, stageLabel, type FlowState, type Units } from './view';
import { PRIVATE_STOCK } from './words';
import t from '@/terminal/coin/ticket.module.css';
import x from './private.module.css';

/** Where the toggle «Public ⇄ Private» of a stock's ticket is remembered (`usePrivateMode`). */
export const STOCK_SCOPE = 'stock';

/** A flow as a stand shows it, in place of the live one: its state and its stage. */
export type ShownFlow = FlowState & Readonly<{ stage: string | null }>;

/** A coin of the ticket: its mint, its ticker, its decimals (null until the engine said). */
export type StockSide = Readonly<{ mint: string; symbol: string; decimals: number | null }>;

/**
 * Whether a ticket offers the private buy: the build has the private mode, the ticket buys, and the coin is a checked
 * stock (its facts read from the stocks engine only then); and whether the person turned it on.
 */
export function usePrivateStock(mint: string, buying: boolean): Readonly<{ offered: boolean; on: boolean }> {
  const [mode] = usePrivateMode(STOCK_SCOPE);
  const asked = privateModeOpen() && buying;
  const facts = useStockPoolFacts(asked ? mint : null);
  const offered = asked && facts?.isStock === true;
  return { offered, on: offered && mode === 'private' };
}

/** Seconds since a moment, ticking once a second while it stands. */
function useSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1_000));
}

/** The ticket's amber button while a private stock flow runs: its word and its busy state; null word — the ticket's own. */
export function usePrivateStockButton(): Readonly<{ label: string | null; busy: boolean }> {
  const w = useWords(PRIVATE_STOCK);
  const stage = useStockPrivate((st) => st.stage);
  const seconds = useSeconds(useStockPrivate((st) => st.since));
  return { label: stageLabel(stage, seconds, w), busy: stage !== null };
}

/** The ticket's two coins as the line writes amounts: in the coin's decimals once known, else as raw units. */
export function unitsOf(sides: readonly StockSide[]): Units {
  const of = (mint: string) => sides.find((side) => side.mint === mint);
  return {
    amount: (raw, mint) => {
      const decimals = of(mint)?.decimals;
      return digits(decimals == null ? raw.toString() : formatUnits(raw.toString(), decimals, 'down'));
    },
    symbol: (mint) => of(mint)?.symbol ?? '',
  };
}

/** A stand's toggle shows its state and changes nothing. */
const standToggle = () => undefined;

/** The network the coin ticket builds its orders for: Jupiter's routes are on Solana's main network. */
const TICKET_CHAIN = 'solana:mainnet';

/** Buys the stock of the ticket's exact order from the private balance, with the connected wallet. */
export function startPrivateStockBuy(order: CardOrder, wallet: string, owner: string): void {
  // After the proof, the ticket's freshest exact order (it renews its bytes while the person waits).
  void useStockPrivate.getState().buy(order, TICKET_CHAIN, wallet, owner, () => useTrade.getState().review?.order.order ?? null);
}

/**
 * The private part of a stock's buy ticket, above its one amber button. The toggle «Public ⇄ Private» on its
 * own row; with «Private» on: the band «what others see» (all four seen — the buy is on chain) and its one line that the
 * amount is seen on the way out and the stock where it lands, with «i»: the stock lands on the wallet because the private
 * balance can't hold stock tokens yet. Then the issuer's rights and the exchange's hours — «Recurring buys»' own line —
 * and where the coins are after the press, from the chain; only when a break left them on the person's own wallet, one
 * quiet «Return to private balance». The button is the ticket's own; its words while the flow runs come from
 * `usePrivateStockButton`. `facts` and `shown` — what a stand already holds; a ticket leaves them out.
 */
export function PrivateStockPart({ stock, pay, on, facts, shown }: { stock: StockSide; pay: StockSide; on: boolean; facts?: PoolFacts | null; shown?: ShownFlow }) {
  const w = useWords(PRIVATE_STOCK);
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const live = useStockPrivate();
  const state = shown ?? live;
  const where = state.where;

  // A buy this browser left half way is read from the chain again when its wallet is here.
  useEffect(() => {
    if (owner && on && !shown) void useStockPrivate.getState().reread(owner);
  }, [owner, on, shown]);
  // Still landing: the chain is read again shortly — the line never says «done» before it is.
  useEffect(() => {
    if (!owner || !on || shown || where?.place !== 'landing') return;
    const timer = setTimeout(() => void useStockPrivate.getState().reread(owner), 4_000);
    return () => clearTimeout(timer);
  }, [owner, on, shown, where]);

  const line = on ? flowLine('buy', state, w, unitsOf([stock, pay]), { stock: stock.mint }) : null;
  return (
    <div className={x.part} data-private-stock={on ? 'private' : 'open'}>
      <div className={x.mode}>
        {/* A stand holds the toggle with its own state; a ticket's toggle is the remembered mode itself. */}
        <PrivacyToggle scope={STOCK_SCOPE} {...(shown ? { on, onChange: standToggle } : {})} />
      </div>
      {on ? (
        <>
          <PrivacyBand action={STOCK_BAND.buy} />
          <div className={x.line}>
            <span className={t.note} data-tone="info">
              {w.seen}
            </span>
            <Info label={w.stockLabel}>
              <span className={x.how}>
                <span>{w.stockStays}</span>
                <span>{w.stockStaysMore}</span>
              </span>
            </Info>
          </div>
          <PrivateIssuerLine mint={stock.mint} facts={facts} />
          {line ? (
            <p className={t.note} data-tone={line.tone} role={line.tone === 'error' ? 'alert' : 'status'}>
              {line.text}
            </p>
          ) : null}
          {state.flow === 'buy' && where?.place === 'wallet' && (connection || shown) ? (
            <Quiet full disabled={state.stage !== null} onClick={() => connection && void useStockPrivate.getState().giveBack(connection.wallet, connection.address)}>
              {w.giveBack}
            </Quiet>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
