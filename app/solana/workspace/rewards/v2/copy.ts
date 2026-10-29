import type { WorkspaceLocale } from "@/app/shell/locale";

import type { FriendStage, MoneyKind, MoneyState, TaskId, TaskState } from "./fixture.ts";

/**
 * The words of the Rewards v2 prototype, both languages side by side.
 *
 * Rank names, «points to the next rank» and the rules' sentences are not here:
 * the prototype takes them from `rank-copy.ts`, the live page's own words, so
 * the two never say a rule two ways. At rest a screen says one number, one
 * state and one action; every longer sentence sits one tap deeper.
 */

type TaskWords = Readonly<{ name: string; condition: string; action: string }>;

export type V2Copy = Readonly<{
  sample: string;
  tabs: Readonly<{ label: string; overview: string; friends: string; tasks: string; history: string }>;

  claimable: string;
  yourRewards: string;
  pending: (amount: string) => string;
  paidSoFar: (amount: string) => string;
  claim: (amount: string) => string;
  claimNote: (floor: string) => string;
  belowFloor: (floor: string) => string;
  nothingYet: string;

  firstTen: string;
  firstTenOf: (returned: string, cap: string) => string;
  firstTenLeft: (days: number) => string;
  firstTenOpen: (wallets: number, days: number) => string;
  firstTenDone: string;

  nextStep: string;
  rank: string;
  ranks: string;
  shareNow: (share: number, days: number) => string;
  shareNext: (share: number) => string;
  windowNote: string;

  friends: string;
  friendsBuying: (count: number) => string;
  fromFriends: (amount: string) => string;
  shareLink: string;
  latest: string;
  all: string;
  more: string;
  boards: string;
  season: string;
  partners: string;
  howItWorks: string;

  inviteTitle: string;
  youGet: (share: number, days: number) => string;
  theyGet: (cap: string, wallets: number) => string;
  terms: string;
  share: string;
  copy: string;
  copied: string;
  qr: string;
  qrHint: string;
  stage: Readonly<Record<FriendStage, string>>;
  holdingDays: (days: number) => string;
  path: readonly [string, string, string, string];
  toYou: (amount: string) => string;
  windowLeft: (share: number, days: number) => string;
  theirFirstTen: string;
  checking: string;
  noPurchase: string;
  opened: (count: number) => string;
  secondLevel: (amount: string, share: number) => string;
  noFriends: string;
  noFriendsHint: string;

  investorPath: string;
  investorBadge: string;
  now: string;
  next: string;
  done: string;
  task: Readonly<Record<TaskId, TaskWords>>;
  plusPoints: (points: number) => string;
  plusBadge: string;
  state: Readonly<Record<Exclude<TaskState, "holding" | "locked">, string>>;
  holdingHours: (hours: number) => string;
  lockedAfter: (name: string) => string;
  progress: (done: number, of: number) => string;
  holdNote: string;
  reviewNote: string;
  doneOn: (date: string) => string;
  condition: string;
  reward: string;
  close: string;
  pointsNote: string;

  money: string;
  points: string;
  kind: Readonly<Record<MoneyKind, string>>;
  fromFriend: (wallet: string) => string;
  via: (wallet: string) => string;
  rowFee: string;
  rowShare: string;
  showMore: (count: number) => string;
  showLess: string;
  rankCanDrop: string;
  holdOf: (hours: number) => string;
  hoursLeft: (hours: number) => string;
  trade: (asset: string) => string;
  moneyState: Readonly<Record<MoneyState, string>>;
  pointsTask: (name: string) => string;
  pointsTrades: string;
  pointsFriends: string;
  outsideWindow: string;
  receipt: string;
  rules: (version: string) => string;
  rulesLabel: string;
  chain: Readonly<Partial<Record<TaskId, string>>>;
  emptyHistory: string;

  back: string;
  youAreHere: string;
  later: string;
  opens: Readonly<Record<"cashback" | "frame" | "launches" | "perps" | "presales", string>>;
  fromFriendShare: (share: number) => string;
  fromPoints: (points: string) => string;
  howPoints: string;
  pointsSources: readonly [string, string, string, string];

  celebrateRank: (rank: string) => string;
  celebrateRankLine: (before: number, after: number) => string;
  celebrateFriend: string;
  celebrateFriendLine: string;
  ok: string;

  protoLabel: string;
  protoActive: string;
  protoNew: string;
  protoRank: string;
  protoFriend: string;
  protoTask: string;
}>;

const ukPlural = (n: number, one: string, few: string, many: string) => {
  const last = n % 10;
  const two = n % 100;
  if (last === 1 && two !== 11) return one;
  if (last >= 2 && last <= 4 && (two < 12 || two > 14)) return few;
  return many;
};

const ukDays = (n: number) => `${n} ${ukPlural(n, "день", "дні", "днів")}`;
const ukPoints = (n: number) => `${n.toLocaleString("uk-UA").replace(/ /g, " ")} ${ukPlural(n, "очко", "очки", "очок")}`;
const enPoints = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "point" : "points"}`;

const EN: V2Copy = {
  sample: "Prototype · sample data",
  tabs: { label: "Rewards", overview: "Overview", friends: "Friends", tasks: "Tasks", history: "History" },

  claimable: "Ready to claim",
  yourRewards: "Your rewards",
  pending: (amount) => `${amount} pending`,
  paidSoFar: (amount) => `${amount} claimed so far`,
  claim: (amount) => `Claim ${amount}`,
  claimNote: (floor) => `USDC to your wallet · from ${floor}`,
  belowFloor: (floor) => `You can claim from ${floor}`,
  nothingYet: "Part of our fee comes back to you",

  firstTen: "First $10 back",
  firstTenOf: (returned, cap) => `${returned} of ${cap}`,
  firstTenLeft: (days) => `${days} ${days === 1 ? "day" : "days"} left`,
  firstTenOpen: (wallets, days) => `The month's first ${wallets} new wallets, after a check — up to ${days} days`,
  firstTenDone: "Done",

  nextStep: "Next step",
  rank: "Rank",
  ranks: "Ranks",
  shareNow: (share, days) => `${share}% after a friend's first ${days} days`,
  shareNext: (share) => `next ${share}%`,
  windowNote: "Last 30 days",

  friends: "Friends",
  friendsBuying: (count) => `${count} buying`,
  fromFriends: (amount) => `${amount} from friends`,
  shareLink: "Share your link",
  latest: "Latest",
  all: "All",
  more: "More in Rewards",
  boards: "Leaderboards",
  season: "Season",
  partners: "Creator partners",
  howItWorks: "How it works",

  inviteTitle: "Invite a friend",
  youGet: (share, days) => `You: ${share}% of the fee Ryntra receives in a friend's first ${days} days, after their First\u00a0$10\u00a0back`,
  theyGet: (cap, wallets) => `Your friend: their fee back, up to ${cap} in 30 days — the month's first ${wallets} new wallets, after a check`,
  terms: "Terms",
  share: "Share",
  copy: "Copy link",
  copied: "Copied",
  qr: "QR code",
  qrHint: "Scan with a phone camera",
  stage: { joined: "Joined", firstBuy: "First purchase", holding: "Holding", active: "Active", review: "Being checked" },
  holdingDays: (days) => `Holding · ${days} ${days === 1 ? "day" : "days"}`,
  path: ["Joined", "Bought", "Holding", "Active"],
  toYou: (amount) => `${amount} to you`,
  windowLeft: (share, days) => `${share}% · ${days} days left`,
  theirFirstTen: "On their First $10 back — your share starts after",
  checking: "Answer within 72 h",
  noPurchase: "No purchase yet",
  opened: (count) => `${count} more opened your link`,
  secondLevel: (amount, share) => `Friends of friends · ${share}% · ${amount}`,
  noFriends: "No friends here yet",
  noFriendsHint: "Each friend's path shows up here",

  investorPath: "Investor's path",
  investorBadge: "Investor",
  now: "Now",
  next: "Next",
  done: "Done",
  task: {
    firstStep: { name: "First step", condition: "Connect a wallet", action: "Connect" },
    topUp: { name: "Top up", condition: "Have $5 or more in USDC in your wallet", action: "Top up" },
    firstCompany: { name: "First company", condition: "Buy a company from $1 and hold it for 72 hours", action: "Buy" },
    twoCompanies: { name: "Two companies", condition: "Hold two different companies", action: "Buy" },
    autoinvest: { name: "Autoinvest", condition: "Set a rule and let it make its first purchase", action: "Set up" },
    lesson: { name: "What am I buying", condition: "Take the lesson on tokenized stocks, 4 of 5 on the quiz", action: "Start lesson" },
    usefulWeek: { name: "A useful week", condition: "One purchase a week, four weeks in a row", action: "Buy this week" },
    friend: { name: "A friend", condition: "One friend who stays active", action: "Invite" },
  },
  plusPoints: (points) => `+${enPoints(points)}`,
  plusBadge: "+ badge",
  state: { available: "Open", review: "Being checked", done: "Done" },
  holdingHours: (hours) => `Holding · ${hours} h left`,
  lockedAfter: (name) => `After «${name}»`,
  progress: (done, of) => `${done} of ${of}`,
  holdNote: "It completes on its own once the hold ends",
  reviewNote: "We answer within 72 hours",
  doneOn: (date) => `Done ${date}`,
  condition: "To do",
  reward: "Reward",
  close: "Close",
  pointsNote: "Points have no cash value and cannot be transferred or exchanged",

  money: "Money",
  points: "Points",
  kind: { cashback: "Cashback", firstTen: "First $10 back", friend: "From a friend", friend2: "Friend of a friend", claim: "Claimed to your wallet" },
  fromFriend: (wallet) => `Friend ${wallet}`,
  via: (wallet) => `Via ${wallet}`,
  rowFee: "Fee Ryntra received",
  rowShare: "Your share",
  showMore: (count) => `Show ${count} more`,
  showLess: "Show fewer",
  rankCanDrop: "Your rank counts the last 30 days — it can go down too",
  holdOf: (hours) => `${72 - hours} h of 72`,
  hoursLeft: (hours) => `${hours} h left`,
  trade: (asset) => `${asset} trade`,
  moneyState: { pending: "Pending", available: "Available", paid: "Claimed" },
  pointsTask: (name) => `Task «${name}»`,
  pointsTrades: "Your trades",
  pointsFriends: "Friends' trades",
  outsideWindow: "Older than 30 days — not in your rank",
  receipt: "Receipt",
  rules: (version) => `Rules ${version}`,
  rulesLabel: "Rules",
  chain: { usefulWeek: "4 weeks" },
  emptyHistory: "Your first trade writes the first line here",

  back: "Overview",
  youAreHere: "You",
  later: "Later",
  opens: {
    cashback: "Cashback 50%",
    frame: "Avatar frame",
    launches: "Early access to launches",
    perps: "Lower fee on futures",
    presales: "First places in presales",
  },
  fromFriendShare: (share) => `${share}% from a friend`,
  fromPoints: (points) => `from ${points}`,
  howPoints: "Where points come from",
  pointsSources: ["Your trades — 1 per $1 of fee Ryntra receives", "Friends' trades — 1 per $1", "Tasks — the task's points", "Your launch reaching a DEX — 250"],

  celebrateRank: (rank) => `You're ${rank}`,
  celebrateRankLine: (before, after) => `After a friend's first 90 days, their trades now bring you ${after}% instead of ${before}%`,
  celebrateFriend: "Your friend is active",
  celebrateFriendLine: "Joined, bought, held — the whole path",
  ok: "Nice",

  protoLabel: "Prototype",
  protoActive: "Active wallet",
  protoNew: "New wallet",
  protoRank: "Rank up",
  protoFriend: "Friend milestone",
  protoTask: "Task card",
};

const UK: V2Copy = {
  sample: "Прототип · зразкові дані",
  tabs: { label: "Винагороди", overview: "Огляд", friends: "Друзі", tasks: "Завдання", history: "Історія" },

  claimable: "Можна забрати",
  yourRewards: "Ваші винагороди",
  pending: (amount) => `${amount} очікує`,
  paidSoFar: (amount) => `Уже забрано ${amount}`,
  claim: (amount) => `Забрати ${amount}`,
  claimNote: (floor) => `USDC на ваш гаманець · від ${floor}`,
  belowFloor: (floor) => `Забрати можна від ${floor}`,
  nothingYet: "Частина нашої комісії повертається вам",

  firstTen: "Перші $10 назад",
  firstTenOf: (returned, cap) => `${returned} з ${cap}`,
  firstTenLeft: (days) => `Ще ${ukDays(days)}`,
  firstTenOpen: (wallets, days) => `Перші ${wallets} нових гаманців місяця, після перевірки — до ${ukDays(days)}`,
  firstTenDone: "Завершено",

  nextStep: "Наступний крок",
  rank: "Ранг",
  ranks: "Ранги",
  shareNow: (share, days) => `${share}% після перших ${days} днів друга`,
  shareNext: (share) => `далі ${share}%`,
  windowNote: "За 30 днів",

  friends: "Друзі",
  friendsBuying: (count) => `${count} ${ukPlural(count, "купує", "купують", "купують")}`,
  fromFriends: (amount) => `${amount} від друзів`,
  shareLink: "Поділитися посиланням",
  latest: "Останні",
  all: "Усі",
  more: "Ще у «Винагородах»",
  boards: "Таблиці",
  season: "Сезон",
  partners: "Партнери творців",
  howItWorks: "Як це працює",

  inviteTitle: "Запросіть друга",
  youGet: (share, days) => `Вам — ${share}% комісії, яку отримує Ryntra, у перші ${days} днів друга, після його «Перших\u00a0$10\u00a0назад»`,
  theyGet: (cap, wallets) => `Другу — його комісія назад, до ${cap} за 30 днів — перші ${wallets} нових гаманців місяця, після перевірки`,
  terms: "Умови",
  share: "Поділитися",
  copy: "Копіювати",
  copied: "Скопійовано",
  qr: "QR-код",
  qrHint: "Наведіть камеру телефона",
  stage: { joined: "Приєднався", firstBuy: "Перша купівля", holding: "Утримує", active: "Активний", review: "На перевірці" },
  holdingDays: (days) => `Утримує · ${ukDays(days)}`,
  path: ["Приєднався", "Купив", "Утримує", "Активний"],
  toYou: (amount) => `${amount} вам`,
  windowLeft: (share, days) => `${share}% · ще ${ukDays(days)}`,
  theirFirstTen: "У нього «Перші $10 назад» — ваша частка після них",
  checking: "Відповідь до 72 год",
  noPurchase: "Ще не купував",
  opened: (count) => `Ще ${count} ${ukPlural(count, "відкрив", "відкрили", "відкрили")} посилання`,
  secondLevel: (amount, share) => `Друзі друзів · ${share}% · ${amount}`,
  noFriends: "Тут поки нікого",
  noFriendsHint: "Тут з'явиться шлях кожного друга",

  investorPath: "Шлях інвестора",
  investorBadge: "Інвестор",
  now: "Зараз",
  next: "Далі",
  done: "Виконано",
  task: {
    firstStep: { name: "Перший крок", condition: "Підключіть гаманець", action: "Підключити" },
    topUp: { name: "Поповнити", condition: "Майте від $5 USDC у гаманці", action: "Поповнити" },
    firstCompany: { name: "Перша компанія", condition: "Купіть компанію від $1 і тримайте 72 години", action: "Купити" },
    twoCompanies: { name: "Дві компанії", condition: "Майте дві різні компанії в портфелі", action: "Купити" },
    autoinvest: { name: "Автоінвест", condition: "Створіть правило — і хай воно зробить першу купівлю", action: "Налаштувати" },
    lesson: { name: "Що я купую", condition: "Урок про токенізовані акції і тест від 4 з 5", action: "Почати урок" },
    usefulWeek: { name: "Тиждень із користю", condition: "Одна купівля на тиждень, чотири тижні поспіль", action: "Купити цього тижня" },
    friend: { name: "Друг", condition: "Один друг, що лишається активним", action: "Запросити" },
  },
  plusPoints: (points) => `+${ukPoints(points)}`,
  plusBadge: "+ значок",
  state: { available: "Доступно", review: "На перевірці", done: "Виконано" },
  holdingHours: (hours) => `Утримання · ще ${hours} год`,
  lockedAfter: (name) => `Після «${name}»`,
  progress: (done, of) => `${done} з ${of}`,
  holdNote: "Закриється саме, щойно мине утримання",
  reviewNote: "Відповідь — до 72 годин",
  doneOn: (date) => `Виконано ${date}`,
  condition: "Що зробити",
  reward: "Нагорода",
  close: "Закрити",
  pointsNote: "Очки не мають грошової вартості, їх не можна передати чи обміняти",

  money: "Гроші",
  points: "Очки",
  kind: { cashback: "Кешбек", firstTen: "Перші $10 назад", friend: "Від друга", friend2: "Друг друга", claim: "Виплата на гаманець" },
  fromFriend: (wallet) => `Друг ${wallet}`,
  via: (wallet) => `Через ${wallet}`,
  rowFee: "Комісія, яку отримала Ryntra",
  rowShare: "Ваша частка",
  showMore: (count) => `Показати ще ${count}`,
  showLess: "Згорнути",
  rankCanDrop: "Ранг рахуємо за 30 днів — він може й знизитися",
  holdOf: (hours) => `${72 - hours} год з 72`,
  hoursLeft: (hours) => `ще ${hours} год`,
  trade: (asset) => `Угода ${asset}`,
  moneyState: { pending: "Очікує", available: "Доступно", paid: "Забрано" },
  pointsTask: (name) => `Завдання «${name}»`,
  pointsTrades: "Ваші угоди",
  pointsFriends: "Угоди друзів",
  outsideWindow: "Старше 30 днів — у ранг не входить",
  receipt: "Квитанція",
  rules: (version) => `Правила ${version}`,
  rulesLabel: "Правила",
  chain: { usefulWeek: "4 тижні" },
  emptyHistory: "Перша угода — і тут з'явиться перший запис",

  back: "Огляд",
  youAreHere: "Ви",
  later: "Згодом",
  opens: {
    cashback: "Кешбек 50%",
    frame: "Рамка аватара",
    launches: "Ранній доступ до лаунчів",
    perps: "Менша комісія на ф'ючерсах",
    presales: "Перші місця в пресейлах",
  },
  fromFriendShare: (share) => `${share}% з друга`,
  fromPoints: (points) => `від ${points}`,
  howPoints: "Звідки очки",
  pointsSources: ["Ваші угоди — 1 за $1 комісії, яку отримала Ryntra", "Угоди друзів — 1 за $1", "Завдання — очки завдання", "Ваш лаунч вийшов на DEX — 250"],

  celebrateRank: (rank) => `Ви — ${rank}`,
  celebrateRankLine: (before, after) => `Після перших 90 днів друга його угоди дають вам ${after}% замість ${before}%`,
  celebrateFriend: "Ваш друг — активний",
  celebrateFriendLine: "Приєднався, купив, утримав — увесь шлях",
  ok: "Чудово",

  protoLabel: "Прототип",
  protoActive: "Активний гаманець",
  protoNew: "Новий гаманець",
  protoRank: "Новий ранг",
  protoFriend: "Віха друга",
  protoTask: "Картка завдання",
};

export function v2Copy(locale: WorkspaceLocale): V2Copy {
  return locale === "uk" ? UK : EN;
}

/** A whole number of points as each language writes it, with its word. */
export function pointsText(locale: WorkspaceLocale, points: number): string {
  return locale === "uk" ? ukPoints(points) : enPoints(points);
}
