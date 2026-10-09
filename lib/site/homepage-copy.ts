/**
 * The public homepage's words, in one place.
 *
 * Everything the outside world reads about Ryntra resolves from here: the page
 * itself, `app/seo.ts` (title, description, Open Graph, Twitter), the two
 * native share images and the landing JSON-LD. One source, so a positioning
 * change cannot land on the page and miss the share card.
 *
 * Positioning v3 (2026-09-08): Ryntra is a professional trading and strategy
 * platform for Solana. The claim is that a person can reduce avoidable
 * mistakes, define risk before execution, keep the strategy context after the
 * trade and improve from real results — never that Ryntra preserves capital,
 * prevents losses or predicts a market.
 *
 * On 2026-09-26 that line was replaced on everything the outside world reads:
 * the title, the description, the share card, the manifest and the structured
 * data say what Ryntra is now — «Ryntra — invest in tokenized stocks from $1,
 * in your own wallet, on Solana» — and `/` leads into the app until the new
 * site is built. The landing's own words below are parked with the landing,
 * and the professional-platform line is gone from them too.
 *
 * Edit pass (review, 2026-09-09): the page explained our method more than it
 * showed the product. Three rules came out of that review and this file is
 * where they are kept.
 *
 *   1. Say the philosophy **once**. The pipeline sentence lives in the hero and
 *      nowhere else; every later section must add something new or go.
 *   2. No internal vocabulary. "Deterministic checks enforce the limits" and
 *      "every status is read from the product registry" are how the thing is
 *      built, not what the reader gets. Precision is professional; a difficult
 *      dictionary is not.
 *   3. Concrete over abstract. "Entry — within the reviewed limit" describes a
 *      field. "Max entry 200 USDC per SOL, current estimate 203, so nothing is
 *      prepared on the old terms" shows the product behaving.
 */

import { localizedPath } from "./localized.ts";

export const HOMEPAGE_CATEGORY = "Tokenized stock investing on Solana";

/** How a checked row reads. Colour is a second cue, never the only one. */
export type RiskTone = "ok" | "attention" | "neutral" | "unknown";

export const HOMEPAGE_COPY = {
  en: {
    /* The slogan kept in tests and code; the listing pack reads it, the
       landing no longer shows it. */
    title: "Trade with a plan. Control the risk.",
    /* The landing's first screen since the new site (2026-09-26): the line
       word for word, one action. */
    titleLines: ["Buy a piece of a company", "from $1 — in your own wallet."],
    /* The one place the whole cycle is spelled out. Nothing below repeats it. */
    lead: "Ryntra lets you invest in tokenized stocks from $1, in your own wallet, on Solana. Research an idea, challenge it before you act, set the conditions you will trade on, and keep the reasoning after the trade so the next version starts from what you learned.",
    open: "Open the app",
    how: "See how it works",
    trust: ["Non-custodial", "You sign every transaction", "No deposits"],
    /* The share card's last line: what the person does and what Ryntra never does. */
    availability: "You sign every purchase. Ryntra never holds your money.",
    /* The one line that says what Ryntra is — the manifest's description and the structured data's slogan. */
    tagline: "Invest in tokenized stocks from $1, in your own wallet, on Solana.",

    /* One product-first composition: the Spot workspace with
       NVDAx open is the focal point, the copy stands beside it, and nothing is
       added — the existing pieces are made stronger. The headline stays
       `titleLines`; the body was shortened; the right rail is three proof
       lines; the strip is four items. */
    hero: {
      eyebrow: "Solana / Stocks / Private companies / Autoinvest / Rewards",
      sub: "Tokenized stocks on Solana — NVIDIA, Apple, the S&P 500 and private companies like OpenAI.",
      lead: "Buy in dollars or turn on Autoinvest. Every cost is in the Review before you sign, and what you buy stays in your own wallet.",
      features: [
        { id: "stocks", title: "Tokenized Stocks on Solana", body: "Trade global markets 24/7 onchain." },
        { id: "strategies", title: "Strategies & Risk Review", body: "Plan smarter. Trade with discipline." },
        { id: "rewards", title: "Rewards: 50% fee rewards + points", body: "Trade, earn, and grow with Ryntra." },
      ],
      open: "Open the app",
      explore: "See the companies",
      tag: "Same markets. A smarter way to trade.",
      builtOn: "Built on",
      rail: ["From $1", "Onchain, 24/7", "Solana mainnet"],
      /* The two cards that grow out of the workspace. The portfolio is a real
         small canary position, not a staged balance. */
      portfolio: { title: "Portfolio", view: "View", today: "today", value: "$13.51", change: "−1.53%",
        rows: [["SOL", 48.2], ["Stocks", 27.6], ["Memes", 12.4], ["USDC", 11.8]] },
      rewards: { title: "Rewards", view: "View",
        rows: [["50%", "Fee cashback", "Eligible fees"], ["10–30%", "Referrals", "By rank"], ["Points", "Points program", "Levels · Rank"]] },
      /* The four ways in along the hero's foot: a company from $1, the rules,
         the private companies, the fee back. */
      strip: [
        { id: "invest", big: "$1", title: "A piece of a company", body: "From $1, in dollars, in your own wallet." },
        { id: "autoinvest", big: "", title: "Autoinvest", body: "Every day, if it falls, from payments." },
        { id: "private", big: "", title: "Private companies", body: "OpenAI, Anthropic and more — PreStocks." },
        { id: "rewards", big: "50%", title: "Fee back + points", body: "And a share for friends you invite." },
      ],
      /* The small line at the strip's end. */
      motto: "You sign every purchase.",
      /* What a screen reader gets instead of the picture. */
      productNote: "The Spot workspace with NVDAx (NVIDIA xStock) open — an illustrative view; the figures are a snapshot, not a live quote.",
      solana: "Solana",
      /* The design render of the hero (2026-09-13 evening), mounted as the
         hero itself. The alt carries what the picture says; the figures in it
         are the render's own and illustrative. */
      imageAlt: "Trade with a plan. Control the risk. Tokenized stocks from $1, in your own wallet, on Solana — the Ryntra Spot workspace with NVDAx (NVIDIA xStock) open, a Portfolio card and a Rewards card, built on Solana; illustrative figures.",
      openArea: "Open App — open the Ryntra workspace",
    },

    /* Section 2 — the market universe: Solana at the centre, the assets that
       trade on Spot in orbit around it. */
    universe: {
      eyebrow: "Built on Solana",
      titleLines: ["Wall Street closes.", "Solana doesn’t."],
      lead: "Tokenized stocks, private companies and crypto on one network that never closes — from $1, whenever it suits you.",
      explore: "See the companies",
      sceneLabel: "Companies and coins orbiting Solana — every one a market in Ryntra",
      kinds: { stock: "Tokenized stock", crypto: "Crypto", meme: "Meme" },
      open: "open on Spot",
      openCompany: "open the company",
      core: "Solana",
    },
    /* The third block — from opportunity to outcome (design brief,
       2026-09-13, late): the six steps of one trade, told once. The words
       are here; the figures in the frame are one illustrative NVDAx trade
       and live in app/(home)/workflow-trade.ts. `surfaces` are the pages of
       the product each step lives on — the frame's first crumb — and the
       readiness beside it comes from the route registry through
       `homepageModel`, in the words of `statuses`. */
    /* How it works, since the new site: one purchase from $1 on the app's
       own road — the company, the sum, the Review, the signature, the receipt
       — and the rule that repeats it. */
    workflow: {
      eyebrow: "How it works",
      titleLines: ["From a dollar", "to a receipt."],
      lead: "You choose the company and the sum, see every cost and sign in your own wallet. Nothing moves without you.",
      railLabel: "The six steps of a purchase",
      steps: [
        { id: "company", label: "Company", title: "Choose a company", body: "NVIDIA, Apple, the S&P 500 or a private company — each with a page of its own.", crumbs: ["NVIDIA"] },
        { id: "sum", label: "$1", title: "Type the sum — from $1", body: "At once you see how much of a share it buys and every cost.", crumbs: ["NVIDIA", "Buy"] },
        { id: "review", label: "Review", title: "Four lines before you sign", body: "You pay · You get · All costs · What it is — nothing else to decode.", crumbs: ["NVIDIA", "Review"] },
        { id: "sign", label: "Signature", title: "You sign in your own wallet", body: "Your Solana wallet signs. Ryntra never holds your money or keys.", crumbs: ["Signature"] },
        { id: "receipt", label: "Receipt", title: "The receipt, from the chain", body: "What was paid and what arrived, read from Solana — kept in History.", crumbs: ["Receipt"] },
        { id: "autoinvest", label: "Autoinvest", title: "Then, by your rule", body: "Every day, if it falls, from payments: Ryntra reminds you, you sign each purchase.", crumbs: ["NVIDIA", "Rule"] },
      ],
      surfaces: { markets: "Markets", company: "Company", wallet: "Your wallet", history: "History", autoinvest: "Autoinvest" },
      /* What a screen reader gets instead of the frame. */
      frameNote: "An illustrative purchase of NVDAx for $1: the figures are examples, not live quotes.",
      closingLines: ["Every purchase has its Review.", "Every purchase has its receipt."],
      open: "Open the app",
    },
    /* The fourth and last block — Ryntra Rewards and the close (design
       brief, 2026-09-14). The three rates are not written here: the fee
       sentence carries `{rate}` and the page fills it from
       app/(home)/rewards-facts.ts, so the words can never say a rate the
       programme does not pay. The points figure on the page is an example
       and is marked as one. `footer` is the landing's own minimal footer,
       rendered by the shared PublicFooter in its landing variant. */
    rewards: {
      eyebrow: "Ryntra Rewards",
      titleLines: ["Buy with Ryntra.", "Up to half the fee back."],
      lead: "Part of Ryntra's own fee comes back to you, the people you invite bring you a share of theirs, and points grow with real activity.",
      panelTitle: "Ryntra Rewards",
      example: "Example",
      segments: {
        fees: { name: "Fee Rewards", body: "Get back up to {rate} of eligible Ryntra service fees." },
        points: { name: "Ryntra Points", body: "Build points from qualified activity, active days and participation.", unit: "PTS", level: "Level", next: "next level at", note: "No cash value · not a token" },
        referral: { name: "Referral Rewards", body: "Earn from the qualified activity of the people you invite to Ryntra.", level1: "Level 1", level2: "Level 2" },
      },
      loopLabel: "How the programme builds",
      loop: ["Buy", "Earn", "Points", "Status"],
      statementLines: ["Your wallet. Your signature.", "From $1."],
      open: "Open the app",
      explore: "See the companies",
      trust: ["Solana Mainnet", "Ryntra never holds your money", "You sign every purchase"],
    },
    footer: {
      nav: "Site",
      links: [
        { label: "Markets", href: "/app/markets" },
        { label: "Autoinvest", href: "/app/autoinvest" },
        { label: "Rewards", href: "/app/rewards" },
        { label: "Docs", href: "/docs" },
        { label: "Stats", href: "/stats" },
      ],
      social: "Elsewhere",
      x: "X / Twitter",
      github: "GitHub",
      legal: [
        { label: "Terms", href: "/legal/terms" },
        { label: "Privacy", href: "/legal/privacy" },
        { label: "Support", href: "/support" },
      ],
      copyright: "© 2026 Ryntra",
    },

    /* What a search result, a shared link and the browser's tab say — the
       line of 2026-09-26, word for word. */
    seoTitle: "Ryntra — invest in tokenized stocks from $1, in your own wallet, on Solana",
    description: "Buy tokenized stocks from $1 on Solana, or set a rule to invest regularly. What you buy stays in your own wallet, and you sign every purchase.",
    ogLines: ["Invest in tokenized", "stocks from $1."],
    ogContext: "In your own wallet, on Solana.",
    ogAlt: "Ryntra — invest in tokenized stocks from $1, in your own wallet, on Solana.",

    /* Section 2 — one strategy, shown before it is explained. */
    demoTitle: "One idea, from the first note to the next version.",
    demoLead: "This is a worked example you can move through. Change a condition and watch what the plan does.",
    demoCaption: "Illustrative example · the figures are not live quotes",

    /* The strategy card that stands above the stages: the state first, the
       walkthrough second. Every figure here is illustrative and says so. */
    planTitle: "Example strategy · SOL",
    planAsset: "Idea",
    planAssetValue: "Buy SOL, in a defined range",
    planBudget: "Budget",
    planMaxEntry: "Max entry",
    planEstimate: "Current estimate",
    planInvalidation: "Invalidation",
    planStateLabel: "State",
    planWithin: "Within your conditions",
    planOutside: "Outside your conditions — review required",
    planWatching: "Watching your conditions",
    planRejected: "Idea rejected — nothing follows",
    planUndecided: "Waiting for your decision",

    tradeTitle: "Trade across Solana from one workspace.",
    tradeBody: "Simple when you want to trade. Professional when you need more control.",
    /* Section 3 — the working surface, not a list of names. */
    ticketTitle: "What you see before you sign",
    ticketTag: "Illustrative",
    ticketRows: [
      { label: "You pay", value: "25 USDC" },
      { label: "You receive", value: "≈ 0.1231 SOL" },
      { label: "Minimum received", value: "0.1225 SOL" },
      { label: "Network fee", value: "≈ 0.00089 SOL" },
    ],
    ticketNote: "Every cost, Ryntra's own fee included, is on the ticket before you sign — and your wallet confirms the terms you reviewed, not a fresh quote.",
    statusColumn: "Status",
    assetsLabel: "Assets and categories",
    assets: { crypto: "Crypto", memes: "Memes", stocks: "Tokenized stocks", rwa: "RWA", stables: "Stablecoins" },
    surfacesLabel: "Trading",
    workspaceLabel: "Also in the workspace",
    statuses: { AVAILABLE: "Available", SUPPORTED_ROUTES: "Supported routes", BUILDING: "In development", PLANNED: "Planned", LIMITED: "Limited", PARKED: "Parked", RESEARCH: "Research", UNAVAILABLE: "Unavailable" },

    /* Section 4 — what the previous version of this page did not show: a
       strategy that remembers, and a reason to come back. */
    versionsTitle: "A strategy remembers why you changed it.",
    versionsLead: "Conditions change. The plan changes with them — and keeps the reason, so the next version starts from a decision rather than a blank page.",
    versionsColumns: [
      {
        tag: "Version 1",
        rows: [
          { label: "Budget", value: "25 USDC" },
          { label: "Max entry", value: "200 USDC per SOL" },
          { label: "Invalidation", value: "185 USDC per SOL" },
        ],
      },
      {
        tag: "What changed",
        rows: [
          { label: "Estimate", value: "203 USDC per SOL" },
          { label: "Outcome", value: "Entry condition never met" },
          { label: "Committed", value: "0 of 25 USDC" },
        ],
      },
      {
        tag: "Version 2",
        rows: [
          { label: "Budget", value: "15 USDC" },
          { label: "Max entry", value: "196 USDC per SOL" },
          { label: "Invalidation", value: "182 USDC per SOL" },
        ],
      },
    ],
    versionsReasonLabel: "Reason kept with the version",
    versionsReason: "Part of the move was already priced in, so the second version commits less and waits for a better entry.",
    versionsNote: "You set the conditions and your wallet confirms every transaction. Ryntra does not predict a market and cannot remove market losses.",
    documentation: "Documentation",
    readDocs: "Read the documentation",

    final: "Start with the market. Keep what you learn.",
    finalBody: "",
  },
  uk: {
    title: "Торгуйте за планом. Контролюйте ризик.",
    titleLines: ["Купи частинку компанії", "від $1 — у своєму гаманці."],
    lead: "Ryntra — токенізовані акції від $1 у своєму гаманці на Solana. Дослідіть ідею, перевірте її до дії, задайте умови, на яких готові торгувати, і збережіть міркування після операції — щоб наступна версія починалася з висновку, а не з чистого аркуша.",
    open: "Відкрити застосунок",
    how: "Як це працює",
    trust: ["Без кастодіального зберігання", "Кожну операцію підписуєте ви", "Без депозитів"],
    availability: "Кожну купівлю підписуєш ти. Ryntra не тримає твоїх грошей.",
    tagline: "Інвестуй у токенізовані акції від $1, у своєму гаманці, на Solana.",

    hero: {
      eyebrow: "Solana / Акції / Приватні компанії / Автоінвест / Винагороди",
      sub: "Токенізовані акції на Solana — NVIDIA, Apple, S&P 500 і приватні компанії, як-от OpenAI.",
      lead: "Купуй у доларах або ввімкни «Автоінвест». Усі витрати видно в «Перевірці» до підпису, а куплене лишається у твоєму гаманці.",
      features: [
        { id: "stocks", title: "Токенізовані акції на Solana", body: "Глобальні ринки 24/7 ончейн." },
        { id: "strategies", title: "Стратегії та перевірка ризику", body: "Плануйте розумніше. Торгуйте дисципліновано." },
        { id: "rewards", title: "Винагороди: 50% комісії + бали", body: "Торгуйте, заробляйте, зростайте з Ryntra." },
      ],
      open: "Відкрити застосунок",
      explore: "Дивитися компанії",
      tag: "Ті самі ринки. Розумніший спосіб торгувати.",
      builtOn: "Побудовано на",
      rail: ["Від $1", "Ончейн, 24/7", "Solana mainnet"],
      portfolio: { title: "Портфель", view: "Відкрити", today: "сьогодні", value: "$13.51", change: "−1.53%",
        rows: [["SOL", 48.2], ["Акції", 27.6], ["Меми", 12.4], ["USDC", 11.8]] },
      rewards: { title: "Винагороди", view: "Відкрити",
        rows: [["50%", "Кешбек з комісії", "Лише прийнятні"], ["10–30%", "Реферали", "За рангом"], ["Points", "Програма балів", "Рівні · Ранг"]] },
      strip: [
        { id: "invest", big: "$1", title: "Частинка компанії", body: "Від $1, у доларах, у твоєму гаманці." },
        { id: "autoinvest", big: "", title: "Автоінвест", body: "Щодня, якщо впаде, з оплат." },
        { id: "private", big: "", title: "Приватні компанії", body: "OpenAI, Anthropic та інші — PreStocks." },
        { id: "rewards", big: "50%", title: "Комісії назад + бали", body: "І частка за друзів, яких запрошуєш." },
      ],
      motto: "Кожну купівлю підписуєш ти.",
      productNote: "Робочий простір Spot із відкритим NVDAx (NVIDIA xStock) — ілюстративний вигляд; цифри є знімком, а не живим котируванням.",
      solana: "Solana",
      imageAlt: "Торгуйте за планом. Контролюйте ризик. Токенізовані акції від $1 у своєму гаманці на Solana — робочий простір Ryntra Spot із відкритим NVDAx (NVIDIA xStock), картки Портфель і Винагороди, побудовано на Solana; цифри ілюстративні.",
      openArea: "Відкрити додаток — перейти в кабінет Ryntra",
    },

    universe: {
      eyebrow: "Побудовано на Solana",
      titleLines: ["Волл-стріт закривається.", "Solana — ні."],
      lead: "Токенізовані акції, приватні компанії й крипта — в одній мережі, що не зачиняється. Від $1, коли зручно тобі.",
      explore: "Дивитися компанії",
      sceneLabel: "Компанії й монети на орбіті Solana — кожна є ринком у Ryntra",
      kinds: { stock: "Токенізована акція", crypto: "Крипта", meme: "Мем" },
      open: "відкрити у Споті",
      openCompany: "відкрити компанію",
      core: "Solana",
    },
    workflow: {
      eyebrow: "Як це працює",
      titleLines: ["Від долара", "до квитанції."],
      lead: "Ти обираєш компанію й суму, бачиш усі витрати й підписуєш у своєму гаманці. Без тебе нічого не рухається.",
      railLabel: "Шість кроків однієї купівлі",
      steps: [
        { id: "company", label: "Компанія", title: "Обери компанію", body: "NVIDIA, Apple, S&P 500 чи приватна компанія — у кожної своя сторінка.", crumbs: ["NVIDIA"] },
        { id: "sum", label: "$1", title: "Введи суму — від $1", body: "Одразу видно, яку частку акції отримаєш, і всі витрати.", crumbs: ["NVIDIA", "Купити"] },
        { id: "review", label: "Перевірка", title: "Чотири рядки до підпису", body: "Спишеться · Отримаєш · Усі витрати · Що це — і нічого розшифровувати.", crumbs: ["NVIDIA", "Перевірка"] },
        { id: "sign", label: "Підпис", title: "Підписуєш у своєму гаманці", body: "Підписує твій гаманець Solana. Ryntra не тримає твоїх коштів і ключів.", crumbs: ["Підпис"] },
        { id: "receipt", label: "Квитанція", title: "Квитанція — з ланцюга", body: "Скільки сплачено й що прийшло — прочитане з Solana й збережене в Історії.", crumbs: ["Квитанція"] },
        { id: "autoinvest", label: "Автоінвест", title: "Далі — за твоїм правилом", body: "Щодня, якщо впаде, з оплат: Ryntra нагадує, кожну купівлю підписуєш ти.", crumbs: ["NVIDIA", "Правило"] },
      ],
      surfaces: { markets: "Ринки", company: "Компанія", wallet: "Твій гаманець", history: "Історія", autoinvest: "Автоінвест" },
      frameNote: "Ілюстративна купівля NVDAx на $1: цифри — приклади, не живі котирування.",
      closingLines: ["У кожної купівлі — «Перевірка».", "У кожної — квитанція."],
      open: "Відкрити застосунок",
    },
    rewards: {
      eyebrow: "Ryntra Rewards",
      titleLines: ["Купуй з Ryntra.", "До половини комісії — назад."],
      lead: "Частина комісії Ryntra повертається тобі, друзі, яких ти запрошуєш, приносять тобі частку їхньої, а бали ростуть зі справжньою активністю.",
      panelTitle: "Ryntra Rewards",
      example: "Приклад",
      segments: {
        fees: { name: "Повернення комісії", body: "Повертай до {rate} прийнятних сервісних комісій Ryntra." },
        points: { name: "Бали Ryntra", body: "Накопичуй бали за кваліфіковану активність, активні дні та участь.", unit: "БАЛІВ", level: "Рівень", next: "наступний рівень від", note: "Без грошової вартості · не токен" },
        referral: { name: "Реферальна винагорода", body: "Заробляй із кваліфікованої активності тих, кого запрошуєш у Ryntra.", level1: "Рівень 1", level2: "Рівень 2" },
      },
      loopLabel: "Як росте програма",
      loop: ["Купівля", "Винагорода", "Бали", "Статус"],
      statementLines: ["Твій гаманець. Твій підпис.", "Від $1."],
      open: "Відкрити застосунок",
      explore: "Дивитися компанії",
      trust: ["Solana Mainnet", "Ryntra не тримає твоїх коштів", "Кожну купівлю підписуєш ти"],
    },
    footer: {
      nav: "Сайт",
      links: [
        { label: "Ринки", href: "/app/markets" },
        { label: "Автоінвест", href: "/app/autoinvest" },
        { label: "Винагороди", href: "/app/rewards" },
        { label: "Документація", href: "/docs" },
        { label: "Статистика", href: "/stats" },
      ],
      social: "Ми в мережі",
      x: "X / Twitter",
      github: "GitHub",
      legal: [
        { label: "Умови", href: "/legal/terms" },
        { label: "Приватність", href: "/legal/privacy" },
        { label: "Підтримка", href: "/support" },
      ],
      copyright: "© 2026 Ryntra",
    },

    seoTitle: "Ryntra — інвестуй у токенізовані акції від $1, у своєму гаманці, на Solana",
    description: "Купуй токенізовані акції від $1 на Solana або налаштуй правило, щоб інвестувати регулярно. Куплене лишається у твоєму гаманці, кожну купівлю підписуєш ти.",
    ogLines: ["Інвестуй у токенізовані", "акції від $1."],
    ogContext: "У своєму гаманці, на Solana.",
    ogAlt: "Ryntra — інвестуй у токенізовані акції від $1, у своєму гаманці, на Solana.",

    demoTitle: "Одна ідея — від першої нотатки до наступної версії.",
    demoLead: "Це розібраний приклад, який можна пройти. Змініть умову — і подивіться, що робить план.",
    demoCaption: "Умовний приклад · цифри — не живі котирування",

    planTitle: "Приклад стратегії · SOL",
    planAsset: "Ідея",
    planAssetValue: "Купити SOL у заданому діапазоні",
    planBudget: "Бюджет",
    planMaxEntry: "Макс. ціна входу",
    planEstimate: "Поточний розрахунок",
    planInvalidation: "Умова спростування",
    planStateLabel: "Стан",
    planWithin: "У межах ваших умов",
    planOutside: "Поза вашими умовами — потрібен перегляд",
    planWatching: "Спостерігаємо за вашими умовами",
    planRejected: "Ідею відхилено — далі нічого немає",
    planUndecided: "Чекає на ваше рішення",

    tradeTitle: "Торгівля на Solana в одному просторі.",
    tradeBody: "Просто, коли треба торгувати. Професійно, коли потрібен контроль.",
    ticketTitle: "Що ви бачите до підпису",
    ticketTag: "Умовний приклад",
    ticketRows: [
      { label: "Ви платите", value: "25 USDC" },
      { label: "Ви отримуєте", value: "≈ 0,1231 SOL" },
      { label: "Мінімум до отримання", value: "0,1225 SOL" },
      { label: "Комісія мережі", value: "≈ 0,00089 SOL" },
    ],
    ticketNote: "Усі витрати, разом із власною комісією Ryntra, є на квитку до підпису — і гаманець підтверджує саме ті умови, які ви переглянули, а не новий розрахунок.",
    statusColumn: "Статус",
    assetsLabel: "Активи та категорії",
    assets: { crypto: "Криптоактиви", memes: "Мемкоїни", stocks: "Токенізовані акції", rwa: "RWA", stables: "Стейблкоїни" },
    surfacesLabel: "Торгівля",
    workspaceLabel: "Також у робочому просторі",
    statuses: { AVAILABLE: "Доступно", SUPPORTED_ROUTES: "Підтримувані маршрути", BUILDING: "У розробці", PLANNED: "Заплановано", LIMITED: "Обмежено", PARKED: "Призупинено", RESEARCH: "Дослідження", UNAVAILABLE: "Недоступно" },

    versionsTitle: "Стратегія пам’ятає, чому ви її змінили.",
    versionsLead: "Умови змінюються — план змінюється разом із ними й зберігає причину, щоб наступна версія починалася з рішення, а не з чистого аркуша.",
    versionsColumns: [
      {
        tag: "Версія 1",
        rows: [
          { label: "Бюджет", value: "25 USDC" },
          { label: "Макс. ціна входу", value: "200 USDC за SOL" },
          { label: "Умова спростування", value: "185 USDC за SOL" },
        ],
      },
      {
        tag: "Що змінилося",
        rows: [
          { label: "Розрахунок", value: "203 USDC за SOL" },
          { label: "Підсумок", value: "Умова входу не виконалася" },
          { label: "Використано", value: "0 з 25 USDC" },
        ],
      },
      {
        tag: "Версія 2",
        rows: [
          { label: "Бюджет", value: "15 USDC" },
          { label: "Макс. ціна входу", value: "196 USDC за SOL" },
          { label: "Умова спростування", value: "182 USDC за SOL" },
        ],
      },
    ],
    versionsReasonLabel: "Причина збережена з версією",
    versionsReason: "Частину руху ринок уже врахував, тому друга версія ризикує меншим і чекає на кращий вхід.",
    versionsNote: "Умови задаєте ви, і кожну операцію підтверджує ваш гаманець. Ryntra не передбачає ринок і не усуває ринкових збитків.",
    documentation: "Документація",
    readDocs: "Переглянути документацію",

    final: "Почніть із ринку. Зберігайте те, що зрозуміли.",
    finalBody: "",
  },
} as const;

/**
 * The site's one menu: the footer's five ways in across the middle of every
 * public page's bar and one *Open Ryntra* on its right — on the landing, on
 * the documentation, on every page the public header draws. One list, so the
 * bar and the footer cannot name different doors.
 */
export type SiteMenu = Readonly<{
  nav: string;
  links: readonly Readonly<{ label: string; href: string }>[];
  open: Readonly<{ label: string; href: string }>;
}>;

export function siteMenu(locale: keyof typeof HOMEPAGE_COPY): SiteMenu {
  const copy = HOMEPAGE_COPY[locale];
  /* Each door at the reader's language's address — `/uk/docs`, `/uk/app/home` —
     where the page has one (`lib/site/localized.ts`). */
  return {
    nav: copy.footer.nav,
    links: copy.footer.links.map((link) => ({ ...link, href: localizedPath(link.href, locale) })),
    open: { label: copy.open, href: localizedPath("/app/home", locale) },
  };
}

/** The one footer's words: the same list, the two accounts, the legal pair and the year. */
export type SiteFooter = (typeof HOMEPAGE_COPY)[keyof typeof HOMEPAGE_COPY]["footer"];

export function siteFooter(locale: keyof typeof HOMEPAGE_COPY): SiteFooter {
  return HOMEPAGE_COPY[locale].footer;
}
