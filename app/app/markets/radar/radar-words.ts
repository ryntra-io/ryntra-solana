import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * Market Radar's meme mode (SOL-R1) in both languages: its six feeds, what
 * each one is, and the token's card — the chart, the facts against it and the
 * total fees of a buy before its Review. One term for the DEX (B17): «Майже на
 * DEX», «Вийшли на DEX».
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const RADAR_WORDS = {
  title: bi("Market Radar", "Радар ринку"),
  feeds: bi("Meme feeds", "Стрічки мемів"),
  feedNew: bi("New", "Нові"),
  feedGrowing: bi("Growing", "Ростуть"),
  feedSoon: bi("Near Graduation", "Майже на DEX"),
  feedDex: bi("Graduated", "Вийшли на DEX"),
  feedTrending: bi("Trending", "Тренди"),
  feedWatchlist: bi("Watchlist", "Обране"),
  noteNew: bi("Tokens born on pump.fun, Meteora and LaunchLab whose first pool is under an hour old — the newest on top.", "Токени з pump.fun, Meteora і LaunchLab з першим пулом молодшим за годину — найновіші зверху."),
  noteGrowing: bi("Still on their curve, one hour to one day old, holders up over the hour and $1K or more traded in it — the hour's most traded on top.", "Ще на кривій, від години до доби, холдерів за годину більшає й торгів за неї від $1K — найбільший обсяг години зверху."),
  noteSoon: bi("Curves that have gone 25% or more of their way to the DEX, the closest on top — read from each curve's own account on the chain.", "Криві, що пройшли від 25 % до DEX, — найближчі зверху; прогрес — з рахунку самої кривої в мережі."),
  noteDex: bi("Left their curve for a DEX in the last 24 hours — the latest on top.", "Вийшли з кривої на DEX за останню добу — найсвіжіші зверху."),
  noteTrending: bi("Jupiter's trending order for the window, memes of the three launchpads only.", "Порядок трендів Jupiter за вікно — лише меми трьох лаунчпадів."),
  noteWatchlist: bi("The tokens you starred, in your order. Star a token from its card.", "Токени, які ти позначив зірочкою, у твоєму порядку. Позначити — з картки токена."),
  emptyGrowing: bi("No token on a curve is growing like that right now.", "Зараз жоден токен на кривій так не росте."),
  emptyWatchlist: bi("Your watchlist has no memes yet — open a token's card and tap ☆.", "В обраному ще немає мемів — відкрий картку токена й натисни ☆."),
  unlisted: bi("{count} of your watched tokens are not memes or are not listed — they are in Markets → Watchlist.", "{count} з обраного — не меми або їх не знає жодне джерело; вони в «Ринки» → «Обране»."),
  sources: bi("Launchpads: pump.fun · Meteora DBC · Raydium LaunchLab", "Лаунчпади: pump.fun · Meteora DBC · Raydium LaunchLab"),
  readOnly: bi("Read-only: a feed buys nothing.", "Лише читання: стрічка нічого не купує."),
  /* the card */
  card: bi("Token card", "Картка токена"),
  close: bi("Close", "Закрити"),
  chart: bi("Chart", "Графік"),
  chartOf: bi("{symbol}: price over the last hours", "{symbol}: ціна за останні години"),
  noChart: bi("No pool prices this token yet — no chart to draw.", "Жоден пул ще не дає цьому токену ціну — графіка немає."),
  chartDown: bi("The chart could not be read just now.", "Графік зараз не вдалося прочитати."),
  risks: bi("Risks", "Ризики"),
  risksNote: bi("Facts from Jupiter and the chain. Not a verdict.", "Факти з Jupiter і мережі. Це не вирок."),
  mintOff: bi("Minting new tokens is off", "Випуск нових токенів вимкнено"),
  mintOn: bi("Minting new tokens is still on", "Випуск нових токенів не вимкнено"),
  freezeOff: bi("Freezing holders' tokens is off", "Заморожування токенів вимкнено"),
  freezeOn: bi("Freezing holders' tokens is still on", "Заморожування токенів холдерів не вимкнено"),
  rightsUnread: bi("Not read: whether minting and freezing are off", "Не прочитано: чи вимкнено випуск і заморожування"),
  flagged: bi("Jupiter flags it as suspicious", "Jupiter позначив як підозрілий"),
  borrowed: bi("A name tied to {label} — not verified by Jupiter", "Назва, пов'язана з {label}, — Jupiter не перевірив"),
  costUnpriced: bi("No price or pool yet: nothing to quote.", "Ціни чи пулу ще немає: котирувати нічого."),
  copyAddress: bi("Copy the address", "Скопіювати адресу"),
  copied: bi("Copied", "Скопійовано"),
  top10: bi("Top 10 holders hold", "Топ-10 холдерів тримають"),
  creatorHolds: bi("The creator holds", "Творець тримає"),
  creatorHistory: bi("The creator's tokens", "Токенів творця"),
  creatorHistoryValue: bi("{made} made · {dex} reached a DEX", "створено {made} · на DEX {dex}"),
  liquidity: bi("Liquidity", "Ліквідність"),
  holders: bi("Holders", "Холдери"),
  age: bi("On the market", "На ринку"),
  curve: bi("To the DEX", "До DEX"),
  unknown: bi("not stated", "не вказано"),
  cost: bi("Total fees before buying", "Сумарні комісії до купівлі"),
  costFor: bi("Buy for", "Купівля на"),
  costRyntra: bi("Ryntra fee", "Комісія Ryntra"),
  costJupiter: bi("Jupiter fee", "Комісія Jupiter"),
  costNetwork: bi("Solana network (signature and priority)", "Мережа Solana (підпис і пріоритет)"),
  costTotal: bi("Total fees", "Разом комісій"),
  costImpact: bi("Price impact (not a fee)", "Вплив на ціну (не комісія)"),
  costDepositIfNew: bi("Token account rent, if you hold none of the token yet — returned when the account is closed", "Застава за рахунок токена, якщо його ще немає, — повертається, коли рахунок закрито"),
  costPriority: bi("The priority fee is set at the Review for your wallet, at most {sol} SOL.", "Пріоритет визначає «Перевірка» під твій гаманець — не більше {sol} SOL."),
  costPriorityOpen: bi("The priority fee is set at the Review for your wallet.", "Пріоритет визначає «Перевірка» під твій гаманець."),
  costPriorityShort: bi("priority", "пріоритет"),
  costDeposit: bi("Token account rent — returned when the account is closed", "Застава за рахунок токена — повертається, коли рахунок закрито"),
  costReceive: bi("You receive tokens worth about", "Отримаєш токенів приблизно на"),
  costPools: bi("Pool fees are inside the route's price; a token's own transfer fee, if it has one, is shown at the Review.", "Комісії пулів — у ціні маршруту; власна комісія переказу токена, якщо вона є, — у «Перевірці»."),
  costPaidWith: bi("Paid in USDC. Jupiter's quote at {time}; the Review before your signature quotes again with exact amounts.", "Оплата в USDC. Котирування Jupiter о {time}; «Перевірка» перед підписом котирує знову з точними сумами."),
  costLoading: bi("Asking Jupiter for a quote…", "Питаю котирування в Jupiter…"),
  costNoRoute: bi("Jupiter finds no route for this sum right now.", "Jupiter зараз не знаходить маршруту на цю суму."),
  costFailed: bi("The fees could not be counted just now.", "Комісії зараз не вдалося порахувати."),
  costRetry: bi("Count again", "Порахувати знову"),
  costLaunch: bi("This market is bought on its launch page; its fees are shown there before you sign.", "Цей ринок купують на його сторінці лаунчу; його комісії — там, до підпису."),
  costInSol: bi("{sol} SOL", "{sol} SOL"),
  buyFor: bi("Buy for {sum}", "Купити на {sum}"),
  buyNote: bi("Opens the token's Review; nothing is bought until your wallet signs.", "Відкриває «Перевірку» токена; нічого не купується, доки не підпише твій гаманець."),
  openLaunch: bi("Open the launch page", "Відкрити сторінку лаунчу"),
  openPage: bi("Token page", "Сторінка токена"),
  star: bi("Add to watchlist", "Додати в обране"),
  unstar: bi("Remove from watchlist", "Прибрати з обраного"),
  quotedAt: bi("quoted {time}", "котирування о {time}"),
} as const;

export type RadarWord = keyof typeof RADAR_WORDS;

export function radarWords(locale: WorkspaceLocale) {
  const lang = locale === "uk" ? "uk" : "en";
  return (key: RadarWord, vars?: Readonly<Record<string, string | number>>) => {
    let text: string = RADAR_WORDS[key][lang];
    if (vars) for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value));
    return text;
  };
}
