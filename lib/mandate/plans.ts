/**
 * CITY-193 — the agent's tested strategies: what it buys and when, inside the very mandate the person
 * signed. Pure, one source for all three places that use them: the agent at work (`./strategy.ts`, `./tick.server.ts`),
 * the run on history (`./backtest.ts`) and the practice without money (`./backtest.ts` `paperRun`). The same rules, the
 * same numbers: what the history shows is what the agent would have done.
 *
 * - `steady` — regular buys: the day's budget in equal buys of the trade cap across the day (CITY-175).
 * - `dip` — a buy only when the price is at least `dropBps` under its high of the last day.
 * - `grid` — levels `stepBps` apart under the price it started at; one buy at each level the price comes down to. A level
 *   bought is held; where the engine can sell, the coins of a level are offered for sale one step up.
 * - `early` — one new launch the agent picks itself through the city's risk filter (`earlyPick`), bought on the steady
 *   rhythm while the launch is young (`maxAgeH`).
 * - an exit on any of them — `takeBps` («фіксуй +20 %»): the agent stops buying once what it bought is worth that much
 *   more than it paid; `stopBps`: it stops once it is worth that much less. Where the engine can sell, the stop or the take
 *   is offered as a sale; on mainnet the agent does not sell yet (CITY-195) — it stops buying and holds.
 *
 * What a strategy never changes: the amount of a buy (the trade cap), the day's cap, the rhythm's spacing (no strategy
 * buys more often than the steady one), the venues, the end of the mandate and the agent's own autostop (`AUTOSTOP`,
 * `./strategy.ts`) — a stop looser than the autostop is the autostop. A strategy only decides whether a buy that the
 * mandate allows is made now. No language model is asked at the moment of a trade: these rules are the whole decision.
 */

export const PLAN_IDS = ["steady", "dip", "grid", "early"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanExit = Readonly<{ takeBps: number | null; stopBps: number | null }>;

/**
 * CITY-197 — the plan's pace: at most this many buys a day, however many the day's cap would allow. A ceiling under the
 * rhythm, never over it: a slower agent trades less, pays fewer fees and makes the budget last. Absent — the rhythm of
 * the mandate's caps, as before.
 */
type Paced = Readonly<{ pace?: number }>;

export type StrategyPlan =
  | (Readonly<{ id: "steady"; exit: PlanExit | null }> & Paced)
  | (Readonly<{ id: "dip"; dropBps: number; exit: PlanExit | null }> & Paced)
  | (Readonly<{ id: "grid"; stepBps: number; levels: number; exit: PlanExit | null }> & Paced)
  | (Readonly<{ id: "early"; maxAgeH: number; exit: PlanExit | null }> & Paced);

/** Every bound of the strategies, in one place: a plan outside them is not read. */
export const PLAN_BOUNDS = Object.freeze({
  dropBps: { min: 300, max: 5_000, default: 800 },
  stepBps: { min: 200, max: 2_000, default: 500 },
  levels: { min: 2, max: 10, default: 5 },
  maxAgeH: { min: 1, max: 72, default: 24 },
  takeBps: { min: 300, max: 50_000 },
  /** The person's stop may be tighter than the autostop's 15 %, never looser: a looser one is the autostop. */
  stopBps: { min: 300, max: 1_500 },
  /** CITY-197: buys a day at most. */
  pace: { min: 1, max: 24 },
});

/**
 * CITY-197 — the pace a new agent starts at in the city: regular buys once a day; a strategy that waits for its moment —
 * a dip, a grid's level, a young launch — at most twice. The default strategies trade little: the fees stay small and the
 * budget lasts. The caps the person signs do not change; the pace only spaces the buys inside them.
 */
export const CALM_PACE: Readonly<Record<PlanId, number>> = Object.freeze({ steady: 1, dip: 2, grid: 2, early: 2 });

/** The plan at the city's calm pace, unless it names its own. */
export const calmPlan = (plan: StrategyPlan): StrategyPlan => (plan.pace === undefined ? { ...plan, pace: CALM_PACE[plan.id] } : plan);

/** The day the dip's high is measured over. */
export const DIP_WINDOW_MS = 86_400_000;

const within = (value: number, bound: Readonly<{ min: number; max: number }>) => Number.isInteger(value) && value >= bound.min && value <= bound.max;

export const STEADY: StrategyPlan = Object.freeze({ id: "steady", exit: null });

/* ---------------------------------------------------------------- the plan as text */

/**
 * The plan in a few characters, the one form the city, the routes and the agent's book share: `steady`, `dip:800`,
 * `grid:500:5`, `early:24`, with an exit after a comma — `dip:800,take:2000,stop:1000`.
 */
export function planText(plan: StrategyPlan): string {
  const head = plan.id === "dip" ? `dip:${plan.dropBps}` : plan.id === "grid" ? `grid:${plan.stepBps}:${plan.levels}` : plan.id === "early" ? `early:${plan.maxAgeH}` : "steady";
  const exit = plan.exit;
  return [head, exit?.takeBps ? `take:${exit.takeBps}` : null, exit?.stopBps ? `stop:${exit.stopBps}` : null, plan.pace !== undefined ? `pace:${plan.pace}` : null].filter(Boolean).join(",");
}

const INT = /^\d{1,6}$/u;

/** A plan from its text; null when any part is not one of the strategies' or lies outside their bounds. */
export function planFrom(text: unknown): StrategyPlan | null {
  if (typeof text !== "string" || text.length === 0 || text.length > 80) return null;
  const [head, ...rest] = text.split(",");
  const parts = head!.split(":");
  let takeBps: number | null = null;
  let stopBps: number | null = null;
  let pace: number | null = null;
  for (const part of rest) {
    const [name, value, ...more] = part.split(":");
    if (more.length || !value || !INT.test(value)) return null;
    const n = Number(value);
    if (name === "take" && takeBps === null && pace === null && within(n, PLAN_BOUNDS.takeBps)) takeBps = n;
    else if (name === "stop" && stopBps === null && pace === null && within(n, PLAN_BOUNDS.stopBps)) stopBps = n;
    else if (name === "pace" && pace === null && within(n, PLAN_BOUNDS.pace)) pace = n;
    else return null;
  }
  const exit = takeBps === null && stopBps === null ? null : { takeBps, stopBps };
  const head0 = planHead(parts, exit);
  return head0 && pace !== null ? { ...head0, pace } : head0;
}

/** The plan's head — its strategy and numbers — with its exit; null outside the strategies' bounds. */
function planHead(parts: readonly string[], exit: PlanExit | null): StrategyPlan | null {
  const ints = parts.slice(1);
  if (!ints.every((part) => INT.test(part))) return null;
  const [a, b] = ints.map(Number);
  switch (parts[0]) {
    case "steady":
      return ints.length === 0 ? { id: "steady", exit } : null;
    case "dip":
      return ints.length === 1 && within(a!, PLAN_BOUNDS.dropBps) ? { id: "dip", dropBps: a!, exit } : null;
    case "grid":
      return ints.length === 2 && within(a!, PLAN_BOUNDS.stepBps) && within(b!, PLAN_BOUNDS.levels) ? { id: "grid", stepBps: a!, levels: b!, exit } : null;
    case "early":
      return ints.length === 1 && within(a!, PLAN_BOUNDS.maxAgeH) ? { id: "early", maxAgeH: a!, exit } : null;
    default:
      return null;
  }
}

/** A plan with its numbers drawn into bounds: what the reader of a sentence builds. Never outside `PLAN_BOUNDS`. */
export function boundedPlan(input: Readonly<{ id: PlanId; dropBps?: number | null; stepBps?: number | null; levels?: number | null; maxAgeH?: number | null; takeBps?: number | null; stopBps?: number | null; pace?: number | null }>): StrategyPlan {
  const plan = boundedHead(input);
  const pace = input.pace === null || input.pace === undefined || !Number.isFinite(input.pace) ? null : Math.min(PLAN_BOUNDS.pace.max, Math.max(PLAN_BOUNDS.pace.min, Math.round(input.pace)));
  return pace === null ? plan : { ...plan, pace };
}

function boundedHead(input: Readonly<{ id: PlanId; dropBps?: number | null; stepBps?: number | null; levels?: number | null; maxAgeH?: number | null; takeBps?: number | null; stopBps?: number | null }>): StrategyPlan {
  const clamp = (value: number | null | undefined, bound: Readonly<{ min: number; max: number; default?: number }>) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return bound.default ?? null;
    return Math.min(bound.max, Math.max(bound.min, Math.round(value)));
  };
  const takeBps = input.takeBps ? clamp(input.takeBps, PLAN_BOUNDS.takeBps) : null;
  const stopBps = input.stopBps ? clamp(input.stopBps, PLAN_BOUNDS.stopBps) : null;
  const exit = takeBps === null && stopBps === null ? null : { takeBps, stopBps };
  switch (input.id) {
    case "dip":
      return { id: "dip", dropBps: clamp(input.dropBps, PLAN_BOUNDS.dropBps)!, exit };
    case "grid":
      return { id: "grid", stepBps: clamp(input.stepBps, PLAN_BOUNDS.stepBps)!, levels: clamp(input.levels, PLAN_BOUNDS.levels)!, exit };
    case "early":
      return { id: "early", maxAgeH: clamp(input.maxAgeH, PLAN_BOUNDS.maxAgeH)!, exit };
    default:
      return { id: "steady", exit };
  }
}

/* ---------------------------------------------------------------- the rule at the moment of a buy */

/** One price the agent saw, in whatever unit the reader gives — the rules only compare prices with each other. */
export type Mark = Readonly<{ at: number; price: number }>;

/** What the agent holds of its buys at the price now: what it paid and what that is worth, the budget's base units. */
export type Position = Readonly<{ spent: bigint; worth: bigint | null }>;

export type RuleInput = Readonly<{
  plan: StrategyPlan;
  now: number;
  /** The prices the agent saw, oldest first; the newest is the price now. */
  marks: readonly Mark[];
  /** Where the grid started: the first price it saw. Null before it saw one. */
  anchor: number | null;
  /** The grid's levels the agent bought and still holds. */
  held: readonly number[];
  position: Position;
  /** Early: when the launch was born, ms; null when not known. */
  bornAt: number | null;
}>;

export type HoldReason = "unread" | "no-dip" | "no-level" | "too-old" | "no-coin";
export type ExitReason = "take" | "stop";

export type Rule =
  | Readonly<{ do: "buy"; level?: number }>
  | Readonly<{ do: "hold"; why: HoldReason }>
  | Readonly<{ do: "exit"; why: ExitReason }>;

/** The exit that stands now, from what was bought and what it is worth; null — none, or not read. */
export function exitOf(exit: PlanExit | null, position: Position): ExitReason | null {
  if (!exit || position.spent <= 0n || position.worth === null) return null;
  const change = Number(((position.worth - position.spent) * 10_000n) / position.spent);
  if (exit.takeBps !== null && change >= exit.takeBps) return "take";
  if (exit.stopBps !== null && change <= -exit.stopBps) return "stop";
  return null;
}

/** The grid's level `k` under its anchor: `anchor × (1 − step)^k`. */
export const gridLevel = (anchor: number, stepBps: number, k: number) => anchor * (1 - stepBps / 10_000) ** k;

/** The highest price of the last day the agent saw; null with no price. */
export function dayHigh(marks: readonly Mark[], now: number): number | null {
  let high: number | null = null;
  for (const mark of marks) if (now - mark.at <= DIP_WINDOW_MS && (high === null || mark.price > high)) high = mark.price;
  return high;
}

/**
 * Whether a buy the mandate allows now is made, by the plan's rule. Asked after the caps and the rhythm said a buy is
 * due, and only then: a strategy can hold a buy back, never add one. The exit is asked first.
 */
export function ruleOf(input: RuleInput): Rule {
  const { plan, now } = input;
  const exit = exitOf(plan.exit, input.position);
  if (exit) return { do: "exit", why: exit };
  if (plan.exit && input.position.spent > 0n && input.position.worth === null) return { do: "hold", why: "unread" };
  if (plan.id === "steady") return { do: "buy" };
  if (plan.id === "early") {
    if (input.bornAt === null) return { do: "hold", why: "no-coin" };
    return now - input.bornAt <= plan.maxAgeH * 3_600_000 ? { do: "buy" } : { do: "hold", why: "too-old" };
  }
  const price = input.marks.at(-1)?.price ?? null;
  if (price === null || !(price > 0)) return { do: "hold", why: "unread" };
  if (plan.id === "dip") {
    const high = dayHigh(input.marks, now);
    if (high === null) return { do: "hold", why: "unread" };
    return price <= high * (1 - plan.dropBps / 10_000) ? { do: "buy" } : { do: "hold", why: "no-dip" };
  }
  /* The grid: the lowest level the price has come down to that it does not hold yet. */
  const anchor = input.anchor ?? price;
  for (let k = 0; k < plan.levels; k += 1) {
    if (input.held.includes(k)) continue;
    if (price <= gridLevel(anchor, plan.stepBps, k)) {
      /* The deepest open level at or above the price: one buy a pass. */
      let level = k;
      for (let j = k + 1; j < plan.levels; j += 1) if (!input.held.includes(j) && price <= gridLevel(anchor, plan.stepBps, j)) level = j;
      return { do: "buy", level };
    }
  }
  return { do: "hold", why: "no-level" };
}

/** The grid's levels whose coins stand one step up now — where the engine can sell, these are offered for sale. */
export function gridSells(plan: Extract<StrategyPlan, { id: "grid" }>, anchor: number, held: readonly number[], price: number): number[] {
  return held.filter((k) => price >= gridLevel(anchor, plan.stepBps, k - 1));
}

/* ---------------------------------------------------------------- early: the city's risk filter */

/** A new launch as the city's Pulse reads it (`lib/spot/pulse.ts` `PulseRow`): only the facts the filter weighs. */
export type LaunchFacts = Readonly<{
  mint: string;
  symbol: string;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  holders: number | null;
  top10Pct: number | null;
  devPct: number | null;
  creatorLaunches: number | null;
  creatorGraduated: number | null;
  auditRead: boolean;
  notices: readonly string[];
  firstPoolAt: string | null;
  /** The last hour's volume, USD. */
  volumeH1Usd: number | null;
}>;

/** The filter's bars: a launch below any of them is not bought. */
export const EARLY_FILTER = Object.freeze({
  minLiquidityUsd: 10_000,
  minMarketCapUsd: 20_000,
  minHolders: 100,
  maxTop10Pct: 30,
  maxDevPct: 10,
  /** A creator who launched this many coins … */
  serialLaunches: 5,
  /** … with fewer than this share reaching a DEX is a serial launcher. */
  serialGraduatedShare: 0.1,
});

export type EarlyRefusal = "audit" | "notices" | "age" | "liquidity" | "cap" | "holders" | "top10" | "dev" | "creator";

/** Why a launch does not pass the filter; null — it passes. A fact not read never passes. */
export function earlyRefusal(row: LaunchFacts, now: number, maxAgeH: number): EarlyRefusal | null {
  if (!row.auditRead) return "audit";
  if (row.notices.length > 0) return "notices";
  const born = row.firstPoolAt ? Date.parse(row.firstPoolAt) : Number.NaN;
  if (!Number.isFinite(born) || born > now || now - born > maxAgeH * 3_600_000) return "age";
  if (row.liquidityUsd === null || row.liquidityUsd < EARLY_FILTER.minLiquidityUsd) return "liquidity";
  if (row.marketCapUsd === null || row.marketCapUsd < EARLY_FILTER.minMarketCapUsd) return "cap";
  if (row.holders === null || row.holders < EARLY_FILTER.minHolders) return "holders";
  if (row.top10Pct === null || row.top10Pct > EARLY_FILTER.maxTop10Pct) return "top10";
  if (row.devPct === null || row.devPct > EARLY_FILTER.maxDevPct) return "dev";
  if (row.creatorLaunches !== null && row.creatorLaunches >= EARLY_FILTER.serialLaunches && (row.creatorGraduated ?? 0) / row.creatorLaunches < EARLY_FILTER.serialGraduatedShare) return "creator";
  return null;
}

/** A Pulse row (`lib/spot/pulse.ts` `PulseRow`, `GET /api/spot/pulse`) as the filter reads it. */
export function launchFactsFrom(row: Readonly<Omit<LaunchFacts, "volumeH1Usd"> & { windows?: Readonly<Record<string, Readonly<{ volumeUsd: number | null }> | undefined>> }>): LaunchFacts {
  return {
    mint: row.mint,
    symbol: row.symbol,
    liquidityUsd: row.liquidityUsd,
    marketCapUsd: row.marketCapUsd,
    holders: row.holders,
    top10Pct: row.top10Pct,
    devPct: row.devPct,
    creatorLaunches: row.creatorLaunches,
    creatorGraduated: row.creatorGraduated,
    auditRead: row.auditRead === true,
    notices: Array.isArray(row.notices) ? row.notices : ["not-read"],
    firstPoolAt: row.firstPoolAt,
    volumeH1Usd: row.windows?.h1?.volumeUsd ?? null,
  };
}

/** The one launch the agent picks: of those that pass, the one most traded in the last hour; null when none passes. */
export function earlyPick<T extends LaunchFacts>(rows: readonly T[], now: number, maxAgeH: number = PLAN_BOUNDS.maxAgeH.default): T | null {
  const passing = rows.filter((row) => earlyRefusal(row, now, maxAgeH) === null);
  passing.sort((a, b) => (b.volumeH1Usd ?? 0) - (a.volumeH1Usd ?? 0) || a.mint.localeCompare(b.mint));
  return passing[0] ?? null;
}
