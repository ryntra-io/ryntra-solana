// Run from repo root: node --test lib/agent/credits-service-ai04.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AgentBriefResponseSchema, AgentMessageResponseSchema, AgentSessionResponseSchema } from "../api/v1/contract.ts";
import { accountHolder, grantCredits, readBalance, readEntries, walletHolder } from "../assistant/credits/ledger.ts";
import { resolveCreditsConfig } from "../assistant/credits/prices.ts";
import { resolveAgentBudgetConfig } from "./budget.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER } from "./fixtures.ts";
import { handleAgentBrief, handleAgentCritic } from "./lens/service.ts";
import { createFixtureAgentModel } from "./model.ts";
import { handleAgentMessage, handleGuestMessage, openAgentSession } from "./service.ts";
import { AGENT_TOOLS, forbiddenWordsIn } from "./tools/registry.ts";

/**
 * AI-04 in the assistant: a question that reaches the model is paid in
 * credits — free ones first; nothing of the balance without the price the
 * person was shown; kept only when the model's words were used; given back
 * when the provider failed or was never reached. Over the credits the answer
 * is still given, composed from the reads.
 */

const ACCOUNT = "0f0e0d0c-0000-4000-8000-0000000000aa";

async function world(options = {}) {
  const fixture = await createFixtureWorld();
  const deps = {
    store: fixture.store,
    readers: fixture.readers,
    model: options.model ?? createFixtureAgentModel(),
    budget: { ...resolveAgentBudgetConfig({}), modelEnabled: true },
    credits: { config: { ...resolveCreditsConfig({}), ...(options.credits ?? {}) }, lookup: options.lookup ?? null },
    now: () => FIXTURE_NOW_MS,
  };
  const opened = await openAgentSession(deps, { owner: OWNER, locale: "en", context: null });
  assert.ok(opened.ok);
  AgentSessionResponseSchema.parse(opened.response);
  const ask = async (text, acceptCredits = undefined) => {
    const result = await handleAgentMessage(deps, { owner: OWNER, sessionId: opened.response.session.id, text, locale: "en", acceptCredits });
    assert.ok(result.ok);
    AgentMessageResponseSchema.parse(result.response);
    return result.response;
  };
  return { deps, ask, opened: opened.response };
}

const holder = walletHolder(OWNER);

test("the session shows the price before the first question: the free credits of the day and every action's price", async () => {
  const { opened } = await world();
  const credits = opened.budget.credits;
  assert.deepEqual([credits.unit, credits.free.left, credits.free.daily, credits.prices.question, credits.balance, credits.welcomeOffer, credits.holder], ["credits", 20, 20, 2, 0, "open", "wallet"]);
  assert.equal(opened.budget.exhausted, false);
});

test("free credits pay a model's answer; a deterministic answer costs nothing", async () => {
  const { ask } = await world();
  const paid = await ask("Why is SOL moving?");
  assert.equal(paid.ryn.composedBy, "model");
  assert.equal(paid.budget.credits.free.used, 2);
  const free = await ask("Why is ZZZZ moving?");
  assert.equal(free.ryn.composedBy, "deterministic");
  assert.equal(free.budget.credits.free.used, 2, "a question the model never words costs nothing");
  /* AI-06c: a talk the model words costs what a question costs — no more. */
  const talk = await ask("hello");
  assert.equal(talk.ryn.composedBy, "model");
  assert.equal(talk.budget.credits.free.used, 4);
  const kinds = (await readEntries((await world()).deps.store, holder)).map((entry) => entry.kind);
  assert.deepEqual(kinds, [], "another world's store is its own");
});

test("past the free credits: without the price shown nothing of the balance is taken and the answer is composed from the reads", async () => {
  const { deps, ask } = await world({ credits: { freeDaily: 2 } });
  await grantCredits(deps.store, holder, { credits: 100, bucket: "bonus", reason: "welcome", idem: "w", nowMs: FIXTURE_NOW_MS });
  assert.equal((await ask("Why is SOL moving?")).ryn.composedBy, "model", "the day's free credits pay the first");
  const unshown = await ask("Why is SOL moving?");
  assert.equal(unshown.ryn.composedBy, "deterministic");
  assert.equal((await readBalance(deps.store, holder)).bonus, 100, "the balance untouched");
  const below = await ask("Why is SOL moving?", 1);
  assert.equal(below.ryn.composedBy, "deterministic", "a price above the one shown is refused");
  const shown = await ask("Why is SOL moving?", 2);
  assert.equal(shown.ryn.composedBy, "model");
  assert.equal(shown.budget.credits.balance, 98);
  assert.equal(shown.budget.credits.welcome, 98);
});

test("an empty balance: refused before the call, the answer still given, the reason said; never below zero", async () => {
  const { deps, ask } = await world({ credits: { freeDaily: 0 } });
  const answer = await ask("Why is SOL moving?", 2);
  assert.equal(answer.ryn.composedBy, "deterministic");
  assert.equal(answer.budget.exhausted, true);
  assert.match(answer.budget.reason, /free credits are spent/);
  const balance = await readBalance(deps.store, holder);
  assert.ok(balance === null || (balance.bonus === 0 && balance.paid === 0));
});

test("the model failed or timed out: the credits come back; never reached: the call and the credits come back", async () => {
  for (const fail of ["timeout", "invalid-output", "unavailable"]) {
    const { deps, ask } = await world({ model: createFixtureAgentModel({ fail }), credits: { freeDaily: 0 } });
    await grantCredits(deps.store, holder, { credits: 10, bucket: "paid", reason: "purchase", idem: "p", nowMs: FIXTURE_NOW_MS });
    const answer = await ask("Why is SOL moving?", 2);
    assert.equal(answer.ryn.composedBy, "deterministic");
    const balance = await readBalance(deps.store, holder);
    assert.deepEqual([balance.paid, balance.holds.length, balance.spentTotal], [10, 0, 0], `${fail}: nothing kept`);
    if (fail === "unavailable") assert.equal(answer.budget.day.used, 0, "the call given back too");
  }
});

test("a lens format worded by the model costs a token report's price, only at the price shown", async () => {
  const { deps } = await world({ credits: { freeDaily: 0 } });
  await grantCredits(deps.store, holder, { credits: 20, bucket: "paid", reason: "purchase", idem: "p", nowMs: FIXTURE_NOW_MS });
  const subject = { kind: "asset", mint: "So11111111111111111111111111111111111111112", symbol: "SOL" };
  const unshown = await handleAgentBrief(deps, { owner: OWNER, subject, locale: "en", compose: "model" });
  assert.ok(unshown.ok);
  AgentBriefResponseSchema.parse(unshown.response);
  assert.equal(unshown.response.composedBy, "deterministic");
  assert.equal((await readBalance(deps.store, holder)).paid, 20);
  const shown = await handleAgentBrief(deps, { owner: OWNER, subject, locale: "en", compose: "model", acceptCredits: 5 });
  assert.equal(shown.response.composedBy, "model");
  assert.equal(shown.response.budget.credits.bought, 15);
  /* The Critic runs on the stronger model: a deep analysis' price, refused at a Brief's. */
  const critic = await handleAgentCritic(deps, { owner: OWNER, subject, locale: "en", compose: "model", acceptCredits: 5 });
  assert.ok(critic.ok);
  assert.equal(critic.response.budget.credits.bought, 15, "a Critic is not a Brief's price");
});

test("a linked wallet spends its account's credits; its own move there once", async () => {
  const { deps, ask } = await world({ lookup: async () => ACCOUNT, credits: { freeDaily: 0 } });
  await grantCredits(deps.store, holder, { credits: 50, bucket: "paid", reason: "purchase", idem: "p", nowMs: FIXTURE_NOW_MS });
  const answer = await ask("Why is SOL moving?", 2);
  assert.equal(answer.budget.credits.holder, "account");
  assert.equal(answer.budget.credits.bought, 48);
  assert.equal((await readBalance(deps.store, accountHolder(ACCOUNT))).paid, 48);
  assert.equal((await readBalance(deps.store, holder)).paid, 0);
});

test("a guest pays no credits; the assistant has no tool that grants, spends or moves credits", async () => {
  const { deps } = await world();
  const guest = await handleGuestMessage(deps, { guest: `guest_${"a".repeat(32)}`, text: "Why is SOL moving?", locale: "en", context: null });
  assert.ok(guest.ok);
  assert.equal((await readEntries(deps.store, holder)).length, 0);
  for (const tool of AGENT_TOOLS) assert.ok(!/credit|grant|spend|charge|pay|purchase|transfer|sign|send/i.test(tool.name), `no paying tool: ${tool.name}`);
  for (const name of ["grant_credits", "creditsSpend", "charge-question", "top_up_balance", "refund_credits", "buy_credits"]) assert.ok(forbiddenWordsIn(name).length > 0, `${name} is refused by the boundary`);
});
