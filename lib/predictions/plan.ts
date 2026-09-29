/**
 * The Prediction Plan's lifecycle (`RYN-PREDICTIONS-001`, canon v4.3 §6.5):
 * create, edit as a new version, activate or cancel, record a Review and an
 * execution, read one or all — for the wallet that proved itself and nobody
 * else. Stored in Guard `predictionPlans` keyed `<wallet>:<planId>`,
 * versioned like the trading plans (`lib/plans/store.ts`): an edit is a new
 * version, a status change is a journal entry, compare-and-set keeps two
 * clients from both writing "version 3". Server-side validation names every
 * failing field. The model (schemas, sizing, validation) is `plan-model.ts`,
 * shared with the browser. Nothing here reads a cookie. Server only.
 */

import { randomBytes } from "node:crypto";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { failure, type PredictionFailure } from "./failure.ts";
import {
  PREDICTION_PLAN_ID,
  PREDICTION_PLAN_JOURNAL_KEPT,
  PREDICTION_PLAN_LIST_LIMIT,
  PREDICTION_PLAN_VERSIONS_KEPT,
  computePredictionSizing,
  validatePredictionRules,
  type PredictionPlan,
  type PredictionPlanStatus,
  type PredictionPlanVersion,
} from "./plan-model.ts";
import type { Result } from "./provider.ts";

export * from "./plan-model.ts";

/* ------------------------------------------------------------- store */

const KEY_PREFIX = "solana:mainnet:";
export function planKey(owner: string, planId: string): string {
  return `${KEY_PREFIX}${owner}:${planId}`;
}

function plans(store: GuardStore) {
  return store.versioned<PredictionPlan & { version: number }>("predictionPlans");
}

function newPlanId(): string {
  return `pplan_${randomBytes(12).toString("hex")}`;
}

/** A plan whose deadline passed reads as expired; the stored row is not rewritten by a read. */
export function projectedStatus(plan: PredictionPlan, nowMs: number = Date.now()): PredictionPlanStatus {
  if (plan.status === "active" || plan.status === "draft") {
    const deadline = plan.current.rules.resolutionDeadline;
    if (deadline && Date.parse(deadline) <= nowMs) return "expired";
  }
  return plan.status;
}

export function projectPlan(plan: PredictionPlan, nowMs: number = Date.now()): PredictionPlan {
  const status = projectedStatus(plan, nowMs);
  return status === plan.status ? plan : { ...plan, status };
}

export async function createPredictionPlan(
  store: GuardStore,
  input: Readonly<{ owner: string; rules: unknown; activate?: boolean }>,
  deps: Readonly<{ now?: () => Date; planId?: () => string }> = {},
): Promise<Result<PredictionPlan>> {
  const now = (deps.now ?? (() => new Date()))();
  const validated = validatePredictionRules(input.rules, now.getTime());
  if (!validated.ok) return failure("PLAN_INVALID", "The plan's rules do not make a plan; see the fields named.", { issues: validated.issues });
  const at = now.toISOString();
  const id = (deps.planId ?? newPlanId)();
  const version: PredictionPlanVersion = { version: 1, createdAt: at, reason: null, rules: validated.rules, sizing: computePredictionSizing(validated.rules) };
  const status: PredictionPlanStatus = input.activate ? "active" : "draft";
  const plan: PredictionPlan = {
    id,
    kind: "prediction",
    owner: input.owner,
    status,
    createdAt: at,
    updatedAt: at,
    version: 1,
    current: version,
    versions: [{ version: 1, createdAt: at, reason: null }],
    journal: [{ at, kind: "created", version: 1, note: null, ref: null }, ...(input.activate ? [{ at, kind: "activated" as const, version: 1, note: null, ref: null }] : [])],
    executions: [],
  };
  const inserted = await plans(store).insertIfAbsent(planKey(input.owner, id), plan);
  if (!inserted) return failure("UNAVAILABLE", "The plan id collided; try again.");
  return { ok: true, value: plan };
}

export async function readPredictionPlan(store: GuardStore, owner: string, planId: string, nowMs: number = Date.now()): Promise<Result<PredictionPlan>> {
  if (!PREDICTION_PLAN_ID.test(planId)) return failure("PLAN_NOT_FOUND", "No such plan.");
  const plan = await plans(store).get(planKey(owner, planId));
  if (!plan || plan.owner !== owner) return failure("PLAN_NOT_FOUND", "No such plan for this wallet.");
  return { ok: true, value: projectPlan(plan, nowMs) };
}

export async function listPredictionPlans(store: GuardStore, owner: string, nowMs: number = Date.now()): Promise<readonly PredictionPlan[]> {
  const rows = await plans(store).valuesWithPrefix(`${KEY_PREFIX}${owner}:`);
  return rows
    .filter((p) => p.owner === owner)
    .map((p) => projectPlan(p, nowMs))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, PREDICTION_PLAN_LIST_LIMIT);
}

type Mutation = (plan: PredictionPlan, at: string) => PredictionPlan | PredictionFailure;

async function mutate(store: GuardStore, owner: string, planId: string, expectedVersion: number, apply: Mutation, now: Date): Promise<Result<PredictionPlan>> {
  if (!PREDICTION_PLAN_ID.test(planId)) return failure("PLAN_NOT_FOUND", "No such plan.");
  const collection = plans(store);
  const key = planKey(owner, planId);
  let outcome: Result<PredictionPlan> | null = null;
  try {
    await withBoundedCasRetry(async () => {
      const current = await collection.get(key);
      if (!current || current.owner !== owner) {
        outcome = failure("PLAN_NOT_FOUND", "No such plan for this wallet.");
        return true;
      }
      if (current.version !== expectedVersion) {
        outcome = failure("PLAN_VERSION_CONFLICT", `The plan is at version ${current.version}; read it again and decide again.`);
        return true;
      }
      const next = apply(projectPlan(current, now.getTime()), now.toISOString());
      if ("ok" in next && next.ok === false) {
        outcome = next;
        return true;
      }
      const written = await collection.compareAndSet(key, current.version, next as PredictionPlan);
      if (!written) return false;
      outcome = { ok: true, value: next as PredictionPlan };
      return true;
    });
  } catch {
    return failure("UNAVAILABLE", "The plan could not be written; try again.");
  }
  return outcome ?? failure("UNAVAILABLE", "The plan could not be written; try again.");
}

export function updatePredictionPlan(store: GuardStore, owner: string, planId: string, input: Readonly<{ version: number; rules: unknown; reason?: string | null }>, now: Date = new Date()): Promise<Result<PredictionPlan>> {
  return mutate(
    store,
    owner,
    planId,
    input.version,
    (plan, at) => {
      if (plan.status === "executed" || plan.status === "cancelled" || plan.status === "expired") return failure("PLAN_STATE_REFUSED", `A ${plan.status} plan is not edited; write a new one.`);
      const validated = validatePredictionRules(input.rules, now.getTime());
      if (!validated.ok) return failure("PLAN_INVALID", "The plan's rules do not make a plan; see the fields named.", { issues: validated.issues });
      const nextVersion: PredictionPlanVersion = { version: plan.version + 1, createdAt: at, reason: input.reason ?? null, rules: validated.rules, sizing: computePredictionSizing(validated.rules) };
      return {
        ...plan,
        version: nextVersion.version,
        updatedAt: at,
        current: nextVersion,
        versions: [...plan.versions, { version: nextVersion.version, createdAt: at, reason: nextVersion.reason }].slice(-PREDICTION_PLAN_VERSIONS_KEPT),
        journal: [...plan.journal, { at, kind: "edited" as const, version: nextVersion.version, note: input.reason ?? null, ref: null }].slice(-PREDICTION_PLAN_JOURNAL_KEPT),
      };
    },
    now,
  );
}

export function setPredictionPlanStatus(store: GuardStore, owner: string, planId: string, input: Readonly<{ version: number; status: "active" | "cancelled"; note?: string | null }>, now: Date = new Date()): Promise<Result<PredictionPlan>> {
  return mutate(
    store,
    owner,
    planId,
    input.version,
    (plan, at) => {
      if (input.status === "active" && plan.status !== "draft") return failure("PLAN_STATE_REFUSED", `A ${plan.status} plan is not activated.`);
      if (input.status === "cancelled" && (plan.status === "executed" || plan.status === "cancelled")) return failure("PLAN_STATE_REFUSED", `A ${plan.status} plan is not cancelled.`);
      return {
        ...plan,
        status: input.status,
        updatedAt: at,
        journal: [...plan.journal, { at, kind: (input.status === "active" ? "activated" : "cancelled") as "activated" | "cancelled", version: plan.version, note: input.note ?? null, ref: null }].slice(-PREDICTION_PLAN_JOURNAL_KEPT),
      };
    },
    now,
  );
}

/** The Review and the execution of a paper order under this plan, recorded on it. */
export function recordPredictionPlanExecution(store: GuardStore, owner: string, planId: string, input: Readonly<{ quoteId: string; state: string; kind: "reviewed" | "executed" }>, now: Date = new Date()): Promise<Result<PredictionPlan>> {
  return (async () => {
    const collection = plans(store);
    const key = planKey(owner, planId);
    const current = await collection.get(key);
    if (!current || current.owner !== owner) return failure("PLAN_NOT_FOUND", "No such plan for this wallet.");
    return mutate(
      store,
      owner,
      planId,
      current.version,
      (plan, at) => {
        const executions = plan.executions.some((e) => e.quoteId === input.quoteId)
          ? plan.executions.map((e) => (e.quoteId === input.quoteId ? { ...e, state: input.state } : e))
          : [...plan.executions, { quoteId: input.quoteId, at, state: input.state }].slice(-50);
        const filled = input.kind === "executed" && /filled/.test(input.state);
        return {
          ...plan,
          status: (filled && plan.status === "active" ? "executed" : plan.status) as PredictionPlanStatus,
          updatedAt: at,
          executions,
          journal: [...plan.journal, { at, kind: input.kind as "reviewed" | "executed", version: plan.version, note: input.state, ref: input.quoteId }].slice(-PREDICTION_PLAN_JOURNAL_KEPT),
        };
      },
      now,
    );
  })();
}
