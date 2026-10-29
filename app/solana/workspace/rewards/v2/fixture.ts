import {
  nextRank,
  RANK_THRESHOLDS,
  rankForPoints,
  REWARD_RANKS,
  REWARD_RULES_CURRENT,
  type RewardRank,
} from "../../../../../lib/rewards/rules.ts";

/**
 * The sample a prototype of Rewards v2 is drawn with (Ріст 9).
 *
 * Not a store and not a wallet: two people in the shapes the product already
 * knows, written once by hand. What the product decides — the shares, the rank
 * thresholds, the claim floor, «First $10 back», the inviter's 90 days — is
 * read from the rules in force (`lib/rewards/rules.ts`), never retyped here, so
 * a picture cannot promise a number the code does not pay. The money totals are
 * sums of the rows below and the rank is computed from the points, the way the
 * ledger computes them; `fixture.test.mjs` holds both to that.
 */

export type Persona = "active" | "new";

/** The moment both samples are drawn at, so a picture never depends on the clock. */
export const SAMPLE_NOW = "2026-11-14T10:00:00.000Z";

export type TaskId = "firstStep" | "topUp" | "firstCompany" | "twoCompanies" | "autoinvest" | "lesson" | "usefulWeek" | "friend";
export type TaskClass = "learn" | "start" | "habit" | "community";
export type TaskState = "locked" | "available" | "holding" | "review" | "done";

export type SampleTask = Readonly<{
  id: TaskId;
  kind: TaskClass;
  points: number;
  state: TaskState;
  /** Steps of a task that takes several: weeks in a row, companies held. */
  progress?: Readonly<{ done: number; of: number }>;
  /** `holding`: when the hold ends. */
  holdEndsAt?: string;
  /** `locked`: the task that opens it. */
  after?: TaskId;
  /** `done`: when. */
  doneAt?: string;
  /** A badge comes with it. */
  badge?: boolean;
  href: string;
}>;

/** The chain «Investor's path», in order. */
export const INVESTOR_PATH: readonly TaskId[] = ["firstCompany", "twoCompanies", "autoinvest", "usefulWeek"];

/**
 * The points of each task in the catalogue.
 *
 * They are money, not decoration: a rank sets the share of a friend's fee, so points a person could collect
 * without trading would hand them a larger share for nothing. «First step» and «Top up» together once came to 150
 * against a first threshold of 100 — a 15 % share of a friend's fee instead of 10 %, with no trade at all.
 *
 * The catalogue has been cut twice for the same reason, and the second time was not its own doing: on 2026-10-27
 * the ladder itself moved a decade down (rules `2.2.0`), which would have put the opening two tasks back over the
 * first threshold. So the catalogue followed it down. What moves a rank is the fee Ryntra received; a task gives
 * its badge and its place in the chain. Changing this is one number a row, and the tests hold the catalogue to the
 * programme's own: what nobody has to trade for stays under the first rank.
 */
export const TASK_POINTS: Readonly<Record<TaskId, number>> = {
  firstStep: 1,
  topUp: 1,
  firstCompany: 3,
  twoCompanies: 2,
  autoinvest: 4,
  lesson: 1,
  usefulWeek: 5,
  friend: 5,
};

/** Each task's Ukrainian name, as the programme's catalogue writes it. */
export const TASK_NAME_UK: Readonly<Record<TaskId, string>> = {
  firstStep: "Перший крок",
  topUp: "Поповнити",
  firstCompany: "Перша компанія",
  twoCompanies: "Дві компанії",
  autoinvest: "Автоінвест",
  lesson: "Що я купую",
  usefulWeek: "Тиждень із користю",
  friend: "Друг",
};

/** What a person can finish without a trade — their own or a friend's. Together these may never reach a rank. */
export const TASKS_WITHOUT_A_TRADE: readonly TaskId[] = ["firstStep", "topUp", "lesson"];

/** A sample task carries the catalogue's points, never its own number. */
const task = (row: Omit<SampleTask, "points">): SampleTask => ({ ...row, points: TASK_POINTS[row.id] });

export type FriendStage = "joined" | "firstBuy" | "holding" | "active" | "review";

export type SampleFriend = Readonly<{
  /** The face the boards already draw for a wallet. */
  face: number;
  wallet: string;
  stage: FriendStage;
  /** Days the friend has held their first purchase (`holding`). */
  heldDays?: number;
  firstTradeAt?: string;
  /** The friend is inside their own «First $10 back»: nothing comes to the inviter yet. */
  inFirstTen?: boolean;
  /** What this friend's trades paid the inviter, USD micro-units. */
  earnedUsdMicros: bigint;
}>;

export type MoneyKind = "cashback" | "firstTen" | "friend" | "friend2" | "claim";
export type MoneyState = "pending" | "available" | "paid";

export type MoneyRow = Readonly<{
  id: string;
  kind: MoneyKind;
  at: string;
  /** A claim is negative: it moves money out of «available». */
  usdMicros: bigint;
  state: MoneyState;
  /** What it came from: an asset, a friend's masked wallet — for a friend of a friend, the friend it came through. */
  source?: string;
  /** The share of the fee Ryntra received that this row is, basis points: 10 000 in «First $10 back», 5 000 cashback, the inviter's share. */
  shareBps?: number;
  rules: string;
}>;

export type PointsKind = "task" | "trades" | "friends";

export type PointsRow = Readonly<{
  id: string;
  kind: PointsKind;
  at: string;
  points: number;
  task?: TaskId;
}>;

export type Sample = Readonly<{
  persona: Persona;
  code: string;
  /** The wallet already has a USDC account: the lower floor applies. */
  hasUsdcAccount: boolean;
  money: readonly MoneyRow[];
  points: readonly PointsRow[];
  /** «First $10 back» for this wallet's own trades: not started (no trade yet), running from the first trade, or done. What came back is the sum of its rows. */
  firstTen: Readonly<{ state: "open" | "active" | "done"; startedAt?: string }>;
  friends: readonly SampleFriend[];
  /** People who opened the link and have not connected a wallet. Only a count: nobody is named. */
  opened: number;
  tasks: readonly SampleTask[];
}>;

const RULES = REWARD_RULES_CURRENT.version;

/*
 * The active sample's story, every row under rules 2.1.0 (in force from 17.10, `REWARD_RULES_V2_1_NOT_BEFORE`):
 * connected and topped up on 18.10, first trade the same day; «First $10 back» filled on 01.11; claimed $5 on 29.10
 * from the $8 then available; since 01.11 cashback is 50 % and earns rank points. Its friend 8f3a… traded past their
 * own «First $10 back» on 30.10, so their trades pay 30 % for their first 90 days.
 */
const ACTIVE: Sample = {
  persona: "active",
  code: "K7M2QX",
  hasUsdcAccount: true,
  money: [
    { id: "m12", kind: "cashback", at: "2026-11-13T08:12:00.000Z", usdMicros: 240_000n, state: "pending", source: "NVDAx", shareBps: 5000, rules: RULES },
    { id: "m11", kind: "friend", at: "2026-11-11T16:40:00.000Z", usdMicros: 450_000n, state: "available", source: "8f3a…c21e", shareBps: 3000, rules: RULES },
    /* 2bd1…, whom 8f3a… invited, filled its own «First $10 back» within days: from then on level 2 pays. */
    { id: "m10", kind: "friend2", at: "2026-11-09T09:30:00.000Z", usdMicros: 50_000n, state: "available", source: "8f3a…c21e", shareBps: 500, rules: RULES },
    { id: "m9", kind: "cashback", at: "2026-11-08T14:22:00.000Z", usdMicros: 1_100_000n, state: "available", source: "BONK", shareBps: 5000, rules: RULES },
    { id: "m8", kind: "cashback", at: "2026-11-04T11:05:00.000Z", usdMicros: 800_000n, state: "available", source: "WIF", shareBps: 5000, rules: RULES },
    { id: "m7", kind: "friend", at: "2026-11-03T19:02:00.000Z", usdMicros: 300_000n, state: "available", source: "8f3a…c21e", shareBps: 3000, rules: RULES },
    { id: "m6", kind: "firstTen", at: "2026-11-01T13:48:00.000Z", usdMicros: 2_000_000n, state: "available", source: "WIF", shareBps: 10_000, rules: RULES },
    { id: "m5", kind: "claim", at: "2026-10-29T10:15:00.000Z", usdMicros: -5_000_000n, state: "paid", rules: RULES },
    { id: "m4", kind: "firstTen", at: "2026-10-27T10:30:00.000Z", usdMicros: 3_000_000n, state: "available", source: "BONK", shareBps: 10_000, rules: RULES },
    { id: "m3", kind: "firstTen", at: "2026-10-22T15:10:00.000Z", usdMicros: 3_000_000n, state: "paid", source: "JUP", shareBps: 10_000, rules: RULES },
    { id: "m2", kind: "firstTen", at: "2026-10-18T18:30:00.000Z", usdMicros: 2_000_000n, state: "paid", source: "SOL", shareBps: 10_000, rules: RULES },
  ],
  points: [
    { id: "p6", kind: "friends", at: "2026-11-11T16:40:00.000Z", points: 1 },
    { id: "p5", kind: "trades", at: "2026-11-08T14:22:00.000Z", points: 2 },
    { id: "p4", kind: "trades", at: "2026-11-04T11:05:00.000Z", points: 1 },
    { id: "p3", kind: "friends", at: "2026-11-03T19:02:00.000Z", points: 1 },
    { id: "p2", kind: "task", at: "2026-10-18T18:05:00.000Z", points: TASK_POINTS.topUp, task: "topUp" },
    { id: "p1", kind: "task", at: "2026-10-18T18:00:00.000Z", points: TASK_POINTS.firstStep, task: "firstStep" },
  ],
  firstTen: { state: "done", startedAt: "2026-10-18T18:30:00.000Z" },
  friends: [
    { face: 0x8f3ac21e, wallet: "8f3a…c21e", stage: "active", firstTradeAt: "2026-10-21T12:00:00.000Z", earnedUsdMicros: 750_000n },
    { face: 0xc4e901bb, wallet: "c4e9…01bb", stage: "holding", heldDays: 5, firstTradeAt: "2026-11-09T12:00:00.000Z", inFirstTen: true, earnedUsdMicros: 0n },
    { face: 0x5a77e9d2, wallet: "5a77…e9d2", stage: "joined", earnedUsdMicros: 0n },
    { face: 0x91f04c3a, wallet: "91f0…4c3a", stage: "review", firstTradeAt: "2026-11-12T12:00:00.000Z", inFirstTen: true, earnedUsdMicros: 0n },
  ],
  opened: 6,
  tasks: [
    task({ id: "lesson", kind: "learn", state: "available", href: "/academy" }),
    task({ id: "firstCompany", kind: "start", state: "holding", holdEndsAt: "2026-11-16T08:12:00.000Z", href: "/app/stocks" }),
    task({ id: "friend", kind: "community", state: "review", href: "/app/rewards/preview?tab=friends" }),
    task({ id: "twoCompanies", kind: "start", state: "locked", after: "firstCompany", href: "/app/stocks" }),
    task({ id: "autoinvest", kind: "habit", state: "locked", after: "twoCompanies", href: "/app/autoinvest" }),
    task({ id: "usefulWeek", kind: "habit", state: "locked", after: "autoinvest", badge: true, href: "/app/autoinvest" }),
    task({ id: "topUp", kind: "start", state: "done", doneAt: "2026-10-18T18:05:00.000Z", href: "/app/top-up" }),
    task({ id: "firstStep", kind: "start", state: "done", doneAt: "2026-10-18T18:00:00.000Z", href: "/app/connect" }),
  ],
};

const NEW: Sample = {
  persona: "new",
  code: "R4TV9P",
  hasUsdcAccount: false,
  money: [],
  points: [{ id: "p1", kind: "task", at: "2026-11-14T09:58:00.000Z", points: TASK_POINTS.firstStep, task: "firstStep" }],
  firstTen: { state: "open" },
  friends: [],
  opened: 0,
  tasks: [
    task({ id: "topUp", kind: "start", state: "available", href: "/app/top-up" }),
    task({ id: "firstCompany", kind: "start", state: "available", href: "/app/stocks" }),
    task({ id: "lesson", kind: "learn", state: "available", href: "/academy" }),
    task({ id: "friend", kind: "community", state: "available", href: "/app/rewards/preview?tab=friends&who=new" }),
    task({ id: "twoCompanies", kind: "start", state: "locked", after: "firstCompany", href: "/app/stocks" }),
    task({ id: "autoinvest", kind: "habit", state: "locked", after: "twoCompanies", href: "/app/autoinvest" }),
    task({ id: "usefulWeek", kind: "habit", state: "locked", after: "autoinvest", badge: true, href: "/app/autoinvest" }),
    task({ id: "firstStep", kind: "start", state: "done", doneAt: "2026-11-14T09:58:00.000Z", href: "/app/connect" }),
  ],
};

export function sample(persona: Persona): Sample {
  return persona === "new" ? NEW : ACTIVE;
}

/* --------------------------------------------------------------- derived */

export type MoneyTotals = Readonly<{ available: bigint; pending: bigint; paid: bigint; earned: bigint }>;

/** What the money card shows, summed from the rows — never a second number. */
export function moneyTotals(rows: readonly MoneyRow[]): MoneyTotals {
  let earned = 0n;
  let pending = 0n;
  let paid = 0n;
  for (const row of rows) {
    if (row.kind === "claim") paid += -row.usdMicros;
    else {
      earned += row.usdMicros;
      if (row.state === "pending") pending += row.usdMicros;
    }
  }
  return { available: earned - pending - paid, pending, paid, earned };
}

/** The floor of a claim for this wallet, from the rules in force. */
export function claimFloor(hasUsdcAccount: boolean): bigint {
  const floor = REWARD_RULES_CURRENT.claimFloor;
  if (!floor) return 1_000_000n;
  return hasUsdcAccount ? floor.withAccountUsdMicros : floor.withoutAccountUsdMicros;
}

export type RankView = Readonly<{
  rank: RewardRank;
  points: number;
  from: number;
  next: Readonly<{ rank: RewardRank; at: number; toGo: number }> | null;
  /** This rank's share of a friend's trade, percent. */
  share: number;
  nextShare: number | null;
  bySource: Readonly<Record<PointsKind, number>>;
}>;

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The rank of the last 30 days, the way `lib/rewards/rank.ts` reads it: a sum, never a stored figure. */
export function rankView(rows: readonly PointsRow[], now = SAMPLE_NOW): RankView {
  const since = Date.parse(now) - WINDOW_MS;
  const bySource: Record<PointsKind, number> = { task: 0, trades: 0, friends: 0 };
  for (const row of rows) if (Date.parse(row.at) > since) bySource[row.kind] += row.points;
  const points = bySource.task + bySource.trades + bySource.friends;
  const rank = rankForPoints(BigInt(points));
  const following = nextRank(rank);
  const shares = REWARD_RULES_CURRENT.referralL1BpsByRank;
  return {
    rank,
    points,
    from: Number(RANK_THRESHOLDS[rank]),
    next: following ? { rank: following, at: Number(RANK_THRESHOLDS[following]), toGo: Number(RANK_THRESHOLDS[following]) - points } : null,
    share: shares[rank] / 100,
    nextShare: following ? shares[following] / 100 : null,
    bySource,
  };
}

export type LadderStep = Readonly<{ rank: RewardRank; from: number; share: number; opens: "cashback" | "frame" | "launches" | "perps" | "presales"; live: boolean }>;

/**
 * The five ranks with what each opens. `live` is what the product
 * does today: early access to launches is Ріст v6-5, not built.
 */
export function ladder(): readonly LadderStep[] {
  const opens: Record<RewardRank, Pick<LadderStep, "opens" | "live">> = {
    BRONZE: { opens: "cashback", live: true },
    SILVER: { opens: "frame", live: true },
    GOLD: { opens: "launches", live: false },
    SAPPHIRE: { opens: "perps", live: false },
    DIAMOND: { opens: "presales", live: false },
  };
  return REWARD_RANKS.map((rank) => ({
    rank,
    from: Number(RANK_THRESHOLDS[rank]),
    share: REWARD_RULES_CURRENT.referralL1BpsByRank[rank] / 100,
    ...opens[rank],
  }));
}

/** The inviter's first-days share and its length, from the rules in force. */
export function inviterWindow(): Readonly<{ share: number; days: number }> {
  const window = REWARD_RULES_CURRENT.inviterWindow;
  return { share: (window?.bps ?? 0) / 100, days: window?.days ?? 0 };
}

export function firstTenRules(): Readonly<{ capUsdMicros: bigint; days: number; wallets: number }> {
  const rules = REWARD_RULES_CURRENT.firstTen;
  return { capUsdMicros: rules?.capUsdMicros ?? 0n, days: rules?.days ?? 0, wallets: rules?.walletsPerMonth ?? 0 };
}

/** Days left of a friend's inviter window. */
export function windowDaysLeft(firstTradeAt: string | undefined, now = SAMPLE_NOW): number | null {
  if (!firstTradeAt) return null;
  const { days } = inviterWindow();
  const rest = Date.parse(firstTradeAt) + days * 86_400_000 - Date.parse(now);
  return rest > 0 ? Math.max(1, Math.floor(rest / 86_400_000)) : null;
}

/** «First $10 back» as the overview draws it: what came back (the sum of its rows), the cap, the days left. */
export function firstTenView(data: Sample, now = SAMPLE_NOW): Readonly<{ state: Sample["firstTen"]["state"]; returned: bigint; cap: bigint; daysLeft: number | null }> {
  const { capUsdMicros, days } = firstTenRules();
  const returned = data.money.filter((row) => row.kind === "firstTen").reduce((sum, row) => sum + row.usdMicros, 0n);
  const startedAt = data.firstTen.startedAt;
  /* Whole days still to run; the last part-day reads as one. */
  const rest = startedAt ? Date.parse(startedAt) + days * 86_400_000 - Date.parse(now) : null;
  const left = rest === null ? null : rest <= 0 ? 0 : Math.max(1, Math.floor(rest / 86_400_000));
  const done = data.firstTen.state === "done" || returned >= capUsdMicros || (left !== null && left <= 0);
  return { state: done ? "done" : data.firstTen.state, returned, cap: capUsdMicros, daysLeft: done ? null : left };
}

/** Whole hours left of a hold. */
export function hoursLeft(until: string | undefined, now = SAMPLE_NOW): number {
  if (!until) return 0;
  const rest = Date.parse(until) - Date.parse(now);
  return rest > 0 ? Math.max(1, Math.floor(rest / 3_600_000)) : 0;
}

/** The task the overview offers next: the first one a person can act on, in the catalogue's order of value to them. */
export function nextTask(tasks: readonly SampleTask[]): SampleTask | null {
  return tasks.find((task) => task.state === "available") ?? null;
}
