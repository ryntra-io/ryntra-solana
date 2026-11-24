"use client";

import Link from "next/link";

import { CONTACTS, contactMailto } from "@/lib/site/contacts";
import { ActionBody, Page, PageHead, Panel } from "@/terminal/ui";

import b from "../../docs/_book/book.module.css";
import { DocsBar, LinkList, useDocsLang } from "../../docs/_book/parts";

/** The page's words, English and Ukrainian. */
export const ABOUT_WORDS = {
  en: {
    title: "About Ryntra",
    motto: "Say it. Your agent does the rest.",
    line: "An AI terminal on Solana: the market, trading, launches, bots, agents and earning in one place.",
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
    securityWrite: "Write to us in Help",
    more: "More",
    docs: "Docs",
    roadmap: "Roadmap",
    help: "Help",
    legal: "Legal",
    terms: "Terms of Use",
    privacy: "Privacy Policy",
  },
  uk: {
    title: "Про Ryntra",
    motto: "Скажи. Твій агент зробить решту.",
    line: "AI-термінал на Solana: ринок, торгівля, запуски, боти, агенти й заробіток — в одному місці.",
    keysTitle: "Ключі в тебе",
    keysLine: "Кожну дію підписує твій гаманець. Ryntra не бачить твоїх ключів.",
    clearTitle: "Усе видно до підпису",
    clearLine: "Що отримаєш, комісію й ризик видно до підпису.",
    solanaTitle: "На Solana",
    solanaLine: "Живі дані ринку, Jupiter для обміну, Meteora для запусків і пулів.",
    contact: "Зв’язок",
    email: "Пошта",
    x: "Ryntra в X",
    security: "Звіти про вразливості",
    securityWrite: "Напиши нам у «Допомозі»",
    more: "Ще",
    docs: "Документація",
    roadmap: "Дорожня карта",
    help: "Допомога",
    legal: "Правове",
    terms: "Умови використання",
    privacy: "Політика приватності",
  },
} as const;

/**
 * `/about` in the terminal's frame and language: Ryntra in one line, three facts, how to reach it; at its
 * foot the Terms and the Privacy Policy; on the side the doors to the docs, the roadmap and Help. No amber
 * action and no second copy of the line: the reader is already in the terminal (the eyes' pass of 20.11).
 */
export function AboutView() {
  const lang = useDocsLang();
  const w = ABOUT_WORDS[lang];

  const side = (
    <Panel pad="m">
      <LinkList
        title={w.more}
        links={[
          { href: "/docs", label: w.docs },
          { href: "/roadmap", label: w.roadmap },
          { href: "/support", label: w.help },
        ]}
      />
    </Panel>
  );

  return (
    <Page className={b.page} data-docs="about">
      <DocsBar lang={lang} />
      <PageHead title={w.title} />
      <ActionBody side={side} sideLabel={w.more}>
        <div className={b.mainStack}>
          <p className={b.motto}>{w.motto}</p>
          <p className={b.lead}>{w.line}</p>
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
                <Link className={b.inlineLink} href="/support?topic=security">
                  {w.securityWrite}
                </Link>
              </li>
            </ul>
          </section>
          <nav className={b.footLinks} aria-label={w.legal}>
            <Link href="/legal/terms" className={b.inlineLink}>
              {w.terms}
            </Link>
            <Link href="/legal/privacy" className={b.inlineLink}>
              {w.privacy}
            </Link>
          </nav>
        </div>
      </ActionBody>
    </Page>
  );
}
