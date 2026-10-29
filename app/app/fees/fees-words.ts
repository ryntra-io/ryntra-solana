import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * «Комісії» (SOL-X1) in both languages: what $100 costs through Ryntra against the same route without it, what every
 * trade's receipt shows, and the comparison with Pump.fun, GMGN, Axiom and Jupiter — each figure with its source and
 * the day it was read.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const FEES_WORDS = {
  title: bi("Fees", "Комісії"),
  help: bi(
    "What a trade costs through Ryntra, against the same route without it and against other places. Every receipt shows the same for its own trade.",
    "Скільки коштує угода через Ryntra — проти того самого маршруту без неї й проти інших місць. Кожна квитанція показує те саме для своєї угоди.",
  ),
  hundred: bi("$100 through Ryntra", "$100 через Ryntra"),
  hundredNote: bi(
    "«−{example}» is how much less you receive than the same route without Ryntra. Pool fees and the price move are the same both ways.",
    "«−{example}» — на стільки менше ти отримуєш, ніж той самий маршрут без Ryntra. Комісії пулів і рух ціни — однакові на обох шляхах.",
  ),
  colWhat: bi("What you trade", "Що торгуєш"),
  colRate: bi("Ryntra fee", "Комісія Ryntra"),
  colBuy: bi("Buy $100", "Купівля $100"),
  colSell: bi("Sell $100", "Продаж $100"),
  colRound: bi("Round trip", "Повне коло"),
  colBack: bi("Cashback, round trip", "Кешбек за коло"),
  colNet: bi("Round trip after cashback, by Rewards rules {version}", "Коло після кешбеку, за правилами «Винагород» {version}"),
  flowMEME: bi("New and meme tokens", "Нові й мемні токени"),
  flowTRENDING: bi("Verified tokens over 7 days old", "Перевірені токени, старші за 7 днів"),
  flowMAJOR: bi("SOL, BTC, ETH, JUP, staked SOL", "SOL, BTC, ETH, JUP, стейкнутий SOL"),
  flowSTABLE: bi("Dollar to dollar", "Долар на долар"),
  flowXSTOCK: bi("Stocks — xStocks", "Акції — xStocks"),
  flowONDO: bi("Stocks — Ondo and pre-IPO", "Акції — Ondo і pre-IPO"),
  flowLAUNCH_PAGE: bi("A Ryntra launch from its token page", "Лаунч Ryntra зі сторінки токена"),
  launchRate: bi(
    "0 on top · pool fee {pool} applies after the first minutes, up to {sniper} in them (Ryntra's part inside it)",
    "0 зверху · діє комісія пулу {pool} після перших хвилин, у них — до {sniper} (частка Ryntra — всередині неї)",
  ),
  launchDollars: bi("$0 on top · {dollars} in the pool after the first minutes", "$0 зверху · {dollars} у пулі після перших хвилин"),
  launchNote: bi(
    "A launch's first minutes: the curve's fee starts at up to {sniper} and falls to {curve} within {minutes} minutes — buying $100 then can cost up to {sniperDollars} in the pool. A volatility fee of up to a fifth of the base rides on top (up to {curveMax} on the curve). These are the standard formats; an Advanced launch shows its own fee on its token page, and every receipt shows the fee its trade paid.",
    "Перші хвилини лаунчу: комісія кривої на старті — до {sniper} і за {minutes} хв падає до {curve} — купівля на $100 тоді може коштувати до {sniperDollars} у пулі. Зверху — комісія волатильності, до п\u2019ятої частини базової (на кривій — до {curveMax}). Це стандартні формати; «Розширений» лаунч показує свою комісію на сторінці токена, а кожна квитанція — комісію своєї угоди.",
  ),
  sameToken: bi(
    "The same launch token after it leaves for the DEX costs {spot} on top through Spot and 0 on top from its token page; the pool's own fee — {poolStart} falling to {poolEnd}, Ryntra's part inside it — applies both ways.",
    "Той самий токен лаунчу після виходу на DEX коштує {spot} зверху через «Спот» і 0 зверху зі сторінки токена; власна комісія пулу — {poolStart} і далі вниз до {poolEnd}, частка Ryntra всередині неї, — діє на обох шляхах.",
  ),
  orderNote: bi(
    "Cashback is counted by Rewards' rules on what Ryntra received; the receipt shows the actual figure. The columns assume the route Ryntra builds — when Jupiter's order route gives the better price, Jupiter keeps 20 % of the fee and the cashback is of the rest.",
    "Кешбек рахують «Винагороди» за своїми правилами від того, що отримала Ryntra; квитанція показує фактичну суму. Колонки — для маршруту, який збирає Ryntra; коли кращу ціну дає маршрут /order, Jupiter залишає собі 20 % комісії, і кешбек — від решти.",
  ),
  claimNote: bi(
    "Cashback is credited to Rewards and paid out on a claim: from {withAccount} with a USDC account, from {withoutAccount} without one.",
    "Кешбек нараховується у «Винагородах» і виплачується за запитом: від {withAccount} з рахунком USDC, від {withoutAccount} без нього.",
  ),
  firstTenNote: bi(
    "The first {wallets} new wallets each month: for {days} days, what Ryntra received comes back in full up to {cap} — part of it after a wallet check.",
    "Перші {wallets} нових гаманців щомісяця: {days} днів те, що отримала Ryntra, повертається повністю до {cap} — частина після перевірки гаманця.",
  ),
  parts: bi("In every trade's receipt", "У квитанції кожної угоди"),
  method: bi(
    "How a receipt counts: every figure comes from that trade's own fill — the same moment, the same size, nothing quoted again. A fee taken from what arrived: the route without it is exact — what arrived plus the fee. A fee taken from what was spent: what arrived, scaled to the whole amount — an upper bound, since a larger trade moves the price more. On Jupiter's /order route it is an upper bound too: without Ryntra, Jupiter charges its own fee there.",
    "Як рахує квитанція: кожна цифра — з виконання самої угоди: той самий момент, той самий розмір, без нового котирування. Комісія з того, що прийшло: маршрут без неї — точно, отримане плюс комісія. Комісія з того, що витрачено: отримане, масштабоване на всю суму, — верхня межа, бо більша угода сильніше рухає ціну. На маршруті Jupiter /order — теж верхня межа: без Ryntra Jupiter бере там власну комісію.",
  ),
  partRyntra: bi("Ryntra fee", "Комісія Ryntra"),
  partRyntraIs: bi("By the table above, taken inside the same transaction; on the order route Jupiter's 20 % is inside it, not on top", "За таблицею вище, у тій самій транзакції; на маршруті /order 20 % Jupiter — усередині, не зверху"),
  partProtocol: bi("Protocol", "Протокол"),
  partProtocolIs: bi("Jupiter takes 0 on the route Ryntra builds; pool fees are inside the route's price; a launch shows its curve's or pool's fee with Ryntra's part inside it", "Jupiter бере 0 на маршруті, який збирає Ryntra; комісії пулів — у ціні маршруту; лаунч показує комісію кривої чи пулу й частку Ryntra в ній"),
  partNetwork: bi("Network", "Мережа"),
  partNetworkIs: bi("{base} a signature", "{base} за підпис"),
  partPriority: bi("Priority", "Пріоритет"),
  partPriorityIs: bi("Up to {ceiling} where Ryntra builds the transaction; Jupiter's own on its order route", "До {ceiling}, коли транзакцію збирає Ryntra; на маршруті /order — Jupiter"),
  partTip: bi("Tip", "Чайові"),
  partTipIs: bi("0 — Ryntra adds none", "0 — Ryntra їх не додає"),
  partCashback: bi("Cashback", "Кешбек"),
  partCashbackIs: bi("{pct} of what Ryntra received, the actual figure from Rewards", "{pct} того, що отримала Ryntra, фактична сума з «Винагород»"),
  partQuote: bi("Quote and fill", "Котирування й виконання"),
  partQuoteIs: bi("Both, and the gap in per cent; your minimum is the promise", "Обидва й різниця у відсотках; обіцянка — твій мінімум"),
  receipts: bi("Your receipts", "Твої квитанції"),
  compare: bi("Against other places", "Проти інших місць"),
  compareNote: bi(
    "Interface fee — what a place adds on top of the pool. Another place's figure is a quotation: its source, the source's kind and the day it was read — from the place's own documentation or through a web search, never from the place's own app.",
    "Комісія інтерфейсу — те, що місце додає зверху на пул. Цифра іншого місця — цитата: джерело, тип джерела й день, коли його прочитано, — з документації самого місця або через пошук, не з застосунку цього місця.",
  ),
  colWhere: bi("Where", "Де"),
  colInterface: bi("Interface fee", "Комісія інтерфейсу"),
  colAfter: bi("After its rebate", "Після повернення"),
  colSource: bi("Source · read", "Джерело · прочитано"),
  plusPool: bi("+ pool {pool}", "+ пул {pool}"),
  poolTag: bi("{dollars} in the pool", "{dollars} у пулі"),
  firstMinutes: bi("after the first minutes (up to {sniper} in them)", "після перших хвилин (у них — до {sniper})"),
  viaSearch: bi("read through a web search", "прочитано через пошук"),
  viaDocs: bi("read from the venue's documentation", "прочитано з документації майданчика"),
  sourceFEE_POLICY: bi("Ryntra fee policy v{version}", "Політика комісій Ryntra v{version}"),
  sourceREWARDS_RULES: bi("Rewards rules {version}", "Правила «Винагород» {version}"),
  sourceLAUNCH_CONFIG: bi("Ryntra launch config", "Конфіг лаунчу Ryntra"),
  noRebate: bi("—", "—"),
  kindCODE: bi("Ryntra's code", "код Ryntra"),
  kindOFFICIAL: bi("the venue's documentation", "документація майданчика"),
  kindSECONDARY: bi("a secondary source", "вторинне джерело"),
  nameryntraSpot: bi("Ryntra · Spot", "Ryntra · «Спот»"),
  nameryntraLaunch: bi("Ryntra · a launch's token page", "Ryntra · сторінка токена лаунчу"),
  noteryntraSpot: bi("By the token's kind; {pct} of what Ryntra received comes back as cashback.", "За типом токена; {pct} того, що отримала Ryntra, повертається кешбеком."),
  noteryntraLaunch: bi(
    "Nothing on top — and the launch's own fee is paid by everyone who trades it, wherever: on the curve {curve}, up to {curveMax} when the price swings (the first minutes start as high as {sniper} and fall to {curve}), after the move to the DEX {poolStart} falling to {poolEnd} by preset as the market cap grows, plus a volatility fee. Ryntra's part is inside it.",
    "Зверху — 0, а власну комісію лаунчу платить кожен, хто ним торгує, хоч де: на кривій {curve}, до {curveMax}, коли ціна гойдається (перші хвилини — до {sniper} і далі вниз до {curve}), після виходу на DEX {poolStart} і далі вниз до {poolEnd} за пресетом з ростом капіталізації, плюс комісія волатильності. Частка Ryntra — всередині неї.",
  ),
  notejupiter: bi(
    "Jupiter's own platform fee on /order, by pair: 0 for buying Jupiter's tokens and for pegged pairs, 0.02 % SOL–stable, 0.05 % staked SOL–stable, 0.1 % for everything else, 0.5 % for tokens under 24 hours old. Ryntra's referral on /order takes its place; Jupiter keeps 20 % of it.",
    "Власна комісія Jupiter на /order за парою: 0 — купівля токенів Jupiter і прив\u2019язані пари, 0,02 % — SOL проти стейбла, 0,05 % — стейкнутий SOL проти стейбла, 0,1 % — усе інше, 0,5 % — токени, молодші за 24 год. Реферал Ryntra на /order стає замість неї; з нього Jupiter залишає собі 20 %.",
  ),
  notepumpFun: bi(
    "A venue, not an interface: 1.25 % on the curve, 1.25 → 0.30 % in PumpSwap as the market cap grows — paid by everyone who trades there, through Ryntra's Spot too, with Ryntra's fee on top. Older sources say 1 %.",
    "Майданчик, не інтерфейс: 1,25 % на кривій, 1,25 → 0,30 % у PumpSwap з ростом капіталізації — це платить кожен, хто там торгує, і через «Спот» Ryntra теж, з комісією Ryntra зверху. Старіші джерела пишуть 1 %.",
  ),
  notegmgn: bi("An invite code lowers it; sources differ on how much.", "Код запрошення зменшує її; на скільки — джерела розходяться."),
  noteaxiom: bi("1 % on top; SOL cashback by tier brings it to 0.95 → 0.75 %.", "1 % зверху; кешбек SOL за рівнями дає 0,95 → 0,75 %."),
} as const;

export type FeesWord = keyof typeof FEES_WORDS;

export function feesWords(locale: WorkspaceLocale) {
  const lang = locale === "uk" ? "uk" : "en";
  return (key: FeesWord, vars?: Readonly<Record<string, string | number>>) => {
    let text: string = FEES_WORDS[key][lang];
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}
