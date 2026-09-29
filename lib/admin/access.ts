/**
 * Canonical access model for the Admin Control Center.
 *
 * Legacy `telegram_join` stays on disk. This resolver is what the product
 * shows and mutates. An expired control wins over a still-verified join.
 */

export const GLOBAL_BETA_MODES = ["OPEN_CONFIRM", "MANUAL_APPROVAL", "CLOSED"] as const;
export type GlobalBetaMode = (typeof GLOBAL_BETA_MODES)[number];

export const USER_ACCESS_STATES = ["REQUESTED", "ACTIVE", "PAUSED", "REVOKED", "EXPIRED"] as const;
export type UserAccessState = (typeof USER_ACCESS_STATES)[number];

export const ACCESS_MUTATIONS = ["grant", "pause", "revoke"] as const;
export type AccessMutation = (typeof ACCESS_MUTATIONS)[number];

export type AccessControlRecord = {
  state: UserAccessState;
  expiresAt: string | null;
};

export function isGlobalBetaMode(value: unknown): value is GlobalBetaMode {
  return typeof value === "string" && (GLOBAL_BETA_MODES as readonly string[]).includes(value);
}

export function isUserAccessState(value: unknown): value is UserAccessState {
  return typeof value === "string" && (USER_ACCESS_STATES as readonly string[]).includes(value);
}

export function isAccessMutation(value: unknown): value is AccessMutation {
  return typeof value === "string" && (ACCESS_MUTATIONS as readonly string[]).includes(value);
}

export function accessReasonOk(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 3 && value.trim().length <= 500;
}

/**
 * Effective per-user state.
 *
 * A stored control is the source of truth. Without one, a verified legacy join
 * is ACTIVE and everything else is REQUESTED. REVOKED never expires into
 * ACTIVE; a past `expiresAt` on any other state becomes EXPIRED.
 */
export function resolveUserAccess(input: {
  control: AccessControlRecord | null;
  legacyJoin: string | null | undefined;
  now?: Date;
}): UserAccessState {
  const now = input.now ?? new Date();
  if (input.control) {
    if (input.control.state === "REVOKED") return "REVOKED";
    if (input.control.state === "EXPIRED") return "EXPIRED";
    if (input.control.expiresAt) {
      const expires = Date.parse(input.control.expiresAt);
      if (Number.isFinite(expires) && expires <= now.getTime()) return "EXPIRED";
    }
    return input.control.state;
  }
  return input.legacyJoin === "verified" ? "ACTIVE" : "REQUESTED";
}

export function nextAccessState(mutation: AccessMutation): UserAccessState {
  if (mutation === "grant") return "ACTIVE";
  if (mutation === "pause") return "PAUSED";
  return "REVOKED";
}
