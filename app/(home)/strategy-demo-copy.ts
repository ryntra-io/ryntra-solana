/**
 * The words of the eight-stage strategy demonstration.
 *
 * Two rules, both from the owner review of 2026-09-09.
 *
 * **Concrete, not descriptive.** "Entry — within the reviewed limit" describes
 * a field; "Max entry 200 USDC per SOL, current estimate 203" shows the product
 * behaving. Every figure is illustrative and the section says so once.
 *
 * **The outcome must match the decision that was actually made.** Choosing to
 * watch is not a trade. Results after watching reports an entry condition that
 * was never met and a budget that was never committed — it must never show an
 * "actual entry" or an execution cost for a trade nobody made.
 */

/** The one worked example, so every surface quotes the same numbers. */
export const EXAMPLE = {
  maxEntry: 200,
  estimateWithin: 198,
  estimateOutside: 203,
  invalidation: 185,
} as const;

export const DEMO_COPY = {
  en: {
    next: "Next", back: "Previous", reset: "Restart", change: "Change condition",
    choose: "Choose a stage", stageOf: "Stage",
    version: "Version",

    reviewTitle: "Review required",
    reviewBody: `The estimate is ${EXAMPLE.estimateOutside} USDC per SOL and your limit is ${EXAMPLE.maxEntry}. Nothing is prepared on the old terms.`,
    review: "Review updated terms",
    watch: "Watch these conditions", edit: "Change the budget", reject: "Reject the idea",
    decisionHint: "Nothing here is signed or sent. Your wallet is never asked.",

    ideaQuote: "I want to buy SOL — but only under 200.",
    ideaBody: "Write the idea down before the market gives you a reason to change it, and name both sides of it now, while you hold no position.",
    ideaRows: [
      { label: "Would support it", value: "Demand that outlives the headline" },
      { label: "Would disprove it", value: "The move fades on falling volume" },
    ],

    researchBody: "Keep what you observed apart from what you assumed.",
    researchRows: [
      { label: "Source", value: "Named exchange listing, 2 days ago" },
      { label: "Market reaction", value: "Already moved +7%" },
      { label: "Still unknown", value: "Whether the demand holds" },
    ],

    criticQuote: "Part of that move is already in the price.",
    criticBody: "A plausible story is not an edge. The objection is stated before any money is committed, so you answer it while answering is still free.",

    riskHeading: "Checked before anything is prepared",
    riskRows: [
      { label: "Budget", value: "25 of 650 USDC · 3.8%", tone: "ok" as const },
      { label: "Max entry", value: `${EXAMPLE.maxEntry} USDC per SOL`, tone: "ok" as const },
      { label: "Invalidation", value: `${EXAMPLE.invalidation} USDC per SOL`, tone: "ok" as const },
      { label: "Liquidity", value: "Quote required at signing", tone: "attention" as const },
      { label: "Unknowns", value: "2 — named above", tone: "unknown" as const },
    ],

    strategyBody: "These are the conditions you would be trading on. Change one and it becomes a new version.",
    strategyBudget: "Budget",

    decisionBody: "A proposal is not permission to trade. Watch these conditions, change the budget, or reject the idea.",

    monitorWatching: `Your conditions are being watched. If the estimate leaves ${EXAMPLE.maxEntry}, the plan stops and asks for a new review instead of buying anyway.`,
    monitorPending: "Watching starts only after your decision.",
    monitorRows: (version: number, estimate: number, watching: boolean) => [
      { label: "Approved version", value: watching ? String(version) : "None" },
      { label: "Estimate", value: `${estimate} USDC per SOL` },
      { label: "Entry condition", value: watching ? (estimate <= EXAMPLE.maxEntry ? "Holding" : "Broken") : "Not approved" },
    ],

    /* Three outcomes, because there are three things the reader can have done. */
    resultUndecided: "No decision was made, so there is no outcome. Go back to your decision and choose.",
    resultRejected: "Idea rejected, and nothing follows from it. The reasoning is kept, so the next version starts from a decision rather than a blank page.",
    /* Two honest paths, because the example has two. If the estimate never left
       the range there is nothing to report yet; if it did, the report is that
       the rule stopped the trade. Neither path may imply an execution. */
    resultStoppedTitle: "No trade was made.",
    resultStoppedBody: `The estimate moved to ${EXAMPLE.estimateOutside} USDC per SOL, above the ${EXAMPLE.maxEntry} you set, so nothing was prepared on the old terms. The rule held, and no money went into an idea that had stopped matching your conditions.`,
    resultStoppedRows: (budget: number) => [
      { label: "Planned entry", value: `at or under ${EXAMPLE.maxEntry} USDC per SOL` },
      { label: "Estimate that stopped it", value: `${EXAMPLE.estimateOutside} USDC per SOL` },
      { label: "Committed", value: `0 of ${budget} USDC` },
      { label: "Kept for next time", value: "The conditions, and why they changed" },
    ],
    resultWaitingTitle: "Nothing has happened yet.",
    resultWaitingBody: `The estimate is ${EXAMPLE.estimateWithin} USDC per SOL, inside the ${EXAMPLE.maxEntry} you set. The plan is waiting, and it asks for your confirmation before anything is prepared — it never buys on its own.`,
    resultWaitingRows: (budget: number) => [
      { label: "Planned entry", value: `at or under ${EXAMPLE.maxEntry} USDC per SOL` },
      { label: "Current estimate", value: `${EXAMPLE.estimateWithin} USDC per SOL` },
      { label: "Committed", value: `0 of ${budget} USDC` },
      { label: "Next", value: "Your confirmation, before anything is prepared" },
    ],
    resultHint: "Following your own rules and making a profit are different results. Both are worth recording.",

    steps: [
      { title: "Idea", short: "What you want to do, and on what terms." },
      { title: "Research", short: "Source, market reaction, what is still unknown." },
      { title: "Critic", short: "The strongest objection, before you act." },
      { title: "Risk", short: "Budget, entry limit, invalidation, liquidity." },
      { title: "Strategy", short: "The conditions you would trade on." },
      { title: "Your decision", short: "Watch, change or reject. Nothing acts alone." },
      { title: "Monitor", short: "Your conditions, checked against the market." },
      { title: "Results", short: "What happened, and what the next version keeps." },
    ],
  },
  uk: {
    next: "Далі", back: "Назад", reset: "Спочатку", change: "Змінити умову",
    choose: "Виберіть етап", stageOf: "Етап",
    version: "Версія",

    reviewTitle: "Потрібен перегляд",
    reviewBody: `Розрахунок — ${EXAMPLE.estimateOutside} USDC за SOL, ваша межа — ${EXAMPLE.maxEntry}. За старими умовами нічого не готується.`,
    review: "Переглянути змінені умови",
    watch: "Спостерігати за умовами", edit: "Змінити бюджет", reject: "Відхилити ідею",
    decisionHint: "Тут нічого не підписується й не надсилається. Гаманець ні про що не питають.",

    ideaQuote: "Хочу купити SOL — але тільки дешевше за 200.",
    ideaBody: "Запишіть ідею до того, як ринок дасть привід її змінити, і назвіть обидві сторони зараз, поки позиції немає.",
    ideaRows: [
      { label: "Підтвердить ідею", value: "Попит, який переживе заголовок" },
      { label: "Спростує ідею", value: "Рух згасає на спаданні обсягів" },
    ],

    researchBody: "Тримайте побачене окремо від припущеного.",
    researchRows: [
      { label: "Джерело", value: "Названий лістинг біржі, 2 дні тому" },
      { label: "Реакція ринку", value: "Рух уже +7%" },
      { label: "Досі невідомо", value: "Чи втримається попит" },
    ],

    criticQuote: "Частина цього руху вже в ціні.",
    criticBody: "Правдоподібна історія — ще не перевага. Заперечення формулюють до того, як задіяні кошти, щоб відповісти на нього, поки відповідь нічого не коштує.",

    riskHeading: "Перевіряється до того, як щось готується",
    riskRows: [
      { label: "Бюджет", value: "25 з 650 USDC · 3,8%", tone: "ok" as const },
      { label: "Макс. ціна входу", value: `${EXAMPLE.maxEntry} USDC за SOL`, tone: "ok" as const },
      { label: "Умова спростування", value: `${EXAMPLE.invalidation} USDC за SOL`, tone: "ok" as const },
      { label: "Ліквідність", value: "Розрахунок потрібен при підписі", tone: "attention" as const },
      { label: "Невідомі чинники", value: "2 — названі вище", tone: "unknown" as const },
    ],

    strategyBody: "Це умови, на яких ви торгували б. Зміните одну — це вже нова версія.",
    strategyBudget: "Бюджет",

    decisionBody: "Пропозиція не є дозволом торгувати. Спостерігайте за умовами, змініть бюджет або відхиліть ідею.",

    monitorWatching: `За вашими умовами стежать. Якщо розрахунок вийде за ${EXAMPLE.maxEntry}, план зупиниться й попросить новий перегляд, а не купить попри все.`,
    monitorPending: "Спостереження починається лише після вашого рішення.",
    monitorRows: (version: number, estimate: number, watching: boolean) => [
      { label: "Погоджена версія", value: watching ? String(version) : "Немає" },
      { label: "Розрахунок", value: `${estimate} USDC за SOL` },
      { label: "Умова входу", value: watching ? (estimate <= EXAMPLE.maxEntry ? "Витримується" : "Порушена") : "Не погоджено" },
    ],

    resultUndecided: "Рішення не ухвалено, тому й результату немає. Поверніться до свого рішення та оберіть.",
    resultRejected: "Ідею відхилено, і з неї нічого не випливає. Міркування збережено, тож наступна версія починається з рішення, а не з чистого аркуша.",
    resultStoppedTitle: "Угоди не було.",
    resultStoppedBody: `Розрахунок пішов на ${EXAMPLE.estimateOutside} USDC за SOL — вище за ваші ${EXAMPLE.maxEntry}, тому за старими умовами нічого не готувалося. Правило витримало, і жодна копійка не пішла в ідею, яка перестала відповідати вашим умовам.`,
    resultStoppedRows: (budget: number) => [
      { label: "Запланований вхід", value: `не дорожче за ${EXAMPLE.maxEntry} USDC за SOL` },
      { label: "Розрахунок, що зупинив", value: `${EXAMPLE.estimateOutside} USDC за SOL` },
      { label: "Використано", value: `0 з ${budget} USDC` },
      { label: "Збережено на наступний раз", value: "Умови й причина їхньої зміни" },
    ],
    resultWaitingTitle: "Поки нічого не сталося.",
    resultWaitingBody: `Розрахунок — ${EXAMPLE.estimateWithin} USDC за SOL, у межах ваших ${EXAMPLE.maxEntry}. План чекає і попросить вашого підтвердження, перш ніж щось готувати, — сам він не купує.`,
    resultWaitingRows: (budget: number) => [
      { label: "Запланований вхід", value: `не дорожче за ${EXAMPLE.maxEntry} USDC за SOL` },
      { label: "Поточний розрахунок", value: `${EXAMPLE.estimateWithin} USDC за SOL` },
      { label: "Використано", value: `0 з ${budget} USDC` },
      { label: "Далі", value: "Ваше підтвердження, перш ніж щось готувати" },
    ],
    resultHint: "Дотримання власних правил і прибуток — різні результати. Обидва варто фіксувати.",

    steps: [
      { title: "Ідея", short: "Що саме ви хочете зробити і на яких умовах." },
      { title: "Дослідження", short: "Джерело, реакція ринку, що досі невідомо." },
      { title: "Критик", short: "Найсильніше заперечення — до дії." },
      { title: "Ризик", short: "Бюджет, межа входу, спростування, ліквідність." },
      { title: "Стратегія", short: "Умови, на яких ви торгували б." },
      { title: "Ваше рішення", short: "Спостерігати, змінити або відхилити." },
      { title: "Спостереження", short: "Ваші умови проти реального ринку." },
      { title: "Результати", short: "Що сталося і що бере наступна версія." },
    ],
  },
} as const;
