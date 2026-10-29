import { rpcOrNull } from "../supabase-rpc";
import { isChannelAdmin } from "../telegram/api";
import { LINKS } from "../beta/types";
import { decideAdminAuthority, parseOperatorLookup, type AdminAuthorityDecision } from "./operators";
import {
  accessReasonOk,
  isAccessMutation,
  isGlobalBetaMode,
  nextAccessState,
  type AccessMutation,
  type GlobalBetaMode,
  type UserAccessState,
} from "./access";
import { stripForbiddenAdminProperties } from "./privacy";
import type { BroadcastAudience, BroadcastListRow, CampaignState } from "./broadcast";
import type { FeedbackListRow } from "./feedback";
import { prefsFromRow, type NotificationPrefs } from "./notifications";

export type { FeedbackListRow };

const rpc = <T,>(fn: string, args: Record<string, unknown>, quiet = false) =>
  rpcOrNull<T>("admin", fn, args, { quiet });

export async function lookupOperator(telegramId: number) {
  const row = await rpc<unknown>("admin_operator_status", { p_telegram_id: telegramId }, true);
  if (row == null) return parseOperatorLookup({ status: "unmigrated" });
  return parseOperatorLookup(row);
}

export async function bootstrapOperator(telegramId: number, displayName: string | null): Promise<boolean> {
  const row = await rpc<{ ok?: boolean }>("admin_operator_bootstrap", {
    p_telegram_id: telegramId,
    p_display_name: displayName,
  });
  return row?.ok === true;
}

export async function resolveAdminAuthority(
  telegramId: number,
  options?: { displayName?: string | null },
): Promise<AdminAuthorityDecision> {
  const lookup = await lookupOperator(telegramId);
  const channelAdmin = lookup.status === "operator"
    ? false
    : await isChannelAdmin(LINKS.channelHandle, telegramId);
  const decision = decideAdminAuthority(lookup, channelAdmin);
  if (decision.bootstrap) {
    const inserted = await bootstrapOperator(telegramId, options?.displayName ?? null);
    if (!inserted) {
      const again = await lookupOperator(telegramId);
      return decideAdminAuthority(again, false);
    }
    await appendAdminAudit({
      actorTelegramId: telegramId,
      action: "operator_bootstrap",
      outcome: "ok",
      reason: "empty operator table; live channel admin admitted once",
      payload: { source: "bootstrap" },
    });
  }
  if (decision.allow && lookup.status === "operator") {
    await rpc("admin_operator_touch", { p_telegram_id: telegramId }, true);
  }
  return decision;
}

export async function isAdminOperator(telegramId: number): Promise<boolean> {
  const decision = await resolveAdminAuthority(telegramId);
  return decision.allow;
}

export type DurableAuditAction =
  | "message_user"
  | "broadcast"
  | "run_fill_check"
  | "access_grant"
  | "access_pause"
  | "access_revoke"
  | "access_mode_set"
  | "operator_bootstrap"
  | "feedback_open"
  | "feedback_reply"
  | "feedback_state"
  | "campaign_create"
  | "campaign_test"
  | "campaign_enqueue"
  | "campaign_cancel"
  | "ops_owner_test"
  | "admin_login"
  | "admin_mfa_enroll"
  | "admin_mfa_verify"
  | "admin_mfa_reverify"
  | "admin_mfa_bypass_transitional"
  | "admin_identity_attach"
  | "launch_executor_switch"
  | "launch_people_switch"
  | "moments_decide"
  | "moments_approve_all"
  | "moments_switch";

export async function appendAdminAudit(input: {
  actorTelegramId: number;
  action: DurableAuditAction;
  outcome: "attempt" | "ok" | "rejected" | "failed" | "partial";
  reason?: string | null;
  targetTelegramId?: number | null;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  const payload = stripForbiddenAdminProperties(input.payload ?? {});
  const row = await rpc<{ ok?: boolean }>("admin_audit_append", {
    p_actor_telegram_id: input.actorTelegramId,
    p_action: input.action,
    p_outcome: input.outcome,
    p_reason: input.reason ?? null,
    p_target_telegram_id: input.targetTelegramId ?? null,
    p_payload: payload,
  }, true);
  return row?.ok === true;
}

export type AuditListRow = {
  id: string;
  occurred_at: string;
  action: string;
  outcome: string;
  reason: string | null;
  target_telegram_id: number | null;
  payload: Record<string, unknown>;
};

export async function listAdminAudit(limit = 100): Promise<AuditListRow[] | null> {
  return rpc<AuditListRow[]>("admin_audit_list", { p_limit: Math.min(Math.max(limit, 1), 200) });
}

export async function readAccessControls(): Promise<Record<number, { state: UserAccessState; expires_at: string | null }>> {
  const rows = await rpc<{ telegram_id: number; state: UserAccessState; expires_at: string | null }[]>(
    "admin_access_list",
    {},
    true,
  );
  const out: Record<number, { state: UserAccessState; expires_at: string | null }> = {};
  if (!rows) return out;
  for (const row of rows) out[row.telegram_id] = { state: row.state, expires_at: row.expires_at };
  return out;
}

export async function mutateUserAccess(input: {
  actorTelegramId: number;
  targetTelegramId: number;
  mutation: AccessMutation;
  reason: string;
}): Promise<{ ok: true; state: UserAccessState } | { ok: false; error: string; status: number }> {
  if (!isAccessMutation(input.mutation) || !accessReasonOk(input.reason)) {
    return { ok: false, error: "bad params", status: 400 };
  }
  const state = nextAccessState(input.mutation);
  const action = input.mutation === "grant"
    ? "access_grant"
    : input.mutation === "pause"
      ? "access_pause"
      : "access_revoke";
  await appendAdminAudit({
    actorTelegramId: input.actorTelegramId,
    action,
    outcome: "attempt",
    reason: input.reason,
    targetTelegramId: input.targetTelegramId,
  });
  const row = await rpc<{ ok?: boolean; state?: UserAccessState; error?: string }>("admin_access_set", {
    p_telegram_id: input.targetTelegramId,
    p_state: state,
    p_reason: input.reason.trim(),
    p_updated_by: input.actorTelegramId,
  });
  if (!row?.ok) {
    await appendAdminAudit({
      actorTelegramId: input.actorTelegramId,
      action,
      outcome: "failed",
      reason: input.reason,
      targetTelegramId: input.targetTelegramId,
    });
    return { ok: false, error: row?.error ?? "unavailable", status: 503 };
  }
  await appendAdminAudit({
    actorTelegramId: input.actorTelegramId,
    action,
    outcome: "ok",
    reason: input.reason,
    targetTelegramId: input.targetTelegramId,
    payload: { after: state },
  });
  return { ok: true, state };
}

export async function readBetaMode(): Promise<GlobalBetaMode> {
  const row = await rpc<{ value?: string }>("admin_setting_get", { p_key: "beta_mode" }, true);
  return isGlobalBetaMode(row?.value) ? row.value : "OPEN_CONFIRM";
}

export async function setBetaMode(input: {
  actorTelegramId: number;
  mode: GlobalBetaMode;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (!isGlobalBetaMode(input.mode) || !accessReasonOk(input.reason)) {
    return { ok: false, error: "bad params", status: 400 };
  }
  await appendAdminAudit({
    actorTelegramId: input.actorTelegramId,
    action: "access_mode_set",
    outcome: "attempt",
    reason: input.reason,
    payload: { mode: input.mode },
  });
  const row = await rpc<{ ok?: boolean }>("admin_setting_set", {
    p_key: "beta_mode",
    p_value: input.mode,
    p_updated_by: input.actorTelegramId,
  });
  if (!row?.ok) {
    await appendAdminAudit({
      actorTelegramId: input.actorTelegramId,
      action: "access_mode_set",
      outcome: "failed",
      reason: input.reason,
      payload: { mode: input.mode },
    });
    return { ok: false, error: "unavailable", status: 503 };
  }
  await appendAdminAudit({
    actorTelegramId: input.actorTelegramId,
    action: "access_mode_set",
    outcome: "ok",
    reason: input.reason,
    payload: { mode: input.mode },
  });
  return { ok: true };
}

export async function listFeedback(limit = 80): Promise<FeedbackListRow[] | null> {
  const rows = await rpc<FeedbackListRow[]>("admin_feedback_list", {
    p_limit: Math.min(Math.max(limit, 1), 200),
  }, true);
  return rows;
}

export async function openFeedbackCount(): Promise<number | undefined> {
  const row = await rpc<{ ok?: boolean; n?: number }>("admin_feedback_open_count", {}, true);
  return typeof row?.n === "number" ? row.n : undefined;
}

export async function openFeedbackThread(input: {
  source: "site" | "app" | "bot";
  category: "bug" | "idea" | "security" | "other";
  body: string;
  telegramId?: number | null;
  locale?: string | null;
  route?: string | null;
  publicRef: string;
}): Promise<{ ok: true; id: string; public_ref: string } | { ok: false }> {
  const row = await rpc<{ ok?: boolean; id?: string; public_ref?: string }>("admin_feedback_open", {
    p_source: input.source,
    p_category: input.category,
    p_body: input.body,
    p_telegram_id: input.telegramId ?? null,
    p_locale: input.locale ?? null,
    p_route: input.route ?? null,
    p_public_ref: input.publicRef,
  }, true);
  if (!row?.ok || !row.id || !row.public_ref) return { ok: false };
  return { ok: true, id: row.id, public_ref: row.public_ref };
}

export async function getFeedbackThread(id: string) {
  return rpc<{ ok?: boolean; thread?: Record<string, unknown>; messages?: unknown[] }>(
    "admin_feedback_get",
    { p_id: id },
    true,
  );
}

export async function replyFeedback(input: {
  id: string;
  body: string;
  actorTelegramId: number;
}) {
  return rpc<{ ok?: boolean; message_id?: string; telegram_id?: number | null; needs_bot?: boolean }>(
    "admin_feedback_reply",
    { p_id: input.id, p_body: input.body, p_actor: input.actorTelegramId },
    true,
  );
}

export async function setFeedbackDelivery(messageId: string, outcome: "sent" | "failed" | "blocked" | "not_applicable") {
  return rpc<{ ok?: boolean }>("admin_feedback_delivery", {
    p_message_id: messageId,
    p_outcome: outcome,
  }, true);
}

export async function setFeedbackState(input: {
  id: string;
  status: "OPEN" | "WAITING" | "CLOSED";
  reason: string;
  actorTelegramId: number;
}) {
  return rpc<{ ok?: boolean; status?: string }>("admin_feedback_set_state", {
    p_id: input.id,
    p_status: input.status,
    p_reason: input.reason,
    p_actor: input.actorTelegramId,
  }, true);
}

export async function setFeedbackDraft(telegramId: number, category: "bug" | "idea" | "security" | "other") {
  return rpc<{ ok?: boolean }>("admin_feedback_draft_set", {
    p_telegram_id: telegramId,
    p_category: category,
  }, true);
}

export async function getFeedbackDraft(telegramId: number): Promise<string | null> {
  const row = await rpc<{ ok?: boolean; category?: string | null }>("admin_feedback_draft_get", {
    p_telegram_id: telegramId,
  }, true);
  return typeof row?.category === "string" ? row.category : null;
}

export async function listBroadcasts(limit = 50): Promise<BroadcastListRow[] | null> {
  return rpc<BroadcastListRow[]>("admin_broadcast_list", {
    p_limit: Math.min(Math.max(limit, 1), 100),
  }, true);
}

export async function previewBroadcastAudience(audience: BroadcastAudience): Promise<number | undefined> {
  const row = await rpc<{ ok?: boolean; n?: number }>("admin_broadcast_preview", {
    p_audience: audience,
  }, true);
  return typeof row?.n === "number" ? row.n : undefined;
}

export async function createBroadcast(input: {
  name: string;
  audience: BroadcastAudience;
  body: string;
  cta: string | null;
  publicRef: string;
  actorTelegramId: number;
}) {
  return rpc<{ ok?: boolean; id?: string; public_ref?: string; state?: CampaignState; error?: string }>(
    "admin_broadcast_create",
    {
      p_name: input.name,
      p_audience: input.audience,
      p_body: input.body,
      p_cta: input.cta,
      p_public_ref: input.publicRef,
      p_actor: input.actorTelegramId,
    },
    true,
  );
}

export async function updateBroadcast(input: {
  id: string;
  name: string;
  audience: BroadcastAudience;
  body: string;
  cta: string | null;
}) {
  return rpc<{ ok?: boolean; state?: CampaignState; error?: string }>("admin_broadcast_update", {
    p_id: input.id,
    p_name: input.name,
    p_audience: input.audience,
    p_body: input.body,
    p_cta: input.cta,
  }, true);
}

export async function markBroadcastTested(id: string, actorTelegramId: number) {
  return rpc<{ ok?: boolean; state?: CampaignState; error?: string }>("admin_broadcast_mark_tested", {
    p_id: id,
    p_actor: actorTelegramId,
  }, true);
}

export async function enqueueBroadcast(input: {
  id: string;
  actorTelegramId: number;
  scheduledAt: string | null;
}) {
  return rpc<{ ok?: boolean; state?: CampaignState; n?: number; error?: string }>("admin_broadcast_enqueue", {
    p_id: input.id,
    p_actor: input.actorTelegramId,
    p_scheduled_at: input.scheduledAt,
  }, true);
}

export async function cancelBroadcast(input: { id: string; actorTelegramId: number; reason: string }) {
  return rpc<{ ok?: boolean; state?: CampaignState; error?: string }>("admin_broadcast_cancel", {
    p_id: input.id,
    p_actor: input.actorTelegramId,
    p_reason: input.reason,
  }, true);
}

export async function dueBroadcasts() {
  return rpc<{ ok?: boolean }>("admin_broadcast_due", {}, true);
}

export type BroadcastClaim = {
  id: string;
  campaign_id: string;
  telegram_id: number;
  body: string;
};

export async function claimBroadcastBatch(limit = 25): Promise<BroadcastClaim[] | null> {
  const rows = await rpc<BroadcastClaim[]>("admin_broadcast_claim_batch", {
    p_limit: Math.min(Math.max(limit, 1), 40),
  }, true);
  return rows;
}

export async function setBroadcastDelivery(input: {
  id: string;
  state: "SENT" | "RETRY" | "FAILED" | "BLOCKED";
  errorClass: "blocked" | "retry" | "failed" | null;
  retryAfter: string | null;
}) {
  return rpc<{ ok?: boolean }>("admin_broadcast_delivery_set", {
    p_id: input.id,
    p_state: input.state,
    p_error_class: input.errorClass,
    p_retry_after: input.retryAfter,
  }, true);
}

export async function rollupBroadcast(id: string) {
  return rpc<{ ok?: boolean; state?: CampaignState; queued?: number; sent?: number; failed?: number; blocked?: number }>(
    "admin_broadcast_rollup",
    { p_id: id },
    true,
  );
}

export async function getNotificationPrefs(telegramId: number): Promise<NotificationPrefs> {
  const row = await rpc<{
    ok?: boolean;
    product_updates?: boolean;
    beta_access?: boolean;
    strategy_receipt_alerts?: boolean;
    service_security?: boolean;
  }>("admin_prefs_get", { p_telegram_id: telegramId }, true);
  if (!row?.ok) return prefsFromRow(null);
  return prefsFromRow(row);
}

export async function setNotificationPrefs(telegramId: number, prefs: NotificationPrefs) {
  return rpc<{ ok?: boolean }>("admin_prefs_set", {
    p_telegram_id: telegramId,
    p_product_updates: prefs.product_updates,
    p_beta_access: prefs.beta_access,
    p_strategy_receipt_alerts: prefs.strategy_receipt_alerts,
  }, true);
}
