import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * The words of leaderboards and seasons, in both languages, beside the
 * pages that say them — like `rank-copy.ts`, because the workspace
 * catalogue is the core's file. A missing language is a type error.
 */

export type BoardWordId = "TRADERS" | "FRIENDS" | "CREATORS";
export type TaskWordId = "FIRST_TRADE" | "THREE_WEEKS" | "FRIEND_TRADES";
export type ThemeWordId = "FIRST_STEPS" | "TOGETHER" | "HABIT";

type Copy = Readonly<{
  /* The Rewards section's own tabs. */
  tabs: Readonly<{ label: string; overview: string; boards: string; season: string }>;

  boardsTitle: string;
  boardsLabel: string;
  thisWeek: string;
  lastWeek: string;
  weekRange: (from: string, to: string) => string;
  live: (time: string) => string;
  final: string;
  /** A week that has ended, still taking settlements that land late. */
  settling: string;
  board: Readonly<Record<BoardWordId, string>>;
  boardLead: Readonly<Record<BoardWordId, string>>;
  /** The figure a row shows: a signed percent, a count of friends, a count of launches. */
  value: (board: BoardWordId, value: number) => string;
  empty: (board: BoardWordId, ended: boolean) => string;
  more: (shown: number, total: number) => string;
  you: string;
  place: (place: number) => string;
  /** Read before a place number by a screen reader. */
  placeAloud: string;
  saveFailed: string;
  /** Where the viewer stands when not on the board. */
  youOff: Readonly<Record<BoardWordId, (closed: string, min: number) => string>>;
  noneClosed: string;
  hiddenNote: (place: number | null) => string;
  internalNote: string;
  showMe: string;
  showMeHint: string;
  connect: string;
  /** Connected but not yet confirmed. */
  confirmLead: string;
  confirm: string;
  confirming: string;
  unavailable: string;
  retry: string;
  loading: string;
  loadingSeason: string;
  rulesTitle: string;
  rules: (min: number, creators: boolean) => readonly string[];

  /* Seasons. */
  seasonTitle: (number: number) => string;
  theme: Readonly<Record<ThemeWordId, string>>;
  weekOf: (week: number, weeks: number) => string;
  ends: (date: string) => string;
  ended: string;
  ahead: string;
  running: string;
  notStarted: string;
  seasonNotStarted: (number: number) => string;
  notStartedMore: string;
  thisWeeksBoards: string;
  task: Readonly<Record<TaskWordId, string>>;
  taskHow: Readonly<Record<TaskWordId, string>>;
  progress: (have: number, need: number) => string;
  doneOn: (date: string) => string;
  tasksDone: (done: number, total: number) => string;
  seasonBadge: (number: number) => string;
  seasonBadgeHow: string;
  podiumBadge: string;
  podiumBadgeHow: string;
  podiumHeld: (board: BoardWordId, place: number, week: number) => string;
  podiumHidden: string;
  notYet: (name: string) => string;
  yourSeason: string;
  weeksTitle: string;
  weekLabel: (number: number) => string;
  nobody: string;
  nobodyEnded: string;
  notDone: string;
  /** A finished week, folded: who led the traders, or that no one did. */
  topTrader: (name: string, value: string) => string;
  noTopTrader: string;
  seasonSummary: string;
  taskDoneAloud: string;
  /** A dollar figure as this language writes it. */
  usd: (decimal: string) => string;
  community: (participants: number, complete: number, ended: boolean) => string;
  seasonRulesTitle: string;
  seasonRules: readonly string[];
  openBoards: string;
  openSeason: string;
  otherSeasons: string;
  seasonConnect: string;
  seasonConfirm: string;
  seasonUnavailable: string;
}>;

/** 1 друг, 2 друзі, 5 друзів — the last digits decide, as Ukrainian counts. */
function ukCount(n: number, one: string, few: string, many: string): string {
  const tail = Math.abs(n) % 100;
  const last = tail % 10;
  return tail >= 11 && tail <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

/** A result in basis points, signed, one decimal: +30.0% / −12.5%. */
function percent(bps: number, comma: boolean): string {
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "";
  const text = (Math.abs(bps) / 100).toFixed(1);
  return `${sign}${comma ? text.replace(".", ",") : text}${comma ? " %" : "%"}`;
}

const EN_BOARD: Readonly<Record<BoardWordId, string>> = { TRADERS: "Traders", FRIENDS: "Friends", CREATORS: "Creators" };
const UK_BOARD: Readonly<Record<BoardWordId, string>> = { TRADERS: "Трейдери", FRIENDS: "Друзі", CREATORS: "Творці" };

const EN: Copy = {
  tabs: { label: "Rewards sections", overview: "Overview", boards: "Leaderboards", season: "Season" },

  boardsTitle: "Leaderboards",
  boardsLabel: "Leaderboards of the week",
  thisWeek: "This week",
  lastWeek: "Last week",
  weekRange: (from, to) => `${from} – ${to}`,
  live: (time) => `Live · updated ${time} UTC`,
  final: "Final",
  settling: "Ended · final within a day",
  board: EN_BOARD,
  boardLead: {
    TRADERS: "Result of trades closed in the week",
    FRIENDS: "Invited friends who traded in the week",
    CREATORS: "Launches that reached a DEX in the week",
  },
  value: (board, value) =>
    board === "TRADERS" ? percent(value, false)
    : board === "FRIENDS" ? `${value} ${value === 1 ? "friend" : "friends"}`
    : `${value} ${value === 1 ? "launch" : "launches"}`,
  empty: (board, ended) =>
    board === "TRADERS" ? (ended ? "No one closed $100 of trades that week." : "No one has closed $100 of trades yet this week.")
    : board === "FRIENDS" ? (ended ? "No invited friends traded that week." : "No invited friends have traded yet this week.")
    : ended ? "No launches reached a DEX that week." : "No launches have reached a DEX this week.",
  more: (shown, total) => `Top ${shown} of ${total}`,
  you: "You",
  place: (place) => `#${place}`,
  placeAloud: "Place ",
  saveFailed: "Not saved. Try again.",
  youOff: {
    TRADERS: (closed, min) => `$${closed} of $${min} closed`,
    FRIENDS: () => "None of your invited friends traded",
    CREATORS: () => "None of your launches reached a DEX",
  },
  noneClosed: "No trades closed",
  hiddenNote: (place) => (place ? `You are hidden from the boards. Shown, you would be #${place}.` : "You are hidden from the boards."),
  internalNote: "This wallet is Ryntra's own and is not counted.",
  showMe: "Show me on the boards",
  showMeHint: "When hidden, your avatar wears no rank frame either.",
  connect: "Connect a wallet to see your place.",
  confirmLead: "Confirm this wallet to see your place.",
  confirm: "Confirm wallet",
  confirming: "Confirming…",
  unavailable: "The boards are unavailable right now.",
  retry: "Try again",
  loading: "Loading the boards…",
  loadingSeason: "Loading the season…",
  rulesTitle: "How the boards work",
  rules: (min, creators) => [
    "A week runs Monday to Sunday, UTC. Every Monday the boards start again.",
    `Traders: the result of trades closed this week through Ryntra, as a percent of what was paid for them through Ryntra. On the board from $${min} of closed trades.`,
    "Friends: people you invited who made a trade with a Ryntra fee this week.",
    ...(creators ? ["Creators: your launches that moved from their curve to a DEX this week."] : []),
    "A place earns status and badges only — no money and no prizes.",
    "Ryntra's own and test wallets are not counted. You can hide yourself at any time.",
    "Past results do not predict future ones. Capital at risk.",
  ],

  seasonTitle: (number) => `Season ${number}`,
  theme: { FIRST_STEPS: "First steps", TOGETHER: "Together", HABIT: "Habit" },
  weekOf: (week, weeks) => `Week ${week} of ${weeks}`,
  ends: (date) => `Ends ${date}`,
  ended: "Ended",
  ahead: "Ahead",
  running: "Running",
  notStarted: "Seasons have not started yet",
  seasonNotStarted: (number) => `Season ${number} has not started yet`,
  notStartedMore: "A season runs 8 weeks: three tasks and season badges.",
  thisWeeksBoards: "This week's leaderboards",
  task: { FIRST_TRADE: "First trade of the season", THREE_WEEKS: "Trade in 3 different weeks", FRIEND_TRADES: "An invited friend trades" },
  taskHow: {
    FIRST_TRADE: "Any trade on Ryntra on which Ryntra receives a fee.",
    THREE_WEEKS: "A trade in three different weeks of the season.",
    FRIEND_TRADES: "Someone you invited makes a trade during the season.",
  },
  progress: (have, need) => `${have} of ${need}`,
  doneOn: (date) => `Done ${date}`,
  tasksDone: (done, total) => `${done} of ${total}`,
  seasonBadge: (number) => `Season ${number}`,
  seasonBadgeHow: "Complete all three tasks.",
  podiumBadge: "Podium",
  podiumBadgeHow: "Finish a week in the top 3 of any board.",
  podiumHeld: (board, place, week) => `${EN_BOARD[board]}, #${place} · week ${week}`,
  podiumHidden: "Hidden wallets are not on the boards, so they earn no podium.",
  notYet: (name) => `${name}, not yet earned`,
  yourSeason: "Your season",
  weeksTitle: "Weeks",
  weekLabel: (number) => `Week ${number}`,
  nobody: "No one yet",
  nobodyEnded: "No one",
  notDone: "Not done",
  topTrader: (name, value) => `Top trader ${name} ${value}`,
  noTopTrader: "No traders on the board",
  seasonSummary: "Season summary",
  taskDoneAloud: "done",
  usd: (decimal) => `$${decimal}`,
  community: (participants, complete, ended) =>
    `${ended ? "Took part" : "Taking part"}: ${participants} · completed every task: ${complete}`,
  seasonRulesTitle: "How seasons work",
  seasonRules: [
    "A season is 8 weeks. The next begins the moment one ends.",
    "Tasks and season badges start again each season. Your rank and your rewards carry on.",
    "Season badges are status only — no money and no prizes.",
    "Ryntra's own and test wallets are not counted.",
  ],
  openBoards: "Leaderboards",
  openSeason: "Season",
  otherSeasons: "Seasons",
  seasonConnect: "Connect a wallet to see your tasks.",
  seasonConfirm: "Confirm this wallet to see your tasks.",
  seasonUnavailable: "The season is unavailable right now.",
};

const UK: Copy = {
  tabs: { label: "Розділи винагород", overview: "Огляд", boards: "Таблиці", season: "Сезон" },

  boardsTitle: "Таблиці лідерів",
  boardsLabel: "Таблиці лідерів тижня",
  thisWeek: "Цей тиждень",
  lastWeek: "Минулий тиждень",
  weekRange: (from, to) => `${from} – ${to}`,
  live: (time) => `Триває · оновлено ${time} UTC`,
  final: "Підсумок",
  settling: "Завершено · остаточно за добу",
  board: UK_BOARD,
  boardLead: {
    TRADERS: "Результат угод, закритих за тиждень",
    FRIENDS: "Запрошені друзі, що торгували за тиждень",
    CREATORS: "Лаунчі, що вийшли на DEX за тиждень",
  },
  value: (board, value) =>
    board === "TRADERS" ? percent(value, true)
    : board === "FRIENDS" ? `${value} ${ukCount(value, "друг", "друзі", "друзів")}`
    : `${value} ${ukCount(value, "лаунч", "лаунчі", "лаунчів")}`,
  empty: (board, ended) =>
    board === "TRADERS" ? (ended ? "Того тижня ніхто не закрив угод на $100." : "Цього тижня ще ніхто не закрив угод на $100.")
    : board === "FRIENDS" ? (ended ? "Того тижня запрошені друзі не торгували." : "Цього тижня запрошені друзі ще не торгували.")
    : ended ? "Того тижня жоден лаунч не вийшов на DEX." : "Цього тижня жоден лаунч не вийшов на DEX.",
  more: (shown, total) => `Перші ${shown} з ${total}`,
  you: "Ви",
  place: (place) => `№ ${place}`,
  placeAloud: "Місце ",
  saveFailed: "Не збережено. Спробуйте ще раз.",
  youOff: {
    TRADERS: (closed, min) => `Закрито $${closed} із $${min}`,
    FRIENDS: () => "Ваші запрошені друзі не торгували",
    CREATORS: () => "Ваші лаунчі не виходили на DEX",
  },
  noneClosed: "Закритих угод немає",
  hiddenNote: (place) => (place ? `Вас не показано в таблицях. Інакше ваше місце — № ${place}.` : "Вас не показано в таблицях."),
  internalNote: "Це гаманець самої Ryntra — у таблицях він не рахується.",
  showMe: "Показувати мене в таблицях",
  showMeHint: "Прихований гаманець не має й рамки рангу на аватарі.",
  connect: "Підключіть гаманець, щоб побачити своє місце.",
  confirmLead: "Підтвердьте гаманець, щоб побачити своє місце.",
  confirm: "Підтвердити гаманець",
  confirming: "Підтверджуємо…",
  unavailable: "Таблиці зараз недоступні.",
  retry: "Спробувати ще",
  loading: "Завантажуємо таблиці…",
  loadingSeason: "Завантажуємо сезон…",
  rulesTitle: "Як працюють таблиці",
  rules: (min, creators) => [
    "Тиждень — з понеділка по неділю за UTC. Щопонеділка таблиці починаються знову.",
    `Трейдери: результат угод, закритих цього тижня через Ryntra, у відсотках від того, скільки за них заплачено через Ryntra. У таблиці — від $${min} закритих угод.`,
    "Друзі: ті, кого ви запросили і хто цього тижня зробив угоду з комісією Ryntra.",
    ...(creators ? ["Творці: ваші лаунчі, що цього тижня вийшли з кривої на DEX."] : []),
    "Місце дає лише статус і значки — жодних грошей чи призів.",
    "Гаманці самої Ryntra й тестові не рахуються. Приховатися можна будь-коли.",
    "Минулі результати не гарантують майбутніх. Капітал під ризиком.",
  ],

  seasonTitle: (number) => `Сезон ${number}`,
  theme: { FIRST_STEPS: "Перші кроки", TOGETHER: "Разом", HABIT: "Звичка" },
  weekOf: (week, weeks) => `Тиждень ${week} з ${weeks}`,
  ends: (date) => `До ${date}`,
  ended: "Завершено",
  ahead: "Попереду",
  running: "Триває",
  notStarted: "Сезони ще не почалися",
  seasonNotStarted: (number) => `Сезон ${number} ще не почався`,
  notStartedMore: "Сезон триває 8 тижнів: три завдання й значки сезону.",
  thisWeeksBoards: "Таблиці тижня",
  task: { FIRST_TRADE: "Перша угода сезону", THREE_WEEKS: "Угоди у 3 різні тижні", FRIEND_TRADES: "Запрошений друг торгує" },
  taskHow: {
    FIRST_TRADE: "Будь-яка угода на Ryntra, з якої Ryntra отримує комісію.",
    THREE_WEEKS: "Угода в трьох різних тижнях сезону.",
    FRIEND_TRADES: "Той, кого ви запросили, робить угоду під час сезону.",
  },
  progress: (have, need) => `${have} з ${need}`,
  doneOn: (date) => `Виконано ${date}`,
  tasksDone: (done, total) => `${done} з ${total}`,
  seasonBadge: (number) => `Сезон ${number}`,
  seasonBadgeHow: "Виконайте всі три завдання.",
  podiumBadge: "Подіум",
  podiumBadgeHow: "Завершіть тиждень у трійці будь-якої таблиці.",
  podiumHeld: (board, place, week) => `${UK_BOARD[board]}, № ${place} · тиждень ${week}`,
  podiumHidden: "Прихованих немає в таблицях, тож і значка подіуму вони не отримують.",
  notYet: (name) => `${name}, ще не отримано`,
  yourSeason: "Ваш сезон",
  weeksTitle: "Тижні",
  weekLabel: (number) => `Тиждень ${number}`,
  nobody: "Поки нікого",
  nobodyEnded: "Нікого",
  notDone: "Не виконано",
  topTrader: (name, value) => `Найкращий трейдер ${name} ${value}`,
  noTopTrader: "Трейдерів у таблиці немає",
  seasonSummary: "Підсумок сезону",
  taskDoneAloud: "виконано",
  usd: (decimal) => `$${decimal.replace(".", ",")}`,
  community: (participants, complete, ended) =>
    `${ended ? "Взяли участь" : "Беруть участь"}: ${participants} · виконали всі завдання: ${complete}`,
  seasonRulesTitle: "Як працюють сезони",
  seasonRules: [
    "Сезон — 8 тижнів. Наступний починається, щойно закінчився попередній.",
    "Завдання й значки сезону щосезону починаються знову. Ранг і винагороди лишаються.",
    "Значки сезону — лише статус: жодних грошей чи призів.",
    "Гаманці самої Ryntra й тестові не рахуються.",
  ],
  openBoards: "Таблиці",
  openSeason: "Сезон",
  otherSeasons: "Сезони",
  seasonConnect: "Підключіть гаманець, щоб побачити свої завдання.",
  seasonConfirm: "Підтвердьте гаманець, щоб побачити свої завдання.",
  seasonUnavailable: "Сезон зараз недоступний.",
};

export function leagueCopy(locale: WorkspaceLocale): Copy {
  return locale === "uk" ? UK : EN;
}
