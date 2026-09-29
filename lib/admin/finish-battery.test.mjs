import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseStartPayload } from "../growth/campaign.ts";

const nav = readFileSync(new URL("../../app/admin/shell/nav.ts", import.meta.url), "utf8");
const ops = readFileSync(new URL("../../app/admin/operations/operations-panel.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../app/admin/settings/page.tsx", import.meta.url), "utf8");
const handlers = readFileSync(new URL("../telegram/handlers.ts", import.meta.url), "utf8");
const help = readFileSync(new URL("../beta/texts.ts", import.meta.url), "utf8");
const campaign = readFileSync(new URL("../growth/campaign.ts", import.meta.url), "utf8");
const attribution = readFileSync(new URL("../growth/attribution.ts", import.meta.url), "utf8");

test("settings is no longer a later page", () => {
  assert.doesNotMatch(nav, /id: "settings"[^}]*later: true/);
  assert.doesNotMatch(settings, /AdminLaterPage/);
});

test("operations does not render the bot token", () => {
  assert.doesNotMatch(ops, /TELEGRAM_BOT_TOKEN/);
  assert.match(ops, /Bot Operations/);
});

test("the bot exposes /settings in three languages and never prints the token", () => {
  assert.match(handlers, /cmd === "\/settings"/);
  assert.match(handlers, /command: "settings"/);
  assert.match(handlers, /np:/);
  assert.match(help, /\/settings — notifications/);
  assert.match(help, /\/settings — сповіщення/);
  assert.match(help, /\/settings — уведомления/);
  assert.doesNotMatch(handlers, /TELEGRAM_BOT_TOKEN/);
});

test("campaign attribution and referral stay separate namespaces", () => {
  assert.match(campaign, /Two namespaces exist and they never mix/);
  assert.match(campaign, /x_\*/);
  assert.match(campaign, /ref_\*/);
  const campaignStart = parseStartPayload("x_v1_wave_home_a");
  const referralStart = parseStartPayload("ref_alice");
  assert.equal(campaignStart.kind, "campaign");
  assert.equal(referralStart.kind, "legacy_referral");
  assert.doesNotMatch(attribution, /referral_code|reward|points/i);
});
