import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PaidAs } from "@/lib/rewards/programme-facts";

/**
 * Ріст 19 — the words of an honest Rewards: what the programme pays as a guest reads it, the one card after the
 * sign-in, and the mark beside every programme saying whether it is money paid in USDC, money counted until payouts
 * open, or status with no cash value. Both languages by construction; every figure arrives from the rules in force
 * and the sentences only place it.
 */

type Copy = Readonly<{
  /** The guest card's heading. */
  title: string;
  /** The mark beside a programme. */
  paidAs: Readonly<Record<PaidAs, string>>;
  cashback: string;
  cashbackWhat: string;
  friends: string;
  friendsWhat: (byRank: boolean) => string;
  theirFriends: string;
  theirFriendsWhat: string;
  firstTen: (cap: number) => string;
  firstTenWhat: string;
  partners: string;
  partnersWhat: string;
  /**
   * The conditions of the shares, one disclosure on the card — a row at rest is one line (LINE §5), and nothing a row
   * says is false without them. The inviter earns nothing while a friend is in «First $N back» (rules 2.1.0).
   */
  conditions: string;
  terms: Readonly<{
    firstTen: (cap: number, days: number, wallets: number) => string;
    friends: (window: Readonly<{ percent: number; days: number }> | null, firstTenCap: number | null) => string | null;
    theirFriends: (firstTenCap: number) => string;
    partners: (percent: number, then: Readonly<{ afterDays: number; percent: number }>) => string;
  }>;
  status: string;
  /** Before the owner starts rewards: nothing earns yet. */
  notStarted: string;
  /** The gate's line under the programme. */
  connect: string;
  /** No wallet in a desk browser: the one way on. */
  getWallet: string;
  /** The one card after the sign-in. */
  ready: string;
  /** The same figure while a claim is not possible (under the floor, payouts paused): no promise of «ready». */
  available: string;
  earned: string;
  waiting: string;
  waitingReserve: string;
  waitingPriced: string;
  details: string;
  detailsHide: string;
  invite: (upTo: string | null) => string;
  /** A Founding partner's own page: their steps are on the card below, so the line says only how the share is paid. */
  partnerState: (paidAs: Exclude<PaidAs, "STATUS">) => string;
  /** «Creator partners» and its Terms, where the promise was. */
  partnerFact: (percent: number, then: Readonly<{ afterDays: number; percent: number }> | null, paidAs: Exclude<PaidAs, "STATUS">) => string;
}>;

const EN: Copy = {
  title: "What Ryntra pays",
  paidAs: { USDC: "Paid in USDC", COUNTED: "Counted · payouts not open yet", PAUSED: "Counted · payouts paused", STATUS: "Status only" },
  cashback: "Cashback",
  cashbackWhat: "of Ryntra's fee on your trade",
  friends: "Friends",
  friendsWhat: (byRank) => `of Ryntra's fee on a friend's trade${byRank ? ", by your rank" : ""}`,
  theirFriends: "Their friends",
  theirFriendsWhat: "of Ryntra's fee on their friends' trades",
  firstTen: (cap) => `First $${cap} back`,
  firstTenWhat: "of Ryntra's fee, for a new wallet",
  partners: "Creator partners",
  partnersWhat: "of Ryntra's part of a creator's pool",
  conditions: "Conditions",
  terms: {
    firstTen: (cap, days, wallets) => `First $${cap} back: the first ${wallets} new wallets a month, for up to ${days} days; half at once, the rest after a check.`,
    friends: (window, cap) => {
      const parts = [...(window ? [`${window.percent}% in each friend's first ${window.days} days, at any rank`] : []), ...(cap ? [`nothing while they are in First $${cap} back`] : [])];
      return parts.length > 0 ? `Friends: ${parts.join("; ")}.` : null;
    },
    theirFriends: (cap) => `Their friends: nothing while they are in First $${cap} back.`,
    partners: (percent, then) => `Creator partners: ${percent}% for ${then.afterDays} days from the pool's first fee, then ${then.percent}%; Founding partners — in the partner Terms.`,
  },
  status: "Badges, seasons, boards",
  notStarted: "Rewards have not started yet. Trades made before they do earn nothing.",
  connect: "Connect a wallet to see your rewards.",
  getWallet: "Get Phantom",
  ready: "Ready to claim",
  available: "Available",
  earned: "Earned",
  waiting: "Waiting",
  waitingReserve: "for the reward reserve",
  waitingPriced: "being priced",
  details: "Details",
  detailsHide: "Hide details",
  invite: (upTo) => (upTo ? `Invite friends · up to ${upTo}` : "Invite friends"),
  partnerState: (paidAs) => (paidAs === "USDC" ? "Your share is paid in USDC." : paidAs === "PAUSED" ? "Your share is counted; payouts are paused." : "Your share is counted now, paid once partner payouts open."),
  partnerFact: (percent, then, paidAs) => {
    const share = `Bring a creator: ${percent}% of Ryntra's part of their pool${then ? ` for ${then.afterDays} days from its first fee, then ${then.percent}%` : ""}.`;
    return paidAs === "USDC" ? `${share} Paid in USDC.` : paidAs === "PAUSED" ? `${share} Counted now; payouts are paused.` : `${share} Counted now, paid once partner payouts open.`;
  },
};

const UK: Copy = {
  title: "Що платить Ryntra",
  paidAs: { USDC: "Виплата в USDC", COUNTED: "Рахуємо · виплати ще не відкриті", PAUSED: "Рахуємо · виплати на паузі", STATUS: "Лише статус" },
  cashback: "Кешбек",
  cashbackWhat: "комісії Ryntra з вашої угоди",
  friends: "Друзі",
  friendsWhat: (byRank) => `комісії Ryntra з угоди друга${byRank ? ", за вашим рангом" : ""}`,
  theirFriends: "Друзі друзів",
  theirFriendsWhat: "комісії Ryntra з угод друзів ваших друзів",
  firstTen: (cap) => `Перші $${cap} назад`,
  firstTenWhat: "комісії Ryntra — новому гаманцю",
  partners: "Партнери творців",
  partnersWhat: "частки Ryntra з пулу творця",
  conditions: "Умови",
  terms: {
    firstTen: (cap, days, wallets) => `Перші $${cap} назад: перші ${wallets} нових гаманців місяця, до ${days} днів; половина одразу, решта — після перевірки.`,
    friends: (window, cap) => {
      const parts = [...(window ? [`${window.percent}% у перші ${window.days} днів кожного друга, на будь-якому ранзі`] : []), ...(cap ? [`нічого, поки друг у «Перших $${cap} назад»`] : [])];
      return parts.length > 0 ? `Друзі: ${parts.join("; ")}.` : null;
    },
    theirFriends: (cap) => `Друзі друзів: нічого, поки вони в «Перших $${cap} назад».`,
    partners: (percent, then) => `Партнери творців: ${percent}% протягом ${then.afterDays} днів від першої комісії пулу, далі ${then.percent}%; Founding-партнери — в Умовах партнера.`,
  },
  status: "Значки, сезони, таблиці",
  notStarted: "Винагороди ще не почалися. Угоди до старту нічого не приносять.",
  connect: "Підключіть гаманець, щоб побачити свої винагороди.",
  getWallet: "Встановити Phantom",
  ready: "Можна забрати",
  available: "Доступно",
  earned: "Зароблено",
  waiting: "Очікує",
  waitingReserve: "резерву винагород",
  waitingPriced: "оцінки",
  details: "Деталі",
  detailsHide: "Сховати деталі",
  invite: (upTo) => (upTo ? `Запросити друзів · до ${upTo}` : "Запросити друзів"),
  partnerState: (paidAs) => (paidAs === "USDC" ? "Ваша частка — виплата в USDC." : paidAs === "PAUSED" ? "Вашу частку пораховано; виплати на паузі." : "Вашу частку вже рахуємо; виплатимо, щойно запрацюють виплати партнерам."),
  partnerFact: (percent, then, paidAs) => {
    const share = `Приведіть творця: ${percent}% частки Ryntra з його пулу${then ? ` протягом ${then.afterDays} днів від першої комісії пулу, далі ${then.percent}%` : ""}.`;
    return paidAs === "USDC" ? `${share} Виплата в USDC.` : paidAs === "PAUSED" ? `${share} Уже рахуємо; виплати на паузі.` : `${share} Уже рахуємо; виплатимо, щойно запрацюють виплати партнерам.`;
  },
};

export function programmeCopy(locale: WorkspaceLocale): Copy {
  return locale === "uk" ? UK : EN;
}
