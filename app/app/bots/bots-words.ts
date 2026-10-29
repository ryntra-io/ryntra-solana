import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * The words of «Боти» (Menu 3: «Автоматика → Боти»; the name the menu gives it, SOL-C15): everything that runs on a
 * person's rule — the grids, the recurring-buy rules and the plans — in one list, and what can be set up in
 * «Каталог». Only what is on production, said as it works: a recurring buy reminds, and only the person's signature
 * buys (UX-700).
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const BOTS_WORDS = {
  title: bi("Bots", "Боти"),
  mine: bi("Bots", "Боти"),
  mineLead: bi(
    "Everything that runs on your rule — grids, recurring buys and trade plans. A recurring buy reminds you; you sign every buy, and every grid you place or stop; a grid's levels then fill in the pool on their own.",
    "Усе, що працює за твоїм правилом, — гріди, регулярна купівля й плани угод. Регулярна купівля нагадує; кожну купівлю й кожен грід, який ставиш чи зупиняєш, підписуєш ти; далі рівні гріда виконує сам пул.",
  ),
  recurring: bi("Recurring buy", "Регулярна купівля"),
  plans: bi("Trade plans", "Плани угод"),
  plansLead: bi("A plan's result is on its card.", "Результат плану — у його картці."),
  createPlan: bi("Create a plan", "Створити план"),
  reminders: bi("Notifications", "Сповіщення"),
  /* UX-700: where a reminder arrives, said where the rule is — and the way to Telegram, which is on «Акаунт». */
  remindersWhere: bi("Reminders arrive in Notifications and in Telegram once it is connected.", "Нагадування приходять у «Сповіщення», а в Telegram — коли його підключено."),
  connectTelegram: bi("Telegram — in Account", "Telegram — в Акаунті"),
  /* UX-709: one proof for the rules and the plans together, one button. */
  confirmAll: bi("Confirm your wallet to see your rules and plans. One signature — it moves nothing.", "Підтверди гаманець, щоб побачити свої правила й плани. Один підпис — він нічого не переказує."),
  confirmWallet: bi("Confirm wallet", "Підтвердити гаманець"),
  confirming: bi("Confirming…", "Підтверджуємо…"),
  connect: bi("Your recurring-buy rules appear here once a wallet is connected.", "Твої правила регулярної купівлі з'являться тут, щойно підключиш гаманець."),
  results: bi("Results", "Результати"),
  resultsLead: bi("What the plans did: every trade against its plan, and what Ryntra remembers.", "Що зробили плани: кожна угода проти свого плану й що пам'ятає Ryntra."),
  catalog: bi("Catalog", "Каталог"),
  catalogLead: bi("What you can set up today.", "Що можна налаштувати вже сьогодні."),
  recurringHow: bi("Ryntra reminds you on the day — you sign each buy; the money stays in your wallet.", "Ryntra нагадає в день покупки — кожну купівлю підписуєш ти; гроші — у твоєму гаманці."),
  recurringFor: bi(
    "Stocks, coins and memes; a meme or a new token from $25,000 of liquidity and a day on the market.",
    "Акції, монети й меми; мем чи новий токен — від $25 000 ліквідності й доби на ринку.",
  ),
  pickToken: bi("Choose a token", "Обрати токен"),
  myRules: bi("My rules", "Мої правила"),
  planWhat: bi("Your own rules for one trade: entry, size, stop and target.", "Твої правила однієї угоди: вхід, розмір, стоп і ціль."),
  planName: bi("Trade plan", "План угоди"),
  /* B16: a guest's paths, each with an example (UX-716: read as an example, never as the person's own rule), and the one button. */
  recurringExample: bi("e.g. a reminder to buy $25 of SOL every Monday", "Напр. нагадування купити SOL на $25 щопонеділка"),
  planExample: bi("e.g. entry · stop · target", "Напр. вхід · стоп · ціль"),
  guestGate: bi("Connect a wallet to see your rules and plans here.", "Підключи гаманець, щоб бачити тут свої правила й плани."),
  /* B10: the grid on DLMM — levels in a pool's own price steps. */
  grid: bi("Grid", "Грід"),
  gridExample: bi("e.g. buy below · sell above", "Напр. купівля нижче · продаж вище"),
  gridHow: bi("The pool fills every level; you sign to place and to collect.", "Пул виконує кожен рівень; ставиш і збираєш своїм підписом."),
  gridPick: bi("Choose a pool", "Обрати пул"),
  gridLead: bi("Pick a pool: your levels sit in its own price steps.", "Обери пул: твої рівні стануть у його власні кроки ціни."),
  gridSearch: bi("Find a token or a pair", "Знайти токен чи пару"),
  gridFind: bi("Find", "Знайти"),
  gridStep: bi("Step", "Крок"),
  gridVolume: bi("Volume 24h", "Обсяг за 24 год"),
  gridLiquidity: bi("Liquidity", "Ліквідність"),
  gridFee: bi("Fee", "Комісія"),
  gridNoPools: bi("No pool matches. Try another token.", "Жоден пул не підходить. Спробуй інший токен."),
  gridPoolsDown: bi("Pools did not load. Try again in a minute.", "Пули не завантажились. Спробуй за хвилину."),
  gridPoolsStale: bi("Shown from the last read", "Показано з останнього читання"),
  gridSearchLimited: bi("Search is busy — showing the largest pools.", "Пошук зайнятий — показано найбільші пули."),
  gridSide: bi("How it trades", "Як торгує"),
  gridTitle: bi("New grid", "Новий грід"),
  gridConnect: bi("Connect a wallet to place a grid. You sign; the money stays in the pool under your key.", "Підключи гаманець, щоб поставити грід. Підписуєш ти; гроші — в пулі під твоїм ключем."),
  sideBuy: bi("Buy below", "Купівля нижче"),
  sideSell: bi("Sell above", "Продаж вище"),
  sideBoth: bi("Both sides", "Обидва боки"),
  sideBuyNote: bi("waits at every level below the price and buys as it falls.", "чекає на кожному рівні нижче ціни й купує, коли вона падає."),
  sideSellNote: bi("waits at every level above the price and sells as it rises.", "чекає на кожному рівні вище ціни й продає, коли вона росте."),
  sideBothNote: bi("Buys below the price and sells above it; each fill can turn back the other way.", "Купує нижче ціни й продає вище; кожне виконання може повернутись назад."),
  levels: bi("Levels", "Рівні"),
  bothNeedsBoth: bi("«Both sides» needs an amount of each token.", "«Обидва боки» потребують суми кожного токена."),
  levelStep: bi("Between levels", "Між рівнями"),
  range: bi("Range", "Діапазон"),
  perLevel: bi("Each level", "Кожен рівень"),
  budget: bi("Budget", "Бюджет"),
  priceNow: bi("Price now", "Ціна зараз"),
  placeTitle: bi("Place grid", "Поставити грід"),
  whatGrid: bi(
    "Liquidity spread evenly over the pool's levels. The pool buys and sells at each as the price crosses it; you earn your share of the pool's fee on each fill.",
    "Ліквідність, рівномірно розподілена по рівнях пулу. Пул купує й продає на кожному, коли ціна його перетинає; ти отримуєш свою частку комісії пулу з кожного виконання.",
  ),
  riskGrid: bi(
    "A grid earns only the pool's fee. Its value can end below what went in — buying levels keep buying a token that falls — and off its levels it holds one token and earns nothing.",
    "Грід заробляє лише комісію пулу. Його вартість може закінчитись нижче внесеного — рівні купівлі докуповують токен, що падає, — а поза рівнями він тримає один токен і нічого не заробляє.",
  ),
  placed: bi("Grid placed", "Грід поставлено"),
  stopped: bi("Grid stopped", "Грід зупинено"),
  collected: bi("Fees collected", "Комісії забрано"),
  toBots: bi("My bots", "Мої боти"),
  myGrids: bi("Grids", "Гріди"),
  gridsEmpty: bi("No grid yet. Place one on a pool — you sign, the pool does the rest.", "Гріда ще немає. Постав його в пулі — ти підписуєш, решту робить пул."),
  gridsDown: bi("Your grids did not load from the chain. Try again in a minute.", "Гріди не прочитались з мережі. Спробуй за хвилину."),
  result: bi("Result", "Результат"),
  resultNone: bi("No entry in this browser", "Немає входу в цьому браузері"),
  feesEarned: bi("fees", "комісії"),
  stop: bi("Stop", "Зупинити"),
  collect: bi("Collect fees", "Забрати комісії"),
  stopWhat: bi("Withdraws every level and its fees and closes the position; its rent comes back.", "Забирає всі рівні й комісії та закриває позицію; її рента повертається."),
  collectWhat: bi("Takes the fees earned so far; the levels stay and keep working.", "Забирає зароблені комісії; рівні лишаються й працюють далі."),
  stateWorking: bi("Working", "Працює"),
  stateWaiting: bi("Waiting for the price", "Чекає на ціну"),
  stateAllBought: bi("All levels bought", "Усі рівні куплено"),
  stateAllSold: bi("All levels sold", "Усі рівні продано"),
  stateClosed: bi("Stopped", "Зупинено"),
  stateMissing: bi("Not found on the chain — checking again", "У мережі не знайдено — перевіряємо ще раз"),
  stopPaused: bi("Ryntra's pool actions are paused. You can withdraw on Meteora's own page.", "Дії Ryntra з пулами на паузі. Забрати можна на сторінці самої Meteora."),
  meteoraPage: bi("Meteora", "Meteora"),
  stateReading: bi("Reading the chain", "Читаємо мережу"),
  /* EXE-1: what each bot does by itself and what waits for the person — from the authority matrix, never an «automatic» it is not. */
  truthTitle: bi("What a bot does by itself", "Що бот робить сам"),
  truthLeadNone: bi(
    "There is no automatic bot here yet — none signs for you. What each one does without you, and what waits for your signature:",
    "Автоматичного бота тут ще немає: жоден не підписує замість тебе. Що кожен робить без тебе, а що чекає на твій підпис:",
  ),
  truthLeadSome: bi("What each bot does without you, and what waits for your signature:", "Що кожен бот робить без тебе, а що чекає на твій підпис:"),
  gridAlone: bi("Meteora's pool fills each level as the price crosses it; you earn a share of its fee.", "Пул Meteora виконує кожен рівень, коли ціна його перетинає; ти отримуєш частку комісії."),
  gridYou: bi("Placing, stopping and collecting fees — your signature. The levels do not move when the price leaves the range.", "Поставити, зупинити й забрати комісії — твій підпис. Рівні не переставляються, коли ціна виходить за діапазон."),
  recurringAlone: bi("Reminds you on the day — in Notifications and in Telegram. It does not buy.", "Нагадує в день купівлі — у «Сповіщення» і в Telegram. Сам не купує."),
  recurringYou: bi("Every buy is your Review and your signature. The monthly budget only stops the reminders.", "Кожна купівля — твоя перевірка й підпис. Місячний бюджет лише вимикає нагадування."),
  planAlone: bi("Executes nothing: keeps your rules beside the result.", "Нічого не виконує: зберігає твої правила поруч із результатом."),
  planYou: bi("You sign the trade. A plan's stop and target are not orders: nothing sells at them.", "Угоду підписуєш ти. Стоп і ціль плану — не ордери: за ними ніхто не продає."),
  back: bi("Back", "Назад"),
} as const;

export function botsWords(locale: WorkspaceLocale) {
  return (key: keyof typeof BOTS_WORDS): string => BOTS_WORDS[key][locale];
}
