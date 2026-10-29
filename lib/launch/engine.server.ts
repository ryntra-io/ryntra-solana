/**
 * Ryntra Launch's executor at scale (SOL-L6) — what it keeps between passes in the store: each phase's queue, the
 * words it said to the operator, and the operator's switch of the budget and the ladder on people's Micro markets.
 *
 * **People's markets.** On a Micro market a person launched,
 * the executor claims the market's budget and keeps its ladder by the same policies as on Ryntra's own — only while this
 * switch is open. On devnet it is open until the operator closes it; on mainnet it is closed until the operator opens it
 * (the money of the ladder and its loss are Ryntra's). A switch that cannot be read is closed. Every flip is kept with
 * who made it and when.
 *
 * Nothing here signs or reads the chain.
 */

import type { EngineAlertState, EngineNodes, EnginePhase, EngineSignals, EngineSlot } from "../core/launch/engine.ts";
import { ENGINE_RULE, NO_ALERTS, engineAlerts, engineAlertsSent, engineMayTell, engineMessage, failedSendsInRow } from "../core/launch/engine.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";

const QUEUE = "launchEngineQueue";
const ALERTS = "launchEngineAlerts";
const PEOPLE = "launchEnginePeople";

/* ------------------------------------------------------------------ the queue */

export type EngineQueue = Readonly<{ cluster: string; phase: EnginePhase; at: string; slots: Readonly<Record<string, EngineSlot>> }>;

/** A phase's queue as the last pass left it; empty when none was written or the store did not answer. */
export async function readEngineQueue(store: GuardStore, cluster: string, phase: EnginePhase): Promise<Map<string, EngineSlot>> {
  const row = await store
    .collection<EngineQueue>(QUEUE)
    .get(`solana:${cluster}:${phase}`)
    .catch(() => undefined);
  return new Map(Object.entries(row?.slots ?? {}));
}

/** A phase's queue after this pass — only the markets still launched here. */
export async function writeEngineQueue(store: GuardStore, cluster: string, phase: EnginePhase, slots: ReadonlyMap<string, EngineSlot>, keep: ReadonlySet<string>, now: Date): Promise<void> {
  const kept: Record<string, EngineSlot> = {};
  for (const [token, slot] of slots) if (keep.has(token)) kept[token] = slot;
  await store.collection<EngineQueue>(QUEUE).set(`solana:${cluster}:${phase}`, { cluster, phase, at: now.toISOString(), slots: kept });
}

/* ------------------------------------------------------------------ the words to the operator */

type StoredAlerts = EngineAlertState & Readonly<{ cluster: string; at: string }>;

export async function readEngineAlerts(store: GuardStore, cluster: string): Promise<EngineAlertState> {
  const row = await store
    .collection<StoredAlerts>(ALERTS)
    .get(`solana:${cluster}`)
    .catch(() => undefined);
  return row ? { active: row.active ?? {}, attemptAt: row.attemptAt ?? null } : NO_ALERTS;
}

export async function writeEngineAlerts(store: GuardStore, cluster: string, state: EngineAlertState, now: Date): Promise<void> {
  await store.collection<StoredAlerts>(ALERTS).set(`solana:${cluster}`, { ...state, cluster, at: now.toISOString() });
}

/* ------------------------------------------------------------------ people's markets */

export type PeopleFlip = Readonly<{ open: boolean; at: string; by: string }>;

export type PeopleSwitch = Readonly<{
  version: number;
  cluster: string;
  open: boolean;
  at: string;
  /** Who flipped it last, as the admin knows them — never shown on a market's page. */
  by: string;
  /** The flips, the newest last; the last 50 kept. */
  flips: readonly PeopleFlip[];
}>;

const PEOPLE_FLIPS_KEPT = 50;

/** The switch as stored; null when it was never flipped; undefined when the store did not answer. */
export async function readPeopleSwitch(store: GuardStore, cluster: string): Promise<PeopleSwitch | null | undefined> {
  try {
    return (await store.versioned<PeopleSwitch>(PEOPLE).get(`solana:${cluster}`)) ?? null;
  } catch {
    return undefined;
  }
}

/**
 * Whether the executor claims the budget and keeps the ladder on people's Micro markets: as the operator last set it;
 * never flipped — open on devnet, closed on mainnet; not read — closed.
 */
export function peopleOpenOf(cluster: string, row: PeopleSwitch | null | undefined): boolean {
  if (row === undefined) return false;
  if (row === null) return cluster !== "mainnet";
  return row.open;
}

export async function peopleOpen(store: GuardStore, cluster: string): Promise<boolean> {
  return peopleOpenOf(cluster, await readPeopleSwitch(store, cluster));
}

/** The operator's flip of the switch; a flip that changes nothing changes nothing. */
export async function setPeopleSwitch(store: GuardStore, args: Readonly<{ cluster: string; open: boolean; by: string; now: Date }>): Promise<Readonly<{ changed: boolean; row: PeopleSwitch }>> {
  const rows = store.versioned<PeopleSwitch>(PEOPLE);
  const key = `solana:${args.cluster}`;
  return withBoundedCasRetry(async () => {
    const current = (await rows.get(key)) ?? null;
    if (peopleOpenOf(args.cluster, current) === args.open && current) return { changed: false, row: current };
    const at = args.now.toISOString();
    const next: PeopleSwitch = {
      version: (current?.version ?? -1) + 1,
      cluster: args.cluster,
      open: args.open,
      at,
      by: args.by,
      flips: [...(current?.flips ?? []), { open: args.open, at, by: args.by }].slice(-PEOPLE_FLIPS_KEPT),
    };
    return (await rows.compareAndSet(key, current ? current.version : null, next)) ? { changed: true, row: next } : false;
  });
}

/* ------------------------------------------------------------------ after a pass: what the operator hears */

/** What a pass gives the alerts — its steps and counts, as `runAutopilot` reports them. */
export type PassForAlerts = Readonly<{
  steps: readonly Readonly<{ token: string; step: string }>[];
  stats?: Readonly<{ failing: number; budget: Readonly<{ lagSeconds: number }>; floor: Readonly<{ lagSeconds: number }> }>;
}>;

/** The queue's lag the operator hears of: the ladders' as it is, the budgets' once past its own, longer, line. */
function queueLag(stats: PassForAlerts["stats"]): number {
  const floor = stats?.floor.lagSeconds ?? 0;
  const budget = stats?.budget.lagSeconds ?? 0;
  return Math.max(floor, budget > ENGINE_RULE.budgetLagAlertSeconds ? budget : 0);
}

export type EngineTold = Readonly<{ said: readonly string[]; delivered: boolean | null }>;

/**
 * After a pass: the signals it gave (`engineAlerts`), one message to the operator when there is something to say and
 * no undelivered word was tried lately, and the state kept for the next pass — with the run of failed transactions,
 * which outlives a pass.
 */
export async function tellOperator(
  store: GuardStore,
  args: Readonly<{
    cluster: string;
    pass: PassForAlerts;
    /** When the pass before this one finished; null when none was written. */
    previousAt: string | null;
    startedAt: Date;
    now: Date;
    /** How the nodes answered this pass's reads; null — not counted. */
    nodes?: EngineNodes | null;
    lamports: bigint | null;
    alert?: (text: string) => Promise<boolean>;
  }>,
): Promise<EngineTold> {
  const before = await readEngineAlerts(store, args.cluster);
  const stored = await store
    .collection<StoredAlerts & Readonly<{ sendsInRow?: number }>>(ALERTS)
    .get(`solana:${args.cluster}`)
    .catch(() => undefined);
  const sendsInRow = failedSendsInRow(stored?.sendsInRow ?? 0, args.pass.steps);
  const at = Math.floor(args.now.getTime() / 1000);
  const previous = args.previousAt ? Date.parse(args.previousAt) : Number.NaN;
  const signals: EngineSignals = {
    at,
    /* A pass that could not read its switch is no pass at work: the silence is said by the pass that comes after it. */
    silentSeconds: Number.isFinite(previous) && !args.pass.steps.some((row) => row.step === "STOPS_UNREAD") ? Math.max(0, Math.floor((args.startedAt.getTime() - previous) / 1000)) : null,
    nodes: args.nodes ?? null,
    failedSendsInRow: sendsInRow,
    lamports: args.lamports,
    paused: [...new Set(args.pass.steps.filter((row) => row.step === "STATE_PAUSED_RISK").map((row) => row.token))],
    /* The ladders' queue lags past their freshness's margin; the budgets' only past half an hour. */
    lagSeconds: queueLag(args.pass.stats),
    stopsUnread: args.pass.steps.some((row) => row.step === "STOPS_UNREAD"),
    failing: args.pass.stats?.failing ?? 0,
  };
  const { words, holding } = engineAlerts(before, signals);
  const text = engineMessage(words);
  let delivered: boolean | null = null;
  let state = before;
  if (text && engineMayTell(before, at)) {
    delivered = args.alert ? await args.alert(text).catch(() => false) : false;
    state = engineAlertsSent(before, { holding, words, delivered, at });
  } else {
    /* Nothing said now (or a word not to be tried yet): what holds is still kept, so how long it has held stays true. */
    state = { ...engineAlertsSent(before, { holding, words: [], delivered: true, at }), attemptAt: text ? before.attemptAt : null };
  }
  await store
    .collection<StoredAlerts & Readonly<{ sendsInRow: number }>>(ALERTS)
    .set(`solana:${args.cluster}`, { ...state, cluster: args.cluster, at: args.now.toISOString(), sendsInRow })
    .catch(() => undefined);
  return { said: delivered === null ? [] : words.map((word) => `${word.kind}:${word.key}`), delivered };
}
