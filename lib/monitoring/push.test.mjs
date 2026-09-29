import assert from "node:assert/strict";
import test from "node:test";

import { pushProviderConfigured, sendPushNote } from "./push.ts";

test("a missing key is skipped, never treated as a sent note", async () => {
  assert.equal(pushProviderConfigured({}), false);
  const result = await sendPushNote(
    { token: "a".repeat(32), title: "Ryntra", body: "Your plan needs attention.", href: "https://ryntra.io/app/alerts" },
    {},
    async () => {
      throw new Error("must not call the provider without a key");
    },
  );
  assert.equal(result, "skipped_no_provider");
});

test("a legacy FCM success is sent; NotRegistered is unregistered", async () => {
  const env = { RYNTRA_PUSH_SERVER_KEY: "legacy-server-key" };
  const sent = await sendPushNote(
    { token: "a".repeat(32), title: "Ryntra", body: "Your NVDAx plan needs attention.", href: "https://ryntra.io/app/alerts/open?n=inb_1" },
    env,
    async () => new Response(JSON.stringify({ success: 1, failure: 0, results: [{}] }), { status: 200 }),
  );
  assert.equal(sent, "sent");
  const gone = await sendPushNote(
    { token: "a".repeat(32), title: "Ryntra", body: "Your NVDAx plan needs attention.", href: "https://ryntra.io/app/alerts" },
    env,
    async () => new Response(JSON.stringify({ success: 0, failure: 1, results: [{ error: "NotRegistered" }] }), { status: 200 }),
  );
  assert.equal(gone, "unregistered");
});
