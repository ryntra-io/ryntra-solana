import type { PublicLocale } from "./locale.ts";
import type { ProductMapLabel } from "./product-map.ts";

/**
 * Copy for the two public surfaces `RYN-PUBLIC-SITE-PRODUCT-MAP-001` builds.
 *
 * Its own file rather than a wing of `PUBLIC_COPY`, which already carries the
 * homepage, the chrome, the ecosystem cards and the flow scenes. Two surfaces
 * with their own vocabulary get their own table and their own parity test; a
 * two-hundred-key object that everything appends to is how a copy deck stops
 * being readable.
 *
 * **Every sentence here is about something that exists.** The product page
 * describes what a person can open today and says plainly which half needs a
 * wallet. The map describes the accepted direction and never claims it as live
 * — that is the whole reason the map is a separate surface from the rail.
 */
export type ProductCopy = Readonly<{
  /* --- the product page ------------------------------------------------- */
  eyebrow: string;
  title: string;
  titleAccent: string;
  lead: string;
  open: string;
  openMap: string;

  noWalletTitle: string;
  noWalletLead: string;

  marketsName: string;
  marketsBody: string;
  swapName: string;
  swapBody: string;
  passportName: string;
  passportBody: string;

  walletTitle: string;
  walletLead: string;
  portfolioName: string;
  portfolioBody: string;
  moneyName: string;
  moneyBody: string;
  activityName: string;
  activityBody: string;

  controlTitle: string;
  controlLead: string;

  shapeTitle: string;
  shapeLead: string;
  shapeLocale: string;
  shapeDepth: string;
  shapePhone: string;

  boundaryTitle: string;
  boundaryBody: string;

  /* --- the product map -------------------------------------------------- */
  mapEyebrow: string;
  mapTitle: string;
  mapLead: string;
  mapRailNote: string;
  mapOpens: string;
  labels: Readonly<Record<ProductMapLabel, string>>;
  labelNotes: Readonly<Record<ProductMapLabel, string>>;
}>;

const EN: ProductCopy = {
  eyebrow: "ONE PRODUCT ON SOLANA",
  title: "Everything you can do",
  titleAccent: "right now.",
  lead:
    "Trading tools, your portfolio and saved plans in one workspace. Each capability keeps its own availability status.",
  open: "Open Ryntra",
  openMap: "See the Product Map",

  noWalletTitle: "Opens with no account and no wallet",
  noWalletLead:
    "Explore public asset data and Swap estimates without an account. Confirm transactions with your own wallet.",

  marketsName: "Markets",
  marketsBody:
    "What each token's issuer can still do to a balance you hold — create more, freeze it, or change what a transfer actually delivers — read from every mint account on the visit, beside today's price.",
  swapName: "Swap",
  swapBody:
    "Review a supported pair, its estimate and the costs shown before confirmation. Your wallet signs the transaction after you review its terms.",
  passportName: "Asset details",
  passportBody:
    "Inspect a supported asset’s identity, issuer controls and transfer conditions. Missing or unsupported data stays explicit.",

  walletTitle: "What your own wallet adds",
  walletLead:
    "Connect and these are yours. Ryntra holds no key, sees no seed phrase and moves nothing on its own.",
  portfolioName: "Portfolio",
  portfolioBody:
    "What you hold and what it is worth, with what could not be priced counted separately — an unknown price is never rendered as zero.",
  moneyName: "Money",
  moneyBody:
    "Send, receive and bridge in one domain. USDC moves between Solana and Base in either direction, for an amount you choose, and a transfer that stops half-way can be recovered.",
  activityName: "Activity",
  activityBody:
    "Review confirmed and pending operations, their costs and observed outcomes. Transaction details remain in Activity.",

  controlTitle: "Trading plans and their versions",
  controlLead:
    "Your private workspace keeps saved plans and their versions. The complete research, strategy review and outcome-analysis cycle is still being developed.",

  shapeTitle: "It fits the way you work",
  shapeLead:
    "Ukrainian and English throughout. Simple and Pro reach the same routes — Pro shows more of the same truth, never a longer menu. Every domain works on a phone.",
  shapeLocale: "Ukrainian and English",
  shapeDepth: "Simple and Pro, same routes",
  shapePhone: "Built for a phone too",

  boundaryTitle: "Your wallet. Your confirmation.",
  boundaryBody:
    "Holds no key and requests none. Never sees a seed phrase. Your own wallet signs every transfer, one transaction at a time, after you have seen the exact amounts.",

  mapEyebrow: "PRODUCT MAP",
  mapTitle: "Everything accepted,",
  mapLead:
    "The whole direction of the product, including what is not built. Working navigation carries only routes that open; this page carries the rest, so that leaving something out of the menu never quietly removed it from the plan.",
  mapRailNote:
    "Nothing on this page is a promise of a date. A capability moves when its work is done, not when a calendar says so.",
  mapOpens: "Open",
  labels: {
    AVAILABLE: "Available",
    LIMITED: "Limited",
    BUILDING: "In development",
    PLANNED: "Planned",
    PARKED: "Parked",
    RESEARCH: "Research",
  },
  labelNotes: {
    AVAILABLE: "Open it today and use it.",
    LIMITED: "Opens, and does less than it will.",
    BUILDING: "Active work.",
    PLANNED: "Accepted direction, not started.",
    PARKED: "Waiting on a named condition.",
    RESEARCH: "Being studied, not committed to.",
  },
};

const UK: ProductCopy = {
  eyebrow: "ОДИН ПРОДУКТ НА SOLANA",
  title: "Усе, що можна зробити",
  titleAccent: "просто зараз.",
  lead:
    "Торгові інструменти, портфель і збережені плани в одному кабінеті. Готовність зазначена для кожної можливості.",
  open: "Відкрити Ryntra",
  openMap: "Дивитися Карту продукту",

  noWalletTitle: "Відкривається без акаунта й без гаманця",
  noWalletLead:
    "Переглядайте публічні дані активів і розрахунок обміну без акаунта. Операції підтверджуйте власним гаманцем.",

  marketsName: "Ринки",
  marketsBody:
    "Що емітент кожного токена ще може зробити з вашим балансом — випустити більше, заморозити його або змінити те, що насправді дійде переказом — прочитане з кожного мінт-акаунта під час візиту, поруч із сьогоднішньою ціною.",
  swapName: "Обмін",
  swapBody:
    "Перегляньте підтримувану пару, розрахунок і витрати перед підтвердженням. Після перевірки умов підписуєте операцію власним гаманцем.",
  passportName: "Відомості про актив",
  passportBody:
    "Переглядайте дані підтримуваного активу, повноваження емітента й умови переказу. Відсутня чи непідтримувана інформація залишається позначеною.",

  walletTitle: "Що додає ваш власний гаманець",
  walletLead:
    "Підключіть — і це ваше. Ryntra не тримає ключа, не бачить сід-фрази й нічого не переміщує самостійно.",
  portfolioName: "Портфель",
  portfolioBody:
    "Що ви тримаєте і скільки це коштує, з окремо порахованим тим, чому не знайшлося ціни — невідома ціна ніколи не показується як нуль.",
  moneyName: "Кошти",
  moneyBody:
    "Надіслати, отримати й перенести — в одному домені. USDC ходить між Solana і Base в обидва боки, на суму, яку обираєте ви, а переказ, що спинився на півдорозі, можна відновити.",
  activityName: "Історія",
  activityBody:
    "Переглядайте підтверджені й незавершені операції, витрати та спостережені результати. Деталі залишаються в історії операцій.",

  controlTitle: "Торгові плани та їхні версії",
  controlLead:
    "Особистий кабінет зберігає плани та їхні версії. Повний цикл дослідження, перевірки стратегій та аналізу результатів ще розробляється.",

  shapeTitle: "Підлаштовується під те, як ви працюєте",
  shapeLead:
    "Українська та англійська всюди. Простий і Профі відкривають ті самі маршрути — Профі показує більше тієї ж правди, а не довше меню. Кожен домен працює на телефоні.",
  shapeLocale: "Українська та англійська",
  shapeDepth: "Простий і Профі, ті самі маршрути",
  shapePhone: "Зроблено й для телефона",

  boundaryTitle: "Ваш гаманець. Ваше підтвердження.",
  boundaryBody:
    "Не зберігає ключів і не запитує їх. Ніколи не бачить сід-фрази. Кожен переказ підписує ваш власний гаманець, по одній транзакції, після того як ви побачили точні суми.",

  mapEyebrow: "КАРТА ПРОДУКТУ",
  mapTitle: "Усе прийняте,",
  mapLead:
    "Можливості продукту та їхня готовність. Заплановані функції позначені; підтримка залежить від активу, маршруту й інструмента.",
  mapRailNote:
    "Позначка «Заплановано» означає, що можливість ще недоступна.",
  mapOpens: "Відкрити",
  labels: {
    AVAILABLE: "Доступно",
    LIMITED: "Обмежено",
    BUILDING: "У розробці",
    PLANNED: "Заплановано",
    PARKED: "Призупинено",
    RESEARCH: "Дослідження",
  },
  labelNotes: {
    AVAILABLE: "Відкривайте й користуйтеся вже.",
    LIMITED: "Відкривається і вміє менше, ніж буде.",
    BUILDING: "Активна робота.",
    PLANNED: "Прийнятий напрямок, ще не розпочато.",
    PARKED: "Чекає на названу умову.",
    RESEARCH: "Вивчається, зобов'язань немає.",
  },
};

export const PRODUCT_COPY: Readonly<Record<PublicLocale, ProductCopy>> = { en: EN, uk: UK };

export function productCopy(locale: PublicLocale): ProductCopy {
  return PRODUCT_COPY[locale] ?? EN;
}
