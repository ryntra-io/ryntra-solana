import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * «Поділ твоєї частки» in the creator's cabinet and on the token's page (SOL-L2b), in both languages. Short and plain:
 * what each part does and who does it; nothing promises income.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const SPLIT_WORDS = {
  title: bi("Your share, divided", "Поділ твоєї частки"),
  lede: bi(
    "Give part of your fees to depth, a community or the holders. Buyers see the rule before they buy; it can only be raised in their favour.",
    "Віддай частину своїх комісій глибині, спільноті чи холдерам. Покупці бачать правило до купівлі; змінити його можна лише на їхню користь.",
  ),
  closed: bi("Dividing your share is not open on this network yet.", "Поділ частки в цій мережі ще не відкрито."),
  reading: bi("Reading the division…", "Читаємо поділ…"),
  unread: bi("The division could not be read right now.", "Поділ зараз не вдалося прочитати."),
  readPartly: bi("Some figures were not read right now.", "Частину чисел зараз не прочитано."),
  bucket_self: bi("To you", "Собі"),
  bucket_depth: bi("Depth", "Глибина"),
  bucket_community: bi("Community", "Спільнота"),
  bucket_holders: bi("Holders", "Холдерам"),
  hint_depth: bi("Buy steps in the token's DLMM pool, from −3% to −25% under the price, signed by you. What they buy stays yours.", "Сходинки купівлі в пулі DLMM токена від −3 % до −25 % під ціною, твоїм підписом. Що вони куплять, лишається тобі."),
  hint_community: bi("Your transfer to the community's wallet.", "Твій переказ на гаманець спільноти."),
  hint_holders: bi(
    "In proportion to holdings among the 60 largest holders of a snapshot — only tokens bought on the market and still held; tokens received by a transfer earn nothing. Without your wallets, the bundle, pools and Ryntra.",
    "Пропорційно до утримання серед 60 найбільших холдерів знімка — лише токени, куплені на ринку й утримані; отримані переказом не заробляють. Без твоїх гаманців, бандла, пулів і Ryntra.",
  ),
  percent: bi("{name}, %", "{name}, %"),
  selfLeft: bi("To you: {pct}", "Собі: {pct}"),
  wallet: bi("Community wallet", "Гаманець спільноти"),
  walletHint: bi("Named once: it cannot be changed later.", "Задається один раз: змінити його потім не можна."),
  preview: bi("Buyers will read", "Покупці прочитають"),
  write: bi("Sign the rule", "Підписати правило"),
  raise: bi("Give more", "Збільшити частки"),
  raiseHint: bi("A part can only grow: none can go below what buyers already saw.", "Частки можна лише збільшити: жодна не стане меншою, ніж уже бачили покупці."),
  pendingRule: bi("The rule is being confirmed.", "Правило підтверджується."),
  ruleSince: bi("In force since {date}", "Діє з {date}"),
  ruleTx: bi("The rule on chain", "Правило в ланцюгу"),
  ledgerTitle: bi("Owed and done", "Належить і виконано"),
  ledgerSubject: bi("Claimed under the rule: {amount}", "Забрано за правилом: {amount}"),
  ledgerDone: bi("done {done}", "виконано {done}"),
  ledgerOwedLeft: bi("owed {due} · left {left}", "належить {due} · лишилось {left}"),
  ledgerLeft: bi("{left} left", "лишилось {left}"),
  ledgerRow: bi("owed {due} · done {done}", "належить {due} · виконано {done}"),
  ledgerUnread: bi("not read", "не прочитано"),
  ledgerNote: bi(
    "Counted by the chain from what you claimed of your share, whichever way you claimed it. You carry it out with your signature; Ryntra pays nothing in your place. Buyers see these figures on the token's page.",
    "Рахується за ланцюгом з того, що забрано з твоєї частки, — будь-яким способом. Виконуєш ти своїм підписом; Ryntra не платить замість тебе. Ці числа покупці бачать на сторінці токена.",
  ),
  placeSteps: bi("Place steps for {amount}", "Поставити сходинки на {amount}"),
  afterDex: bi("You can place depth steps once the token is on its DEX.", "Сходинки можна буде поставити, коли токен вийде на DEX."),
  belowLeast: bi("{name}: less is owed than the least an act moves ({amount}); it waits for more.", "{name}: належить менше за найменшу дію ({amount}) — чекає, доки набереться."),
  stepsPoolHint: bi(
    "One or two preparing signatures may come before the steps: one opens the token's DLMM pool where there is none, one brings its price up to the market's where it lags.",
    "Перед сходинками може знадобитися один-два підготовчі підписи: один відкриває пул DLMM токена, якщо його ще немає, інший підтягує його ціну до ринкової, якщо вона відстала.",
  ),
  onItsWay: bi("The last act is on its way; the next opens once the network settles it.", "Попередня дія в дорозі; наступна відкриється, щойно мережа її підтвердить."),
  readAgain: bi("Read again", "Прочитати ще раз"),
  warn_ROLE_MOVED: bi(
    "The creator's role on the curve has moved to another wallet: what the rule owes stops growing from here, and what it owed stays.",
    "Роль творця на кривій перейшла до іншого гаманця: відтепер належне за правилом не росте, а вже належне лишається.",
  ),
  warn_LP_MOVED: bi(
    "The locked LP position has left the creator's role: its fees no longer add to what the rule owes; what it owed stays.",
    "Замкнена позиція LP вийшла з ролі творця: її комісії більше не додають належного за правилом; уже належне лишається.",
  ),
  payout: bi("Pay {amount}", "Виплатити {amount}"),
  stepsTitle: bi("Your steps", "Твої сходинки"),
  stepsRow: bi("{pair} in steps · bought {tokens} {symbol}", "{pair} у сходинках · куплено {tokens} {symbol}"),
  stepsUnread: bi("steps not read", "сходинки не прочитано"),
  position: bi("Position", "Позиція"),
  roundsTitle: bi("Payouts", "Виплати"),
  roundRow: bi("Round {n} · {count} holders · {amount}", "Раунд {n} · холдерів {count} · {amount}"),
  roundCommunity: bi("community {amount}", "спільноті {amount}"),
  root: bi("Root", "Корінь"),
  roundPending: bi("on its way", "у дорозі"),
  roundPartly: bi("part did not land", "частина не пройшла"),
  donePartly: bi(
    "Part of the payout did not go through; what did not is still owed. Pay again once its signed bytes expire — about two minutes.",
    "Частина виплати не пройшла; те, що не пройшло, досі належить. Виплати ще раз, коли сплине життя підписаних байтів, — приблизно за дві хвилини.",
  ),
  stepPrepare: bi("Preparing", "Готуємо"),
  stepSign: bi("Sign in your wallet", "Підпиши в гаманці"),
  stepSignAgain: bi("Sign again: the first signature came back late", "Підпиши ще раз: перший підпис прийшов запізно"),
  stepSend: bi("Sending", "Надсилаємо"),
  done_rule: bi("The rule is on chain.", "Правило записано в ланцюгу."),
  done_depth: bi("Your steps are placed.", "Сходинки поставлено."),
  done_sync: bi("The pool's price is brought up to the market. Place your steps next.", "Ціну пулу підтягнуто до ринкової. Далі — сходинки."),
  done_pool: bi("The DLMM pool is open. Place your steps next.", "Пул DLMM відкрито. Далі — сходинки."),
  done_payout: bi("Paid.", "Виплачено."),
  pending: bi("Sent; the network has not confirmed it yet. The page will show it.", "Надіслано; мережа ще не підтвердила. Сторінка покаже."),
  failed: bi("The network did not take it; no money moved. The next act opens once its signed bytes expire — about two minutes.", "Мережа не прийняла; кошти не рухались. Наступна дія відкриється, коли сплине життя підписаних байтів, — приблизно за дві хвилини."),
  again: bi("Done", "Готово"),
  cancelled: bi("Cancelled in the wallet — nothing was sent.", "Скасовано в гаманці — нічого не надіслано."),
  err_LAUNCH_SHARES_INVALID: bi("The parts do not hold: each from 1%, together at most 100%; a community needs its own wallet — not yours, not a fee-sharing row, not Ryntra's.", "Частини не сходяться: кожна від 1 %, разом не більше 100 %; спільноті потрібен її власний гаманець — не твій, не рядок сейфа комісій і не гаманець Ryntra."),
  err_LAUNCH_BUILD_USED: bi("Something is already on its way. Try again once it lands.", "Щось уже в дорозі. Спробуй, коли воно пройде."),
  err_LAUNCH_NOTHING_TO_CLAIM: bi("Less than the least amount is owed now.", "Зараз належить менше за найменшу суму."),
  err_LAUNCH_BALANCE_LOW: bi("Your wallet holds too little of the pair currency for this.", "У гаманці замало валюти пари для цього."),
  err_LAUNCH_NOT_GRADUATED: bi("You can place depth steps once the token is on its DEX.", "Сходинки можна буде поставити, коли токен вийде на DEX."),
  err_CAPABILITY_UNAVAILABLE: bi("This is not open here.", "Тут це не відкрито."),
  err_LAUNCH_SIGNED_OTHER_BYTES: bi("The wallet signed something else; nothing was sent.", "Гаманець підписав інше; нічого не надіслано."),
  err_LAUNCH_BUILD_EXPIRED: bi("The signature came too late; try again.", "Підпис прийшов запізно; спробуй ще раз."),
  err_WALLET_MISMATCH: bi("Only the token's creator can do this.", "Це може лише творець токена."),
  err_WALLET_CHANGED: bi("The wallet changed or disconnected; nothing was sent. Connect the creator's wallet and try again.", "Гаманець змінився або відключився; нічого не надіслано. Підключи гаманець творця й спробуй ще раз."),
  err_sentUnknown: bi("No answer from the network: it may have gone out. This block shows it once the network settles it — do not sign again before.", "Мережа не відповіла: дія могла піти. Блок покаже її, щойно мережа відповість, — до того не підписуй ще раз."),
  problem_NOT_ALL: bi("Together the parts must be at most 100%.", "Разом частки — не більше 100 %."),
  problem_NOTHING_SHARED: bi("Give at least one part to depth, the community or the holders.", "Віддай хоч одну частку глибині, спільноті чи холдерам."),
  problem_SHARE_TOO_SMALL: bi("A part that takes anything takes at least 1%.", "Частка, що щось бере, — щонайменше 1 %."),
  problem_NOT_WHOLE: bi("A part is a number of per cent with at most two decimals.", "Частка — число відсотків, щонайбільше два знаки після коми."),
  problem_COMMUNITY_WALLET_MISSING: bi("The community's part needs its wallet.", "Частці спільноти потрібен гаманець."),
  problem_NOT_AN_ADDRESS: bi("The community wallet is not a Solana address.", "Гаманець спільноти — не адреса Solana."),
  problem_COMMUNITY_IS_CREATOR: bi("The community wallet cannot be yours.", "Гаманець спільноти не може бути твоїм."),
  problem_LOWERED: bi("A part cannot go below the rule in force.", "Частка не може стати меншою, ніж у чинному правилі."),
  problem_WALLET_CHANGED: bi("The community wallet stays the one named.", "Гаманець спільноти лишається тим, що вже задано."),
  problem_SAME: bi("Change at least one part.", "Зміни хоч одну частку."),
  err_generic: bi("It did not work right now; nothing was sent. Try again.", "Зараз не вийшло; нічого не надіслано. Спробуй ще раз."),
  /* The token's page, before a purchase. */
  offerTitle: bi("The creator's share", "Частка творця"),
  offerPending: bi("The creator's rule is being confirmed.", "Правило творця підтверджується."),
} as const;

export type SplitWordKey = keyof typeof SPLIT_WORDS;

export function splitWords(locale: WorkspaceLocale) {
  return (key: SplitWordKey, values: Readonly<Record<string, string | number>> = {}) =>
    SPLIT_WORDS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
