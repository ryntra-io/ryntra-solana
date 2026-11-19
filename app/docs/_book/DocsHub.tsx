"use client";

import Link from "next/link";

import { Page, Panel, QuietLink } from "@/terminal/ui";

import { AHEAD, docHref, GROUP_WORDS, SECTIONS, sectionOf, UI } from "./book";
import b from "./book.module.css";
import { DocsBar, OpenLink, Shot, useDocsLang } from "./parts";

/**
 * `/docs` — the first page a stranger reads: what Ryntra is in one line and one frame, the terminal's sections as
 * cards, Meteora as the wide one, trust, and where we are going.
 */
export function DocsHub() {
  const lang = useDocsLang();
  const u = UI[lang];
  const start = sectionOf("start")[lang];
  const meteora = sectionOf("meteora");
  const terminal = SECTIONS.filter((section) => section.group === "terminal");
  const trust = SECTIONS.filter((section) => section.group === "trust");

  return (
    <Page className={b.page} data-docs="hub">
      <DocsBar lang={lang} />

      <Panel tone="hi" pad="l" className={b.hero}>
        <div className={b.heroWords}>
          <p className={b.motto}>{u.motto}</p>
          <h1 className={b.heroTitle}>{u.hubTitle}</h1>
          <p className={b.lead}>{u.hubLine}</p>
          <div className={b.heroActs}>
            <OpenLink href="/docs/start" className={b.heroAct}>
              {u.start}
            </OpenLink>
          </div>
        </div>
        <Shot shot="market" lang={lang} alt={u.shotAlt(start.title)} priority className={b.heroShot} />
      </Panel>

      <section className={b.group} aria-labelledby="group-terminal">
        <h2 id="group-terminal" className={b.groupHead}>
          {GROUP_WORDS[lang].terminal}
        </h2>
        <ul className={b.cards}>
          {terminal.map((section) => (
            <li key={section.id}>
              <Link href={docHref(section.id)} className={b.card}>
                {section.shot ? <Shot shot={section.shot} lang={lang} alt="" className={b.cardShot} /> : null}
                <span className={b.cardTitle}>{section[lang].title}</span>
                <span className={b.cardLine}>{section[lang].line}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={b.group} aria-labelledby="group-meteora">
        <h2 id="group-meteora" className={b.groupHead}>
          {u.featured}
        </h2>
        <Link href={docHref("meteora")} className={b.feature}>
          <Shot shot="pro" lang={lang} alt="" className={b.featureShot} />
          <span className={b.featureWords}>
            <span className={b.featureTitle}>{meteora[lang].title}</span>
            <span className={b.cardLine}>{meteora[lang].line}</span>
            <span className={b.chips}>
              {(meteora.parts ?? []).map((part) => (
                <span key={part.key} className={b.chip} data-coming={part.live ? undefined : ""}>
                  {part[lang].title}
                </span>
              ))}
            </span>
          </span>
        </Link>
      </section>

      <section className={b.group} aria-labelledby="group-trust">
        <h2 id="group-trust" className={b.groupHead}>
          {GROUP_WORDS[lang].trust}
        </h2>
        <ul className={b.cardsTwo}>
          {trust.map((section) => (
            <li key={section.id}>
              <Link href={docHref(section.id)} className={b.card}>
                <span className={b.cardTitle}>{section[lang].title}</span>
                <span className={b.cardLine}>{section[lang].line}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className={b.group} aria-labelledby="group-ahead">
        <h2 id="group-ahead" className={b.groupHead}>
          {u.ahead}
        </h2>
        <Panel pad="l" className={b.ahead}>
          <ul className={b.aheadList}>
            {AHEAD[lang].map((item) => (
              <li key={item.title} className={b.aheadItem}>
                <span className={b.cardTitle}>{item.title}</span>
                <span className={b.cardLine}>{item.line}</span>
              </li>
            ))}
          </ul>
          <QuietLink href="/roadmap">{u.roadmap}</QuietLink>
        </Panel>
      </section>
    </Page>
  );
}
