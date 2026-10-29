/**
 * One A2A task, at most one answer — and a peer's «completed» is never the
 * answer.
 *
 * Two paths share this ledger because they share one invariant. On the served
 * side another agent system sends Ryntra a message and Ryntra answers with a
 * task. On the placed side Ryntra orders work from somebody else's agent and
 * watches their task. Both have to survive a retry, and in both the dangerous
 * moment is the same: a terminal state arriving from the other party, read as
 * though it settled something here.
 *
 * ## Two keys, claimed together
 *
 * A task is claimed on **two** keys in one atomic insert, the arrangement
 * `../procurement/fulfilment.ts` uses for a payment:
 *
 * - `…:task:<taskId>` — the task itself.
 * - `…:request:<requestKey>` — what asked for it. On the served side that is
 *   the caller's own `messageId`; on the placed side it is the idempotency key
 *   the order was placed under.
 *
 * The request key is what makes a repeated order one order. A client whose
 * connection dropped resends the same message, finds the task it already has,
 * and gets that task back — not a second one with a second life of its own.
 * Without the key, two identical orders would each be individually correct and
 * the work would be commissioned twice.
 *
 * `insertAllIfAbsent` writes both keys or neither, so two requests arriving
 * together cannot each win one.
 *
 * ## A terminal state is a record of a terminal state
 *
 * `./inbound.ts` says it for the proposal path and this module enforces it for
 * the ledger: `TASK_STATE_COMPLETED` from the other party is a **claim about
 * delivery**, and the only thing it moves here is a field named for exactly
 * that. It does not move the delivery axis, because
 * `../payments/vocabulary.ts` lists the sources admissible to that axis and a
 * counterparty's assertion about its own performance is not one of them. Taking
 * it would be letting the party with the interest certify its own work.
 *
 * What does move the delivery axis is Ryntra observing the thing — the
 * artifact read, the resource answered, the owner saying on the record what
 * they received. Until then a claimed completion sits as a claim with
 * reconciliation `PENDING`, which is an honest state and not a missing field.
 *
 * ## A deadline that passes is an unknown, not a retry
 *
 * A task with no terminal answer by its deadline becomes `UNKNOWN` with
 * reconciliation `UNKNOWN`. Nothing is re-sent, nothing is re-ordered and
 * nothing is charged again: the same rule the procurement ledger applies to a
 * settlement nobody can confirm, for the same reason — a timeout says we do not
 * know what happened, and ordering again is acting as though we did.
 */

import { createHash } from "node:crypto";

import type { GuardStore } from "../../guard/store.ts";
import {
  ADMISSIBLE_SOURCES,
  type EvidenceSourceKind,
  type ReconciliationStatus,
  type ServiceDeliveryStatus,
} from "../payments/vocabulary.ts";
import {
  A2A_INTERRUPTED_STATES,
  A2A_TASK_STATES,
  A2A_TERMINAL_STATES,
  type A2aTaskState,
} from "./inbound.ts";

const COLLECTION = "agentExternalTasks" as const;

/** Which side of the protocol a row belongs to. Ryntra answers, and Ryntra asks. */
export const A2A_TASK_SIDES = ["SERVED", "PLACED"] as const;

export type A2aTaskSide = (typeof A2A_TASK_SIDES)[number];

/** What the other party has asserted about finishing, as its own field. */
export const DELIVERY_CLAIMS = ["NONE", "COUNTERPARTY_CLAIMED_COMPLETED"] as const;

export type DeliveryClaim = (typeof DELIVERY_CLAIMS)[number];

export type A2aTaskRecord = Readonly<{
  kind: "A2A_TASK";
  version: number;
  side: A2aTaskSide;
  taskId: string;
  contextId: string;
  /** The caller's message id, or the key an order was placed under. */
  requestKey: string;
  requestDigest: string;
  /** The digest of the peer's Agent Card, when there was one. */
  peerCardDigest: string | null;
  state: A2aTaskState;
  stateClass: "OPEN" | "INTERRUPTED" | "TERMINAL";
  /** What the other party says about its own performance. Never evidence. */
  deliveryClaim: DeliveryClaim;
  serviceDeliveryStatus: ServiceDeliveryStatus;
  serviceDeliverySource: EvidenceSourceKind | null;
  reconciliation: ReconciliationStatus;
  /** Unix milliseconds by which a terminal answer was expected, or null. */
  deadlineMs: number | null;
  timedOut: boolean;
  claimedAtMs: number;
  updatedAtMs: number;
}>;

/** A request's single-use marker. It points at a task and holds nothing else. */
export type A2aRequestClaim = Readonly<{
  kind: "A2A_REQUEST";
  version: number;
  side: A2aTaskSide;
  requestKey: string;
  taskId: string;
  claimedAtMs: number;
}>;

export type A2aTaskRow = A2aTaskRecord | A2aRequestClaim;

export const TASK_LEDGER_REFUSALS = [
  "TASK_ALREADY_CLAIMED",
  "REQUEST_ALREADY_ANSWERED",
  "TASK_UNKNOWN",
  "CLAIM_CONTENDED",
  "TASK_ALREADY_TERMINAL",
  "TASK_ALREADY_EXPIRED",
  "STATE_NOT_PUBLISHED_BY_A2A",
  "DELIVERY_SOURCE_INADMISSIBLE",
  "DELIVERY_ALREADY_RECORDED",
] as const;

export type TaskLedgerRefusal = (typeof TASK_LEDGER_REFUSALS)[number];

const taskKey = (side: A2aTaskSide, taskId: string) => `${side.toLowerCase()}:task:${taskId}`;
const requestKeyOf = (side: A2aTaskSide, requestKey: string) =>
  `${side.toLowerCase()}:request:${requestKey}`;

/** A plain digest over canonical JSON, the shape the hosted receipts already use. */
export function requestDigest(value: unknown): string {
  return `0x${createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex")}`;
}

export function a2aStateClass(state: A2aTaskState): "OPEN" | "INTERRUPTED" | "TERMINAL" {
  if ((A2A_TERMINAL_STATES as readonly string[]).includes(state)) return "TERMINAL";
  if ((A2A_INTERRUPTED_STATES as readonly string[]).includes(state)) return "INTERRUPTED";
  return "OPEN";
}

export type TaskClaimInput = Readonly<{
  side: A2aTaskSide;
  taskId: string;
  contextId: string;
  requestKey: string;
  requestDigest: string;
  peerCardDigest: string | null;
  state: A2aTaskState;
  deadlineMs: number | null;
  nowMs: number;
}>;

export type TaskClaimOutcome =
  | Readonly<{ ok: true; record: A2aTaskRecord }>
  | Readonly<{
      ok: false;
      reasonCode: TaskLedgerRefusal;
      detail: string;
      /** The task that already answers this request, when one does. */
      record: A2aTaskRecord | null;
    }>;

export type TaskUpdateOutcome =
  | Readonly<{ ok: true; record: A2aTaskRecord }>
  | Readonly<{ ok: false; reasonCode: TaskLedgerRefusal; detail: string }>;

export type A2aTaskLedger = Readonly<{
  claim(input: TaskClaimInput): Promise<TaskClaimOutcome>;
  /**
   * Record the state a task now has.
   *
   * On the placed side that is what the other party reports; on the served
   * side it is what Ryntra answered. One method for both because the rules
   * below are about the state, not about who moved it — and a second method
   * for the served side would be a second place to get them wrong.
   *
   * A completed state sets the claim field and leaves the delivery axis where
   * it was. A failed, canceled or rejected state is terminal and closes the
   * task with reconciliation `FAILED` — nobody is owed an artifact that was
   * refused.
   */
  recordTaskState(input: {
    side: A2aTaskSide;
    taskId: string;
    state: A2aTaskState;
    nowMs: number;
  }): Promise<TaskUpdateOutcome>;
  /** Record what Ryntra itself observed of the deliverable. Once. */
  recordDelivery(input: {
    side: A2aTaskSide;
    taskId: string;
    delivered: boolean;
    source: EvidenceSourceKind;
    nowMs: number;
  }): Promise<TaskUpdateOutcome>;
  /** Close an answer that never came. Changes nothing outside this row. */
  expire(input: { side: A2aTaskSide; taskId: string; nowMs: number }): Promise<TaskUpdateOutcome>;
  read(side: A2aTaskSide, taskId: string): Promise<A2aTaskRecord | null>;
  readByRequest(side: A2aTaskSide, requestKey: string): Promise<A2aTaskRecord | null>;
}>;

/** How many times a lost compare-and-set is re-attempted before it is reported. */
const MAX_ATTEMPTS = 5;

export function createA2aTaskLedger(store: GuardStore): A2aTaskLedger {
  const rows = store.versioned<A2aTaskRow>(COLLECTION);

  const readTask = async (side: A2aTaskSide, taskId: string): Promise<A2aTaskRecord | null> => {
    const row = await rows.get(taskKey(side, taskId));
    return row && row.kind === "A2A_TASK" ? row : null;
  };

  const update = async (
    side: A2aTaskSide,
    taskId: string,
    decide: (current: A2aTaskRecord) => TaskUpdateOutcome,
  ): Promise<TaskUpdateOutcome> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await readTask(side, taskId);
      if (!current) {
        return Object.freeze({
          ok: false as const,
          reasonCode: "TASK_UNKNOWN" as const,
          detail: `no task ${taskId} is held on the ${side.toLowerCase()} side`,
        });
      }
      const decided = decide(current);
      if (!decided.ok) return decided;
      const won = await rows.compareAndSet(taskKey(side, taskId), current.version, decided.record);
      if (won) return decided;
    }
    return Object.freeze({
      ok: false as const,
      reasonCode: "CLAIM_CONTENDED" as const,
      detail: `the row for ${taskId} did not settle within ${MAX_ATTEMPTS} attempts`,
    });
  };

  return Object.freeze({
    async claim(input: TaskClaimInput): Promise<TaskClaimOutcome> {
      if (!(A2A_TASK_STATES as readonly string[]).includes(input.state)) {
        return Object.freeze({
          ok: false as const,
          reasonCode: "STATE_NOT_PUBLISHED_BY_A2A" as const,
          detail: "a task state is one of the nine the protocol publishes",
          record: null,
        });
      }

      const stateClass = a2aStateClass(input.state);
      const record: A2aTaskRecord = Object.freeze({
        kind: "A2A_TASK" as const,
        version: 1,
        side: input.side,
        taskId: input.taskId,
        contextId: input.contextId,
        requestKey: input.requestKey,
        requestDigest: input.requestDigest,
        peerCardDigest: input.peerCardDigest,
        state: input.state,
        stateClass,
        deliveryClaim: "NONE" as const,
        /* `REQUESTED` is what happened, and the source stays `null` until
           somebody observes the deliverable. Filling it in at the moment of
           asking would put an evidence source on an event that is not
           evidence of anything — the ledger would then be able to answer
           «who says so» about a delivery nobody has seen. */
        serviceDeliveryStatus: "REQUESTED" as const,
        serviceDeliverySource: null,
        reconciliation: "PENDING" as const,
        deadlineMs: input.deadlineMs,
        timedOut: false,
        claimedAtMs: input.nowMs,
        updatedAtMs: input.nowMs,
      });

      const claim: A2aRequestClaim = Object.freeze({
        kind: "A2A_REQUEST" as const,
        version: 1,
        side: input.side,
        requestKey: input.requestKey,
        taskId: input.taskId,
        claimedAtMs: input.nowMs,
      });

      const won = await rows.insertAllIfAbsent([
        { key: taskKey(input.side, input.taskId), value: record },
        { key: requestKeyOf(input.side, input.requestKey), value: claim },
      ]);
      if (won) return Object.freeze({ ok: true as const, record });

      /* The same request arriving twice is the common case and it is not an
         error: the caller gets the task it already has. A different request
         reaching an existing task id is a collision, and reporting it as the
         first case would hand somebody else's task to the wrong caller. */
      const existingClaim = await rows.get(requestKeyOf(input.side, input.requestKey));
      if (existingClaim && existingClaim.kind === "A2A_REQUEST") {
        const held = await readTask(input.side, existingClaim.taskId);
        return Object.freeze({
          ok: false as const,
          reasonCode: "REQUEST_ALREADY_ANSWERED" as const,
          detail: `request ${input.requestKey} was already answered by task ${existingClaim.taskId}`,
          record: held,
        });
      }
      return Object.freeze({
        ok: false as const,
        reasonCode: "TASK_ALREADY_CLAIMED" as const,
        detail: `task ${input.taskId} is held under a different request`,
        record: null,
      });
    },

    recordTaskState({ side, taskId, state, nowMs }) {
      return update(side, taskId, (current) => {
        if (!(A2A_TASK_STATES as readonly string[]).includes(state)) {
          return Object.freeze({
            ok: false as const,
            reasonCode: "STATE_NOT_PUBLISHED_BY_A2A" as const,
            detail: "a task state is one of the nine the protocol publishes",
          });
        }
        if (current.stateClass === "TERMINAL") {
          return Object.freeze({
            ok: false as const,
            reasonCode: "TASK_ALREADY_TERMINAL" as const,
            detail: `task ${taskId} already ended as ${current.state}`,
          });
        }

        const stateClass = a2aStateClass(state);
        const completed = state === "TASK_STATE_COMPLETED";
        /* A peer saying it failed, cancelled or refused is also a claim about
           itself, and it is taken while «completed» is not. The asymmetry is
           deliberate: believing a negative claim only ever withholds credit
           for work, while believing a positive one grants it. Fail closed in
           the direction that cannot be gamed. */
        const refused =
          state === "TASK_STATE_FAILED" ||
          state === "TASK_STATE_CANCELED" ||
          state === "TASK_STATE_REJECTED";

        return Object.freeze({
          ok: true as const,
          record: Object.freeze({
            ...current,
            version: current.version + 1,
            state,
            stateClass,
            /* The whole point of the module: a completed state from the other
               party moves this field and nothing else. */
            deliveryClaim: completed ? ("COUNTERPARTY_CLAIMED_COMPLETED" as const) : current.deliveryClaim,
            serviceDeliveryStatus: refused
              ? ("NOT_DELIVERED" as const)
              : current.serviceDeliveryStatus,
            serviceDeliverySource: current.serviceDeliverySource,
            reconciliation: refused ? ("FAILED" as const) : current.reconciliation,
            updatedAtMs: nowMs,
          }),
        });
      });
    },

    recordDelivery({ side, taskId, delivered, source, nowMs }) {
      return update(side, taskId, (current) => {
        /* The admissibility check runs before anything else, the order
           `../payments/vocabulary.ts` sets: a structurally inadmissible source
           reported as "already recorded" or "too early" invites somebody to fix
           the wrong thing and come back with the same claim. */
        if (!ADMISSIBLE_SOURCES.serviceDelivery.includes(source)) {
          return Object.freeze({
            ok: false as const,
            reasonCode: "DELIVERY_SOURCE_INADMISSIBLE" as const,
            detail: `${source} may not speak to delivery; a peer's own assertion about its performance is not an observation of it`,
          });
        }
        if (current.serviceDeliveryStatus === "DELIVERED" || current.serviceDeliveryStatus === "NOT_DELIVERED") {
          return Object.freeze({
            ok: false as const,
            reasonCode: "DELIVERY_ALREADY_RECORDED" as const,
            detail: `task ${taskId} already records delivery as ${current.serviceDeliveryStatus}`,
          });
        }

        return Object.freeze({
          ok: true as const,
          record: Object.freeze({
            ...current,
            version: current.version + 1,
            serviceDeliveryStatus: delivered ? ("DELIVERED" as const) : ("NOT_DELIVERED" as const),
            serviceDeliverySource: source,
            reconciliation: delivered ? ("MATCHED" as const) : ("DEVIATION" as const),
            updatedAtMs: nowMs,
          }),
        });
      });
    },

    expire({ side, taskId, nowMs }) {
      return update(side, taskId, (current) => {
        if (current.stateClass === "TERMINAL") {
          return Object.freeze({
            ok: false as const,
            reasonCode: "TASK_ALREADY_TERMINAL" as const,
            detail: `task ${taskId} ended as ${current.state} and needs no expiry`,
          });
        }
        /* Expiring twice would write a second «we still do not know» over the
           first and move the row's timestamps, which would make a long-dead
           order look freshly handled. */
        if (current.timedOut) {
          return Object.freeze({
            ok: false as const,
            reasonCode: "TASK_ALREADY_EXPIRED" as const,
            detail: `task ${taskId} is already unknown; nothing re-expires`,
          });
        }
        return Object.freeze({
          ok: true as const,
          record: Object.freeze({
            ...current,
            version: current.version + 1,
            /* The state the protocol itself defines as "unknown or
               indeterminate". Writing `FAILED` would assert that the other
               party failed, which is a fact nobody here observed. */
            state: "TASK_STATE_UNSPECIFIED" as const,
            stateClass: a2aStateClass("TASK_STATE_UNSPECIFIED"),
            serviceDeliveryStatus: "UNKNOWN" as const,
            reconciliation: "UNKNOWN" as const,
            timedOut: true,
            updatedAtMs: nowMs,
          }),
        });
      });
    },

    read: readTask,

    async readByRequest(side, key) {
      const row = await rows.get(requestKeyOf(side, key));
      if (!row || row.kind !== "A2A_REQUEST") return null;
      return readTask(side, row.taskId);
    },
  });
}
