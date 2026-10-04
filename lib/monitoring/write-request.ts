/**
 * What `POST /api/monitoring` was asked to do — read against the contract
 * (1.11.0).
 *
 * The route used to cast its body and check no field's type: a non-boolean
 * `telegram` or `push`, a falsy `quietHours`, a window with array times or
 * extra keys, or an array body was stored as sent and served by every later
 * read of the surface — a read the contract's own schema then refused — and a
 * `null` body or a window without a timezone answered 500. Now the body is
 * one of the two the contract names: a read mark (`read` a string, every
 * other key ignored, as before) or where notes go, each field of its own
 * type; keys this route does not read are still ignored, and a window keeps
 * only its three fields.
 */

import { MonitoringPreferencesRequestSchema } from "../api/v1/contract.ts";
import type { QuietHours } from "./quiet-hours.ts";

export const QUIET_HOURS_REFUSAL = "Quiet hours need a start, an end and a timezone.";
export const PREFERENCES_REFUSAL = "Where notes go takes telegram and push as true or false, and quietHours as a window or null.";

export type MonitoringWrite =
  | Readonly<{ kind: "read"; id: string }>
  | Readonly<{ kind: "preferences"; telegram?: boolean; push?: boolean; quietHours?: QuietHours | null }>
  | Readonly<{ kind: "invalid"; message: string }>;

export function readMonitoringWrite(raw: unknown): MonitoringWrite {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { read?: unknown }).read === "string") {
    return { kind: "read", id: (raw as { read: string }).read };
  }
  const parsed = MonitoringPreferencesRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const window = parsed.error.issues.some((issue) => issue.path[0] === "quietHours");
    return { kind: "invalid", message: window ? QUIET_HOURS_REFUSAL : PREFERENCES_REFUSAL };
  }
  return { kind: "preferences", ...parsed.data };
}
