/**
 * The success metrics of Ryntra's financial panel (MET-1, spec §16.4) — the projection. Pure and client-safe; the reads
 * are `finance.server.ts`.
 *
 * What people and Ryntra's automation actually did, never raw volume:
 *
 * - **activation** — wallets whose first completed action is in the records: an operation confirmed through Ryntra
 *   (Swap, Spot, stocks, a launch trade, a bridge), a launch made, or an answer of the assistant;
 * - **retention 7 and 30 days** — of the wallets activated at least N days ago, the share that acted again N days or more
 *   after their first action;
 * - **live bots** — Autoinvest's active rules and the markets Ryntra's executor keeps (the ladder and its upkeep);
 * - **verified autonomous actions** — what Ryntra's executor and holder-fee collector sent, each a transaction read back
 *   from the chain before it was written down;
 * - **launches with actions after the DEX** — of the launches that moved to the DEX, those where Ryntra's executor acted
 *   after the move;
 * - **latency** — the operations' start to their confirmed row (approximate: the row's last write, not the block's
 *   time), and the assistant's answers;
 * - **failures and recoveries** — the operations' failed share and those stuck in flight for an hour, and graduations
 *   that failed and then went through;
 * - **security incidents** — support threads marked security (the target is 0);
 * - **teams paying, the first successful SDK call, wallets in profit** — no record yet: «no data», with the task that
 *   brings each (TEAM-1, DEV-1, DSC-2).
 *
 * A source not read is `UNREAD`; a source with nothing to count over is a measured «no data», never a zero rate.
 */

import type { FinanceOperation, FinanceScope } from "./finance.ts";

/* ------------------------------------------------------------------ inputs */

export type SuccessLaunch = Readonly<{
  token: string;
  creator: string;
  launchedAt: string;
  /** Launched by one of Ryntra's own wallets. */
  own: boolean;
  /** The executor's receipts on the token — each a transaction read back from the chain; null when not read. */
  receipts: readonly Readonly<{ kind: string; actor: string; at: string | null; signature: string }>[] | null;
  /** The market's flight log; null when not read. */
  marks: readonly Readonly<{ kind: string; at: string }>[] | null;
  /** The state the executor last wrote for the market; null when it keeps none. */
  executorState: string | null;
}>;

export type SuccessInputs = Readonly<{
  /** Every launch record on the network; null when not read. */
  launches: readonly SuccessLaunch[] | null;
  /** Autoinvest's rules; null when not read. */
  autoinvest: readonly Readonly<{ owner: string; status: string }>[] | null;
  /** The holder-fee collector's claims; null when not read. */
  holderClaims: readonly Readonly<{ owner: string; state: string; at: string | null }>[] | null;
  /** The assistant's calls (one receipt each); null when not read. */
  assistant: readonly Readonly<{ owner: string; at: string; outcome: string; latencyMs: number | null }>[] | null;
  /** Support threads marked security; null when not read. `complete` — the list was not cut at its limit. */
  security: Readonly<{ total: number; open: number; complete: boolean }> | null;
}>;

/* ------------------------------------------------------------------ the model */

export const SUCCESS_METRICS = [
  "activation",
  "retention7",
  "retention30",
  "liveBots",
  "autonomousActions",
  "postDexLaunches",
  "teamsPaying",
  "sdkFirstCall",
  "latencyOperations",
  "latencyAssistant",
  "failedShare",
  "stuck",
  "recoveredGraduations",
  "securityIncidents",
  "walletsInProfit",
] as const;
export type SuccessMetricId = (typeof SUCCESS_METRICS)[number];

export type SuccessMetric = Readonly<{
  id: SuccessMetricId;
  /** `MEASURED` — counted from a record; `UNREAD` — the record was not read now; `NO_SOURCE` — nothing records it yet. */
  state: "MEASURED" | "UNREAD" | "NO_SOURCE";
  unit: "wallets" | "count" | "share" | "ms";
  /** Null when not known — never a zero for «not read» or «nothing to count over». */
  value: number | null;
  /** What it is counted over: the eligible wallets, the finished operations, the launches that moved. */
  n: number | null;
  /** Read in part: a count is a floor. */
  atLeast: boolean;
  /** The figure is close, not exact (the latency of a row's write). */
  approximate?: boolean;
  /** Of it, the last 30 days. */
  recent?: number | null;
  parts?: readonly Readonly<{ id: string; value: number | null }>[];
  /** The task that brings a metric nothing records yet. */
  task?: string;
  /** The value aimed at (security incidents: 0). */
  target?: number;
}>;

export type SuccessModel = Readonly<{ metrics: readonly SuccessMetric[] }>;

/* ------------------------------------------------------------------ the projection */

const DAY_MS = 86_400_000;
const STUCK_MS = 60 * 60_000;
const BOT_STATES = new Set(["LADDER_ACTIVE", "MAINTAINING"]);
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const noSource = (id: SuccessMetricId, unit: SuccessMetric["unit"], task: string): SuccessMetric => ({ id, state: "NO_SOURCE", unit, value: null, n: null, atLeast: false, task });
const unread = (id: SuccessMetricId, unit: SuccessMetric["unit"]): SuccessMetric => ({ id, state: "UNREAD", unit, value: null, n: null, atLeast: false });

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const ms = (at: string | null | undefined) => (at ? Date.parse(at) : Number.NaN);

export function projectSuccess(
  args: Readonly<{ now: string; scope: FinanceScope; internalWallets: ReadonlySet<string>; operations: readonly FinanceOperation[] | null; success: SuccessInputs | null }>,
): SuccessModel {
  const now = Date.parse(args.now);
  const external = args.scope === "external";
  const outside = (wallet: string) => !external || !args.internalWallets.has(wallet);
  const success = args.success;
  const operations = args.operations;
  const launches = success?.launches === null || success?.launches === undefined ? null : success.launches.filter((launch) => !external || !launch.own);
  const assistant = success?.assistant ?? null;

  /* Each wallet's completed actions, by time: the operations, the launches made, the assistant's answers. */
  const actions = new Map<string, number[]>();
  const act = (wallet: string | undefined, at: number) => {
    if (!wallet || !Number.isFinite(at) || !outside(wallet)) return;
    const list = actions.get(wallet) ?? [];
    list.push(at);
    actions.set(wallet, list);
  };
  for (const op of operations ?? []) if (op.status === "CONFIRMED") act(op.wallet, ms(op.confirmedAt ?? op.at));
  for (const launch of launches ?? []) act(launch.creator, ms(launch.launchedAt));
  for (const call of assistant ?? []) if (call.outcome === "ok" && WALLET.test(call.owner)) act(call.owner, ms(call.at));
  for (const list of actions.values()) list.sort((a, b) => a - b);
  /* Operations whose rows carry no wallet cannot be placed: the counts are then floors. */
  const unplaced = (operations ?? []).some((op) => op.status === "CONFIRMED" && !op.wallet);
  const partial = operations === null || launches === null || assistant === null || unplaced;

  const metrics: SuccessMetric[] = [];

  /* ---- activation and retention ---- */
  if (operations === null && launches === null && assistant === null) {
    metrics.push(unread("activation", "wallets"), unread("retention7", "share"), unread("retention30", "share"));
  } else {
    const firsts = [...actions.values()].map((list) => list[0]!);
    metrics.push({ id: "activation", state: "MEASURED", unit: "wallets", value: actions.size, n: null, atLeast: partial, recent: firsts.filter((at) => at >= now - 30 * DAY_MS).length });
    for (const [id, days] of [
      ["retention7", 7],
      ["retention30", 30],
    ] as const) {
      let eligible = 0;
      let returned = 0;
      for (const list of actions.values()) {
        const first = list[0]!;
        if (first > now - days * DAY_MS) continue;
        eligible += 1;
        if (list.some((at) => at >= first + days * DAY_MS)) returned += 1;
      }
      metrics.push({ id, state: "MEASURED", unit: "share", value: eligible === 0 ? null : returned / eligible, n: eligible, atLeast: partial });
    }
  }

  /* ---- live bots ---- */
  const rules = success?.autoinvest ?? null;
  if (rules === null && launches === null) metrics.push(unread("liveBots", "count"));
  else {
    const activeRules = rules === null ? null : rules.filter((rule) => rule.status === "active" && outside(rule.owner)).length;
    const markets = launches === null ? null : launches.filter((launch) => launch.executorState !== null && BOT_STATES.has(launch.executorState)).length;
    metrics.push({
      id: "liveBots",
      state: "MEASURED",
      unit: "count",
      value: (activeRules ?? 0) + (markets ?? 0),
      n: null,
      atLeast: activeRules === null || markets === null,
      parts: [
        { id: "autoinvest", value: activeRules },
        { id: "executor", value: markets },
      ],
    });
  }

  /* ---- verified autonomous actions ---- */
  const claims = success?.holderClaims ?? null;
  if (claims === null && launches === null) metrics.push(unread("autonomousActions", "count"));
  else {
    const executorActs = launches === null ? null : launches.flatMap((launch) => (launch.receipts ?? []).filter((receipt) => receipt.actor === "ryntra"));
    const collected = claims === null ? null : claims.filter((claim) => claim.state === "CONFIRMED" && outside(claim.owner));
    const recent = [...(executorActs ?? []), ...(collected ?? [])].filter((entry) => ms(entry.at) >= now - 30 * DAY_MS).length;
    metrics.push({
      id: "autonomousActions",
      state: "MEASURED",
      unit: "count",
      value: (executorActs?.length ?? 0) + (collected?.length ?? 0),
      n: null,
      atLeast: executorActs === null || collected === null || (launches ?? []).some((launch) => launch.receipts === null),
      recent,
      parts: [
        { id: "executor", value: executorActs?.length ?? null },
        { id: "holderClaims", value: collected?.length ?? null },
      ],
    });
  }

  /* ---- launches with Ryntra's actions after the DEX ---- */
  if (launches === null) metrics.push(unread("postDexLaunches", "count"));
  else {
    let moved = 0;
    let acted = 0;
    for (const launch of launches) {
      const graduated = (launch.receipts ?? []).find((receipt) => receipt.kind === "GRADUATED");
      if (!graduated) continue;
      moved += 1;
      const at = ms(graduated.at);
      if ((launch.receipts ?? []).some((receipt) => receipt.kind !== "GRADUATED" && receipt.actor === "ryntra" && (!Number.isFinite(at) || ms(receipt.at) >= at))) acted += 1;
    }
    metrics.push({ id: "postDexLaunches", state: "MEASURED", unit: "count", value: acted, n: moved, atLeast: launches.some((launch) => launch.receipts === null) });
  }

  metrics.push(noSource("teamsPaying", "count", "TEAM-1"), noSource("sdkFirstCall", "count", "DEV-1"));

  /* ---- latency ---- */
  if (operations === null) metrics.push(unread("latencyOperations", "ms"));
  else {
    const spans = operations.flatMap((op) => {
      if (op.status !== "CONFIRMED" || !op.startedAt || !op.confirmedAt) return [];
      const span = ms(op.confirmedAt) - ms(op.startedAt);
      return Number.isFinite(span) && span >= 0 ? [span] : [];
    });
    metrics.push({ id: "latencyOperations", state: "MEASURED", unit: "ms", value: median(spans), n: spans.length, atLeast: false, approximate: true });
  }
  if (assistant === null) metrics.push(unread("latencyAssistant", "ms"));
  else {
    const spans = assistant.flatMap((call) => (call.outcome === "ok" && call.latencyMs !== null && call.latencyMs >= 0 ? [call.latencyMs] : []));
    metrics.push({ id: "latencyAssistant", state: "MEASURED", unit: "ms", value: median(spans), n: spans.length, atLeast: false });
  }

  /* ---- failures and recoveries ---- */
  if (operations === null) metrics.push(unread("failedShare", "share"), unread("stuck", "count"));
  else {
    const finished = operations.filter((op) => op.status === "CONFIRMED" || op.status === "FAILED");
    metrics.push({ id: "failedShare", state: "MEASURED", unit: "share", value: finished.length === 0 ? null : finished.filter((op) => op.status === "FAILED").length / finished.length, n: finished.length, atLeast: false });
    const stuck = operations.filter((op) => (op.status === "IN_FLIGHT" || op.status === "NEEDS_YOU") && ms(op.startedAt ?? op.at) <= now - STUCK_MS).length;
    metrics.push({ id: "stuck", state: "MEASURED", unit: "count", value: stuck, n: null, atLeast: false });
  }
  if (launches === null) metrics.push(unread("recoveredGraduations", "share"));
  else {
    let failed = 0;
    let recovered = 0;
    for (const launch of launches) {
      const failure = (launch.marks ?? []).find((mark) => mark.kind === "GRADUATION_FAILED");
      if (!failure) continue;
      failed += 1;
      if ((launch.receipts ?? []).some((receipt) => receipt.kind === "GRADUATED" && ms(receipt.at) >= ms(failure.at))) recovered += 1;
    }
    metrics.push({ id: "recoveredGraduations", state: "MEASURED", unit: "share", value: failed === 0 ? null : recovered / failed, n: failed, atLeast: launches.some((launch) => launch.marks === null) });
  }

  /* ---- security ---- */
  const security = success?.security ?? null;
  metrics.push(
    security === null
      ? { ...unread("securityIncidents", "count"), target: 0 }
      : { id: "securityIncidents", state: "MEASURED", unit: "count", value: security.total, n: null, atLeast: !security.complete, parts: [{ id: "open", value: security.open }], target: 0 },
  );

  metrics.push(noSource("walletsInProfit", "share", "DSC-2"));
  return { metrics };
}
