import assert from "node:assert/strict";
import test from "node:test";

import { inboxCategoryFor, isFeedbackTopic } from "../../../lib/admin/feedback-context.ts";
import { isFeedbackSource, sanitizeFeedbackBody } from "../../../lib/admin/feedback.ts";
import { REPORT_REASONS, reportBody, sendReport } from "./report.ts";

const TOKEN = "So11111111111111111111111111111111111111112";

test("a report from a tower goes to the inbox the takedown procedure reads first, in the token page's own words", async () => {
  const seen = [];
  const answer = await sendReport({ token: TOKEN, symbol: "KITE", reason: "pretends", route: "/" }, async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, ref: "RY-1234" }) };
  });
  assert.deepEqual(answer, { ok: true, ref: "RY-1234" });
  assert.equal(seen[0].url, "/api/feedback");
  assert.equal(seen[0].init.method, "POST");
  const body = seen[0].body;
  /* The route's own checks: a source it takes, the `report` topic, read as security. */
  assert.equal(isFeedbackSource(body.source), true);
  assert.equal(isFeedbackTopic(body.topic), true);
  assert.equal(inboxCategoryFor(body.topic), "security");
  assert.equal(sanitizeFeedbackBody(body.body), body.body);
  assert.match(body.body, new RegExp(`^Report: \\$KITE · ${TOKEN}\\nReason: pretends`));
});

test("every reason makes a body the inbox keeps whole", () => {
  for (const reason of REPORT_REASONS) assert.equal(sanitizeFeedbackBody(reportBody("KITE", TOKEN, reason)), reportBody("KITE", TOKEN, reason));
});

test("too many reports and a failed send are said apart; nothing throws", async () => {
  assert.deepEqual(await sendReport({ token: TOKEN, symbol: "KITE", reason: "scam", route: "/" }, async () => ({ ok: false, status: 429, json: async () => ({}) })), { ok: false, reason: "rate" });
  assert.deepEqual(await sendReport({ token: TOKEN, symbol: "KITE", reason: "scam", route: "/" }, async () => ({ ok: false, status: 503, json: async () => ({}) })), { ok: false, reason: "failed" });
  assert.deepEqual(await sendReport({ token: TOKEN, symbol: "KITE", reason: "scam", route: "/" }, async () => { throw new Error("offline"); }), { ok: false, reason: "failed" });
});
