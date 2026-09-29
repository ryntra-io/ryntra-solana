import assert from "node:assert/strict";
import test from "node:test";

import { DRAFT_ACTORS, DRAFT_KINDS, saveTypedDraft, typedDraft } from "./draft.ts";

const draft = (overrides = {}) =>
  typedDraft({
    kind: "MONITOR_RULE",
    label: "Watch TSLA-USD for a multiplier change",
    fields: [
      { key: "subject", value: "TSLA-USD", origin: "USER" },
      { key: "threshold", value: "any change", origin: "USER" },
    ],
    ...overrides,
  });

test("a typed draft is unsaved, and unsaved is its only state", () => {
  const typed = draft();
  assert.equal(typed.state, "UNSAVED");
  assert.equal(typed.savedAt, null);
  assert.equal(typed.savedBy, null);
  assert.equal(typed.autoSaveCapable, false);
  assert.equal(typed.savePolicy, "EXPLICIT_USER_REVIEW_AND_SAVE");
});

test("a conversation cannot save a draft, and the refusal names why", () => {
  const result = saveTypedDraft(draft(), { actor: "CONVERSATION" });
  assert.equal(result.ok, false);
  assert.equal(result.refusal, "CONVERSATION_MAY_NOT_SAVE");
  assert.match(result.reason, /explicit/i);
});

test("an explicit user save is refused too — for a different reason, and it says which", () => {
  const result = saveTypedDraft(draft(), { actor: "USER_EXPLICIT_ACTION" });
  assert.equal(result.ok, false);
  assert.equal(result.refusal, "NO_PERSISTENCE");
  assert.notEqual(result.reason, saveTypedDraft(draft(), { actor: "CONVERSATION" }).reason);
});

test("there is no actor that saves, and an unknown actor is refused rather than defaulted", () => {
  for (const actor of DRAFT_ACTORS) {
    assert.equal(saveTypedDraft(draft(), { actor }).ok, false);
  }
  const unknown = saveTypedDraft(draft(), { actor: "SCHEDULER" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.refusal, "UNKNOWN_ACTOR");
});

test("a field a model supplied is refused: the draft carries the reader's words, not the model's facts", () => {
  assert.throws(
    () => draft({ fields: [{ key: "subject", value: "TSLA-USD", origin: "AI_SUPPLIED" }] }),
    /origin/i,
  );
});

test("every draft kind names the surface that owns the object and the control that would save it", () => {
  for (const kind of DRAFT_KINDS) {
    const typed = draft({ kind });
    assert.ok(typed.owner.surface.length > 0);
    assert.match(typed.owner.href, /^\/app\//);
    assert.equal(typed.saveControl.state, "NOT_BUILT");
    assert.match(typed.saveControl.reason, /storage|persistence/i);
  }
});

test("the same draft always has the same id, and a different field changes it", () => {
  assert.equal(draft().draftId, draft().draftId);
  assert.match(draft().draftId, /^drf_[0-9a-f]{12}$/);
  assert.notEqual(
    draft().draftId,
    draft({ fields: [{ key: "subject", value: "AAPL-USD", origin: "USER" }] }).draftId,
  );
});

test("a draft with no field cannot exist: an empty draft is a save waiting to invent content", () => {
  assert.throws(() => draft({ fields: [] }), /field/i);
});
