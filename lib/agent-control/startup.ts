import {
  resolveGuardDeployment,
  resolveGuardStoreConfig,
  type GuardDeploymentShape,
  type GuardEnv,
  type GuardStoreConfig,
} from "../guard/runtime-config.ts";

export const AGENT_CONTROL_PERSISTENCE_REFUSALS = [
  "EPHEMERAL_STORE_IN_PRODUCTION",
  "STORE_UNSAFE_FOR_MULTI_INSTANCE",
] as const;

export type AgentControlPersistenceRefusal =
  (typeof AGENT_CONTROL_PERSISTENCE_REFUSALS)[number];

export class AgentControlPersistenceError extends Error {
  readonly reasonCode: AgentControlPersistenceRefusal;

  constructor(reasonCode: AgentControlPersistenceRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "AgentControlPersistenceError";
    this.reasonCode = reasonCode;
  }
}

export type AgentControlStartupConfig = Readonly<{
  deployment: GuardDeploymentShape;
  store: GuardStoreConfig;
}>;

/**
 * Fail before a production server accepts traffic with an unsafe nonce ledger.
 * This assertion deliberately resolves configuration only: the request runtime
 * separately validates the constructed adapter, so neither layer can silently
 * substitute a weaker store.
 */
export function assertAgentControlStartupEnvironment(
  env: GuardEnv,
  nodeEnv = env.NODE_ENV,
): AgentControlStartupConfig {
  const deployment = resolveGuardDeployment(env);
  const store = resolveGuardStoreConfig(env);

  if (nodeEnv === "production" && store.kind === "memory") {
    throw new AgentControlPersistenceError(
      "EPHEMERAL_STORE_IN_PRODUCTION",
      "Agent Control authorization replay protection cannot use per-process memory in production. Configure file for one instance or Postgres for multiple instances.",
    );
  }
  if (deployment === "MULTI_INSTANCE" && store.kind !== "postgres") {
    const durability = store.kind === "file"
      ? "DURABLE_SINGLE_WRITER"
      : "EPHEMERAL_SINGLE_INSTANCE";
    throw new AgentControlPersistenceError(
      "STORE_UNSAFE_FOR_MULTI_INSTANCE",
      `${durability} cannot serialize authorization nonce claims across multiple instances. Configure a durable multi-writer Guard store.`,
    );
  }

  return { deployment, store };
}
