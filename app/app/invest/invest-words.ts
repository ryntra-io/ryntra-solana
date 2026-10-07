import type { WorkspaceLocale } from "@/app/shell/locale";

import { usdWord } from "../../../lib/autoinvest/words.ts";
import { SALE_MAY_FAIL } from "../../../lib/stocks/check.ts";
import { MIN_BUY_USD } from "./company-model.ts";

/**
 * Every word «Простий»'s Home, Markets, company page and purchase say, in
 * both languages. The words a beginner reads: a company by its name, a price
 * in dollars, one action — never a ticker as a title, a candle, a clock in UTC
 * or a source's name at rest.
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

/** «$1» — the least a purchase is, read from the one constant so no sentence keeps an old minimum. */
const FROM = `$${MIN_BUY_USD}`;

export const INVEST_WORDS = {
  /* Home — a guest */
  homeTitle: bi("Home", "Головна"),
  guestHeadline: bi("Stocks, crypto, memes — and your own token", "Акції, крипта, меми — і свій токен"),
  guestLine: bi("No broker — it stays in your own wallet.", "Без брокера — усе лишається у твоєму гаманці."),
  connectWallet: bi("Connect wallet", "Під'єднати гаманець"),
  /* Home — a wallet */
  yourInvestments: bi("Your investments", "Твої інвестиції"),
  buy: bi("Buy", "Купити"),
  topUp: bi("Top up", "Поповнити"),
  askRyntra: bi("Ask Ryntra", "Спитати Ryntra"),
  youOwn: bi("You own", "У тебе є"),
  allInPortfolio: bi("All in Portfolio", "Усе в Портфелі"),
  emptyWallet: bi("Nothing here yet — top up and make your first buy.", "Поки порожньо — поповни й зроби першу купівлю."),
  walletUnread: bi("Your wallet could not be read right now.", "Гаманець зараз не вдалося прочитати."),
  tryAgain: bi("Try again", "Спробувати ще"),
  /* Home beside the balance: what the money is in, and a guest's three steps */
  allocation: bi("Allocation", "Розподіл"),
  other: bi("Other", "Інше"),
  stepConnect: bi("Connect a wallet", "Під'єднай гаманець"),
  stepTopUp: bi("Top up with USDC or SOL", "Поповни USDC або SOL"),
  stepBuy: bi("Buy — or launch your token", "Купи — або запусти свій токен"),
  /* Home's right column: notes, «Автоінвест», «Спитати Ryntra», what moves today */
  asideLabel: bi("At a glance", "Коротко"),
  autoinvestGuest: bi("Buy a company every day, every week, or when its price falls — Ryntra reminds you, you sign each buy.", "Купуй компанію щодня, щотижня або коли ціна впаде — Ryntra нагадає, кожну купівлю підписуєш ти."),
  howItWorks: bi("How it works", "Як це працює"),
  allRules: bi("All rules", "Усі правила"),
  askPlaceholder: bi("Ask a question", "Постав питання"),
  askSend: bi("Ask", "Спитати"),
  movingToday: bi("Moving today", "Що рухається сьогодні"),
  movingNote: bi("Companies and crypto over 24 hours", "Компанії й крипта за 24 год"),
  allMarkets: bi("All markets", "Усі ринки"),
  movingDown: bi("The market lists could not be read right now.", "Списки ринків зараз не прочитано."),
  /* The shelves */
  popularCompanies: bi("Popular companies", "Популярні компанії"),
  byVolume: bi("By trading volume over 24 hours", "За обсягом торгів за 24 год"),
  allCompanies: bi("All companies", "Усі компанії"),
  marketsTitle: bi("Markets", "Ринки"),
  search: bi("Search a company or a coin", "Пошук: компанія або монета"),
  searchLabel: bi("Search markets", "Пошук на ринках"),
  companies: bi("Companies", "Компанії"),
  privateCompanies: bi("Private companies", "Приватні компанії"),
  forExperienced: bi("for experienced investors", "для досвідчених"),
  privateLine: bi("PreStocks tokens, not shares. Selling may not be possible.", "Токени PreStocks, а не акції. Продати може не вийти."),
  notAShare: bi("Not a share", "Це не акція"),
  /* The time the private shelf's one number was read — the issuer's valuation and the price beside it. */
  valuationAt: bi("PreStocks' valuation as of", "Оцінка PreStocks на"),
  valuationAtShort: bi("as of", "на"),
  dollars: bi("Dollars", "Долари"),
  crypto: bi("Crypto", "Крипта"),
  /* Markets' «Для досвідчених»: the tools «Профі» held, a tap deeper in the same place. */
  experienced: bi("For experienced investors", "Для досвідчених"),
  experiencedLine: bi("The same checks before every signature.", "Ті самі перевірки перед кожним підписом."),
  spotLine: bi("Candlestick chart, every market, buy and sell", "Свічковий графік, усі ринки, купівля й продаж"),
  stocksLine: bi("Every tokenized stock, with filters and sorting", "Усі токенізовані акції з фільтрами й сортуванням"),
  trendsLine: bi("Crypto and memes moving today", "Крипта й меми, що рухаються сьогодні"),
  showMore: bi("Show more", "Показати ще"),
  /* Markets' tabs: Усі · Компанії · Приватні · Крипта · Меми · Долари */
  marketsTabs: bi("Markets", "Ринки"),
  tabAll: bi("All", "Усі"),
  tabCompanies: bi("Companies", "Компанії"),
  tabPrivate: bi("Private", "Приватні"),
  tabCrypto: bi("Crypto", "Крипта"),
  tabMemes: bi("Memes", "Меми"),
  tabDollars: bi("Dollars", "Долари"),
  seeAll: bi("See all", "Усі"),
  memes: bi("Memes", "Меми"),
  memesRisk: bi("The riskiest: a price can fall to zero within hours. Buy only what you are ready to lose.", "Найризикованіше: ціна може впасти до нуля за години. Купуй лише те, що готовий втратити."),
  memesDown: bi("Memes are not answering right now.", "Меми зараз не відповідають."),
  dollarsLine: bi("USDC and USDT — the digital dollars you buy with.", "USDC і USDT — цифрові долари, за які купуєш."),
  nothingFound: bi("Nothing found.", "Нічого не знайдено."),
  updating: bi("Updating prices…", "Оновлюємо ціни…"),
  shelfDown: bi("The list of companies is not answering right now.", "Список компаній зараз не відповідає."),
  reload: bi("Reload", "Оновити"),
  coinsDown: bi("Dollars and crypto are not answering right now.", "Долари й крипта зараз не відповідають."),
  dayChange: bi("today", "за день"),
  /* The company: a name, a price, a line, one action */
  range1d: bi("1D", "1Д"),
  range1w: bi("1W", "1Т"),
  range1m: bi("1M", "1М"),
  range1y: bi("1Y", "1Р"),
  chartRange: bi("Chart period", "Період графіка"),
  overWeek: bi("past week", "за тиждень"),
  overMonth: bi("past month", "за місяць"),
  overYear: bi("past year", "за рік"),
  since: bi("since", "з"),
  chartDown: bi("The chart is not answering right now.", "Графік зараз не відповідає."),
  noChart: bi("There is no price chart for this company.", "Для цієї компанії графіка немає."),
  exchangeOpen: bi("Exchange open", "Біржа відкрита"),
  exchangeClosed: bi("Exchange closed", "Біржа зачинена"),
  closedDrift: bi("the price may drift", "ціна може відхилятися"),
  details: bi("Details", "Деталі"),
  chartInSpot: bi("Candlestick chart in Spot", "Свічковий графік у Споті"),
  companyDown: bi("This company could not be read right now.", "Компанію зараз не вдалося прочитати."),
  notOffered: bi("The issuer is not offering new purchases right now.", "Емітент зараз не пропонує нових купівель."),
  halted: bi("The issuer has paused trading.", "Емітент призупинив торги."),
  /* The purchase in dollars */
  close: bi("Close", "Закрити"),
  amount: bi("Amount in dollars", "Сума в доларах"),
  quickAmounts: bi("Quick amounts", "Швидкі суми"),
  quickShares: bi("A share of your USDC", "Частка твоїх USDC"),
  minimum: bi(`The minimum is ${FROM}`, `Мінімум — ${FROM}`),
  /* A company whose live route starts above the sum asked says its own minimum, read from the quote. */
  findingMinimum: bi("Finding the least this company can be bought for…", "Шукаємо, від якої суми купується ця компанія…"),
  allCosts: bi("all costs", "усі витрати"),
  pricing: bi("Pricing…", "Рахуємо ціну…"),
  noRoute: bi("This amount cannot be bought right now.", "На цю суму зараз купити не вийде."),
  lossLimit: bi("Loss limit", "Межа збитку"),
  limitNone: bi("None", "Немає"),
  limitWord: bi("Limit", "Межа"),
  warnsTelegram: bi("Ryntra will warn you in Telegram", "Ryntra попередить у Telegram"),
  noProtection: bi("No protection · connect Telegram so Ryntra can warn you", "Без захисту · підключи Telegram, щоб Ryntra могла попередити"),
  canLoseAll: bi("You can lose everything", "Можна втратити все"),
  limitPriceUnknown: bi("The price for the loss limit could not be read right now.", "Ціну для межі збитку зараз не вдалося прочитати."),
  buyFor: bi("Buy for", "Купити за"),
  notEnough: bi("Not enough USDC", "Недостатньо USDC"),
  walletHas: bi("In your wallet", "У гаманці"),
  limitBlocked: bi("With this loss limit the purchase did not pass the check. Try again, or buy without a limit.", "З цією межею збитку купівля не пройшла перевірку. Спробуй ще раз або купи без межі."),
  needSol: bi("A little SOL is needed for the network", "Потрібно трохи SOL на мережу"),
  confirmWallet: bi("Confirm wallet", "Підтвердити гаманець"),
  confirming: bi("Confirming…", "Підтверджуємо…"),
  savingLimit: bi("Saving the loss limit…", "Зберігаємо межу збитку…"),
  limitFailed: bi("The loss limit could not be saved. Nothing was bought.", "Межу збитку не вдалося зберегти. Нічого не куплено."),
  preparingReview: bi("Preparing the Review…", "Готуємо перевірку…"),
  review: bi("Review", "Перевірка"),
  rowSpend: bi("You pay", "Спишеться"),
  rowGet: bi("You get", "Отримаєш"),
  rowCosts: bi("All costs", "Усі витрати"),
  rowWhat: bi("What it is", "Що це"),
  atLeast: bi("at least", "щонайменше"),
  /* The token's own fee on the transfer, inside «Усі витрати»: «з них комісія емітента 1% ≈ $0,10». */
  issuerFeeOfWhich: bi("of which the issuer's fee", "з них комісія емітента"),
  /* Ryntra's own fee inside «Усі витрати», beside the issuer's: «з них комісія Ryntra 0,25% · 0,0125 USDC». */
  ryntraFeeOfWhich: bi("of which the Ryntra fee", "з них комісія Ryntra"),
  priceHolds: bi("The price holds for", "Ціна діє ще"),
  seconds: bi("s", "с"),
  priceExpired: bi("The price has expired", "Ціна застаріла"),
  sign: bi("Sign", "Підписати"),
  refreshPrice: bi("Refresh the price", "Оновити ціну"),
  cancel: bi("Cancel", "Скасувати"),
  inWallet: bi("Confirm in your wallet…", "Підтверди в гаманці…"),
  sending: bi("Sending…", "Надсилаємо…"),
  checkingTx: bi("Checking the transaction…", "Перевіряємо транзакцію…"),
  checkTx: bi("Check the transaction", "Перевірити транзакцію"),
  unknownTx: bi("The outcome is not known yet. Do not buy again until it is.", "Результат ще невідомий. Не купуй ще раз, доки він не з'ясується."),
  ownPiece: bi("You own a piece of", "У тебе є частинка"),
  ownToken: bi("token bought", "У тебе є токен"),
  receiptFor: bi("for", "за"),
  watchingLimit: bi("Ryntra watches your loss limit", "Ryntra стежить за межею"),
  limitSavedNoChannel: bi("Loss limit saved · connect Telegram so Ryntra can warn you", "Межу збережено · підключи Telegram, щоб Ryntra могла попередити"),
  done: bi("Done", "Готово"),
  history: bi("History", "Історія"),
  transaction: bi("Transaction", "Транзакція"),
  belowMinimum: bi("Less arrived than the Review's minimum — the receipt keeps both figures.", "Прийшло менше, ніж мінімум у Перевірці, — квитанція зберігає обидві цифри."),
  notAsReviewed: bi("The network's figures differ from the Review — the receipt keeps both.", "Цифри мережі відрізняються від Перевірки — квитанція зберігає обидві."),
  nothingHappened: bi("Nothing happened — your money did not move. You can buy again.", "Нічого не сталося — гроші не рухались. Можна купити ще раз."),
  notFilled: bi("The network rejected the purchase. Only the network fee was spent.", "Мережа відхилила купівлю. Списано лише плату мережі."),
  walletDeclined: bi("The wallet did not sign — nothing was sent.", "Гаманець не підписав — нічого не надіслано."),
  unavailableNow: bi("Buying is not available right now.", "Купівля зараз недоступна."),
  /* «Автоінвест»: a rule reminds, the person signs every purchase */
  autoinvest: bi("Recurring buy", "Регулярна купівля"),
  howOften: bi("How often", "Як часто"),
  when: bi("When", "Коли"),
  dayOfMonth: bi("Day of the month", "День місяця"),
  timeOfDay: bi("Time", "Час"),
  firstPurchase: bi("First purchase", "Перша купівля"),
  nextPurchase: bi("Next purchase", "Наступна купівля"),
  autoinvestPromise: bi("Ryntra will remind you — you confirm with one tap. Your money stays in your wallet.", "Ryntra нагадає — ти підтвердиш одним дотиком. Гроші лишаються у твоєму гаманці."),
  connectTelegramReminder: bi("Connect Telegram so you don't miss it", "Підключи Telegram, щоб не пропустити"),
  remindersTelegram: bi("Reminders come to Ryntra and Telegram", "Нагадування — у Ryntra і Telegram"),
  turnOn: bi("Turn on", "Увімкнути"),
  turningOn: bi("Turning on…", "Вмикаємо…"),
  autoinvestOn: bi("Recurring buy is on", "Регулярну купівлю увімкнено"),
  autoinvestFailed: bi("The recurring buy could not be turned on. Nothing was bought.", "Регулярну купівлю не вдалося увімкнути. Нічого не куплено."),
  ruleLimit: bi("A wallet holds up to 20 rules — remove one first.", "У гаманці може бути до 20 правил — спершу видали одне."),
  pause: bi("Pause", "Пауза"),
  turnOnAgain: bi("Turn on again", "Увімкнути знову"),
  onPause: bi("Paused", "На паузі"),
  deleteRule: bi("Delete the rule", "Видалити правило"),
  deleteConfirm: bi("Delete this rule? Past purchases stay in History.", "Видалити це правило? Минулі купівлі лишаться в Історії."),
  deleteYes: bi("Delete", "Видалити"),
  ruleChangeFailed: bi("The rule could not be changed right now. Try again.", "Правило зараз не вдалося змінити. Спробуй ще раз."),
  timeToBuy: bi("Time for your purchase", "Час твоєї покупки"),
  lastBought: bi("Bought", "Куплено"),
  lastMissed: bi("Missed", "Пропущено"),
  lastPending: bi("Purchase on its way", "Купівля в дорозі"),
  buyWeekly: bi("Buy weekly", "Купувати щотижня"),
  byRule: bi("By your rule", "За правилом"),
  reminderClosed: bi("This reminder has closed. The next one comes on the rule's day.", "Це нагадування вже не діє. Наступне прийде в день правила."),
  reminderBought: bi("This reminder's purchase is already bought.", "Купівлю за цим нагадуванням уже зроблено."),
  reminderPending: bi("A purchase under this reminder is already on its way.", "Купівля за цим нагадуванням уже в дорозі."),
  ruleGone: bi("This rule is no longer in your wallet.", "Цього правила вже немає у твоєму гаманці."),
  ruleReadFailed: bi("Your rule could not be read right now.", "Правило зараз не вдалося прочитати."),
  reading: bi("Reading…", "Читаємо…"),
  /* «Якщо впаде» and «Бюджет місяця» */
  regularly: bi("Regularly", "Регулярно"),
  ifFalls: bi("If it falls", "Якщо впаде"),
  ruleKind: bi("Kind of rule", "Яке правило"),
  howFar: bi("By how much", "На скільки"),
  referencePoint: bi("Reference point", "Точка відліку"),
  priceNow: bi("the price now", "ціна зараз"),
  fromEnabled: bi("the price when turned on", "ціна при ввімкненні"),
  fromPurchase: bi("your last purchase", "остання купівля"),
  remindAt: bi("Ryntra reminds you at", "Ryntra нагадає при"),
  remindAtShort: bi("reminder at", "нагадаємо при"),
  remindAtLine: bi("Reminder at", "Нагадаємо при"),
  orLower: bi("or lower", "або нижче"),
  oneReminderPerFall: bi("One reminder each time the price falls below this line.", "Одне нагадування на кожне падіння нижче цієї позначки."),
  priceUnknownNow: bi("The price could not be read right now — try again in a moment.", "Ціну зараз не вдалося прочитати — спробуй за мить."),
  monthBudget: bi("Monthly budget", "Бюджет місяця"),
  thisMonth: bi("This month", "Цього місяця"),
  of: bi("of", "з"),
  budgetSpent: bi("Budget spent", "Бюджет вичерпано"),
  rulesStand: bi("Rules stand until the 1st", "Правила стоять до 1-го числа"),
  changeBudget: bi("Change budget", "Змінити бюджет"),
  setBudget: bi("Set a budget", "Задати бюджет"),
  removeBudget: bi("Remove the budget", "Прибрати бюджет"),
  save: bi("Save", "Зберегти"),
  saving: bi("Saving…", "Зберігаємо…"),
  budgetLine: bi("A ceiling for all your rules each month. Once it is reached, rules stand until the 1st.", "Стеля для всіх правил на місяць. Коли її досягнуто, правила стоять до 1-го числа."),
  budgetCounts: bi("Only finished purchases count; one still on its way counts until it is known.", "Рахуються лише завершені купівлі; незавершена — доки не з'ясується."),
  budgetFailed: bi("The budget could not be saved right now. Try again.", "Бюджет зараз не вдалося зберегти. Спробуй ще раз."),
  noBudgetYet: bi("no limit", "без стелі"),
  addRule: bi("Add a rule", "Додати правило"),
  pickCompany: bi("For which company?", "Для якої компанії?"),
  yourCompanies: bi("You own", "У тебе є"),
  noRulesYet: bi("No rules yet. A rule buys a token every day, every week, when the price falls or from every payment — you sign each buy.", "Правил ще немає. Правило купує токен щодня, щотижня, коли ціна впаде або з кожної оплати — кожну купівлю підписуєш ти."),
  confirmForRules: bi("Confirm your wallet to see your rules and budget.", "Підтверди гаманець, щоб побачити свої правила й бюджет."),
  ruleOn: bi("On", "Увімкнено"),
  heldShort: bi("Budget spent · until the 1st", "Бюджет вичерпано · до 1-го числа"),
  budgetBlocks: bi("This purchase does not fit what is left of the month's budget.", "Ця купівля не вміщається в залишок бюджету місяця."),
  pickFromMarkets: bi("Pick a company on Markets and press «Recurring buy» there.", "Обери компанію на Ринках і натисни там «Регулярна купівля»."),
  /* «Регулярна купівля для всього»: any token with liquidity — the floor and the facts of risk before the button. */
  pickToken: bi("For which token?", "Для якого токена?"),
  allTokens: bi("All tokens on Markets", "Усі токени — на Ринках"),
  pickTokenFromMarkets: bi("Pick a token on Markets: «Recurring» stands next to «Market» in its order.", "Обери токен на Ринках: «Регулярно» стоїть поруч із «Ринок» в ордері."),
  riskFacts: bi("Facts of risk", "Факти ризику"),
  riskAge: bi("On the market", "На ринку"),
  riskLiquidity: bi("Liquidity", "Ліквідність"),
  riskTopHolders: bi("Top 10 holders", "Топ-10 тримачів"),
  riskMint: bi("Minting more", "Випуск нових"),
  riskFreeze: bi("Freezing tokens", "Заморожування"),
  riskOrganic: bi("Organic score", "Органічна оцінка"),
  riskVerified: bi("Jupiter's list", "Список Jupiter"),
  riskClosed: bi("closed", "закрито"),
  riskOpen: bi("open", "відкрито"),
  riskVerifiedYes: bi("verified", "перевірено"),
  riskVerifiedNo: bi("not verified", "не перевірено"),
  riskNotStated: bi("not stated", "не вказано"),
  riskSource: bi("From Jupiter's list, read now — facts, not a verdict.", "Зі списку Jupiter, прочитано зараз, — факти, не вирок."),
  floorTitle: bi("Floor for a recurring buy", "Поріг регулярної купівлі"),
  noRuleOnToken: bi("No recurring buy can be set on this token.", "На цей токен регулярну купівлю не налаштувати."),
  tokenNotSupported: bi("Jupiter's audit flags this token, or Ryntra no longer supports it — the rule can't be turned on.", "Аудит Jupiter позначає цей токен або Ryntra його більше не підтримує — правило не ввімкнути."),
  flaggedSuspicious: bi("Jupiter's own audit flags this token as suspicious.", "Власний аудит Jupiter позначає цей токен як підозрілий."),
  tokenUnreadable: bi("The token's liquidity or price cannot be read right now — try again in a moment.", "Ліквідність чи ціну токена зараз не прочитати — спробуй за мить."),
  priceWhenOn: bi("Price when turned on", "Ціна при ввімкненні"),
  ceilingNow: bi("the rule won't buy above", "правило не купить дорожче за"),
  floorRefusesTurnOn: bi("The rule can't be turned on: the token is under the floor right now.", "Правило не ввімкнути: токен зараз нижче порогу."),
  scheduleShort: bi("Schedule", "Розклад"),
  buyAtMarket: bi("Buy at market instead", "Купити за ринком"),
  eachPurchase: bi("Each purchase", "Кожна купівля"),
  atMostPerMonth: bi("At most per month", "Не більше на місяць"),
  budgetNotSet: bi("No budget set", "Бюджет не задано"),
  setShort: bi("Set", "Задати"),
  changeShort: bi("Change", "Змінити"),
  plainPurchase: bi("One-off purchase", "Звичайна купівля"),
  reminderStaysOpen: bi("Your rule's reminder stays open", "Нагадування правила лишиться відкритим"),
  reminderOpenHere: bi("Your rule's reminder is open", "Нагадування правила відкрите"),
  plainHereLeavesOpen: bi("A purchase here does not close it — the rule counts only a purchase by the rule.", "Купівля тут його не закриває — правило рахує лише купівлю за правилом."),
  /* «Умова ціни»: the rule buys only while the price is within the person's limit of its reference and the data are fresh. */
  priceCondition: bi("Price condition", "Умова ціни"),
  noCondition: bi("No condition", "Без умови"),
  purchaseDeferred: bi("Purchase deferred", "Купівлю відкладено"),
  ruleChecksAgain: bi("The rule checks again while the reminder is open.", "Правило перевірить знову, поки нагадування відкрите."),
  checksAgainUntil: bi("The rule checks again until", "Правило перевірятиме знову до"),
  deferredShort: bi("Purchase deferred · the rule checks again", "Купівлю відкладено · правило перевірить знову"),
  conditionNow: bi("Now", "Зараз"),
  conditionRefused: bi("The price condition is not met right now — the rule's purchase waits.", "Умова ціни зараз не виконана — купівля за правилом чекає."),
  /* «З кожної оплати»: the wallet's own USDC payments and incoming transfers, gathered to the minimum, then one reminder. */
  fromPayments: bi("From payments", "З оплат"),
  whatToSetAside: bi("What to set aside", "Що відкладати"),
  modeRoundup: bi("Round-up", "Округлення"),
  modeFixed: bi("$ per payment", "$ з оплати"),
  modePercent: bi("% of incoming", "% з надходжень"),
  roundUpTo: bi("Round up to", "Округлювати до"),
  fromEveryPayment: bi("From every payment", "З кожної оплати"),
  ofEveryIncoming: bi("Of every incoming transfer", "З кожного надходження"),
  gathered: bi("Gathered", "Накопичено"),
  remindFrom: bi("Reminder from", "Нагадаю від"),
  countingSince: bi("Counting since", "Рахую з"),
  paymentsCount: bi("This wallet's USDC payments from now on. Swaps, Ryntra purchases and transfers between your own accounts don't count.", "Оплати USDC цього гаманця з цієї миті. Обміни, купівлі в Ryntra й перекази між твоїми рахунками не рахуються."),
  incomingCount: bi("USDC that comes into this wallet from now on. Swaps, Ryntra sales and transfers between your own accounts don't count.", "Надходження USDC у цей гаманець з цієї миті. Обміни, продажі в Ryntra й перекази між твоїми рахунками не рахуються."),
  moneyStays: bi("The money stays in your wallet until you sign the purchase.", "Гроші лежать у твоєму гаманці, доки ти не підпишеш купівлю."),
  recentPayments: bi("Recent payments", "Останні оплати"),
  recentIncoming: bi("Recent incoming transfers", "Останні надходження"),
  noPaymentsYet: bi("No payments since the rule was turned on.", "Від увімкнення правила оплат ще не було."),
  noIncomingYet: bi("No incoming transfers since the rule was turned on.", "Від увімкнення правила надходжень ще не було."),
  paymentWord: bi("Payment", "Оплата"),
  incomingWord: bi("Incoming", "Надходження"),
  solanaPayLabel: bi("Solana Pay label", "Мітка Solana Pay"),
  inReminder: bi("in a reminder", "у нагадуванні"),
  myAccount: bi("My account", "Мій рахунок"),
  myAccountConfirm: bi("Don't count transfers to or from this account — it's mine", "Не рахувати перекази з цим рахунком — він мій"),
  myAccountYes: bi("Yes, it's mine", "Так, мій"),
  readPartial: bi("Not every payment could be checked — Ryntra checks again.", "Не всі оплати вдалося перевірити — Ryntra перевірить знову."),
  readUnavailable: bi("The wallet can't be read right now — Ryntra checks again.", "Гаманець зараз не прочитати — Ryntra перевірить знову."),
  /* «Поповнити» and the first step without crypto */
  fundFirst: bi("Top up — and make your first buy", "Поповни — і зроби першу купівлю"),
  connectToBuy: bi("Connect a wallet to buy", "Під'єднай гаманець, щоб купувати"),
  openInPhantom: bi("Open in Phantom", "Відкрити в Phantom"),
  topUpSol: bi("Top up SOL", "Поповнити SOL"),
  topUpLede: bi("You buy with USDC — digital dollars. A little SOL pays the network.", "Купуєш за USDC — цифрові долари. Трохи SOL — плата мережі."),
  inYourWallet: bi("In your wallet", "У твоєму гаманці"),
  forPurchases: bi("for purchases", "на покупки"),
  forNetwork: bi("for the network fee", "на плату мережі"),
  neededFrom: bi(`needed from ${FROM}`, `потрібно від ${FROM}`),
  neededAbout: bi("needed ≈", "потрібно ≈"),
  readyToBuy: bi("Ready — you can buy.", "Готово — можна купувати."),
  continueBuying: bi("Continue the purchase", "Продовжити купівлю"),
  waitingMoney: bi("Waiting for the money — this page updates by itself.", "Чекаємо на гроші — сторінка оновиться сама."),
  waysTitle: bi("How to top up", "Як поповнити"),
  receiveUsdc: bi("Receive USDC", "Отримати USDC"),
  receiveSol: bi("Receive SOL", "Отримати SOL"),
  receiveSub: bi("From another wallet — a QR code or the address", "З іншого гаманця — QR-код або адреса"),
  cardUsdc: bi("Buy with a card in your wallet", "Купити карткою у своєму гаманці"),
  cardUsdcSub: bi("Apple Pay, Google Pay or a card — in Phantom", "Apple Pay, Google Pay або картка — у Phantom"),
  cardSol: bi("Get SOL in your wallet", "Купити SOL у своєму гаманці"),
  cardSolSub: bi("With a card, or for a little of your USDC — in Phantom", "Карткою або за трохи твоїх USDC — у Phantom"),
  exchangeUsdc: bi("Transfer from an exchange", "Переказати з біржі"),
  exchangeUsdcSub: bi("USDC on the Solana network", "USDC у мережі Solana"),
  exchangeSol: bi("Transfer SOL from an exchange", "Переказати SOL з біржі"),
  exchangeSolSub: bi("SOL on the Solana network", "SOL у мережі Solana"),
  yourAddress: bi("Your address on Solana", "Твоя адреса в мережі Solana"),
  networkWord: bi("Network", "Мережа"),
  copyAddress: bi("Copy address", "Копіювати адресу"),
  copied: bi("Copied", "Скопійовано"),
  scanToSend: bi("Scan to send to this wallet", "Скануй, щоб надіслати в цей гаманець"),
  solanaOnlyUsdc: bi("Send on Solana only. The same address takes SOL too.", "Надсилай лише в мережі Solana. Ця ж адреса приймає і SOL."),
  solanaOnly: bi("Send on Solana only.", "Надсилай лише в мережі Solana."),
  openPhantom: bi("Open Phantom", "Відкрий Phantom"),
  cardPay: bi("Top up with a card, Apple Pay or Google Pay", "Поповни карткою, Apple Pay чи Google Pay"),
  cardBuy: bi("Buy USDC and a little SOL — they appear here", "Купи USDC і трохи SOL — вони з'являться тут"),
  cardFine: bi("Phantom's partner takes the payment; the methods and fees depend on your country.", "Оплату приймає партнер Phantom; способи й комісії залежать від країни."),
  solSwap: bi("Swap a little USDC for SOL — Phantom takes that swap's network fee from the USDC", "Обміняй трохи USDC на SOL — плату мережі за цей обмін Phantom візьме з USDC"),
  solCard: bi("Or buy SOL with a card", "Або купи SOL карткою"),
  openRyntraInPhantom: bi("Open Ryntra in Phantom", "Відкрити Ryntra в Phantom"),
  exchangeStepsUsdc: bi("On the exchange: Withdraw → USDC → the Solana network → paste this address.", "На біржі: Вивести → USDC → мережа Solana → встав цю адресу."),
  exchangeStepsSol: bi("On the exchange: Withdraw → SOL → the Solana network → paste this address.", "На біржі: Вивести → SOL → мережа Solana → встав цю адресу."),
  exchangeAddSol: bi("Withdraw a little SOL too — for the network fee.", "Виведи й трохи SOL — на плату мережі."),
  /* The IPO and conversion watch: the swap before the issuer's deadline, and the quiet sale */
  howMuch: bi("How much", "Скільки"),
  shareAll: bi("All", "Усе"),
  shareHalf: bi("Half", "Половина"),
  shareQuarter: bi("A quarter", "Чверть"),
  rowGive: bi("You give", "Віддаєш"),
  rowRate: bi("Rate", "Курс"),
  reviewSwap: bi("Review the swap", "Перевірити обмін"),
  reviewSale: bi("Review the sale", "Перевірити продаж"),
  swapped: bi("Swapped", "Обміняно"),
  sold: bi("Sold", "Продано"),
  swapUnavailable: bi("The swap is not available right now.", "Обмін зараз недоступний."),
  swapRoute: bi("Route", "Маршрут"),
  issuerDeadline: bi("The issuer's deadline", "Строк емітента"),
  whatYouGet: bi("What you get", "Що отримаєш"),
  issuerNotice: bi("The issuer's notice", "Оголошення емітента"),
  howSwapWorks: bi("How the swap works, in the issuer's words", "Як працює обмін — словами емітента"),
  swapIsTrade: bi("The swap is an ordinary trade at the live price — no fixed ratio is promised.", "Обмін — звичайна угода за живою ціною; фіксованого курсу ніхто не обіцяє."),
  nothingSwapped: bi("Nothing happened — your tokens did not move. You can try again.", "Нічого не сталося — токени не рухались. Можна спробувати ще раз."),
  swapRejected: bi("The network rejected the swap. Only the network fee was spent.", "Мережа відхилила обмін. Списано лише плату мережі."),
  /* «Продати з позиції»: a sale of what the wallet holds, in dollars or as a share of the position, on the purchase's own path */
  sell: bi("Sell", "Продати"),
  quickPositionShares: bi("A share of your position", "Частка твоєї позиції"),
  rowSell: bi("You sell", "Спишеться"),
  overPosition: bi("More than your position", "Більше, ніж твоя позиція"),
  /* A PreStocks token: «Продати може не вийти» — said before the sum and in «Перевірка», in the documentation's own words. */
  /* One sentence with the server's «Що це» on a private company's sale (contract 1.20.0). */
  saleMayFail: bi(SALE_MAY_FAIL.en, SALE_MAY_FAIL.uk),
  nothingToSell: bi("There is none of this company in your wallet now.", "Цієї компанії зараз немає в гаманці."),
  nothingSold: bi("Nothing happened — your position did not change. You can try again.", "Нічого не сталося — позиція не змінилась. Можна спробувати ще раз."),
  saleRejected: bi("The network rejected the sale. Only the network fee was spent.", "Мережа відхилила продаж. Списано лише плату мережі."),
  saleUnknownTx: bi("The outcome is not known yet. Do not sell again until it is.", "Результат ще невідомий. Не продавай ще раз, доки він не з'ясується."),
  saleUnavailable: bi("Selling is not available right now.", "Продаж зараз недоступний."),
  companyUnread: bi("This company could not be read right now. Try again in a moment.", "Компанію зараз не вдалося прочитати. Спробуй за мить."),
  /* The company page, complete: the company's facts at rest — figures with their source and time, never a paragraph */
  keyStats: bi("Key statistics", "Ключові показники"),
  aboutCompany: bi("About the company", "Про компанію"),
  aboutFund: bi("About the fund", "Про фонд"),
  whatYouBuy: bi("What you buy", "Що ти купуєш"),
  tradingOnSolana: bi("Trading on Solana · 24 h", "Торги на Solana · 24 год"),
  marketCap: bi("Market value", "Капіталізація"),
  peRatio: bi("Price / earnings", "Ціна / прибуток"),
  revenue: bi("Revenue", "Виручка"),
  netIncome: bi("Net income", "Чистий прибуток"),
  dividendYield: bi("Dividend yield", "Дивіденди"),
  perYear: bi("a year", "на рік"),
  yearRange: bi("Price over the year", "Ціна за рік"),
  yearLow: bi("Low", "Мінімум"),
  yearHigh: bi("High", "Максимум"),
  companyValuation: bi("Company valuation", "Оцінка компанії"),
  byTokenPrice: bi("By the token's price", "За ціною токена"),
  industry: bi("Industry", "Галузь"),
  headquarters: bi("Headquarters", "Штаб-квартира"),
  exchangeWord: bi("Exchange", "Біржа"),
  fiscalYear: bi("Fiscal year", "Фінансовий рік"),
  statusWord: bi("Status", "Статус"),
  latestReport: bi("Latest report", "Останній звіт"),
  fundType: bi("Type", "Тип"),
  issuerWord: bi("Issuer", "Емітент"),
  backing: bi("Backing", "Забезпечення"),
  sharesHeldBy: bi("shares held by", "акцій у"),
  dividendsWord: bi("Dividends", "Дивіденди"),
  issuerFee: bi("Issuer fee on a transfer", "Комісія емітента за переказ"),
  noFee: bi("None", "Немає"),
  onSolanaSince: bi("On Solana since", "На Solana з"),
  volume24h: bi("Volume", "Обсяг"),
  liquidity: bi("Liquidity", "Ліквідність"),
  holders: bi("Holders", "Власників"),
  traders24h: bi("Traders", "Трейдерів"),
  trades24h: bi("Trades", "Угод"),
  buysWord: bi("Buys", "Купівлі"),
  sellsWord: bi("Sells", "Продажі"),
  byTrades: bi("by number of trades", "за кількістю угод"),
  tradingUnread: bi("The day's trading could not be read right now.", "Торги за добу зараз не вдалося прочитати."),
  filingsSource: bi("The company's filings with the SEC", "Звітність компанії в SEC"),
  marketSource: bi("Market data: Jupiter", "Дані ринку: Jupiter"),
  reservesAt: bi("reserves at", "резерви на"),
  yourPosition: bi("Your position", "Твоя позиція"),
  fromDollarWallet: bi(`From ${FROM} · the token stays in your wallet`, `Від ${FROM} · токен у твоєму гаманці`),
  buyCompany: bi("Buy", "Купити"),
  lineOfBusiness: bi("What it does", "Чим займається"),
} as const satisfies Record<string, Bi>;

export type InvestWord = keyof typeof INVEST_WORDS;

export function investWords(locale: WorkspaceLocale): (word: InvestWord) => string {
  return (word) => INVEST_WORDS[word][locale];
}

/** The number locale a page formats in. */
export function numberLocale(locale: WorkspaceLocale): string {
  return locale === "uk" ? "uk-UA" : "en-US";
}

/** «Купити $20 за правилом» · «Buy $20 by your rule» — a rule's purchase, never mistaken for an ordinary one. */
export function buyByRuleWord(locale: WorkspaceLocale, amountUsd: number): string {
  const usd = usdWord(amountUsd, locale);
  return locale === "uk" ? `Купити ${usd} за правилом` : `Buy ${usd} by your rule`;
}

/** «Продати на $10» · «Sell $10» — the sale's one action on the sum chosen; «Продати все · $12,50» when it is the whole position. */
export function sellForWord(locale: WorkspaceLocale, sum: string, whole = false): string {
  if (whole) return locale === "uk" ? `Продати все · ${sum}` : `Sell all · ${sum}`;
  return locale === "uk" ? `Продати на ${sum}` : `Sell ${sum}`;
}

/** «У тебе 0,05 частки Apple ≈ $12,50» · «You hold 0.05 of a share ≈ $12.50» — the position under the sale's action, as «У гаманці 152,34 USDC» stands under the purchase's. */
export function heldLine(locale: WorkspaceLocale, units: string, usd: string | null): string {
  const worth = usd === null ? "" : ` ≈ ${usd}`;
  return locale === "uk" ? `У тебе ${units}${worth}` : `You hold ${units}${worth}`;
}

/** «Накопичено $0,60 · нагадаю від $1» · «$0.60 gathered · reminder from $1» — what a «З кожної оплати» rule waits with. */
export function gatheredLine(locale: WorkspaceLocale, gatheredUsd: number, minimumUsd: number): string {
  return locale === "uk" ? `Накопичено ${usdWord(gatheredUsd, locale)} · нагадаю від ${usdWord(minimumUsd, locale)}` : `${usdWord(gatheredUsd, locale)} gathered · reminder from ${usdWord(minimumUsd, locale)}`;
}

/** «Накопичено $0,50 з $1» · «$0.50 of $1 gathered» — the same, in one short line for Home's narrow column. */
export function gatheredShort(locale: WorkspaceLocale, gatheredUsd: number, minimumUsd: number): string {
  return locale === "uk" ? `Накопичено ${usdWord(gatheredUsd, locale)} з ${usdWord(minimumUsd, locale)}` : `${usdWord(gatheredUsd, locale)} of ${usdWord(minimumUsd, locale)} gathered`;
}

/** «Оплата $3,40 → $0,60 в Apple» · «A $3.40 payment → $0.60 into Apple» — what the rule would set aside, on an example. */
export function setAsideExample(locale: WorkspaceLocale, direction: "out" | "in", amountUsd: number, addUsd: number, name: string): string {
  const what = locale === "uk" ? (direction === "out" ? "Оплата" : "Надходження") : direction === "out" ? "payment" : "incoming transfer";
  return locale === "uk" ? `${what} ${usdWord(amountUsd, locale)} → ${usdWord(addUsd, locale)} в ${name}` : `A ${usdWord(amountUsd, locale)} ${what} → ${usdWord(addUsd, locale)} into ${name}`;
}

/** «Це звичайна купівля: нагадування правила на $20 лишиться відкритим.» — said by an ordinary purchase while a rule's reminder is open. */
export function plainLeavesOpenLine(locale: WorkspaceLocale, amountUsd: number): string {
  const usd = usdWord(amountUsd, locale);
  return locale === "uk" ? `Це звичайна купівля: нагадування правила на ${usd} лишиться відкритим.` : `This is a one-off purchase: your rule's ${usd} reminder stays open.`;
}

/**
 * The one-time reserve that opens the token's account, on its own line under
 * «Усі витрати» — «≈ $0,24 у SOL разово лишаються в гаманці на рахунку
 * токена». It stays in the person's wallet, so it is never counted among the
 * costs.
 */
export function reserveLine(locale: WorkspaceLocale, usd: string): string {
  return locale === "uk" ? `${usd} у SOL разово лишаються в гаманці на рахунку токена` : `${usd} in SOL, once — it stays in your wallet, on the token's account`;
}

/** Said first in «Перевірка» when that reserve is more than the purchase itself. */
export function reserveFirstLine(locale: WorkspaceLocale, reserveUsd: string, spendUsd: string): string {
  return locale === "uk"
    ? `Разовий резерв ${reserveUsd} у SOL більший за саму покупку (${spendUsd}). Він лишиться в гаманці на рахунку токена — це не витрата.`
    : `The one-time reserve, ${reserveUsd} in SOL, is more than the purchase itself (${spendUsd}). It stays in your wallet, on the token's account — it is not a cost.`;
}

/** «На $1 маршруту зараз немає. IREN — від $5.» — a company's own minimum, the least sum its live quote routes. */
export function routeMinimumLine(locale: WorkspaceLocale, asked: string, name: string, minimum: string): string {
  return locale === "uk" ? `На ${asked} маршруту зараз немає. ${name} — від ${minimum}.` : `No route for ${asked} right now. ${name} from ${minimum}.`;
}

/** «Поставити $5» — the one action that brings that minimum into the sum. */
export function setMinimumWord(locale: WorkspaceLocale, minimum: string): string {
  return locale === "uk" ? `Поставити ${minimum}` : `Use ${minimum}`;
}

/** «Вистачить ≈0,01 SOL (≈ $2) — …»: how much SOL is enough, in SOL and, with a price, in dollars. */
export function solEnoughLine(locale: WorkspaceLocale, sol: string, usd: number | null): string {
  const dollars = usd === null ? "" : ` (≈ $${usd})`;
  return locale === "uk"
    ? `Вистачить ≈${sol} SOL${dollars} — мережа бере невелику плату за кожну купівлю.`
    : `About ${sol} SOL${dollars} is enough — the network charges a small fee for every purchase.`;
}
