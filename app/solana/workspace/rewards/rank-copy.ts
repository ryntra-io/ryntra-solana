import type { WorkspaceLocale } from "@/app/shell/locale";

import { RANK_THRESHOLDS, REWARD_RANKS } from "../../../../lib/rewards/rules.ts";

/**
 * The ladder, said in each language from the thresholds in force — never retyped. A ladder that moves (it did on
 * 2026-10-27) must move in the sentence a person reads, or the page promises a rank the code does not give.
 */
const ladderLine = (locale: WorkspaceLocale): string => {
  const names = locale === "uk"
    ? { BRONZE: "Бронза", SILVER: "Срібло", GOLD: "Золото", SAPPHIRE: "Сапфір", DIAMOND: "Діамант" }
    : { BRONZE: "Bronze", SILVER: "Silver", GOLD: "Gold", SAPPHIRE: "Sapphire", DIAMOND: "Diamond" };
  const number = (value: bigint) => value.toLocaleString(locale === "uk" ? "uk-UA" : "en-US").replace(/ /g, " ");
  const from = locale === "uk" ? "від" : "from";
  const points = locale === "uk" ? " очок" : " points";
  const parts = REWARD_RANKS.map((rank, index) =>
    `${names[rank]} — ${from} ${number(RANK_THRESHOLDS[rank])}${index === 0 ? points : ""}`.replace(" — ", locale === "uk" ? " — " : " "),
  );
  return `${parts.join(", ")}.`;
};

/**
 * The words of ranks, in both languages, beside the card that says them.
 *
 * Kept here rather than in the workspace catalogue because the catalogue is
 * the core's file and ranks are the Growth line's: this page's new sentences
 * live with the page. Every sentence has both languages by construction — a
 * missing one is a type error, not a mixed-language page.
 */

export type RankId = "BRONZE" | "SILVER" | "GOLD" | "SAPPHIRE" | "DIAMOND";
export type AchievementWordId = "FIRST_FRIEND" | "FIVE_FRIENDS" | "LAUNCH_ON_DEX";

type Copy = Readonly<{
  title: string;
  window: (days: number) => string;
  rank: Readonly<Record<RankId, string>>;
  /** A grouped figure as this language writes whole numbers. */
  number: (grouped: string) => string;
  /** The word under the figure: point, points — очко, очки, очок. */
  unit: (grouped: string) => string;
  /** A figure of 100 000 or more as the ring shows it: whole thousands and the word under them. */
  thousands: (thousands: number) => Readonly<{ figure: string; unit: string }>;
  millions: (millions: number) => Readonly<{ figure: string; unit: string }>;
  points: (grouped: string) => string;
  toNext: (grouped: string, rank: RankId) => string;
  top: string;
  breakdown: (trades: string, friends: string, launches: string | null) => readonly string[];
  ladder: string;
  /** A ladder step read aloud: the rank, its share, the points it begins at. */
  step: (rank: RankId, share: number, from: string) => string;
  fresh: string;
  /** No points yet because every trade so far was inside «First $10 back». */
  freshWindow: string;
  unavailable: string;
  inviteTitle: string;
  levelOneChip: (share: string) => string;
  levelTwoChip: (share: string) => string;
  rewardsRules: readonly string[];
  /**
   * Rules 2.1.0, once they are in force: the inviter's line with its 90 days, «First $10 back» and the claim floor.
   * Every figure arrives from the server; the sentences only place them.
   */
  inviterRule: (share: number, days: number) => string;
  firstTenRule: (cap: string, days: number, wallets: number) => string;
  claimFloorRule: (withAccount: string, withoutAccount: string) => string;
  /** The rule of the earlier claim floor, before rules 2.1.0. */
  claimFloorBefore: string;
  /** Under rules 2.1.0: a trade made earlier keeps the rules it was made under. */
  rulesBefore: string;
  levelOneWindowChip: (share: number) => string;
  /** Under the ladder: a friend's first days pay the window's share at any rank. */
  ladderWindow: (share: number, days: number) => string;
  /** The same, short, under the rank's ladder; the whole rule is in «How ranks work». */
  ladderWindowShort: (share: number, days: number) => string;
  /** The two referral sources, as a person names them (not «L1», «L2»). */
  fromFriends: string;
  fromTheirFriends: string;
  /** «First $10 back» on the earnings panel, for a wallet that holds the window. */
  firstTenTitle: (cap: string) => string;
  firstTenProgress: (returned: string, cap: string) => string;
  firstTenUntil: (date: string) => string;
  firstTenCheck: (held: string) => string;
  firstTenFull: (cap: string) => string;
  firstTenEnded: string;
  firstTenFailed: string;
  ranksTitle: string;
  ranksRules: readonly string[];
  /** Recent rewards, folded to the newest few: open the rest of the list, fold it back. */
  historyAll: (count: number) => string;
  historyFold: string;
  /** «Винагороди» in the header, and what it says when money is ready or on its way. */
  header: string;
  headerReady: (sum: string) => string;
  /** Gathered, under the minimum a claim needs (or with payouts paused). */
  headerGathered: (sum: string, minimum: string) => string;
  /** Gathered past the minimum, but a claim would not go through now (payouts paused). */
  headerHeld: (sum: string) => string;
  headerPending: (sum: string) => string;
  badgesTitle: string;
  /** The line under the badges before one is chosen. */
  badgesHint: string;
  /** How many of the badges shown are held: «3 of 7», and the same read aloud. */
  badgesHeld: (held: number, total: number) => string;
  badgesHeldAloud: (held: number, total: number) => string;
  /** The line under the badges once every one is held. */
  badgesAllHint: string;
  /** A rank reached where the day is not known. */
  reached: string;
  achievement: Readonly<Record<AchievementWordId, string>>;
  /** What earns an achievement, one sentence. */
  achievementHow: Readonly<Record<AchievementWordId, string>>;
  /** What a rank badge asks: Bronze is held from the start, the rest from their threshold within 30 days. */
  rankHow: (rank: RankId, from: string) => string;
  /** A badge held, and the day it was earned. */
  earnedOn: (date: string) => string;
  /** A badge's accessible name when not yet held. */
  notYet: (name: string) => string;
  frame: string;
  /** The frame line: the rank's frame, or that a frame begins at Silver. */
  frameOf: (rank: RankId | null) => string;
  frameHow: string;
  avatar: (rank: RankId | null) => string;
}>;

/** The API groups thousands with a narrow space; English reads a comma. */
const enNumber = (grouped: string): string => grouped.replace(/[\s  ]/g, ",");

/** How many — 1 очко, 2 очки, 5 очок — read from the last digits, as Ukrainian counts. */
function ukUnit(grouped: string): string {
  const n = Number(grouped.replace(/\D/g, "").slice(-2));
  const last = n % 10;
  return n >= 11 && n <= 14 ? "очок" : last === 1 ? "очко" : last >= 2 && last <= 4 ? "очки" : "очок";
}

const UK_GENITIVE: Readonly<Record<RankId, string>> = {
  BRONZE: "Бронзи",
  SILVER: "Срібла",
  GOLD: "Золота",
  SAPPHIRE: "Сапфіра",
  DIAMOND: "Діаманта",
};

const EN_RANK: Readonly<Record<RankId, string>> = {
  BRONZE: "Bronze",
  SILVER: "Silver",
  GOLD: "Gold",
  SAPPHIRE: "Sapphire",
  DIAMOND: "Diamond",
};

const UK_RANK: Readonly<Record<RankId, string>> = {
  BRONZE: "Бронза",
  SILVER: "Срібло",
  GOLD: "Золото",
  SAPPHIRE: "Сапфір",
  DIAMOND: "Діамант",
};

const EN: Copy = {
  title: "Rank",
  window: (days) => `${days} days`,
  rank: EN_RANK,
  number: enNumber,
  unit: (grouped) => (grouped === "1" ? "point" : "points"),
  thousands: (thousands) => ({ figure: `${thousands}k`, unit: "points" }),
  millions: (millions) => ({ figure: `${millions}M`, unit: "points" }),
  points: (grouped) => `${enNumber(grouped)} ${grouped === "1" ? "point" : "points"}`,
  toNext: (grouped, rank) => `${enNumber(grouped)} points to ${EN_RANK[rank]}`,
  top: "Top rank",
  breakdown: (trades, friends, launches) => [
    `${enNumber(trades)} from your trades`,
    `${enNumber(friends)} from friends`,
    ...(launches ? [`${enNumber(launches)} from launches`] : []),
  ],
  ladder: "Your share of a friend's trade · points needed",
  step: (rank, share, from) => `${EN_RANK[rank]}: ${share}% from a friend's trade, from ${enNumber(from)} points`,
  fresh: "Your first trade earns your first points.",
  freshWindow: "Trades in First $10 back earn no points; your trades after it do.",
  unavailable: "Your rank is unavailable right now.",
  inviteTitle: "Invite friends",
  levelOneChip: (share) => `Friends ${share}`,
  levelTwoChip: (share) => `Their friends ${share}`,
  rewardsRules: [
    "50% of the fee Ryntra receives on your own trade comes back to you.",
    "From a trade by a friend you invited: 10% to 30% of the fee Ryntra receives, by your rank. From the friends they invited: 5%.",
    "Trades made before these rules began keep the earlier shares: 50%, 10% and 5% of the fee paid.",
  ],
  inviterRule: (share, days) => `From a trade by a friend you invited: ${share}% of the fee Ryntra receives for the friend's first ${days} days, then 10% to 30% by your rank — except while the friend gets their First $10 back, and by your rank if a review cancels it. From the friends they invited: 5%, except their trades in First $10 back.`,
  firstTenRule: (cap, days, wallets) => `First ${cap} back: a new wallet gets back all of the fee Ryntra receives until ${cap} has come back, for up to ${days} days from its first trade. For the first ${wallets} new wallets each month that pass our check. Half comes back at once, the rest after the check. Whoever invited the wallet earns nothing from these trades, and they earn no rank points.`,
  claimFloorRule: (withAccount, withoutAccount) => `Claim from ${withAccount} USDC when your wallet already has a USDC account, or from ${withoutAccount} when the payout opens one for it. To the wallet you are signed in with.`,
  claimFloorBefore: "Claim from $1.00 USDC, to the wallet you are signed in with.",
  rulesBefore: "A trade made before these rules keeps the rules it was made under.",
  levelOneWindowChip: (share) => `Friends up to ${share}%`,
  ladderWindow: (share, days) => `Each friend's first ${days} days pay you ${share}% at any rank, once their First $10 back is done — unless a review cancelled it.`,
  ladderWindowShort: (share, days) => `Each friend's first ${days} days: ${share}% at any rank.`,
  fromFriends: "From friends",
  fromTheirFriends: "From their friends",
  firstTenTitle: (cap) => `First ${cap} back`,
  firstTenProgress: (returned, cap) => `${returned} of ${cap} back`,
  firstTenUntil: (date) => `until ${date}`,
  firstTenCheck: (held) => `${held} comes once your wallet is checked.`,
  firstTenFull: (cap) => `All ${cap} came back.`,
  firstTenEnded: "The window has ended.",
  firstTenFailed: "First $10 back was cancelled for this wallet after a review.",
  historyAll: (count) => `Show ${count} more`,
  historyFold: "Show fewer",
  header: "Rewards",
  headerReady: (sum) => `Rewards: ${sum} to claim`,
  headerGathered: (sum, minimum) => `Rewards: ${sum} gathered · claim from ${minimum}`,
  headerHeld: (sum) => `Rewards: ${sum} gathered`,
  headerPending: (sum) => `Rewards: ${sum} on its way`,
  ranksTitle: "How ranks work",
  ranksRules: [
    ladderLine("en"),
    "1 point for every $1 of fee Ryntra receives from your trades and from trades by friends you invited, over the last 30 days. A rank can go down as well as up.",
    "Your rank sets your share of a friend's fee: 10% at Bronze, 15% at Silver, 20% at Gold, 25% at Sapphire, 30% at Diamond.",
    "Points have no cash value and cannot be transferred or exchanged.",
  ],
  badgesTitle: "Badges",
  badgesHint: "Choose a badge to see what earns it.",
  badgesHeld: (held, total) => `${held} of ${total}`,
  badgesHeldAloud: (held, total) => `Badges earned: ${held} of ${total}`,
  badgesAllHint: "Choose a badge to see when it was earned.",
  reached: "Reached",
  achievement: { FIRST_FRIEND: "First friend", FIVE_FRIENDS: "Five friends", LAUNCH_ON_DEX: "On a DEX" },
  achievementHow: {
    FIRST_FRIEND: "A friend you invited trades on Ryntra.",
    FIVE_FRIENDS: "Five friends you invited have traded on Ryntra.",
    LAUNCH_ON_DEX: "A token you launched moved from its curve to a DEX.",
  },
  rankHow: (rank, from) => (rank === "BRONZE" ? "Every account starts at Bronze." : `Reach ${enNumber(from)} points within 30 days. Once reached, the badge stays.`),
  earnedOn: (date) => `Earned ${date}`,
  notYet: (name) => `${name}, not yet earned`,
  frame: "Frame",
  frameOf: (rank) => (rank === null || rank === "BRONZE" ? "Frame from Silver" : `${EN_RANK[rank]} frame`),
  frameHow: "From Silver up, your avatar wears your rank's frame. It changes with your rank.",
  avatar: (rank) => (rank === null || rank === "BRONZE" ? "Your avatar, no frame yet" : `Your avatar in the ${EN_RANK[rank]} frame`),
};

const UK: Copy = {
  title: "Ранг",
  window: (days) => `${days} днів`,
  rank: UK_RANK,
  number: (grouped) => grouped,
  unit: ukUnit,
  thousands: (thousands) => ({ figure: String(thousands), unit: "тис. очок" }),
  millions: (millions) => ({ figure: String(millions), unit: "млн очок" }),
  points: (grouped) => `${grouped} ${ukUnit(grouped)}`,
  toNext: (grouped, rank) => `Ще ${grouped} ${ukUnit(grouped)} до ${UK_GENITIVE[rank]}`,
  top: "Найвищий ранг",
  breakdown: (trades, friends, launches) => [
    `${trades} з ваших угод`,
    `${friends} з угод друзів`,
    ...(launches ? [`${launches} з лаунчів`] : []),
  ],
  ladder: "Ваша частка з угоди друга · поріг очок",
  step: (rank, share, from) => `${UK_RANK[rank]}: ${share}% з угоди друга, від ${from} ${ukUnit(from)}`,
  fresh: "Перша угода дасть перші очки.",
  freshWindow: "Угоди в «Перших $10 назад» очок не дають; наступні — дають.",
  unavailable: "Ранг зараз недоступний.",
  inviteTitle: "Запросіть друзів",
  levelOneChip: (share) => `Друзі ${share}`,
  levelTwoChip: (share) => `Друзі друзів ${share}`,
  rewardsRules: [
    "50% комісії, яку Ryntra отримує з вашої угоди, повертається вам.",
    "З угоди друга, якого ви запросили: від 10% до 30% комісії, яку отримує Ryntra, за вашим рангом. З угод тих, кого запросили вони: 5%.",
    "Угоди, зроблені до цих правил, лишаються за попередніми частками: 50%, 10% і 5% сплаченої комісії.",
  ],
  inviterRule: (share, days) => `З угоди друга, якого ви запросили: ${share}% комісії, яку отримує Ryntra, перші ${days} днів від його першої угоди, далі — від 10% до 30% за вашим рангом; поки друг отримує «Перші $10 назад» — нічого, а якщо перевірка їх скасувала — за рангом. З угод тих, кого запросили вони: 5%, крім їхніх угод у «Перших $10 назад».`,
  firstTenRule: (cap, days, wallets) => `Перші ${cap} назад: новий гаманець отримує назад усю комісію, яку отримала Ryntra, поки не повернеться ${cap}, щонайдовше ${days} днів від першої угоди. Для перших ${wallets} нових гаманців місяця, що пройшли нашу перевірку. Половина повертається одразу, решта — після перевірки. Той, хто запросив гаманець, з цих угод нічого не отримує, і очок рангу вони не дають.`,
  claimFloorRule: (withAccount, withoutAccount) => `Отримати можна від ${withAccount} USDC, якщо у вашому гаманці вже є рахунок USDC, або від ${withoutAccount}, якщо виплата його відкриває. На гаманець, яким ви увійшли.`,
  claimFloorBefore: "Отримати можна від $1.00 USDC, на гаманець, яким ви увійшли.",
  rulesBefore: "Угода, зроблена до цих правил, лишається за правилами, за якими її зроблено.",
  levelOneWindowChip: (share) => `Друзі до ${share}%`,
  ladderWindow: (share, days) => `Перші ${days} днів кожного друга дають вам ${share}% на будь-якому ранзі — після його «Перших $10 назад», якщо перевірка їх не скасувала.`,
  ladderWindowShort: (share, days) => `Перші ${days} днів кожного друга — ${share}% на будь-якому ранзі.`,
  fromFriends: "Від друзів",
  fromTheirFriends: "Від друзів друзів",
  firstTenTitle: (cap) => `Перші ${cap} назад`,
  firstTenProgress: (returned, cap) => `Повернено ${returned} з ${cap}`,
  firstTenUntil: (date) => `до ${date}`,
  firstTenCheck: (held) => `${held} — після перевірки гаманця.`,
  firstTenFull: (cap) => `Усі ${cap} повернено.`,
  firstTenEnded: "Вікно скінчилося.",
  firstTenFailed: "Для цього гаманця «Перші $10 назад» скасовано після перевірки.",
  historyAll: (count) => `Показати ще ${count}`,
  historyFold: "Згорнути",
  header: "Винагороди",
  headerReady: (sum) => `Винагороди: ${sum} можна забрати`,
  headerGathered: (sum, minimum) => `Винагороди: накопичено ${sum} · забрати від ${minimum}`,
  headerHeld: (sum) => `Винагороди: накопичено ${sum}`,
  headerPending: (sum) => `Винагороди: ${sum} очікує`,
  ranksTitle: "Як працюють ранги",
  ranksRules: [
    ladderLine("uk"),
    "1 очко за кожен $1 комісії, яку Ryntra отримує з ваших угод і з угод друзів, яких ви запросили, за останні 30 днів. Ранг може й знизитися.",
    "Ранг визначає вашу частку з комісії друга: 10% на Бронзі, 15% на Сріблі, 20% на Золоті, 25% на Сапфірі, 30% на Діаманті.",
    "Очки не мають грошової вартості, їх не можна передати чи обміняти.",
  ],
  badgesTitle: "Значки",
  badgesHint: "Оберіть значок — побачите, як його отримати.",
  badgesHeld: (held, total) => `${held} з ${total}`,
  badgesHeldAloud: (held, total) => `Значків отримано: ${held} з ${total}`,
  badgesAllHint: "Оберіть значок — побачите, коли його отримано.",
  reached: "Досягнуто",
  achievement: { FIRST_FRIEND: "Перший друг", FIVE_FRIENDS: "П'ять друзів", LAUNCH_ON_DEX: "Вихід на DEX" },
  achievementHow: {
    FIRST_FRIEND: "Друг, якого ви запросили, торгує на Ryntra.",
    FIVE_FRIENDS: "П'ятеро друзів, яких ви запросили, торгували на Ryntra.",
    LAUNCH_ON_DEX: "Токен, який ви запустили, вийшов з кривої на DEX.",
  },
  rankHow: (rank, from) => (rank === "BRONZE" ? "З Бронзи починає кожен." : `Наберіть ${from} ${ukUnit(from)} за 30 днів. Досягнутий значок лишається з вами.`),
  earnedOn: (date) => `Отримано ${date}`,
  notYet: (name) => `${name}, ще не отримано`,
  frame: "Рамка",
  frameOf: (rank) => (rank === null || rank === "BRONZE" ? "Рамка — від Срібла" : `Рамка ${UK_GENITIVE[rank]}`),
  frameHow: "Від Срібла ваш аватар має рамку вашого рангу. Вона змінюється разом із рангом.",
  avatar: (rank) => (rank === null || rank === "BRONZE" ? "Ваш аватар, рамки ще немає" : `Ваш аватар у рамці ${UK_GENITIVE[rank]}`),
};

export function rankCopy(locale: WorkspaceLocale): Copy {
  return locale === "uk" ? UK : EN;
}
