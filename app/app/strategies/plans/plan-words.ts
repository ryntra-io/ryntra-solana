import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PlanStatus } from "@/lib/api/v1/contract";

/**
 * Every word the Trading Plan surfaces say, in both languages, and the
 * formats they share. Figures are USD per underlying share and underlying
 * units; the words say so beside each one, because a number without its
 * unit does not exist here (canon §23.2).
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const PLAN_WORDS = {
  myStrategies: bi("My strategies", "Мої стратегії"),
  lead: bi("The plans you have saved, each on the version it stands on.", "Плани, які ти зберіг, кожен на версії, на якій стоїть."),
  newPlan: bi("New plan", "Новий план"),
  startFromStock: bi("A plan starts from a stock — pick the one it is for.", "План починається з акції — обери, для якої він."),
  pickAsset: bi("Which stock is the plan for?", "Для якої акції план?"),
  searchStocks: bi("Search by symbol or company", "Пошук за символом або компанією"),
  searching: bi("Searching…", "Шукаємо…"),
  noMatches: bi("Nothing matches.", "Нічого не знайдено."),
  pickerUnavailable: bi("The stock list could not be read right now.", "Список акцій зараз не вдалося прочитати."),
  openStocks: bi("Open Stocks", "Відкрити Акції"),
  connectToSee: bi("Connect a wallet to see your plans.", "Підключи гаманець, щоб побачити свої плани."),
  confirmToSee: bi("Confirm this wallet to see its plans.", "Підтверди гаманець, щоб побачити його плани."),
  confirmWallet: bi("Confirm wallet", "Підтвердити гаманець"),
  confirming: bi("Confirming…", "Підтверджуємо…"),
  loading: bi("Loading your plans…", "Завантажуємо плани…"),
  noPlans: bi("No plans yet.", "Планів ще немає."),
  couldNotLoad: bi("Your plans could not be read right now.", "Плани зараз не вдалося прочитати."),
  tryAgain: bi("Try again", "Спробувати ще раз"),
  version: bi("Version", "Версія"),
  updated: bi("Updated", "Оновлено"),
  plannedSize: bi("Planned size", "Плановий розмір"),
  budget: bi("Budget", "Бюджет"),
  status: bi("Status", "Стан"),
  /* statuses */
  draft: bi("Draft", "Чернетка"),
  active: bi("Active", "Активний"),
  executed: bi("Executed", "Виконано"),
  cancelled: bi("Cancelled", "Скасовано"),
  expired: bi("Expired", "Прострочено"),
  /* builder */
  builderTitle: bi("Trading plan", "Торговий план"),
  builderTitleEdit: bi("New version of the plan", "Нова версія плану"),
  builderLead: bi("Rules you write before you sign — the Review checks them, the result keeps them.", "Правила, які ти пишеш до підпису — Review їх перевіряє, результат їх зберігає."),
  asset: bi("Asset", "Актив"),
  assetLoading: bi("Reading the stock…", "Читаємо акцію…"),
  assetUnknown: bi("That token is not a confirmed stock representation.", "Цей токен — не підтверджене представлення акції."),
  reference: bi("Reference", "Референс"),
  tokenPrice: bi("Token price", "Ціна токена"),
  perShare: bi("per share", "за акцію"),
  thesis: bi("Thesis", "Теза"),
  thesisText: bi("Why this stock, in your words", "Чому ця акція, твоїми словами"),
  whyNow: bi("Why now (optional)", "Чому зараз (необов'язково)"),
  horizon: bi("Horizon", "Горизонт"),
  horizonCount: bi("How many", "Скільки"),
  days: bi("days", "днів"),
  weeks: bi("weeks", "тижнів"),
  months: bi("months", "місяців"),
  noHorizon: bi("No horizon", "Без горизонту"),
  sources: bi("Sources (one link per line, optional)", "Джерела (по одному посиланню в рядку, необов'язково)"),
  assumptions: bi("Assumptions (one per line, optional)", "Припущення (по одному в рядку, необов'язково)"),
  entry: bi("Entry", "Вхід"),
  entryPrice: bi("Planned entry, $ per share", "Плановий вхід, $ за акцію"),
  maxPrice: bi("Do not pay more than, $ per share", "Не платити більше ніж, $ за акцію"),
  noMaxPrice: bi("No bound — the Review reports the price and does not refuse", "Без межі — Review показує ціну й не відмовляє"),
  validUntil: bi("Entry valid until", "Вхід чинний до"),
  noValidUntil: bi("No expiry", "Без строку"),
  capital: bi("Capital", "Капітал"),
  budgetUsd: bi("Budget, $", "Бюджет, $"),
  reserve: bi("Kept for costs, $", "Резерв на витрати, $"),
  risk: bi("Planned risk", "Плановий ризик"),
  invalidation: bi("Invalidation, $ per share", "Інвалідація, $ за акцію"),
  invalidationNote: bi("Where the thesis is wrong. A rule you act on — no exit order is placed.", "Де теза хибна. Правило, за яким дієш ти — ордер виходу не виставляється."),
  plannedRisk: bi("Planned risk, $", "Плановий ризик, $"),
  costBuffer: bi("Modelled costs and slippage, %", "Змодельовані витрати й сліпедж, %"),
  exit: bi("Exit", "Вихід"),
  target: bi("Target, $ per share (optional)", "Ціль, $ за акцію (необов'язково)"),
  timeExit: bi("Time exit (optional)", "Вихід за часом (необов'язково)"),
  executionRules: bi("Execution rules", "Правила виконання"),
  maxSlippage: bi("Max slippage, %", "Макс. сліпедж, %"),
  maxQuoteAge: bi("Max quote age, s", "Макс. вік котирування, с"),
  maxDeviation: bi("Max deviation from the reference, %", "Макс. відхилення від референсу, %"),
  noDeviationBound: bi("No bound", "Без межі"),
  referenceRequired: bi("A current reference is required to execute", "Для виконання потрібен поточний референс"),
  minLiquidity: bi("Min pool liquidity, $ (optional)", "Мін. ліквідність пулу, $ (необов'язково)"),
  size: bi("Size", "Розмір"),
  sizeNote: bi("Planned risk under assumptions — a model, never a guaranteed maximum loss.", "Плановий ризик за припущеннями — модель, ніколи не гарантована максимальна втрата."),
  lossPerShare: bi("Loss per share to the invalidation", "Втрата за акцію до інвалідації"),
  riskLimited: bi("Risk-limited size", "Розмір за ризиком"),
  capitalLimited: bi("Capital-limited size", "Розмір за капіталом"),
  units: bi("units", "одиниць"),
  notional: bi("Planned spend", "Плановий обсяг"),
  limitedByRisk: bi("limited by the planned risk", "обмежено плановим ризиком"),
  limitedByCapital: bi("limited by the budget", "обмежено бюджетом"),
  check: bi("Check", "Перевірка"),
  checkPasses: bi("The rules make a plan.", "Правила складаються в план."),
  checkFails: bi("The rules do not make a plan yet:", "Правила ще не складаються в план:"),
  checkNote: bi("A deterministic check of the rules against each other — not an opinion on the trade.", "Детермінована перевірка правил між собою — не думка про угоду."),
  checkWaiting: bi("Write the thesis and the rules — the check runs as you type.", "Напиши тезу й правила — перевірка йде, поки ти пишеш."),
  /* what a blank or unreadable field needs, in place of a validator's own words */
  needThesis: bi("Say why this stock — one sentence is enough.", "Напиши, чому ця акція — досить одного речення."),
  needNumber: bi("A number is needed here.", "Тут потрібне число."),
  needDate: bi("A date and time is needed here.", "Тут потрібні дата й час."),
  needLink: bi("One link per line, starting with https://", "По одному посиланню в рядку, що починається з https://"),
  saveDraft: bi("Save as draft", "Зберегти чернеткою"),
  activate: bi("Activate plan", "Активувати план"),
  saveVersion: bi("Save as new version", "Зберегти новою версією"),
  reason: bi("Why this version (optional)", "Чому ця версія (необов'язково)"),
  saving: bi("Saving…", "Зберігаємо…"),
  saveFailed: bi("The plan could not be saved.", "План не вдалося зберегти."),
  conflict: bi("The plan changed since you opened it. Open it again and decide anew.", "План змінився, відколи ти його відкрив. Відкрий знову й вирішуй наново."),
  signInToSave: bi("Confirm your wallet to save the plan.", "Підтверди гаманець, щоб зберегти план."),
  /* detail */
  rules: bi("Rules", "Правила"),
  versions: bi("Versions", "Версії"),
  journal: bi("Journal", "Журнал"),
  executions: bi("Executions", "Виконання"),
  noExecutions: bi("No execution yet. Trade under this plan from Spot; the Review checks the version you are on.", "Виконань ще немає. Торгуй за цим планом у Споті; Review перевірить версію, на якій ти стоїш."),
  tradeUnderPlan: bi("Review purchase under this plan", "Перевірити купівлю за планом"),
  edit: bi("Edit plan", "Змінити план"),
  cancel: bi("Cancel plan", "Скасувати план"),
  cancelReason: bi("Why (optional)", "Чому (необов'язково)"),
  confirmCancel: bi("Cancel this plan?", "Скасувати цей план?"),
  keep: bi("Keep", "Залишити"),
  current: bi("current", "поточна"),
  firstVersion: bi("first version", "перша версія"),
  created: bi("created", "створено"),
  edited: bi("edited", "змінено"),
  activated: bi("activated", "активовано"),
  cancelledEvent: bi("cancelled", "скасовано"),
  reviewed: bi("reviewed", "перевірено"),
  executedEvent: bi("executed", "виконано"),
  expiredEvent: bi("expired", "прострочено"),
  notFound: bi("No such plan for this wallet.", "Такого плану для цього гаманця немає."),
  back: bi("My strategies", "Мої стратегії"),
  invalidationIsRule: bi("a rule, not an order", "правило, не ордер"),
  reportedOnly: bi("reported, not refused", "показується, не відмовляє"),
  required: bi("required", "обов'язково"),
  advisory: bi("advisory", "лише попередження"),
  none: bi("none", "немає"),
  seeAsset: bi("Open the asset", "Відкрити актив"),
  /* stage B — the page order, Plan vs Actual */
  attention: bi("Needs attention", "Потребують уваги"),
  activePlans: bi("Active", "Активні"),
  drafts: bi("Drafts", "Чернетки"),
  closed: bi("Closed", "Закриті"),
  recentResults: bi("Recent results", "Останні результати"),
  expiredHint: bi("The entry's validity has passed — write a new version or cancel the plan.", "Строк входу минув — напиши нову версію або скасуй план."),
  results: bi("Results", "Результати"),
  planVsActual: bi("Plan vs Actual", "План і факт"),
  colPlan: bi("Plan", "План"),
  colBefore: bi("Before signing", "Перед підписом"),
  colActual: bi("Actual", "Фактично"),
  followed: bi("Plan followed", "План дотримано"),
  deviated: bi("Deviated from the plan", "Відхилення від плану"),
  unsettled: bi("Not settled yet", "Ще не підтверджено"),
  entryPerShare: bi("Entry, per share", "Вхід, за акцію"),
  spend: bi("Spend", "Сума"),
  shares: bi("Shares", "Акцій"),
  modelledLoss: bi("Modelled loss", "Змодельована втрата"),
  fee: bi("Fee", "Комісія"),
  transaction: bi("Transaction", "Транзакція"),
  syncing: bi("The result is syncing with History and appears on the next read.", "Результат синхронізується з Історією і з'явиться при наступному читанні."),
  noResults: bi("No results yet. A result appears once a plan is executed.", "Результатів ще немає. Результат з'являється, щойно план виконано."),
  resultsLead: bi("What you planned, what the Review checked, what actually happened — for every execution under a plan.", "Що ти планував, що перевірив Review, що сталося насправді — для кожного виконання за планом."),
  allResults: bi("All results", "Усі результати"),
  entryOnly: bi("The verdict is about the entry only: no exit adherence, no realised profit, no stop discipline is claimed.", "Вердикт стосується лише входу: дотримання виходу, реалізований прибуток чи дисципліна стопу не оцінюються."),
  loadingResults: bi("Loading results…", "Завантажуємо результати…"),
  withinChecks: bi("checks on the fill", "перевірок на виконанні"),
  /* the Premium Product UI Pass (2026-09-15) — the plan page recomposed around decisions */
  planKind: bi("Trading plan", "Торговий план"),
  planStatus: bi("Plan status", "Стан плану"),
  now: bi("Now", "Зараз"),
  marketNow: bi("Market now", "Ринок зараз"),
  tokenPricePerShare: bi("Token price", "Ціна токена"),
  orientation: bi("An orientation — the price of your own order may differ. The Review decides at signing.", "Орієнтир — ціна твоєї заявки може відрізнятися. Вирішує Review при підписі."),
  stale: bi("stale", "застаріло"),
  /* The plan page's summary — the money said the way a person reads it (2026-09-16). */
  buyUnderPlan: bi("Purchase under the plan", "Купівля за планом"),
  about: bi("about", "близько"),
  riskLimit: bi("Risk limit", "Ліміт ризику"),
  modelledLossShort: bi("modelled loss", "оцінка втрати за моделлю"),
  highestPrice: bi("Highest price", "Найвища ціна"),
  planningPrice: bi("Planning price", "Ціна планування"),
  noAutoSell: bi("No automatic sell is set up — the actual loss can be larger than the model.", "Автоматичний продаж не налаштований — фактичний збиток може бути більшим за модель."),
  /* A plan on a pre-IPO token (RYN-FIRST-SCREEN-001): the three things to know before anything else, then the plan one press deep. */
  preIpoBanner: bi("Not a share · limited liquidity · no automatic stop", "Це не акція · ліквідність обмежена · автостопу немає"),
  details: bi("Details", "Деталі"),
  allRules: bi("All plan rules", "Усі умови плану"),
  history: bi("Plan history", "Історія плану"),
  showHistory: bi("Show history", "Показати історію"),
  historicalView: bi("Earlier version · view only", "Історична версія · лише перегляд"),
  stateDraft: bi("A draft. Activate it to trade under it.", "Чернетка. Активуй, щоб торгувати за нею."),
  stateWaiting: bi("Plan active · no purchase made yet.", "План активний · купівлю ще не виконано."),
  stateExecutedN: bi("executions under this plan", "виконань за цим планом"),
  stateCancelled: bi("Cancelled. Nothing changes any more.", "Скасовано. Більше нічого не змінюється."),
  entryExpiredOn: bi("Entry expired", "Вхід прострочено"),
  bound: bi("bound", "межа"),
  noBound: bi("no bound", "без межі"),
  withinBound: bi("within your bound", "у межах твоєї межі"),
  aboveBound: bi("above your bound", "вище твоєї межі"),
  referenceUnavailable: bi("Reference unavailable", "Референс недоступний"),
  pool: bi("Pool", "Пул"),
  min: bi("min", "мін."),
  marketUnavailable: bi("Market data is unavailable right now.", "Ринкові дані зараз недоступні."),
  marketReading: bi("Reading the market…", "Читаємо ринок…"),
  asOf: bi("As of", "Станом на"),
  reviewDecides: bi("The Review decides at signing.", "Вирішує Review при підписі."),
  riskRules: bi("Risk", "Ризик"),
  exitRules: bi("Exit and horizon", "Вихід і горизонт"),
  modelNote: bi("A model, not a guaranteed maximum loss.", "Модель, а не гарантована максимальна втрата."),
  viewingVersion: bi("Viewing an earlier version as it stood", "Переглядаєш попередню версію, як вона була"),
  backToCurrent: bi("Back to the current version", "До поточної версії"),
  currentChip: bi("Current", "Поточна"),
  activity: bi("Activity", "Активність"),
  eventCreated: bi("Plan created", "План створено"),
  eventEdited: bi("New version", "Нова версія"),
  eventActivated: bi("Activated", "Активовано"),
  eventCancelled: bi("Cancelled", "Скасовано"),
  eventReviewed: bi("Reviewed before signing", "Перевірено перед підписом"),
  eventExecuted: bi("Executed", "Виконано"),
  eventExpired: bi("Entry expired", "Вхід прострочено"),
  waitingNode: bi("Waiting for a trade", "Чекає на угоду"),
  viewTransaction: bi("View transaction", "Переглянути транзакцію"),
  assumptionsSources: bi("Assumptions and sources", "Припущення та джерела"),
  openPlan: bi("Open plan", "Відкрити план"),
  createPlan: bi("Create plan", "Створити план"),
  monitoring: bi("Monitoring", "Нагляд"),
  live: bi("Live", "Працює"),
  perShareShort: bi("/ share", "/ акцію"),
  kept: bi("kept for costs", "резерв на витрати"),
  noPlansTitle: bi("No plans yet", "Планів ще немає"),
  /* the builder, simplified (the Owner, 2026-09-15, late evening): three steps, the rest behind More rules */
  stepWhy: bi("Why this stock", "Чому ця акція"),
  thesisPlaceholder: bi("One or two sentences, in your own words.", "Одне-два речення своїми словами."),
  moreThesis: bi("Why now, horizon, sources, assumptions", "Чому зараз, горизонт, джерела, припущення"),
  stepMoney: bi("Money", "Гроші"),
  stepPrices: bi("Prices", "Ціни"),
  budgetLabel: bi("Budget", "Бюджет"),
  budgetHint: bi("The most this plan may spend, in USDC.", "Найбільше, що цей план може витратити, в USDC."),
  riskLabel: bi("Planned risk", "Плановий ризик"),
  riskHint: bi("The most you plan to lose if the price falls to your invalidation.", "Найбільше, що ти плануєш втратити, якщо ціна дійде до інвалідації."),
  entryLabel: bi("Entry price", "Ціна входу"),
  /* The entry's provenance, said for what it actually is (the audit of 2026-09-16 found "reference" written on a stock with none). */
  entryFromReference: bi("Prefilled with the reference price.", "Підставлено референсну ціну."),
  entryFromToken: bi("Prefilled with the token's market price per share — no reference is published.", "Підставлено ринкову ціну токена за акцію — референс не публікується."),
  entryFromTokenPrice: bi("Prefilled with the token's market price — this plan is per token; the issuer's mark is not a market reference.", "Підставлено ринкову ціну токена — цей план за токен; оцінка емітента не є ринковим референсом."),
  entryNone: bi("No per-share price is available — enter it yourself.", "Ціни за акцію немає — введи її сам."),
  entryYours: bi("Your own figure.", "Твоя цифра."),
  example: bi("e.g.", "напр."),
  readsAs: bi("reads as", "читається як"),
  /* The Owner did not know the word (2026-09-16): the surface says what it is, the `?` keeps the term. */
  invalidationLabel: bi("Where the thesis is wrong", "Де теза хибна"),
  invalidationHint: bi("The price at which you admit the idea failed and leave — yourself; no order is placed. This is the invalidation.", "Ціна, за якої ти визнаєш, що ідея не спрацювала, і виходиш — сам; ордер не виставляється. Це і є інвалідація."),
  maxPriceLabel: bi("Do not pay more than", "Не платити більше ніж"),
  maxPriceHint: bi("Above it the Review refuses.", "Вище цього Review відмовляє."),
  limitPrice: bi("Limit the purchase price", "Обмежувати ціну купівлі"),
  checkDeviation: bi("Check the deviation from the reference", "Перевіряти відхилення від референсу"),
  localTime: bi("your local time", "твій місцевий час"),
  perShareUnit: bi("$ per share", "$ за акцію"),
  moreRules: bi("More rules", "Більше правил"),
  moreRulesSub: bi("validity, costs, target, execution limits", "строк, витрати, ціль, межі виконання"),
  /* Conditions on observations — the person's own rules on what the market did (RYN-NANSEN-EVIDENCE-001). */
  stepEvidence: bi("Conditions on what the market did", "Умови щодо того, що робив ринок"),
  evidenceLead: bi("Your own rules on the token's onchain activity. The server reads the figures again at the Review, before you sign.", "Твої власні правила щодо активності токена в мережі. Сервер перечитає цифри на Review, перед підписом."),
  evidenceNone: bi("No conditions — the plan trades on its price and money rules alone.", "Умов немає — план торгує лише за ціновими та грошовими правилами."),
  addEvidence: bi("Add a condition", "Додати умову"),
  removeEvidence: bi("Remove", "Прибрати"),
  evidenceMetric: bi("Figure", "Показник"),
  evidenceWindow: bi("Window", "Вікно"),
  evidenceOperator: bi("Must be", "Має бути"),
  evidenceThreshold: bi("Threshold", "Поріг"),
  evidenceMode: bi("If not met, or unknown", "Якщо не виконано або невідомо"),
  evidenceWarn: bi("Warn me, I decide", "Лише попередити"),
  evidenceRequire: bi("Refuse the order", "Відхилити заявку"),
  evidenceCohortNote: bi("A movement of a labelled group can only warn.", "Рух позначеної групи може лише попереджати."),
  evidenceLabelNote: bi("The source's label on addresses can only warn.", "Мітка джерела на адресах може лише попереджати."),
  evidenceGroupMarket: bi("What the market did · Nansen", "Що робив ринок · Nansen"),
  evidenceGroupStructure: bi("How the token is built · DD.xyz", "Як збудований токен · DD.xyz"),
  evidenceState: bi("State", "Стан"),
  evidenceStructureShort: bi("the token's structure, as it stands", "структура токена, як є"),
  evidenceSourceDdxyz: bi("Data provided by DD.xyz", "Data provided by DD.xyz"),
  evidenceNow: bi("now", "зараз"),
  evidenceNowUnknown: bi("no figure right now", "зараз цифри немає"),
  evidenceAsked: bi("asked", "запит о"),
  evidenceReading: bi("reading the figure…", "читаємо цифру…"),
  evidenceRule: bi("Rule", "Правило"),
  evidenceConditions: bi("Conditions on what the market did", "Умови щодо ринку"),
  evidenceMet: bi("met", "виконано"),
  evidenceNotMet: bi("not met", "не виконано"),
  evidenceUnknownNow: bi("cannot be judged now", "зараз не можна перевірити"),
  evidenceSource: bi("Powered by Nansen API", "Powered by Nansen API"),
  evidenceRequireShort: bi("refuses the order", "відхиляє заявку"),
  evidenceWarnShort: bi("warns me, I decide", "лише попереджає"),
  evidenceAskedShort: bi("Onchain figures asked", "Ончейн-цифри запитано"),
  keptAuto: bi("kept for costs", "резерв на витрати"),
  youBuy: bi("Plan estimate", "Розрахунок плану"),
  atPlanningPrice: bi("at the planning price", "за ціною планування"),
  stillNeeded: bi("Still needed:", "Ще потрібно:"),
  needWhy: bi("why you are buying", "чому купуєш"),
  needBudget: bi("the budget", "бюджет"),
  needRisk: bi("the planned risk", "плановий ризик"),
  needEntry: bi("the entry price", "ціну входу"),
  needInvalidation: bi("where the thesis is wrong", "де теза хибна"),
  activateNote: bi("Does not buy anything — the purchase is a separate Review and your signature.", "Не виконує купівлю — купівля окремо, через Review і твій підпис."),
  lossIfPrefix: bi("If the price falls to", "Якщо ціна впаде до"),
  lossIfSuffix: bi("the modelled loss is about", "змодельована втрата близько"),
  costsModelled: bi("Costs and slippage modelled at", "Витрати й сліпедж змодельовано на"),
  fillTheRules: bi("Enter the budget and the risk to see the estimate.", "Вкажи бюджет і ризик, щоб побачити розрахунок."),
  ofBudget: bi("of the budget", "бюджету"),
  summaryLead: bi("The plans you have written, each on the version it stands on.", "Плани, які ти написав, кожен на версії, на якій стоїть."),
  /* A pre-IPO row's context beside the quote: the issuer's mark, the token's premium to it, the mint's transfer fee and the company's 24/7 index — each named for what it is, none a reference. */
  issuerMark: bi("Issuer's mark", "Оцінка емітента"),
  vsMark: bi("vs the mark", "до оцінки"),
  markNotReference: bi("the issuer's own figure · not a market reference", "власна цифра емітента · не ринковий референс"),
  transferFee: bi("Transfer fee", "Комісія переказу"),
  insideRoute: bi("withheld by the mint · inside the route's figures", "утримує mint · вже в цифрах маршруту"),
  companyIndex: bi("Company index", "Індекс компанії"),
  companyIndexIndicative: bi("Pyth · indicative · not the token's price", "Pyth · орієнтовний · не ціна токена"),
  companyIndexUnavailable: bi("Company index unavailable", "Індекс компанії недоступний"),
  monitoringWatching: bi("Monitoring is watching this plan", "Monitoring стежить за цим планом"),
  /* 1.7.0 — a plan on a token (RYN-PLAN-CRYPTO-001): the picker over every asset a plan may name, the catalogue's own words, the indication as planning context. */
  startFromAsset: bi("A plan starts from an asset — a tokenized stock, SOL, a verified crypto or meme.", "План починається з активу — токенізованої акції, SOL, перевіреної крипти чи мему."),
  pickAssetAny: bi("Which asset is the plan for?", "Для якого активу план?"),
  searchAssets: bi("Search a stock, SOL, a crypto or a meme", "Пошук акції, SOL, крипти чи мему"),
  pickGroupStocks: bi("Tokenized stocks", "Токенізовані акції"),
  pickGroupTokens: bi("Crypto and memes · verified on Jupiter", "Крипта і меми · перевірені на Jupiter"),
  assetUnknownAny: bi("That token is neither a confirmed stock representation nor a verified token of the catalogue, so no plan can name it.", "Цей токен — не підтверджене представлення акції і не перевірений токен каталогу, тож план його не назве."),
  assetLoadingAny: bi("Reading the asset…", "Читаємо актив…"),
  verifiedOnJupiter: bi("Verified on Jupiter", "Перевірено на Jupiter"),
  kindCrypto: bi("Crypto", "Крипта"),
  kindMeme: bi("Meme", "Мем"),
  kindStock: bi("Tokenized stock", "Токенізована акція"),
  planningPriceAsOf: bi("planning price as of", "ціна планування станом на"),
  planningPriceStale: bi("an older read", "старіше читання"),
  planningPriceNone: bi("no market indication right now", "ринкової індикації зараз нема"),
  planningPriceNote: bi("A planning price is context for your figures, never the price you will get: the Review takes a fresh executable quote.", "Ціна планування — контекст для твоїх цифр, а не ціна, яку ти отримаєш: Review бере свіжу виконувану ціну."),
  entryNoneToken: bi("No market indication right now — write your own entry.", "Ринкової індикації зараз нема — впиши свій вхід."),
  entryFromIndication: bi("Prefilled with the market price Jupiter stated — planning context, not the price you will get.", "Підставлено ринкову ціну від Jupiter — контекст для планування, а не ціна, яку ти отримаєш."),
  noReferenceForToken: bi("A token has no issuer reference: no deviation bound and no reference rule apply to this plan.", "У токена немає референсу емітента: межа відхилення і правило референсу до цього плану не застосовуються."),
  liquidity: bi("Liquidity", "Ліквідність"),
  changeDay: bi("24h", "24 год"),
  changeThen: bi("change the planned entry or the maximum price", "зміни плановий вхід або максимальну ціну"),
  seeMarket: bi("Open the market", "Відкрити ринок"),
} as const satisfies Record<string, Bi>;

export type PlanWord = keyof typeof PLAN_WORDS;

/**
 * The unit word inside a label: a plan on a token-priced instrument (the
 * pre-IPO issuers, `RYN-STOCKS-PROVIDERS-001`) says *per token* wherever a
 * share plan says *per share* — the same label, the same figure, the unit
 * the plan is actually in.
 */
export function unitize(text: string, unitBasis: "share" | "token"): string {
  if (unitBasis === "share") return text;
  return text
    .replace(/per share/g, "per token")
    .replace(/per-share/g, "per-token")
    .replace(/\/ share/g, "/ token")
    .replace(/\bShares\b/g, "Tokens")
    .replace(/за акцію/g, "за токен")
    .replace(/\/ акцію/g, "/ токен")
    .replace(/Акцій/g, "Токенів")
    /* A plan on a token asks why the asset, not why the stock (1.7.0). */
    .replace(/this stock/g, "this asset")
    .replace(/ця акція/g, "цей актив")
    .replace(/цю акцію/g, "цей актив");
}

export function planWordsFor(locale: WorkspaceLocale, unitBasis: "share" | "token" = "share"): (word: PlanWord) => string {
  return (word) => unitize(PLAN_WORDS[word][locale], unitBasis);
}

/**
 * The rule conflicts the size module names (`validatePlanRules`), in both
 * languages. The module speaks English — it is the server's — and the form
 * says the same thing in the person's language; a message the form does not
 * know is shown as it came, never dropped.
 */
const RULE_ISSUE_WORDS: ReadonlyMap<string, Bi> = new Map([
  ["The invalidation must be below the planned entry for a long.", bi("The invalidation must be below the planned entry for a long.", "Інвалідація має бути нижче планового входу для довгої позиції.")],
  ["The maximum entry price cannot be below the planned entry.", bi("The maximum entry price cannot be below the planned entry.", "Максимальна ціна входу не може бути нижчою за плановий вхід.")],
  ["The entry's validity is already over.", bi("The entry's validity is already over.", "Строк дії входу вже минув.")],
  ["The reserve for costs leaves nothing of the budget to spend.", bi("The reserve for costs leaves nothing of the budget to spend.", "Резерв на витрати не лишає з бюджету нічого на купівлю.")],
  ["The planned risk cannot exceed the budget.", bi("The planned risk cannot exceed the budget.", "Плановий ризик не може перевищувати бюджет.")],
  ["The target must be above the planned entry for a long.", bi("The target must be above the planned entry for a long.", "Ціль має бути вище планового входу для довгої позиції.")],
  ["The time exit is already in the past.", bi("The time exit is already in the past.", "Вихід за часом уже в минулому.")],
  ["The time exit is before the entry stops being valid.", bi("The time exit is before the entry stops being valid.", "Вихід за часом раніше, ніж закінчується строк дії входу.")],
  /* The evidence layer's own refusals (lib/evidence/conditions.ts), in the person's language. */
  ["The metric is not one the evidence layer serves.", bi("This figure cannot be a rule.", "Цей показник не може бути правилом.")],
  ["The window is not one this figure serves.", bi("This window is not served for this figure.", "Це вікно не обслуговується для цього показника.")],
  ["The operator must be gt, gte, lt or lte.", bi("Choose whether the figure must be above or below the threshold.", "Обери, чи має показник бути вище або нижче порога.")],
  ["The threshold must be a finite number.", bi("The threshold needs a number.", "Порогу потрібне число.")],
  ["This figure is never below zero; the threshold cannot be negative.", bi("This figure is never below zero; the threshold cannot be negative.", "Цей показник ніколи не буває нижче нуля; поріг не може бути від'ємним.")],
  ["A count of addresses is a whole number.", bi("A count of addresses is a whole number.", "Кількість адрес — ціле число.")],
  ["The mode must be advisory or required.", bi("Choose what happens when the rule is not met.", "Обери, що станеться, коли правило не виконано.")],
  ["This figure covers a labelled group, not the whole market; it can inform a plan but not block one.", bi("A movement of a labelled group can warn, not refuse the order.", "Рух позначеної групи може попереджати, а не відхиляти заявку.")],
  ["A required condition blocks when it cannot be judged.", bi("A condition that refuses the order also refuses when it cannot be judged.", "Умова, що відхиляє заявку, відхиляє її і тоді, коли її не можна перевірити.")],
  ["An advisory condition warns when it cannot be judged.", bi("A condition that warns also warns when it cannot be judged.", "Умова, що попереджає, попереджає і тоді, коли її не можна перевірити.")],
  ["At most 10 evidence conditions on one plan.", bi("At most ten conditions on one plan.", "Щонайбільше десять умов на один план.")],
]);

export function ruleIssueWord(message: string, locale: WorkspaceLocale): string {
  return RULE_ISSUE_WORDS.get(message)?.[locale] ?? message;
}

/** The figures a rule sentence names — the person's own, from the draft as parsed or the rules as sent. */
export type IssueFigures = Readonly<{
  entry?: number | null;
  maxPrice?: number | null;
  invalidation?: number | null;
  budget?: number | null;
  reserve?: number | null;
  risk?: number | null;
  target?: number | null;
  validUntil?: string | null;
  timeExit?: string | null;
}>;

/**
 * A contradiction said with the person's own figures and the next action
 * (the Owner's directive of 2026-09-22): *your planned entry is $974, but
 * your maximum price is $900 — change the planned entry or the maximum
 * price*, never the validator's dry sentence. Keyed by the issue's stable
 * code (contract 1.7.0); an issue without one, or without its figures,
 * falls back to the translated sentence.
 */
export function issueSentence(issue: Readonly<{ path: string; message: string; code?: string }>, figures: IssueFigures, locale: WorkspaceLocale, unitBasis: "share" | "token" = "share"): string {
  const uk = locale === "uk";
  const money = (value: number | null | undefined) => (value === null || value === undefined ? null : fmtUsd(value, locale));
  const unit = unitize(uk ? "за акцію" : "per share", unitBasis);
  const entry = money(figures.entry);
  const maxPrice = money(figures.maxPrice);
  const invalidation = money(figures.invalidation);
  const budget = money(figures.budget);
  const reserve = money(figures.reserve);
  const risk = money(figures.risk);
  const target = money(figures.target);
  switch (issue.code) {
    case "MAX_PRICE_BELOW_ENTRY":
      if (entry && maxPrice) return uk ? `Твій плановий вхід ${entry} ${unit}, а максимальна ціна ${maxPrice}. Зміни плановий вхід або максимальну ціну.` : `Your planned entry is ${entry} ${unit}, but your maximum price is ${maxPrice}. Change the planned entry or the maximum price.`;
      break;
    case "INVALIDATION_NOT_BELOW_ENTRY":
      if (entry && invalidation) return uk ? `Інвалідація ${invalidation} ${unit} не нижче планового входу ${entry}. Для довгої позиції інвалідація стоїть нижче входу — знизь її або підніми вхід.` : `The invalidation ${invalidation} ${unit} is not below the planned entry ${entry}. For a long the invalidation sits below the entry — lower it or raise the entry.`;
      break;
    case "RISK_ABOVE_BUDGET":
      if (risk && budget) return uk ? `Плановий ризик ${risk} більший за бюджет ${budget}. Зменш ризик або збільш бюджет.` : `The planned risk ${risk} is more than the budget ${budget}. Lower the risk or raise the budget.`;
      break;
    case "RESERVE_LEAVES_NOTHING":
      if (reserve && budget) return uk ? `Резерв на витрати ${reserve} не лишає з бюджету ${budget} нічого на купівлю. Зменш резерв або збільш бюджет.` : `The reserve for costs ${reserve} leaves nothing of the ${budget} budget to spend. Lower the reserve or raise the budget.`;
      break;
    case "TARGET_NOT_ABOVE_ENTRY":
      if (target && entry) return uk ? `Ціль ${target} ${unit} не вище планового входу ${entry}. Підніми ціль або прибери її.` : `The target ${target} ${unit} is not above the planned entry ${entry}. Raise the target or leave it out.`;
      break;
    case "ENTRY_VALIDITY_OVER":
      if (figures.validUntil) return uk ? `Строк дії входу (${fmtWhen(figures.validUntil, locale)}) уже минув. Постав пізнішу дату або прибери її.` : `The entry's validity (${fmtWhen(figures.validUntil, locale)}) is already over. Set a later date or leave it out.`;
      break;
    case "TIME_EXIT_IN_PAST":
      if (figures.timeExit) return uk ? `Вихід за часом (${fmtWhen(figures.timeExit, locale)}) уже в минулому. Постав пізнішу дату або прибери її.` : `The time exit (${fmtWhen(figures.timeExit, locale)}) is already in the past. Set a later date or leave it out.`;
      break;
    case "TIME_EXIT_BEFORE_VALIDITY":
      if (figures.timeExit && figures.validUntil) return uk ? `Вихід за часом (${fmtWhen(figures.timeExit, locale)}) раніше, ніж закінчується строк дії входу (${fmtWhen(figures.validUntil, locale)}). Зсунь одну з дат.` : `The time exit (${fmtWhen(figures.timeExit, locale)}) is before the entry stops being valid (${fmtWhen(figures.validUntil, locale)}). Move one of the dates.`;
      break;
    case "SIZES_TO_NOTHING":
      return uk ? "З цим бюджетом і плановим ризиком розмір виходить нульовий. Збільш бюджет або ризик, або звузь відстань до інвалідації." : "With this budget and planned risk the size comes to nothing. Raise the budget or the risk, or narrow the distance to the invalidation.";
    case "LOSS_PER_UNIT_NOT_POSITIVE":
      return uk ? `Втрата ${unit} до інвалідації не додатна. Постав інвалідацію нижче входу.` : `The loss ${unit} to the invalidation is not a positive figure. Put the invalidation below the entry.`;
    case "REFERENCE_NOT_ON_TOKEN":
      return PLAN_WORDS.noReferenceForToken[locale];
    case "DEVIATION_NOT_ON_TOKEN":
      return PLAN_WORDS.noReferenceForToken[locale];
    default:
      break;
  }
  return unitize(ruleIssueWord(issue.message, locale), unitBasis);
}

export function statusWord(status: PlanStatus, locale: WorkspaceLocale): string {
  return PLAN_WORDS[status][locale];
}

/** Money the way the stock desk writes it — a dollar sign in both languages, the locale's separators. */
export function fmtUsd(value: number | null | undefined, locale: WorkspaceLocale, digits?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  /* A per-token price below a cent (a meme) is said with its significant digits, never as $0.00 — unless a caller asked for fixed digits. */
  const text = digits === undefined && magnitude > 0 && magnitude < 0.01
    ? magnitude.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { maximumSignificantDigits: 4 })
    : magnitude.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 });
  return `${value < 0 ? "−" : ""}$${text}`;
}

/** A form label as a fact label: the unit and the "(optional)" note belong to the field, not to the figure beside it. */
export function factLabel(label: string): string {
  return label.replace(/\s*\((?:optional|необов'язково)\)$/u, "").replace(/,\s*(\$ per share|\$ за акцію|\$|%|s|с)$/u, "");
}

/**
 * The model's assumptions in the person's language — the same four facts the
 * server stores in English beside the size, rendered from the rules and the
 * size rather than translated as prose.
 */
export function assumptionsFor(rules: Readonly<{ risk: Readonly<{ invalidationPerShare: number; costBufferBps: number }> }>, sizing: Readonly<{ limitedBy: "risk" | "capital" }>, locale: WorkspaceLocale): readonly string[] {
  const invalidation = fmtUsd(rules.risk.invalidationPerShare, locale);
  const buffer = (rules.risk.costBufferBps / 100).toFixed(2);
  if (locale === "uk") {
    return [
      `Інвалідація ${invalidation} за акцію — правило, за яким дієш ти, а не ордер виходу.`,
      `Витрати й сліпедж змодельовано як ${buffer}% від входу, разом на вхід і вихід.`,
      "Геп крізь інвалідацію, брак ліквідності або пропущений вихід можуть коштувати більше за плановий ризик.",
      sizing.limitedBy === "risk" ? "Розмір обмежено плановим ризиком, а не бюджетом." : "Розмір обмежено бюджетом, а не плановим ризиком.",
    ];
  }
  return [
    `The invalidation at ${invalidation} per share is a rule you act on, not an exit order.`,
    `Costs and slippage are modelled at ${buffer}% of the entry, on the way in and out together.`,
    "A gap through the invalidation, missing liquidity or a missed exit can lose more than the planned risk.",
    sizing.limitedBy === "risk" ? "The size is limited by the planned risk, not by the budget." : "The size is limited by the budget, not by the planned risk.",
  ];
}

export function fmtUnits(value: number | null | undefined, locale: WorkspaceLocale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

export function fmtWhen(iso: string | null | undefined, locale: WorkspaceLocale): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  return new Date(at).toLocaleString(locale === "uk" ? "uk-UA" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}

export function fmtDate(iso: string | null | undefined, locale: WorkspaceLocale): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  return new Date(at).toLocaleDateString(locale === "uk" ? "uk-UA" : "en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
