import { createHash } from "node:crypto";

/**
 * The typed draft, and the rule that a conversation never saves anything.
 *
 * The founder's instruction for this wave was one sentence: *the conversation
 * NEVER saves anything by itself — typed drafts only through an explicit
 * review/save by the user.* There are two ways to implement that sentence and
 * only one of them survives contact with a later session.
 *
 * The tempting one is a save function with an `if (actor === "conversation")`
 * branch. That is a rule somebody has to keep, and this repository has recorded
 * what happens to rules somebody has to keep.
 *
 * The one here is structural: a draft has exactly one state, `UNSAVED`, and
 * `saveTypedDraft` has **no `ok: true` branch at all**. Every actor is refused,
 * for two different and separately named reasons — the conversation because it
 * may not, an explicit user action because the storage it would write to does
 * not exist. Those are different facts and collapsing them would hide the one
 * that is about product boundaries behind the one that is about a missing
 * table.
 *
 * **A field a model supplied is refused at construction.** `origin` is `USER`
 * or `COMPILED`; there is no third value and `AI_SUPPLIED` throws. That is the
 * canon's *AI never supplies missing facts* expressed where it can actually be
 * enforced, rather than in a paragraph above a form.
 */

export const DRAFT_KINDS = ["STRATEGY", "MONITOR_RULE", "RESEARCH_NOTE", "INVESTOR_CONTEXT"] as const;

export type DraftKind = (typeof DRAFT_KINDS)[number];

/** Who could ask for a save. None of them can perform one. */
export const DRAFT_ACTORS = ["CONVERSATION", "USER_EXPLICIT_ACTION"] as const;

export type DraftActor = (typeof DRAFT_ACTORS)[number];

export const DRAFT_FIELD_ORIGINS = ["USER", "COMPILED"] as const;

export type DraftFieldOrigin = (typeof DRAFT_FIELD_ORIGINS)[number];

export type DraftField = Readonly<{
  key: string;
  value: string;
  origin: DraftFieldOrigin;
}>;

export type TypedDraft = Readonly<{
  draftId: string;
  kind: DraftKind;
  label: string;
  state: "UNSAVED";
  savePolicy: "EXPLICIT_USER_REVIEW_AND_SAVE";
  autoSaveCapable: false;
  savedAt: null;
  savedBy: null;
  owner: Readonly<{ surface: string; href: string }>;
  saveControl: Readonly<{ state: "NOT_BUILT"; reason: string }>;
  fields: readonly DraftField[];
}>;

export type DraftSaveRefusal = "CONVERSATION_MAY_NOT_SAVE" | "NO_PERSISTENCE" | "UNKNOWN_ACTOR";

export type DraftSaveResult = Readonly<{
  ok: false;
  refusal: DraftSaveRefusal;
  reason: string;
}>;

const OWNER: Readonly<Record<DraftKind, Readonly<{ surface: string; href: string }>>> = {
  STRATEGY: { surface: "Strategies", href: "/app/strategies" },
  MONITOR_RULE: { surface: "Research", href: "/app/research" },
  RESEARCH_NOTE: { surface: "Research", href: "/app/research" },
  INVESTOR_CONTEXT: { surface: "Connections", href: "/app/connect" },
};

const SAVE_CONTROL_REASON: Readonly<Record<DraftKind, string>> = {
  STRATEGY:
    "Saving a strategy draft needs storage this release does not add, so the draft stays here and nothing is written.",
  MONITOR_RULE:
    "Monitor rules are compiled from configuration rather than edited, so there is no storage for a saved rule and nothing is written.",
  RESEARCH_NOTE:
    "A research note needs storage this release does not add, so the draft stays here and nothing is written.",
  INVESTOR_CONTEXT:
    "Your declared context is held in this browser rather than in server storage, so no server-side save exists and nothing is written.",
};

export function typedDraft(input: Readonly<{
  kind: DraftKind;
  label: string;
  fields: readonly DraftField[];
}>): TypedDraft {
  if (input.fields.length === 0) {
    throw new Error("A typed draft needs at least one field; an empty draft is content waiting to be invented.");
  }
  for (const field of input.fields) {
    if (!(DRAFT_FIELD_ORIGINS as readonly string[]).includes(field.origin)) {
      throw new Error(
        "A draft field origin must be USER or COMPILED; refused: " + String(field.origin),
      );
    }
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        input.kind,
        input.label,
        input.fields.map((field) => [field.key, field.value, field.origin]),
      ]),
    )
    .digest("hex")
    .slice(0, 12);

  return {
    draftId: "drf_" + digest,
    kind: input.kind,
    label: input.label,
    state: "UNSAVED",
    savePolicy: "EXPLICIT_USER_REVIEW_AND_SAVE",
    autoSaveCapable: false,
    savedAt: null,
    savedBy: null,
    owner: OWNER[input.kind],
    saveControl: { state: "NOT_BUILT", reason: SAVE_CONTROL_REASON[input.kind] },
    fields: input.fields,
  };
}

/**
 * Every path refuses. The two that matter refuse for different reasons.
 *
 * There is no third parameter, no override and no `force`. A future packet that
 * adds persistence has to add an `ok: true` branch here in the open, beside the
 * test that asserts none exists — which is exactly where a reviewer would look.
 */
export function saveTypedDraft(
  draft: TypedDraft,
  request: Readonly<{ actor: string }>,
): DraftSaveResult {
  if (draft.state !== "UNSAVED") {
    return { ok: false, refusal: "UNKNOWN_ACTOR", reason: "A draft has one state and it is UNSAVED." };
  }
  if (request.actor === "CONVERSATION") {
    return {
      ok: false,
      refusal: "CONVERSATION_MAY_NOT_SAVE",
      reason:
        "A conversation never saves anything. Nothing you ask here changes a rule, a strategy or your declared context until you review this draft and explicitly save it yourself.",
    };
  }
  if (request.actor === "USER_EXPLICIT_ACTION") {
    return {
      ok: false,
      refusal: "NO_PERSISTENCE",
      reason: draft.saveControl.reason,
    };
  }
  return {
    ok: false,
    refusal: "UNKNOWN_ACTOR",
    reason: "Only you can save a draft, and no other actor is recognised: " + String(request.actor),
  };
}
