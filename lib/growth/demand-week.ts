/**
 * CITY-197 — the owner's week of demand: five figures that say whether people came and stayed, so the next build is
 * chosen by what they did (`docs/research/launchpad-market-2026-11-04/REPORT.md` §0 п. 5, §7 пп. 1 і 5).
 *
 * 1. Launches by people — coins launched on mainnet in the week by a wallet that is not Ryntra's own.
 * 2. Agents at work — people's agents with a budget that traded in the week, and their turnover (buys and sales, SOL).
 * 3. Return on day 7 and day 30 — of the people who first came 7 (30) days before the week, how many came back on a
 *    later day within those 7 (30) days.
 * 4. People partners brought — wallets that arrived in the week through a partner's link or a partner's launch.
 * 5. External net revenue of the week — Ryntra's fees from people's swaps and launch
 *    trades after the provider's share, cashback and friends' rewards, plus the fees of people's agents, less what the
 *    week owes partners.
 *
 * Pure: the reads are `demand-week.server.ts`'s. Every figure is the engine's own records; nothing is estimated. A
 * figure whose source did not read is null and is drawn as «не прочитано», never as zero. Reads only — it moves nothing.
 */

import { agentFeeRaw } from "../mandate/fee-rates.ts";

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Another action on a later UTC day within `days` of the first; null while the first is younger than `days` — the panel's
 * own rule (`./panel.ts` `returnedWithin`), kept here so the card stays client-safe.
 */
export function returnedWithin(times: readonly number[], days: number, nowMs: number): boolean | null {
  const first = times[0];
  if (first === undefined || nowMs - first < days * DAY_MS) return null;
  const firstDay = utcDay(first);
  return times.some((at) => at > first && at <= first + days * DAY_MS && utcDay(at) !== firstDay);
}

/** The Monday (UTC) of the week `at` falls in, `YYYY-MM-DD`. */
export function mondayOf(at: number): string {
  const day = new Date(at);
  const monday = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - ((day.getUTCDay() + 6) % 7) * DAY_MS;
  return new Date(monday).toISOString().slice(0, 10);
}

/** The last week that has closed by `now`. */
export const lastClosedWeek = (now: number): string => mondayOf(mondayStart(mondayOf(now)) - DAY_MS);

const WEEK = /^\d{4}-\d{2}-\d{2}$/u;
export const mondayStart = (week: string): number => Date.parse(`${week}T00:00:00.000Z`);

/** A week asked for: a Monday that has closed by `now`; null otherwise. */
export function readWeek(value: string | null | undefined, now: number): string | null {
  if (value === null || value === undefined || value === "") return lastClosedWeek(now);
  if (!WEEK.test(value)) return null;
  const start = mondayStart(value);
  if (!Number.isFinite(start) || new Date(start).getUTCDay() !== 1 || start + WEEK_MS > now) return null;
  return value;
}

/** The closed weeks before `now`, newest first. */
export function recentWeeks(now: number, count = 8): string[] {
  const last = mondayStart(lastClosedWeek(now));
  return Array.from({ length: count }, (_, index) => new Date(last - index * WEEK_MS).toISOString().slice(0, 10));
}

/* ---------------------------------------------------------------- inputs */

/** A record that read, or did not. */
export type Read<T> = T | null;

export type LaunchIn = Readonly<{ creator: string; launchedAt: string | null; state: string }>;
export type TradeIn = Readonly<{ at: number; status: string; spentRaw: string }>;
export type AgentIn = Readonly<{ owner: string; receiveMint: string; trades: readonly TradeIn[] }>;
export type SaleIn = Readonly<{ owner: string; status: string; at: number; gotRaw: string | null; feeRaw: string }>;
export type Arrival = Readonly<{ wallet: string; at: number }>;

export type DemandInputs = Readonly<{
  week: string;
  /** Ryntra's own wallets: the owner's list, the launch signers, the team's canary; null — the list did not read. */
  ours: Read<ReadonlySet<string>>;
  launches: Read<readonly LaunchIn[]>;
  agents: Read<readonly AgentIn[]>;
  sales: Read<readonly SaleIn[]>;
  /** Ryntra's fee rate on an agent's buys of each coin, basis points; a coin missing — not read. */
  agentFeeBps: Read<ReadonlyMap<string, number>>;
  /** Every finished action of a wallet on mainnet: the times it did something itself. */
  activity: Read<readonly Arrival[]>;
  /** Wallets bound to a partner's link, and creators bound to a partner's launch, with when. */
  referred: Read<readonly Arrival[]>;
  poolPartners: Read<readonly Arrival[]>;
  /** People's swaps and launch trades in the week: Ryntra's fees after the provider, cashback and friends, USD. */
  swapsUsd: Read<number>;
  /** What the week owes partners, USD. */
  partnersUsd: Read<number>;
  /** SOL in dollars now — the agents' SOL fees are counted at it. */
  solUsd: Read<number>;
}>;

/* ---------------------------------------------------------------- model */

export type Cohort = Readonly<{ back: number; of: number }>;

export type DemandWeek = Readonly<{
  week: string;
  from: string;
  to: string;
  launches: Readonly<{ coins: number | null; people: number | null }>;
  agents: Readonly<{ active: number | null; turnoverSol: number | null }>;
  returns: Readonly<{ d7: Cohort | null; d30: Cohort | null }>;
  partners: Readonly<{ people: number | null }>;
  revenue: Readonly<{ netUsd: number | null; swapsUsd: number | null; agentsUsd: number | null; agentsSol: number | null; partnersUsd: number | null }>;
}>;

const lamportsToSol = (raw: bigint) => Number(raw) / 1e9;
const cents = (usd: number) => Math.round(usd * 100) / 100;

/** Whether `at` is in the week `[start, start + 7d)`. */
const within = (at: number, start: number) => Number.isFinite(at) && at >= start && at < start + WEEK_MS;

/** The people a cohort counts: who first came in `[from, from + 7d)`, and who of them came back within `days`. */
export function cohort(activity: readonly Arrival[], ours: ReadonlySet<string>, from: number, days: number): Cohort {
  const times = new Map<string, number[]>();
  for (const row of activity) {
    if (ours.has(row.wallet) || !Number.isFinite(row.at)) continue;
    const list = times.get(row.wallet) ?? [];
    list.push(row.at);
    times.set(row.wallet, list);
  }
  let of = 0;
  let back = 0;
  for (const list of times.values()) {
    list.sort((a, b) => a - b);
    if (!within(list[0]!, from)) continue;
    of += 1;
    /* Judged as of the end of their own window: everyone in the cohort is old enough. */
    if (returnedWithin(list, days, list[0]! + days * DAY_MS) === true) back += 1;
  }
  return { back, of };
}

export function projectDemand(input: DemandInputs): DemandWeek {
  const start = mondayStart(input.week);
  const ours = input.ours;
  const theirs = (wallet: string) => ours !== null && !ours.has(wallet);

  /* 1. Launches by people. */
  const launched = input.launches && ours ? input.launches.filter((row) => row.state === "LAUNCHED" && theirs(row.creator) && within(Date.parse(row.launchedAt ?? ""), start)) : null;

  /* 2. People's agents that traded in the week, and what they turned over. */
  let active: number | null = null;
  let turnover: bigint | null = null;
  let feeRaw: bigint | null = null;
  if (input.agents && ours) {
    const owners = new Set<string>();
    let spent = 0n;
    let fees: bigint | null = 0n;
    for (const agent of input.agents) {
      if (!theirs(agent.owner)) continue;
      const done = agent.trades.filter((trade) => trade.status === "ok" && within(trade.at, start));
      if (done.length === 0) continue;
      owners.add(agent.owner);
      const bps = input.agentFeeBps?.get(agent.receiveMint);
      for (const trade of done) {
        const amount = BigInt(trade.spentRaw);
        spent += amount;
        fees = fees === null || bps === undefined ? null : fees + agentFeeRaw(amount, bps);
      }
    }
    if (input.sales) {
      for (const sale of input.sales) {
        if (!theirs(sale.owner) || sale.status !== "sold" || !within(sale.at, start)) continue;
        owners.add(sale.owner);
        if (sale.gotRaw !== null) spent += BigInt(sale.gotRaw);
        fees = fees === null ? null : fees + BigInt(sale.feeRaw);
      }
    } else fees = null;
    active = owners.size;
    turnover = input.sales ? spent : null;
    feeRaw = fees;
  }

  /* 3. Return on day 7 and day 30. */
  const d7 = input.activity && ours ? cohort(input.activity, ours, start - 7 * DAY_MS, 7) : null;
  const d30 = input.activity && ours ? cohort(input.activity, ours, start - 30 * DAY_MS, 30) : null;

  /* 4. People partners brought: each wallet once, the week's arrivals only. */
  let partnerPeople: number | null = null;
  if (input.referred && input.poolPartners && ours) {
    const people = new Set<string>();
    for (const row of [...input.referred, ...input.poolPartners]) if (theirs(row.wallet) && within(row.at, start)) people.add(row.wallet);
    partnerPeople = people.size;
  }

  /* 5. External net revenue: every part read, or the whole is not. */
  const agentsSol = feeRaw === null ? null : lamportsToSol(feeRaw);
  const agentsUsd = agentsSol === null ? null : feeRaw === 0n ? 0 : input.solUsd === null ? null : cents(agentsSol * input.solUsd);
  const netUsd = input.swapsUsd === null || agentsUsd === null || input.partnersUsd === null ? null : cents(input.swapsUsd + agentsUsd - input.partnersUsd);

  return {
    week: input.week,
    from: new Date(start).toISOString(),
    to: new Date(start + WEEK_MS).toISOString(),
    launches: { coins: launched ? launched.length : null, people: launched ? new Set(launched.map((row) => row.creator)).size : null },
    agents: { active, turnoverSol: turnover === null ? null : lamportsToSol(turnover) },
    returns: { d7, d30 },
    partners: { people: partnerPeople },
    revenue: { netUsd, swapsUsd: input.swapsUsd === null ? null : cents(input.swapsUsd), agentsUsd, agentsSol, partnersUsd: input.partnersUsd === null ? null : cents(input.partnersUsd) },
  };
}

/* ---------------------------------------------------------------- the owner's message */

export const NOT_READ = "не прочитано";

const int = (value: number | null) => (value === null ? NOT_READ : String(value));
const solText = (value: number | null) => (value === null ? NOT_READ : `${value.toFixed(value >= 1 ? 2 : 4).replace(/0+$/u, "").replace(/[.,]$/u, "").replace(".", ",")} SOL`);
export const usdText = (value: number | null) => (value === null ? NOT_READ : `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2).replace(".", ",")}`);
export const cohortText = (value: Cohort | null) => (value === null ? NOT_READ : value.of === 0 ? "нікого в когорті" : `${value.back} з ${value.of}`);
const dayText = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** The week in the owner's Telegram: one line a figure, nothing else. */
export function demandMessage(week: DemandWeek): string {
  const last = new Date(Date.parse(week.to) - DAY_MS).toISOString();
  return [
    `Ryntra · тиждень ${dayText(week.from)}–${dayText(last)}`,
    "",
    `Чистий дохід: ${usdText(week.revenue.netUsd)}`,
    `Запуски людей: ${int(week.launches.coins)}`,
    `Агенти: ${int(week.agents.active)} · обіг ${solText(week.agents.turnoverSol)}`,
    `Повернення D7: ${cohortText(week.returns.d7)} · D30: ${cohortText(week.returns.d30)}`,
    `Від партнерів: ${int(week.partners.people)}`,
  ].join("\n");
}

/** The switch: `RYNTRA_DEMAND_WEEK=on` lets the cron tell the owner; anything else keeps it shut. */
export const DEMAND_WEEK_ENV = "RYNTRA_DEMAND_WEEK";
export const demandWeekSends = (value: string | undefined): boolean => value?.trim().toLowerCase() === "on";

/** The trigger that tells one week once (`monitoringTriggers`). */
export const demandTrigger = (week: string) => `demand-week:${week}`;
