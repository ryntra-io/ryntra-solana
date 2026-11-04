/**
 * CITY-162 — which adapter holds each of Launch's keys, by one switch: `RYNTRA_LAUNCH_SIGNER`.
 *
 * - unset or `env` — the key in the environment, as before (`RYNTRA_LAUNCH_POOL_PAYER_SECRET`,
 *   `RYNTRA_LAUNCH_EXECUTOR_SECRET`). Production does not change until the operator sets the switch.
 * - `kms` — the key in Google Cloud KMS: the key version (`RYNTRA_LAUNCH_POOL_PAYER_KMS_KEY`,
 *   `RYNTRA_LAUNCH_EXECUTOR_KMS_KEY`), the public address the deployment expects of it (`…_ADDRESS`), and the way in
 *   (`./gcp-kms.server.ts`). In this mode the environment's secret is never read, even where it is still set.
 * - anything else — no key at all: a switch mistyped stops the signing; it never falls back to another adapter.
 *
 * Rollback is the same switch back to `env`, while the environment's secret is still there.
 */

import { PublicKey } from "@solana/web3.js";

import { envKey } from "./env.server.ts";
import { kmsEndpoint, kmsKeySigner, kmsTokenSource, KMS_KEY_VERSION, type Fetch } from "./gcp-kms.server.ts";
import type { KeySigner, LaunchSignerMode, LaunchSignerRole } from "./signer.server.ts";

export const LAUNCH_SIGNER_SWITCH = "RYNTRA_LAUNCH_SIGNER";

/** Each role's variables: its secret in `env` mode, its key version and address in `kms` mode. */
export const LAUNCH_SIGNER_ENV: Readonly<Record<LaunchSignerRole, Readonly<{ secret: string; kmsKey: string; address: string }>>> = Object.freeze({
  "pool-payer": { secret: "RYNTRA_LAUNCH_POOL_PAYER_SECRET", kmsKey: "RYNTRA_LAUNCH_POOL_PAYER_KMS_KEY", address: "RYNTRA_LAUNCH_POOL_PAYER_ADDRESS" },
  executor: { secret: "RYNTRA_LAUNCH_EXECUTOR_SECRET", kmsKey: "RYNTRA_LAUNCH_EXECUTOR_KMS_KEY", address: "RYNTRA_LAUNCH_EXECUTOR_ADDRESS" },
});

type Env = Readonly<Record<string, string | undefined>>;

/** The adapter the switch names; null for a value that is neither — and then nothing signs. */
export function launchSignerMode(env: Env): LaunchSignerMode | null {
  const value = env[LAUNCH_SIGNER_SWITCH]?.trim().toLowerCase();
  if (!value || value === "env") return "env";
  return value === "kms" ? "kms" : null;
}

/** A Solana address as configured, or null. */
function addressOf(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    return new PublicKey(text).toBase58() === text ? text : null;
  } catch {
    return null;
  }
}

export type LaunchKey = Readonly<{ address: string; key: KeySigner }>;

/** A role's key as the switch says, with the public address it signs for; null when it is not configured here. */
export function launchKey(role: LaunchSignerRole, env: Env, options: Readonly<{ fetch?: Fetch; oidcToken?: () => Promise<string | null> }> = {}): LaunchKey | null {
  const names = LAUNCH_SIGNER_ENV[role];
  const mode = launchSignerMode(env);
  if (mode === "env") {
    const key = envKey(env[names.secret]);
    return key ? { address: key.address, key: key.signer } : null;
  }
  if (mode !== "kms") return null;
  const keyVersion = env[names.kmsKey]?.trim();
  const address = addressOf(env[names.address]);
  const endpoint = kmsEndpoint(env.RYNTRA_LAUNCH_KMS_ENDPOINT);
  const token = kmsTokenSource(env, options);
  if (!keyVersion || !KMS_KEY_VERSION.test(keyVersion) || !address || !endpoint || !token) return null;
  return { address, key: kmsKeySigner({ keyVersion, address, endpoint, token, ...(options.fetch ? { fetch: options.fetch } : {}) }) };
}
