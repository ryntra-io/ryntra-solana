/* The agent's book takes a budget with the agent's own sale, or a bot's, only from her proven wallet: the proof
   of a change (`ownerProof`), as the doors of her agents and her care ask it. And the engine's switches: the cron's route
   reads them from its environment and hands them to the pass (`engineSwitchesOf`) — only «on» opens. No network. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { ownerProof } from "./http.server.ts";
import { engineSwitchesOf } from "./agent-service.server.ts";

const RATE = { allowed: true, limit: 30, remaining: 29, resetAt: Date.now() + 60_000 };
const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const request = new Request("https://ryntra.io/api/bots/mandate/agent", { method: "POST" });
const refusal = async (response) => [response.status, (await response.json()).error.code];

test("only her proven wallet joins a budget with the agent's own sale", async () => {
  assert.equal(await ownerProof(request, OWNER, RATE, async () => ({ ok: true, address: OWNER })), null, "proven for her: on");
  assert.deepEqual(await refusal(await ownerProof(request, OWNER, RATE, async () => ({ ok: true, address: "11111111111111111111111111111111" }))), [403, "WALLET_MISMATCH"]);
  const none = Response.json({ error: { code: "UNAUTHORIZED", message: "No proven wallet: sign in with the wallet first." } }, { status: 401 });
  assert.deepEqual(await refusal(await ownerProof(request, OWNER, RATE, async () => ({ ok: false, response: none }))), [401, "UNAUTHORIZED"]);
  const elsewhere = Response.json({ error: { code: "FORBIDDEN", message: "A change from a browser must come from this site." } }, { status: 403 });
  assert.deepEqual(await refusal(await ownerProof(request, OWNER, RATE, async () => ({ ok: false, response: elsewhere }))), [403, "FORBIDDEN"]);
  /* A session store that does not answer is no proof. */
  assert.deepEqual(await refusal(await ownerProof(request, OWNER, RATE, async () => Promise.reject(new Error("down")))), [503, "UNAVAILABLE"]);
});

test("the engine's switches from the environment — closed unless «on»", () => {
  assert.deepEqual(engineSwitchesOf({}), { agentExit: false, bots: { grid: false, signals: false } });
  assert.deepEqual(engineSwitchesOf({ RYNTRA_AGENT_EXIT: "on", RYNTRA_BOTS_MONEY: "on" }), { agentExit: true, bots: { grid: true, signals: true } });
  assert.deepEqual(engineSwitchesOf({ RYNTRA_AGENT_EXIT: "yes", RYNTRA_BOTS_MONEY: "on", RYNTRA_BOTS_SIGNALS_MONEY: "off" }), { agentExit: false, bots: { grid: true, signals: false } });
});
