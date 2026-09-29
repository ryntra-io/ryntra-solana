/**
 * «Контакти» — the words of `/contact`, English and Ukrainian together (the new
 * site of canon v5.5, `RYN-SITE-V5-001` subtask 3; the plan's §3 for the title
 * and the description: about the app, a purchase that went wrong, or security
 * — no «access» and no «integrations» any more).
 *
 * One inbox, three subjects that sort it, what to send and what never to send;
 * `/support` reads the same three subjects, and it is the page the Android
 * app's store listing names. No response time is promised, because none is
 * staffed.
 */

export type ContactLocale = "en" | "uk";

export type ContactTopic = Readonly<{ subject: string; label: string; body: string }>;

export type ContactCopy = Readonly<{
  meta: Readonly<{ title: string; description: string }>;
  hero: Readonly<{ eyebrow: string; title: string; lead: string; email: string; x: string }>;
  topics: Readonly<{ eyebrow: string; title: string; items: readonly ContactTopic[] }>;
  send: Readonly<{ eyebrow: string; title: string; items: readonly string[]; never: string }>;
  more: Readonly<{ title: string; links: readonly Readonly<{ href: string; label: string }>[] }>;
}>;

export const CONTACT_COPY: Readonly<Record<ContactLocale, ContactCopy>> = {
  en: {
    meta: {
      title: "Contact Ryntra",
      description: "Write to Ryntra about the app, a purchase that went wrong, or security — by email or on X.",
    },
    hero: {
      eyebrow: "Contact",
      title: "Write to Ryntra.",
      lead: "About the app, a purchase that went wrong, or security. One inbox, read by the people who build the product.",
      email: "Email Ryntra",
      x: "Ryntra on X",
    },
    topics: {
      eyebrow: "What about",
      title: "Pick what it is about",
      items: [
        { subject: "Product", label: "The app", body: "A question, a screen that looks wrong, an idea." },
        { subject: "Purchase", label: "A purchase", body: "A purchase, a swap or a transfer that did not go as the Review said." },
        { subject: "Security Report", label: "Security", body: "A vulnerability, or someone pretending to be Ryntra." },
      ],
    },
    send: {
      eyebrow: "What helps",
      title: "What helps us answer",
      items: [
        "The page's address and the message that appeared on the screen.",
        "For a purchase: its receipt, or the transaction's link from History.",
        "Your wallet's public address, if the question is about your account.",
      ],
      never: "Never send a seed phrase, a private key or a wallet password — nobody at Ryntra needs one, and anyone who asks is not Ryntra.",
    },
    more: {
      title: "Before you write",
      links: [
        { href: "/docs/reference/troubleshooting", label: "Troubleshooting" },
        { href: "/docs/reference/faq", label: "Questions and answers" },
        { href: "/security", label: "Security" },
      ],
    },
  },
  uk: {
    meta: {
      title: "Контакти — Ryntra",
      description: "Напиши Ryntra про застосунок, купівлю, що пішла не так, чи безпеку — поштою або в X.",
    },
    hero: {
      eyebrow: "Контакти",
      title: "Напиши Ryntra.",
      lead: "Про застосунок, купівлю, що пішла не так, чи безпеку. Одна скринька — її читають ті, хто будує продукт.",
      email: "Написати Ryntra",
      x: "Ryntra в X",
    },
    topics: {
      eyebrow: "Про що",
      title: "Обери, про що лист",
      items: [
        { subject: "Product", label: "Застосунок", body: "Запитання, екран, що виглядає не так, ідея." },
        { subject: "Purchase", label: "Купівля", body: "Купівля, обмін чи переказ, що пішли не так, як казала «Перевірка»." },
        { subject: "Security Report", label: "Безпека", body: "Вразливість або хтось, хто видає себе за Ryntra." },
      ],
    },
    send: {
      eyebrow: "Що допоможе",
      title: "Що допоможе відповісти",
      items: [
        "Адреса сторінки й повідомлення, що з'явилося на екрані.",
        "Для купівлі — її квитанція або посилання на транзакцію з Історії.",
        "Публічна адреса гаманця, якщо питання про твій акаунт.",
      ],
      never: "Ніколи не надсилай сід-фразу, приватний ключ чи пароль гаманця — нікому в Ryntra вони не потрібні, і той, хто просить, — не Ryntra.",
    },
    more: {
      title: "Перш ніж писати",
      links: [
        { href: "/docs/reference/troubleshooting", label: "Усунення проблем" },
        { href: "/docs/reference/faq", label: "Запитання і відповіді" },
        { href: "/security", label: "Безпека" },
      ],
    },
  },
};

export function contactCopy(locale: ContactLocale): ContactCopy {
  return CONTACT_COPY[locale];
}
