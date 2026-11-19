"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { useRyntraApp } from "@/city/lib/app-mode";
import { CONTACT_MAX, HELP_MAX, HELP_TOPICS, helpPayload, helpReady, sendHelp, type HelpOutcome, type HelpTopic } from "@/city/lib/pages/help";
import { CONTACTS, contactMailto } from "@/lib/site/contacts";
import { Action, ActionBody, Page, PageHead, Panel, Quiet, Segment } from "@/terminal/ui";

import b from "../../docs/_book/book.module.css";
import { Disclosure, DocsBar, useDocsLang } from "../../docs/_book/parts";

/** The page's words, English and Ukrainian; the inbox's rules are the engine's (`city/lib/pages/help.ts`). */
export const HELP_WORDS = {
  en: {
    title: "Help",
    line: "A question, a problem, an idea or a security report — write here.",
    topic: "Topic",
    question: "Question",
    bug: "Problem",
    idea: "Idea",
    security: "Security",
    message: "Your message",
    placeholder: "What happened? A wallet address or a transaction link helps.",
    contact: "Email or Telegram, if you want an answer",
    send: "Send",
    sending: "Sending…",
    sent: "Sent",
    reference: (ref: string) => `Your reference: ${ref}`,
    another: "Write another",
    busy: "Too many messages. Try again in a few minutes.",
    offline: (email: string) => `The inbox is offline. Write to ${email}.`,
    failed: "Didn’t go through. Try again.",
    first: "Read first",
    questions: "Questions and answers",
    keys: "Keys stay yours",
    before: "Before you write",
    never: "Ryntra never asks for your seed phrase or keys. Anyone who does is not us.",
    securityFirst: "Security reports are read first.",
    email: "Email",
    phone: "What the phone app keeps",
  },
  uk: {
    title: "Допомога",
    line: "Питання, проблема, ідея чи звіт про безпеку — пиши сюди.",
    topic: "Тема",
    question: "Питання",
    bug: "Проблема",
    idea: "Ідея",
    security: "Безпека",
    message: "Повідомлення",
    placeholder: "Що сталося? Адреса гаманця чи посилання на транзакцію допоможуть.",
    contact: "Пошта чи Telegram, якщо чекаєш відповіді",
    send: "Надіслати",
    sending: "Надсилаємо…",
    sent: "Надіслано",
    reference: (ref: string) => `Твій номер: ${ref}`,
    another: "Написати ще",
    busy: "Забагато повідомлень. Спробуй за кілька хвилин.",
    offline: (email: string) => `Скринька недоступна. Напиши на ${email}.`,
    failed: "Не вдалося. Спробуй ще раз.",
    first: "Спершу прочитай",
    questions: "Питання й відповіді",
    keys: "Ключі в тебе",
    before: "Перш ніж писати",
    never: "Ryntra ніколи не просить сід-фразу чи ключі. Хто просить — не ми.",
    securityFirst: "Звіти про безпеку читаємо першими.",
    email: "Пошта",
    phone: "Що зберігає застосунок на телефоні",
  },
} as const;

/**
 * `/support` in the terminal's frame and language: one form on the engine's inbox (`POST /api/feedback`) —
 * pick what it is, write, send; the one amber action is «Send». On the side, what to read first and, behind one quiet
 * disclosure, what to know before writing.
 */
export function HelpView() {
  const lang = useDocsLang();
  const w = HELP_WORDS[lang];
  const inApp = useRyntraApp();
  const ids = useId();
  const [topic, setTopic] = useState<HelpTopic>("question");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<HelpOutcome | null>(null);
  const draft = { topic, body, contact };
  const ready = helpReady(draft) && !busy;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    setOutcome(null);
    const result = await sendHelp(helpPayload(draft, { source: inApp ? "app" : "site", route: location.pathname, locale: lang }), (url, init) => fetch(url, init));
    setBusy(false);
    setOutcome(result);
    if (result.kind === "sent") {
      setBody("");
      setContact("");
    }
  };

  const side = (
    <div className={b.sideStack}>
      <Panel pad="m" label={w.first}>
        <nav className={b.toc} aria-label={w.first}>
          <Link href="/docs/help" className={b.tocLink}>
            {w.questions}
          </Link>
          <Link href="/docs/keys" className={b.tocLink}>
            {w.keys}
          </Link>
        </nav>
      </Panel>
      <Disclosure title={w.before}>
        <p>{w.never}</p>
        <p>{w.securityFirst}</p>
        <p>
          {w.email}: <a className={b.inlineLink} href={contactMailto()}>{CONTACTS.email}</a>
        </p>
        <p>
          <Link className={b.inlineLink} href="/legal/privacy#android">
            {w.phone}
          </Link>
        </p>
      </Disclosure>
    </div>
  );

  return (
    <Page className={b.page} data-docs="help-form">
      <DocsBar lang={lang} here={w.title} />
      <PageHead title={w.title} />
      <ActionBody side={side} sideLabel={w.first}>
        <div className={b.mainStack}>
          <p className={b.lead}>{w.line}</p>
          <Panel tone="hi" pad="l">
            {outcome?.kind === "sent" ? (
              <div className={b.formStack} role="status">
                <p className={b.formDone}>{w.sent}</p>
                <p className={b.sideLine}>{w.reference(outcome.ref)}</p>
                <Quiet onClick={() => setOutcome(null)}>{w.another}</Quiet>
              </div>
            ) : (
              <form
                className={b.formStack}
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <Segment label={w.topic} value={topic} onChange={setTopic} items={HELP_TOPICS.map((id) => ({ id, label: w[id] }))} />
                <label className={b.formLabel} htmlFor={`${ids}-body`}>
                  {w.message}
                </label>
                <textarea
                  id={`${ids}-body`}
                  className={b.formField}
                  rows={6}
                  maxLength={HELP_MAX}
                  placeholder={w.placeholder}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
                <label className={b.formLabel} htmlFor={`${ids}-contact`}>
                  {w.contact}
                </label>
                <input
                  id={`${ids}-contact`}
                  className={b.formField}
                  type="text"
                  autoComplete="email"
                  maxLength={CONTACT_MAX}
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                />
                {outcome ? (
                  <p className={b.formAlert} role="alert">
                    {outcome.kind === "busy" ? w.busy : outcome.kind === "offline" ? w.offline(CONTACTS.email) : w.failed}
                  </p>
                ) : null}
                <Action type="submit" disabled={!ready} busy={busy}>
                  {busy ? w.sending : w.send}
                </Action>
              </form>
            )}
          </Panel>
        </div>
      </ActionBody>
    </Page>
  );
}
