import assert from "node:assert/strict";
import test from "node:test";

import { reviewStepOpen } from "./review-step.ts";

// CITY-236: «Back» and Escape from the launch's review return to its fields, as the sheet's own arrow does — never out
// of the whole sheet, and never while a launch is under way.

test("the review is a step back while nothing is under way", () => {
  assert.equal(reviewStepOpen({ sheet: true, step: "review", phase: null }), true, "before the press");
  assert.equal(reviewStepOpen({ sheet: true, step: "review", phase: { step: "failed" } }), true, "after a refusal the arrow is live again");
});

test("the fields are not a step: from them «Back» closes the sheet", () => {
  assert.equal(reviewStepOpen({ sheet: true, step: "form", phase: null }), false);
});

test("under a signature and on the card of a launch made there is no step back", () => {
  for (const step of ["upload", "build", "sign", "send", "opened", "done"]) {
    assert.equal(reviewStepOpen({ sheet: true, step: "review", phase: { step } }), false, step);
  }
});

test("a closed sheet has no step, whatever it remembers", () => {
  assert.equal(reviewStepOpen({ sheet: false, step: "review", phase: null }), false);
});

test("the sheet closes unless a launch is under way; an early launch that is set is not under way (CITY-242: one rule, in one place)", async () => {
  const { sheetClosable } = await import("./review-step.ts");
  assert.equal(sheetClosable(null), true);
  for (const step of ["done", "failed", "opened"]) assert.equal(sheetClosable({ step }), true, step);
  for (const step of ["uploading", "building", "signing", "sending"]) assert.equal(sheetClosable({ step }), false, step);
});
