/**
 * «Підтримка» — the words of `/support`, English and Ukrainian together.
 *
 * Every store portal asks for a support address beside the privacy policy,
 * and the Android app's listing names this one. It helps with what production
 * already has: the guides that answer most questions, History with its
 * receipts, the phone's own facts, and one inbox for the rest — the hero's
 * letter under the general subject «Support», the cards under the same three
 * subjects `/contact` offers (their words are read from its copy, so the two
 * pages cannot name a topic differently). No response time is promised,
 * because none is staffed, and nothing the shipped app cannot do yet is
 * offered (phone notifications wait for the push configuration).
 */

import { contactCopy, type ContactTopic } from "../contact/contact-copy.ts";

export type SupportLocale = "en" | "uk";

export type SupportTile = Readonly<{ title: string; body: string; href: string }>;

export type SupportCopy = Readonly<{
  meta: Readonly<{ title: string; description: string }>;
  hero: Readonly<{ eyebrow: string; title: string; lead: string; note: string; write: string; guide: string; subject: string }>;
  answers: Readonly<{ eyebrow: string; title: string; items: readonly SupportTile[] }>;
  android: Readonly<{ eyebrow: string; title: string; lead: string; items: readonly string[]; privacy: string }>;
  write: Readonly<{ eyebrow: string; title: string; lead: string; topics: readonly ContactTopic[] }>;
  helps: Readonly<{ eyebrow: string; title: string; items: readonly string[]; never: string }>;
}>;

export const SUPPORT_TROUBLESHOOTING = "/docs/reference/troubleshooting";
export const SUPPORT_PRIVACY_ANDROID = "/legal/privacy#android";

/** Ukrainian typesetting: a one-letter word keeps to the word after it, so no line ends on «і» or «з». */
const nb = (text: string): string => text.replace(/(^|\s)([ІіЙйВвУуЗзОоАаЖж]) /g, "$1$2 ");

export const SUPPORT_COPY: Readonly<Record<SupportLocale, SupportCopy>> = {
  en: {
    meta: {
      title: "Ryntra support",
      description: "Help with Ryntra on the web and on Android: what to do when a wallet, a purchase or a status goes wrong, History with receipts, and a line to the team.",
    },
    hero: {
      eyebrow: "Support",
      title: "Help with Ryntra.",
      lead: "Most answers are on the pages below. If yours isn't there, write to the people who build Ryntra.",
      note: "About the website and the Ryntra app for Android.",
      write: "Write to support",
      guide: "Troubleshooting",
      subject: "Support",
    },
    answers: {
      eyebrow: "Answers first",
      title: "Find the answer",
      items: [
        { title: "It did not work", body: "A wallet that will not connect, an expired quote, an unknown status — what to do.", href: SUPPORT_TROUBLESHOOTING },
        { title: "What a status means", body: "Pending, Sent, Arrived, Failed — what each one means for your money.", href: "/docs/reference/statuses" },
        { title: "Your History", body: "Every operation with its receipt and a link to the transaction.", href: "/app/activity" },
        { title: "Common questions", body: "Fees, wallets, what you buy and how Ryntra works.", href: "/docs/reference/faq" },
      ],
    },
    android: {
      eyebrow: "Android",
      title: "The Ryntra app for Android",
      lead: "The same account and the same help as the website.",
      items: [
        "The wallet app on your phone signs every purchase — Ryntra never asks for a seed phrase.",
        "Signing out deletes your session and the private data kept on the phone.",
      ],
      privacy: "What stays on your phone",
    },
    write: {
      eyebrow: "Email",
      title: "Still stuck? Write to us",
      lead: "One inbox for the website and the app. Pick what it is about.",
      topics: contactCopy("en").topics.items,
    },
    helps: {
      eyebrow: "Before you send",
      title: "What helps us answer",
      items: [
        "What happened and the message on the screen — a screenshot helps.",
        "For a purchase: its receipt, or the transaction's link from History.",
        "Your wallet's public address, if the question is about your account.",
      ],
      never: contactCopy("en").send.never,
    },
  },
  uk: {
    meta: {
      title: "Підтримка — Ryntra",
      description: "Допомога з Ryntra на сайті та в Android: що робити, коли гаманець, купівля чи статус пішли не так, Історія з квитанціями й зв'язок із командою.",
    },
    hero: {
      eyebrow: "Підтримка",
      title: "Допомога з Ryntra.",
      lead: nb("Більшість відповідей — на сторінках нижче. Якщо потрібної немає, напиши тим, хто будує Ryntra."),
      note: nb("Про сайт і застосунок Ryntra для Android."),
      write: "Написати в підтримку",
      guide: "Усунення проблем",
      subject: "Support",
    },
    answers: {
      eyebrow: "Спершу відповіді",
      title: "Знайди відповідь",
      items: [
        { title: "Не вдалося", body: nb("Гаманець не під'єднується, котирування застаріло, статус невідомий — що робити."), href: SUPPORT_TROUBLESHOOTING },
        { title: "Що означає статус", body: nb("Очікує, Надіслано, Прибуло, Помилка — що кожен означає для твоїх грошей."), href: "/docs/reference/statuses" },
        { title: "Твоя Історія", body: nb("Кожна операція з квитанцією й посиланням на транзакцію."), href: "/app/activity" },
        { title: "Часті запитання", body: nb("Комісії, гаманці, що ти купуєш і як працює Ryntra."), href: "/docs/reference/faq" },
      ],
    },
    android: {
      eyebrow: "Android",
      title: "Застосунок Ryntra для Android",
      lead: nb("Той самий акаунт і та сама допомога, що й на сайті."),
      items: [
        nb("Кожну купівлю підписує застосунок гаманця на телефоні — Ryntra ніколи не просить сід‑фразу."),
        nb("Вихід видаляє з телефона сесію й приватні дані, що на ньому зберігалися."),
      ],
      privacy: "Що лишається на телефоні",
    },
    write: {
      eyebrow: "Пошта",
      title: "Відповіді немає? Напиши нам",
      lead: nb("Одна скринька для сайту й застосунку. Обери, про що лист."),
      topics: contactCopy("uk").topics.items,
    },
    helps: {
      eyebrow: "Перш ніж надіслати",
      title: "Що допоможе відповісти",
      items: [
        nb("Що сталося й повідомлення на екрані — знімок екрана допоможе."),
        nb("Для купівлі — її квитанція або посилання на транзакцію з Історії."),
        nb("Публічна адреса гаманця, якщо питання про твій акаунт."),
      ],
      never: contactCopy("uk").send.never,
    },
  },
};

export function supportCopy(locale: SupportLocale): SupportCopy {
  return SUPPORT_COPY[locale];
}
