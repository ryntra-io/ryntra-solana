"use client";

import Link from "next/link";

import { ActionBody, Page, PageHead, Panel } from "@/terminal/ui";

import { docHref, neighbours, SECTIONS, sectionOf, UI, type Part, type SectionId } from "./book";
import b from "./book.module.css";
import { Disclosure, DocsBar, OpenLink, Shot, StateMark, useDocsLang } from "./parts";

/**
 * One section of the documentation (`/docs/<id>`): its name and one line, one frame of the live site, what you can do,
 * what is coming and a few quiet disclosures; on the side the one action that opens the screen and every section.
 */
export function DocsSection({ id }: { id: SectionId }) {
  const lang = useDocsLang();
  const u = UI[lang];
  const section = sectionOf(id);
  const w = section[lang];
  const { prev, next } = neighbours(id);
  const live = section.href !== null && section.group !== "trust";

  const side = (
    <div className={b.sideStack}>
      {section.href ? (
        <Panel tone="hi" pad="l" className={b.openPanel}>
          <p className={b.sideLine}>{w.line}</p>
          <OpenLink href={section.href}>{w.open}</OpenLink>
        </Panel>
      ) : null}
      <Panel pad="m" label={u.sections}>
        <nav className={b.toc} aria-label={u.sections}>
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
      <DocsBar lang={lang} here={w.title} />
      <PageHead title={w.title} mark={live ? <StateMark live lang={lang} /> : undefined} />
      <ActionBody side={side} sideLabel={w.open}>
        <div className={b.mainStack}>
          <p className={b.lead}>{w.line}</p>
          {section.href ? (
            <OpenLink href={section.href} className={b.phoneOnly}>
              {w.open}
            </OpenLink>
          ) : null}

          {section.shot ? <Shot shot={section.shot} lang={lang} alt={u.shotAlt(w.title)} priority /> : null}

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

          {w.more.length > 0 ? (
            <section aria-label={u.more} className={b.moreList}>
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
            {part.shot ? <Shot shot={part.shot} lang={lang} alt={u.shotAlt(w.title)} /> : null}
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
