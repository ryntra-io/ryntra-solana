import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * The creator's cabinet in figures and the creator's public profile (SOL-L2), in both languages. Short: a word or a
 * number where there is one; what was not read is said so, never as a zero.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const CABINET_WORDS = {
  periodLabel: bi("Period", "Період"),
  period_day: bi("Day", "Доба"),
  period_week: bi("Week", "Тиждень"),
  period_all: bi("All time", "Увесь час"),
  earnedIn_day: bi("Earned in the last 24 h", "Зароблено за добу"),
  earnedIn_week: bi("Earned in the last 7 days", "Зароблено за тиждень"),
  earnedIn_all: bi("Earned in all", "Зароблено за весь час"),
  periodPartly: bi("At least: some trades of the period were not read", "Щонайменше: частину угод періоду не прочитано"),
  periodUnread: bi("not read", "не прочитано"),
  periodReading: bi("reading…", "читаємо…"),
  sourcesTitle: bi("By source", "За джерелами"),
  sourceColumn: bi("Source", "Джерело"),
  short_curve: bi("Curve", "Крива"),
  short_graduation: bi("DEX exit", "Вихід на DEX"),
  short_lp: bi("Locked LP", "Замкнена LP"),
  short_surplus: bi("Curve surplus", "Надлишок кривої"),
  surplusOnce: bi("The curve's surplus is paid once, when the curve fills: counted in «All time» only.", "Надлишок кривої — разова сума, коли крива наповнилась: лише в «Увесь час»."),
  totalRow: bi("In all", "Усього"),
  claimPaused: bi("Claim opens once Launch is back from its pause.", "«Забрати» відкриється, щойно Лаунч повернеться з паузи."),
  afterDexHint: bi("The DEX launch fee and the locked LP come once the token reaches the DEX.", "Комісія виходу й замкнена LP з'являться, коли токен вийде на DEX."),

  compareTitle: bi("Your launches side by side", "Порівняння запусків"),
  compareCaption: bi("Your launches compared", "Порівняння твоїх запусків"),
  colToken: bi("Token", "Токен"),
  colWay: bi("To the DEX", "До DEX"),
  colHolders: bi("Holders", "Власники"),
  colTraders: bi("Traders", "Трейдери"),
  colRepeat: bi("Came back", "Повторні"),
  colVolumeWeek: bi("Volume 7 d", "Обсяг 7 днів"),
  colEarnedWeek: bi("Earned 7 d", "Зароблено 7 днів"),
  colEarnedAll: bi("Earned in all", "Зароблено всього"),
  onDex: bi("On the DEX", "На DEX"),

  statVolumeDay: bi("Volume 24 h", "Обсяг 24 год"),
  statVolumeWeek: bi("Volume 7 d", "Обсяг 7 днів"),
  statHolders: bi("Holders", "Власники"),
  statTraders: bi("Traders · came back", "Трейдери · повторні"),
  statLiquidity: bi("Liquidity", "Ліквідність"),
  statMarketCap: bi("Market cap", "Капіталізація"),

  marketTitle: bi("Your market on the DEX", "Твій ринок на DEX"),
  depthUp: bi("To move the price +2 %", "Щоб ціна зросла на 2 %"),
  depthDown: bi("To move the price −2 %", "Щоб ціна впала на 2 %"),
  depthHint: bi("What a buy or a sale of this size does to the price, before the pool's fee — from the pool's reserves.", "Яка купівля чи продаж зрушить ціну на 2 %, без комісії пулу — з резервів пулу."),
  poolFeesDay: bi("Pool fees 24 h", "Комісії пулу 24 год"),
  poolFeesWeek: bi("Pool fees 7 d", "Комісії пулу 7 днів"),
  lpShare: bi("Your locked LP", "Твоя замкнена LP"),
  lpShareValue: bi("{pct} of the pool", "{pct} пулу"),
  viewPool: bi("Pool", "Пул"),
  viewPosition: bi("Your position", "Твоя позиція"),

  tradesTitle: bi("Your own trades", "Твої угоди з токеном"),
  bought: bi("Bought", "Куплено"),
  sold: bi("Sold", "Продано"),
  soldNone: bi("Sold nothing", "Нічого не продано"),
  soldShare: bi("{pct} of what you bought", "{pct} від купленого"),
  soldShareSupply: bi("{pct} of the supply", "{pct} пропозиції"),
  soldPartly: bi("Your sales may be read in part.", "Продажі прочитано, можливо, не всі."),
  saleRow: bi("Sold {tokens} for {pair}", "Продано {tokens} за {pair}"),

  lockTitle: bi("Your lock", "Твій замок"),
  lockLocked: bi("{amount} locked · first unlock {date}", "Замкнено {amount} · перше розблокування {date}"),
  lockUntil: bi("fully unlocked {date}", "повністю — {date}"),
  lockPending: bi("The lock is still being confirmed.", "Замок ще підтверджується."),
  lockFailed: bi("The lock did not land.", "Замок не створено."),
  lockNone: bi("No lock on your first buy", "Першу покупку не замкнено"),
  lockAmountUnread: bi("locked amount not read", "замкнену суму не прочитано"),
  viewLock: bi("Escrow", "Ескроу"),

  notesTitle: bi("Notifications", "Сповіщення"),
  notesWhat: bi("We tell you when your token launches, passes 10, 50, 100… holders, moves to the DEX, and when fees are ready to claim.", "Повідомимо, коли токен запуститься, набере 10, 50, 100… власників, вийде на DEX і коли комісії можна забрати."),
  notesInApp: bi("In the app — always", "У застосунку — завжди"),
  notesTelegramOn: bi("Telegram — on{user}", "Telegram — увімкнено{user}"),
  notesTelegramOff: bi("Telegram — not connected", "Telegram — не підключено"),
  notesTelegramUnknown: bi("Telegram — confirm your wallet to see", "Telegram — підтверди гаманець, щоб побачити"),
  notesConnect: bi("Connect Telegram", "Підключити Telegram"),
  notesAll: bi("All notifications", "Усі сповіщення"),

  profileTitle: bi("Public profile", "Публічний профіль"),
  profileLine: bi("Your launches, their results, locks and sales — one link to share.", "Твої запуски, результати, замки й продажі — одне посилання, щоб поділитися."),
  profileOpen: bi("Open profile", "Відкрити профіль"),
  profileCopy: bi("Copy link", "Скопіювати посилання"),
  profileCopied: bi("Link copied", "Посилання скопійовано"),

  /* The public profile. */
  creatorTitle: bi("Creator {address}", "Творець {address}"),
  creatorHelp: bi(
    "Every token this wallet launched through Ryntra, read from the chain: how far each went, its holders and volume, the creator's lock and sales. No ranking, no promotion.",
    "Кожен токен, який цей гаманець запустив через Ryntra, — просто з ланцюга: як далеко зайшов, власники й обсяг, замок і продажі творця. Без рейтингів і реклами.",
  ),
  creatorWallet: bi("Wallet", "Гаманець"),
  creatorLaunches: bi("Launches", "Запусків"),
  creatorOnDex: bi("On the DEX", "На DEX"),
  creatorLocked: bi("With a lock", "Із замком"),
  creatorSold: bi("Creator sold", "Творець продав"),
  creatorSoldNone: bi("nothing", "нічого"),
  creatorLockCol: bi("Lock", "Замок"),
  creatorLockYes: bi("until {date}", "до {date}"),
  creatorLockNo: bi("none", "немає"),
  creatorEmpty: bi("This wallet has launched nothing through Ryntra.", "Цей гаманець ще нічого не запустив через Ryntra."),
  creatorUnread: bi("The profile could not be read right now.", "Профіль творця зараз не вдалося прочитати."),
  creatorReading: bi("Reading the creator's launches…", "Читаємо запуски творця…"),
  creatorCaption: bi("The creator's launches", "Запуски творця"),
  creatorOwn: bi("This is you", "Це ти"),
  creatorToCabinet: bi("My launches", "Мої лаунчі"),
  creatorProfileLink: bi("Creator's profile", "Профіль творця"),
} as const;

export type CabinetWordKey = keyof typeof CABINET_WORDS;

export function cabinetWords(locale: WorkspaceLocale) {
  return (key: CabinetWordKey, values: Readonly<Record<string, string | number>> = {}) =>
    CABINET_WORDS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
