/**
 * Acquisition attribution and funnel events.
 *
 * Everything here is descriptive and non-authoritative. No function in this module may
 * change what a user is allowed to do, and every failure is swallowed: an unavailable
 * analytics path must leave access and the paper workflow exactly as they were, and must
 * never fabricate a zero or a conversion.
 *
 * The persistence contract lives in a prepared migration that is deliberately not applied
 * to production, so in the current deployment every call here returns `unavailable`. That
 * is the designed state, not an outage.
 */

import { reportError } from "../monitor";
import { rpcOrNull } from "../supabase-rpc";
import { isRegisteredCampaign, parseStartPayload } from "./campaign";

/** The one named first value. A bot start, an access confirmation and a page view are not it. */
export const FIRST_VALUE_ID = "paper_plan";

export const FUNNEL_EVENTS = [
  "bot_start",
  "access_confirmed",
  "first_value_started",
  "first_value_completed",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** `duplicate` is a success: it means deduplication did its job. */
export type RecordOutcome = "recorded" | "duplicate" | "unavailable";

/** Events that may exist at most once per user, whatever the caller does. */
const ONCE_PER_USER: ReadonlySet<FunnelEvent> = new Set([
  "access_confirmed",
  "first_value_started",
  "first_value_completed",
]);

const ONCE = "once";

/* One report per key per window. Without this, an unapplied migration would log on every
   single bot start rather than telling us once that the path is not there. */
const REPORT_WINDOW_MS = 10 * 60_000;
const lastReportAt = new Map<string, number>();

function reportSampled(key: string, detail: Record<string, unknown>): void {
  const now = Date.now();
  const previous = lastReportAt.get(key) ?? 0;
  if (now - previous < REPORT_WINDOW_MS) return;
  lastReportAt.set(key, now);
  void reportError(`growth:${key}`, new Error(`acquisition path unavailable: ${key}`), detail);
}

/** Test seam: the sampler is process-wide state, so suites must be able to reset it. */
export function resetReportSamplingForTests(): void {
  lastReportAt.clear();
}

function outcomeOf(raw: string | null): RecordOutcome {
  return raw === "recorded" || raw === "duplicate" ? raw : "unavailable";
}

/**
 * Records the first acquisition touch for a user. A later touch never overwrites an
 * earlier one — the database enforces that, so a race cannot rewrite history either.
 *
 * Two gates, not one. The payload must satisfy the grammar, and the triple it names must be
 * a campaign we actually issued. The grammar alone would let three regex-valid fields carry
 * a split wallet, a numeric id or encoded JSON into storage; the registry makes anything
 * unissued simply not attribution. A direct start, a legacy `ref_*` identifier, anything
 * unparseable, and any unissued triple all record no touch at all.
 */
export async function recordFirstTouch(
  telegramId: number,
  rawPayload: string | null | undefined,
): Promise<RecordOutcome> {
  const parsed = parseStartPayload(rawPayload);
  if (parsed.kind !== "campaign") return "unavailable";
  if (!isRegisteredCampaign(parsed.touch)) return "unavailable";

  const result = await rpcOrNull<string>("growth", "beta_record_acquisition_touch", {
    p_telegram_id: telegramId,
    p_source: parsed.touch.source,
    p_campaign_id: parsed.touch.campaignId,
    p_content_id: parsed.touch.contentId,
    p_variant_id: parsed.touch.variantId,
  }, { quiet: true });
  const outcome = outcomeOf(result);
  if (outcome === "unavailable") reportSampled("first-touch", { campaign: parsed.touch.campaignId });
  return outcome;
}

/**
 * Records one funnel event. `dedupeKey` scopes the uniqueness: a bot start is unique per
 * Telegram update, and the once-per-user events ignore whatever the caller passes.
 */
export async function recordFunnelEvent(
  telegramId: number,
  event: FunnelEvent,
  dedupeKey?: string | number | null,
): Promise<RecordOutcome> {
  const key = ONCE_PER_USER.has(event) ? ONCE : String(dedupeKey ?? ONCE).slice(0, 64);
  const firstValueId =
    event === "first_value_started" || event === "first_value_completed" ? FIRST_VALUE_ID : null;

  const result = await rpcOrNull<string>("growth", "beta_record_funnel_event", {
    p_telegram_id: telegramId,
    p_event: event,
    p_first_value_id: firstValueId,
    p_dedupe_key: key,
  }, { quiet: true });
  const outcome = outcomeOf(result);
  if (outcome === "unavailable") reportSampled(`event:${event}`, { event });
  return outcome;
}

/**
 * The whole bot-start path in one call: record where the user came from, then record the
 * start itself. Failures are contained here so no caller has to remember to ignore them.
 */
export async function recordBotStart(
  telegramId: number,
  rawPayload: string | null | undefined,
  updateId?: number | null,
): Promise<void> {
  try {
    await recordFirstTouch(telegramId, rawPayload);
    await recordFunnelEvent(telegramId, "bot_start", updateId ?? null);
  } catch {
    /* Analytics never propagates a failure into the access path. */
  }
}

/** Emitted only after an explicit confirmation has actually succeeded. */
export async function recordAccessConfirmed(telegramId: number): Promise<void> {
  try {
    await recordFunnelEvent(telegramId, "access_confirmed");
  } catch {
    /* see above */
  }
}

/**
 * The user is authenticated, access-confirmed, and has submitted a paper plan that passed
 * server-side validation. Emitted before the mutation, so it means "a real attempt began",
 * not "a plan exists".
 */
export async function recordFirstValueStarted(telegramId: number): Promise<void> {
  try {
    await recordFunnelEvent(telegramId, "first_value_started");
  } catch {
    /* see above */
  }
}

/**
 * The plan was persisted. Callers must only reach this after `paper_open` succeeded — a
 * failed mutation may never produce a completion, which is why this is deliberately not
 * folded into the started call.
 */
export async function recordFirstValueCompleted(telegramId: number): Promise<void> {
  try {
    await recordFunnelEvent(telegramId, "first_value_completed");
  } catch {
    /* see above */
  }
}
