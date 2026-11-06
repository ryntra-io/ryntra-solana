'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { GUIDE } from '@/city/lib/learn/guide.generated';
import { useLearn } from '@/city/lib/learn/store';
import type { Block, Chapter, Line } from '@/city/lib/learn/types';
import l from './learn.module.css';
import { LEARN_WORDS } from './words';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * «Learn» (CITY-202): the chapters on the left, the chapter on the right — its reading time, a real frame of the live
 * city, one plain comparison, four steps, the chapter in one row, and «How it works inside» behind one quiet control.
 * A narrow window (the phone's sheet) shows one at a time: the list first, then the chapter with «All chapters».
 */
export default function LearnBody() {
  const lang = useLang();
  const w = useWords(LEARN_WORDS);
  const chapters = GUIDE[lang];
  const asked = useLearn((st) => st.chapter);
  const at = Math.max(0, chapters.findIndex((c) => c.slug === asked));
  const chapter = chapters[at]!;
  const scroller = useRef<HTMLDivElement>(null);
  // A new chapter opens at its top (braces: `scrollTo` returns a promise in newer browsers, and an effect returns none).
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [asked]);
  const go = (slug: string | null) => useLearn.getState().go(slug);
  return (
    <div className={l.body} data-learn="">
      <div className={l.grid} data-picked={asked ? '' : undefined}>
      <nav className={l.list} aria-label={w.chapters}>
        <div className={l.listHead}>
          <span className={`${l.display} ${l.kicker}`}>{w.kicker}</span>
        </div>
        <ol className={l.items}>
          {chapters.map((c, i) => (
            <li key={c.slug}>
              <button type="button" className={l.item} aria-current={i === at && asked !== null ? 'true' : undefined} data-here={i === at ? '' : undefined} onClick={() => go(c.slug)}>
                <span className={`${l.display} ${l.num}`}>{pad(c.n)}</span>
                <span className={l.itemTitle}>{c.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div ref={scroller} className={l.page}>
        <nav className={l.rail} aria-label={w.chapters}>
          <button type="button" className={l.railAll} aria-label={w.allChapters} onClick={() => go(null)}>
            <span className={l.backChevron} aria-hidden="true" />
          </button>
          {chapters.map((c, i) => (
            <button key={c.slug} type="button" className={`${l.display} ${l.railNum}`} aria-label={c.title} aria-current={i === at ? 'true' : undefined} onClick={() => go(c.slug)}>
              {pad(c.n)}
            </button>
          ))}
        </nav>
        <ChapterView key={`${lang}:${chapter.slug}`} chapter={chapter} prev={chapters[at - 1] ?? null} next={chapters[at + 1] ?? null} />
      </div>
      </div>
    </div>
  );
}

function ChapterView({ chapter, prev, next }: { chapter: Chapter; prev: Chapter | null; next: Chapter | null }) {
  const w = useWords(LEARN_WORDS);
  const [inside, setInside] = useState(false);
  const insideId = `city-learn-${chapter.slug}-inside`;
  const go = (slug: string | null) => useLearn.getState().go(slug);
  const shot = chapter.desk ?? chapter.phone;
  return (
    <article className={l.chapter} data-chapter={chapter.slug}>
      <header className={l.head}>
        <span className={`${l.display} ${l.kicker}`}>
          {w.chapter(chapter.n)} · {w.minutes(chapter.minutes)}
        </span>
        <h2 className={`${l.display} ${l.title}`}>{chapter.title}</h2>
        <p className={l.short}>{chapter.short}</p>
      </header>
      {shot && (
        <figure className={l.frame} data-tall={chapter.desk ? undefined : ''}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot} alt={w.shot(chapter.title)} decoding="async" />
        </figure>
      )}
      <blockquote className={l.analogy}>{chapter.analogy}</blockquote>
      <div role="group" aria-label={w.steps}>
        <ol className={l.steps}>
          {chapter.steps.map((step, i) => (
            <li key={i} className={l.step}>
              <span className={`${l.display} ${l.stepNum}`} aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <Runs line={step} />
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div role="group" aria-label={w.flow}>
        <ol className={l.flow}>
          {chapter.flow.map((node, i) => (
            <li key={node} className={l.node}>
              {i > 0 && <span className={l.arrow} aria-hidden="true" />}
              <span className={l.chip}>{node}</span>
            </li>
          ))}
        </ol>
      </div>
      <button type="button" className={l.details} aria-expanded={inside} aria-controls={insideId} onClick={() => setInside((v) => !v)}>
        {w.inside}
        <span className={l.chevron} aria-hidden="true" />
      </button>
      {inside && (
        <div id={insideId} className={l.inside}>
          {chapter.inside.map((part) => (
            <div key={part.heading} className={l.part}>
              <h3 className={`${l.display} ${l.partHead}`}>{part.heading}</h3>
              <Blocks blocks={part.blocks} />
            </div>
          ))}
          {chapter.honest.length > 0 && (
            <div className={l.part}>
              <h3 className={`${l.display} ${l.partHead}`}>{w.honest}</h3>
              <Blocks blocks={chapter.honest} />
            </div>
          )}
        </div>
      )}
      <footer className={l.foot}>
        {prev ? (
          <button type="button" className={l.prev} onClick={() => go(prev.slug)}>
            <span className={l.backChevron} aria-hidden="true" />
            {w.back}
          </button>
        ) : (
          <span />
        )}
        {next ? (
          <button type="button" className={`${l.display} ${l.next}`} onClick={() => go(next.slug)}>
            {w.next(next.title)}
          </button>
        ) : (
          <button type="button" className={`${l.display} ${l.next}`} onClick={() => useLearn.getState().hide()}>
            {w.done}
          </button>
        )}
      </footer>
    </article>
  );
}

function Runs({ line }: { line: Line }) {
  return (
    <>
      {line.map((run, i) =>
        run.t === 'b' ? (
          <strong key={i}>{run.v}</strong>
        ) : run.t === 'i' ? (
          <em key={i}>{run.v}</em>
        ) : run.t === 'c' ? (
          <code key={i} className={l.code}>
            {run.v}
          </code>
        ) : (
          <Fragment key={i}>{run.v}</Fragment>
        ),
      )}
    </>
  );
}

function Blocks({ blocks }: { blocks: readonly Block[] }) {
  return (
    <>
      {blocks.map((block, i) =>
        block.k === 'p' ? (
          <p key={i} className={l.p}>
            <Runs line={block.items[0] ?? []} />
          </p>
        ) : (
          (() => {
            const List = block.k === 'ol' ? 'ol' : 'ul';
            return (
              <List key={i} className={l.bullets}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Runs line={item} />
                  </li>
                ))}
              </List>
            );
          })()
        ),
      )}
    </>
  );
}
