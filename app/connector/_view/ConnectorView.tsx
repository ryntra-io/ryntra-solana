"use client";

import { useEffect, useState } from "react";

import { CONNECTOR } from "@/city/components/pages/words";
import { CALLS_A_MINUTE, CONNECTOR_ROWS, CONNECTOR_URL } from "@/city/lib/pages/connector";
import { Action, ActionBody, Page, PageHead, Panel } from "@/terminal/ui";

import b from "../../docs/_book/book.module.css";
import { Disclosure, DocsBar, LinkList, useDocsLang } from "../../docs/_book/parts";

/**
 * The page's words, English and Ukrainian; the addresses are the connector's own (`city/lib/pages/connector.ts`). What
 * each row of «Technical details» is — the chats a person adds Ryntra to, by their product names — is read from the
 * connector's one dictionary (`CONNECTOR` in `city/components/pages/words.ts`), so the names live in one file.
 */
export const CONNECTOR_WORDS = {
  en: {
    title: "Ryntra in your AI chat",
    lead: "Ask about any Solana coin. Ryntra reads the market and checks before you sign.",
    step1: "Add Ryntra",
    step1Line: "In your chat, add a connector with this address.",
    step2: "Approve with your wallet",
    step2Line: "One message to sign. No transaction, no funds.",
    step3: "Ask",
    step3Line: "“What is this coin?” “Check this before I sign.”",
    copy: "Copy the address",
    copied: "Copied",
    can: "What it does",
    passportTitle: "What a coin is",
    passportLine: "Its price, its facts and every known risk, with the source.",
    marketTitle: "The whole market",
    marketLine: "Coins, markets, stocks and events.",
    checkTitle: "Before you sign",
    checkLine: "A transaction or a link: allow, warn or block, with the reasons.",
    readsOnly: "Reads only. It never moves funds or signs.",
    technical: "Technical details",
    limits: (calls: number) => `Up to ${calls} calls a minute per wallet.`,
    access: "Access lasts an hour and renews for up to 30 days.",
    disconnect: "To disconnect, remove Ryntra in your chat.",
    advice: "Answers carry their time and source. A check is a reading, not a promise. Not financial advice.",
    more: "More",
    yourData: "What it keeps",
    support: "Questions or a problem",
    developers: "Developers",
  },
  uk: {
    title: "Ryntra у твоєму AI-чаті",
    lead: "Питай про будь-яку монету Solana. Ryntra читає ринок і перевіряє до підпису.",
    step1: "Додай Ryntra",
    step1Line: "У своєму чаті додай конектор з цією адресою.",
    step2: "Схвали гаманцем",
    step2Line: "Одне повідомлення на підпис. Без транзакції й коштів.",
    step3: "Питай",
    step3Line: "«Що це за монета?» «Перевір перед підписом.»",
    copy: "Скопіювати адресу",
    copied: "Скопійовано",
    can: "Що вміє",
    passportTitle: "Що це за монета",
    passportLine: "Її ціна, факти й кожен відомий ризик, з джерелом.",
    marketTitle: "Увесь ринок",
    marketLine: "Монети, ринки, акції й події.",
    checkTitle: "До підпису",
    checkLine: "Транзакція чи посилання: дозволити, обережно чи зупинити — з причинами.",
    readsOnly: "Лише читає. Ніколи не рухає кошти й не підписує.",
    technical: "Технічні деталі",
    limits: (calls: number) => `До ${calls} викликів на хвилину на гаманець.`,
    access: "Доступ діє годину й оновлюється до 30 днів.",
    disconnect: "Щоб відключити, прибери Ryntra у своєму чаті.",
    advice: "Кожна відповідь — з часом і джерелом. Перевірка — це читання, не обіцянка. Не фінансова порада.",
    more: "Ще",
    yourData: "Що зберігає",
    support: "Питання чи проблема",
    developers: "Розробникам",
  },
} as const;

/**
 * `/connector` in the terminal's frame and language: Ryntra in a person's AI chat — three steps, one amber action (the
 * connector's address to the clipboard), what it does in three rows and one line on what it never does. The addresses,
 * each chat's own menus and the limits stand behind «Technical details»; on the side the doors to what it keeps (the
 * Privacy Policy), Help and Developers. The page links to no chat's own site.
 */
export function ConnectorView() {
  const lang = useDocsLang();
  const w = CONNECTOR_WORDS[lang];
  const rows = CONNECTOR[lang];
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
          { href: "/legal/privacy", label: w.yourData },
          { href: "/support", label: w.support },
          { href: "/developers", label: w.developers },
        ]}
      />
    </Panel>
  );

  return (
    <Page className={b.page} data-docs="connector">
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
          <div>
            <Action
              full={false}
              onClick={() => {
                void navigator.clipboard?.writeText(CONNECTOR_URL).then(
                  () => setCopied(true),
                  () => {},
                );
              }}
            >
              {copied ? w.copied : w.copy}
            </Action>
          </div>
          <section aria-labelledby="connector-can">
            <h2 id="connector-can" className={b.blockHead}>
              {w.can}
            </h2>
            <ul className={b.does}>
              {[
                [w.passportTitle, w.passportLine],
                [w.marketTitle, w.marketLine],
                [w.checkTitle, w.checkLine],
              ].map(([title, line]) => (
                <li key={title} className={b.doRow}>
                  <span className={b.doTitle}>{title}</span>
                  <span className={b.doLine}>{line}</span>
                </li>
              ))}
            </ul>
          </section>
          <p className={b.sideLine}>{w.readsOnly}</p>
          <section className={b.moreList} aria-label={w.technical}>
            <Disclosure title={w.technical}>
              <dl className={b.words}>
                {CONNECTOR_ROWS.map((row) => (
                  <div key={row.what} className={b.word}>
                    <dt className={b.wordTerm}>{rows[row.what]}</dt>
                    <dd className={b.wordLine}>
                      <code>{row.value}</code>
                    </dd>
                  </div>
                ))}
              </dl>
              <p>{w.limits(CALLS_A_MINUTE)}</p>
              <p>{w.access}</p>
              <p>{w.disconnect}</p>
              <p>{w.advice}</p>
            </Disclosure>
          </section>
        </div>
      </ActionBody>
    </Page>
  );
}
