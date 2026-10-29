/**
 * The gateway's keys — only from the server's environment, by name. The operator puts
 * them on the deployment; a session never creates, reads out or asks for one.
 *
 * - `OPENROUTER_API_KEY` — the shared key for calls that bring no key of their own.
 * - `OPENROUTER_MANAGEMENT_KEY` — the management key: it creates and switches off
 *   the per-agent and per-guard keys, and cannot call a model itself.
 *
 * Pure: reads only the record it is handed.
 */

import { ModelGatewayError } from "./errors.ts";

export const MODELS_ENV = {
  apiKey: "OPENROUTER_API_KEY",
  managementKey: "OPENROUTER_MANAGEMENT_KEY",
} as const;

export type ModelsEnv = Readonly<Record<string, string | undefined>>;

/** A key is one printable token; anything with a space or a control character is a paste gone wrong, not a key. */
const KEY_SHAPE = /^[\x21-\x7e]{8,512}$/;

/** The key's value, or `null` when the variable is missing, empty or not a key's shape. */
export function readKey(env: ModelsEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value && KEY_SHAPE.test(value) ? value : null;
}

/** Whether a key handed in by a caller (an agent's own, from the server's secret store) is a key's shape. */
export function keyShaped(value: unknown): value is string {
  return typeof value === "string" && KEY_SHAPE.test(value);
}

/** The clear error for a missing key: which variable, where it goes, and that a session never adds it. */
export function missingKey(name: string): ModelGatewayError {
  return new ModelGatewayError(
    "no_key",
    `${name} is not set on this server. It belongs in the deployment's environment, never in the code; nothing is called without it.`,
  );
}
