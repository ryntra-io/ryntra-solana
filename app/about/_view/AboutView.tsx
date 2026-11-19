"use client";

import Link from "next/link";

import { CONTACTS, contactMailto } from "@/lib/site/contacts";
import { ActionBody, Page, PageHead, Panel } from "@/terminal/ui";

import b from "../../docs/_book/book.module.css";
import { DocsBar, OpenLink, useDocsLang } from "../../docs/_book/parts";

/** The page's words, English and Ukrainian. */
export const ABOUT_WORDS = {
  en: {
    title: "About Ryntra",
    motto: "Say it. Your agent does the rest.",
    line: "An AI terminal on Solana: the market, trading, launches, bots, agents and earning in one place.",
    open: "Open Ryntra",
    keysTitle: "Keys stay yours",
    keysLine: "Your wallet signs every move. Ryntra never sees your keys.",
    clearTitle: "Clear before you sign",
    clearLine: "What you get, the fee and the risk show before the signature.",
    solanaTitle: "Built on Solana",
    solanaLine: "Live market data, Jupiter for swaps, Meteora for launches and pools.",
    contact: "Contact",
    email: "Email",
    x: "Ryntra on X",
    security: "Security reports",
    more: "More",
    docs: "Docs",
    roadmap: "Roadmap",
    help: "Help",
  },
  uk: {
    title: "Про Ryntra",
    motto: "Скажи. Твій агент зробить решту.",
    line: "AI-термінал на Solana: ринок, торгівля, запуски, боти, агенти й заробіток — в одному місці.",
    open: "Відкрити Ryntra",
    keysTitle: "Ключі в тебе",
    keysLine: "Кожну дію підписує твій гаманець. Ryntra не бачить твоїх ключів.",
    clearTitle: "Ясно до підпису",
    clearLine: "Що отримаєш, комісію й ризик видно до підпису.",
    solanaTitle: "На Solana",
    solanaLine: "Живі дані ринку, Jupiter для обміну, Meteora для запусків і пулів.",
    contact: "Зв’язок",
    email: "Пошта",
    x: "Ryntra в X",
    security: "Звіти про вразливості",
    more: "Ще",
    docs: "Документи",
    roadmap: "Дорожня карта",
    help: "Допомога",
  },
} as const;

/**
 * `/about` in the terminal's frame and language: Ryntra in one line, three facts, how to reach it. The one
 * amber action opens the terminal.
 */
export function AboutView() {
  const lang = useDocsLang();
  const w = ABOUT_WORDS[lang];

  const side = (
    <div className={b.sideStack}>
      <Panel tone="hi" pad="l" className={b.openPanel}>
        <p className={b.sideLine}>{w.line}</p>
        <OpenLink href="/">{w.open}</OpenLink>
      </Panel>
      <Panel pad="m" label={w.more}>
        <nav className={b.toc} aria-label={w.more}>
          <Link href="/docs" className={b.tocLink}>
            {w.docs}
          </Link>
          <Link href="/roadmap" className={b.tocLink}>
            {w.roadmap}
          </Link>
          <Link href="/support" className={b.tocLink}>
            {w.help}
          </Link>
        </nav>
      </Panel>
    </div>
  );

  return (
    <Page className={b.page} data-docs="about">
      <DocsBar lang={lang} here={w.title} />
      <PageHead title={w.title} />
      <ActionBody side={side} sideLabel={w.open}>
        <div className={b.mainStack}>
          <p className={b.motto}>{w.motto}</p>
          <p className={b.lead}>{w.line}</p>
          <OpenLink href="/" className={b.phoneOnly}>
            {w.open}
          </OpenLink>
          <ul className={b.does}>
            {[
              [w.keysTitle, w.keysLine],
              [w.clearTitle, w.clearLine],
              [w.solanaTitle, w.solanaLine],
            ].map(([title, line]) => (
              <li key={title} className={b.doRow}>
                <span className={b.doTitle}>{title}</span>
                <span className={b.doLine}>{line}</span>
              </li>
            ))}
          </ul>
          <section aria-labelledby="contact">
            <h2 id="contact" className={b.blockHead}>
              {w.contact}
            </h2>
            <ul className={b.does}>
              <li className={b.doRow}>
                <span className={b.doTitle}>{w.email}</span>
                <a className={b.inlineLink} href={contactMailto()}>
                  {CONTACTS.email}
                </a>
              </li>
              <li className={b.doRow}>
                <span className={b.doTitle}>{w.x}</span>
                <a className={b.inlineLink} href={CONTACTS.companyX} target="_blank" rel="noreferrer">
                  @Ryntra_io
                </a>
              </li>
              <li className={b.doRow}>
                <span className={b.doTitle}>{w.security}</span>
                <a className={b.inlineLink} href="/.well-known/security.txt">
                  security.txt
                </a>
              </li>
            </ul>
          </section>
        </div>
      </ActionBody>
    </Page>
  );
}
