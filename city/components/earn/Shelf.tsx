'use client';

import { PRODUCTS, RISK, type ProductId } from '@/city/lib/earn/flag';
import { useEarn } from '@/city/lib/earn/open';
import { LIMIT_MODE } from '@/city/lib/earn/limit-gate';
import { PIER_MODE } from '@/city/lib/earn/pier-gate';
import { STOCK_PIER_MODE } from '@/city/lib/earn/stock-pier-gate';
import { DOLLAR_OPEN } from '@/city/lib/earn/dollar-gate';
import type { Words } from '@/city/lib/earn/words';
import { RiskDots } from './bits';
import { useShelfContext } from './context';
import s from './earn.module.css';

/**
 * The products that act now: the SOL Saver always, the SOL Pier where the Harbor's own switch is open, Sell Higher and
 * the Stock Pier and the Dollar Saver (CITY-192, `NEXT_PUBLIC_RYNTRA_CITY_EARN_DOLLAR`) where each one's own switch is open (under a canary each looks as it does closed — the canary is not
 * announced).
 */
export function live(product: ProductId): boolean {
  return (
    product === 'saver' ||
    (product === 'dollar' && DOLLAR_OPEN) ||
    (product === 'pier' && PIER_MODE === 'open') ||
    (product === 'sell' && LIMIT_MODE === 'open') ||
    (product === 'stockpier' && STOCK_PIER_MODE === 'open')
  );
}

/**
 * The Shelf: one card per product — its name, one big live number, its risk in dots and one action. A product that
 * does not act yet is a real card all the same; it opens a calm window with its live context and «tell me when».
 */
export function Shelf({ words }: { words: Words }) {
  const context = useShelfContext();
  return (
    <section className={s.shelf} aria-label={words.tabs.shelf}>
      {PRODUCTS.map((id) => {
        const w = words.products[id];
        const big = context[id];
        // «Like the Captain» acts once a strategy has a proven record and the Harbor takes copies.
        const acts = live(id) || (id === 'captain' && PIER_MODE === 'open' && big !== null);
        // The SOL Pier is the Piers tab itself: its piers read and shown even while the Harbor is closed.
        const open = () => (id === 'pier' ? useEarn.getState().setTab('piers') : useEarn.getState().openProduct(id));
        return (
          <article key={id} className={`${s.card} ${acts ? s.cardLive : ''}`} data-earn-product={id}>
            <button type="button" className={s.cardHit} onClick={open} aria-label={w.name} />
            <div className={s.cardHead}>
              <h3 className={`${s.display} ${s.cardName}`}>{w.name}</h3>
              <RiskDots dots={RISK[id]} words={words} />
            </div>
            <div className={s.cardBig}>
              {big ? (
                <>
                  <b className={s.display}>{big.value}</b>
                  <span>{big.unit ? `${big.unit} · ${w.context}` : w.context}</span>
                </>
              ) : (
                <span className={s.cardLine}>{w.line}</span>
              )}
            </div>
            {big ? <p className={s.cardLine}>{w.line}</p> : null}
            <button type="button" className={`${s.display} ${acts ? s.action : s.secondary} ${s.cardAction}`} onClick={open}>
              {acts ? w.action : words.open}
            </button>
          </article>
        );
      })}
    </section>
  );
}
