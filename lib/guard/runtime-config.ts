export type GuardDeploymentShape = "SINGLE_INSTANCE" | "MULTI_INSTANCE";

export type GuardEnv = Record<string, string | undefined>;

export type GuardStoreConfig =
  | Readonly<{ kind: "memory" }>
  | Readonly<{ kind: "file"; directory: string }>
  | Readonly<{ kind: "postgres"; connectionString: string }>;

/**
 * Resolve deployment and storage intent without constructing a Node adapter.
 * Keeping this module free of node:* imports lets Next instrumentation reject
 * unsafe startup configuration without pulling fs, crypto, or pg into its
 * compiler graph.
 */
export function resolveGuardDeployment(env: GuardEnv): GuardDeploymentShape {
  const declared = env.RYNTRA_GUARD_DEPLOYMENT?.trim().toLowerCase();
  if (declared === "multi-instance") return "MULTI_INSTANCE";
  if (declared === "single-instance") return "SINGLE_INSTANCE";
  if (declared) {
    throw new Error(
      `Unsupported RYNTRA_GUARD_DEPLOYMENT value: ${declared}. Expected single-instance or multi-instance.`,
    );
  }
  return env.VERCEL ? "MULTI_INSTANCE" : "SINGLE_INSTANCE";
}

export function resolveGuardStoreConfig(env: GuardEnv): GuardStoreConfig {
  const kind = env.RYNTRA_GUARD_STORE?.trim().toLowerCase();
  if (kind === "postgres") {
    const connectionString = env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();
    if (!connectionString) {
      throw new Error(
        "RYNTRA_GUARD_STORE=postgres requires DATABASE_URL. Refusing to fall back to a weaker store.",
      );
    }
    return { kind, connectionString };
  }
  if (kind === "file") {
    const directory = env.RYNTRA_GUARD_STORE_DIR?.trim();
    if (!directory) {
      throw new Error(
        "RYNTRA_GUARD_STORE=file requires RYNTRA_GUARD_STORE_DIR. Refusing to fall back to memory.",
      );
    }
    return { kind, directory };
  }
  if (kind && kind !== "memory") {
    throw new Error(
      `Unsupported RYNTRA_GUARD_STORE value: ${kind}. Expected memory, file, or postgres.`,
    );
  }
  return { kind: "memory" };
}
