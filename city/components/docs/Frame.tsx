'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronGlyph } from '@/city/components/pages/glyphs';
import type { DocsFrame } from '@/city/lib/docs/book';
import { docPath, searchHeadings, type Heading } from '@/city/lib/docs/model';
import type { NavGroup } from '@/city/lib/docs/nav';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import s from './docs.module.css';
import { DOCS_UI } from './words';

/** A still at the head of a page. */
export type Art = Readonly<{ src: string; srcSet: string; position?: string }>;

/**
 * The one frame of the documentation (CITY-180), the way a company's docs read: a still of our own city across the top, the same menu
 * at the left of every page, the text in the middle, the page's own contents at the right of a wide desk. On a phone, the same menu
 * behind one button. Sections, the hub and the site's own pages (Developers, AI chats, Help, the legal documents) all stand in it.
 */
export function DocsFrameView({ frame, current, currentTitle, art, toc, children }: { frame: DocsFrame; current?: string; currentTitle?: string; art: Art; toc?: ReactNode; children: ReactNode }) {
  const lang = useLang();
  return (
    <div className={s.frame} data-docs-frame="">
      <div className={s.band} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={s.art} src={art.src} srcSet={art.srcSet} sizes="100vw" alt="" decoding="async" fetchPriority="high" style={{ objectPosition: art.position }} />
      </div>
      <PhoneMenu frame={frame} current={current} title={currentTitle} />
      <div className={s.layout} data-toc={toc ? '' : undefined}>
        <aside className={s.side} data-words="">
          <Search index={frame.index[lang]} inSide>
            <NavList nav={frame.nav[lang]} current={current} />
          </Search>
        </aside>
        <div className={s.main}>{children}</div>
        {toc}
      </div>
    </div>
  );
}

export function SoonTag() {
  const w = useWords(DOCS_UI);
  return <span className={s.soonTag}>{w.soon}</span>;
}

function NavList({ nav, current }: { nav: readonly NavGroup[]; current?: string }) {
  const w = useWords(DOCS_UI);
  return (
    <nav aria-label={w.sectionsNav}>
      {nav.map((group) => (
        <div key={group.id} className={s.navGroup}>
          <span className={s.navTitle}>{group.title}</span>
          {group.items.map((item) => (
            <Link key={item.key} className={s.navLink} href={item.href} prefetch={false} aria-current={item.key === current ? 'page' : undefined} data-nav-item={item.key}>
              <span>{item.title}</span>
              {item.soon ? <SoonTag /> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** One field that searches every heading; with nothing typed, what stands under it stands as it was. */
export function Search({ index, inSide = false, children }: { index: readonly Heading[]; inSide?: boolean; children?: ReactNode }) {
  const w = useWords(DOCS_UI);
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchHeadings(index, query), [index, query]);
  const typed = query.trim().length > 0;
  return (
    <div className={s.search} data-side={inSide ? '' : undefined}>
      <div className={s.searchField}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="m13 13 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={w.searchHint} aria-label={w.search} data-docs-search="" />
        {typed ? (
          <button type="button" className={s.searchClear} onClick={() => setQuery('')} aria-label={w.clear}>
            ×
          </button>
        ) : null}
      </div>
      {typed ? (
        <div className={s.hits} data-docs-hits="">
          {hits.length === 0 ? (
            <p className={s.noHits}>
              {w.nothing}{' '}
              <Link href={docPath('help')} prefetch={false}>
                {w.nothingHelp}
              </Link>
            </p>
          ) : (
            hits.map((hit) => (
              <Link key={`${hit.href}-${hit.title}`} className={s.hit} href={`${hit.href}${hit.anchor ? `#${hit.anchor}` : ''}`} prefetch={false}>
                <span className={s.hitTitle}>{hit.title}</span>
                {hit.title === hit.sectionTitle ? null : <span className={s.hitSection}>{hit.sectionTitle}</span>}
              </Link>
            ))
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** On a phone: one bar above the text; it opens the search and the whole menu in one sheet. */
function PhoneMenu({ frame, title, current }: { frame: DocsFrame; title?: string; current?: string }) {
  const lang = useLang();
  const w = useWords(DOCS_UI);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button type="button" className={s.phoneBar} data-words="" aria-expanded={open} data-docs-menu="" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span className={s.phoneBarWord}>{w.sections}</span>
        {title ? <span className={s.phoneBarTitle}>{title}</span> : null}
        <span className={s.phoneBarChevron}>
          <ChevronGlyph />
        </span>
      </button>
      {open ? (
        <div className={s.sheet} role="dialog" aria-modal="true" aria-label={w.sectionsNav} data-words="" data-docs-sheet="">
          <div className={s.sheetHead}>
            <span className={`${s.display} ${s.kicker}`}>{w.sections}</span>
            <button type="button" className={s.sheetClose} onClick={() => setOpen(false)} aria-label={w.close}>
              ×
            </button>
          </div>
          <div className={s.sheetBody}>
            <Search index={frame.index[lang]}>
              <NavList nav={frame.nav[lang]} current={current} />
            </Search>
          </div>
        </div>
      ) : null}
    </>
  );
}
