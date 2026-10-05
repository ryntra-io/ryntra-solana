import { FEES, FEES_UK, REWARDS } from "../docs/content/facts.ts";

/**
 * «Про Ryntra» — the words of `/company`, English and Ukrainian together.
 *
 * What the page may say is what production does today: a company from $1,
 * «Автоінвест», what you buy in the issuer's words, Ryntra the AI assistant —
 * and the rules and the one fee behind them, every rate read from the policy
 * the product charges with. No roadmap («Будуємо · Далі» stays on the
 * landing only), no team the company does not have,
 * no partner it has not signed, no internal vocabulary.
 */

export type CompanyLocale = "en" | "uk";

type Pair = Readonly<{ title: string; body: string }>;

export type CompanyCopy = Readonly<{
  meta: Readonly<{ title: string; description: string }>;
  hero: Readonly<{ eyebrow: string; title: string; lead: string }>;
  what: Readonly<{ eyebrow: string; title: string; tiles: readonly Pair[] }>;
  rules: Readonly<{ eyebrow: string; title: string; items: readonly string[] }>;
  earns: Readonly<{ eyebrow: string; title: string; lead: string; rows: readonly (readonly [string, string, string])[] }>;
  who: Readonly<{ eyebrow: string; title: string; founded: string; independent: string; open: string; openLink: string }>;
  more: Readonly<{ title: string; links: readonly Readonly<{ href: string; label: string }>[] }>;
}>;

export const COMPANY_COPY: Readonly<Record<CompanyLocale, CompanyCopy>> = {
  en: {
    meta: {
      title: "About Ryntra — who builds it and how it earns",
      description: "Ryntra lets you buy tokenized stocks from $1 in your own wallet on Solana. Who builds it, the rules it keeps, and how it earns: a fee shown before you sign.",
    },
    hero: {
      eyebrow: "About Ryntra",
      title: "Tokenized stocks from $1 — in your own wallet, on Solana.",
      lead: "Ryntra is an app for buying a piece of a company in dollars, or by your own rule with Autoinvest. What you buy stays in your wallet, every fee is shown before you sign, and only your signature buys.",
    },
    what: {
      eyebrow: "What it does",
      title: "What Ryntra does",
      tiles: [
        { title: "A company from $1", body: "Pick a company, type a sum from $1, read the Review in four lines and sign in your wallet. The receipt says what you now own." },
        { title: "Autoinvest", body: "Regularly, if the price falls, or from every USDC payment. Ryntra reminds you — you sign each purchase." },
        { title: "What you buy, in the issuer's words", body: "A token that tracks a share — xStocks, Backpack — or a private company's token by PreStocks, which is not a share. The company's page says which." },
        { title: "Ryntra, the AI assistant", body: "It explains companies, prices and your portfolio and prepares drafts. The decision and the signature are yours." },
      ],
    },
    rules: {
      eyebrow: "The rules",
      title: "The rules Ryntra keeps",
      items: [
        "Ryntra never holds your money or your keys, and never signs for you.",
        "Every fee Ryntra takes is a line of the Review, before you sign.",
        "Every figure comes with its source and its time; what is unknown shows as a dash, never as a zero.",
        "No promise of profit, and nothing here is investment advice.",
        "The issuer decides who may hold its token; Ryntra never works around an issuer's restrictions.",
      ],
    },
    earns: {
      eyebrow: "How it earns",
      title: "One fee, shown before you sign",
      lead: "Ryntra earns only when you actually buy, swap or bridge — never for looking, and never for the checks that protect you.",
      rows: [
        ["Service fee", `${FEES.swap} of a purchase or a swap, ${FEES.bridge} of a bridge`, "Its own line in the Review"],
        ["Rewards", `${REWARDS.cashbackPercent}% of the fee Ryntra receives comes back to you in USDC; ${REWARDS.referralL1Percent}% by their rank and ${REWARDS.referralL2Percent}% go to those who invited you`, "Only a fee Ryntra actually received counts"],
        ["No Ryntra fee", "Send, Receive, Rewards claims and every check before you sign", "Only the network's own fee"],
        ["Not Ryntra's", "The Solana network fee, and a PreStocks token's issuer fee read from the chain", "Shown apart in the Review"],
      ],
    },
    who: {
      eyebrow: "Who builds it",
      title: "Who builds Ryntra",
      founded: "Founded by",
      independent: "Ryntra is independent: no issuer, wallet, exchange or network whose tokens or services appear in it owns it or speaks for it.",
      open: "The evidence kit and selected product models are open source.",
      openLink: "Open source",
    },
    more: {
      title: "Read more",
      links: [
        { href: "/security", label: "Security" },
        { href: "/methodology", label: "Where the figures come from" },
        { href: "/contact", label: "Contact" },
        { href: "/docs", label: "Documentation" },
        { href: "/legal/terms", label: "Terms" },
        { href: "/legal/privacy", label: "Privacy" },
      ],
    },
  },
  uk: {
    meta: {
      title: "Про Ryntra — хто будує і як заробляє",
      description: "Ryntra — купівля токенізованих акцій від $1 у своєму гаманці на Solana. Хто будує, яких правил тримається і як заробляє: комісію видно до підпису.",
    },
    hero: {
      eyebrow: "Про Ryntra",
      title: "Токенізовані акції від $1 — у твоєму гаманці, на Solana.",
      lead: "Ryntra — застосунок, щоб купувати частинку компанії в доларах або за своїм правилом з «Автоінвестом». Куплене лишається у твоєму гаманці, кожну комісію видно до підпису, і купує лише твій підпис.",
    },
    what: {
      eyebrow: "Що робить",
      title: "Що робить Ryntra",
      tiles: [
        { title: "Компанія від $1", body: "Обери компанію, впиши суму від $1, прочитай «Перевірку» в чотири рядки й підпиши в гаманці. Квитанція скаже, що тепер у тебе є." },
        { title: "«Автоінвест»", body: "Регулярно, якщо ціна впаде, або з кожної оплати USDC. Ryntra нагадує — кожну купівлю підписуєш ти." },
        { title: "Що купуєш — словами емітента", body: "Токен, що відстежує ціну акції, — xStocks, Backpack — або токен приватної компанії від PreStocks, який не є акцією. Сторінка компанії каже, який саме." },
        { title: "Ryntra — ШІ-помічник", body: "Пояснює компанії, ціни й твій портфель і готує чернетки. Рішення й підпис — твої." },
      ],
    },
    rules: {
      eyebrow: "Правила",
      title: "Правила, яких тримається Ryntra",
      items: [
        "Ryntra не тримає твоїх коштів і ключів і не підписує за тебе.",
        "Кожна комісія Ryntra — окремий рядок «Перевірки», до підпису.",
        "Кожна цифра — з джерелом і часом; невідоме — риска, ніколи не нуль.",
        "Жодних обіцянок прибутку; ніщо тут не є інвестиційною порадою.",
        "Хто може тримати токен, вирішує емітент; Ryntra не обходить його обмежень.",
      ],
    },
    earns: {
      eyebrow: "Як заробляє",
      title: "Одна комісія — видно до підпису",
      lead: "Ryntra заробляє лише тоді, коли ти справді купуєш, обмінюєш чи переносиш кошти, — ніколи за перегляд і ніколи за перевірки, що тебе захищають.",
      rows: [
        ["Комісія Ryntra", `${FEES_UK.swap} суми купівлі чи обміну, ${FEES_UK.bridge} — мосту`, "Окремий рядок «Перевірки»"],
        ["Винагороди", `${REWARDS.cashbackPercent}% отриманої комісії повертається тобі в USDC; ${REWARDS.referralL1Percent}% за рангом запрошувача і ${REWARDS.referralL2Percent}% — тим, хто тебе запросив`, "Рахується лише комісія, яку Ryntra справді отримала"],
        ["Без комісії Ryntra", "Надіслати, Отримати, виплати Винагород і кожна перевірка перед підписом", "Лише власна плата мережі"],
        ["Не комісія Ryntra", "Плата мережі Solana і комісія емітента токенів PreStocks, прочитана з ланцюга", "Окремо в «Перевірці»"],
      ],
    },
    who: {
      eyebrow: "Хто будує",
      title: "Хто будує Ryntra",
      founded: "Засновник —",
      independent: "Ryntra незалежна: жоден емітент, гаманець, біржа чи мережа, чиї токени чи послуги в ній є, нею не володіє й від її імені не говорить.",
      open: "Набір для перевірки доказів і частина моделей продукту — відкритий код.",
      openLink: "Відкритий код",
    },
    more: {
      title: "Читати далі",
      links: [
        { href: "/security", label: "Безпека" },
        { href: "/methodology", label: "Звідки цифри" },
        { href: "/contact", label: "Контакти" },
        { href: "/docs", label: "Документація" },
        { href: "/legal/terms", label: "Умови" },
        { href: "/legal/privacy", label: "Приватність" },
      ],
    },
  },
};

export function companyCopy(locale: CompanyLocale): CompanyCopy {
  return COMPANY_COPY[locale];
}
