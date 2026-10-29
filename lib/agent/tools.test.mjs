// Run from repo root: node --test lib/agent/tools.test.mjs
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { AgentCardSchema, AgentCitationSchema, PlanRulesSchema } from "../api/v1/contract.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER, OTHER_WALLET, BONK, COPY, NVDAX } from "./fixtures.ts";
import { CitationBook } from "./provenance.ts";
import { AGENT_TOOLS, FORBIDDEN_TOOL_WORDS, assertToolBoundary, findTool, runTool, toolNames } from "./tools/registry.ts";

/**
 * The tool contract: every tool is research or prepare, none executes;
 * every argument is validated; every figure carries a citation with its
 * source, time and state; a draft is the contract's own shape and never a
 * write; another wallet reads nothing of this one.
 */

const ctxFor = async (owner = OWNER, locale = "en") => {
  const world = await createFixtureWorld();
  let drafts = 0;
  return { world, ctx: { owner, locale, nowMs: FIXTURE_NOW_MS, readers: world.readers, citations: new CitationBook(), newDraftId: () => `agd_${String(++drafts).padStart(24, "0")}` } };
};

test("the registry: twenty-three tools, two kinds, no verb of execution in any name, no duplicate", () => {
  assertToolBoundary();
  assert.equal(AGENT_TOOLS.length, 23);
  /* 1.9.0: memory_read joins the Research list — it reads the facts derived from the wallet's own records and there is no writer on that seam. */
  /* AI-09: the news and «what moved the price?» join it — reads of the collector's digest and the market, nothing of anyone's own. */
  /* AI-03: six reads of the market's public sources join it — DexScreener, RugCheck, GeckoTerminal's candles, Pulse, Meteora, Market Health. */
  assert.deepEqual(toolNames("research"), ["market_read", "stock_read", "evidence_read", "holdings_read", "plans_read", "plan_read", "results_read", "memory_read", "activity_read", "watchlist_read", "monitoring_read", "dex_pairs_read", "token_report_read", "candles_read", "movers_read", "meteora_pools_read", "launch_health_read", "news_read", "price_move_read"]);
  assert.deepEqual(toolNames("prepare"), ["prepare_plan_draft", "prepare_monitoring_draft", "prepare_comparison", "prepare_trade_draft"]);
  assert.throws(() => assertToolBoundary([{ name: "swap_now", kind: "prepare", description: "", input: null, run: async () => null }]), /carries the verb "swap"/);
  assert.throws(() => assertToolBoundary([{ name: "x", kind: "execute", description: "", input: null, run: async () => null }]), /kind the boundary does not allow/);
  assert.ok(FORBIDDEN_TOOL_WORDS.includes("sign") && FORBIDDEN_TOOL_WORDS.includes("submit") && FORBIDDEN_TOOL_WORDS.includes("transfer"));
});

test("no tool module imports a signer, a submitter, a transaction builder, a provider client or a key", () => {
  const dir = new URL("./tools/", import.meta.url);
  const forbidden = [/from "\.\.\/\.\.\/solana\/(submit|signature|transaction|swap-submission|send-attempt|cctp-burn|canary-send)/, /from "openai"/, /OPENAI_API_KEY/, /process\.env/, /fetch\(/, /signTransaction|sendTransaction|sendRawTransaction/];
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts"))) {
    const source = readFileSync(new URL(name, dir), "utf8");
    for (const pattern of forbidden) assert.ok(!pattern.test(source), `${name} matches ${pattern}`);
  }
});

test("an argument is validated before any tool sees it; an unknown tool is a run, not a throw", async () => {
  const { ctx } = await ctxFor();
  assert.equal((await runTool("market_read", { query: "" }, ctx)).outcome, "refused");
  assert.equal((await runTool("market_read", { query: "SOL", extra: 1 }, ctx)).outcome, "refused");
  assert.equal((await runTool("prepare_trade_draft", { query: "SOL", side: "SHORT" }, ctx)).outcome, "refused");
  assert.equal((await runTool("nonexistent", {}, ctx)).outcome, "unavailable");
});

test("every research read carries citations with a source, a time and a state, and every figure cites one that exists", async () => {
  const { ctx } = await ctxFor();
  for (const [name, input] of [["market_read", { query: "SOL" }], ["stock_read", { query: "NVDAx" }], ["evidence_read", { mint: BONK, window: "now" }], ["holdings_read", {}], ["plans_read", {}], ["plan_read", { symbol: "NVDAx" }], ["activity_read", {}], ["watchlist_read", {}], ["monitoring_read", {}]]) {
    const run = await runTool(name, input, ctx);
    assert.equal(run.outcome, "ok", name);
    assert.ok(run.facts.length > 0, `${name} states facts`);
    for (const fact of run.facts) assert.ok(ctx.citations.has(fact.cite), `${name}: ${fact.label} cites ${fact.cite}`);
    for (const card of run.cards) AgentCardSchema.parse(card);
  }
  for (const citation of ctx.citations.list()) {
    AgentCitationSchema.parse(citation);
    assert.ok(citation.source.length > 0);
    assert.ok(["current", "stale", "unavailable", "unknown"].includes(citation.state));
  }
});

test("an unavailable figure stays unavailable in words and in the number — never a zero", async () => {
  const { ctx } = await ctxFor();
  const stock = await runTool("stock_read", { query: "NVDAon" }, ctx);
  const reference = stock.facts.find((fact) => fact.key === "reference");
  assert.equal(reference.number, null);
  assert.equal(reference.state, "unavailable");
  assert.equal(reference.value, "unavailable");
  const evidence = await runTool("evidence_read", { mint: NVDAX, window: "24h" }, ctx);
  assert.equal(evidence.outcome, "empty");
  assert.equal(evidence.state, "unknown");
  assert.equal(evidence.facts.length, 0, "no figure is invented for a token the provider does not cover");
  const refused = await runTool("evidence_read", { mint: COPY, window: "now" }, ctx);
  assert.equal(refused.outcome, "unavailable");
});

test("holdings: amounts are the chain's decimal text, prices per unit, no total; the unpriced are counted, not valued", async () => {
  const { ctx } = await ctxFor();
  const run = await runTool("holdings_read", {}, ctx);
  const card = run.cards.find((entry) => entry.kind === "holdings");
  assert.equal(card.tokenRead, "COMPLETE");
  assert.deepEqual(card.rows.map((row) => [row.symbol, row.amount, row.priceUsd]), [["SOL", "3.25", 212.5], ["Bonk", "125000000", 0.00001234], ["NVDAx", "1.5", 212], ["7GCi…", "999", null]]);
  assert.equal(card.unpriced, 1);
  assert.ok(!run.facts.some((fact) => /total|worth|value/i.test(fact.label)), "no computed total");
  assert.ok(run.notes.some((note) => note.section === "counter" && /cost basis/.test(note.text)), "performance is not stated");
  assert.ok(card.rows[0].plans.length === 1 && card.rows[2].plans.length === 1, "the positions with a plan say so");
});

test("a plan draft is the contract's PlanRules sized by the engine, every assumption named, never a store write", async () => {
  const { world, ctx } = await ctxFor();
  const before = (await world.readers.plans(OWNER)).total;
  const run = await runTool("prepare_plan_draft", { query: "SOL", riskUsd: 50 }, ctx);
  assert.equal(run.outcome, "ok");
  const card = run.draft;
  assert.equal(card.kind, "planDraft");
  PlanRulesSchema.parse(card.rules);
  assert.equal(card.rules.risk.plannedRiskUsd, 50);
  assert.equal(card.rules.entry.pricePerShare, 212.5, "the entry is the planning price the catalogue stated");
  assert.equal(card.rules.execution.referenceRequired, false, "a token plan carries no reference rule");
  assert.equal(card.sizing.limitedBy, "risk");
  assert.ok(card.assumptions.length >= 4);
  assert.ok(card.assumptions.some((line) => /Budget/.test(line)) && card.assumptions.some((line) => /Invalidation/.test(line)));
  assert.equal(card.rules.thesis.text, "—", "no thesis is invented");
  assert.match(card.handoff.href, /^\/app\/strategies\/new\?mint=So111.*&draft=agd_/);
  assert.equal((await world.readers.plans(OWNER)).total, before, "nothing was stored as a plan");
  /* A stock draft carries the reference rule; an unverified token is refused; a token with no indication asks for the entry. */
  const stock = await runTool("prepare_plan_draft", { query: "NVDAx", riskUsd: 100, maxPriceUsd: 220 }, ctx);
  assert.equal(stock.draft.rules.execution.referenceRequired, true);
  assert.equal(stock.draft.rules.entry.maxPricePerShare, 220);
  const copy = await runTool("prepare_plan_draft", { query: "COPY", riskUsd: 10 }, ctx);
  assert.equal(copy.outcome, "refused");
  assert.equal(copy.draft, null);
  /* Money is never invented: prices established, the builder asks for the rest. */
  const noMoney = await runTool("prepare_plan_draft", { query: "NVDAx", maxPriceUsd: 220 }, ctx);
  assert.equal(noMoney.outcome, "ok");
  assert.equal(noMoney.draft.rules, null);
  assert.equal(noMoney.draft.prefill.maxPriceUsd, 220);
  assert.equal(noMoney.draft.prefill.budgetUsd, null);
});

test("a monitoring draft is one condition carried into the builder; a trade draft is a side, a mint and a sum that open the ticket", async () => {
  const { ctx } = await ctxFor();
  const condition = { metric: "dex_volume_usd", window: "24h", operator: "lt", threshold: 1_000_000, mode: "advisory", onUnknown: "warn" };
  const onPlan = await runTool("prepare_monitoring_draft", { query: "NVDAx", condition }, ctx);
  assert.equal(onPlan.draft.subject.kind, "plan");
  assert.match(onPlan.draft.handoff.href, /^\/app\/strategies\/new\?plan=plan_.*&evidence=dex_volume_usd%3A24h%3Alt%3A1000000$/);
  const onAsset = await runTool("prepare_monitoring_draft", { query: "Bonk", condition }, ctx);
  assert.equal(onAsset.draft.subject.kind, "asset");
  assert.equal(onAsset.draft.observed.value, "$42M");
  const trade = await runTool("prepare_trade_draft", { query: "SOL", side: "BUY", amountUsd: 100 }, ctx);
  assert.equal(trade.draft.kind, "tradeDraft");
  assert.equal(trade.draft.amountUsd, 100);
  assert.ok(trade.draft.plan !== null, "bound to the wallet's active SOL plan");
  assert.match(trade.draft.handoff.href, /^\/app\/spot\?view=crypto&mint=So111.*&side=buy&amount=100&plan=plan_.*&v=1$/);
  assert.match(trade.draft.boundary, /Nothing is signed or submitted/);
  assert.ok(!JSON.stringify(trade).includes("transaction"), "no transaction of any kind in a trade draft");
});

test("a comparison ranks nothing and says unknown / not established where nothing established the fact", async () => {
  const { ctx } = await ctxFor();
  const run = await runTool("prepare_comparison", { items: ["NVDAx", "NVDAon"] }, ctx);
  const card = run.cards.find((entry) => entry.kind === "comparison");
  assert.equal(card.columns.length, 2);
  const reference = card.rows.find((row) => row.label === "Issuer reference");
  assert.equal(reference.cells[0].established, true);
  assert.equal(reference.cells[1].established, false);
  assert.equal(reference.cells[1].text, "unknown / not established");
  assert.ok(!card.rows.some((row) => /best|rank|winner/i.test(row.label) || row.cells.some((cell) => /best|winner/i.test(cell.text))), "nothing is ranked as best");
  const one = await runTool("prepare_comparison", { items: ["NVDAx"] }, ctx);
  assert.equal(one.cards.find((entry) => entry.kind === "comparison").columns.length, 2, "one stock compares against the company's other representation");
  const mixed = await runTool("prepare_comparison", { items: ["SOL", "Bonk"] }, ctx);
  assert.ok(mixed.cards.find((entry) => entry.kind === "comparison").rows.some((row) => row.label === "Mint authority"));
});

test("another wallet reads nothing of this one through the same tools", async () => {
  const { ctx } = await ctxFor(OTHER_WALLET);
  assert.equal((await runTool("holdings_read", {}, ctx)).outcome, "empty");
  assert.equal((await runTool("plans_read", {}, ctx)).outcome, "empty");
  assert.equal((await runTool("plan_read", { symbol: "NVDAx" }, ctx)).outcome, "empty");
  assert.equal((await runTool("activity_read", {}, ctx)).outcome, "empty");
  assert.equal((await runTool("monitoring_read", {}, ctx)).outcome, "empty");
  const trade = await runTool("prepare_trade_draft", { query: "SOL" }, ctx);
  assert.equal(trade.draft.plan, null, "the other wallet's plan is not bound");
  assert.ok(findTool("plan_read"));
});

test("the words are the reader's: the same read in Ukrainian", async () => {
  const { ctx } = await ctxFor(OWNER, "uk");
  const run = await runTool("market_read", { query: "SOL" }, ctx);
  assert.match(run.notes[0].text, /^SOL \(Wrapped SOL\) — крипто-токен у каталозі Spot; ціна \$212,50/);
  assert.equal(run.facts[0].label, "Ціна");
});
