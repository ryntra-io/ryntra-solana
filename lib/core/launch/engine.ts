/**
 * Ryntra Launch's executor at scale: the queue its pass works from and the words it
 * sends the operator when something fails. Pure — no chain, no store, no clock of its own.
 *
 * - **The queue.** A pass has a minute's budget; hundreds of markets do not fit in one. Each phase of the pass (the
 *   markets' budgets, the ladders) visits its markets in the queue's order — a market never visited first, then the one
 *   whose turn came longest ago — as many as the budget allows; the rest are first in the next minute. A market with
 *   nothing to do comes back after its phase's rest; one whose act failed comes back after a wait that grows with each
 *   failure in a row, so one broken market never eats the pass.
 * - **The words to the operator** (plan MarketOS §7, requirement 9): a market paused by its risk limits, transactions
 *   failing in a row, the executor's SOL low, the nodes not answering, the queue lagging, the switch not read, the
 *   passes silent. A condition is said when it begins, again every six hours while it holds if it needs the operator's
 *   hand, and once more when it clears; an event is said once. One line a thought, marked «Увага:», «Досі:» or
 *   «Минуло:», a number in place of a sentence (SOL-C9).
 */

import { BUDGET_RULE } from "./budget.ts";

export const ENGINE_RULE = Object.freeze({
  /** Markets acted on at once in a phase whose acts move only a market's own money: graduations, budget claims, budget ladders. */
  concurrency: 4,
  /** Curves read in one request of the node. */
  readBatch: 100,
  /** A budget with nothing to claim is looked at again after this: fees build up slowly, the locked position's once a day. */
  budgetRestSeconds: 300,
  /** A ladder is due every pass; the queue's order keeps the longest unread first when a pass cannot reach them all. */
  floorRestSeconds: 0,
  /** The waits after one, two, three … failures in a row of a market's act. */
  retrySeconds: Object.freeze([60, 120, 300, 900, 1_800]),
  /** A due market that waited longer than this: the queue lags — inside the budget's freshness (300 s), with room. */
  lagAlertSeconds: 240,
  /** A budget due longer than this: its queue lags. Fees build up in Meteora's pools meanwhile; nothing goes stale. */
  budgetLagAlertSeconds: 1_800,
  /** No pass for longer than this before the one now: the passes were silent. */
  silentAlertSeconds: 300,
  /** Failed transactions of the executor's in a row that the operator hears about (§7, requirement 9). */
  failedSendsAlert: 3,
  /** The executor's SOL below this: the operator hears — the same line under which no new money goes into the steps. */
  lowLamports: BUDGET_RULE.executorMinLamports,
  /** A condition that needs the operator's hand and still holds is said again after this. */
  repeatSeconds: 6 * 3_600,
  /** A word that did not reach the operator is tried again after this, not every minute. */
  retryWordSeconds: 900,
});

/* ------------------------------------------------------------------ the queue */

export type EnginePhase = "budget" | "floor" | "graduation";

/** Where one market stands in one phase's queue. Times are unix seconds. */
export type EngineSlot = Readonly<{
  /** When the market is due next; null before its first visit. */
  dueAt: number | null;
  visitedAt: number | null;
  /** Failed visits in a row; 0 after one that did not fail. */
  errors: number;
  lastError: string | null;
}>;

/** What one visit of a market came to, from its steps. */
export type VisitOutcome = "ACTED" | "WAITING" | "IDLE" | "FAILED";

/** The markets of a phase due now, in the order the pass visits them: never visited first, then the longest due. */
export function engineOrder<T extends Readonly<{ token: string }>>(items: readonly T[], slots: ReadonlyMap<string, EngineSlot>, now: number): T[] {
  const due = items.filter((item) => {
    const slot = slots.get(item.token);
    return !slot || slot.dueAt === null || slot.dueAt <= now;
  });
  const key = (item: T) => {
    const slot = slots.get(item.token);
    return [slot?.dueAt ?? Number.NEGATIVE_INFINITY, slot?.visitedAt ?? Number.NEGATIVE_INFINITY] as const;
  };
  /* A stable sort: markets alike keep the order they came in (the oldest launch first). */
  return [...due].sort((a, b) => {
    const [dueA, visitedA] = key(a);
    const [dueB, visitedB] = key(b);
    return dueA - dueB || visitedA - visitedB;
  });
}

/** Steps that are a transaction sent or a claim counted: the market acted. */
const ACTED = /^(GRADUATED|GRADUATION_LANDED|GRADUATION_SENT|BUDGET_CLAIMED|FLOOR_POOL|FLOOR_PLACED|FLOOR_RAISED|FLOOR_ADDED|FLOOR_SYNCED|FLOOR_WITHDRAWN|HOLDER_CLAIMED)$/;
/** Steps that wait on the chain or on another instance: the market is due again in the next pass. */
const WAITING = /(_PENDING|^LEASED|^OUT_OF_TIME|^NO_PRICE|^BUDGET_DATA_|^FLOOR_SAMPLING|^FLOOR_RAISE_SEEN|_UNREAD$)/;
/** Steps that are a failure of this visit. */
const FAILED = /(^ERROR|_ERROR\b|_FAILED$|_REJECTED$|_REFUSED$|_LAPSED$|_EXPIRED$)/;

/** What a market's visit came to: a failure first, then an act, then a wait; anything else is a market with nothing to do. */
export function visitOutcome(steps: readonly Readonly<{ step: string }>[]): VisitOutcome {
  if (steps.some((row) => FAILED.test(row.step))) return "FAILED";
  if (steps.some((row) => ACTED.test(row.step))) return "ACTED";
  if (steps.some((row) => WAITING.test(row.step))) return "WAITING";
  return "IDLE";
}

/** The rest after `errors` failures in a row: the waits grow, and stop growing at the last. */
export function retryAfterSeconds(errors: number): number {
  const waits = ENGINE_RULE.retrySeconds;
  return waits[Math.min(Math.max(errors, 1), waits.length) - 1]!;
}

/** A market's place in its phase's queue after a visit. */
export function nextSlot(
  slot: EngineSlot | null,
  args: Readonly<{ outcome: VisitOutcome; now: number; restSeconds: number; error?: string | null }>,
): EngineSlot {
  if (args.outcome === "FAILED") {
    const errors = (slot?.errors ?? 0) + 1;
    return { dueAt: args.now + retryAfterSeconds(errors), visitedAt: args.now, errors, lastError: args.error ?? slot?.lastError ?? null };
  }
  const dueAt = args.outcome === "IDLE" ? args.now + args.restSeconds : args.now;
  return { dueAt, visitedAt: args.now, errors: 0, lastError: null };
}

/** How long the longest-waiting market of a phase has been due, in seconds; 0 when none is. */
export function queueLagSeconds(slots: Iterable<EngineSlot>, now: number): number {
  let lag = 0;
  for (const slot of slots) if (slot.dueAt !== null && slot.dueAt < now) lag = Math.max(lag, now - slot.dueAt);
  return lag;
}

/* ------------------------------------------------------------------ failed sends in a row */

/** Steps of a transaction of the executor's that did not go through. */
const SEND_FAILED = /^(GRADUATION|BUDGET_CLAIM|HOLDER_CLAIM|FLOOR_POOL|FLOOR_SYNC|FLOOR_PLACED|FLOOR_ADDED|FLOOR_RAISED)_(FAILED|REJECTED|EXPIRED|LAPSED|REFUSED)$/;
const SEND_LANDED = /^(GRADUATED|GRADUATION_LANDED|BUDGET_CLAIMED|FLOOR_POOL|FLOOR_PLACED|FLOOR_RAISED|FLOOR_ADDED|FLOOR_SYNCED|HOLDER_CLAIMED)$/;

/**
 * The executor's failed transactions in a row after this pass: a transaction that went through ends the run; one that
 * did not adds to it, in the order the pass took them.
 */
export function failedSendsInRow(before: number, steps: readonly Readonly<{ step: string }>[]): number {
  let run = before;
  for (const row of steps) {
    if (SEND_LANDED.test(row.step)) run = 0;
    else if (SEND_FAILED.test(row.step)) run += 1;
  }
  return run;
}

/* ------------------------------------------------------------------ the words to the operator */

export type EngineAlertKey = "NODE" | "SENDS" | "LOW_SOL" | "LAG" | "STOPS" | "FAILING";

/** How the nodes answered one pass's reads (`lib/launch/failover.server.ts`). */
export type EngineNodes = Readonly<{
  /** Reads asked. */
  reads: number;
  /**
   * Reads the main node did not answer for being down. Its standing refusal of a kind of read (the public operator's
   * «Indexed requests require a personal token» on the creator's wallet) is not among them: the second answers those.
   */
  mainDown: number;
  /** Reads no node answered. */
  bothFailed: number;
}>;

/** What one pass saw that the operator may need to hear. */
export type EngineSignals = Readonly<{
  /** Unix seconds. */
  at: number;
  /** How long there was no pass before this one, in seconds; null when no pass was ever written. */
  silentSeconds: number | null;
  /** How the nodes answered this pass's reads; absent or null — not counted. */
  nodes?: EngineNodes | null;
  failedSendsInRow: number;
  /** The executor's SOL; null when not read this pass. */
  lamports: bigint | null;
  /** Markets that went into the pause of their risk limits in this pass. */
  paused: readonly string[];
  lagSeconds: number;
  stopsUnread: boolean;
  /** Markets whose visit failed in this pass. */
  failing: number;
}>;

type Active = Readonly<{ since: number; lastSeen: number; sentAt: number | null; detail: string }>;

export type EngineAlertState = Readonly<{
  active: Readonly<Partial<Record<EngineAlertKey, Active>>>;
  /** When an undelivered word was last tried; null when the last one reached the operator. */
  attemptAt: number | null;
}>;

export const NO_ALERTS: EngineAlertState = Object.freeze({ active: Object.freeze({}), attemptAt: null });

export type EngineWord = Readonly<{ key: EngineAlertKey | "PAUSED" | "SILENT"; kind: "RAISED" | "STILL" | "CLEARED" | "EVENT"; text: string }>;

/**
 * How long a condition holds before it is said (seconds): markets failing and the main node failing over are said only
 * once they last — a public node's rate limit or one market's bad minute comes and goes on its own, and the operator
 * should not hear it every minute (measured on devnet 20.10: «помилка на ринках» rose and fell pass after pass).
 */
const RAISE_AFTER: Readonly<Record<EngineAlertKey, number>> = { NODE: 120, SENDS: 0, LOW_SOL: 0, LAG: 0, STOPS: 0, FAILING: 300 };
/**
 * Conditions that need the operator's hand — a node to change, SOL to send, transactions, a lagging queue or the switch
 * to look into: said again every `repeatSeconds` while they hold. Markets failing are retried by the queue on their own:
 * said once, and once more when gone.
 */
const NEEDS_OPERATOR: ReadonlySet<EngineAlertKey> = new Set(["NODE", "SENDS", "LOW_SOL", "LAG", "STOPS"]);
/** A condition that was said is said cleared only after this long without it. */
export const CLEAR_AFTER_SECONDS = 600;

const minutes = (seconds: number) => Math.max(1, Math.round(seconds / 60));
const sol = (lamports: bigint) => (Number(lamports) / 1e9).toFixed(3).replace(".", ",");
const short = (token: string) => `${token.slice(0, 4)}…${token.slice(-4)}`;
/** The form of a word for `n` things: one (1, 21, …), few (2–4, 22–24, …), many (5–20, 25–30, …). */
export function plural(n: number, one: string, few: string, many: string): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return one;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return few;
  return many;
}
const reads = (n: number) => `${n} ${plural(n, "читання", "читання", "читань")}`;

/** What holds now for each condition, with its detail for the word; absent — it does not hold. */
function conditions(signals: EngineSignals, state: EngineAlertState): Partial<Record<EngineAlertKey, string>> {
  const now: Partial<Record<EngineAlertKey, string>> = {};
  /* The nodes: only a read neither answered, or the main node down for most reads — not a kind of read it refuses. */
  const nodes = signals.nodes;
  if (nodes && nodes.bothFailed > 0) now.NODE = `обидва вузли не відповіли на ${reads(nodes.bothFailed)}`;
  else if (nodes && nodes.mainDown * 2 > nodes.reads) now.NODE = `основний вузол не відповів на ${nodes.mainDown} з ${nodes.reads} ${plural(nodes.reads, "читання", "читань", "читань")}`;
  const sends = signals.failedSendsInRow;
  if (sends >= ENGINE_RULE.failedSendsAlert) now.SENDS = `${sends} ${plural(sends, "транзакція", "транзакції", "транзакцій")} поспіль не ${plural(sends, "пройшла", "пройшли", "пройшли")}`;
  /* SOL not read this pass: a low balance said before still holds — a failed read never says it is enough again. */
  if (signals.lamports === null && state.active.LOW_SOL) now.LOW_SOL = state.active.LOW_SOL.detail;
  if (signals.lamports !== null && signals.lamports < ENGINE_RULE.lowLamports) now.LOW_SOL = `SOL у виконавця ${sol(signals.lamports)} — менше ${sol(ENGINE_RULE.lowLamports)}, поповніть`;
  if (signals.lagSeconds > ENGINE_RULE.lagAlertSeconds) now.LAG = `черга відстає на ${minutes(signals.lagSeconds)} хв`;
  if (signals.stopsUnread) now.STOPS = "вимикач не прочитано — прохід нічого не підписує";
  const failing = signals.failing;
  if (failing > 0) now.FAILING = `${failing === 1 ? "помилка" : "помилки"} на ${failing} ${plural(failing, "ринку", "ринках", "ринках")} — черга повторить`;
  return now;
}

/** What is said of a condition gone, after «Минуло:». */
const WHAT: Readonly<Record<EngineAlertKey, string>> = {
  NODE: "збій вузлів",
  SENDS: "збій транзакцій",
  LOW_SOL: "брак SOL у виконавця",
  LAG: "відставання черги",
  STOPS: "збій читання вимикача",
  FAILING: "помилки на ринках",
};

/**
 * The words this pass owes the operator, and the state to keep. A condition is said once it has held for its time
 * (`RAISE_AFTER`), again after `repeatSeconds` while it holds if it needs the operator (`NEEDS_OPERATOR`), and once more when it has been gone for
 * `CLEAR_AFTER_SECONDS`; a pause of a market and a silence of the passes are said once, as they happen. The state moves
 * only by what reached the operator: `delivered` is asked after the words are sent (`engineAlertsSent`).
 */
export function engineAlerts(state: EngineAlertState, signals: EngineSignals): Readonly<{ words: readonly EngineWord[]; holding: Readonly<Partial<Record<EngineAlertKey, string>>> }> {
  const words: EngineWord[] = [];
  const holding = conditions(signals, state);
  if (signals.silentSeconds !== null && signals.silentSeconds > ENGINE_RULE.silentAlertSeconds) {
    words.push({ key: "SILENT", kind: "EVENT", text: `${minutes(signals.silentSeconds)} хв без проходів` });
  }
  if (signals.paused.length) {
    const n = signals.paused.length;
    words.push({ key: "PAUSED", kind: "EVENT", text: `${n} ${plural(n, "ринок", "ринки", "ринків")} на паузі за ризик-лімітами — ${signals.paused.map(short).join(", ")}` });
  }
  for (const key of Object.keys(holding) as EngineAlertKey[]) {
    const known = state.active[key];
    /* A condition gone for less than the clearing time and back again has held all along. */
    const since = known && signals.at - known.lastSeen < CLEAR_AFTER_SECONDS ? known.since : signals.at;
    if (!known?.sentAt) {
      if (signals.at - since >= RAISE_AFTER[key]) words.push({ key, kind: "RAISED", text: holding[key]! });
    } else if (NEEDS_OPERATOR.has(key) && signals.at - known.sentAt >= ENGINE_RULE.repeatSeconds) words.push({ key, kind: "STILL", text: holding[key]! });
  }
  for (const key of Object.keys(state.active) as EngineAlertKey[]) {
    const known = state.active[key]!;
    if (!holding[key] && known.sentAt !== null && signals.at - known.lastSeen >= CLEAR_AFTER_SECONDS) words.push({ key, kind: "CLEARED", text: WHAT[key] });
  }
  return { words, holding };
}

/** The mark a word opens with: what began, what still holds, what is over — a silence of the passes is over once a pass is told. */
function mark(word: EngineWord): string {
  if (word.kind === "CLEARED" || word.key === "SILENT") return "Минуло:";
  return word.kind === "STILL" ? "Досі:" : "Увага:";
}

/** One message to the operator from the pass's words, a word a line; null when there are none. */
export function engineMessage(words: readonly EngineWord[]): string | null {
  if (!words.length) return null;
  return ["Ryntra · виконавець", ...words.map((word) => `${mark(word)} ${word.text}`)].join("\n");
}

/**
 * The state after the words were sent — or not: a word that reached the operator marks its condition as said; one
 * that did not leaves it to be said again after `retryWordSeconds`. A condition no longer holding is kept until its
 * clearing was said (or, never said, until the clearing time is out), so one that comes back soon is the same one.
 */
export function engineAlertsSent(
  state: EngineAlertState,
  args: Readonly<{ holding: Readonly<Partial<Record<EngineAlertKey, string>>>; words: readonly EngineWord[]; delivered: boolean; at: number }>,
): EngineAlertState {
  const said = new Set((args.delivered ? args.words : []).map((word) => `${word.kind}:${word.key}`));
  const active: Partial<Record<EngineAlertKey, Active>> = {};
  for (const key of Object.keys(args.holding) as EngineAlertKey[]) {
    const known = state.active[key];
    const since = known && args.at - known.lastSeen < CLEAR_AFTER_SECONDS ? known.since : args.at;
    const sentNow = said.has(`RAISED:${key}`) || said.has(`STILL:${key}`);
    active[key] = { since, lastSeen: args.at, sentAt: sentNow ? args.at : (known?.sentAt ?? null), detail: args.holding[key]! };
  }
  for (const key of Object.keys(state.active) as EngineAlertKey[]) {
    if (args.holding[key]) continue;
    const known = state.active[key]!;
    if (said.has(`CLEARED:${key}`)) continue;
    if (known.sentAt === null && args.at - known.lastSeen >= CLEAR_AFTER_SECONDS) continue;
    active[key] = known;
  }
  return { active, attemptAt: args.words.length && !args.delivered ? args.at : null };
}

/** Whether the pass may try to send its words now: none undelivered lately. */
export function engineMayTell(state: EngineAlertState, at: number): boolean {
  return state.attemptAt === null || at - state.attemptAt >= ENGINE_RULE.retryWordSeconds;
}
