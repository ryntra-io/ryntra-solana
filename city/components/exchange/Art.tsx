'use client';

import type { ReactNode } from 'react';
import { artSrcSet, EXCHANGE_ART, type ExchangeArt } from '@/city/lib/exchange/art';
import s from './exchange.module.css';

/**
 * A still of the Exchange: decorative, so it says nothing to a screen reader. It loads with the window that shows it —
 * the window itself opens only on a tap — and fades in, so an empty frame never stands in its place.
 */
export function ArtImage({ art, className, sizes = '(min-width: 900px) 560px, 100vw' }: { art: ExchangeArt; className?: string; sizes?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={EXCHANGE_ART[art].small} srcSet={artSrcSet(art)} sizes={sizes} alt="" aria-hidden="true" loading="eager" decoding="async" draggable={false} />
  );
}

/** An empty or waiting state: the still, one title, at most one short line, and the one thing to do. */
export function ArtState({ art, title, line, children }: { art: ExchangeArt; title: string; line?: string; children?: ReactNode }) {
  return (
    <div className={s.artState}>
      <div className={s.artFrame}>
        <ArtImage art={art} className={s.artImage} />
      </div>
      <div className={`${s.display} ${s.title}`}>{title}</div>
      {line ? <div className={s.line}>{line}</div> : null}
      {children}
    </div>
  );
}
