import type { Copy } from '../../lib/i18n.ts'

/**
 * Every word «Автоінвест» says on the phone, in
 * both languages — the web app's own for the same sheet, card and block
 * (`app/app/invest/invest-words.ts`), so the phone and ryntra.io say the same
 * thing. The web's words: «Автоінвест» · «Щотижня» · «Якщо впаде на 5 %» ·
 * «Бюджет місяця» · «Ryntra нагадає — ти підтвердиш одним дотиком» · «Гроші
 * лишаються у твоєму гаманці»; never DCA, trigger, «купує автоматично» or a
 * promise of a price or a profit. «Автоінвест» made clear: the rule's sum is «Кожна купівля», the budget's «Не більше на
 * місяць», the budget its own line — «Бюджет не задано · Задати» — and while
 * a rule's reminder is open its purchase is «Купити $20 за правилом», an
 * ordinary one saying the reminder stays open. «З кожної оплати»
 * in the web's words — «З оплат» · «Що відкладати» · «Накопичено» ·
 * «Нагадаю від» · «Мій рахунок». Four phrases are the phone's own:
 * `reminderClosedDip` — a fall's rule has no day for the next reminder to
 * come on (the web has no phrase for it) — and `reminderClosedPayments`
 * likewise for a rule that gathers from payments, `fixedBounds` where the web
 * says «Мінімум — $1» under a sum whose least is $0,10, and
 * `signInForRules`, where the web asks the wallet's proof and the phone its
 * sign-in.
 */
export type AutoinvestCopy = Readonly<{
  autoinvest: string
  title: (company: string) => string
  howOften: string
  when: string
  dayOfMonth: string
  dayEarlier: string
  dayLater: string
  timeOfDay: string
  timeHint: string
  firstPurchase: string
  nextPurchase: string
  promise: string
  remindersTelegram: string
  connectTelegram: string
  turnOn: string
  turningOn: string
  on: string
  failed: string
  limit: string
  signInFirst: string
  offline: string
  pause: string
  turnOnAgain: string
  turningOnAgain: string
  pausing: string
  onPause: string
  ruleOn: string
  deleteRule: string
  deleteConfirm: string
  deleteYes: string
  deleting: string
  cancel: string
  changeFailed: string
  done: string
  timeToBuy: string
  lastBought: string
  lastMissed: string
  lastPending: string
  budgetSpent: string
  heldShort: string
  budgetBlocks: string
  rulesStand: string
  buyWeekly: string
  byRule: string
  reminderClosed: string
  reminderClosedDip: string
  reminderBought: string
  reminderPending: string
  rulePaused: string
  ruleGone: string
  ruleReadFailed: string
  ruleMismatch: string
  reading: string
  /* «Якщо впаде» */
  regularly: string
  ifFalls: string
  ruleKind: string
  howFar: string
  fallBy: (pct: string) => string
  referencePoint: string
  priceNow: string
  fromEnabled: string
  fromPurchase: string
  remindAt: string
  remindAtShort: string
  remindAtLine: string
  orLower: string
  priceUnknownNow: string
  /* «Бюджет місяця» */
  monthBudget: string
  thisMonth: string
  of: string
  noBudgetYet: string
  changeBudget: string
  setBudget: string
  removeBudget: string
  save: string
  saving: string
  budgetLine: string
  budgetCounts: string
  budgetFailed: string
  /* Home's and Portfolio's block */
  addRule: string
  noRulesYet: string
  rulesDown: string
  tryAgain: string
  pickCompany: string
  youOwn: string
  popular: string
  allCompanies: string
  ruleOf: (company: string) => string
  signInForRules: string
  /* «Автоінвест» made clear */
  eachPurchase: string
  atMostPerMonth: string
  budgetNotSet: string
  setShort: string
  changeShort: string
  plainPurchase: string
  reminderStaysOpen: string
  reminderOpenHere: string
  plainHereLeavesOpen: string
  buyByRule: (usd: string) => string
  plainLeavesOpen: (usd: string) => string
  /* «Умова ціни»: the rule buys only while the price is within the person's limit of its reference and the data are fresh */
  priceCondition: string
  noCondition: string
  purchaseDeferred: string
  ruleChecksAgain: string
  checksAgainUntil: string
  deferredShort: string
  /* «З кожної оплати»: the wallet's own USDC payments and incoming transfers, gathered to the minimum, then one reminder */
  fromPayments: string
  whatToSetAside: string
  modeRoundup: string
  modeFixed: string
  modePercent: string
  roundUpTo: string
  fromEveryPayment: string
  ofEveryIncoming: string
  gathered: string
  remindFrom: string
  countingSince: string
  /** The quiet door under a «З оплат» rule's sums to what counts as a payment — its words one tap deeper. */
  whatCounts: string
  paymentsCount: string
  incomingCount: string
  recentPayments: string
  recentIncoming: string
  noPaymentsYet: string
  noIncomingYet: string
  paymentWord: string
  incomingWord: string
  solanaPayLabel: string
  inReminder: string
  myAccount: string
  myAccountConfirm: string
  myAccountYes: string
  readPartial: string
  readUnavailable: string
  /** The web's `?` beside what counts («З кожної оплати»), word for word. */
  paymentsHelp: Readonly<{ title: string; short: string; what: string; example: readonly string[]; important: string }>
  /** The phone's own: a sum typed for «$ з оплати» outside its bounds (the web says «Мінімум — $1» there). */
  fixedBounds: (min: string, max: string) => string
  /** The phone's own: a closed reminder of a rule with no day — the next comes once it gathers again. */
  reminderClosedPayments: string
  /* «Регулярна купівля для всього» (1.31.0): any token with liquidity — the floor and the facts of risk before the button */
  pickToken: string
  allTokens: string
  pickTokenFromMarkets: string
  riskFacts: string
  riskAge: string
  riskLiquidity: string
  riskTopHolders: string
  riskMint: string
  riskFreeze: string
  riskOrganic: string
  riskVerified: string
  riskClosed: string
  riskOpen: string
  riskVerifiedYes: string
  riskVerifiedNo: string
  riskNotStated: string
  riskSource: string
  floorTitle: string
  noRuleOnToken: string
  tokenNotSupported: string
  flaggedSuspicious: string
  tokenUnreadable: string
  priceWhenOn: string
  floorRefusesTurnOn: string
  scheduleShort: string
  buyAtMarket: string
}>

export const AUTOINVEST_COPY: Copy<AutoinvestCopy> = {
  en: {
    autoinvest: 'Recurring buy',
    title: (company) => `Recurring buy · ${company}`,
    howOften: 'How often',
    when: 'When',
    dayOfMonth: 'Day of the month',
    dayEarlier: 'An earlier day',
    dayLater: 'A later day',
    timeOfDay: 'Time',
    timeHint: 'hours:minutes, on this phone’s clock',
    firstPurchase: 'First purchase',
    nextPurchase: 'Next purchase',
    promise: 'Ryntra reminds you; your wallet signs each purchase. The money stays in your wallet.',
    remindersTelegram: 'Reminders come to Ryntra and Telegram',
    connectTelegram: 'Connect Telegram so you don’t miss it',
    turnOn: 'Turn on',
    turningOn: 'Turning on…',
    on: 'Recurring buy is on',
    failed: 'The recurring buy could not be turned on. Nothing was bought.',
    limit: 'A wallet holds up to 20 rules — remove one first.',
    signInFirst: 'Sign in with your wallet again, then try once more.',
    offline: 'Ryntra could not be reached. Nothing changed.',
    pause: 'Pause',
    turnOnAgain: 'Turn on again',
    turningOnAgain: 'Turning on…',
    pausing: 'Pausing…',
    onPause: 'Paused',
    ruleOn: 'On',
    deleteRule: 'Delete the rule',
    deleteConfirm: 'Delete this rule? Past purchases stay in History.',
    deleteYes: 'Delete',
    deleting: 'Deleting…',
    cancel: 'Cancel',
    changeFailed: 'The rule could not be changed right now. Try again.',
    done: 'Done',
    timeToBuy: 'Time for your purchase',
    lastBought: 'Bought',
    lastMissed: 'Missed',
    lastPending: 'Purchase on its way',
    budgetSpent: 'Budget spent',
    heldShort: 'Budget spent · until the 1st',
    budgetBlocks: 'This purchase does not fit what is left of the month’s budget.',
    rulesStand: 'Rules stand until the 1st',
    buyWeekly: 'Buy weekly',
    byRule: 'By your rule',
    reminderClosed: 'This reminder has closed. The next one comes on the rule’s day.',
    reminderClosedDip: 'This reminder has closed. The next one comes when the price falls below the line again.',
    reminderBought: 'This reminder’s purchase is already bought.',
    reminderPending: 'A purchase under this reminder is already on its way.',
    rulePaused: 'This rule is paused — no reminders come.',
    ruleGone: 'This rule is no longer in your wallet.',
    ruleReadFailed: 'Your rule could not be read right now.',
    ruleMismatch: 'Buying is not available right now.',
    reading: 'Reading…',
    regularly: 'Regularly',
    ifFalls: 'If it falls',
    ruleKind: 'Kind of rule',
    howFar: 'By how much',
    fallBy: (pct) => `−${pct}`,
    referencePoint: 'Reference point',
    priceNow: 'the price now',
    fromEnabled: 'the price when turned on',
    fromPurchase: 'your last purchase',
    remindAt: 'Ryntra reminds you at',
    remindAtShort: 'reminder at',
    remindAtLine: 'Reminder at',
    orLower: 'or lower',
    priceUnknownNow: 'The price could not be read right now — try again in a moment.',
    monthBudget: 'Monthly budget',
    thisMonth: 'This month',
    of: 'of',
    noBudgetYet: 'no limit',
    changeBudget: 'Change budget',
    setBudget: 'Set a budget',
    removeBudget: 'Remove the budget',
    save: 'Save',
    saving: 'Saving…',
    budgetLine: 'A ceiling for all your rules each month. Once it is reached, rules stand until the 1st.',
    budgetCounts: 'Only finished purchases count; one still on its way counts until it is known.',
    budgetFailed: 'The budget could not be saved right now. Try again.',
    addRule: 'Add a rule',
    noRulesYet:
      'No rules yet. A rule buys a token every day, every week, when the price falls or from every payment — you sign each buy.',
    rulesDown: 'Your rules could not be read right now.',
    tryAgain: 'Try again',
    pickCompany: 'For which company?',
    youOwn: 'You own',
    popular: 'Popular companies',
    allCompanies: 'All companies',
    ruleOf: (company) => `Recurring buy of ${company}`,
    signInForRules: 'Your rules and the month’s budget appear after sign-in.',
    eachPurchase: 'Each purchase',
    atMostPerMonth: 'At most per month',
    budgetNotSet: 'No budget set',
    setShort: 'Set',
    changeShort: 'Change',
    plainPurchase: 'One-off purchase',
    reminderStaysOpen: 'Your rule’s reminder stays open',
    reminderOpenHere: 'Your rule’s reminder is open',
    plainHereLeavesOpen: 'A purchase here does not close it — the rule counts only a purchase by the rule.',
    buyByRule: (usd) => `Buy ${usd} by your rule`,
    plainLeavesOpen: (usd) => `This is a one-off purchase: your rule’s ${usd} reminder stays open.`,
    priceCondition: 'Price condition',
    noCondition: 'No condition',
    purchaseDeferred: 'Purchase deferred',
    ruleChecksAgain: 'The rule checks again while the reminder is open.',
    checksAgainUntil: 'The rule checks again until',
    deferredShort: 'Purchase deferred · the rule checks again',
    fromPayments: 'From payments',
    whatToSetAside: 'What to set aside',
    modeRoundup: 'Round-up',
    modeFixed: '$ per payment',
    modePercent: '% of incoming',
    roundUpTo: 'Round up to',
    fromEveryPayment: 'From every payment',
    ofEveryIncoming: 'Of every incoming transfer',
    gathered: 'Gathered',
    remindFrom: 'Reminder from',
    countingSince: 'Counting since',
    whatCounts: 'What counts',
    paymentsCount:
      'This wallet’s USDC payments from now on. Swaps, Ryntra purchases and transfers between your own accounts don’t count.',
    incomingCount:
      'USDC that comes into this wallet from now on. Swaps, Ryntra sales and transfers between your own accounts don’t count.',
    recentPayments: 'Recent payments',
    recentIncoming: 'Recent incoming transfers',
    noPaymentsYet: 'No payments since the rule was turned on.',
    noIncomingYet: 'No incoming transfers since the rule was turned on.',
    paymentWord: 'Payment',
    incomingWord: 'Incoming',
    solanaPayLabel: 'Solana Pay label',
    inReminder: 'in a reminder',
    myAccount: 'My account',
    myAccountConfirm: 'Don’t count transfers to or from this account — it’s mine',
    myAccountYes: 'Yes, it’s mine',
    readPartial: 'Not every payment could be checked — Ryntra checks again.',
    readUnavailable: 'The wallet can’t be read right now — Ryntra checks again.',
    paymentsHelp: {
      title: 'From every payment',
      short:
        'Sets a little of every USDC payment aside for a company — the money stays in your wallet, and only your signature buys.',
      what: 'Ryntra reads this wallet’s USDC on Solana. A payment is a transfer to someone else that you signed; money that came in is USDC someone else sent you. Each one counts once, from the moment the rule is on. Swaps, Ryntra purchases, bridges and transfers between your own accounts never count. The sum gathers until the minimum, then one reminder opens a fresh Review, and only your signature buys.',
      example: [
        'Round-up to $1: payments of $3.40 and $2.30 → $0.60 + $0.70 = $1.30 → «From payments: $1.30 → Apple».',
      ],
      important:
        'Ryntra never names a shop. A transfer to your other wallet looks like any payment — mark it «My account», and such transfers stop counting.',
    },
    fixedBounds: (min, max) => `From ${min} to ${max} from every payment`,
    reminderClosedPayments: 'This reminder has closed. The next one comes once the rule gathers its sum again.',
    pickToken: 'For which token?',
    allTokens: 'All tokens on Markets',
    pickTokenFromMarkets: 'Pick a token on Markets: «Recurring» stands next to «Market» in its order.',
    riskFacts: 'Facts of risk',
    riskAge: 'On the market',
    riskLiquidity: 'Liquidity',
    riskTopHolders: 'Top 10 holders',
    riskMint: 'Minting more',
    riskFreeze: 'Freezing tokens',
    riskOrganic: 'Organic score',
    riskVerified: 'Jupiter’s list',
    riskClosed: 'closed',
    riskOpen: 'open',
    riskVerifiedYes: 'verified',
    riskVerifiedNo: 'not verified',
    riskNotStated: 'not stated',
    riskSource: 'From Jupiter’s list, read now — facts, not a verdict.',
    floorTitle: 'Floor for a recurring buy',
    noRuleOnToken: 'No recurring buy can be set on this token.',
    tokenNotSupported:
      'Jupiter’s audit flags this token, or Ryntra no longer supports it — the rule can’t be turned on.',
    flaggedSuspicious: 'Jupiter’s own audit flags this token as suspicious.',
    tokenUnreadable: 'The token’s liquidity or price cannot be read right now — try again in a moment.',
    priceWhenOn: 'Price when turned on',
    floorRefusesTurnOn: 'The rule can’t be turned on: the token is under the floor right now.',
    scheduleShort: 'Schedule',
    buyAtMarket: 'Buy at market instead',
  },
  uk: {
    autoinvest: 'Регулярна купівля',
    title: (company) => `Регулярна купівля · ${company}`,
    howOften: 'Як часто',
    when: 'Коли',
    dayOfMonth: 'День місяця',
    dayEarlier: 'Раніший день',
    dayLater: 'Пізніший день',
    timeOfDay: 'Час',
    timeHint: 'години:хвилини, за годинником цього телефона',
    firstPurchase: 'Перша купівля',
    nextPurchase: 'Наступна купівля',
    promise: 'Ryntra нагадає; кожну купівлю підписує твій гаманець. Гроші лишаються в ньому.',
    remindersTelegram: 'Нагадування — у Ryntra і Telegram',
    connectTelegram: 'Підключи Telegram, щоб не пропустити',
    turnOn: 'Увімкнути',
    turningOn: 'Вмикаємо…',
    on: 'Регулярну купівлю увімкнено',
    failed: 'Регулярну купівлю не вдалося увімкнути. Нічого не куплено.',
    limit: 'У гаманці може бути до 20 правил — спершу видали одне.',
    signInFirst: 'Увійди гаманцем ще раз і спробуй знову.',
    offline: 'Немає зв’язку з Ryntra. Нічого не змінилося.',
    pause: 'Пауза',
    turnOnAgain: 'Увімкнути знову',
    turningOnAgain: 'Вмикаємо…',
    pausing: 'Ставимо на паузу…',
    onPause: 'На паузі',
    ruleOn: 'Увімкнено',
    deleteRule: 'Видалити правило',
    deleteConfirm: 'Видалити це правило? Минулі купівлі лишаться в Історії.',
    deleteYes: 'Видалити',
    deleting: 'Видаляємо…',
    cancel: 'Скасувати',
    changeFailed: 'Правило зараз не вдалося змінити. Спробуй ще раз.',
    done: 'Готово',
    timeToBuy: 'Час твоєї покупки',
    lastBought: 'Куплено',
    lastMissed: 'Пропущено',
    lastPending: 'Купівля в дорозі',
    budgetSpent: 'Бюджет вичерпано',
    heldShort: 'Бюджет вичерпано · до 1-го числа',
    budgetBlocks: 'Ця купівля не вміщається в залишок бюджету місяця.',
    rulesStand: 'Правила стоять до 1-го числа',
    buyWeekly: 'Купувати щотижня',
    byRule: 'За правилом',
    reminderClosed: 'Це нагадування вже не діє. Наступне прийде в день правила.',
    reminderClosedDip: 'Це нагадування вже не діє. Наступне прийде, коли ціна знову впаде нижче позначки.',
    reminderBought: 'Купівлю за цим нагадуванням уже зроблено.',
    reminderPending: 'Купівля за цим нагадуванням уже в дорозі.',
    rulePaused: 'Це правило на паузі — нагадування не приходять.',
    ruleGone: 'Цього правила вже немає у твоєму гаманці.',
    ruleReadFailed: 'Правило зараз не вдалося прочитати.',
    ruleMismatch: 'Купівля зараз недоступна.',
    reading: 'Читаємо…',
    regularly: 'Регулярно',
    ifFalls: 'Якщо впаде',
    ruleKind: 'Яке правило',
    howFar: 'На скільки',
    fallBy: (pct) => `−${pct}`,
    referencePoint: 'Точка відліку',
    priceNow: 'ціна зараз',
    fromEnabled: 'ціна при ввімкненні',
    fromPurchase: 'остання купівля',
    remindAt: 'Ryntra нагадає при',
    remindAtShort: 'нагадаємо при',
    remindAtLine: 'Нагадаємо при',
    orLower: 'або нижче',
    priceUnknownNow: 'Ціну зараз не вдалося прочитати — спробуй за мить.',
    monthBudget: 'Бюджет місяця',
    thisMonth: 'Цього місяця',
    of: 'з',
    noBudgetYet: 'без стелі',
    changeBudget: 'Змінити бюджет',
    setBudget: 'Задати бюджет',
    removeBudget: 'Прибрати бюджет',
    save: 'Зберегти',
    saving: 'Зберігаємо…',
    budgetLine: 'Стеля для всіх правил на місяць. Коли її досягнуто, правила стоять до 1-го числа.',
    budgetCounts: 'Рахуються лише завершені купівлі; незавершена — доки не з’ясується.',
    budgetFailed: 'Бюджет зараз не вдалося зберегти. Спробуй ще раз.',
    addRule: 'Додати правило',
    noRulesYet:
      'Правил ще немає. Правило купує токен щодня, щотижня, коли ціна впаде або з кожної оплати — кожну купівлю підписуєш ти.',
    rulesDown: 'Правила зараз не вдалося прочитати.',
    tryAgain: 'Спробувати ще',
    pickCompany: 'Для якої компанії?',
    youOwn: 'У тебе є',
    popular: 'Популярні компанії',
    allCompanies: 'Усі компанії',
    ruleOf: (company) => `Регулярна купівля ${company}`,
    signInForRules: 'Твої правила й бюджет місяця — після входу.',
    eachPurchase: 'Кожна купівля',
    atMostPerMonth: 'Не більше на місяць',
    budgetNotSet: 'Бюджет не задано',
    setShort: 'Задати',
    changeShort: 'Змінити',
    plainPurchase: 'Звичайна купівля',
    reminderStaysOpen: 'Нагадування правила лишиться відкритим',
    reminderOpenHere: 'Нагадування правила відкрите',
    plainHereLeavesOpen: 'Купівля тут його не закриває — правило рахує лише купівлю за правилом.',
    buyByRule: (usd) => `Купити ${usd} за правилом`,
    plainLeavesOpen: (usd) => `Це звичайна купівля: нагадування правила на ${usd} лишиться відкритим.`,
    priceCondition: 'Умова ціни',
    noCondition: 'Без умови',
    purchaseDeferred: 'Купівлю відкладено',
    ruleChecksAgain: 'Правило перевірить знову, поки нагадування відкрите.',
    checksAgainUntil: 'Правило перевірятиме знову до',
    deferredShort: 'Купівлю відкладено · правило перевірить знову',
    fromPayments: 'З оплат',
    whatToSetAside: 'Що відкладати',
    modeRoundup: 'Округлення',
    modeFixed: '$ з оплати',
    modePercent: '% з надходжень',
    roundUpTo: 'Округлювати до',
    fromEveryPayment: 'З кожної оплати',
    ofEveryIncoming: 'З кожного надходження',
    gathered: 'Накопичено',
    remindFrom: 'Нагадаю від',
    countingSince: 'Рахую з',
    whatCounts: 'Що рахується',
    paymentsCount:
      'Оплати USDC цього гаманця з цієї миті. Обміни, купівлі в Ryntra й перекази між твоїми рахунками не рахуються.',
    incomingCount:
      'Надходження USDC у цей гаманець з цієї миті. Обміни, продажі в Ryntra й перекази між твоїми рахунками не рахуються.',
    recentPayments: 'Останні оплати',
    recentIncoming: 'Останні надходження',
    noPaymentsYet: 'Від увімкнення правила оплат ще не було.',
    noIncomingYet: 'Від увімкнення правила надходжень ще не було.',
    paymentWord: 'Оплата',
    incomingWord: 'Надходження',
    solanaPayLabel: 'Мітка Solana Pay',
    inReminder: 'у нагадуванні',
    myAccount: 'Мій рахунок',
    myAccountConfirm: 'Не рахувати перекази з цим рахунком — він мій',
    myAccountYes: 'Так, мій',
    readPartial: 'Не всі оплати вдалося перевірити — Ryntra перевірить знову.',
    readUnavailable: 'Гаманець зараз не прочитати — Ryntra перевірить знову.',
    paymentsHelp: {
      title: 'З кожної оплати',
      short: 'Відкладає частинку кожної оплати USDC у компанію — гроші лежать у гаманці, купує лише твій підпис.',
      what: 'Ryntra читає USDC цього гаманця в Solana. Оплата — переказ комусь іншому, який ти підписав; надходження — USDC, які тобі надіслав хтось інший. Кожна подія рахується один раз, від миті, коли правило ввімкнено. Обміни, купівлі в Ryntra, мости й перекази між твоїми рахунками не рахуються. Сума копиться до мінімуму, тоді одне нагадування відкриває свіжу «Перевірку», і купує лише твій підпис.',
      example: ['Округлення до $1: оплати $3,40 і $2,30 → $0,60 + $0,70 = $1,30 → «З оплат: $1,30 → Apple».'],
      important:
        'Ryntra не називає магазин. Переказ на твій інший гаманець виглядає як оплата — познач його «Мій рахунок», і такі перекази більше не рахуються.',
    },
    fixedBounds: (min, max) => `Від ${min} до ${max} з кожної оплати`,
    reminderClosedPayments: 'Це нагадування вже не діє. Наступне прийде, коли правило знову накопичить суму.',
    pickToken: 'Для якого токена?',
    allTokens: 'Усі токени — на Ринках',
    pickTokenFromMarkets: 'Обери токен на Ринках: «Регулярно» стоїть поруч із «Ринок» в ордері.',
    riskFacts: 'Факти ризику',
    riskAge: 'На ринку',
    riskLiquidity: 'Ліквідність',
    riskTopHolders: 'Топ-10 тримачів',
    riskMint: 'Випуск нових',
    riskFreeze: 'Заморожування',
    riskOrganic: 'Органічна оцінка',
    riskVerified: 'Список Jupiter',
    riskClosed: 'закрито',
    riskOpen: 'відкрито',
    riskVerifiedYes: 'перевірено',
    riskVerifiedNo: 'не перевірено',
    riskNotStated: 'не вказано',
    riskSource: 'Зі списку Jupiter, прочитано зараз, — факти, не вирок.',
    floorTitle: 'Поріг регулярної купівлі',
    noRuleOnToken: 'На цей токен регулярну купівлю не налаштувати.',
    tokenNotSupported: 'Аудит Jupiter позначає цей токен або Ryntra його більше не підтримує — правило не ввімкнути.',
    flaggedSuspicious: 'Власний аудит Jupiter позначає цей токен як підозрілий.',
    tokenUnreadable: 'Ліквідність чи ціну токена зараз не прочитати — спробуй за мить.',
    priceWhenOn: 'Ціна при ввімкненні',
    floorRefusesTurnOn: 'Правило не ввімкнути: токен зараз нижче порогу.',
    scheduleShort: 'Розклад',
    buyAtMarket: 'Купити за ринком',
  },
}
