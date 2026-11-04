'use client';

import Link from 'next/link';
import { DocumentShell } from '@/city/components/pages/DocumentPage';
import { ArrowGlyph, ChevronGlyph } from '@/city/components/pages/glyphs';
import { districtFrame, srcSet } from '@/city/lib/art/frames';
import type { DocsFrame } from '@/city/lib/docs/book';
import { docPath, hrefOf, parseInline, type Block, type DocSection, type Localized } from '@/city/lib/docs/model';
import { docArt, DOC_GROUP, DOC_NAMES, GROUP_WORDS, neighbours } from '@/city/lib/docs/sections';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { DocsFrameView, Search, SoonTag } from './Frame';
import s from './docs.module.css';
import { DOCS_UI } from './words';

/**
 * The documentation's own pages (CITY-180): the hub — a short opening and everything by group — and a section at its own address,
 * with the way to the next one at its foot. A place for reading: real text, but every step, figure and risk in its own block.
 */
export function DocsView({ frame, section }: { frame: DocsFrame; section: Localized<DocSection> | null }) {
  return (
    // A new section starts at the top of the page, not where the last one was left.
    <DocumentShell key={section?.en.id ?? 'hub'} doc="docs" current="docs" wide="docs">
      {section ? <SectionPage frame={frame} section={section} /> : <Hub frame={frame} />}
    </DocumentShell>
  );
}

const HUB_ART = districtFrame('market');

function Hub({ frame }: { frame: DocsFrame }) {
  const lang = useLang();
  const w = useWords(DOCS_UI);
  return (
    <DocsFrameView frame={frame} art={{ src: HUB_ART.files[0]!.src, srcSet: srcSet(HUB_ART) }}>
      <div className={s.hub} data-docs-hub="" data-words="">
        <header className={s.head}>
          <span className={`${s.display} ${s.kicker}`}>{w.kicker}</span>
          <h1 className={`${s.display} ${s.title}`}>{w.title}</h1>
          <p className={s.articleLead}>{w.lead}</p>
          <div className={s.heroActions}>
            <Link className={`${s.display} ${s.action}`} href={docPath('start')} prefetch={false}>
              {w.start}
            </Link>
            <Link className={s.quiet} href="/" prefetch={false}>
              {w.enterCity}
              <ArrowGlyph />
            </Link>
          </div>
        </header>
        <div className={s.hubSearch}>
          <Search index={frame.index[lang]} />
        </div>
        {frame.nav[lang].map((group) => (
          <section key={group.id} className={s.group}>
            <h2 className={`${s.display} ${s.groupTitle}`}>{group.title}</h2>
            <div className={s.cards}>
              {group.items.map((item) => (
                <Link key={item.key} className={s.card} href={item.href} prefetch={false} data-doc-card={item.key}>
                  <span className={s.cardTitle}>
                    {item.title}
                    {item.soon ? <SoonTag /> : <ChevronGlyph />}
                  </span>
                  <span className={s.cardLine}>{item.line}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
        <section className={s.group}>
          <h2 className={`${s.display} ${s.groupTitle}`}>{w.moreTitle}</h2>
          <div className={s.links}>
            {(
              [
                ['/build', w.build],
                ['/roadmap', w.roadmap],
              ] as const
            ).map(([href, label]) => (
              <Link key={href} className={s.linkChip} href={href} prefetch={false}>
                {label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </DocsFrameView>
  );
}

function SectionPage({ frame, section }: { frame: DocsFrame; section: Localized<DocSection> }) {
  const lang = useLang();
  const w = useWords(DOCS_UI);
  const doc = section[lang];
  const art = docArt(doc.id);
  const { previous, next } = neighbours(doc.id);
  return (
    <DocsFrameView
      frame={frame}
      current={doc.id}
      currentTitle={doc.title}
      art={{ src: art.files[0]!.src, srcSet: srcSet(art) }}
      toc={
        <nav className={s.toc} aria-label={w.onThisPage} data-words="">
          <span className={s.tocTitle}>{w.onThisPage}</span>
          {doc.parts.map((part) => (
            <a key={part.id} className={s.tocLink} href={`#${part.id}`}>
              {part.title}
            </a>
          ))}
        </nav>
      }
    >
      <article className={s.article} data-docs-section={doc.id} data-words="" lang={lang}>
        <header className={s.head}>
          <span className={`${s.display} ${s.kicker}`}>{GROUP_WORDS[lang][DOC_GROUP[doc.id]]}</span>
          <h1 className={`${s.display} ${s.title}`}>{doc.title}</h1>
          <p className={s.articleLead}>
            <Text text={doc.lead} />
          </p>
        </header>
        {doc.soon ? (
          <p className={s.soonBanner}>
            <SoonTag />
            <span>{w.soonLine}</span>
          </p>
        ) : null}
        {doc.parts.map((part) => (
          <section key={part.id} id={part.id} className={s.part}>
            <h2 className={s.partTitle}>{part.title}</h2>
            {part.blocks.map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
          </section>
        ))}
        {/* A section that is shut has no window to open yet: its action is the city itself. */}
        <Link className={`${s.display} ${s.action}`} data-wide="" href={doc.soon ? '/' : doc.action.href} prefetch={false}>
          {doc.soon ? w.enterCity : doc.action.label}
        </Link>
        <div className={s.related}>
          <span className={`${s.display} ${s.kicker}`}>{w.readNext}</span>
          <div className={s.links}>
            {doc.related.map((id) => (
              <Link key={id} className={s.linkChip} href={docPath(id)} prefetch={false}>
                {DOC_NAMES[lang][id].title}
              </Link>
            ))}
          </div>
        </div>
        <nav className={s.pager} aria-label={w.sectionsNav}>
          {previous ? (
            <Link className={s.pageLink} href={docPath(previous)} prefetch={false} rel="prev">
              <span className={s.pageWord}>{w.previous}</span>
              <span className={s.pageName}>{DOC_NAMES[lang][previous].title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link className={s.pageLink} data-next="" href={docPath(next)} prefetch={false} rel="next">
              <span className={s.pageWord}>{w.next}</span>
              <span className={s.pageName}>{DOC_NAMES[lang][next].title}</span>
            </Link>
          ) : null}
        </nav>
      </article>
    </DocsFrameView>
  );
}

function Text({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((piece, i) => {
        if (piece.kind === 'text') return <span key={i}>{piece.text}</span>;
        if (piece.kind === 'bold') return <b key={i}>{piece.text}</b>;
        return (
          <Link key={i} className={s.inlineLink} href={hrefOf(piece.where)} prefetch={false}>
            {piece.text}
          </Link>
        );
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  const w = useWords(DOCS_UI);
  const lang = useLang();
  switch (block.kind) {
    case 'p':
      return (
        <p className={s.p}>
          <Text text={block.text} />
        </p>
      );
    case 'steps':
      return (
        <ol className={s.steps}>
          {block.items.map((item, i) => (
            <li key={i} className={s.step}>
              <span className={`${s.display} ${s.stepNo}`} aria-hidden="true">
                {i + 1}
              </span>
              <span className={s.stepText}>
                <Text text={item} />
              </span>
            </li>
          ))}
        </ol>
      );
    case 'list':
      return (
        <ul className={s.list}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Text text={item} />
            </li>
          ))}
        </ul>
      );
    case 'rows':
      return (
        <dl className={s.rows}>
          {block.rows.map((row) => (
            <div key={row.label} className={s.row}>
              <dt>
                <span className={s.rowLabel}>{row.label}</span>
                {row.note ? (
                  <span className={s.rowNote}>
                    <Text text={row.note} />
                  </span>
                ) : null}
              </dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'cards':
      return (
        <div className={s.notes}>
          {block.items.map((item) => (
            <div key={item.title} className={s.note}>
              <h3 className={s.noteTitle}>{item.title}</h3>
              <p className={s.noteText}>
                <Text text={item.text} />
              </p>
            </div>
          ))}
        </div>
      );
    case 'qa':
      return (
        <div className={s.qa}>
          {block.items.map((item) => (
            <details key={item.q} className={s.qaItem}>
              <summary className={s.qaHead}>
                <h3 className={s.qaQuestion}>{item.q}</h3>
                <span className={s.qaChevron}>
                  <ChevronGlyph />
                </span>
              </summary>
              <p className={s.qaAnswer}>
                <Text text={item.a} />
              </p>
            </details>
          ))}
        </div>
      );
    case 'figure':
      return (
        <figure className={s.figure}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/city/docs/${block.shot}-${lang}.webp`} width={1280} height={800} alt={block.alt} loading="lazy" decoding="async" />
          <figcaption>{block.caption}</figcaption>
        </figure>
      );
    case 'sub':
      return (
        <section id={block.id} className={s.sub} data-soon={block.soon ? '' : undefined}>
          <h3 className={s.subTitle}>
            {block.title}
            {block.soon ? <SoonTag /> : null}
          </h3>
          {block.soon ? <p className={s.soonLine}>{w.soonLine}</p> : null}
          {block.blocks.map((inner, i) => (
            <BlockView key={i} block={inner} />
          ))}
        </section>
      );
  }
}
