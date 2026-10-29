// Run from repo root: node --test lib/agent/budget.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { AGENT_BUDGET_ENV, readAgentUsage, readBudgetState, readGuestAllowance, reserveCall, reserveGuestCall, resolveAgentBudgetConfig, writeReceipt } from "./budget.ts";
import { OWNER, OTHER_WALLET } from "./fixtures.ts";

/**
 * The durable budget: allowances per wallet per day and per month, an
 * in-flight lease, the deployment's ceilings, refusals with the reason,
 * receipts the admin reads — all in the store, with clock control; never a
 * process-local counter.
 */

const NOW = Date.parse("2026-09-22T10:00:00.000Z");
const config = (patch = {}) => ({ ...resolveAgentBudgetConfig({}), modelEnabled: true, ...patch });

test("the configuration: defaults, the env overrides, and the model switched on only by its explicit switch beside the key", () => {
  const defaults = resolveAgentBudgetConfig({});
  /* AI-04: credits meter a wallet; its call counters are a safety cap well above a day of credits. */
  assert.deepEqual([defaults.dailyCalls, defaults.monthlyCalls, defaults.inFlight, defaults.globalDailyCalls, defaults.globalMonthlyCalls, defaults.modelEnabled], [200, 3000, 1, 300, 3000, false]);
  assert.equal(resolveAgentBudgetConfig({ [AGENT_BUDGET_ENV.daily]: "5" }).dailyCalls, 5);
  assert.equal(resolveAgentBudgetConfig({ [AGENT_BUDGET_ENV.daily]: "nope" }).dailyCalls, 200);
  assert.equal(resolveAgentBudgetConfig({ OPENAI_API_KEY: "sk-test" }).modelEnabled, false, "a key alone switches nothing on");
  assert.equal(resolveAgentBudgetConfig({ [AGENT_BUDGET_ENV.modelEnabled]: "1" }).modelEnabled, false, "the switch alone reaches no provider");
  assert.equal(resolveAgentBudgetConfig({ [AGENT_BUDGET_ENV.modelEnabled]: "1", OPENAI_API_KEY: "sk-test" }).modelEnabled, true);
});

test("a call is counted on every counter, refused over the daily allowance with the reason and the reset time, and refunded when the provider was never reached", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ dailyCalls: 2, monthlyCalls: 10 });
  const first = await reserveCall(store, OWNER, cfg, NOW);
  assert.ok(first.ok);
  await first.release();
  let state = await readBudgetState(store, OWNER, cfg, NOW);
  assert.deepEqual([state.day.used, state.month.used, state.inFlight.used, state.exhausted], [1, 1, 0, false]);
  const second = await reserveCall(store, OWNER, cfg, NOW);
  assert.ok(second.ok);
  await second.release();
  state = await readBudgetState(store, OWNER, cfg, NOW);
  assert.equal(state.exhausted, true);
  assert.match(state.reason, /daily allowance of 2 model calls .* resets at 2026-09-23T00:00:00.000Z/);
  const third = await reserveCall(store, OWNER, cfg, NOW);
  assert.equal(third.ok, false);
  assert.equal(third.code, "AGENT_BUDGET_EXHAUSTED");
  assert.match(third.reason, /daily allowance/);
  assert.equal((await readBudgetState(store, OWNER, cfg, NOW)).inFlight.used, 0, "a refused reservation holds no lease");
  /* The next day the allowance is back; a refund gives a call back. */
  const tomorrow = NOW + 86_400_000;
  const fourth = await reserveCall(store, OWNER, cfg, tomorrow);
  assert.ok(fourth.ok);
  await fourth.refund();
  await fourth.release();
  assert.equal((await readBudgetState(store, OWNER, cfg, tomorrow)).day.used, 0);
  assert.equal((await readBudgetState(store, OWNER, cfg, tomorrow)).month.used, 2, "the month keeps the two calls that reached the provider");
});

test("the in-flight lease: a second question while one is answered is busy; a lease that never settled expires", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ leaseMs: 1_000 });
  const first = await reserveCall(store, OWNER, cfg, NOW);
  assert.ok(first.ok);
  const second = await reserveCall(store, OWNER, cfg, NOW + 10);
  assert.equal(second.ok, false);
  assert.equal(second.code, "AGENT_BUSY");
  assert.equal((await readBudgetState(store, OWNER, cfg, NOW + 10)).reason, "A question of this wallet is being answered right now.");
  /* Another wallet is not held by this wallet's lease. */
  const other = await reserveCall(store, OTHER_WALLET, cfg, NOW + 10);
  assert.ok(other.ok);
  await other.release();
  /* Past the lease's life the crashed instance's lease no longer holds. */
  const later = await reserveCall(store, OWNER, cfg, NOW + 2_000);
  assert.ok(later.ok);
  await later.release();
  await first.release();
});

test("the deployment's ceiling refuses every wallet once spent, with its own reason", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ globalDailyCalls: 1, dailyCalls: 5 });
  const one = await reserveCall(store, OWNER, cfg, NOW);
  assert.ok(one.ok);
  await one.release();
  const other = await reserveCall(store, OTHER_WALLET, cfg, NOW);
  assert.equal(other.ok, false);
  assert.match(other.reason, /deployment's daily ceiling of 1/);
});

test("receipts are aggregated for the admin by day and by model — wallets counted, never listed, never the words; dollars from the provider's usage", async () => {
  const store = createMemoryGuardStore();
  const cfg = config();
  for (const [owner, outcome] of [[OWNER, "ok"], [OWNER, "ok"], [OTHER_WALLET, "timeout"]]) {
    const reservation = await reserveCall(store, owner, cfg, NOW);
    assert.ok(reservation.ok);
    await writeReceipt(store, { owner, sessionId: "ags_" + "0".repeat(32), turnId: "agt_" + "0".repeat(24), model: "gpt-6-luna", promptVersion: "ryntra-text-v4", task: "answer", tokens: { input: 1000, cached: 400, output: 200, reasoning: 50, total: 1200 }, latencyMs: 12, outcome, at: new Date(NOW).toISOString() });
    await reservation.release();
  }
  /* A receipt written before AI-02 (schema 1.0.0) is still read: counted, unpriced — never free. */
  await store.versioned("agentReceipts").compareAndSet(`solana:mainnet:${OWNER}:agr_${"f".repeat(24)}`, null, { schema: "ryntra.agent-receipt", schemaVersion: "1.0.0", version: 1, id: `agr_${"f".repeat(24)}`, owner: OWNER, sessionId: "ags_" + "0".repeat(32), turnId: "agt_" + "0".repeat(24), model: "gpt-5.6-sol", promptVersion: "ryntra-text-v3", phase: "answer", tokens: { input: 100, output: 50, total: 150 }, latencyMs: 9, outcome: "ok", at: new Date(NOW).toISOString() });
  const usage = await readAgentUsage(store, cfg, NOW, 14);
  assert.equal(usage.today.calls, 3);
  /* 600 uncached × $0.10 + 400 cached × $0.01 + 200 out × $0.50 per 1M = 164 µ$ a call. */
  assert.deepEqual(usage.byDay, [{ day: "2026-09-22", calls: 4, tokens: 3750, wallets: 2, guests: 0, costUsd: 0.000492, unpriced: 1, outcomes: { ok: 3, timeout: 1 } }]);
  assert.deepEqual(usage.byModel.find((row) => row.model === "gpt-6-luna"), { model: "gpt-6-luna", calls: 3, inputTokens: 3000, cachedTokens: 1200, outputTokens: 600, costUsd: 0.000492, unpriced: 0 });
  assert.equal(usage.models.answer.name, "gpt-6-luna");
  assert.equal(usage.models.critic.class, "L2");
  assert.ok(!JSON.stringify(usage).includes(OWNER), "no wallet is listed");
});

test("a guest's allowance: a few model answers a day per guest, the guests' ceiling under half the deployment's, refunds when never reached", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ guestDailyCalls: 2, guestGlobalDailyCalls: 3, globalDailyCalls: 10 });
  const guest = `guest_${"a".repeat(32)}`;
  const other = `guest_${"b".repeat(32)}`;
  assert.ok((await reserveGuestCall(store, guest, cfg, NOW)).ok);
  const second = await reserveGuestCall(store, guest, cfg, NOW);
  assert.ok(second.ok);
  const third = await reserveGuestCall(store, guest, cfg, NOW);
  assert.deepEqual([third.ok, third.code], [false, "AGENT_BUDGET_EXHAUSTED"]);
  assert.match(third.reason, /connect a wallet/);
  assert.deepEqual(await readGuestAllowance(store, guest, cfg, NOW), { used: 2, allowance: 2, resetsAt: "2026-09-23T00:00:00.000Z" }, "a refused call is not counted");
  /* A provider never reached gives the call back. */
  await second.refund();
  assert.equal((await readGuestAllowance(store, guest, cfg, NOW)).used, 1);
  /* The guests together stop at their ceiling, whoever asks. */
  assert.ok((await reserveGuestCall(store, other, cfg, NOW)).ok);
  assert.ok((await reserveGuestCall(store, other, cfg, NOW)).ok);
  const over = await reserveGuestCall(store, `guest_${"c".repeat(32)}`, cfg, NOW);
  assert.equal(over.ok, false);
  /* A guest's calls count on the deployment's ceiling too. */
  const state = await readBudgetState(store, OWNER, cfg, NOW);
  assert.equal(state.exhausted, false);
  assert.equal((await reserveGuestCall(store, "not-a-digest", cfg, NOW)).ok, false, "only a digest is a guest");
  /* The default guests' ceiling never exceeds half the deployment's. */
  assert.equal(resolveAgentBudgetConfig({ RYNTRA_AGENT_GLOBAL_DAILY_CALLS: "50" }).guestGlobalDailyCalls, 25);
  assert.equal(resolveAgentBudgetConfig({ RYNTRA_AGENT_GLOBAL_DAILY_CALLS: "50", RYNTRA_ASSISTANT_GUEST_GLOBAL_DAILY_CALLS: "400" }).guestGlobalDailyCalls, 25);
});

test("two guests at once never pass the limit together: the count is taken first and judged after", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ guestDailyCalls: 3, guestGlobalDailyCalls: 100, globalDailyCalls: 300 });
  const guest = `guest_${"d".repeat(32)}`;
  const results = await Promise.all(Array.from({ length: 8 }, () => reserveGuestCall(store, guest, cfg, NOW)));
  assert.equal(results.filter((result) => result.ok).length, 3);
  assert.equal((await readGuestAllowance(store, guest, cfg, NOW)).used, 3);
});
