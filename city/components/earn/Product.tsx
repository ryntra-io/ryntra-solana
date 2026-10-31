'use client';

import { RISK, type ProductId } from '@/city/lib/earn/flag';
import { useEarn } from '@/city/lib/earn/open';
import type { DistrictId } from '@/city/lib/art/frames';
import type { Words } from '@/city/lib/earn/words';
import { BackGlyph, CityFrame, Notify, RiskDots } from './bits';
import { useShelfContext } from './context';
import s from './earn.module.css';

/** Each product's frame of the live city: where it will stand. */
const FRAME: Readonly<Record<ProductId, DistrictId>> = {
  saver: 'harbor',
  pier: 'harbor',
  dollar: 'vault',
  sell: 'market',
  stocks: 'vault',
  captain: 'harbor',
};

/**
 * A product of the Shelf that does not act yet, as a calm window: a frame of the live city, the product's name and
 * line, its live context at full size, and one switch — «tell me when it opens». Nothing to sign, nothing promised.
 */
export function Product({ id, words }: { id: ProductId; words: Words }) {
  const w = words.products[id];
  const big = useShelfContext()[id];
  return (
    <section className={s.product} aria-label={w.name}>
      <button type="button" className={s.back} onClick={() => useEarn.getState().openProduct(null)}>
        <BackGlyph />
        {words.back}
      </button>
      <CityFrame district={FRAME[id]} />
      <div className={s.cardHead}>
        <h3 className={`${s.display} ${s.productName}`}>{w.name}</h3>
        <RiskDots dots={RISK[id]} words={words} />
      </div>
      <p className={s.lead}>{w.line}</p>
      {big ? (
        <div className={s.context}>
          <span className={s.kicker}>{w.context}</span>
          <b className={`${s.display} ${s.contextFigure}`}>{big.value}</b>
          {big.unit ? <span className={s.contextUnit}>{big.unit}</span> : null}
        </div>
      ) : null}
      <div className={s.grow} />
      <Notify product={id} words={words} />
    </section>
  );
}
