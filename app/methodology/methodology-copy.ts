import { AUTOINVEST, FEES, FEES_UK } from "../docs/content/facts.ts";

/**
 * «Звідки цифри» — the words of `/methodology`, English and Ukrainian together
 * (the new site of canon v5.5, `RYN-SITE-V5-001` subtask 3; the plan's §3 for
 * the title and the description).
 *
 * Every row names a figure a person sees, the source the product reads it
 * from, and when — each one checked against the code that reads it: the
 * token's market figures from Jupiter (`lib/stocks/universe.server.ts`), the
 * price line from GeckoTerminal's pool candles (`lib/spot/candles.server.ts`),
 * the company's figures from its SEC filings read into dated data
 * (`lib/stocks/company-facts.ts`), the reserves and the reference from the
 * issuer, the units and the issuer's fee from the chain, PreStocks' valuation
 * from PreStocks' own catalogue (`lib/stocks/issuer-prestocks.server.ts`),
 * the company's path from dated, sourced events (`lib/stocks/lifecycle-events.ts`),
 * the Review from Jupiter's quote and the network's simulation. Ryntra's fee
 * and the price condition's age are read from the policy the product runs on.
 */

export type MethodologyLocale = "en" | "uk";

export type SourceRow = readonly [figure: string, source: string, when: string];

export type MethodologyCopy = Readonly<{
  meta: Readonly<{ title: string; description: string }>;
  hero: Readonly<{ eyebrow: string; title: string; lead: string }>;
  head: Readonly<{ figure: string; source: string; when: string }>;
  groups: readonly Readonly<{ id: string; title: string; rows: readonly SourceRow[] }>[];
  rules: Readonly<{ eyebrow: string; title: string; items: readonly string[] }>;
  more: Readonly<{ title: string; links: readonly Readonly<{ href: string; label: string }>[] }>;
}>;

export const METHODOLOGY_COPY: Readonly<Record<MethodologyLocale, MethodologyCopy>> = {
  en: {
    meta: {
      title: "Where Ryntra's figures come from — sources and time",
      description: "Every figure Ryntra shows and its source: prices from the issuers and Jupiter, company facts from SEC filings, PreStocks' valuation, fees read from the chain.",
    },
    hero: {
      eyebrow: "Sources",
      title: "Where every figure comes from.",
      lead: "Every number Ryntra shows has a source and a time. Here is each one — and what Ryntra does when a source is silent.",
    },
    head: { figure: "Figure", source: "Source", when: "When" },
    groups: [
      {
        id: "company",
        title: "On a company's page",
        rows: [
          ["Price and the day's change", "Jupiter — the token's market price", "Read live, its time under the figures"],
          ["The line over a day, a week, a month or a year", "GeckoTerminal — the price of the token's pool", "Anchored to the page's price"],
          ["Key figures — revenue, earnings, market value, P/E, the dividend", "The company's SEC filings, read into dated data; market value and P/E are set against the issuer's price for one share", "The filing's period and the day it was read"],
          ["About the company — industry, exchange, city", "The company's SEC records and the issuer's catalogue", "With the latest filing"],
          ["What you buy — the label, the backing, the dividends", "The issuer's own documents and reserves report; the multiplier from the chain", "The reserves carry the issuer's date"],
          ["The issuer's fee on a transfer", "The token's own settings on the chain", "At the moment it is read"],
          ["Trading on Solana · 24 h — volume, liquidity, holders, traders", "Jupiter's market data", "With the time it was read"],
          ["A private company's valuation", "PreStocks — its own valuation, never a fair price", "With the time it was read"],
          ["The company's path — private, IPO, exchange, Solana", "The issuers' pages and the sources listed under Sources", "Each step with its date"],
        ],
      },
      {
        id: "review",
        title: "In the Review, before you sign",
        rows: [
          ["You pay · You get at least", "Jupiter's quote for your sum, simulated against the live network", "Until you sign; a stale price asks to be refreshed"],
          ["All costs", `Ryntra's fee — ${FEES.swap}, from the product's own policy — the fees inside the route, the price impact, and the network fee from the simulation`, "Every one before you sign"],
          ["The one-time account reserve", "What the network keeps for a new token account in your wallet — yours, not a fee", "Only on the first purchase of a token"],
          ["The price condition", "The reference — PreStocks' valuation or the issuer's reference — and how far the price stands from it", `Data older than ${AUTOINVEST.conditionMaxAgeMinutes} minutes counts as stale`],
        ],
      },
      {
        id: "portfolio",
        title: "In your portfolio and history",
        rows: [
          ["What you own", "Read from the chain for your wallet", "Each time you open it"],
          ["What it is worth", "What you own at Jupiter's price; an asset without a price shows a dash", "With the price's time"],
          ["A receipt", "What you reviewed beside what the chain settled — the transaction, the amounts, the time", "When the network confirms"],
          ["Rewards", "The fees Ryntra actually collected, from its own ledger", "After the operation settles"],
          ["Stats", "Every operation through Ryntra, from its ledger, reconciled with public Solana transactions", "Live"],
        ],
      },
    ],
    rules: {
      eyebrow: "The rules",
      title: "When a source is silent",
      items: [
        "Every figure names its source and its time.",
        "What is unknown shows as a dash, never as a zero, and a missing price never becomes a guess.",
        "A quote is never shown as a result, and a fee is never counted before it is collected.",
        "PreStocks' valuation is PreStocks' own figure — never called a fair price or a market price.",
        "Ryntra, the AI assistant, reads the same sources and gives each figure with its source and time.",
      ],
    },
    more: {
      title: "Read more",
      links: [
        { href: "/docs/invest/what-you-buy", label: "What you actually buy" },
        { href: "/docs/reference/fees", label: "Fees" },
        { href: "/stats", label: "Stats" },
        { href: "/security", label: "Security" },
      ],
    },
  },
  uk: {
    meta: {
      title: "Звідки цифри в Ryntra — джерела й час даних",
      description: "Кожна цифра в Ryntra і її джерело: ціни — від емітентів і Jupiter, факти компаній — зі звітів SEC, оцінка PreStocks, комісії — з ланцюга.",
    },
    hero: {
      eyebrow: "Джерела",
      title: "Звідки кожна цифра.",
      lead: "Кожне число в Ryntra має джерело й час. Ось кожне — і що робить Ryntra, коли джерело мовчить.",
    },
    head: { figure: "Цифра", source: "Джерело", when: "Коли" },
    groups: [
      {
        id: "company",
        title: "На сторінці компанії",
        rows: [
          ["Ціна й зміна за день", "Jupiter — ринкова ціна токена", "Наживо, час — під цифрами"],
          ["Лінія за день, тиждень, місяць чи рік", "GeckoTerminal — ціна пулу токена", "Прив'язана до ціни сторінки"],
          ["Ключові показники — виторг, прибуток, ринкова вартість, P/E, дивіденди", "Звіти компанії до SEC, прочитані в дані з датою; ринкова вартість і P/E рахуються від ціни емітента за одну акцію", "Період звіту й день читання"],
          ["Про компанію — галузь, біржа, місто", "Записи компанії в SEC і каталог емітента", "З останнім звітом"],
          ["Що ти купуєш — мітка, забезпечення, дивіденди", "Власні документи емітента й звіт про резерви; множник — з ланцюга", "Резерви — з датою емітента"],
          ["Комісія емітента на переказ", "Власні налаштування токена в ланцюгу", "На мить читання"],
          ["Торги на Solana · 24 год — обсяг, ліквідність, власники, трейдери", "Ринкові дані Jupiter", "З часом читання"],
          ["Оцінка приватної компанії", "PreStocks — власна оцінка емітента, не «справедлива ціна»", "З часом читання"],
          ["Шлях компанії — приватна, IPO, біржа, Solana", "Сторінки емітентів і джерела, названі в «Джерелах»", "Кожен крок — зі своєю датою"],
        ],
      },
      {
        id: "review",
        title: "У «Перевірці», до підпису",
        rows: [
          ["Спишеться · Отримаєш щонайменше", "Котирування Jupiter на твою суму, симульоване в живій мережі", "До підпису; застаріла ціна просить оновити"],
          ["Усі витрати", `Комісія Ryntra — ${FEES_UK.swap}, з політики самого продукту, — комісії всередині маршруту, вплив на ціну й плата мережі із симуляції`, "Кожна — до підпису"],
          ["Разовий резерв рахунку", "Те, що мережа лишає для нового рахунку токена у твоєму гаманці, — твоє, не комісія", "Лише на першій купівлі токена"],
          ["«Умова ціни»", "Орієнтир — оцінка PreStocks чи орієнтир емітента — і наскільки ціна від нього відходить", `Дані, старші за ${AUTOINVEST.conditionMaxAgeMinutes} хвилин, вважаються застарілими`],
        ],
      },
      {
        id: "portfolio",
        title: "У Портфелі й Історії",
        rows: [
          ["Що в тебе є", "Прочитано з ланцюга для твого гаманця", "Щоразу, як відкриваєш"],
          ["Скільки це коштує", "Твоє за ціною Jupiter; актив без ціни — риска", "З часом ціни"],
          ["Квитанція", "Перевірене поруч із тим, що підтвердив ланцюг, — транзакція, суми, час", "Коли мережа підтверджує"],
          ["Винагороди", "Комісії, які Ryntra справді зібрала, — з її власного обліку", "Після завершення операції"],
          ["Статистика", "Кожна операція через Ryntra — з обліку, звірена з публічними транзакціями Solana", "Наживо"],
        ],
      },
    ],
    rules: {
      eyebrow: "Правила",
      title: "Коли джерело мовчить",
      items: [
        "Кожна цифра називає джерело й час.",
        "Невідоме — риска, ніколи не нуль; відсутня ціна ніколи не стає здогадом.",
        "Котирування ніколи не видається за результат, а комісія не рахується, доки її не зібрано.",
        "Оцінка PreStocks — власна цифра PreStocks, її ніколи не звуть справедливою чи ринковою ціною.",
        "Ryntra — ШІ-помічник — читає ті самі джерела й дає кожну цифру з джерелом і часом.",
      ],
    },
    more: {
      title: "Читати далі",
      links: [
        { href: "/docs/invest/what-you-buy", label: "Що ти насправді купуєш" },
        { href: "/docs/reference/fees", label: "Комісії" },
        { href: "/stats", label: "Статистика" },
        { href: "/security", label: "Безпека" },
      ],
    },
  },
};

export function methodologyCopy(locale: MethodologyLocale): MethodologyCopy {
  return METHODOLOGY_COPY[locale];
}
