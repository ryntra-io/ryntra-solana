'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { pageOfHref } from '@/city/lib/pages/pages';
import { openPage, usePages } from '@/city/lib/pages/store';
import { CONTACTS, contactMailto } from '@/lib/site/contacts';
import type { LegalBlock, LegalLine } from '@/lib/legal/texts/model';
import { privacyPolicy } from '@/lib/legal/texts/privacy';
import { termsOfUse } from '@/lib/legal/texts/terms';
import { ChevronGlyph } from './glyphs';
import { Hero, PageFrame, useWhere } from './parts';
import s from './pages.module.css';
import { LEGAL } from './words';

/**
 * The Terms of Use and the Privacy Policy in the city (CITY-157): the published words, exactly (`lib/legal/texts/*`),
 * in the city's look. The title, the date and the opening stand in view; each numbered section opens on a tap, and
 * «Open all» opens every one. The whole text is in the page either way, so a search engine, a store's reviewer and the
 * browser's «Find» read all of it. An address with an anchor (`/legal/privacy#android`, the store's link) opens that
 * section and brings it into view; so does a link between the two documents.
 */
export function LegalBody({ id }: { id: 'terms' | 'privacy' }) {
  const lang = useLang();
  const doc = useMemo(() => (id === 'terms' ? termsOfUse(lang) : privacyPolicy(lang)), [id, lang]);
  const w = useWords(LEGAL);
  const where = useWhere();
  const root = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const all = opened.size === doc.sections.length;

  /** Opens one section and brings it into view, in the window or on the page. */
  const reveal = useCallback(
    (hash: string) => {
      const section = doc.sections.find((sec) => sec.id === hash);
      if (!section) return false;
      setOpened((prev) => new Set(prev).add(section.id));
      requestAnimationFrame(() => root.current?.querySelector(`#${CSS.escape(section.id)}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      return true;
    },
    [doc],
  );

  // On a page: the address's anchor, now and whenever it changes.
  useEffect(() => {
    if (where === 'window') return;
    const read = () => void reveal(decodeURIComponent(location.hash.slice(1)));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [where, reveal]);

  // In a window: the anchor it was opened on.
  const anchor = usePages((st) => (st.anchor?.id === id ? st.anchor : null));
  useEffect(() => {
    if (where === 'window' && anchor) reveal(anchor.hash);
  }, [where, anchor, reveal]);

  // A link inside the text: its own anchor opens its section; the other document opens as its window in the city.
  const follow = (event: MouseEvent<HTMLDivElement>) => {
    const a = (event.target as Element).closest?.('a[href]');
    if (!a || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      if (where === 'window') {
        event.preventDefault();
        reveal(href.slice(1));
      }
      return;
    }
    const page = where === 'window' ? pageOfHref(href) : null;
    if (page) {
      event.preventDefault();
      openPage(page.id, page.hash);
    }
  };

  return (
    <PageFrame id={id}>
      <Hero id={id} kicker={w.kicker} title={doc.title}>
        <span className={s.effective} lang="en">
          {doc.effective}
        </span>
      </Hero>
      <div ref={root} className={s.legal} lang="en" onClick={follow}>
        {doc.intro.map((block, i) => (
          <Block key={i} block={block} lang={block.lang} />
        ))}
        <div className={s.legalBar}>
          <button type="button" className={s.quiet} data-words="" aria-pressed={all} onClick={() => setOpened(all ? new Set() : new Set(doc.sections.map((sec) => sec.id)))}>
            {all ? w.closeAll : w.openAll}
          </button>
        </div>
        <div className={s.sections}>
          {doc.sections.map((section) => (
            <details
              key={section.id}
              id={section.id}
              className={s.section}
              lang={section.lang}
              open={opened.has(section.id)}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setOpened((prev) => {
                  if (prev.has(section.id) === open) return prev;
                  const next = new Set(prev);
                  if (open) next.add(section.id);
                  else next.delete(section.id);
                  return next;
                });
              }}
            >
              <summary className={s.sectionHead}>
                <h3 className={s.sectionTitle}>{section.heading}</h3>
                <span className={s.moreChevron}>
                  <ChevronGlyph />
                </span>
              </summary>
              <div className={s.sectionBody}>
                {section.blocks.map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </div>
            </details>
          ))}
        </div>
        <p className={s.legalFoot} data-words="" lang={lang}>
          <span>{w.questions}</span>
          <a href={contactMailto()}>{CONTACTS.email}</a>
        </p>
      </div>
    </PageFrame>
  );
}

function Block({ block, lang }: { block: LegalBlock; lang?: string }) {
  if (block.kind === 'p') return <p lang={lang}>{runs(block.line)}</p>;
  return (
    <ul lang={lang}>
      {block.items.map((item, i) => (
        <li key={i}>{runs(item)}</li>
      ))}
    </ul>
  );
}

function runs(line: LegalLine): ReactNode[] {
  return line.map((run, i) => {
    if (typeof run === 'string') return run;
    if ('strong' in run) return <strong key={i}>{run.strong}</strong>;
    // The site's own address opens beside the document, never in place of it.
    const away = /^https?:/.test(run.href);
    return (
      <a key={i} href={run.href} target={away ? '_blank' : undefined} rel={away ? 'noopener' : undefined}>
        {run.link}
      </a>
    );
  });
}

