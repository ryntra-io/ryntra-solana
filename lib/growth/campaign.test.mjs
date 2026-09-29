// Run from repo root: node --test lib/growth/campaign.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REGISTERED_CAMPAIGNS,
  START_PAYLOAD_MAX_LENGTH,
  buildCampaignToken,
  campaignStartLink,
  isRegisteredCampaign,
  parseStartPayload,
} from "./campaign.ts";

test("an absent or empty payload is a direct start, not an error", function () {
  for (const raw of [undefined, null, ""]) {
    assert.deepEqual(parseStartPayload(raw), { kind: "direct" });
  }
});

test("a valid x_v1 payload yields exactly its three fields", function () {
  const parsed = parseStartPayload("x_v1_launch_p01_a");
  assert.equal(parsed.kind, "campaign");
  assert.deepEqual(parsed.touch, {
    source: "x",
    version: "v1",
    campaignId: "launch",
    contentId: "p01",
    variantId: "a",
    token: "x_v1_launch_p01_a",
  });
});

test("hyphens are allowed inside a field, underscores are not", function () {
  assert.equal(parseStartPayload("x_v1_risk-desk_edu-01_b").kind, "campaign");
  /* An underscore inside a field would make the token ambiguous, so it must not parse. */
  assert.deepEqual(parseStartPayload("x_v1_risk_desk_edu_b"), { kind: "unsupported", reason: "shape" });
});

test("a malformed payload produces no attribution", function () {
  assert.deepEqual(parseStartPayload("x_v1_launch"), { kind: "unsupported", reason: "shape" });
  assert.deepEqual(parseStartPayload("x_v1_launch_p01_a_extra"), { kind: "unsupported", reason: "shape" });
  assert.deepEqual(parseStartPayload("xyz"), { kind: "unsupported", reason: "shape" });
  assert.deepEqual(parseStartPayload("x_v1__p01_a"), { kind: "unsupported", reason: "component" });
});

test("a payload longer than the Telegram limit is rejected before anything else", function () {
  const long = "x_v1_" + "a".repeat(START_PAYLOAD_MAX_LENGTH);
  assert.ok(long.length > START_PAYLOAD_MAX_LENGTH);
  assert.deepEqual(parseStartPayload(long), { kind: "unsupported", reason: "too_long" });
});

test("characters outside the closed charset are rejected", function () {
  for (const raw of [
    "x_v1_launch_p01_a!",
    "x_v1_launch_p01_a b",
    "x_v1_launch/p01_a",
    "x_v1_@handle_p01_a",
    "x_v1_0xabc_p01_a.",
    'x_v1_{"a":1}_p01_a',
  ]) {
    assert.deepEqual(parseStartPayload(raw), { kind: "unsupported", reason: "charset" }, raw);
  }
});

test("an unsupported version produces no attribution", function () {
  assert.deepEqual(parseStartPayload("x_v2_launch_p01_a"), { kind: "unsupported", reason: "unsupported_version" });
  assert.deepEqual(parseStartPayload("x_V1_launch_p01_a"), { kind: "unsupported", reason: "unsupported_version" });
});

test("an over-long field is rejected without truncating it into something valid", function () {
  const field = "a".repeat(17);
  const parsed = parseStartPayload(`x_v1_${field}_p01_a`);
  assert.deepEqual(parsed, { kind: "unsupported", reason: "component" });
});

test("ref_* is a separate namespace and never becomes X attribution", function () {
  const parsed = parseStartPayload("ref_ABC123");
  assert.equal(parsed.kind, "legacy_referral");
  assert.equal(parsed.code, "ABC123");
  /* The shapes are structurally disjoint: a referral can never carry campaign fields. */
  assert.ok(!("touch" in parsed));
  assert.deepEqual(parseStartPayload("ref_x_v1_launch_p01_a"), { kind: "unsupported", reason: "shape" });
});

test("a payload that merely looks like a namespace does not claim one", function () {
  assert.deepEqual(parseStartPayload("reference"), { kind: "unsupported", reason: "shape" });
  assert.deepEqual(parseStartPayload("xtra_v1_a_b_c"), { kind: "unsupported", reason: "shape" });
});

test("the builder round-trips and refuses parts it cannot encode", function () {
  const token = buildCampaignToken({ campaignId: "launch", contentId: "p01", variantId: "a" });
  assert.equal(token, "x_v1_launch_p01_a");
  const parsed = parseStartPayload(token);
  assert.equal(parsed.kind, "campaign");
  assert.equal(parsed.touch.campaignId, "launch");

  assert.equal(buildCampaignToken({ campaignId: "has_underscore", contentId: "p01", variantId: "a" }), null);
  assert.equal(buildCampaignToken({ campaignId: "", contentId: "p01", variantId: "a" }), null);
  assert.equal(buildCampaignToken({ campaignId: "a".repeat(17), contentId: "p01", variantId: "a" }), null);
  assert.equal(buildCampaignToken({ campaignId: "a b", contentId: "p01", variantId: "a" }), null);
});

test("every token the builder produces fits the Telegram limit", function () {
  const token = buildCampaignToken({
    campaignId: "a".repeat(16),
    contentId: "b".repeat(16),
    variantId: "c".repeat(16),
  });
  assert.ok(token !== null);
  assert.ok(token.length <= START_PAYLOAD_MAX_LENGTH, `token was ${token.length} characters`);
  assert.equal(parseStartPayload(token).kind, "campaign");
});

test("the deep link builder refuses a broken bot name or broken parts", function () {
  assert.equal(
    campaignStartLink("RyntraBeta_bot", { campaignId: "launch", contentId: "p01", variantId: "a" }),
    "https://t.me/RyntraBeta_bot?start=x_v1_launch_p01_a",
  );
  assert.equal(campaignStartLink("bad name", { campaignId: "launch", contentId: "p01", variantId: "a" }), null);
  assert.equal(campaignStartLink("RyntraBeta_bot", { campaignId: "bad name", contentId: "p01", variantId: "a" }), null);
});

test("no campaign is issued yet, so nothing can be attributed today", function () {
  assert.equal(REGISTERED_CAMPAIGNS.length, 0);
  assert.equal(
    isRegisteredCampaign({ campaignId: "launch", contentId: "p01", variantId: "a" }),
    false,
  );
});

test("only an issued triple counts as attribution", function () {
  const registry = [{ campaignId: "launch", contentId: "p01", variantId: "a" }];
  assert.equal(isRegisteredCampaign(parseStartPayload("x_v1_launch_p01_a").touch, registry), true);
  /* One field different is a different campaign, not a near miss. */
  assert.equal(isRegisteredCampaign(parseStartPayload("x_v1_launch_p01_b").touch, registry), false);
  assert.equal(isRegisteredCampaign(parseStartPayload("x_v1_launch_p02_a").touch, registry), false);
  assert.equal(isRegisteredCampaign(parseStartPayload("x_v1_other_p01_a").touch, registry), false);
});

test("grammar-valid hostile payloads are still not attribution", function () {
  /* The grammar bounds what a token looks like, not what it carries: three regex-valid
     fields are enough for a split wallet, an account id, a handle or encoded JSON. The
     registry is what makes those harmless — unissued means not attribution. */
  const registry = [{ campaignId: "launch", contentId: "p01", variantId: "a" }];
  const hostile = [
    "x_v1_0xaaaaaaaaaaaaaa_aaaaaaaaaaaaaaaa_aaaaaaaaaaaa", // a 42-char wallet, split
    "x_v1_1234567890123456_p01_a", // a numeric account id
    "x_v1_Ryntra-io_p01_a", // a handle with its @ stripped
    "x_v1_eyJpZCI6MTIzfQ_p01_a", // base64url-encoded JSON
  ];
  for (const raw of hostile) {
    const parsed = parseStartPayload(raw);
    assert.equal(parsed.kind, "campaign", `${raw} should be syntactically valid — that is the point`);
    assert.equal(isRegisteredCampaign(parsed.touch, registry), false, raw);
    /* And with the real registry, which is empty, nothing at all is attribution. */
    assert.equal(isRegisteredCampaign(parsed.touch), false, raw);
  }
});

test("no payload can smuggle identity, a URL or a secret through the grammar", function () {
  for (const raw of [
    "x_v1_https://evil_p01_a",
    "x_v1_@Ryntra-io_p01_a",
    "x_v1_0x1234abcd_p01_a".replace("0x1234abcd", "0x" + "a".repeat(40)),
    "x_v1_tg-123456789012_p01_a".replace("tg-123456789012", "t".repeat(20)),
  ]) {
    const parsed = parseStartPayload(raw);
    assert.notEqual(parsed.kind, "campaign", raw);
  }
  /* A short hex-looking string is structurally legal; the guarantee is bounded length
     and a closed charset, not semantic detection. Nothing longer than a field can pass. */
  const bounded = parseStartPayload("x_v1_0xabc_p01_a");
  assert.equal(bounded.kind, "campaign");
  assert.ok(bounded.touch.campaignId.length <= 16);
});
