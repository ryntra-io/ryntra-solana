import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * Team Launch (MOS-2) in both languages. One line per idea, a number where there is one, and the hard facts — what is
 * fixed for ever, what each fee is a share of, what nothing enforces yet — said before the signature, not after.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const TEAM_LAUNCH_WORDS = {
  title: bi("Team Launch", "Запуск командою"),
  lede: bi("Eight steps, one signature at the end. Every rule of the market is written before it, and read after it — never rewritten.", "Вісім кроків і один підпис у кінці. Усі правила ринку пишуться до нього, а після нього лише читаються."),
  stepsLabel: bi("Steps of the launch", "Кроки запуску"),
  stepOf: bi("Step {n} of 8:", "Крок {n} з 8:"),
  back: bi("Back", "Назад"),
  next: bi("Next", "Далі"),
  commit: bi("Record the step", "Записати крок"),
  recorded: bi("Recorded in the journal: {id}", "Записано в журнал: {id}"),
  recordedAgain: bi("Already recorded with these fields: {id}", "Уже записано з цими полями: {id}"),

  /* The switch */
  closedTitle: bi("Team Launch is not open here", "Запуск командою тут не відкрито"),
  closedBody: bi("The first launch by a team is the owner's own canary on the wallets the deployment names. Until he turns it on, the steps fill and count, nothing is recorded in the journal, and nothing is signed or sent.", "Перший запуск командою — канарка власника на названих гаманцях. Доки він не ввімкне, кроки заповнюються й рахуються, у журнал нічого не пишеться, нічого не підписується й не надсилається."),
  teamTitle: bi("The team", "Команда"),
  teamId: bi("The team's id", "Ідентифікатор команди"),
  teamHint: bi("A team of Ryntra, with its roles and its Squads treasury. Every step takes its rights from there.", "Команда Ryntra з ролями й казною Squads. Кожен крок бере права звідти."),
  rights: bi("This step needs: {rights}", "Крок потребує: {rights}"),
  rightAllowed: bi("your role holds it", "твоя роль це має"),
  rightMultisig: bi("as a proposal on the team's treasury", "пропозицією в казні команди"),
  rightRefused: bi("your role does not hold it", "твоя роль цього не має"),
  waitsTreasury: bi("This step waits for the team's treasury.", "Цей крок чекає на казну команди."),

  /* 01 */
  projectTitle: bi("The project", "Проєкт"),
  projectName: bi("The project's name", "Назва проєкту"),
  projectSummary: bi("What it is, in a few lines", "Що це, у кілька рядків"),
  projectSummaryHint: bi("The Passport shows this beside the mint's authorities. A kept mint or freeze authority is control over everybody's tokens: say it here.", "Паспорт показує це поряд із правами мінту. Залишене право емісії чи заморозки — це влада над чужими токенами: скажи про це тут."),
  projectWebsite: bi("Website", "Сайт"),
  projectX: bi("X", "X"),

  /* 02 */
  tokenTitle: bi("The token", "Токен"),
  tokenName: bi("The token's name", "Назва токена"),
  tokenSymbol: bi("Ticker", "Тікер"),
  tokenDecimals: bi("Decimals", "Знаків після коми"),
  tokenSupply: bi("Supply, whole tokens", "Емісія, цілих токенів"),
  tokenSupplyHint: bi("The whole supply in base units is the supply × 10^decimals — whole units, and the allocation adds up to them exactly.", "Уся емісія в базових одиницях — емісія × 10^знаків: цілі одиниці, і розподіл сходиться в них точно."),
  authorities: bi("The mint's authorities", "Права мінту"),
  authorityMint: bi("Mint more", "Домінтити"),
  authorityFreeze: bi("Freeze a holder", "Заморозити холдера"),
  authorityUpdate: bi("Change the metadata", "Змінити метадані"),
  revoked: bi("revoked", "відкликано"),
  kept: bi("kept", "залишено"),

  /* 03 */
  allocationTitle: bi("The allocation", "Розподіл"),
  allocationHint: bi("Whole per cent of the supply, adding up to 100 — no fractions anywhere. The base units below add up to the supply exactly: what rounding leaves goes to the row that lost most to it.", "Цілі відсотки емісії, у сумі 100 — без дробів. Базові одиниці нижче сходяться в емісію точно: що лишає округлення, дістає рядок, який утратив найбільше."),
  allocationAdd: bi("Add a row", "Додати рядок"),
  allocationRemove: bi("Remove", "Вилучити"),
  allocationPct: bi("%", "%"),
  allocationRecipient: bi("Recipient", "Отримувач"),
  allocationCliff: bi("Cliff, days", "Обрив, днів"),
  allocationUnlock: bi("Unlocked by, days", "Відкрито за, днів"),
  allocationUnits: bi("Base units", "Базових одиниць"),
  allocationSum: bi("{sum} % of 100", "{sum} % зі 100"),
  allocationProblem: bi("The rows must be whole per cent adding up to 100, each with a recipient that is an address and a cliff no later than its end.", "Рядки — цілі відсотки в суму 100, отримувач — адреса, обрив — не пізніше кінця розблокування."),
  circulating: bi("Circulating on day one", "В обігу першого дня"),
  locked: bi("Locked", "Заблоковано"),
  dilution: bi("A day-one share becomes this much of the whole once every lock has opened", "Частка першого дня стане такою часткою всього, коли відкриються всі замки"),

  /* 04 */
  curveTitle: bi("The curve", "Крива"),
  curvePreset: bi("The launch's preset", "Формат запуску"),
  curveFacts: bi("Opens at ${start} market cap, moves to the DEX at ${graduation}.", "Відкривається на капіталізації ${start}, виходить на DEX на ${graduation}."),
  curveThreshold: bi("The curve must raise {quote} of the pair currency first.", "Крива має зібрати {quote} парної валюти."),
  firstBuy: bi("The team's first purchase, base units of the pair currency", "Перша покупка команди, базових одиниць парної валюти"),
  firstBuyHint: bi("Whole base units. «0» — the market opens with no trade of the team's own.", "Цілі базові одиниці. «0» — ринок відкривається без угоди команди."),
  firstBuyLock: bi("Locked for, days", "Замкнено на, днів"),
  sniperFee: bi("The first buyers pay {start} falling to {end} over {seconds} s.", "Перші покупці платять {start}, що падає до {end} за {seconds} с."),

  /* 05 */
  liquidityTitle: bi("Liquidity", "Ліквідність"),
  lpLocked: bi("Both positions that move to the DEX — the team's and Ryntra's — are locked for ever. The program has no instruction to unlock them.", "Обидві позиції, що йдуть на DEX, — команди й Ryntra — замкнені назавжди. Програма не має інструкції їх відкрити."),
  budgetSources: bi("Where the market's budget may come from", "Звідки може надходити бюджет ринку"),
  budgetSourceMigration: bi("The fee at the move to the DEX", "Комісія виходу на DEX"),
  budgetSourceSurplus: bi("What the curve raised above its threshold", "Зібране кривою понад поріг"),
  budgetSourceCurve: bi("A share of the partner's fees on the curve", "Частка партнерських комісій кривої"),
  budgetSourceLp: bi("A share of the locked position's fees", "Частка комісій замкненої позиції"),
  budgetHint: bi("Fees actually collected on this market, never anybody else's money.", "Лише фактично зібрані комісії цього ринку — не чужі кошти."),

  /* 06 */
  rightsTitle: bi("Rights", "Права"),
  treasury: bi("The team's Squads treasury", "Казна Squads команди"),
  treasuryHint: bi("The multisig the launch is proposed on. Ryntra signs nothing here and holds no key.", "Мультипідпис, у якому пропонується запуск. Ryntra тут нічого не підписує й не має ключа."),
  feeSharesTitle: bi("Who shares the creator's fees", "Хто ділить комісії творця"),
  feeSharesHint: bi("Meteora's Dynamic Fee Sharing writes these rows once, when the vault is made; afterwards nobody — not the team, not Ryntra — can change them. What nobody takes stays with the creator's row.", "Dynamic Fee Sharing від Meteora пише ці рядки один раз, коли створюється сейф; потім їх не змінить ніхто — ні команда, ні Ryntra. Нерозібране лишається в рядку творця."),
  shareAddress: bi("Wallet", "Гаманець"),
  shareBps: bi("Basis points", "Базисних пунктів"),
  rulesFixed: bi("The market's rules are not changeable after the launch: another set of rules is another market.", "Правила ринку після запуску не змінюються: інші правила — інший ринок."),

  /* 07 */
  automationTitle: bi("Market automation", "Автоматика ринку"),
  ladder: bi("Run the Fee-Funded Liquidity Ladder", "Вести драбину ліквідності з комісій"),
  ladderNotFunded: bi("Nothing funds a budget on this market now — either the partner's fees go to the multisig rather than to a budget Ryntra's executor claims, or the executor is not claiming it on markets like this one yet. The ladder does not run, and nothing promises it.", "Бюджет цього ринку зараз ніщо не наповнює: або партнерські комісії йдуть на мультисиг, а не в бюджет, який забирає виконавець Ryntra, або виконавець поки не забирає його на таких ринках. Драбина не працює, і ніщо її не обіцяє."),
  ladderHint: bi("Buy steps below the price, paid for out of the fees this market collected. It is depth that can be eaten — never a floor under the price, and never a promise about it.", "Сходинки купівлі нижче ціни, оплачені з комісій цього ринку. Це глибина, яку можна з'їсти, — не підлога під ціною й не обіцянка про неї."),
  deployedMax: bi("At most this much of the budget stands in the steps at once, basis points", "Не більше цієї частки бюджету стоїть у сходинках, базисних пунктів"),
  pauseDrop: bi("A fall within an hour that stops new money into the steps, basis points", "Падіння за годину, яке спиняє нові кошти в сходинки, базисних пунктів"),
  stopByHand: bi("The team may stop the market by hand, beside the rules", "Команда може спинити ринок рукою, поряд із правилами"),
  chronicleTitle: bi("The market's chronicle", "Хроніка ринку"),
  chronicleHint: bi("What the market records, and who records it. A row nothing writes yet says so.", "Що ринок записує й хто записує. Рядок, якого поки ніщо не пише, так і сказано."),
  byTeam: bi("the team", "команда"),
  byVenue: bi("the venue's program", "програма майданчика"),
  byExecutor: bi("Ryntra's executor", "виконавець Ryntra"),

  /* 08 */
  reviewTitle: bi("Simulation, fees, signature", "Симуляція, комісії, підпис"),
  simulationTitle: bi("The simulation", "Симуляція"),
  feesTitle: bi("Every fee, row by row", "Усі комісії, рядок за рядком"),
  feesHint: bi("Each row says what it is a share of: a fee of a trade, what the curve raised, or the liquidity that moves to the pool. Nothing is summed into one figure.", "Кожен рядок каже, часткою чого він є: комісії угоди, зібраного кривою чи ліквідності, що йде в пул. Нічого не зводиться в одне число."),
  feeWhenCurve: bi("On the curve", "На кривій"),
  feeWhenGraduation: bi("At the move to the DEX", "На виході на DEX"),
  feeWhenPool: bi("In the DEX pool", "У пулі на DEX"),
  feeOfFee: bi("of the fee", "від комісії"),
  feeOfRaised: bi("of what the curve raised", "від зібраного кривою"),
  feeOfLiquidity: bi("of the liquidity moving in", "від ліквідності, що йде в пул"),
  budgetTitle: bi("The market's budget", "Бюджет ринку"),
  constitutionTitle: bi("The market's Constitution", "Конституція ринку"),
  constitutionHint: bi("The document the market is read by. Each field says what makes it hold: the venue's program, Ryntra's server, a statement, or nothing yet.", "Документ, за яким читають ринок. У кожного поля сказано, що його тримає: програма майданчика, сервер Ryntra, заява чи поки ніщо."),
  unknown: bi("not named yet", "поки не названо"),
  enforcementOnchain: bi("the program", "програма"),
  enforcementServer: bi("Ryntra's server", "сервер Ryntra"),
  enforcementInformational: bi("a statement", "заява"),
  enforcementNone: bi("nothing yet", "поки ніщо"),
  signTitle: bi("The signature", "Підпис"),
  signClosed: bi("Nothing is signed from here. The launch itself is a proposal on the team's treasury, and it opens with the owner's own canary.", "Звідси нічого не підписується. Сам запуск — пропозиція в казні команди, і він відкривається канаркою власника."),
  fixFirst: bi("Fix the steps above first.", "Спершу виправ кроки вище."),
  noPriceTitle: bi("No price is promised", "Ціна не обіцяна"),
  noPriceBody: bi("Depth below the price can be eaten. Ryntra sells depth and a readable record of it, never a price.", "Глибину під ціною можна з'їсти. Ryntra дає глибину й чесний запис про неї, а не ціну."),
  /* What each refusal of a step means, in a person's words — the step says what to fix, not «something is wrong». */
  pTEAM_MISSING: bi("Name the team: its id is 24 hexadecimal characters, as «Команда й ролі» shows it.", "Назви команду: її ідентифікатор — 24 шістнадцяткові знаки, як показує «Команда й ролі»."),
  pNAME: bi("The project's name is two to 64 characters.", "Назва проєкту — від двох до 64 знаків."),
  pSUMMARY: bi("Say what the project is, in 16 to 600 characters.", "Скажи, що це за проєкт, — від 16 до 600 знаків."),
  pWEBSITE: bi("The site is a full https address.", "Сайт — повна адреса з https."),
  pX: bi("The X handle is up to 15 letters, digits or underscores.", "Акаунт X — до 15 літер, цифр або підкреслень."),
  pTOKEN_NAME: bi("The token's name is two to 32 characters.", "Назва токена — від двох до 32 знаків."),
  pSYMBOL: bi("The ticker is two to ten capital letters or digits.", "Тікер — від двох до десяти великих літер або цифр."),
  pDECIMALS: bi("Decimals: a whole number from 0 to 9.", "Знаків після коми — ціле число від 0 до 9."),
  pSUPPLY: bi("The supply is a whole number of tokens, at least one.", "Емісія — ціле число токенів, щонайменше один."),
  pAUTHORITY_KEPT_UNDECLARED: bi("A kept mint or freeze authority needs a statement of its own — at least 80 characters — and a site or an X account where the issuer can be asked about it.", "Залишене право емісії чи заморозки потребує окремої заяви — від 80 знаків — і сайту або акаунта X, де емітента можна про це спитати."),
  pALLOCATION: bi("Whole per cent adding up to 100, a recipient that is an address, and a cliff no later than the end of the unlock.", "Цілі відсотки в суму 100, отримувач — адреса, обрив — не пізніше кінця розблокування."),
  pRECIPIENTS_MISSING: bi("Before the signature every row needs a recipient: the mint sends the supply somewhere.", "До підпису кожен рядок потребує отримувача: мінт надсилає емісію комусь."),
  pPRESET: bi("This preset is not offered on this network.", "Цього формату в цій мережі немає."),
  pFIRST_BUY: bi("The first purchase is whole base units of the pair currency.", "Перша покупка — цілі базові одиниці парної валюти."),
  pFIRST_BUY_LOCK: bi("This preset locks the first purchase for longer than that.", "Цей формат замикає першу покупку на довше."),
  pBUDGET_SOURCES: bi("Name at least one source of the market's budget.", "Назви хоча б одне джерело бюджету ринку."),
  pNO_TREASURY: bi("The team needs a Squads treasury: the launch is proposed on it.", "Команді потрібна казна Squads: у ній пропонується запуск."),
  pFEE_SHARES: bi("The split does not hold: two to five distinct wallets, each at least one per cent, whole basis points adding up to the creator's whole fee.", "Розподіл не тримається: від двох до п'яти різних гаманців, кожен щонайменше один відсоток, цілі базисні пункти в суму всієї комісії творця."),
  pFEE_SHARES_PRESET: bi("Only «Спільнота» writes a vault of the creator's fees; on this preset the split could not be created.", "Лише «Спільнота» створює сейф комісій творця; на цьому форматі такий розподіл не створити."),
  pLADDER_SHARE: bi("The share standing in the steps is whole basis points, within the executor's own ceiling.", "Частка, що стоїть у сходинках, — цілі базисні пункти в межах стелі виконавця."),
  pPAUSE_DROP: bi("The fall that stops the steps is whole basis points, within the executor's own ceiling.", "Падіння, що спиняє сходинки, — цілі базисні пункти в межах стелі виконавця."),
  pSTEPS_BEFORE: bi("Fix the steps above first.", "Спершу виправ кроки вище."),
  failure: bi("The step was not recorded: {message}", "Крок не записано: {message}"),
} as const;

export type TeamLaunchWordKey = keyof typeof TEAM_LAUNCH_WORDS;

export function teamLaunchWords(locale: WorkspaceLocale) {
  return (key: TeamLaunchWordKey, values: Readonly<Record<string, string | number>> = {}) =>
    TEAM_LAUNCH_WORDS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
