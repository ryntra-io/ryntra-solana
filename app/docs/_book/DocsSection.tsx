"use client";

import Link from "next/link";

import { ActionBody, Page, PageHead, Panel } from "@/terminal/ui";

import { CAPTIONS, docHref, neighbours, SECTIONS, sectionOf, UI, type Part, type SectionId } from "./book";
import b from "./book.module.css";
import { Disclosure, DocsBar, OpenLink, Shot, StateMark, useDocsLang, useDocsTabTitle } from "./parts";

/**
 * One section of the documentation (`/docs/<id>`): its name and one line, one frame of the live site with its caption,
 * what you can do, how in a few numbered steps, the honest limit on one line, what is coming, and the words it uses and
 * a few answers behind quiet disclosures; on the side the one action that opens the screen, the docs' first page and every
 * section.
 */
export function DocsSection({ id }: { id: SectionId }) {
  const lang = useDocsLang();
  useDocsTabTitle(id, lang);
  const u = UI[lang];
  const section = sectionOf(id);
  const w = section[lang];
  const { prev, next } = neighbours(id);
  const live = section.href !== null && section.group !== "trust";

  const side = (
    <div className={b.sideStack}>
      {section.href ? (
        <Panel tone="hi" pad="l" className={b.openPanel}>
          <OpenLink href={section.href}>{w.open}</OpenLink>
        </Panel>
      ) : null}
      <Panel pad="m" label={u.sections}>
        <nav className={b.toc} aria-label={u.sections}>
          {/* The way back to the docs' first page: the first line of the list, not a trail over the head. */}
          <Link href="/docs" className={b.tocLink}>
            {u.hubTitle}
          </Link>
          {SECTIONS.map((entry) => (
            <Link key={entry.id} href={docHref(entry.id)} className={b.tocLink} aria-current={entry.id === id ? "page" : undefined}>
              {entry[lang].title}
            </Link>
          ))}
          <Link href="/roadmap" className={b.tocLink}>
            {u.ahead}
          </Link>
        </nav>
      </Panel>
    </div>
  );

  return (
    <Page className={b.page} data-docs={id}>
      {/* The head stands where every screen's head stands, with no trail above it (the eyes' pass of 20.11). */}
      <DocsBar lang={lang} />
      <PageHead title={w.title} mark={live ? <StateMark live lang={lang} /> : undefined} />
      <ActionBody side={side} sideLabel={w.open}>
        <div className={b.mainStack}>
          <p className={b.lead}>{w.line}</p>
          {section.href ? (
            <OpenLink href={section.href} className={b.phoneOnly}>
              {w.open}
            </OpenLink>
          ) : null}

          {section.shot ? <Shot shot={section.shot} lang={lang} alt={u.shotAlt(w.title)} caption={CAPTIONS[lang][section.shot]} priority /> : null}

          {w.does.length > 0 ? (
            <section aria-labelledby="can-do">
              <h2 id="can-do" className={b.blockHead}>
                {u.canDo}
              </h2>
              <ul className={b.does}>
                {w.does.map((item) => (
                  <li key={item.title} className={b.doRow}>
                    <span className={b.doTitle}>{item.title}</span>
                    <span className={b.doLine}>{item.line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {w.how.length > 0 ? (
            <section aria-labelledby="how">
              <h2 id="how" className={b.blockHead}>
                {u.how}
              </h2>
              <ol className={b.steps}>
                {w.how.map((step, at) => (
                  <li key={step} className={b.step}>
                    <span className={b.stepNo} aria-hidden="true">
                      {at + 1}
                    </span>
                    <span className={b.stepLine}>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {w.honest ? (
            <p className={b.honest}>
              <span className={b.honestKick}>{u.honest}</span>
              <span>{w.honest}</span>
            </p>
          ) : null}

          {section.parts ? <Parts parts={section.parts} lang={lang} /> : null}

          {w.coming?.length ? (
            <section aria-labelledby="coming" className={b.comingBlock}>
              <h2 id="coming" className={b.blockHead}>
                {u.coming}
              </h2>
              <div className={b.chips}>
                {w.coming.map((name) => (
                  <span key={name} className={b.chip} data-coming="">
                    {name}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {w.more.length > 0 || w.words?.length ? (
            <section aria-label={u.more} className={b.moreList}>
              {w.words?.length ? (
                <Disclosure title={u.words}>
                  <dl className={b.words}>
                    {w.words.map((word) => (
                      <div key={word.title} className={b.word}>
                        <dt className={b.wordTerm}>{word.title}</dt>
                        <dd className={b.wordLine}>{word.line}</dd>
                      </div>
                    ))}
                  </dl>
                </Disclosure>
              ) : null}
              {w.more.map((item) => (
                <Disclosure key={item.title} title={item.title}>
                  {item.text.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </Disclosure>
              ))}
            </section>
          ) : null}

          <nav className={b.pager} aria-label={u.sections}>
            {prev ? (
              <Link href={docHref(prev)} className={b.pagerLink} rel="prev">
                <span className={b.pagerKick}>{u.prev}</span>
                <span>{sectionOf(prev)[lang].title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={docHref(next)} className={`${b.pagerLink} ${b.pagerNext}`} rel="next">
                <span className={b.pagerKick}>{u.next}</span>
                <span>{sectionOf(next)[lang].title}</span>
              </Link>
            ) : (
              <Link href="/roadmap" className={`${b.pagerLink} ${b.pagerNext}`}>
                <span className={b.pagerKick}>{u.next}</span>
                <span>{u.ahead}</span>
              </Link>
            )}
          </nav>
        </div>
      </ActionBody>
    </Page>
  );
}

/** The parts of a long section (Meteora): each its own frame, line and state; what it is made of behind «More». */
function Parts({ parts, lang }: { parts: readonly Part[]; lang: "en" | "uk" }) {
  const u = UI[lang];
  return (
    <ol className={b.parts}>
      {parts.map((part) => {
        const w = part[lang];
        return (
          <li key={part.key} className={b.part} id={part.key}>
            <div className={b.partHead}>
              <h2 className={b.partTitle}>{w.title}</h2>
              <StateMark live={part.live} lang={lang} />
            </div>
            <p className={b.doLine}>{w.line}</p>
            {part.shot ? <Shot shot={part.shot} lang={lang} alt={u.shotAlt(w.title)} caption={CAPTIONS[lang][part.shot]} /> : null}
            {w.more?.length || part.href ? (
              <div className={b.partFoot}>
                {w.more?.length ? (
                  <Disclosure title={u.more}>
                    {w.more.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </Disclosure>
                ) : null}
                {part.href ? (
                  <Link href={part.href} className={b.partOpen} prefetch={false}>
                    {u.open} →
                  </Link>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
