import {
  getGuardRuntime,
  type GuardDeploymentShape,
} from "../guard/runtime.ts";
import {
  guardStoreLimitations,
  storeSupportsConcurrentInstances,
  storeSurvivesColdStart,
  type GuardStore,
  type GuardStoreDurability,
} from "../guard/store.ts";
import {
  createAgentControlStore,
  type AgentControlStore,
} from "./store.ts";
import { AgentControlPersistenceError } from "./startup.ts";

export {
  AGENT_CONTROL_PERSISTENCE_REFUSALS,
  AgentControlPersistenceError,
} from "./startup.ts";
export type { AgentControlPersistenceRefusal } from "./startup.ts";

export type AgentControlRuntime = Readonly<{
  lifecycles: AgentControlStore;
  guardStore: GuardStore;
  persistence: Readonly<{
    durability: GuardStoreDurability;
    description: string;
    deployment: GuardDeploymentShape;
    limitations: readonly string[];
  }>;
}>;

type AgentControlRuntimeOptions = Readonly<{
  store: GuardStore;
  deployment: GuardDeploymentShape;
  nodeEnv?: string;
}>;

/**
 * Agent Control is stricter than the general Guard preview.
 *
 * Memory remains useful for tests and a local demo, but Phase 2C calls the
 * authorization nonce durable. Production therefore refuses memory even on a
 * declared single instance. A multi-instance deployment additionally refuses
 * the JSON-file adapter: surviving a restart is not the same guarantee as
 * serializing concurrent writers.
 */
export function assertAgentControlPersistence({
  store,
  deployment,
  nodeEnv,
}: AgentControlRuntimeOptions): void {
  if (nodeEnv === "production" && !storeSurvivesColdStart(store)) {
    throw new AgentControlPersistenceError(
      "EPHEMERAL_STORE_IN_PRODUCTION",
      "Agent Control authorization replay protection cannot use per-process memory in production. Configure file for one instance or Postgres for multiple instances.",
    );
  }
  if (deployment === "MULTI_INSTANCE" && !storeSupportsConcurrentInstances(store)) {
    throw new AgentControlPersistenceError(
      "STORE_UNSAFE_FOR_MULTI_INSTANCE",
      `${store.durability} cannot serialize authorization nonce claims across multiple instances. Configure a durable multi-writer Guard store.`,
    );
  }
}

export function createAgentControlRuntime(
  options: AgentControlRuntimeOptions,
): AgentControlRuntime {
  assertAgentControlPersistence(options);
  return {
    lifecycles: createAgentControlStore(options.store),
    guardStore: options.store,
    persistence: {
      durability: options.store.durability,
      description: options.store.description,
      deployment: options.deployment,
      limitations: guardStoreLimitations(options.store),
    },
  };
}

const globalRuntime = globalThis as typeof globalThis & {
  __ryntraAgentControlRuntime?: AgentControlRuntime;
};

/**
 * One warm-instance facade over the same adapter Guard already configured.
 * The cache owns no state; the durable adapter remains the sole source of
 * truth across cold starts and instances.
 */
export function getAgentControlRuntime(): AgentControlRuntime {
  if (!globalRuntime.__ryntraAgentControlRuntime) {
    const guard = getGuardRuntime();
    globalRuntime.__ryntraAgentControlRuntime = createAgentControlRuntime({
      store: guard.store,
      deployment: guard.deployment,
      nodeEnv: process.env.NODE_ENV,
    });
  }
  return globalRuntime.__ryntraAgentControlRuntime;
}
