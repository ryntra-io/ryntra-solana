// Run from repo root: node --test lib/agent/lens/lens.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_CRITIC_KINDS, AgentBriefResponseSchema, AgentCriticResponseSchema, AgentMessageResponseSchema, AgentSessionResponseSchema } from "../../api/v1/contract.ts";
import { readBudgetState, resolveAgentBudgetConfig } from "../budget.ts";
import { BONK, COPY, createFixtureWorld, FIXTURE_NOW_MS, NVDAX, OTHER_WALLET, OWNER, SOL } from "../fixtures.ts";
import { createFixtureAgentModel } from "../model.ts";
import { handleAgentMessage, openAgentSession } from "../service.ts";
import { isDirective } from "./critic.ts";
import { handleAgentBrief, handleAgentCritic, lensTools } from "./service.ts";

/**
 * What the Brief and the Critic must do, on the fixture world, before any
 * paid call: a stock, a crypto token, a meme, a plan, the portfolio and the
 * wallet's own memory; insufficient data said plainly; stale and missing
 * evidence named; a counter-argument that is an argument and never an
 * instruction; both languages; another wallet reading nothing of this one;
 * and the budget untouched by a deterministic read.
 */

async function world(options = {}) {
  const fixture = await createFixtureWorld();
  const deps = {
    store: fixture.store,
    readers: fixture.readers,
    model: options.model ?? null,
    budget: { ...resolveAgentBudgetConfig({}), modelEnabled: Boolean(options.model), ...(options.budget ?? {}) },
    now: () => options.nowMs ?? FIXTURE_NOW_MS,
  };
  const brief = async (subject, locale = "en", owner = OWNER, compose = "deterministic") => {
    const result = await handleAgentBrief(deps, { owner, subject, locale, compose });
    assert.ok(result.ok, `the brief answers: ${result.ok ? "" : result.reason}`);
    AgentBriefResponseSchema.parse(result.response);
    return result.response;
  };
  const critic = async (subject, locale = "en", owner = OWNER, compose = "deterministic") => {
    const result = await handleAgentCritic(deps, { owner, subject, locale, compose });
    assert.ok(result.ok, `the critic answers: ${result.ok ? "" : result.reason}`);
    AgentCriticResponseSchema.parse(result.response);
    return result.response;
  };
  return { fixture, deps, brief, critic };
}

const BRIEF_SECTIONS = ["changed", "matters", "supports", "unknown", "checks"];
/** A name the store uses and a person never should: a check id, a rule key, a monitoring finding's kind. */
const INTERNAL_ID = /(entryPrice|exitTarget|exitInvalidation|exitTime|quoteAge|maxSlippageBps|minLiquidityUsd|unitBasis|plan[.][a-z_]+)/;

/** Every sentence of a Brief cites only citations the response carries, and states no figure with no source. */
function expectBrief(response) {
  for (const section of BRIEF_SECTIONS) {
    assert.ok(Array.isArray(response.brief[section]), section);
    assert.ok(response.brief[section].length > 0, `${section} is never empty`);
    for (const sentence of response.brief[section]) {
      assert.ok(sentence.text.trim().length > 0, `${section} has words`);
      for (const cite of sentence.cites) assert.ok(response.citations.some((citation) => citation.id === cite), `${section} cites ${cite}`);
      assert.ok(!isDirective(sentence.text), `no instruction in ${section}: ${sentence.text}`);
    }
  }
  for (const citation of response.citations) {
    assert.ok(citation.source.length > 0, "a citation names its source");
    assert.ok(["current", "stale", "unavailable", "unknown"].includes(citation.state), "a citation states its state");
  }
}

/** Every finding is one of the seven kinds, carries the citations of what it stands on, and never instructs. */
function expectCritic(response) {
  for (const finding of response.critic.findings) {
    assert.ok(AGENT_CRITIC_KINDS.includes(finding.kind), `a known kind: ${finding.kind}`);
    assert.ok(finding.text.trim().length > 0, "a finding has words");
    assert.ok(!isDirective(finding.text), `no instruction: ${finding.text}`);
    for (const cite of finding.cites) assert.ok(response.citations.some((citation) => citation.id === cite), `finding cites ${cite}`);
    for (const figure of finding.figures) {
      assert.ok(response.citations.some((citation) => citation.id === figure.cite), `figure cites ${figure.cite}`);
      assert.ok(["current", "stale", "unavailable", "unknown"].includes(figure.state), "a figure states its state");
    }
  }
  assert.ok(response.critic.gaps.length > 0, "what could not be challenged is always said");
  for (const gap of response.critic.gaps) assert.ok(!isDirective(gap.text), `no instruction in a gap: ${gap.text}`);
}

/* ------------------------------------------------------------ the subjects */

test("a stock: the Brief answers the five questions and the Critic names the rights, the issuer and the thesis's own gaps", async () => {
  const { brief, critic } = await world();
  for (const locale of ["en", "uk"]) {
    const read = await brief({ kind: "asset", mint: NVDAX, symbol: "NVDAx" }, locale);
    expectBrief(read);
    assert.equal(read.composedBy, "deterministic");
    assert.ok(read.title.includes("NVDAx"), "the title names the asset");

    const argued = await critic({ kind: "asset", mint: NVDAX, symbol: "NVDAx" }, locale);
    expectCritic(argued);
    const kinds = argued.critic.findings.map((row) => row.kind);
    assert.ok(kinds.includes("asset-structure"), `the instrument's own structure is argued (${kinds.join(", ")})`);
    assert.ok(argued.critic.findings.some((row) => row.kind === "assumption-conflict" && row.figures.length >= 2), "the market meets the plan's own maximum, with both figures");
  }
});

test("a crypto token: the plan the wallet holds on it is what the Critic argues with, and every figure carries its state", async () => {
  const { brief, critic } = await world();
  const read = await brief({ kind: "asset", mint: SOL, symbol: "SOL" });
  expectBrief(read);
  assert.ok(read.cards.some((card) => card.kind === "market" && card.symbol === "SOL"), "the market card is there");

  const argued = await critic({ kind: "asset", mint: SOL, symbol: "SOL" });
  expectCritic(argued);
  assert.ok(argued.critic.findings.some((row) => row.kind === "thesis-weakness"), "the thesis is examined on its own terms");
  assert.ok(argued.critic.findings.every((row) => row.figures.every((figure) => figure.cite.startsWith("c"))), "no figure without a citation");
});

test("a meme: the structure the evidence layer read is the argument — concentration, the authorities, the thin market", async () => {
  const { brief, critic } = await world();
  const read = await brief({ kind: "asset", mint: BONK, symbol: "BONK" });
  expectBrief(read);

  const argued = await critic({ kind: "asset", mint: BONK, symbol: "BONK" });
  expectCritic(argued);
  const structure = argued.critic.findings.filter((row) => row.kind === "asset-structure");
  assert.ok(structure.length > 0, "a meme's structure is always argued");
  assert.ok(argued.critic.findings.some((row) => row.kind === "thesis-weakness" && /no plan|немає плану/i.test(row.text)), "no plan on the asset is itself the weakness");
});

test("an unverified copy: the venue's own list is the finding, and no plan may name it", async () => {
  const { critic } = await world();
  const argued = await critic({ kind: "asset", mint: COPY });
  expectCritic(argued);
  assert.ok(argued.critic.findings.some((row) => row.kind === "asset-structure" && /verified|верифіков/i.test(row.text)), "the unverified list is named");
});

test("a plan: every required check the Review did not pass is a finding, with the rule and what was found", async () => {
  const { fixture, brief, critic } = await world();
  for (const locale of ["en", "uk"]) {
    const read = await brief({ kind: "plan", planId: fixture.plans.nvdax }, locale);
    expectBrief(read);
    assert.ok(read.cards.some((card) => card.kind === "plan" && card.planId === fixture.plans.nvdax), "the plan card is the subject's");

    const argued = await critic({ kind: "plan", planId: fixture.plans.nvdax }, locale);
    expectCritic(argued);
    const unmet = argued.critic.findings.filter((row) => row.kind === "plan-condition-unmet");
    assert.ok(unmet.length >= 2, `both failed checks are findings (${unmet.length})`);
    /* The check is named in the reader's own language, never by its internal id. */
    assert.ok(unmet.some((row) => row.text.includes(locale === "uk" ? "максимальна ціна" : "the maximum price")), "the maximum-price check is named");
    assert.ok(unmet.some((row) => row.text.includes(locale === "uk" ? "планового ризику" : "planned risk")), "the modelled-risk check is named");
    for (const row of unmet) assert.ok(!INTERNAL_ID.test(row.text), `no internal id on the surface: ${row.text}`);
    assert.ok(argued.handoffs.some((handoff) => handoff.kind === "plan" && handoff.primary), "the plan is the primary door");
    assert.ok(argued.handoffs.some((handoff) => handoff.kind === "review"), "the Review is a door — Brief → Critic → Plan/Review");
  }
});

test("the portfolio: what is held without a plan, the incomplete read, and the wallet's own record", async () => {
  const { brief, critic } = await world();
  const read = await brief({ kind: "portfolio" });
  expectBrief(read);
  assert.ok(read.cards.some((card) => card.kind === "holdings"), "the holdings card is there");

  const argued = await critic({ kind: "portfolio" });
  expectCritic(argued);
  assert.ok(argued.critic.findings.length > 0, "a portfolio always has something to argue with");
});

test("a monitoring note: it recorded a moment, and the Critic says it is not a current authorization", async () => {
  const { fixture, brief, critic } = await world();
  const read = await brief({ kind: "note", inboxId: fixture.note.id });
  expectBrief(read);
  const argued = await critic({ kind: "note", inboxId: fixture.note.id });
  expectCritic(argued);
  assert.ok(argued.critic.findings.some((row) => row.kind === "evidence-missing" && /authorization|дозвол/i.test(row.text)), "a note is not an authorization");
});

test("the record page: the wallet's own plans and memory are the subject", async () => {
  const { brief, critic } = await world();
  const read = await brief({ kind: "page", page: "results" });
  expectBrief(read);
  const argued = await critic({ kind: "page", page: "results" });
  expectCritic(argued);
});

/* ------------------------------------------------------------ the honesty rules */

test("insufficient data: a mint nothing reads is said plainly, and nothing is filled in", async () => {
  const fixture = await createFixtureWorld();
  const deps = {
    store: fixture.store,
    /* Every read fails: the two formats must say so, not invent. */
    readers: {
      ...fixture.readers,
      spotMarket: async () => ({ ok: false, reason: "the catalogue did not answer" }),
      spotSearch: async () => ({ ok: false, reason: "the catalogue did not answer" }),
      stockRow: async () => ({ ok: false, code: "UNAVAILABLE", reason: "the desk did not answer" }),
      evidence: async () => ({ state: "UNAVAILABLE", snapshot: null, reason: "the provider did not answer", served: "miss" }),
      holdings: async () => ({ ok: false, reason: "the RPC did not answer" }),
      planMemory: async () => ({ facts: [], sync: { at: new Date(FIXTURE_NOW_MS).toISOString(), source: "server" } }),
      plans: async () => ({ plans: [], total: 0, sync: { at: new Date(FIXTURE_NOW_MS).toISOString(), source: "server" } }),
    },
    model: null,
    budget: resolveAgentBudgetConfig({}),
    now: () => FIXTURE_NOW_MS,
  };
  const read = await handleAgentBrief(deps, { owner: OWNER, subject: { kind: "asset", mint: SOL, symbol: "SOL" }, locale: "en", compose: "deterministic" });
  assert.ok(read.ok);
  AgentBriefResponseSchema.parse(read.response);
  assert.equal(read.response.brief.insufficient, true, "insufficient data is stated, not implied");
  assert.ok(read.response.brief.unknown.length > 0, "what is missing is named");
  assert.ok(read.response.brief.changed.every((row) => !/\$\d/.test(row.text)), "no figure is invented where none was read");

  const argued = await handleAgentCritic(deps, { owner: OWNER, subject: { kind: "asset", mint: SOL, symbol: "SOL" }, locale: "uk", compose: "deterministic" });
  assert.ok(argued.ok);
  AgentCriticResponseSchema.parse(argued.response);
  assert.equal(argued.response.critic.insufficient, true, "the Critic says it cannot argue rather than arguing badly");
  assert.equal(argued.response.critic.findings.length, 0, "no finding is invented");
  assert.ok(argued.response.critic.gaps.length > 0, "silence is never agreement");
});

test("stale and missing evidence: both are findings, and neither becomes a zero", async () => {
  const fixture = await createFixtureWorld();
  const observedAt = new Date(FIXTURE_NOW_MS - 48 * 3_600_000).toISOString();
  const deps = {
    store: fixture.store,
    readers: {
      ...fixture.readers,
      evidence: async (input) =>
        input.window === "now"
          ? { state: "UNKNOWN", snapshot: null, reason: "no observation of this mint", served: "miss" }
          : {
              state: "STALE",
              reason: "past the provider's own rule",
              served: "cache",
              snapshot: {
                schema: "ryntra.market-evidence",
                schemaVersion: "1.0.0",
                provider: "nansen",
                subject: { mint: input.mint, symbol: "SOL" },
                window: input.window,
                metrics: [{ id: "dex_net_volume_usd", value: 1234, unit: "usd" }],
                attribution: { text: "Nansen", href: "https://nansen.ai" },
                observedAt,
                fetchedAt: observedAt,
              },
            },
    },
    model: null,
    budget: resolveAgentBudgetConfig({}),
    now: () => FIXTURE_NOW_MS,
  };
  const argued = await handleAgentCritic(deps, { owner: OWNER, subject: { kind: "asset", mint: SOL, symbol: "SOL" }, locale: "en", compose: "deterministic" });
  assert.ok(argued.ok);
  const evidence = argued.response.critic.findings.filter((row) => row.kind === "evidence-missing");
  assert.ok(evidence.length >= 2, `the stale window and the unmeasured one are both said (${evidence.length})`);
  assert.ok(evidence.some((row) => /never measured|ніколи не вимірюв/i.test(row.text)), "what was never measured is not a clean bill");
  assert.ok(evidence.some((row) => /stale|застаріл/i.test(row.text)), "what is stale is said to be stale");
  const read = await handleAgentBrief(deps, { owner: OWNER, subject: { kind: "asset", mint: SOL, symbol: "SOL" }, locale: "en", compose: "deterministic" });
  assert.ok(read.ok);
  assert.ok(read.response.brief.unknown.some((row) => /unknown|stale|not enough/i.test(row.text)), "the Brief's unknown section carries it too");
});

test("the Critic never instructs: no finding, in either language, is a direction — and the guard knows the difference", async () => {
  const { fixture, critic } = await world();
  for (const locale of ["en", "uk"]) {
    for (const subject of [{ kind: "asset", mint: NVDAX, symbol: "NVDAx" }, { kind: "asset", mint: BONK, symbol: "BONK" }, { kind: "plan", planId: fixture.plans.sol }, { kind: "portfolio" }]) {
      const argued = await critic(subject, locale);
      for (const finding of argued.critic.findings) {
        assert.ok(!isDirective(finding.text), `${locale} ${subject.kind}: ${finding.text}`);
        assert.ok(!/^\s*(buy|sell|hold|купи|продай|тримай)\b/i.test(finding.text), `no imperative: ${finding.text}`);
      }
    }
  }
  /* The guard catches a command and leaves a finding that merely uses the word alone. */
  assert.ok(isDirective("Buy now before it moons."));
  assert.ok(isDirective("You should sell half of it."));
  assert.ok(isDirective("Продай половину зараз."));
  assert.ok(isDirective("Варто купити на цих рівнях."));
  assert.ok(!isDirective("A buy at this price would not pass the plan."));
  assert.ok(!isDirective("The ten largest holders hold 62 % of the supply."));
  assert.ok(!isDirective("Купівля за цією ціною не пройшла б план."));
  assert.ok(!isDirective("Той, хто тримає право емісії, може збільшити пропозицію."));
});

test("the wallet's own record argues: a memory fact about this asset becomes a previous-result finding", async () => {
  const fixture = await createFixtureWorld();
  const deps = {
    store: fixture.store,
    readers: {
      ...fixture.readers,
      planMemory: async () => ({
        facts: [
          {
            id: "mem_blocked_0001",
            kind: "blocked-by-rule",
            scope: { kind: "asset", mint: NVDAX, symbol: "NVDAx", planId: null },
            figures: [
              { key: "plans", value: 3, text: null, unit: "count" },
              { key: "rule", value: null, text: "the maximum price", unit: "word" },
              { key: "bound", value: null, text: "$185.00", unit: "word" },
            ],
            cites: [{ kind: "plan", id: fixture.plans.nvdax, at: new Date(FIXTURE_NOW_MS).toISOString(), href: `/app/strategies/plans/${fixture.plans.nvdax}` }],
            observedAt: new Date(FIXTURE_NOW_MS).toISOString(),
          },
        ],
        sync: { at: new Date(FIXTURE_NOW_MS).toISOString(), source: "server" },
      }),
    },
    model: null,
    budget: resolveAgentBudgetConfig({}),
    now: () => FIXTURE_NOW_MS,
  };
  for (const locale of ["en", "uk"]) {
    const argued = await handleAgentCritic(deps, { owner: OWNER, subject: { kind: "asset", mint: NVDAX, symbol: "NVDAx" }, locale, compose: "deterministic" });
    assert.ok(argued.ok);
    const previous = argued.response.critic.findings.filter((row) => row.kind === "previous-result");
    assert.equal(previous.length, 1, "the wallet's own record is one finding");
    assert.ok(previous[0].text.includes("185"), "the rule's own bound travels with it");
    assert.ok(previous[0].cites.length > 0, "it cites the record it stands on");
    assert.ok(!isDirective(previous[0].text), "and it is still not an instruction");
  }
});

test("another wallet reads nothing of this one through either format", async () => {
  const { brief, critic, fixture } = await world();
  const read = await brief({ kind: "portfolio" }, "en", OTHER_WALLET);
  assert.ok(read.brief.insufficient || read.cards.every((card) => card.kind !== "plan"), "no plan of this wallet appears");
  const argued = await critic({ kind: "plan", planId: fixture.plans.nvdax }, "en", OTHER_WALLET);
  assert.equal(argued.critic.findings.filter((row) => row.kind === "plan-condition-unmet").length, 0, "another wallet's plan is not judged");
  assert.ok(argued.citations.every((citation) => !citation.ref || citation.ref !== fixture.plans.nvdax), "not even as a citation");
});

/* ------------------------------------------------------------ the budget and the model */

test("a deterministic format never reaches the model and never spends; the same reads are what a model would reword", async () => {
  const { deps, brief, critic } = await world({ model: createFixtureAgentModel() });
  const before = await readBudgetState(deps.store, OWNER, deps.budget, FIXTURE_NOW_MS);
  await brief({ kind: "asset", mint: SOL, symbol: "SOL" });
  await critic({ kind: "asset", mint: SOL, symbol: "SOL" });
  const after = await readBudgetState(deps.store, OWNER, deps.budget, FIXTURE_NOW_MS);
  assert.equal(after.day.used, before.day.used, "nothing was spent on a deterministic read");

  const worded = await brief({ kind: "asset", mint: SOL, symbol: "SOL" }, "en", OWNER, "model");
  assert.equal(worded.composedBy, "model", "the model wrote the words when asked");
  const spent = await readBudgetState(deps.store, OWNER, deps.budget, FIXTURE_NOW_MS);
  assert.equal(spent.day.used, before.day.used + 1, "exactly one call of the wallet's existing allowance");
});

test("a model that invents is held to the reads: no figure it made up, no citation that does not exist, no finding the server never made, no instruction", async () => {
  const { brief, critic } = await world({ model: createFixtureAgentModel({ invent: true }) });
  const read = await brief({ kind: "asset", mint: SOL, symbol: "SOL" }, "en", OWNER, "model");
  expectBrief(read);
  for (const section of BRIEF_SECTIONS) {
    for (const sentence of read.brief[section]) {
      assert.ok(!sentence.text.includes("999,999"), `an invented figure is dropped: ${sentence.text}`);
      assert.ok(!sentence.cites.includes("c999"), "a citation that does not exist is dropped");
    }
  }
  const argued = await critic({ kind: "plan", planId: (await createFixtureWorld()).plans.nvdax }, "en", OWNER, "model");
  expectCritic(argued);
  assert.ok(!argued.critic.findings.some((row) => row.id === "invented.finding"), "a finding the server never made is dropped");
  for (const finding of argued.critic.findings) assert.ok(!finding.text.includes("999,999"), `an invented figure is dropped: ${finding.text}`);
  for (const gap of argued.critic.gaps) assert.ok(!isDirective(gap.text), `an instruction is dropped: ${gap.text}`);
});

test("over the allowance the format is still answered — deterministically — and the budget state says why", async () => {
  const { brief, deps } = await world({ model: createFixtureAgentModel(), budget: { dailyCalls: 1 } });
  await brief({ kind: "asset", mint: SOL, symbol: "SOL" }, "en", OWNER, "model");
  const second = await brief({ kind: "asset", mint: SOL, symbol: "SOL" }, "en", OWNER, "model");
  assert.equal(second.composedBy, "deterministic", "the answer is still given");
  assert.equal(second.budget.exhausted, true, "and the state says the allowance is spent");
  assert.ok(second.budget.reason, "with the reason in a sentence");
  const state = await readBudgetState(deps.store, OWNER, deps.budget, FIXTURE_NOW_MS);
  assert.equal(state.day.used, 1, "no call was made past the ceiling");
});

/* ------------------------------------------------------------ the engine is one engine */

test("the tool plan reads only through the registry, names no wallet and never prepares", async () => {
  for (const subject of [{ kind: "asset", mint: SOL, symbol: "SOL" }, { kind: "plan", planId: "plan_00000000000000000000000000000001" }, { kind: "portfolio" }, { kind: "note", inboxId: "inb_1" }, { kind: "page", page: "results" }]) {
    for (const format of ["brief", "critic"]) {
      for (const call of lensTools(subject, format, null)) {
        assert.ok(!/prepare|draft/i.test(call.name), `a lens never prepares: ${call.name}`);
        assert.ok(!JSON.stringify(call.input).includes(OWNER), "no wallet travels as an argument");
      }
    }
  }
});

test("the same reads carry both a whole answer and the format when the conversation asks for one", async () => {
  const fixture = await createFixtureWorld();
  const deps = { store: fixture.store, readers: fixture.readers, model: null, budget: resolveAgentBudgetConfig({}), now: () => FIXTURE_NOW_MS };
  const asked = async (text, locale = "en") => {
    const opened = await openAgentSession(deps, { owner: OWNER, locale, context: null });
    assert.ok(opened.ok);
    AgentSessionResponseSchema.parse(opened.response);
    const result = await handleAgentMessage(deps, { owner: OWNER, sessionId: opened.response.session.id, text, locale });
    assert.ok(result.ok, "the turn is written");
    AgentMessageResponseSchema.parse(result.response);
    return result.response.ryn;
  };
  const brief = await asked("Brief me on SOL");
  assert.ok(brief.brief, "the Brief travels on the turn");
  assert.equal(brief.critic, null, "and only the one asked for");
  assert.ok(brief.answer.observation.length > 0, "the six-section answer is written beside it");

  const critic = await asked("Розкритикуй мій план на SOL", "uk");
  assert.ok(critic.critic, "the Critic travels on the turn");
  assert.equal(critic.brief, null, "and only the one asked for");
  assert.ok(critic.answer.observation.length > 0, "the whole answer is still there");
  for (const finding of critic.critic.findings) assert.ok(!isDirective(finding.text), `no instruction: ${finding.text}`);

  const plain = await asked("Why is SOL moving?");
  assert.equal(plain.brief, null, "an ordinary question drags no format behind it");
  assert.equal(plain.critic, null, "neither one");
});
