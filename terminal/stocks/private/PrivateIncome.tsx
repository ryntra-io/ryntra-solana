'use client';

import { useEffect } from 'react';

import { digits, num, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { formatUnits } from '@/city/lib/trade/format';
import { useWallet } from '@/city/lib/trade/wallet';
import { STOCK_BAND } from '@/lib/privacy/stocks/band';
import { backCoinOf, splitIncome } from '@/lib/privacy/stocks/plan';
import { useStockPrivate } from '@/lib/privacy/stocks/useStockPrivate';
import { useStockPoolFacts } from '@/terminal/stocks/useStockPoolFacts';
import { Info, PrivacyBand, PrivacyToggle, Quiet, privateModeOpen, usePrivateMode } from '@/terminal/ui';
import { STOCK_SCOPE, type ShownFlow } from './PrivateStockBuy';
import { flowLine, incomeClaimOf, type ReviewLike, type Units } from './view';
import { PRIVATE_STOCK } from './words';
import t from '@/terminal/coin/ticket.module.css';
import x from './private.module.css';

/** A side of a position as the position's ticket names it: the coin, its ticker, its unclaimed fees in its own unit. */
export type IncomeSideView = Readonly<{ mint: string; symbol: string; unclaimed: number }>;

/** A stand's toggle shows its state and changes nothing. */
const standToggle = () => undefined;

/** The network the pool's engine builds its Review for. */
const POOL_CHAIN = 'solana:mainnet';

/** The decimals of the coins income goes back in: SOL and USDC. */
const BACK_DECIMALS = { sol: 9, usdc: 6 } as const;

/**
 * Whether a position's ticket offers «Fees to private balance»: the build has the private mode, one side of the pool is
 * SOL or USDC and the other a checked stock; and whether the person turned it on. The stock's facts are read only where
 * the pool has such a pair.
 */
export function usePrivateIncome(xMint: string, yMint: string): Readonly<{ offered: boolean; on: boolean }> {
  const [mode] = usePrivateMode(STOCK_SCOPE);
  const xBack = backCoinOf(xMint) !== null;
  const yBack = backCoinOf(yMint) !== null;
  const pair = privateModeOpen() && xBack !== yBack;
  const facts = useStockPoolFacts(pair ? (xBack ? yMint : xMint) : null);
  const offered = pair && facts?.isStock === true;
  return { offered, on: offered && mode === 'private' };
}

const incomeUnits = (symbol: (mint: string) => string): Units => ({
  amount: (raw, mint) => {
    const coin = backCoinOf(mint);
    return digits(coin ? formatUnits(raw.toString(), BACK_DECIMALS[coin], 'down') : raw.toString());
  },
  symbol,
});

/** Takes the position's fees by the engine's own Review and puts their SOL or USDC side into the private balance. */
export function startPrivateIncome(review: ReviewLike, xMint: string, yMint: string, wallet: string, owner: string): void {
  const claim = incomeClaimOf(review, xMint, yMint, POOL_CHAIN);
  if (claim) void useStockPrivate.getState().income(claim, wallet, owner);
}

/**
 * «Fees to private balance» in a stock pool's position ticket, above its one amber button: the toggle
 * «Public ⇄ Private» on its own row; with «Private» on, the band «what others see» for a deposit (all four seen) and its
 * one line, «i» saying that only SOL and USDC fees go private and the stock's part stays in the wallet; that part, in one
 * line, when the position has any; where the fees are after the press, from the chain; and one quiet «Return to private
 * balance» only when a break left them on the wallet. The button is the ticket's own. `shown` — a stand's flow in place
 * of the live one.
 */
export function PrivateIncomePart({ x: xs, y: ys, review, on, shown }: { x: IncomeSideView; y: IncomeSideView; review: ReviewLike | null; on: boolean; shown?: ShownFlow }) {
  const w = useWords(PRIVATE_STOCK);
  const lang = useLang();
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const live = useStockPrivate();
  const state = shown ?? live;
  const where = state.where;

  useEffect(() => {
    if (!owner || !on || shown || state.flow !== 'income' || where?.place !== 'landing') return;
    const timer = setTimeout(() => void useStockPrivate.getState().reread(owner), 4_000);
    return () => clearTimeout(timer);
  }, [owner, on, shown, state.flow, where]);

  const symbol = (mint: string) => (mint === xs.mint ? xs.symbol : mint === ys.mint ? ys.symbol : '');
  const claim = incomeClaimOf(review, xs.mint, ys.mint, POOL_CHAIN);
  const back = claim ? splitIncome(claim.shown).back : null;
  const stock = backCoinOf(xs.mint) === null ? xs : ys;
  const line = on ? flowLine('income', state, w, incomeUnits(symbol), { back }) : null;
  return (
    <div className={x.part} data-private-income={on ? 'private' : 'open'}>
      <div className={x.mode}>
        {/* A stand holds the toggle with its own state; a ticket's toggle is the remembered mode itself. */}
        <PrivacyToggle scope={STOCK_SCOPE} {...(shown ? { on, onChange: standToggle } : {})} />
      </div>
      {on ? (
        <>
          <PrivacyBand action={STOCK_BAND.income} />
          <div className={x.line}>
            <span className={t.note} data-tone="info">
              {w.incomeSeen}
            </span>
            <Info label={w.incomeLabel}>
              <span className={x.how}>
                <span>{w.incomeWhy}</span>
              </span>
            </Info>
          </div>
          {stock.unclaimed > 0 ? (
            <p className={t.note} data-tone="info">
              {w.incomeStays(num(stock.unclaimed, { maximumFractionDigits: 6 }, lang), stock.symbol)}
            </p>
          ) : null}
          {line ? (
            <p className={t.note} data-tone={line.tone} role={line.tone === 'error' ? 'alert' : 'status'}>
              {line.text}
            </p>
          ) : null}
          {state.flow === 'income' && where?.place === 'wallet' && (connection || shown) ? (
            <Quiet full disabled={state.stage !== null} onClick={() => connection && void useStockPrivate.getState().giveBack(connection.wallet, connection.address)}>
              {w.giveBack}
            </Quiet>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
