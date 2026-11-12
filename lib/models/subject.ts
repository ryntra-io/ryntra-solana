/**
 * Who a model call is for (CITY-45; `hack-agent` — CITY-238). One list, read by the gateway's call, its journal and the
 * key manager, so a new caller of models is named in one place:
 *
 *   vault-guard — a Vault's guard (CITY-47);
 *   ring-agent  — a Ring's agent in a duel (CITY-50, CITY-51);
 *   hack-agent  — an Arena agent working a Hack order's copy (CITY-225): the same agent and its own key, journaled
 *                 apart so a day's spend on Hack is told from the Ring's.
 *
 * Pure: no store, no clock, no network.
 */

import { ModelGatewayError } from "./errors.ts";
import type { ModelSubject } from "./types.ts";

export const SUBJECT_KINDS = ["vault-guard", "ring-agent", "hack-agent"] as const satisfies readonly ModelSubject["kind"][];

/** A guard's or an agent's own id: 1–64 of `A–Z a–z 0–9 . _ : -`. */
export const SUBJECT_ID = /^[A-Za-z0-9._:-]{1,64}$/;

const KINDS_TEXT = SUBJECT_KINDS.map((kind) => `"${kind}"`).join(" | ");

/** The subject as the gateway keeps it, or `null` for anything that is not one. */
export function readSubject(value: unknown): ModelSubject | null {
  const subject = value as { kind?: unknown; id?: unknown } | null | undefined;
  if (!subject || typeof subject !== "object") return null;
  if (!(SUBJECT_KINDS as readonly unknown[]).includes(subject.kind) || typeof subject.id !== "string" || !SUBJECT_ID.test(subject.id)) return null;
  return { kind: subject.kind as ModelSubject["kind"], id: subject.id };
}

export const badSubject = (): ModelGatewayError =>
  new ModelGatewayError("invalid_request", `subject is { kind: ${KINDS_TEXT}, id } with an id of 1–64 safe characters.`);
