'use client';

import Link from 'next/link';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { BRAND } from '@/city/lib/brand';
import type { DocsFrame } from '@/city/lib/docs/book';
import { pageKey } from '@/city/lib/docs/nav';
import { useWords } from '@/city/lib/i18n/dict';
import { hydrateLang, LANG_LABEL, LANGS, setLang, useLang } from '@/city/lib/i18n/lang';
import { PAGE_ART, PAGE_IDS, pagePath, SITE_DOC_PATHS, SITE_DOCS, type PageId, type SiteDocId } from '@/city/lib/pages/pages';
import { CONTACTS } from '@/lib/site/contacts';
import { DocsFrameView } from '../docs/Frame';
import { Mark } from '../hud/Mark';
import { BackGlyph, XGlyph } from './glyphs';
import PageBody from './PageBody';
import { WhereProvider } from './parts';
import s from './pages.module.css';
import { PAGES } from './words';
import { PAGE_NAMES } from '@/city/lib/docs/sections';

/**
 * One of the city's pages at its own address (CITY-157): `/docs`, `/developers`, `/support` and `/feedback`, `/about`,
 * `/legal/terms`, `/legal/privacy`. The same contents as the window the menu opens, standing alone — the mark and the
 * way back into the city on top, the language, the documentation's one menu beside it (CITY-180), the other pages at the foot. The server paints English with every
 * word in the page (a store's reviewer and a search engine read it whole); the person's language follows at once.
 */
export function DocumentPage({ id, frame }: { id: PageId; frame: DocsFrame }) {
  const lang = useLang();
  const art = PAGE_ART[id];
  return (
    <DocumentShell doc={id} current={id} wide="docs">
      <DocsFrameView frame={frame} current={pageKey(id)} currentTitle={id === 'docs' ? undefined : PAGE_NAMES[lang][id].title} art={{ src: art.small, srcSet: `${art.small} 800w, ${art.large} 1600w`, position: art.position }}>
        <WhereProvider where="doc">
          <PageBody id={id} />
        </WhereProvider>
      </DocsFrameView>
    </DocumentShell>
  );
}

/**
 * The page around a city page's contents: the bar with the mark, the language and the way back into the city, and the
 * other pages at the foot — «What we're building», «Partners» and the roadmap first (CITY-177), then the city's pages.
 * «How it works» (CITY-43, `/how-it-works`) stands in the same shell, with no page current; «What we're building» and
 * the partner page stand in it with their own.
 */
export function DocumentShell({ doc, current, wide = false, children }: { doc: string; current?: PageId | SiteDocId; wide?: boolean | 'docs'; children: ReactNode }) {
  // The person's language before the first paint after hydration (CITY-79).
  useLayoutEffect(() => void hydrateLang(), []);
  const w = useWords(PAGES);
  const lang = useLang();
  // Past the still, the bar turns solid.
  const [solid, setSolid] = useState(false);
  return (
    <div className={s.scroller} data-city-doc={doc} onScroll={(event) => setSolid(event.currentTarget.scrollTop > 120)}>
      <div className={s.bar} data-solid={solid ? '' : undefined} data-doc-bar="">
        <Link className={s.brand} href="/" prefetch={false} aria-label={w.backToCity}>
          <Mark size={32} />
          <span className={`${s.display} ${s.brandName}`} aria-hidden="true">
            {BRAND.name}
          </span>
        </Link>
        <div className={`${s.glass} ${s.langPair}`} role="group" aria-label={w.language}>
          {LANGS.map((code) => (
            <button key={code} type="button" lang={code} aria-pressed={lang === code} onClick={() => lang !== code && setLang(code)}>
              {LANG_LABEL[code]}
            </button>
          ))}
        </div>
        <Link className={`${s.glass} ${s.back}`} href="/" prefetch={false}>
          <BackGlyph />
          <span className={s.backWords} data-words="">
            {w.backToCity}
          </span>
        </Link>
      </div>
      <main className={s.docMain}>{children}</main>
      <footer className={s.foot} data-doc-foot="" data-wide={wide === 'docs' ? 'docs' : wide ? '' : undefined}>
        <nav className={s.footNav} aria-label={w.pagesNav} data-words="">
          {SITE_DOCS.map((page) => (
            <Link key={page} className={`${s.footLink} ${s.footLinkMain}`} href={SITE_DOC_PATHS[page]} prefetch={false} aria-current={page === current ? 'page' : undefined}>
              {w[page]}
            </Link>
          ))}
          {/* The documentation's menu already lists these pages. */}
          {wide === 'docs'
            ? null
            : PAGE_IDS.map((page) => (
                <Link key={page} className={s.footLink} href={pagePath(page)} prefetch={false} aria-current={page === current ? 'page' : undefined}>
                  {w[page]}
                </Link>
              ))}
          <a className={s.footLink} href={CONTACTS.companyX} target="_blank" rel="noopener">
            <XGlyph />
            {w.onX}
          </a>
        </nav>
      </footer>
    </div>
  );
}
