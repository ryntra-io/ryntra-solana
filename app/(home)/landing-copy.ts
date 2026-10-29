import { RULE_DIP_PRESETS_PCT } from "../../lib/autoinvest/limits.ts";
import { INVEST_WORDS } from "../app/invest/invest-words.ts";
import { FEES } from "../docs/content/facts.ts";
import { helpTopic } from "../shell/help-topics.ts";
import { LANDING_META, type LandingMeta } from "./landing-meta.ts";

/**
 * The words of the landing's new blocks (the new site of 2026-09-26: the
 * original hero, orbit, workflow and Rewards, whose words live in
 * `HOMEPAGE_COPY`, and beside them «Автоінвест», what you buy with the
 * company's path, the phone, security, where Ryntra is today and the
 * questions people ask first).
 *
 * Three rules hold every line here.
 *
 *   1. Only what production does. Each «Працює зараз» item is tied in
 *      `landing.test.mjs` to the code that does it, and each «Будуємо» and
 *      «Далі» item to work not yet shipped — the test fails the day one of
 *      them ships, so the item moves rather than lingering. No dates, no
 *      per cents and nothing internal in those items.
 *   2. The product's own words. The kinds of rule, the budget, the price
 *      condition and the issuers' labels are read from the strings the app
 *      itself shows, so the landing cannot call a thing by another name.
 *   3. «Ти», short sentences, no forbidden word — no «safe», no
 *      «guaranteed», no «DCA», no «one signature», no assistant named Ryn.
 */

export type LandingLocale = "en" | "uk";

/** What production does today; the key names the check that proves it. */
export type WorksNowKey =
  | "purchase"
  | "listed"
  | "private"
  | "autoinvest"
  | "budget"
  | "company"
  | "fairPrice"
  | "assetTruth"
  | "portfolio"
  | "rewards"
  | "assistant"
  | "experienced";

/** What the next rows of the queue build, web and phone; the key names the row. */
export type BuildingKey = "android" | "warn";
export type NextKey = "startFromZero";
export type RuleKindKey = "schedule" | "dip" | "payments";

type Item<K extends string> = Readonly<{ key: K; text: string }>;
type Pair = Readonly<{ title: string; body: string }>;
type Issuer = Readonly<{ id: "xstocks" | "backpack" | "prestocks"; issuer: string; label: string; line: string; examples: string }>;
type Question = Readonly<{ q: string; a: string }>;
type Head = Readonly<{ eyebrow: string; titleLines: readonly [string, string]; lead: string }>;

export type LandingCopy = Readonly<{
  meta: LandingMeta;
  autoinvest: Head & Readonly<{
    kinds: readonly (Pair & Readonly<{ key: RuleKindKey; example: string; shotAlt: string }>)[];
    extras: readonly Pair[];
    promise: string;
    open: string;
  }>;
  buy: Head & Readonly<{ issuers: readonly Issuer[]; open: string }>;
  path: Readonly<{ title: string; lead: string; company: string; open: string }>;
  mobile: Head & Readonly<{ now: string; building: string; shotAlts: readonly [string, string, string] }>;
  security: Head & Readonly<{ facts: readonly Pair[]; more: string }>;
  status: Readonly<{
    eyebrow: string;
    titleLines: readonly [string, string];
    now: Readonly<{ title: string; items: readonly Item<WorksNowKey>[] }>;
    building: Readonly<{ title: string; items: readonly Item<BuildingKey>[] }>;
    next: Readonly<{ title: string; items: readonly Item<NextKey>[] }>;
  }>;
  faq: Readonly<{ eyebrow: string; title: string; items: readonly Question[] }>;
  /**
   * The market tape (`market-tape.tsx`, SOL-T4): its name for a screen reader, and the words of a day's line — the
   * tape is Ryntra's own, on the core's sparkline, with Solana's prices.
   */
  tape: Readonly<{ label: string; day: string }>;
}>;

/** The day the product's screens on the page were taken from ryntra.io (`scripts/site/capture-landing-shots.mjs`). */
export const SHOTS_TAKEN = "2026-09-26";

const word = (key: keyof typeof INVEST_WORDS, locale: LandingLocale) => INVEST_WORDS[key][locale];

/** The fall the «Якщо впаде» example names — the first the rule's sheet offers. */
const DIP = RULE_DIP_PRESETS_PCT[0];

/** «Що ти купуєш» — each issuer's label and line exactly as the company page shows them. */
function issuers(locale: LandingLocale): readonly Issuer[] {
  const xstocks = helpTopic("truthXStocks", locale);
  const backpack = helpTopic("truthBackpack", locale);
  /* The PreStocks fee is read from the chain on each company's page; the landing names it and states no rate. */
  const prestocks = helpTopic("truthPreStocks", locale, { fee: null });
  return [
    { id: "xstocks", issuer: "xStocks", label: xstocks.title, line: xstocks.short, examples: "NVDAx · AAPLx · SPYx" },
    { id: "backpack", issuer: "Backpack", label: backpack.title, line: backpack.short, examples: "DJT · HIMS · MU" },
    { id: "prestocks", issuer: "PreStocks", label: prestocks.title, line: prestocks.short, examples: "OpenAI · Anthropic · Anduril" },
  ];
}

export const LANDING_COPY: Readonly<Record<LandingLocale, LandingCopy>> = {
  en: {
    meta: LANDING_META.en,
    autoinvest: {
      eyebrow: "Autoinvest",
      titleLines: ["Buy in pieces,", "by your own rule."],
      lead: "Set it once. When it is time, Ryntra reminds you — and you sign each purchase.",
      kinds: [
        { key: "schedule", title: word("regularly", "en"), body: "Every day, every week or every month — from $1.", example: "$1 of NVIDIA every day at 14:00", shotAlt: "An Autoinvest rule in Ryntra: $1 of NVIDIA every day, with a price condition." },
        { key: "dip", title: word("ifFalls", "en"), body: "When the price falls by the per cent you choose.", example: `If NVIDIA falls ${DIP}% — buy $20 more`, shotAlt: "An Autoinvest rule in Ryntra: buy NVIDIA when its price falls by the per cent you choose." },
        { key: "payments", title: word("fromPayments", "en"), body: "Round each USDC payment up to $1 or $5, set aside a sum from every payment, or a per cent of what comes in.", example: "A $3.40 payment → $0.60 into NVIDIA", shotAlt: "An Autoinvest rule from payments: each USDC payment rounded up to $1 for NVIDIA." },
      ],
      extras: [
        { title: word("monthBudget", "en"), body: "The most your rules spend in a month." },
        { title: word("priceCondition", "en"), body: "Skip a purchase when the price is above its reference by more than your limit." },
      ],
      promise: "The money stays in your wallet until you sign.",
      open: "Set up Autoinvest",
    },
    buy: {
      eyebrow: "What you buy",
      titleLines: ["A token, not a share —", "in the issuer's own words."],
      lead: "Every company's page says which kind, before you buy.",
      issuers: issuers("en"),
      open: "See the companies",
    },
    path: {
      title: "The company's path",
      lead: "From a private company to its share on Solana, with the day of each step and the deadline you must not miss.",
      company: "SpaceX",
      open: "Open SpaceX",
    },
    mobile: {
      eyebrow: "On your phone",
      titleLines: ["Every screen,", "drawn for the phone first."],
      lead: "Open ryntra.io on your phone: a company from $1, Autoinvest and every receipt — in your pocket.",
      now: "Works now — in your phone's browser",
      building: "Building — the Android app for Solana Seeker",
      shotAlts: [
        "The NVIDIA page in Ryntra on a phone: the price in dollars and the purchase.",
        "Buying NVIDIA for $1 in Ryntra on a phone: about 0.0044 of a share, all costs under one cent.",
        "An Autoinvest rule in Ryntra on a phone: $1 of NVIDIA every day.",
      ],
    },
    security: {
      eyebrow: "Security",
      titleLines: ["Ryntra never holds", "your money."],
      lead: "Ryntra prepares the purchase. Everything that moves money is yours.",
      facts: [
        { title: "Your keys stay yours", body: "Ryntra never sees your keys or your seed phrase." },
        { title: "Nothing without your signature", body: "Every purchase is signed in your own wallet." },
        { title: "Every fee before you sign", body: "Ryntra's fee is a line of the Review." },
        { title: "A receipt for every purchase", body: "With the facts read from the chain." },
      ],
      more: "How security works",
    },
    status: {
      eyebrow: "Today",
      titleLines: ["What works now,", "and what comes next."],
      now: {
        title: "Works now",
        items: [
          { key: "purchase", text: "Buy from $1 and sell from a position: the Review, your signature, the receipt" },
          { key: "listed", text: "Listed companies and funds — xStocks and Backpack" },
          { key: "private", text: "Private companies through PreStocks" },
          { key: "autoinvest", text: "Autoinvest: regularly, if it falls, from payments" },
          { key: "budget", text: "A monthly budget and a price condition" },
          { key: "company", text: "The company page and the company's path" },
          { key: "fairPrice", text: "Fair price — a stock token's price next to the exchange's" },
          { key: "assetTruth", text: "On every stock token, the issuer's label and where it is not offered" },
          { key: "portfolio", text: "Portfolio, history with receipts, notifications in the bell and in Telegram" },
          { key: "rewards", text: "Rewards: fee back, referrals and points" },
          { key: "assistant", text: "The Ryntra assistant — it explains, you decide and sign" },
          { key: "experienced", text: "For the experienced: Spot with a chart, swap, transfers between networks, send and receive" },
        ],
      },
      building: {
        title: "Building",
        items: [
          { key: "android", text: "The Android app for Solana Seeker" },
          { key: "warn", text: "«Ryntra will warn you» — when the price nears your loss limit" },
        ],
      },
      next: {
        title: "Next",
        items: [
          { key: "startFromZero", text: "Starting from zero — a top-up by card and a first purchase without SOL" },
        ],
      },
    },
    tape: { label: "Market prices on Solana", day: "over 24 hours" },
    faq: {
      eyebrow: "Questions",
      title: "What people ask first",
      items: [
        {
          q: "What do I buy?",
          a: "A token that tracks a share price (xStocks, Backpack), or a PreStocks token of economic exposure to a private company — not a share. The company's page says which, under What you buy.",
        },
        {
          q: "From how much?",
          a: "From $1. Where $1 has no route, Ryntra tells you that company's minimum. A first purchase of a token leaves a one-time account reserve in your wallet — its own line in the Review.",
        },
        { q: "Where is my money?", a: "In your own wallet. Ryntra never holds your money or keys and never signs for you." },
        {
          q: "How much does it cost?",
          a: `Ryntra's fee is ${FEES.swap} of the sum, shown in the Review before you sign; the Solana network fee is separate; PreStocks tokens carry the issuer's fee, read from the chain.`,
        },
        { q: "Does Autoinvest buy on its own?", a: "No. Ryntra reminds you by your rule — you sign every purchase." },
        {
          q: "Who can buy?",
          a: "The issuer decides. By their own documents xStocks, Backpack and PreStocks are not for the US, and Backpack is not for the UK, the UAE or Japan either; a private company's page carries «Who may hold it». Ryntra never works around an issuer's restrictions.",
        },
        {
          q: "Can I sell?",
          a: "Yes — from your position, on the company's page or in Portfolio: a sum in dollars or a share, the same Review and your signature. A PreStocks token may not sell — the issuer promises no liquidity.",
        },
        {
          q: "What is the Ryntra assistant?",
          a: "An assistant that explains companies, prices and your portfolio and prepares drafts. Only you buy, sell and sign.",
        },
      ],
    },
  },
  uk: {
    meta: LANDING_META.uk,
    autoinvest: {
      eyebrow: "Автоінвест",
      titleLines: ["Купуй частинами —", "за своїм правилом."],
      lead: "Налаштуй раз. Коли час, Ryntra нагадає — кожну купівлю підписуєш ти.",
      kinds: [
        { key: "schedule", title: word("regularly", "uk"), body: "Щодня, щотижня чи щомісяця — від $1.", example: "$1 у NVIDIA щодня о 14:00", shotAlt: "Правило «Автоінвесту» в Ryntra: $1 у NVIDIA щодня, з умовою ціни." },
        { key: "dip", title: word("ifFalls", "uk"), body: "Коли ціна впаде на твій відсоток.", example: `Якщо NVIDIA впаде на ${DIP} % — докупити $20`, shotAlt: "Правило «Автоінвесту» в Ryntra: купити NVIDIA, коли ціна впаде на твій відсоток." },
        { key: "payments", title: word("fromPayments", "uk"), body: "Округлювати кожну оплату USDC до $1 чи $5, відкладати суму з кожної оплати або відсоток із надходжень.", example: "Оплата $3,40 → $0,60 у NVIDIA", shotAlt: "Правило «Автоінвесту» з оплат: кожна оплата USDC округлюється до $1 — у NVIDIA." },
      ],
      extras: [
        { title: word("monthBudget", "uk"), body: "Найбільше, що правила витратять за місяць." },
        { title: word("priceCondition", "uk"), body: "Не купувати, якщо дорожче за орієнтир більш ніж на твій ліміт." },
      ],
      promise: "Гроші лежать у твоєму гаманці, доки ти не підпишеш.",
      open: "Налаштувати «Автоінвест»",
    },
    buy: {
      eyebrow: "Що ти купуєш",
      titleLines: ["Токен, а не акція —", "словами емітента."],
      lead: "Сторінка кожної компанії каже, який саме, ще до купівлі.",
      issuers: issuers("uk"),
      open: "Дивитися компанії",
    },
    path: {
      title: "Шлях компанії",
      lead: "Від приватної компанії до її акції на Solana — з днем кожного кроку і строком, який не можна пропустити.",
      company: "SpaceX",
      open: "Відкрити SpaceX",
    },
    mobile: {
      eyebrow: "У телефоні",
      titleLines: ["Кожен екран —", "спершу для телефона."],
      lead: "Відкрий ryntra.io на телефоні: компанія від $1, «Автоінвест» і кожна квитанція — у твоїй кишені.",
      now: "Працює зараз — у браузері телефона",
      building: "Будуємо — застосунок для Android на Solana Seeker",
      shotAlts: [
        "Сторінка NVIDIA в Ryntra на телефоні: ціна в доларах і купівля.",
        "Купівля NVIDIA на $1 у Ryntra на телефоні: близько 0,0044 акції, усі витрати менше цента.",
        "Правило «Автоінвесту» в Ryntra на телефоні: $1 у NVIDIA щодня.",
      ],
    },
    security: {
      eyebrow: "Безпека",
      titleLines: ["Ryntra не тримає", "твоїх коштів."],
      lead: "Ryntra готує купівлю. Усе, що рухає гроші, — твоє.",
      facts: [
        { title: "Ключі — лише твої", body: "Ryntra ніколи не бачить ні ключів, ні сід-фрази." },
        { title: "Нічого без твого підпису", body: "Кожну купівлю підписуєш у своєму гаманці." },
        { title: "Кожна комісія — до підпису", body: "Комісія Ryntra — окремий рядок «Перевірки»." },
        { title: "Квитанція на кожну купівлю", body: "З фактами, прочитаними з ланцюга." },
      ],
      more: "Як працює безпека",
    },
    status: {
      eyebrow: "Сьогодні",
      titleLines: ["Що працює зараз", "і що буде далі."],
      now: {
        title: "Працює зараз",
        items: [
          { key: "purchase", text: "Купівля від $1 і продаж із позиції: «Перевірка», твій підпис, квитанція" },
          { key: "listed", text: "Публічні компанії й фонди — xStocks і Backpack" },
          { key: "private", text: "Приватні компанії — через PreStocks" },
          { key: "autoinvest", text: "«Автоінвест»: регулярно, якщо впаде, з оплат" },
          { key: "budget", text: "Бюджет місяця й «Умова ціни»" },
          { key: "company", text: "Сторінка компанії й «Шлях компанії»" },
          { key: "fairPrice", text: "«Ціна чесна» — ціна токена акції поруч із ціною на біржі" },
          { key: "assetTruth", text: "На кожному токені акції — мітка емітента й де його не пропонують" },
          { key: "portfolio", text: "Портфель, історія з квитанціями, сповіщення в дзвіночку й у Telegram" },
          { key: "rewards", text: "Винагороди: повернення комісії, реферали й очки рангу" },
          { key: "assistant", text: "Помічник Ryntra: пояснює, а вирішуєш і підписуєш ти" },
          { key: "experienced", text: "Для досвідчених: Спот із графіком, обмін, перекази між мережами, надіслати й отримати" },
        ],
      },
      building: {
        title: "Будуємо",
        items: [
          { key: "android", text: "Застосунок для Android на Solana Seeker" },
          { key: "warn", text: "«Ryntra попередить» — коли ціна підходить до твоєї межі збитку" },
        ],
      },
      next: {
        title: "Далі",
        items: [
          { key: "startFromZero", text: "Старт з нуля — поповнення карткою й перша купівля без SOL" },
        ],
      },
    },
    tape: { label: "Ціни ринків на Solana", day: "за 24 години" },
    faq: {
      eyebrow: "Запитання",
      title: "Що питають першим",
      items: [
        {
          q: "Що я купую?",
          a: "Токен, що відстежує ціну акції (xStocks, Backpack), або токен PreStocks з економічною експозицією на приватну компанію — не акцію. Що саме — у «Що ти купуєш» на сторінці компанії.",
        },
        {
          q: "Від якої суми?",
          a: "Від $1. Якщо на $1 маршруту немає, Ryntra скаже мінімум цієї компанії. Перша купівля токена лишає в гаманці разовий резерв рахунку — окремим рядком «Перевірки».",
        },
        { q: "Де мої гроші?", a: "У твоєму гаманці. Ryntra не тримає коштів і ключів і не підписує за тебе." },
        {
          q: "Скільки це коштує?",
          a: `Комісія Ryntra — ${FEES.swap} суми, видно в «Перевірці» до підпису; плата мережі Solana — окремо; у токенів PreStocks — комісія емітента з ланцюга.`,
        },
        { q: "«Автоінвест» купує сам?", a: "Ні. Ryntra нагадує за твоїм правилом — кожну купівлю підписуєш ти." },
        {
          q: "Хто може купувати?",
          a: "Це вирішує емітент. За своїми документами xStocks, Backpack і PreStocks — не для США, Backpack — ще й не для Великої Британії, ОАЕ та Японії; у приватних компаній рядок «Хто може тримати» — на сторінці компанії. Ryntra не обходить обмежень емітента.",
        },
        {
          q: "Чи можна продати?",
          a: "Так — з позиції, на сторінці компанії чи в Портфелі: сума в доларах або частка, та сама «Перевірка» й твій підпис. Токен PreStocks продати може не вийти — емітент ліквідності не обіцяє.",
        },
        {
          q: "Що таке помічник Ryntra?",
          a: "Помічник, що пояснює компанії, ціни й твій портфель і готує чернетки. Купуєш, продаєш і підписуєш лише ти.",
        },
      ],
    },
  },
};

export function landingCopy(locale: LandingLocale): LandingCopy {
  return LANDING_COPY[locale];
}

/** The landing's address in each language: English at the root, Ukrainian under `/uk`. */
export const LANDING_PATH: Readonly<Record<LandingLocale, "/" | "/uk">> = { en: "/", uk: "/uk" };
