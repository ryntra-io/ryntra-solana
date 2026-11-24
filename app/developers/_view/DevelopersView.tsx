"use client";

import { useEffect, useState } from "react";

import { API_BASE, DEV_ROWS } from "@/city/lib/pages/developers";
import { Action, ActionBody, Page, PageHead, Panel } from "@/terminal/ui";

import b from "../../docs/_book/book.module.css";
import { UI } from "../../docs/_book/book";
import { Disclosure, DocsBar, LinkList, useDocsLang } from "../../docs/_book/parts";

/** The page's words, English and Ukrainian; the addresses are the engine's (`city/lib/pages/developers.ts`). */
export const DEVELOPERS_WORDS = {
  en: {
    title: "Connect your agent",
    lead: "Your agent reads and prepares. A wallet signs.",
    step1: "Sign in with Solana",
    step1Line: "One message, signed by the wallet. A session comes back.",
    step2: "Read what is open",
    step2Line: "One public call names every module and whether it serves.",
    step3: "Prepare, then sign",
    step3Line: "Ryntra builds the transaction. The wallet signs it.",
    coming: ["Project keys", "Pay per call"],
    copy: "Copy the address",
    copied: "Copied",
    technical: "Technical details",
    rowBase: "Address",
    rowVersion: "Version header",
    rowCapabilities: "What this server serves",
    rowSignIn: "Sign in",
    rowModels: "For language models",
    rowSecurity: "Security reports",
    more: "More",
    chats: "Ryntra in your AI chat",
    docs: "Docs",
    help: "Help",
  },
  uk: {
    title: "Підключи свого агента",
    lead: "Агент читає й готує. Підписує гаманець.",
    step1: "Вхід через Solana",
    step1Line: "Одне повідомлення, підписане гаманцем. У відповідь — сесія.",
    step2: "Подивись, що відкрито",
    step2Line: "Один публічний виклик називає кожен модуль і чи він працює.",
    step3: "Підготуй і підпиши",
    step3Line: "Ryntra збирає транзакцію. Гаманець її підписує.",
    coming: ["Ключі проєктів", "Оплата за виклик"],
    copy: "Скопіювати адресу",
    copied: "Скопійовано",
    technical: "Технічні деталі",
    rowBase: "Адреса",
    rowVersion: "Заголовок версії",
    rowCapabilities: "Що віддає сервер",
    rowSignIn: "Вхід",
    rowModels: "Для мовних моделей",
    rowSecurity: "Звіти про вразливості",
    more: "Ще",
    chats: "Ryntra у твоєму AI-чаті",
    docs: "Документація",
    help: "Допомога",
  },
} as const;

/**
 * `/developers` in the terminal's frame and language: connect an agent in three steps, project keys and pay per call
 * under «Coming», one amber action — the API's address to the clipboard — and the addresses behind «Technical details».
 * On the side the doors to AI chats, the docs and Help.
 */
export function DevelopersView() {
  const lang = useDocsLang();
  const w = DEVELOPERS_WORDS[lang];
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const side = (
    <Panel pad="m">
      <LinkList
        title={w.more}
        links={[
          { href: "/connector", label: w.chats },
          { href: "/docs", label: w.docs },
          { href: "/support", label: w.help },
        ]}
      />
    </Panel>
  );

  return (
    <Page className={b.page} data-docs="developers">
      <DocsBar lang={lang} />
      <PageHead title={w.title} />
      <ActionBody side={side} sideLabel={w.more}>
        <div className={b.mainStack}>
          <p className={b.lead}>{w.lead}</p>
          <ol className={b.steps}>
            {[
              [w.step1, w.step1Line],
              [w.step2, w.step2Line],
              [w.step3, w.step3Line],
            ].map(([title, line], at) => (
              <li key={title} className={b.step}>
                <span className={b.stepNo} aria-hidden="true">
                  {at + 1}
                </span>
                <span className={b.stepLine}>
                  <b>{title}</b> — {line}
                </span>
              </li>
            ))}
          </ol>
          <section aria-labelledby="developers-coming" className={b.comingBlock}>
            <h2 id="developers-coming" className={b.blockHead}>
              {UI[lang].coming}
            </h2>
            <div className={b.chips}>
              {w.coming.map((name) => (
                <span key={name} className={b.chip} data-coming="">
                  {name}
                </span>
              ))}
            </div>
          </section>
          <div>
            <Action
              full={false}
              onClick={() => {
                void navigator.clipboard?.writeText(API_BASE).then(
                  () => setCopied(true),
                  () => {},
                );
              }}
            >
              {copied ? w.copied : w.copy}
            </Action>
          </div>
          <section className={b.moreList} aria-label={w.technical}>
            <Disclosure title={w.technical}>
              <dl className={b.words}>
                {DEV_ROWS.map((row) => (
                  <div key={row.what} className={b.word}>
                    <dt className={b.wordTerm}>{w[row.what]}</dt>
                    <dd className={b.wordLine}>
                      <code>{row.value}</code>
                    </dd>
                  </div>
                ))}
              </dl>
            </Disclosure>
          </section>
        </div>
      </ActionBody>
    </Page>
  );
}
