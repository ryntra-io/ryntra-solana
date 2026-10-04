// Run from repo root: node --test lib/agent/budget.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { AGENT_BUDGET_ENV, readAgentUsage, readBudgetState, reserveCall, resolveAgentBudgetConfig, writeReceipt } from "./budget.ts";
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
  assert.deepEqual([defaults.dailyCalls, defaults.monthlyCalls, defaults.inFlight, defaults.globalDailyCalls, defaults.globalMonthlyCalls, defaults.modelEnabled], [20, 200, 1, 300, 3000, false]);
  assert.equal(resolveAgentBudgetConfig({ [AGENT_BUDGET_ENV.daily]: "5" }).dailyCalls, 5);
  assert.equal(resolveAgentBudgetConfig({ [AGENT_BUDGET_ENV.daily]: "nope" }).dailyCalls, 20);
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

test("receipts are aggregated for the admin by day and by model — wallets counted, never listed, never the words", async () => {
  const store = createMemoryGuardStore();
  const cfg = config();
  for (const [owner, outcome] of [[OWNER, "ok"], [OWNER, "ok"], [OTHER_WALLET, "timeout"]]) {
    const reservation = await reserveCall(store, owner, cfg, NOW);
    assert.ok(reservation.ok);
    await writeReceipt(store, { owner, sessionId: "ags_" + "0".repeat(32), turnId: "agt_" + "0".repeat(24), model: "fixture", promptVersion: "ryntra-text-v2", phase: "answer", tokens: { input: 100, output: 50, total: 150 }, latencyMs: 12, outcome, at: new Date(NOW).toISOString() });
    await reservation.release();
  }
  const usage = await readAgentUsage(store, cfg, NOW, 14);
  assert.equal(usage.today.calls, 3);
  assert.deepEqual(usage.byDay, [{ day: "2026-09-22", calls: 3, tokens: 450, wallets: 2, outcomes: { ok: 2, timeout: 1 } }]);
  assert.deepEqual(usage.byModel, [{ model: "fixture", calls: 3, inputTokens: 300, outputTokens: 150 }]);
  assert.ok(!JSON.stringify(usage).includes(OWNER), "no wallet is listed");
});
