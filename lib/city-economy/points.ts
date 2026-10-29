import type { PointsReason } from "../world/contract.ts";
import { POINTS } from "../world/catalog.ts";
import { weekStartOf } from "../growth/weeks.ts";
import { VAULTS } from "../vault/levels.ts";
import type { CityTrade, ClusterVerdict, TradeJudgement } from "./honest-count.ts";

/**
 * Points of the city: what pays, how much, how often, and what never pays.
 *
 * Points have no money value (`lib/rewards/rules.ts`, «Growth points carry no money value»). They open quarter levels,
 * slots and modules (`levels.ts`), and later the season's streets. So they are worth faking, and the rules are written
 * against the cheapest fakes (`docs/city/ECONOMY.md`, §6 and §10):
 *
 * - **Never for volume.** No rule reads an amount except to ask whether a trade is real activity at all (a dollar, the
 *   Growth line's floor) or a position is more than dust. Ten times the money is the same step.
 * - **Never for the number of launches.** Launching pays nothing. A coin's survival and its kept holders pay only for
 *   the first {@link COINS_PER_MONTH} coins its creator launched in that UTC month, so a hundred launches pay what three
 *   do.
 * - **Never for a paid entry.** A vault pays only when entering it was free (`FREE_VAULTS`); a paid vault, a stake or
 *   an entry fee pays no points, whatever happens inside (decision 72).
 * - **Never for a trade inside one wallet cluster.** Every rule that rests on a trade reads the city's honest count
 *   (`honest-count.ts`): only a trade judged `outside`, between two people, at least a dollar, counts; `inside` and
 *   «not known» count for nothing. Visits and shared builds ask the same question about two residents' wallets.
 *
 * Every award has a key, and the world pays a key once (`lib/world/award.ts`). The keys are also the ceilings: a rule
 * can make no more keys in its window than its cap, so a step reported twice, a job run again or a verdict that
 * changes later can never pay past the cap.
 *
 * Pure and client-safe: no clock, no store, no network. Whoever has the facts — the world, a job over the engine's
 * reads — asks a judge here and writes what it allows with `awardPoints` or the world's `award`.
 */

export const POINTS_RULES_VERSION = "city-points-1.0.0";

/** What can never be a reason for points, each refused by the rules below (`never.test.mjs`). */
export const NEVER_PAID = ["volume", "launch_count", "paid_entry", "cluster_trade"] as const;

/* ------------------------------------------------------------------------------------------------
 * The numbers
 * --------------------------------------------------------------------------------------------- */

/** Days after the launch on which a coin's survival is checked (Ryntra Launch, `lib/core/launch/survival-stats.ts`). */
export const SURVIVAL_DAYS = [7, 30, 90] as const;
export type SurvivalDay = (typeof SURVIVAL_DAYS)[number];

/**
 * A coin is alive for points when this many different wallets outside its creator's cluster bought it for real in the
 * week before the day — the Growth line's activation: three independent addresses (`lib/growth/protect.ts`).
 */
export const MIN_INDEPENDENT_BUYERS = 3;

/** The least trade that is activity: one dollar, the Growth line's floor (`PROTECT_RULES.activation`). */
export const MIN_TRADE_USD_MICROS = 1_000_000n;

/** Coins of one creator in one UTC month whose survival and holders can pay, the earliest launched first. */
export const COINS_PER_MONTH = 3;

/** Kept holders a coin pays for, each step once. */
export const HOLDER_STEPS = [10, 25, 50, 100, 250] as const;

/** A holder is kept after holding this many days since a counted buy. */
export const HOLD_DAYS = 30;

/** Pool positions of one owner that can pay, the earliest opened first. */
export const POSITIONS_COUNTED = 3;

/** The least a position holds in verified tokens, and the least its pool holds — the Growth line's badge floors (`lib/growth/liquidity.ts`). */
export const MIN_POSITION_USD_MICROS = 10_000_000n;
export const MIN_POOL_USD_MICROS = 10_000_000_000n;

/** Verified visitors one host's day can pay for, the earliest first. */
export const VISITORS_PER_DAY = 10;

/** The free vaults (CITY-47): three practice levels once ever, the daily vault once a day. Every other vault is paid. */
export const FREE_VAULTS = ["practice-1", "practice-2", "practice-3", "daily"] as const;
export type FreeVault = (typeof FREE_VAULTS)[number];

/**
 * Points for cracking a free vault — read from the vault's own levels (`lib/vault/levels.ts`), the prices the Vault
 * shows, never written twice. The reason's one price (`POINTS.vault_crack`, `STEP_RULES.vault_crack.points`) is the
 * daily vault's, the one that repeats; a test holds all of them equal.
 */
export const CRACK_POINTS: Readonly<Record<FreeVault, number>> = {
  "practice-1": VAULTS["practice-1"].points,
  "practice-2": VAULTS["practice-2"].points,
  "practice-3": VAULTS["practice-3"].points,
  daily: VAULTS.daily.points,
};

/* ------------------------------------------------------------------------------------------------
 * The rules as data
 * --------------------------------------------------------------------------------------------- */

export type CapWindow = "day" | "week" | "launch_month" | "ever";

export type StepRule = Readonly<{
  /** Points one award pays; a vault crack pays by its vault (`CRACK_POINTS`). */
  points: number;
  /** The real step. */
  step: string;
  /** Who reads the facts the judge asks for. */
  checkedBy: string;
  /** The award's key: one per what it names. */
  key: string;
  /** The most awards one resident can get in each window; the key space allows no more. */
  caps: readonly Readonly<{ max: number; per: CapWindow }>[];
  /** Rests on a trade, a visit or a shared build, so one wallet cluster counts for nothing. */
  honest: boolean;
  /** The server can check it today. A rule that is not live is never paid: its facts do not reach the world yet. */
  live: boolean;
}>;

export const STEP_RULES: Readonly<Record<PointsReason, StepRule>> = {
  task_done: {
    points: POINTS.task_done,
    step: "a task of the day done: a floor, a light, three visits (`day.ts`)",
    checkedBy: "world — the build and the visit that did it",
    key: "task_done:<day>:<task>",
    caps: [{ max: 3, per: "day" }],
    honest: false,
    live: true,
  },
  survival_7: survival(7),
  survival_30: survival(30),
  survival_90: survival(90),
  holders_kept: {
    points: POINTS.holders_kept,
    step: `holders of your coin who bought outside your cluster and still hold ${HOLD_DAYS} days later: ${HOLDER_STEPS.join(" · ")}`,
    checkedBy: "chain — holders; honest count — their buys",
    key: "holders_kept:<mint>:<step>",
    caps: [{ max: COINS_PER_MONTH * HOLDER_STEPS.length, per: "launch_month" }],
    honest: true,
    live: false,
  },
  lp_in_range_days: {
    points: POINTS.lp_in_range_days,
    step: "a pool position in range all seven days of a week, earning fees from trades outside your cluster",
    checkedBy: "chain — the position and the pool; honest count — the pool's trades",
    key: "lp_in_range_days:<position>:<week>",
    caps: [{ max: POSITIONS_COUNTED, per: "week" }],
    honest: true,
    live: false,
  },
  visitors_verified: {
    points: POINTS.visitors_verified,
    step: "a visitor signed in with a wallet outside your cluster; each visitor once a week",
    checkedBy: "world — visits; Growth — the two wallets",
    key: "visitors_verified:<week>:<visitor>",
    caps: [{ max: VISITORS_PER_DAY, per: "day" }],
    honest: true,
    live: false,
  },
  coop_contribution: {
    points: POINTS.coop_contribution,
    step: "a build on your crew's shared headquarters, with a crew member outside your cluster",
    checkedBy: "world — the build and the crew (CITY-20); Growth — the wallets",
    key: "coop_contribution:<day>",
    caps: [{ max: 1, per: "day" }],
    honest: true,
    live: false,
  },
  war_participation: {
    points: POINTS.war_participation,
    step: "a week of the district war taken part in — actions, never purchases",
    checkedBy: "world — the war's own actions",
    key: "war_participation:<week>",
    caps: [{ max: 1, per: "week" }],
    honest: false,
    live: false,
  },
  vault_crack: {
    points: POINTS.vault_crack,
    step: `a free vault cracked: practice ${CRACK_POINTS["practice-1"]} · ${CRACK_POINTS["practice-2"]} · ${CRACK_POINTS["practice-3"]} once ever, the daily vault ${CRACK_POINTS.daily} once a day; a paid vault — never`,
    checkedBy: "vault — its own phrase detector (`lib/vault/engine.ts`)",
    key: "vault:<practice>:once · vault:daily:<day>",
    caps: [{ max: 3, per: "ever" }, { max: 1, per: "day" }],
    honest: false,
    live: true,
  },
};

function survival(day: SurvivalDay): StepRule {
  return {
    points: POINTS[`survival_${day}` as const],
    step: `your coin alive on day ${day}: ${MIN_INDEPENDENT_BUYERS} different buyers outside your cluster in the week before it`,
    checkedBy: "engine — the day's check; honest count — the buys",
    key: `survival_${day}:<mint>`,
    caps: [{ max: COINS_PER_MONTH, per: "launch_month" }],
    honest: true,
    live: false,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Verdicts
 * --------------------------------------------------------------------------------------------- */

/** What the world writes: the reason, the points, what it was for and the key that makes it pay once. */
export type Award = Readonly<{ reason: PointsReason; points: number; sourceRef: string; key: string }>;

/** Why nothing is paid, the first that applies. */
export const NOT_PAID = [
  "malformed", "not_a_step", "paid_entry", "not_alive", "not_yet", "over_cap", "cluster", "unverified",
  "too_few_buyers", "too_few_holders", "out_of_range", "too_small", "no_fees", "no_visitors", "alone",
] as const;
export type NotPaid = (typeof NOT_PAID)[number];

export type StepVerdict = Readonly<{ paid: true; award: Award }> | Readonly<{ paid: false; why: NotPaid }>;

/** A judge that may pay several awards: every award it allows, and why the rest were not paid (null — nothing held back). */
export type StepAwards = Readonly<{ awards: readonly Award[]; why: NotPaid | null }>;

const refused = (why: NotPaid): Readonly<{ paid: false; why: NotPaid }> => ({ paid: false, why });
const none = (why: NotPaid): StepAwards => ({ awards: [], why });

function award(reason: PointsReason, sourceRef: string, key: string, points: number = POINTS[reason]): Award {
  return { reason, points, sourceRef, key };
}

/* ------------------------------------------------------------------------------------------------
 * Reading facts
 * --------------------------------------------------------------------------------------------- */

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const isAddress = (value: unknown): value is string => typeof value === "string" && SOLANA_ADDRESS.test(value);
const isMoment = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
const isRef = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 64;
const dayOfMoment = (iso: string) => new Date(Date.parse(iso)).toISOString().slice(0, 10);
const monthOf = (iso: string) => dayOfMoment(iso).slice(0, 7);

/** A trade and the honest count's judgement of it, with the wallet the trade had to be checked against. */
export type JudgedTrade = Readonly<{ trade: CityTrade; judgement: TradeJudgement }>;

/** The judgement is of this trade, it names `party` and it counts for points — outside one cluster, a dollar or more. */
function countsFor(item: JudgedTrade | null | undefined, party: string): boolean {
  if (!item || typeof item !== "object" || !item.trade || !item.judgement) return false;
  const { trade, judgement } = item;
  if (judgement.tx !== trade.tx || judgement.cluster !== "outside") return false;
  if (![trade.creator, trade.host, trade.friend].includes(party)) return false;
  if (typeof trade.usdMicros !== "bigint" || trade.usdMicros < MIN_TRADE_USD_MICROS) return false;
  return judgement.counts?.points?.counted === true;
}

/** Why the trades that did not count did not: one inside a cluster, else one not known, else simply too few. */
function shortOf(items: readonly JudgedTrade[], fallback: NotPaid): NotPaid {
  if (items.some((i) => i?.judgement?.cluster === "inside")) return "cluster";
  if (items.some((i) => i?.judgement?.cluster === "unknown")) return "unverified";
  return fallback;
}

export type Launch = Readonly<{ mint: string; launchedAt: string }>;

/**
 * Whether a coin is among the first {@link COINS_PER_MONTH} its creator launched in its UTC month. The launches are
 * facts of the chain, so the answer for a coin never changes, however many launches follow.
 */
function earlyInMonth(mint: string, launchedAt: string, monthLaunches: readonly Launch[]): boolean | null {
  if (!Array.isArray(monthLaunches) || !monthLaunches.every((l) => isAddress(l?.mint) && isMoment(l?.launchedAt))) return null;
  const month = monthOf(launchedAt);
  const same = [...new Map(monthLaunches.filter((l) => monthOf(l.launchedAt) === month).map((l) => [l.mint, l])).values()];
  if (!same.some((l) => l.mint === mint && Date.parse(l.launchedAt) === Date.parse(launchedAt))) return null;
  same.sort((a, b) => Date.parse(a.launchedAt) - Date.parse(b.launchedAt) || (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0));
  return same.findIndex((l) => l.mint === mint) < COINS_PER_MONTH;
}

/* ------------------------------------------------------------------------------------------------
 * Survival of a coin: day 7, 30, 90
 * --------------------------------------------------------------------------------------------- */

export type SurvivalFacts = Readonly<{
  mint: string;
  /** The creator's wallet: the points go to the resident behind it. */
  creator: string;
  launchedAt: string;
  day: SurvivalDay;
  /** The engine's check of the day passed (`lib/core/launch/survival-stats.ts`). */
  alive: boolean;
  /** Every coin the creator launched in the same UTC month, this one included. */
  monthLaunches: readonly Launch[];
  /** Buys of the coin in the week before the day, each judged by the honest count with the creator named. */
  buys: readonly JudgedTrade[];
}>;

/**
 * A coin alive on its day pays its creator once — when the engine's check passed and {@link MIN_INDEPENDENT_BUYERS}
 * different wallets outside the creator's cluster bought it for real in the week before. One buy from a second wallet
 * of the creator passes the engine's check (`ECONOMY.md` §9, finding 2); it passes nothing here.
 */
export function judgeSurvival(facts: SurvivalFacts): StepVerdict {
  if (!facts || !isAddress(facts.mint) || !isAddress(facts.creator) || !isMoment(facts.launchedAt)) return refused("malformed");
  if (!(SURVIVAL_DAYS as readonly number[]).includes(facts.day) || !Array.isArray(facts.buys)) return refused("malformed");
  if (facts.alive !== true) return refused("not_alive");
  const early = earlyInMonth(facts.mint, facts.launchedAt, facts.monthLaunches);
  if (early === null) return refused("malformed");
  if (!early) return refused("over_cap");
  const until = Date.parse(facts.launchedAt) + facts.day * DAY_MS;
  const from = until - 7 * DAY_MS;
  const inWeek = facts.buys.filter((b) => b?.trade?.mint === facts.mint && isMoment(b.trade.at) && Date.parse(b.trade.at) >= from && Date.parse(b.trade.at) < until);
  const buyers = new Set(inWeek.filter((b) => b.trade.creator === facts.creator && countsFor(b, facts.creator)).map((b) => b.trade.buyer));
  if (buyers.size < MIN_INDEPENDENT_BUYERS) return refused(shortOf(inWeek, "too_few_buyers"));
  const reason = `survival_${facts.day}` as const;
  return { paid: true, award: award(reason, facts.mint, `${reason}:${facts.mint}`) };
}

/* ------------------------------------------------------------------------------------------------
 * Holders who stay
 * --------------------------------------------------------------------------------------------- */

export type HolderFacts = Readonly<{
  mint: string;
  creator: string;
  launchedAt: string;
  monthLaunches: readonly Launch[];
  /** When the holders were read from the chain. */
  at: string;
  /** Every wallet holding the coin, with its first buy as the honest count judged it. */
  holders: readonly Readonly<{ wallet: string; holdsNow: boolean; firstBuy: JudgedTrade | null }>[];
}>;

/**
 * Holders who stay: a wallet outside the creator's cluster that bought for real and still holds {@link HOLD_DAYS}
 * days later. Each step of {@link HOLDER_STEPS} pays once per coin.
 */
export function judgeHoldersKept(facts: HolderFacts): StepAwards {
  if (!facts || !isAddress(facts.mint) || !isAddress(facts.creator) || !isMoment(facts.launchedAt) || !isMoment(facts.at) || !Array.isArray(facts.holders)) return none("malformed");
  const early = earlyInMonth(facts.mint, facts.launchedAt, facts.monthLaunches);
  if (early === null) return none("malformed");
  if (!early) return none("over_cap");
  const read = Date.parse(facts.at);
  const kept = new Set<string>();
  const buys: JudgedTrade[] = [];
  for (const h of facts.holders) {
    if (!h || !isAddress(h.wallet) || h.holdsNow !== true || !h.firstBuy) continue;
    buys.push(h.firstBuy);
    const { trade } = h.firstBuy;
    if (trade?.buyer !== h.wallet || trade.mint !== facts.mint || trade.creator !== facts.creator || !isMoment(trade.at)) continue;
    if (read - Date.parse(trade.at) < HOLD_DAYS * DAY_MS) continue;
    if (countsFor(h.firstBuy, facts.creator)) kept.add(h.wallet);
  }
  const awards = HOLDER_STEPS.filter((step) => kept.size >= step).map((step) => award("holders_kept", facts.mint, `holders_kept:${facts.mint}:${step}`));
  return { awards, why: awards.length === HOLDER_STEPS.length ? null : shortOf(buys, "too_few_holders") };
}

/* ------------------------------------------------------------------------------------------------
 * A pool position in range
 * --------------------------------------------------------------------------------------------- */

export type PoolDay = Readonly<{
  /** The UTC day, YYYY-MM-DD. */
  day: string;
  /** In range every time the day was read. */
  inRange: boolean;
  /** What the owner may withdraw now, in verified tokens; null — no price. */
  valueUsdMicros: bigint | null;
  /** What the pool holds in verified tokens; null — no price. */
  poolUsdMicros: bigint | null;
  /** Fees the position earned that day; null — not read. */
  feesUsdMicros: bigint | null;
  /** The pool's trades that day, each judged by the honest count with the owner named. */
  trades: readonly JudgedTrade[];
}>;

export type PoolWeekFacts = Readonly<{
  position: string;
  /** The owner's wallet. */
  owner: string;
  openedAt: string;
  /** Every position the owner holds open, this one included. */
  ownerPositions: readonly Readonly<{ position: string; openedAt: string }>[];
  /** The week's Monday 00:00 UTC (`lib/growth/weeks.ts`). */
  week: string;
  days: readonly PoolDay[];
}>;

/**
 * A week in range pays once per position: every one of its seven days in range, more than dust in a live pool, and
 * fees from at least one real trade outside the owner's cluster — the days alone pay nothing (`ECONOMY.md` §4: ten
 * dollars in a wide range of a big pool are «in range» every day). Only the owner's first {@link POSITIONS_COUNTED}
 * positions count, so splitting money into many positions pays what three do.
 */
export function judgePoolWeek(facts: PoolWeekFacts): StepVerdict {
  if (!facts || !isAddress(facts.position) || !isAddress(facts.owner) || !isMoment(facts.openedAt) || !isMoment(facts.week)) return refused("malformed");
  if (weekStartOf(facts.week) !== new Date(Date.parse(facts.week)).toISOString() || !Array.isArray(facts.days) || !Array.isArray(facts.ownerPositions)) return refused("malformed");
  const positions = [...new Map(facts.ownerPositions.filter((p) => isAddress(p?.position) && isMoment(p?.openedAt)).map((p) => [p.position, p])).values()];
  if (!positions.some((p) => p.position === facts.position)) return refused("malformed");
  positions.sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt) || (a.position < b.position ? -1 : 1));
  if (positions.findIndex((p) => p.position === facts.position) >= POSITIONS_COUNTED) return refused("over_cap");
  const start = Date.parse(facts.week);
  if (Date.parse(facts.openedAt) > start) return refused("not_yet");
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
    const d = facts.days.find((x) => x?.day === day);
    if (!d) return refused("not_yet");
    if (d.inRange !== true) return refused("out_of_range");
    if (typeof d.valueUsdMicros !== "bigint" || d.valueUsdMicros < MIN_POSITION_USD_MICROS) return refused("too_small");
    if (typeof d.poolUsdMicros !== "bigint" || d.poolUsdMicros < MIN_POOL_USD_MICROS) return refused("too_small");
    if (typeof d.feesUsdMicros !== "bigint" || d.feesUsdMicros <= 0n) return refused("no_fees");
    const listed: readonly JudgedTrade[] = Array.isArray(d.trades) ? d.trades : [];
    const trades = listed.filter((t) => isMoment(t?.trade?.at) && dayOfMoment(t.trade.at) === day);
    if (!trades.some((t) => countsFor(t, facts.owner))) return refused(shortOf(trades, "no_fees"));
  }
  const week = facts.week.slice(0, 10);
  return { paid: true, award: award("lp_in_range_days", facts.position, `lp_in_range_days:${facts.position}:${week}`) };
}

/* ------------------------------------------------------------------------------------------------
 * Verified visitors
 * --------------------------------------------------------------------------------------------- */

export type VisitFact = Readonly<{
  visitorId: string;
  /** The UTC day of the visit, as the world keeps it. */
  day: string;
  at: string;
  /** Signed in with a wallet (`world_visits.verified_human`); a guest is not. */
  verifiedHuman: boolean;
  /** The Growth line's answer about the visitor's wallet and the host's. */
  cluster: ClusterVerdict;
}>;

export type VisitorsFacts = Readonly<{ hostId: string; week: string; visits: readonly VisitFact[] }>;

/**
 * A host's verified visitors of one week. Each day the earliest {@link VISITORS_PER_DAY} signed-in visitors not known
 * to be the host's own cluster take a place, one place per visitor a day; a place pays when the visitor is known to be
 * another person, and each visitor pays the host once a week. The key is the visitor and the week, so however the
 * answers change later and the places move, one visitor never pays the host twice in a week.
 */
export function judgeVisitors(facts: VisitorsFacts): StepAwards {
  if (!facts || !isRef(facts.hostId) || !isMoment(facts.week) || weekStartOf(facts.week) !== new Date(Date.parse(facts.week)).toISOString() || !Array.isArray(facts.visits)) {
    return none("malformed");
  }
  const start = Date.parse(facts.week);
  const week = facts.week.slice(0, 10);
  const paidThisWeek = new Set<string>();
  const awards: Award[] = [];
  let unverified = false;
  let inside = false;
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
    const first = new Map<string, VisitFact>();
    for (const v of facts.visits) {
      if (!v || v.day !== day || !isRef(v.visitorId) || v.visitorId === facts.hostId || !isMoment(v.at) || v.verifiedHuman !== true) continue;
      if (v.cluster?.verdict === "same") {
        inside = true;
        continue;
      }
      const held = first.get(v.visitorId);
      if (!held || Date.parse(v.at) < Date.parse(held.at)) first.set(v.visitorId, v);
    }
    const places = [...first.values()]
      .filter((v) => !paidThisWeek.has(v.visitorId))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.visitorId < b.visitorId ? -1 : 1))
      .slice(0, VISITORS_PER_DAY);
    places.forEach((v) => {
      if (v.cluster?.verdict !== "separate") {
        unverified = true;
        return;
      }
      paidThisWeek.add(v.visitorId);
      awards.push(award("visitors_verified", v.visitorId, `visitors_verified:${week}:${v.visitorId}`));
    });
  }
  return { awards, why: unverified ? "unverified" : inside ? "cluster" : awards.length ? null : "no_visitors" };
}

/* ------------------------------------------------------------------------------------------------
 * Building together, the district war
 * --------------------------------------------------------------------------------------------- */

export type CoopFacts = Readonly<{
  /** The UTC day of the build. */
  day: string;
  /** The world saw the build on the crew's shared headquarters. */
  built: boolean;
  /** The crew's other members, each with the Growth line's answer about their wallet and the builder's. */
  others: readonly Readonly<{ residentId: string; cluster: ClusterVerdict }>[];
}>;

/** A build on the crew's shared headquarters pays once a day — when someone in the crew is known to be another person. */
export function judgeCoop(facts: CoopFacts): StepVerdict {
  if (!facts || !isDay(facts.day) || !Array.isArray(facts.others)) return refused("malformed");
  if (facts.built !== true) return refused("not_yet");
  if (!facts.others.some((o) => o?.cluster?.verdict === "separate")) {
    return refused(facts.others.some((o) => o?.cluster?.verdict === "unknown") ? "unverified" : facts.others.length ? "cluster" : "alone");
  }
  return { paid: true, award: award("coop_contribution", facts.day, `coop_contribution:${facts.day}`) };
}

/** A week of the district war pays once when the resident acted in it; the war counts actions, never purchases. */
export function judgeWar(facts: Readonly<{ week: string; actions: number }>): StepVerdict {
  if (!facts || !isMoment(facts.week) || weekStartOf(facts.week) !== new Date(Date.parse(facts.week)).toISOString()) return refused("malformed");
  if (!Number.isInteger(facts.actions) || facts.actions < 1) return refused("not_yet");
  const week = facts.week.slice(0, 10);
  return { paid: true, award: award("war_participation", week, `war_participation:${week}`) };
}

/* ------------------------------------------------------------------------------------------------
 * Steps that happen in a request: a vault cracked
 * --------------------------------------------------------------------------------------------- */

/** A crack as the vault reports it (`lib/vault/world.ts`); anything else the report carries is not read. */
export type VaultCrack = Readonly<{ kind: "vault_crack"; vault: string; paid?: boolean }>;

/** The steps the world's `award` takes from the part of the server where they happened. */
export type RequestStep = VaultCrack;

/**
 * A crack pays when the vault was free: a practice level once ever, the daily vault once on the world's day. The
 * points and the key come from here — never from the report. A paid vault, or a report that says it was paid,
 * pays nothing (decision 72).
 */
export function judgeVaultCrack(step: unknown, day: string): StepVerdict {
  if (!step || typeof step !== "object" || !isDay(day)) return refused("malformed");
  const s = step as { kind?: unknown; vault?: unknown; paid?: unknown };
  if (s.kind !== "vault_crack" || typeof s.vault !== "string") return refused("malformed");
  if (s.paid === true || !(FREE_VAULTS as readonly string[]).includes(s.vault)) return refused("paid_entry");
  const vault = s.vault as FreeVault;
  const key = vault === "daily" ? `vault:daily:${day}` : `vault:${vault}:once`;
  return { paid: true, award: award("vault_crack", vault, key, CRACK_POINTS[vault]) };
}

/** Judge a step reported in a request; the world's day is the world's clock, not the report's. */
export function judgeStep(step: unknown, day: string): StepVerdict {
  const kind = step && typeof step === "object" ? (step as { kind?: unknown }).kind : undefined;
  if (kind === "vault_crack") return judgeVaultCrack(step, day);
  return refused("not_a_step");
}
