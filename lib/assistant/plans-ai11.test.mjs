// Run from repo root: node --test lib/assistant/plans-ai11.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { AssistantPlanCreateSchema, AssistantPlanResponseSchema, AssistantPlansResponseSchema, AssistantPlanStateRequestSchema, AssistantPlanUpdateSchema } from "../api/v1/contract.ts";
import { resolveAgentBudgetConfig } from "../agent/budget.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, findRowFixture, OWNER, readMarketFixture, SOL } from "../agent/fixtures.ts";
import { AGENT_TOOLS, forbiddenWordsIn } from "../agent/tools/registry.ts";
import { grantCredits, readBalance, walletHolder } from "./credits/ledger.ts";
import { DEFAULT_CREDIT_PRICES, resolveCreditsConfig } from "./credits/prices.ts";
import { MODEL_TASKS, TASK_CLASS } from "./models.ts";
import { buildPlanBody, costBufferFor, feesOf, NETWORK_FEE_USD, ryntraFeeBpsOf } from "./plans/build.ts";
import { ruleFindings } from "./plans/checks.ts";
import { ArchitectOutputSchema, createFixturePlanModel, createOpenAiPlanModel, PlanCriticOutputSchema, verifyArchitect, verifyCritic } from "./plans/model.ts";
import { readPlanInputs } from "./plans/reads.ts";
import { realityOf } from "./plans/reality.ts";
import { createAssistantPlan, editAssistantPlan, listAssistantPlansAnswer, readAssistantPlanAnswer, recheckAssistantPlan, setAssistantPlanState } from "./plans/service.ts";
import { listAssistantPlans, readAssistantPlan } from "./plans/store.ts";
import { createPlan, getPlan, getPlanResults, setPlanStatus, updatePlan } from "../plans/service.ts";

/**
 * AI-11 — «План угоди й критик»: a plan as a structure the strong model
 * composes with the person and a critic under its own instruction argues
 * with; every change a new version; states from a draft to «зламано»;
 * watched through the person's own Trading Plan by Нагляд; «план проти
 * реальності» with each trade's receipt and risk in words; 130 credits for
 * a plan with its critic, at the price shown. Ryntra can never start a
 * trade. On the fixture world and a memory store — nothing reaches the
 * network.
 */

const holder = walletHolder(OWNER);
const fixturePlanDeps = { findRow: findRowFixture, readMarket: readMarketFixture, now: () => new Date(FIXTURE_NOW_MS) };

async function world(options = {}) {
  const fixture = await createFixtureWorld();
  const store = fixture.store;
  const synced = [];
  const watch = { status: "watching", lastCheckedAt: null, line: null, invalidationAt: null };
  const plans = {
    async create(owner, mint, rules, activate) {
      const made = await createPlan(store, { owner, mint, rules, activate }, fixturePlanDeps);
      return made.ok ? { ok: true, plan: made.plan } : { ok: false, code: made.code, message: made.message, issues: made.issues };
    },
    async read(owner, planId) {
      const read = await getPlan(store, owner, planId, fixturePlanDeps);
      return read.ok ? read.plan : null;
    },
    async setStatus(owner, planId, status, ifVersion, reason) {
      const set = await setPlanStatus(store, { owner, planId, status, ifVersion, reason }, fixturePlanDeps);
      return set.ok ? { ok: true, plan: set.plan } : { ok: false, code: set.code, message: set.message };
    },
    async results(owner, planId) {
      if (options.results) return options.results;
      const read = await getPlanResults(store, owner, planId, fixturePlanDeps);
      return read.ok ? { results: read.results, position: read.positions[0]?.position ?? null, complete: true } : null;
    },
  };
  const readers = options.price !== undefined ? { ...fixture.readers, spotMarket: async (mint) => { const read = await fixture.readers.spotMarket(mint); return read.ok && read.market ? { ...read, market: { ...read.market, price: options.price } } : read; } } : fixture.readers;
  const deps = {
    store,
    readers,
    model: options.model === undefined ? createFixturePlanModel() : options.model,
    budget: { ...resolveAgentBudgetConfig({}), modelEnabled: options.modelEnabled ?? true },
    credits: options.noCredits ? null : { holder, config: resolveCreditsConfig({}) },
    plans,
    monitoring: { async sync(owner) { synced.push(owner); }, async read() { return { ...watch }; } },
    now: () => FIXTURE_NOW_MS,
  };
  if (options.credits !== 0) await grantCredits(store, holder, { credits: options.credits ?? 1_000, bucket: "paid", reason: "purchase", idem: "seed", nowMs: FIXTURE_NOW_MS });
  return { deps, store, synced, watch, fixture };
}

const ask = (overrides = {}) => ({ mint: SOL, idea: "SOL keeps its range while the network's activity grows.", riskUsd: 20, budgetUsd: null, entryUsd: null, maxPriceUsd: null, invalidationUsd: null, targetsUsd: [], horizonDays: null, draftId: null, acceptCredits: 130, locale: "en", ...overrides });
const balanceOf = async (store) => {
  const row = await readBalance(store, holder);
  return row ? row.paid + row.bonus : 0;
};

/* ------------------------------------------------------------ the boundary: Ryntra can never start a trade */

test("no module of the plan imports a signer, a swap, a payment or a key, calls fetch or reads the environment", () => {
  const forbidden = /solana-swap|\/sign|signer|keypair|secret|\/pay\/|lib\/pay|submit|execute|order\.server|wallet-adapter|launch\/trade|transfer/i;
  const dirs = ["lib/assistant/plans", "app/api/v1/assistant/plans", "app/api/v1/assistant/plans/[id]", "app/api/v1/assistant/plans/[id]/critic", "app/api/v1/assistant/plans/[id]/state"];
  for (const dir of dirs) {
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts"))) {
      const source = readFileSync(`${dir}/${name}`, "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
      for (const path of imports) assert.ok(!forbidden.test(path), `${dir}/${name} imports ${path}`);
      assert.ok(!/\bfetch\(/.test(source), `${dir}/${name} calls fetch`);
      if (dir.startsWith("lib/")) assert.ok(!/process\.env/.test(source), `${dir}/${name} reads the environment`);
    }
  }
});

test("the agent's tools still only read and prepare: none approves, activates, writes a plan or trades", () => {
  for (const tool of AGENT_TOOLS) {
    assert.ok(tool.kind === "research" || tool.kind === "prepare", tool.name);
    assert.ok(!/approve|activate|create_plan|save_plan|write_plan|execute|place|submit|swap_now|sign|send/i.test(tool.name), `no acting tool: ${tool.name}`);
  }
  for (const name of ["execute_plan", "place_order", "activate_and_buy", "sign_plan_order"]) assert.ok(forbiddenWordsIn(name).length > 0, `${name} is refused by the boundary`);
});

test("the plan's shapes carry no transaction, order, signature or key — strict at every level", () => {
  for (const extra of [{ transaction: "AQ==" }, { order: {} }, { signature: "x".repeat(88) }, { privateKey: "k" }]) {
    assert.equal(AssistantPlanCreateSchema.safeParse({ ...ask(), ...extra }).success, false, Object.keys(extra)[0]);
    assert.equal(AssistantPlanUpdateSchema.safeParse({ ifVersion: 1, ...extra }).success, false);
    assert.equal(AssistantPlanStateRequestSchema.safeParse({ to: "watching", ifVersion: 1, ...extra }).success, false);
  }
  assert.equal(AssistantPlanStateRequestSchema.safeParse({ to: "executed", ifVersion: 1 }).success, false, "no state the person's word could turn into a trade");
  /* What the model may return has no field for money, an order or a signature. */
  const architectKeys = Object.keys(ArchitectOutputSchema.shape).join(",");
  assert.ok(!/risk|budget|usd|amount|size|order|sign|transaction|swap/i.test(architectKeys.replace("invalidation", "")), architectKeys);
  assert.equal(ArchitectOutputSchema.safeParse({ thesis: "t", whyNow: null, entryCondition: null, invalidation: null, targets: [], assumptions: [], insufficient: false, riskUsd: 5000 }).success, false);
  assert.equal(PlanCriticOutputSchema.safeParse({ findings: [], summary: null, gaps: [], order: { side: "BUY" } }).success, false);
});

test("the plan and its critic are strong-model tasks; every call writes its tokens and dollars", async () => {
  assert.ok(MODEL_TASKS.includes("plan") && MODEL_TASKS.includes("plan_critic") && MODEL_TASKS.includes("plan_check"));
  assert.equal(TASK_CLASS.plan, "L2");
  assert.equal(TASK_CLASS.plan_critic, "L2");
  assert.equal(TASK_CLASS.plan_check, "L1", "the judge is the everyday model");
  /* A provider stand-in that answers like OpenAI's Responses API, with the usage it bills. */
  const calls = [];
  const client = {
    responses: {
      async parse(body) {
        calls.push(body);
        const critic = body.model && body.text.format.name === "ryntra_plan_critic_v1";
        if (body.text.format.name === "ryntra_plan_check_v1") {
          const items = JSON.parse(body.input).sentences;
          return { id: "resp_j", output_parsed: { verdicts: items.map((item) => ({ i: item.i, rule: "none" })) }, usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 0 }, output_tokens: 60, output_tokens_details: { reasoning_tokens: 20 } } };
        }
        const output_parsed = critic
          ? { findings: [{ kind: "fees", severity: "minor", field: "fees", text: "The costs matter on a small move.", cites: [] }], summary: null, gaps: [] }
          : { thesis: "SOL holds its range.", whyNow: null, entryCondition: null, invalidation: null, targets: [], assumptions: [], insufficient: false };
        return { id: "resp_1", output_parsed, usage: { input_tokens: critic ? 6000 : 12000, input_tokens_details: { cached_tokens: 4000 }, output_tokens: critic ? 600 : 1500, output_tokens_details: { reasoning_tokens: 300 } } };
      },
    },
  };
  const model = createOpenAiPlanModel({ env: { OPENAI_API_KEY: "test" }, client });
  assert.deepEqual(model.names, { plan: "gpt-6.1-sol", plan_critic: "gpt-6.1-sol", plan_check: "gpt-6-luna" });
  const lines = [];
  const info = console.info;
  console.info = (line) => lines.push(String(line));
  try {
    const { deps, store } = await world({ model });
    const made = await createAssistantPlan(deps, OWNER, ask());
    assert.ok(made.ok, made.reason);
    assert.equal(made.response.spent.credits, 130);
    /* The day's 20 free credits go first; the balance pays the rest. */
    assert.equal(await balanceOf(store), 1_000 - 110);
  } finally {
    console.info = info;
  }
  assert.equal(calls.length, 4, "the plan, its judge, the critic, its judge");
  assert.ok(calls.every((body) => body.store === false && typeof body.safety_identifier === "string" && !body.safety_identifier.includes(OWNER)), "nothing stored at the provider, no wallet");
  assert.notEqual(calls[0].instructions, calls[2].instructions, "the critic has its own instruction");
  assert.match(calls[2].instructions, /opposite of agreeing/);
  assert.match(calls[1].instructions, /forecast/);
  const cost = lines.filter((line) => line.startsWith("[assistant.cost]")).map((line) => JSON.parse(line.slice("[assistant.cost]".length).trim()));
  assert.deepEqual(cost.map((row) => [row.task, row.class, row.model]), [["plan", "L2", "gpt-6.1-sol"], ["plan_check", "L1", "gpt-6-luna"], ["plan_critic", "L2", "gpt-6.1-sol"], ["plan_check", "L1", "gpt-6-luna"]]);
  for (const row of cost) assert.ok(typeof row.costUsd === "number" && row.costUsd > 0 && row.input > 0 && row.output > 0, JSON.stringify(row));
  /* $2 / $0.10 / $10 per 1M: 8 000 uncached + 4 000 cached in, 1 500 out = $0.0314; the critic 2 000 + 4 000 in, 600 out = $0.0104. */
  assert.ok(Math.abs(cost[0].costUsd - 0.0314) < 0.0002, String(cost[0].costUsd));
  assert.ok(Math.abs(cost[2].costUsd - 0.0104) < 0.0002, String(cost[2].costUsd));
});

/* ------------------------------------------------------------ credits: 130 for a plan with its critic, at the price shown */

test("a plan with its critic costs 130 credits — taken once, only at the price the person was shown", async () => {
  assert.equal(DEFAULT_CREDIT_PRICES.plan, 130);
  const { deps, store } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask());
  assert.ok(made.ok, made.reason);
  AssistantPlanResponseSchema.parse(made.response);
  assert.deepEqual(made.response.prices, { plan: 130, recheck: 60 });
  assert.deepEqual(made.response.spent, { credits: 130, architect: "model", critic: "model" });
  /* 130 in all: the day's 20 free credits first, 110 of the balance. */
  assert.equal(await balanceOf(store), 890);
  assert.equal(made.response.budget.credits.free.used, 20);
  const plan = made.response.plan;
  assert.equal(plan.state, "checked");
  assert.equal(plan.version, 1);
  assert.equal(plan.current.critic.by, "model");
  assert.ok(plan.current.critic.findings.some((row) => row.by === "model"));
  assert.deepEqual(plan.journal.map((row) => row.event), ["created", "checked"]);
});

test("without the price shown, or under it, nothing is held, nothing is composed, nothing is stored", async () => {
  for (const acceptCredits of [null, 129]) {
    const { deps, store } = await world();
    const made = await createAssistantPlan(deps, OWNER, ask({ acceptCredits }));
    assert.equal(made.ok, false);
    assert.equal(made.code, "AGENT_BUDGET_EXHAUSTED");
    assert.equal(await balanceOf(store), 1_000);
    assert.equal((await listAssistantPlans(store, OWNER)).length, 0);
  }
  const { deps, store } = await world({ credits: 100 });
  const short = await createAssistantPlan(deps, OWNER, ask());
  assert.equal(short.ok, false, "a balance under the price refuses");
  assert.equal(await balanceOf(store), 100);
});

test("the provider never reached: every credit back and no plan; the critic not back: the plan's part only", async () => {
  {
    const { deps, store } = await world({ model: createFixturePlanModel({ fail: { architect: "unavailable" } }) });
    const made = await createAssistantPlan(deps, OWNER, ask());
    assert.equal(made.ok, false);
    assert.equal(made.code, "UNAVAILABLE");
    assert.equal(await balanceOf(store), 1_000);
    assert.equal((await listAssistantPlans(store, OWNER)).length, 0);
  }
  {
    const { deps, store } = await world({ model: createFixturePlanModel({ fail: { critic: "timeout" } }) });
    const made = await createAssistantPlan(deps, OWNER, ask());
    assert.ok(made.ok, made.reason);
    assert.deepEqual(made.response.spent, { credits: 70, architect: "model", critic: "rules" });
    assert.equal(made.response.plan.state, "draft", "unchecked by the strong critic");
    assert.equal(made.response.plan.current.critic.by, "rules");
    assert.ok(made.response.plan.current.critic.gaps.some((gap) => /strong critic did not run/.test(gap)));
    assert.equal(await balanceOf(store), 950, "70 in all: 20 free, 50 of the balance");
  }
});

test("without a model the plan is the plan engine's own from the person's figures — free, and said so", async () => {
  const { deps, store } = await world({ model: null });
  const made = await createAssistantPlan(deps, OWNER, ask({ acceptCredits: null }));
  assert.ok(made.ok, made.reason);
  assert.deepEqual(made.response.spent, { credits: 0, architect: "rules", critic: "rules" });
  assert.equal(await balanceOf(store), 1_000);
  assert.equal(made.response.plan.actions.recheck, false);
});

/* ------------------------------------------------------------ the structure */

test("the plan is a structure: thesis, entry, invalidation, the person's money, targets, fees, size, assumptions with their authors, sources", async () => {
  const { deps } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask({ riskUsd: 25, budgetUsd: 600 }));
  assert.ok(made.ok, made.reason);
  const body = made.response.plan.current.body;
  assert.deepEqual(Object.keys(body).sort(), ["assumptions", "entry", "fees", "invalidation", "lossLimit", "sizing", "sources", "targets", "thesis"]);
  assert.deepEqual(body.lossLimit, { riskUsd: 25, budgetUsd: 600 }, "money is the person's");
  assert.equal(body.entry.by, "market");
  assert.equal(body.entry.priceUsd, 212.5);
  assert.ok(body.invalidation.priceUsd < body.entry.priceUsd);
  assert.equal(body.invalidation.by, "ryntra", "a level the person did not name is Ryntra's proposal, marked");
  assert.ok(body.assumptions.some((row) => row.by === "ryntra" && /Ryntra proposed/.test(row.text)));
  assert.ok(body.targets.length >= 1 && body.targets.every((row) => row.priceUsd > body.entry.priceUsd));
  assert.ok(body.sources.length >= 2 && body.sources.every((source) => /^s\d+$/.test(source.id)));
  assert.equal(body.fees.ryntraFeeBps, 10, "SOL is a major: 0.10 % under fee policy 2.0.0");
  assert.equal(body.sizing.model, "spot-long-v1");
});

test("the person's levels win over Ryntra's, and a model's level outside the bounds is not taken", async () => {
  const { deps } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask({ invalidationUsd: 200, targetsUsd: [240, 230] }));
  assert.ok(made.ok, made.reason);
  const body = made.response.plan.current.body;
  assert.deepEqual([body.invalidation.priceUsd, body.invalidation.by], [200, "person"]);
  assert.deepEqual(body.targets.map((row) => [row.priceUsd, row.by]), [[230, "person"], [240, "person"]]);
  const reads = await readPlanInputs((await createFixtureWorld()).readers, SOL, FIXTURE_NOW_MS);
  assert.ok(reads.ok);
  const asset = reads.reads.asset.asset;
  const built = buildPlanBody({ asset, idea: "x", person: { entryUsd: null, maxPriceUsd: null, invalidationUsd: null, targetsUsd: [], riskUsd: 10, budgetUsd: null, horizonDays: null }, draft: null, proposal: { thesis: null, whyNow: null, entryCondition: null, invalidation: { priceUsd: 50, why: "far" }, targets: [{ priceUsd: 5000, why: "moon" }], assumptions: [] }, priceUsd: 212.5, sources: [], locale: "en", nowMs: FIXTURE_NOW_MS });
  assert.ok(built.ok);
  assert.equal(built.body.invalidation.by, "rules", "an invalidation more than half under the entry is not taken");
  assert.equal(built.body.targets[0].by, "rules", "a target five times the entry is not taken");
});

test("money must be named: no loss limit and no budget is refused before anything is spent", async () => {
  const { deps, store } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask({ riskUsd: null, budgetUsd: null }));
  assert.equal(made.ok, false);
  assert.equal(made.code, "VALIDATION_ERROR");
  assert.equal(await balanceOf(store), 1_000);
});

test("fees: Ryntra's by flow inside the cost buffer, the network beside it, counted once, and both outcomes", () => {
  assert.equal(ryntraFeeBpsOf({ mint: SOL, kind: "crypto" }), 10);
  assert.equal(ryntraFeeBpsOf({ mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", kind: "crypto" }), 50);
  assert.equal(ryntraFeeBpsOf({ mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", kind: "meme" }), 100);
  assert.deepEqual([costBufferFor(10), costBufferFor(50), costBufferFor(100)], [100, 150, 250], "the buffer holds Ryntra's fee in and out and slippage, never under 1 %");
  const fees = feesOf({ entryUsd: 100, invalidationUsd: 90, targetUsd: 120, units: 2, feeBps: 100, costBufferBps: 250 });
  /* Ryntra's $2 in and $2 out at the entry's price are inside the $5 buffer; the sale at the target pays $0.40 more, beside it with the network's $0.002: loss 20 + 5 + 0.002, reward 40 − 5.402. */
  assert.equal(fees.notionalUsd, 200);
  assert.equal(fees.ryntraFeeUsd, 4.4);
  assert.equal(fees.costBufferUsd, 5);
  assert.equal(fees.networkUsd, NETWORK_FEE_USD);
  assert.equal(fees.lossAtInvalidationUsd, 25);
  assert.equal(fees.rewardAtTargetUsd, 34.6);
  assert.equal(fees.totalUsd, 5.4);
  assert.equal(fees.rewardToRisk, 1.38);
});

test("the rules' critic: reward under risk, fees that eat the move, a loss over the limit, a price through the invalidation", async () => {
  const reads = await readPlanInputs((await createFixtureWorld()).readers, SOL, FIXTURE_NOW_MS);
  assert.ok(reads.ok);
  const asset = { ...reads.reads.asset.asset, kind: "meme" };
  const built = buildPlanBody({ asset, idea: "A short squeeze.", person: { entryUsd: 212.5, maxPriceUsd: null, invalidationUsd: 211, targetsUsd: [213], riskUsd: 10, budgetUsd: 5000, horizonDays: 7 }, draft: null, proposal: null, priceUsd: 212.5, sources: reads.reads.sources, locale: "en", nowMs: FIXTURE_NOW_MS });
  assert.ok(built.ok);
  const ids = ruleFindings(built.body, reads.reads, "en").map((row) => `${row.id}:${row.severity}`);
  for (const id of ["reward-below-risk:major", "fees-eat-reward:major", "invalidation-tight:minor", "thesis-short:minor"]) assert.ok(ids.includes(id), `${id} in ${ids}`);
  /* Ryntra's own plan keeps the person's limit with every fee — even on a meme's 1 % each way. */
  assert.ok(built.body.fees.lossAtInvalidationUsd <= built.body.lossLimit.riskUsd * 1.02, `${built.body.fees.lossAtInvalidationUsd} within ${built.body.lossLimit.riskUsd}`);
  assert.ok(!ids.some((id) => id.startsWith("loss-above-limit")));
  /* A version whose buffer was cut on the plan's page is told what it loses over the limit. */
  const cut = { ...built.body, fees: feesOf({ entryUsd: 212.5, invalidationUsd: 211, targetUsd: 213, units: built.body.sizing.units * 2, feeBps: 100, costBufferBps: 250 }) };
  assert.ok(ruleFindings(cut, reads.reads, "en").some((row) => row.id === "loss-above-limit" && row.severity === "major"));
  const through = ruleFindings(built.body, { ...reads.reads, priceUsd: 210 }, "en");
  assert.ok(through.some((row) => row.id === "price-below-invalidation" && row.severity === "major" && row.cites.length === 1));
  for (const row of ruleFindings(built.body, reads.reads, "uk")) assert.ok(row.text.length <= 200, `two lines: ${row.text}`);
});

test("the model is held to the reads: a command, a forecast, a figure nobody read, a sum of money and an unknown source are dropped", async () => {
  const { deps } = await world({ model: createFixturePlanModel({ invent: true }) });
  const made = await createAssistantPlan(deps, OWNER, ask());
  assert.ok(made.ok, made.reason);
  const plan = made.response.plan;
  const words = JSON.stringify(plan.current.body) + JSON.stringify(plan.current.critic);
  assert.ok(!/Buy now|will rise|999|5000|Hold until|777|will double|s99/.test(words), words.slice(0, 400));
  assert.equal(plan.current.body.thesis.by, "person", "a thesis that told the person to buy is dropped and the idea stands");
  /* The verifier on its own. */
  const reads = await readPlanInputs((await createFixtureWorld()).readers, SOL, FIXTURE_NOW_MS);
  const person = { entryUsd: null, maxPriceUsd: null, invalidationUsd: null, targetsUsd: [], riskUsd: 20, budgetUsd: null, horizonDays: null };
  const proposal = verifyArchitect({ thesis: "Купуй SOL, поки дешево.", whyNow: "SOL впаде до 150.", entryCondition: "Ціна зараз 212.5.", invalidation: { priceUsd: 190, why: "Нижче 123.45 ідея хибна." }, targets: [], assumptions: [], insufficient: false }, reads.reads, person);
  assert.equal(proposal.value.thesis, null);
  assert.equal(proposal.value.whyNow, null);
  assert.equal(proposal.value.entryCondition, "Ціна зараз 212.5.");
  assert.equal(proposal.value.invalidation, null, "a level whose reason cites a figure nobody read is not grounded");
  const critic = verifyCritic({ findings: [{ kind: "fees", severity: "major", field: "fees", text: "You should sell before the fees grow.", cites: ["s1"] }, { kind: "data", severity: "minor", field: "sources", text: "One price from one source.", cites: ["s1", "s42"] }], summary: "SOL will reach 400.", gaps: [] }, plan.current.body, reads.reads);
  assert.deepEqual(critic.value.findings.map((row) => [row.text, row.cites]), [["One price from one source.", ["s1"]]]);
  assert.equal(critic.value.summary, null);
});

test("a conversation's draft lends its figures: a plan stands on an existing draft", async () => {
  const { deps, store } = await world();
  const { storeDraft } = await import("../agent/drafts.ts");
  const draftId = "agd_" + "ab".repeat(12);
  const reads = await readPlanInputs(deps.readers, SOL, FIXTURE_NOW_MS);
  await storeDraft(store, { owner: OWNER, sessionId: "ags_" + "cd".repeat(16), turnId: "agt_" + "ef".repeat(12), nowMs: FIXTURE_NOW_MS, draft: { kind: "planDraft", draftId, asset: reads.reads.asset.asset, rules: null, sizing: null, planningPrice: null, prefill: { entryUsd: 210, maxPriceUsd: 214, invalidationUsd: 195, targetUsd: 250, budgetUsd: 400, riskUsd: 15, validUntil: null }, issues: [], assumptions: [], handoff: { kind: "builder", href: `/app/strategies/new?mint=${SOL}&draft=${draftId}`, label: "Open", primary: true } } });
  const made = await createAssistantPlan(deps, OWNER, ask({ riskUsd: null, draftId }));
  assert.ok(made.ok, made.reason);
  const body = made.response.plan.current.body;
  assert.deepEqual([body.entry.priceUsd, body.entry.maxPriceUsd, body.invalidation.priceUsd, body.targets[0].priceUsd, body.lossLimit.riskUsd, body.lossLimit.budgetUsd], [210, 214, 195, 250, 15, 400]);
});

/* ------------------------------------------------------------ versions and states */

test("a change is a new version: the old one stays as it was, the rules check it, the critic again only on a press", async () => {
  const { deps, store } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask());
  assert.ok(made.ok);
  const id = made.response.plan.id;
  const first = structuredClone(made.response.plan.current);
  const stale = await editAssistantPlan(deps, OWNER, id, { ifVersion: 2, invalidationUsd: 200, reason: null, locale: "en" });
  assert.equal(stale.code, "ASSISTANT_PLAN_VERSION_CONFLICT");
  const edited = await editAssistantPlan(deps, OWNER, id, { ifVersion: 1, invalidationUsd: 200, reason: "my own stop", locale: "en" });
  assert.ok(edited.ok, edited.reason);
  const plan = edited.response.plan;
  assert.equal(plan.version, 2);
  assert.equal(plan.state, "draft", "the strong critic has not seen version 2");
  assert.deepEqual([plan.current.by, plan.current.reason, plan.current.critic.by], ["person", "my own stop", "rules"]);
  assert.deepEqual([plan.current.body.invalidation.priceUsd, plan.current.body.invalidation.by], [200, "person"]);
  assert.ok(!plan.current.body.assumptions.some((row) => /proposed the invalidation/.test(row.text)), "the replaced level's assumption no longer holds");
  const record = await readAssistantPlan(store, OWNER, id);
  assert.deepEqual(record.versions[0], first, "version 1 is never rewritten");
  assert.equal(await balanceOf(store), 890, "an edit is free");
  const rechecked = await recheckAssistantPlan(deps, OWNER, id, { ifVersion: 2, acceptCredits: 60, locale: "en" });
  assert.ok(rechecked.ok, rechecked.reason);
  assert.equal(rechecked.response.plan.state, "checked");
  assert.equal(rechecked.response.spent.credits, 60);
  assert.equal(await balanceOf(store), 830);
  const unpriced = await recheckAssistantPlan(deps, OWNER, id, { ifVersion: 2, acceptCredits: null, locale: "en" });
  assert.equal(unpriced.ok, false);
  assert.equal(await balanceOf(store), 830);
});

test("approved writes the person's own Trading Plan from the version; watching makes it active for Нагляд; nothing trades", async () => {
  const { deps, store, synced } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask());
  const id = made.response.plan.id;
  const approved = await setAssistantPlanState(deps, OWNER, id, { to: "approved", ifVersion: 1, locale: "en" });
  assert.ok(approved.ok, approved.reason);
  const plan = approved.response.plan;
  assert.equal(plan.state, "approved");
  assert.equal(plan.tradingPlan.status, "draft");
  assert.equal(plan.current.tradingPlanVersion, 1);
  const tp = await getPlan(store, OWNER, plan.tradingPlan.id, fixturePlanDeps);
  assert.ok(tp.ok);
  assert.equal(tp.plan.executions.length, 0);
  assert.equal(tp.plan.current.rules.risk.invalidationPerShare, plan.current.body.invalidation.priceUsd);
  assert.equal(tp.plan.current.rules.exit.targetPerShare, plan.current.body.targets[0].priceUsd);
  assert.equal(tp.plan.current.rules.risk.plannedRiskUsd, 20);
  assert.equal(plan.actions.edit, false, "an approved plan is changed on its own page");
  const refused = await editAssistantPlan(deps, OWNER, id, { ifVersion: 1, invalidationUsd: 200, reason: null, locale: "en" });
  assert.equal(refused.code, "ASSISTANT_PLAN_STATE_REFUSED");
  const watching = await setAssistantPlanState(deps, OWNER, id, { to: "watching", ifVersion: 1, locale: "en" });
  assert.ok(watching.ok, watching.reason);
  assert.equal(watching.response.plan.state, "watching");
  assert.equal(watching.response.plan.tradingPlan.status, "active");
  assert.deepEqual(synced, [OWNER], "Нагляд writes the monitor at once");
  assert.deepEqual(watching.response.plan.journal.map((row) => row.event), ["created", "checked", "approved", "watching"]);
  const again = await setAssistantPlanState(deps, OWNER, id, { to: "approved", ifVersion: 1, locale: "en" });
  assert.equal(again.code, "ASSISTANT_PLAN_STATE_REFUSED");
});

test("a change on the plan's own page comes back as a new version here", async () => {
  const { deps, store } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask());
  const id = made.response.plan.id;
  const watching = await setAssistantPlanState(deps, OWNER, id, { to: "watching", ifVersion: 1, locale: "en" });
  const tpId = watching.response.plan.tradingPlan.id;
  const tp = await getPlan(store, OWNER, tpId, fixturePlanDeps);
  const rules = structuredClone(tp.plan.current.rules);
  rules.risk.invalidationPerShare = 199;
  const updated = await updatePlan(store, { owner: OWNER, planId: tpId, rules, ifVersion: 1, reason: "tighter" }, fixturePlanDeps);
  assert.ok(updated.ok, updated.message);
  const read = await readAssistantPlanAnswer(deps, OWNER, id, "en");
  assert.ok(read.ok);
  const plan = read.response.plan;
  assert.equal(plan.version, 2);
  assert.deepEqual([plan.current.by, plan.current.reason, plan.current.tradingPlanVersion, plan.current.body.invalidation.priceUsd, plan.current.body.invalidation.by], ["plan-page", "tighter", 2, 199, "person"]);
  assert.equal(plan.journal.at(-1).event, "synced");
  assert.equal((await readAssistantPlan(store, OWNER, id)).versions.length, 2, "written once");
});

test("broken: the price reached the invalidation, or Нагляд found it — once, and it stays ended", async () => {
  const { deps, store, watch } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask());
  const id = made.response.plan.id;
  await setAssistantPlanState(deps, OWNER, id, { to: "watching", ifVersion: 1, locale: "en" });
  watch.invalidationAt = new Date(FIXTURE_NOW_MS).toISOString();
  const read = await readAssistantPlanAnswer(deps, OWNER, id, "en");
  assert.deepEqual([read.response.plan.state, read.response.plan.stateReason], ["broken", "invalidation"]);
  assert.equal(read.response.plan.actions.cancel, false);
  watch.invalidationAt = null;
  const after = await readAssistantPlanAnswer(deps, OWNER, id, "en");
  assert.equal(after.response.plan.state, "broken", "an ended plan does not come back");
  assert.equal((await readAssistantPlan(store, OWNER, id)).journal.filter((row) => row.event === "broken").length, 1);

  const second = await world({ price: 1 });
  const other = await createAssistantPlan(second.deps, OWNER, ask({ entryUsd: 212.5 }));
  assert.ok(other.ok, other.reason);
  await setAssistantPlanState(second.deps, OWNER, other.response.plan.id, { to: "watching", ifVersion: 1, locale: "en" });
  const through = await readAssistantPlanAnswer(second.deps, OWNER, other.response.plan.id, "en");
  assert.equal(through.response.plan.state, "broken", "a price read at or under the invalidation breaks it too");
});

test("cancelled ends the plan and the person's Trading Plan with it while nothing was traded", async () => {
  const { deps, store } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask());
  const id = made.response.plan.id;
  const watching = await setAssistantPlanState(deps, OWNER, id, { to: "watching", ifVersion: 1, locale: "en" });
  const cancelled = await setAssistantPlanState(deps, OWNER, id, { to: "cancelled", ifVersion: 1, locale: "en" });
  assert.ok(cancelled.ok, cancelled.reason);
  assert.deepEqual([cancelled.response.plan.state, cancelled.response.plan.stateReason], ["cancelled", "person"]);
  const tp = await getPlan(store, OWNER, watching.response.plan.tradingPlan.id, fixturePlanDeps);
  assert.equal(tp.plan.status, "cancelled");
});

test("another wallet's plan is simply not found", async () => {
  const { deps } = await world();
  const made = await createAssistantPlan(deps, OWNER, ask());
  const other = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
  assert.equal((await readAssistantPlanAnswer(deps, other, made.response.plan.id, "en")).code, "ASSISTANT_PLAN_NOT_FOUND");
  assert.equal((await setAssistantPlanState(deps, other, made.response.plan.id, { to: "watching", ifVersion: 1, locale: "en" })).code, "ASSISTANT_PLAN_NOT_FOUND");
  const list = await listAssistantPlansAnswer(deps, other, "en");
  assert.equal(list.plans.length, 0);
  AssistantPlansResponseSchema.parse(await listAssistantPlansAnswer(deps, OWNER, "uk"));
});

/* ------------------------------------------------------------ plan against reality, the receipt and the risk */

function result(overrides = {}) {
  return {
    planId: "plan_" + "0".repeat(32),
    version: 1,
    asset: { network: "solana:mainnet", mint: SOL, symbol: "SOL", issuer: { id: "jupiter-verified", label: "Jupiter verified" }, underlying: { symbol: "SOL", name: null }, decimals: 9, unitBasis: "token", kind: "crypto" },
    plan: { entryPerShareUsd: 200, maxPricePerShareUsd: 204, budgetUsd: 500, spendableUsd: 495, plannedRiskUsd: 20, invalidationPerShareUsd: 190, costBufferBps: 100, sizedUnits: 1.666666, sizedNotionalUsd: 333.33 },
    beforeSigning: null,
    actual: { signature: "5".repeat(88), outcome: "DONE", settledAt: "2026-09-22T10:00:00.000Z", usd: 344, amount: "1.7", unit: "token", perShareUsd: 205, modelledLossUsd: null, feeUsd: 0.34, receiptHash: null, side: "BUY", leg: "entry", proceedsUsd: null, unitsOut: null, valueBasis: "PAR", feeBasis: "PAR", matchedBy: "binding" },
    checks: [],
    verdict: "deviated",
    costs: { plannedPerUnitUsd: 200, quotedPerUnitUsd: 204, filledPerUnitUsd: 205, marketMove: { usd: null, pct: null, basis: "UNKNOWN", reason: null }, execution: { usd: null, pct: null, basis: "UNKNOWN", reason: null }, fee: { usd: 0.34, pct: null, basis: "PAR", reason: null }, expected: { feeBps: 10, slippageBps: 50, priceImpactPct: null, quotedUsd: 344, referencePerUnitUsd: null } },
    exit: null,
    ...overrides,
  };
}

test("«План проти реальності»: each trade against its plan, the receipt and the risk in words, two lines each", () => {
  const position = { state: "open", unitsIn: "1.7", unitsOut: "0", unitsHeld: "1.7", entries: 1, exits: 0, costBasisUsd: 344, proceedsUsd: null, feesUsd: 0.34, realisedUsd: null, realisedMethod: null, unknowns: [] };
  for (const locale of ["en", "uk"]) {
    const reality = realityOf({ results: [result()], position, complete: true, symbol: "SOL", feeBps: 10, locale });
    const trade = reality.trades[0];
    assert.equal(trade.priceDeviationPct, 2.5);
    assert.equal(trade.sizeDeviationPct, 2);
    assert.equal(trade.verdict, "deviated");
    assert.match(trade.receipt.join(" "), locale === "en" ? /above the plan's maximum \$204/ : /вище за максимум плану \$204/);
    assert.match(trade.receipt.join(" "), locale === "en" ? /Ryntra's fee was \$0\.34/ : /Комісія Ryntra — \$0,34/);
    /* 1.7 × (205 − 190) + 1.7 × 190 × 0.1 % + 0.34 = 25.5 + 0.323 + 0.34 = $26.16, over the $20 limit. */
    assert.match(trade.risk[0], locale === "en" ? /loses about \$26\.16 — over your limit of \$20\.00/ : /втратить близько \$26,16 — більше за ліміт \$20,00/);
    assert.match(trade.risk[1], locale === "en" ? /no order sits at it/ : /ордера на ній немає/);
    for (const line of [...trade.receipt, ...trade.risk, ...reality.summary]) assert.ok(line.length <= 200, `two lines: ${line}`);
    assert.equal(reality.position.state, "open");
  }
  const none = realityOf({ results: [], position: null, complete: true, symbol: "SOL", feeBps: 10, locale: "en" });
  assert.deepEqual(none.summary, ["No trade under this plan yet."]);
});

test("the plan's own read carries «План проти реальності» once the person's plan has trades", async () => {
  const position = { state: "closed", unitsIn: "1.7", unitsOut: "1.7", unitsHeld: "0", entries: 1, exits: 1, costBasisUsd: 344, proceedsUsd: 390, feesUsd: 0.73, realisedUsd: 45.27, realisedMethod: "proceeds-minus-cost-basis-and-fees", unknowns: [] };
  const { deps } = await world({ results: { results: [result({ verdict: "followed", actual: { ...result().actual, perShareUsd: 200, amount: "1.666666" } })], position, complete: true } });
  const made = await createAssistantPlan(deps, OWNER, ask());
  const id = made.response.plan.id;
  await setAssistantPlanState(deps, OWNER, id, { to: "watching", ifVersion: 1, locale: "en" });
  const read = await readAssistantPlanAnswer(deps, OWNER, id, "en");
  const reality = read.response.plan.reality;
  assert.equal(reality.trades.length, 1);
  assert.match(reality.trades[0].receipt.join(" "), /That is the plan's entry, \$200\.00/);
  assert.ok(reality.summary.some((line) => /closed: made \$45\.27/.test(line)));
});

test("a sentence a person reads is one block: no field name, no line break, no wall of text", async () => {
  const { sentenceStands, allowedFigures } = await import("./plans/model.ts");
  const allowed = allowedFigures(null, null, null);
  assert.equal(sentenceStands("The loss at the invalidation is not a cap.", allowed), true);
  assert.equal(sentenceStands("So lossAtInvalidationUsd is not a cap.", allowed), false);
  assert.equal(sentenceStands("The reward_to_risk is thin.", allowed), false);
  assert.equal(sentenceStands("One line.\nAnother line.", allowed), false);
  assert.equal(sentenceStands("x".repeat(241), allowed), false);
});

test("a plan's own register of advice and forecast is dropped — modals before a move, a good moment, «варто докупити»", async () => {
  const { sentenceStands, allowedFigures, isPlanAdvice } = await import("./plans/model.ts");
  const allowed = allowedFigures(null, null, null);
  for (const n of [250, 212.5]) allowed.add(n);
  for (const text of [
    "The price could rise to $250.00 within the horizon.",
    "The price may reach $250.00 soon.",
    "A rally to $250.00 looks likely this month.",
    "It is a good moment to buy.",
    "Buying here makes sense while the range holds.",
    "The token can double from here.",
    "Ціна може зрости до $250,00.",
    "Варто докупити біля $212,50.",
    "Краще купити зараз.",
    "Очікуємо зростання до $250,00.",
    "Вхід зараз виглядає вигідним.",
    "There is room to $250.",
    "Ціна може сягнути $250.",
    "Зараз саме час докупити.",
    "Now is the time to load up.",
    "The 30-day high is $312, 18.5 % above the entry.",
    "Target 999, 4.5 times the entry.",
    "The plan risks $25k at the invalidation.",
    "The loss could be five thousand dollars if the price gaps through the invalidation.",
    "Це ризик 5 тис. доларів.",
  ]) assert.equal(sentenceStands(text, allowed), false, text);
  /* The downside the critic is asked for stands: a fall through the invalidation, a gap, a loss. */
  allowed.add(21.81);
  allowed.add(180).add(25);
  for (const text of ["A drop to $180 loses $25 with every cost.", "A fast move can drop the price through the invalidation before you act.", "A gap through the invalidation will cost more than $21.81.","Ціна може впасти нижче за інвалідацію, а ордера там немає."]) assert.equal(sentenceStands(text, allowed), true, text);
  for (const text of ["No order sits at the invalidation, so a gap through it loses more.", "На інвалідації ордера немає: стрибок ціни крізь неї збільшить збиток.", "The costs take half of the move to the first target.", "Ціна зараз $212,50 з одного джерела."]) assert.equal(isPlanAdvice(text), false, text);
});

test("a level the model proposes stands only on a figure the reads printed; its number leaves every sentence with it", async () => {
  const reads = await readPlanInputs((await createFixtureWorld()).readers, SOL, FIXTURE_NOW_MS);
  const person = { entryUsd: null, maxPriceUsd: null, invalidationUsd: null, targetsUsd: [], riskUsd: 20, budgetUsd: null, horizonDays: null };
  const low = reads.reads.facts.find((fact) => fact.key === "low7d");
  const invented = verifyArchitect({ thesis: "Below $183.17 the idea is wrong.", whyNow: null, entryCondition: null, invalidation: { priceUsd: 183.17, why: "Below $183.17 the idea is wrong." }, targets: [{ priceUsd: 291.3, why: "A round level." }], assumptions: [], insufficient: false }, reads.reads, person);
  assert.equal(invented.value.invalidation, null, "a level from nowhere");
  assert.deepEqual(invented.value.targets, []);
  assert.equal(invented.value.thesis, null, "its number leaves the thesis too");
  const printed = verifyArchitect({ thesis: "The idea holds above the week's low.", whyNow: null, entryCondition: null, invalidation: { priceUsd: low.value, why: `Below the week's daily low ${low.text} the idea is wrong.` }, targets: [], assumptions: [], insufficient: false }, reads.reads, person);
  assert.equal(printed.value.invalidation.priceUsd, low.value);
});

test("the judge: a sentence it refuses or does not answer for is never shown, and a judge that did not answer lets no word of the model through", async () => {
  const { flaggedOf } = await import("./plans/model.ts");
  assert.deepEqual([...flaggedOf({ verdicts: [{ i: 0, rule: "none" }, { i: 1, rule: "forecast" }] }, 3)].sort(), [1, 2], "silence is never a pass");
  /* The fixture judge refuses a future price the word list lets through. */
  const { deps } = await world({ model: createFixturePlanModel() });
  const made = await createAssistantPlan(deps, OWNER, ask());
  assert.ok(made.ok, made.reason);
  const { stripCritic } = await import("./plans/model.ts");
  const words = { findings: [{ id: "m1", severity: "minor", kind: "level", field: "targets", text: "SOL will trade at $250 next week, well above the invalidation.", cites: [], by: "model" }], summary: null, gaps: [] };
  assert.equal(stripCritic(words, new Set([0])).value.findings.length, 0);
  assert.equal(stripCritic(words, null).value.findings.length, 0, "no verdict, no word");
  /* The judge down: the plan is the plan engine's own and the critic the rules' — nothing is charged. */
  const down = await world({ model: createFixturePlanModel({ fail: { judge: "timeout" } }) });
  const plain = await createAssistantPlan(down.deps, OWNER, ask());
  assert.ok(plain.ok, plain.reason);
  assert.deepEqual(plain.response.spent, { credits: 0, architect: "rules", critic: "rules" });
  assert.equal(plain.response.plan.current.body.thesis.by, "person");
  assert.equal(await balanceOf(down.store), 1_000);
});

test("a gap alone is no critic's work: only a finding or the summary makes the critic count as run", async () => {
  const { stripCritic } = await import("./plans/model.ts");
  const words = { findings: [{ id: "m1", severity: "minor", kind: "fees", field: "fees", text: "Advice.", cites: [], by: "model" }], summary: "A forecast.", gaps: ["The news did not test the plan's levels."] };
  const only = stripCritic(words, new Set([0, 1]));
  assert.equal(only.kept, 0);
  assert.deepEqual(only.value.gaps, ["The news did not test the plan's levels."]);
});
