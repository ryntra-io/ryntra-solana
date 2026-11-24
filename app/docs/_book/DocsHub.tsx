"use client";

import Link from "next/link";

import { Page, PageHead, Panel, QuietLink } from "@/terminal/ui";

import { AHEAD, docHref, GROUP_WORDS, QUICK, quoted, SAY_EXAMPLES, SECTIONS, sectionOf, UI } from "./book";
import b from "./book.module.css";
import { DocsBar, OpenLink, Shot, useDocsLang, useDocsTabTitle } from "./parts";

/**
 * `/docs` — the first page a stranger reads: what Ryntra is in one line and its one action, how to start in three steps,
 * sentences the agent understands, the terminal's sections as cards, Meteora as the wide one, trust, and where we are
 * going.
 */
export function DocsHub() {
  const lang = useDocsLang();
  useDocsTabTitle(null, lang);
  const u = UI[lang];
  const say = sectionOf("say")[lang];
  const meteora = sectionOf("meteora");
  const terminal = SECTIONS.filter((section) => section.group === "terminal");
  const trust = SECTIONS.filter((section) => section.group === "trust");

  return (
    <Page className={b.page} data-docs="hub">
      {/* Named by the page's own head, as every page of the terminal is (the eyes' pass of 19.11); the bar is there only where
          the terminal is shut, for its language. */}
      <DocsBar lang={lang} />
      <PageHead title={u.hubTitle} />

      {/* Words and the one action, no frame: a whole screen shrunk into half a card had type too small to read even on 1920
          and showed a phone's own menu over the phone's (the eyes' pass of 20.11). The frames live in the sections. */}
      <Panel tone="hi" pad="l" className={b.hero}>
        <h2 className={b.heroTitle}>{u.motto}</h2>
        <p className={b.lead}>{u.hubLine}</p>
        <div className={b.heroActs}>
          <OpenLink href="/docs/start" className={b.heroAct}>
            {u.start}
          </OpenLink>
        </div>
      </Panel>

      <section className={b.group} aria-labelledby="group-quick">
        <h2 id="group-quick" className={b.groupHead}>
          {u.quick}
        </h2>
        <ol className={b.quick}>
          {QUICK[lang].map((item, at) => (
            <li key={item.title} className={b.quickItem}>
              <span className={b.stepNo} aria-hidden="true">
                {at + 1}
              </span>
              <span className={b.cardTitle}>{item.title}</span>
              <span className={b.cardLine}>{item.line}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={b.group} aria-labelledby="group-say">
        <h2 id="group-say" className={b.groupHead}>
          {say.title}
        </h2>
        <Link href={docHref("say")} className={`${b.card} ${b.sayCard}`}>
          <span className={b.cardLine}>{say.line}</span>
          <ul className={b.sayList}>
            {SAY_EXAMPLES[lang].map((sentence) => (
              <li key={sentence} className={b.sayChip}>
                {quoted(sentence, lang)}
              </li>
            ))}
          </ul>
        </Link>
      </section>

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
