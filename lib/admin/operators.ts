/**
 * Admin operator authority.
 *
 * Long-term source of truth is `admin_operators`. Channel membership is only
 * a bootstrap for an empty table, or a fail-closed fallback while the
 * migration is unapplied. Once any operator row exists, a channel admin who
 * is not in the table is refused.
 */

export type OperatorRole = "OWNER";

export type OperatorLookup =
  | { status: "unmigrated" }
  | { status: "empty" }
  | { status: "unknown" }
  | { status: "operator"; active: boolean; role: OperatorRole };

export type AdminAuthorityDecision = {
  allow: boolean;
  bootstrap: boolean;
  source: "operators" | "bootstrap" | "legacy_channel" | "denied";
};

export function decideAdminAuthority(
  lookup: OperatorLookup,
  channelAdmin: boolean,
): AdminAuthorityDecision {
  if (lookup.status === "operator") {
    if (lookup.active) {
      return { allow: true, bootstrap: false, source: "operators" };
    }
    return { allow: false, bootstrap: false, source: "denied" };
  }
  if (lookup.status === "empty") {
    if (channelAdmin) return { allow: true, bootstrap: true, source: "bootstrap" };
    return { allow: false, bootstrap: false, source: "denied" };
  }
  if (lookup.status === "unmigrated") {
    if (channelAdmin) return { allow: true, bootstrap: false, source: "legacy_channel" };
    return { allow: false, bootstrap: false, source: "denied" };
  }
  return { allow: false, bootstrap: false, source: "denied" };
}

export function parseOperatorLookup(value: unknown): OperatorLookup {
  if (value == null || typeof value !== "object") return { status: "unknown" };
  const row = value as Record<string, unknown>;
  if (row.status === "unmigrated" || row.status === "empty" || row.status === "unknown") {
    return { status: row.status };
  }
  if (row.status === "operator") {
    return {
      status: "operator",
      active: row.active === true,
      role: "OWNER",
    };
  }
  if (row.kind === "none") {
    const count = typeof row.operator_count === "number" ? row.operator_count : -1;
    if (count === 0) return { status: "empty" };
    return { status: "unknown" };
  }
  if (row.kind === "operator") {
    return {
      status: "operator",
      active: row.active === true,
      role: "OWNER",
    };
  }
  return { status: "unknown" };
}
