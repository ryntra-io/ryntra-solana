'use client';

import Link from 'next/link';
import { createContext, useContext, type ReactNode } from 'react';
import { PAGE_ART, pagePath, type PageId } from '@/city/lib/pages/pages';
import { openPage } from '@/city/lib/pages/store';
import { ChevronGlyph } from './glyphs';
import s from './pages.module.css';

/**
 * The pieces every page of the city is made of (CITY-157). A page's contents are written once: inside a window of the
 * city (a window on a computer, the bottom sheet on a phone) and as a page of its own at its address. `Where` tells a
 * piece which one it stands in, so a link to another page opens that page's window in the city, or goes to its
 * address on a page. At its address a page stands in the documentation's frame (`doc`), whose head is plain words.
 */
export type Where = 'window' | 'page' | 'doc';

const WhereContext = createContext<Where>('page');

export function WhereProvider({ where, children }: { where: Where; children: ReactNode }) {
  return <WhereContext.Provider value={where}>{children}</WhereContext.Provider>;
}

export function useWhere(): Where {
  return useContext(WhereContext);
}

/** A door to another of the city's pages: its window in the city, its address on a page. */
export function PageDoor({ id, hash, className, children }: { id: PageId; hash?: string; className?: string; children: ReactNode }) {
  const where = useWhere();
  if (where === 'window') {
    return (
      <button type="button" className={className} onClick={() => openPage(id, hash)}>
        {children}
      </button>
    );
  }
  return (
    <Link className={className} href={`${pagePath(id)}${hash ? `#${hash}` : ''}`} prefetch={false}>
      {children}
    </Link>
  );
}

/** The scroller every page's contents stand in. */
export function PageFrame({ id, children }: { id: PageId; children: ReactNode }) {
  const where = useWhere();
  return (
    <div className={s.body} data-where={where} data-city-page={id}>
      {children}
    </div>
  );
}

/**
 * The head of a page: a still of our own city at night fading into the glass, the kicker and the title on it. The
 * still never starts invisible, so a slow frame never shows an empty head.
 */
export function Hero({ id, kicker, title, children }: { id: PageId; kicker: string; title: string; children?: ReactNode }) {
  const art = PAGE_ART[id];
  const where = useWhere();
  if (where === 'doc') {
    return (
      <header className={s.docHead} data-words="">
        <span className={`${s.display} ${s.kicker}`}>{kicker}</span>
        <h1 className={`${s.display} ${s.title}`}>{title}</h1>
        {children}
      </header>
    );
  }
  return (
    <header className={s.hero}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={s.art}
        src={art.small}
        srcSet={`${art.small} 800w, ${art.large} 1600w`}
        sizes={where === 'window' ? '(min-width: 900px) 560px, 100vw' : '100vw'}
        style={{ objectPosition: art.position }}
        alt=""
        decoding="async"
        fetchPriority={where === 'page' ? 'high' : 'auto'}
      />
      <div className={s.heroBody} data-words="">
        <span className={`${s.display} ${s.kicker}`}>{kicker}</span>
        {where === 'page' ? <h1 className={`${s.display} ${s.title}`}>{title}</h1> : <h2 className={`${s.display} ${s.title}`}>{title}</h2>}
        {children}
      </div>
    </header>
  );
}

/** One quiet disclosure: closed, a row with its name and a chevron; open, what it hides. */
export function More({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className={s.more}>
      <summary className={s.moreHead}>
        <span>{label}</span>
        <span className={s.moreChevron}>
          <ChevronGlyph />
        </span>
      </summary>
      <div className={s.moreBody}>{children}</div>
    </details>
  );
}

/** A tile: a short title and one line. A door when it opens another page. */
export function Tile({ title, line, door }: { title: string; line: string; door?: PageId }) {
  const inner = (
    <>
      <span className={s.tileTitle}>
        {title}
        {door ? (
          <span className={s.tileChevron}>
            <ChevronGlyph />
          </span>
        ) : null}
      </span>
      <span className={s.tileLine}>{line}</span>
    </>
  );
  return door ? (
    <PageDoor id={door} className={`${s.tile} ${s.tileDoor}`}>
      {inner}
    </PageDoor>
  ) : (
    <div className={s.tile}>{inner}</div>
  );
}
