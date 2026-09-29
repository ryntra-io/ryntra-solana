import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { projectWebhookHealth, redactBotSecret } from "./bot-ops.ts";

test("webhook health shows the host and never the bot token", () => {
  const health = projectWebhookHealth({
    username: "RyntraBeta_bot",
    webhookUrl: "https://ryntra.io/api/telegram",
    pendingUpdateCount: 0,
    lastErrorMessage: "Conflict: terminated by other getUpdates; token 123456789:AAThisIsNotARealTokenValueXX",
  });
  assert.equal(health.webhookHost, "ryntra.io");
  assert.equal(health.webhookConfigured, true);
  assert.doesNotMatch(JSON.stringify(health), /123456789:AAThisIsNotARealTokenValueXX/);
  assert.match(redactBotSecret("123456789:AAThisIsNotARealTokenValueXX"), /redacted/);
});

test("operations source never prints TELEGRAM_BOT_TOKEN", () => {
  const src = readFileSync(new URL("../../app/admin/operations/operations-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(src, /process\.env/);
});
