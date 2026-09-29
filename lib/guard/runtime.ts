import { randomUUID } from "node:crypto";

import { FixedWindowLimiter } from "../http-control.ts";
import { createGuardService } from "./service.ts";
import {
  resolveGuardDeployment,
  resolveGuardStoreConfig,
  type GuardDeploymentShape,
  type GuardEnv,
} from "./runtime-config.ts";
import { createPostgresGuardStore } from "./store-postgres.ts";
import {
  createFileGuardStore,
  createMemoryGuardStore,
  storeSupportsConcurrentInstances,
  storeSurvivesColdStart,
  type GuardStore,
} from "./store.ts";

export { resolveGuardDeployment } from "./runtime-config.ts";
export type { GuardDeploymentShape } from "./runtime-config.ts";

export type GuardWriteGate =
  | { allowed: true }
  | { allowed: false; reason: string; requiredAction: string };

type GuardRuntime = {
  service: ReturnType<typeof createGuardService>;
  limiter: FixedWindowLimiter;
  store: GuardStore;
  deployment: GuardDeploymentShape;
  writes: GuardWriteGate;
};

const globalRuntime = globalThis as typeof globalThis & {
  __ryntraGuardPrototypeRuntime?: GuardRuntime;
};

/**
 * The clock and the identifiers of every service built over the runtime's
 * store — this runtime's own and those attached beside it, so records written
 * through either read the same way.
 */
export function guardNow(): string {
  return new Date().toISOString();
}

export function newGuardId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function resolveGuardStore(env: GuardEnv): GuardStore {
  const config = resolveGuardStoreConfig(env);
  if (config.kind === "postgres") {
    return createPostgresGuardStore({ connectionString: config.connectionString });
  }
  if (config.kind === "file") {
    return createFileGuardStore({ directory: config.directory });
  }
  return createMemoryGuardStore();
}

/**
 * Fail-closed durability gate.
 *
 * A store that cannot outlive one instance is a legitimate local demo and a
 * correctness bug behind several instances: a caller would create an intent on
 * one instance and be told it never existed on the next. Rather than degrade
 * quietly, state-changing requests are refused with a structured error naming
 * the exact configuration that is missing.
 */
export function resolveGuardWriteGate(
  store: GuardStore,
  deployment: GuardDeploymentShape,
): GuardWriteGate {
  if (deployment === "SINGLE_INSTANCE") return { allowed: true };
  if (storeSupportsConcurrentInstances(store)) return { allowed: true };
  return {
    allowed: false,
    reason: storeSurvivesColdStart(store)
      ? "The configured Guard store is durable for a single writer only and cannot back a multi-instance deployment."
      : "The configured Guard store is per-process memory and cannot back a multi-instance deployment.",
    requiredAction: "CONFIGURE_DURABLE_MULTI_WRITER_GUARD_STORE",
  };
}

/* Payouts are not built here: other entry points build them over this
   runtime's store, and the kernel imports nothing of theirs. */
function createRuntime(env: GuardEnv): GuardRuntime {
  const store = resolveGuardStore(env);
  const deployment = resolveGuardDeployment(env);
  return {
    service: createGuardService({
      now: guardNow,
      createId: newGuardId,
      store,
    }),
    limiter: new FixedWindowLimiter({ limit: 120, windowMs: 60_000, maxKeys: 5_000 }),
    store,
    deployment,
    writes: resolveGuardWriteGate(store, deployment),
  };
}

/**
 * Process-wide Guard runtime. The state itself lives in the configured store,
 * not here; this cache only avoids rebuilding the adapter and rate limiter on
 * every request within one warm instance.
 */
export function getGuardRuntime(): GuardRuntime {
  globalRuntime.__ryntraGuardPrototypeRuntime ??= createRuntime(process.env);
  return globalRuntime.__ryntraGuardPrototypeRuntime;
}
