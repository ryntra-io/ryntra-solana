import { createHmac } from "crypto";

const DEFAULT_SECRET = process.env.BETA_APP_SECRET;
const ACTIONS = [
  "message_user",
  "broadcast",
  "run_fill_check",
  "access_grant",
  "access_pause",
  "access_revoke",
  "access_mode_set",
  "operator_bootstrap",
] as const;
const OUTCOMES = ["attempt", "ok", "rejected", "failed", "partial"] as const;

export type AdminAuditAction = (typeof ACTIONS)[number];
export type AdminAuditOutcome = (typeof OUTCOMES)[number];
export type AdminAuditEvent = {
  actor: string;
  action: AdminAuditAction;
  outcome: AdminAuditOutcome;
  at: string;
};

export function adminAuditAction(value: unknown): AdminAuditAction | null {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value)
    ? (value as AdminAuditAction)
    : null;
}

export function adminAuditEvent(
  adminId: number,
  action: AdminAuditAction,
  outcome: AdminAuditOutcome,
  secret: string | undefined = DEFAULT_SECRET
): AdminAuditEvent | null {
  if (!Number.isSafeInteger(adminId) || adminId <= 0 || !secret) return null;
  if (!(ACTIONS as readonly string[]).includes(action) || !(OUTCOMES as readonly string[]).includes(outcome)) {
    return null;
  }
  const actor = createHmac("sha256", secret)
    .update(`telegram-admin:${adminId}`)
    .digest("hex")
    .slice(0, 24);
  return { actor, action, outcome, at: new Date().toISOString() };
}

export function auditAdminAction(
  adminId: number,
  action: AdminAuditAction,
  outcome: AdminAuditOutcome,
  secret: string | undefined = DEFAULT_SECRET
): boolean {
  const event = adminAuditEvent(adminId, action, outcome, secret);
  if (!event) return false;
  console.info("admin.audit", event);
  return true;
}

export type AdminAuditTerminalOutcome = Exclude<AdminAuditOutcome, "attempt">;
export type AuditedAdminResult = {
  outcome: AdminAuditTerminalOutcome;
  payload: unknown;
  status?: number;
};

export async function runAuditedAdminAction(
  adminId: number,
  action: AdminAuditAction,
  operation: () => Promise<AuditedAdminResult>,
  secret: string | undefined = DEFAULT_SECRET
): Promise<AuditedAdminResult | null> {
  if (!auditAdminAction(adminId, action, "attempt", secret)) return null;

  try {
    const result = await operation();
    auditAdminAction(adminId, action, result.outcome, secret);
    return result;
  } catch {
    const result: AuditedAdminResult = {
      outcome: "failed",
      payload: { error: "action failed" },
      status: 502,
    };
    auditAdminAction(adminId, action, result.outcome, secret);
    return result;
  }
}
