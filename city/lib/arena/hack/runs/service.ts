/**
 * An agent's run on an order, on the server (CITY-238): what happens after «Send an agent». The routes
 * (`../store/api.ts`) call `launch` once the take is written, and `feed` when a window asks how the run goes.
 *
 *   launch — the order's range (`../ranges/range.ts`), the agent's brain with its own key (`brain`), the day's ceiling
 *            on Hack's models (`RunStore.start`, one step with the write), then the run itself after the answer has
 *            gone (`background`): the step runner's loop (`../runner/brain.ts`) over a session whose sandbox is the
 *            machine with no network (`../machine/backend.ts`). The harness — never the agent — writes the journal,
 *            turn by turn, into the store; a finding the judge sealed is filed through the same service the routes
 *            use, with the judge's proof.
 *   feed   — the run as a viewer may see it. The agent's owner and the protocol's owner see the journal; anyone else
 *            sees that the agent read, built, tried and filed, and how it ended — never where the fault is, while the
 *            protocol may not have fixed it (`../store/README.md`).
 *
 * Held to: one run of an agent on an order at a time (the store); the class ceiling and the turn cap (`runAgent`); a
 * wall of time for the whole run, so it ends inside the function that plays it; the hard wall of each attempt (the
 * machine's). A run whose harness went silent is voided by the next reader, and may be started again.
 *
 * The agent signs nothing of a live network, reads no key and moves no money: its only keys are the run's own payers
 * of the copy (`../runner/assemble.ts`), dropped with the run. Nothing here pays: CITY-229 is the money.
 */

import type { Order } from "../order.ts";
import type { RangeStore } from "../ranges/range.ts";
import type { HackProof } from "../rules.ts";
import { createCopyActors, type CopyActors } from "../runner/assemble.ts";
import type { SandboxBackend } from "../runner/backend.ts";
import { runAgent, type HackBrain, type RunnerView, type TurnRecord } from "../runner/brain.ts";
import { createHackSession, type HackSeat } from "../runner/session.ts";
import { DEFAULT_LIMITS, type SandboxLimits } from "../sandbox/index.ts";
import type { Finding } from "../finding.ts";
import { dayStart, type HackRole, type Take } from "../store/contract.ts";
import { HISTORY_MAX, type RunRecord, type RunStore } from "./contract.ts";

/** An agent's brain, ready to play a run with its own key, and what it may spend. */
export type RunBrain = {
  readonly brain: HackBrain;
  /** What one move costs at the agent's pinned price, micro-dollars. */
  readonly moveMicroUsd: number;
  /** The most the agent's class may spend on one run, micro-dollars. */
  readonly ceilingMicroUsd: number;
};

/** What a brain is built from: the agent, its side, its range and its own payers of the copy. */
export type BrainAsk = { readonly hunter: string; readonly seat: HackSeat; readonly range: string; readonly payers: readonly string[] };

export type RunServiceDeps = {
  runs: RunStore;
  /** The order as the routes' store keeps it. */
  order: (id: string) => Promise<Order | null>;
  ranges: RangeStore;
  /**
   * A fresh sandbox backend for one run: one machine, closed when the run ends. Asked for while the request that
   * starts the run is still here (a deployment reads its own token for the machine then); may throw — no machine.
   */
  backend: () => SandboxBackend;
  /** The agent's brain with its own key; `null` when it has none — the agent stays quiet, nothing is called. */
  brain: (ask: BrainAsk) => Promise<RunBrain | null>;
  /** Files a finding the judge sealed, through the routes' own service; the finding's id when the store kept it. */
  file: (input: { finding: Finding; proof: HackProof; owner: string }) => Promise<string | null>;
  /** The day's ceiling on Hack's models, micro-dollars. */
  capMicroUsd: () => number;
  now: () => number;
  /** Runs work after the answer has gone. */
  background: (task: Promise<unknown>) => void;
  /** At most this many brain turns. Default 12. */
  maxTurns?: number;
  /** The whole run's wall of time, ms: it ends inside the function that plays it. Default `RUN_MS`. */
  runMs?: number;
  /** One attempt's limits in the sandbox. */
  limits?: SandboxLimits;
  /** How long a running run may go unwritten before a reader voids it. Default `STALLED_MS`: longer than any one move. */
  stalledMs?: number;
  /** The run's own payers of the copy; a stand may fix them. */
  actors?: () => CopyActors;
  /** One line per run that broke, for the server's log. */
  log?: (line: string) => void;
};

/** A day's ceiling where the deployment names none, and the most it may name (the Ring's figures). */
export const DAILY_CAP_ENV = "RYNTRA_HACK_DAILY_USD";
export const DAILY_CAP_DEFAULT_USD = 5;
export const DAILY_CAP_MAX_USD = 500;

/**
 * The ceiling in micro-dollars: a number of dollars from 0 to `DAILY_CAP_MAX_USD` (0 — no run with a model plays);
 * anything else is the default.
 */
export function dailyCapMicroUsd(value: string | undefined): number {
  const text = value?.trim();
  const usd = text && /^\d{1,4}(\.\d{1,2})?$/.test(text) ? Number(text) : DAILY_CAP_DEFAULT_USD;
  return Math.round(Math.min(usd, DAILY_CAP_MAX_USD) * 1_000_000);
}

export const RUN_MAX_TURNS = 12;
/**
 * The whole run's wall. The function that plays it lives 300 s (`app/api/arena/hack/[action]/route.ts`); a tool that
 * started just before the wall may still take two attempts on the machine and the filing, so the wall leaves room.
 */
export const RUN_MS = 200_000;
/**
 * One move's time for a model on the deployed server. A move here is a tool call over the journal so far — longer to
 * think through than a duel's move — and the whole run's wall still holds however the moves add up.
 */
export const RUN_MOVE_MS = 20_000;
/** One attempt on the machine: the sandbox's own limits with a shorter wall, so a few attempts fit a run. */
export const RUN_LIMITS: SandboxLimits = { ...DEFAULT_LIMITS, ms: 20_000 };
/** A running run nobody wrote to for this long has lost its harness: the reader voids it. */
export const STALLED_MS = 150_000;

export type LaunchRefusal =
  /** Only an attacker's run is played; a defender's take is its record. */
  | "NO_RUN_FOR_ROLE"
  /** No range is kept for the order's copy: there is nothing to run on. */
  | "NO_RANGE"
  /** The order is not open, or outside its window. */
  | "CLOSED"
  /** The agent has no key: it stays quiet. */
  | "NO_BRAIN"
  /** A run of this agent on this order is live or finished. */
  | "EXISTS"
  | "NOT_TAKEN"
  /** The day's ceiling on Hack's models is reached. */
  | "DAILY_CAP";

export type Launched = { ok: true; attempt: number } | { ok: false; reason: LaunchRefusal };

/** A run as the windows read it (`../view/contract.ts`, `RunFeed`). */
export type RunFeedView = {
  readonly order: string;
  readonly hunter: string;
  readonly role: HackRole;
  readonly status: "running" | "done";
  readonly maxTurns: number;
  readonly history: readonly TurnRecord[];
  readonly result: RunRecord["result"];
  readonly finding: string | null;
  readonly startedAt: number;
};

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (value !== null && typeof value === "object" ? (value as Rec) : {});

/** A turn as anyone may see it: that it happened and how it came out — no address, no input, no hash of the journal. */
export function sealedTurn(turn: TurnRecord): TurnRecord {
  const r = rec(turn?.result);
  const refused = r.ok === true ? null : { ok: false, refusal: typeof r.refusal === "string" ? r.refusal : "REFUSED" };
  switch (turn?.tool) {
    case "read_account":
      // Not even the account's size: in a copy whose accounts are public, a size names the account.
      return { tool: "read_account", result: refused ?? { ok: true, account: r.account === null ? null : {} } };
    case "assemble_tx":
      return { tool: "assemble_tx", result: refused ?? { ok: true, kind: r.kind ?? null, bytes: r.bytes ?? null } };
    case "run":
      return { tool: "run", result: refused ?? { ok: true, reproduced: r.reproduced ?? null, usage: r.usage ?? null } };
    case "submit":
      return { tool: "submit", result: refused ?? { ok: true, verdict: r.verdict ?? null, severity: r.severity ?? null } };
    default:
      return { tool: String(turn?.tool ?? "").slice(0, 32), result: {} };
  }
}

export function feedOf(record: RunRecord, full: boolean): RunFeedView {
  return {
    order: record.order,
    hunter: record.hunter,
    role: record.role,
    status: record.status,
    maxTurns: record.maxTurns,
    history: full ? record.history : record.history.map(sealedTurn),
    result: record.result,
    finding: record.finding,
    startedAt: record.startedAt,
  };
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? String(v) : v))) as T;
const lastTurns = (history: readonly TurnRecord[]): TurnRecord[] => plain(history.slice(-HISTORY_MAX)) as TurnRecord[];

export function createRunService(deps: RunServiceDeps) {
  const maxTurns = deps.maxTurns ?? RUN_MAX_TURNS;
  const runMs = deps.runMs ?? RUN_MS;
  const limits = deps.limits ?? RUN_LIMITS;
  const stalledMs = deps.stalledMs ?? STALLED_MS;
  const cap = () => {
    const value = deps.capMicroUsd();
    return Number.isSafeInteger(value) && value >= 0 ? value : DAILY_CAP_DEFAULT_USD * 1_000_000;
  };
  /** The proofs of findings this instance's runs sealed, until each is filed: one proof, one finding, one agent. */
  const proofs = new Map<string, { proof: HackProof; order: string; hunter: string; owner: string }>();

  async function play(record: RunRecord, order: Order, agent: RunBrain, actors: CopyActors, reserved: number, backend: SandboxBackend): Promise<void> {
    const range = deps.ranges.forTarget(order.target)!;
    const stop = new AbortController();
    let walled = false;
    const wall = setTimeout(() => {
      walled = true;
      stop.abort();
    }, runMs);
    (wall as { unref?: () => void }).unref?.();
    let current = record;
    /** What the run came to once a finding of it is filed: kept whatever happens to the last write. */
    let ended: RunRecord | null = null;
    try {
      const session = createHackSession(
        {
          order,
          pin: range.pin,
          claim: range.claim,
          actors: actors.addresses,
          limits,
          snapshot: range.snapshot,
          hunter: record.hunter,
          hunterOwner: record.owner,
          seat: record.role,
          runPrefix: `${order.id.slice(0, 20)}.${record.hunter.slice(0, 12)}.${record.attempt}`,
        },
        { backend, now: deps.now, assembler: actors.assemble },
      );
      const view: RunnerView = { seat: record.role, orderId: order.id, orderTitle: order.title, target: order.target, scope: order.scope, claim: range.claim, limits, actors: actors.addresses, history: [] };
      // The journal is the harness's: before each move it writes what the tools have answered so far.
      const watched: HackBrain = {
        async next(seen, signal) {
          current = { ...current, history: lastTurns(seen.history), updatedAt: deps.now() };
          // A reader voided it as stalled, or the store is gone: nothing played after this would count.
          if (!(await deps.runs.put(current).catch(() => false))) {
            stop.abort();
            return { kind: "void", reason: "the run is no longer kept", costMicroUsd: 0 };
          }
          return agent.brain.next(seen, signal);
        },
      };
      const outcome = await runAgent(session, watched, { view, maxTurns, classCeilingMicroUsd: reserved, moveMicroUsd: agent.moveMicroUsd, signal: stop.signal });

      const spent = Math.max(0, Math.trunc(outcome.spentMicroUsd));
      let filed: string | null = null;
      if (outcome.result === "submitted" && outcome.submission?.ok) {
        const { finding, proof } = outcome.submission;
        // The store must still hold this run as running: one a reader voided files nothing, and may be played again.
        current = { ...current, history: lastTurns(outcome.history), updatedAt: deps.now() };
        if (!(await deps.runs.put(current))) return;
        proofs.set(finding.id, { proof, order: record.order, hunter: record.hunter, owner: record.owner });
        try {
          filed = await deps.file({ finding, proof, owner: record.owner });
        } finally {
          proofs.delete(finding.id);
        }
      }
      // The run's own wall is the agent's time running out, however the brain's last call came back: it is not played again.
      const result = walled && outcome.result !== "submitted" ? "aborted" : outcome.result;
      const detail = result === "aborted" && outcome.result !== "aborted" ? "the run's time ran out" : outcome.detail.slice(0, 200);
      current = { ...current, status: "done", result, detail, history: lastTurns(outcome.history), finding: filed, cost: { reserved, spent }, updatedAt: deps.now() };
      if (filed !== null) ended = current;
      await deps.runs.put(current);
    } catch (error) {
      deps.log?.(`[hack] run stopped ${record.order} ${record.hunter} ${error instanceof Error ? error.name : "unknown"}`);
      // A finding is already filed: the run ended as it ended, and is never played again.
      if (ended) await deps.runs.put({ ...ended, updatedAt: deps.now() }).catch(() => undefined);
      // Otherwise the harness broke: nobody's fault — void, to be played again. What it may have spent stays held (the store).
      else await deps.runs.put({ ...current, status: "done", result: "void", detail: "the harness stopped", cost: { reserved, spent: null }, updatedAt: deps.now() }).catch(() => undefined);
    } finally {
      clearTimeout(wall);
      await backend.close().catch(() => undefined);
    }
  }

  /** The agent's latest run on the order, as this viewer may see it; `null` when there is none. */
  async function feed(order: string, hunter: string, viewer: string | null, protocol?: string): Promise<RunFeedView | null> {
    let record = await deps.runs.get(order, hunter);
    if (!record) return null;
    if (record.status === "running" && deps.now() - record.updatedAt > stalledMs) {
      const voided: RunRecord = { ...record, status: "done", result: "void", detail: "the harness went silent", cost: { reserved: record.cost.reserved, spent: null }, updatedAt: deps.now() };
      await deps.runs.put(voided);
      record = (await deps.runs.get(order, hunter)) ?? voided;
    }
    const full = viewer !== null && (viewer === record.owner || (protocol !== undefined && viewer === protocol));
    return feedOf(record, full);
  }

  return {
    /**
     * The proof this instance holds for a finding its own run is filing right now — the same finding of the same agent
     * of the same owner on the same order, by the same log; `null` for anything else.
     */
    proofFor: (finding: Pick<Finding, "id" | "order" | "hunter" | "hunterOwner" | "logHash">): HackProof | null => {
      const held = proofs.get(finding.id);
      if (!held || held.order !== finding.order || held.hunter !== finding.hunter || held.owner !== finding.hunterOwner) return null;
      return held.proof.judgement?.logHash === finding.logHash ? held.proof : null;
    },

    /** Whether the run store answers: the operator's check before the door opens. */
    async reachable(): Promise<boolean> {
      return deps.runs.spent(dayStart(deps.now())).then(
        () => true,
        () => false,
      );
    },

    /** Starts the agent's run on the order it took, if everything lets it; the run plays after the answer has gone. */
    async launch(take: Take): Promise<Launched> {
      if (take.role !== "attacker") return { ok: false, reason: "NO_RUN_FOR_ROLE" };
      const order = await deps.order(take.order);
      const now = deps.now();
      if (!order || order.status !== "open" || now < order.opensAt || now > order.closesAt) return { ok: false, reason: "CLOSED" };
      const range = deps.ranges.forTarget(order.target);
      if (!range) return { ok: false, reason: "NO_RANGE" };
      // A run someone else is already playing is not worth opening a key for.
      const kept = await deps.runs.get(take.order, take.hunter);
      if (kept && (kept.status === "running" ? now - kept.updatedAt <= stalledMs : kept.result !== "void")) return { ok: false, reason: "EXISTS" };
      // A live run whose harness went silent is voided first; the store then lets the next attempt start.
      if (kept && kept.status === "running") await feed(take.order, take.hunter, null);

      const actors = deps.actors?.() ?? createCopyActors(1);
      const agent = await deps.brain({ hunter: take.hunter, seat: take.role, range: range.id, payers: actors.addresses });
      if (!agent) return { ok: false, reason: "NO_BRAIN" };
      const move = Math.max(0, Math.trunc(agent.moveMicroUsd));
      const reserved = Math.max(0, Math.min(Math.trunc(agent.ceilingMicroUsd), maxTurns * move));
      const record: RunRecord = {
        order: take.order,
        hunter: take.hunter,
        owner: take.owner,
        role: take.role,
        attempt: 1,
        status: "running",
        maxTurns,
        history: [],
        result: null,
        detail: "",
        finding: null,
        cost: { reserved, spent: null },
        startedAt: now,
        updatedAt: now,
      };
      const backend = deps.backend();
      let started: Awaited<ReturnType<RunStore["start"]>>;
      try {
        started = await deps.runs.start(record, { day: dayStart(now), cap: cap() });
      } catch (error) {
        await backend.close().catch(() => undefined);
        throw error;
      }
      if (!started.ok) {
        await backend.close().catch(() => undefined);
        return { ok: false, reason: started.reason };
      }
      deps.background(play({ ...record, attempt: started.attempt }, order, { ...agent, moveMicroUsd: move }, actors, reserved, backend));
      return { ok: true, attempt: started.attempt };
    },

    feed,
  };
}

export type RunService = ReturnType<typeof createRunService>;
