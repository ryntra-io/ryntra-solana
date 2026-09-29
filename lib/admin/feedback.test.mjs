import assert from "node:assert/strict";
import test from "node:test";

import {
  feedbackPriority,
  isFeedbackCategory,
  isPublicFeedbackRef,
  publicFeedbackRef,
  sanitizeFeedbackBody,
  sanitizeFeedbackRoute,
} from "./feedback.ts";

test("a short or empty body is refused, a real message is kept", () => {
  assert.equal(sanitizeFeedbackBody("too short"), null);
  assert.equal(sanitizeFeedbackBody("   "), null);
  assert.equal(sanitizeFeedbackBody("The send button stays disabled after Review."), "The send button stays disabled after Review.");
});

test("security is a priority, not a separate product", () => {
  assert.equal(feedbackPriority("security"), "SECURITY");
  assert.equal(feedbackPriority("bug"), "NORMAL");
  assert.equal(isFeedbackCategory("security"), true);
  assert.equal(isFeedbackCategory("wallet"), false);
});

test("sensitive query parameters are stripped from an optional route", () => {
  assert.equal(
    sanitizeFeedbackRoute("https://ryntra.io/app/settings?token=abc&tab=alerts"),
    "/app/settings?tab=alerts",
  );
  assert.equal(sanitizeFeedbackRoute("/solana/workspace/send?wallet=0xabc"), "/solana/workspace/send");
  assert.equal(sanitizeFeedbackRoute("not a url"), "not a url");
});

test("the public reference is a short opaque id, not a telegram id", () => {
  const ref = publicFeedbackRef("3fa85f64-5717-4562-b3fc-2c963f66afa6");
  assert.equal(ref, "RYN-FB-3FA85F64");
  assert.equal(isPublicFeedbackRef(ref), true);
  assert.equal(isPublicFeedbackRef("RYN-FB-user-1"), false);
});
