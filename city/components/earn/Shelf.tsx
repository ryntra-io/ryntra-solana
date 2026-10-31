'use client';

import { HARBOR_OPEN } from '@/city/lib/districts/harbor/flag';
import { PRODUCTS, RISK, type ProductId } from '@/city/lib/earn/flag';
import { useEarn } from '@/city/lib/earn/open';
import type { Words } from '@/city/lib/earn/words';
import { RiskDots } from './bits';
import { useShelfContext } from './context';
import s from './earn.module.css';

/** The products that act now: the SOL Saver always, the SOL Pier where the Harbor's own switch is open. */
export function live(product: ProductId): boolean {
  return product === 'saver' || (product === 'pier' && HARBOR_OPEN);
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
        const acts = live(id);
        const open = () => (id === 'pier' && acts ? useEarn.getState().setTab('piers') : useEarn.getState().openProduct(id));
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
