import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_STATES,
  DELIVERY_STATES,
  FORBIDDEN_BROADCAST_METRICS,
  campaignAfterEdit,
  campaignAfterTest,
  campaignEnqueueState,
  campaignMayCancel,
  campaignMayEnqueue,
  campaignRollupState,
  isPublicBroadcastRef,
  publicBroadcastRef,
  sanitizeCampaignBody,
  sanitizeCampaignCta,
  sanitizeCampaignName,
  targetStatusForAudience,
} from "./broadcast.ts";

test("a short or empty campaign body is refused", () => {
  assert.equal(sanitizeCampaignBody(" "), null);
  assert.equal(sanitizeCampaignBody("x"), null);
  assert.equal(sanitizeCampaignBody("Go."), "Go.");
});

test("a CTA must be an https ryntra.io URL", () => {
  assert.equal(sanitizeCampaignCta("https://evil.example/phish"), null);
  assert.equal(sanitizeCampaignCta("http://ryntra.io/app"), null);
  assert.match(sanitizeCampaignCta("https://www.ryntra.io/app"), /^https:\/\/www\.ryntra\.io\/app/);
});

test("the public reference is opaque and not a telegram id", () => {
  const ref = publicBroadcastRef("3fa85f64-5717-4562-b3fc-2c963f66afa6");
  assert.equal(ref, "RYN-BC-3FA85F64");
  assert.equal(isPublicBroadcastRef(ref), true);
  assert.equal(isPublicBroadcastRef("RYN-BC-user-1"), false);
});

test("verified maps to the existing target filter; all is unfiltered", () => {
  assert.equal(targetStatusForAudience("verified"), "verified_any");
  assert.equal(targetStatusForAudience("all"), null);
});

test("send requires a successful owner test and READY state", () => {
  assert.deepEqual(
    campaignMayEnqueue({ state: "DRAFT", testSentAt: "2026-08-30T00:00:00Z", body: "Hello there", audience: "verified" }),
    { ok: false, reason: "not_ready" },
  );
  assert.deepEqual(
    campaignMayEnqueue({ state: "READY", testSentAt: null, body: "Hello there", audience: "verified" }),
    { ok: false, reason: "test_required" },
  );
  assert.deepEqual(
    campaignMayEnqueue({ state: "READY", testSentAt: "2026-08-30T00:00:00Z", body: "Hello there", audience: "verified" }),
    { ok: true },
  );
});

test("editing a tested campaign returns it to DRAFT", () => {
  assert.equal(campaignAfterEdit("READY"), "DRAFT");
  assert.equal(campaignAfterTest("DRAFT"), "READY");
  assert.equal(campaignAfterEdit("QUEUED"), null);
});

test("a future schedule stays SCHEDULED; due or absent becomes QUEUED", () => {
  assert.equal(campaignEnqueueState(null, 1_000), "QUEUED");
  assert.equal(campaignEnqueueState("2026-08-30T00:00:01Z", Date.parse("2026-08-30T00:00:00Z")), "SCHEDULED");
  assert.equal(campaignEnqueueState("2026-08-30T00:00:00Z", Date.parse("2026-08-30T00:00:01Z")), "QUEUED");
});

test("rollup never invents a read metric and maps remaining work honestly", () => {
  assert.equal(
    campaignRollupState({ state: "SENDING", queued: 0, sent: 10, failed: 0, blocked: 0 }),
    "COMPLETED",
  );
  assert.equal(
    campaignRollupState({ state: "SENDING", queued: 0, sent: 8, failed: 1, blocked: 1 }),
    "PARTIAL",
  );
  assert.equal(
    campaignRollupState({ state: "CANCELLED", queued: 3, sent: 0, failed: 0, blocked: 0 }),
    "CANCELLED",
  );
  assert.ok(campaignMayCancel("QUEUED"));
  assert.equal(campaignMayCancel("COMPLETED"), false);
});

test("delivery vocabulary has no read receipt", () => {
  assert.equal(DELIVERY_STATES.includes("READ"), false);
  assert.equal(CAMPAIGN_STATES.includes("READ"), false);
  for (const word of FORBIDDEN_BROADCAST_METRICS) {
    assert.equal(DELIVERY_STATES.some((state) => state.toLowerCase().includes(word)), false);
  }
});

test("campaign names stay short and non-empty", () => {
  assert.equal(sanitizeCampaignName("x"), null);
  assert.equal(sanitizeCampaignName("Beta wave"), "Beta wave");
});
