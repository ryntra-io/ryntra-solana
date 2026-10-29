// Run from repo root: node --test lib/assistant/core-v2.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AgentAnswerSchema, AgentGuestResponseSchema, AgentSessionListResponseSchema } from "../api/v1/contract.ts";
import { BLOCK_MAX_CHARS, composeDeterministic, toBlocks, verifyAnswer } from "../agent/answer.ts";
import { readAgentUsage, resolveAgentBudgetConfig, writeReceipt } from "../agent/budget.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OTHER_WALLET, OWNER } from "../agent/fixtures.ts";
import { mergeModelIntent, parseIntent } from "../agent/intent.ts";
import { createFixtureAgentModel, createOpenAiAgentModel } from "../agent/model.ts";
import { CitationBook } from "../agent/provenance.ts";
import { handleAgentMessage, handleGuestMessage, listAgentSessions, openAgentSession, readAgentSession } from "../agent/service.ts";
import { appendTurns, openSession } from "../agent/session.ts";
import { assertToolBoundary, AGENT_TOOLS, compactToolName, findTool, forbiddenWordsIn, runTool } from "../agent/tools/registry.ts";
import { GUEST_TOOLS, guestKeyFor, guestReaders } from "./guest.ts";
import { costMicroUsd, modelFor, TEXT_PRICES, usageFromResponse } from "./models.ts";

/**
 * AI-02 — the assistant's core v2, proved on the fixture world and fake
 * providers; no paid call is made here. What is proved: the models by
 * class and the dollars of every call; the tool names' boundary in any
 * spelling; the model's intent held to the words; the verifier no longer
 * writing in the model's place, and blocks of two lines; the guest asking
 * without a wallet, on the market alone, under a guest's allowance;
 * conversations with dates, «Нова розмова» and the 90 days' retention.
 */

const SECRET = "test-secret";
const GUEST = guestKeyFor("203.0.113.7", SECRET, FIXTURE_NOW_MS);

async function world(options = {}) {
  const fixture = await createFixtureWorld();
  const deps = {
    store: fixture.store,
    readers: fixture.readers,
    model: options.model ?? null,
    budget: { ...resolveAgentBudgetConfig({}), modelEnabled: Boolean(options.model), ...(options.budget ?? {}) },
    now: () => options.nowMs ?? FIXTURE_NOW_MS,
  };
  return { fixture, deps };
}

async function packetFor(text, queries = ["SOL"]) {
  const fixture = await createFixtureWorld();
  const ctx = { owner: OWNER, locale: "en", nowMs: FIXTURE_NOW_MS, readers: fixture.readers, citations: new CitationBook(), newDraftId: () => "agd_000000000000000000000001" };
  const runs = [];
  for (const query of queries) runs.push(await runTool("market_read", { query }, ctx));
  return { intent: parseIntent(text, null), personText: text, runs, citations: ctx.citations, locale: "en" };
}

/* ------------------------------------------------------------ models and dollars */

test("the price of a call comes from the provider's usage: uncached, cached and output, in micro-dollars rounded up; an unpriced model is null, never zero", () => {
  const usage = usageFromResponse({ input_tokens: 1694, output_tokens: 353, total_tokens: 2047, input_tokens_details: { cached_tokens: 1024 }, output_tokens_details: { reasoning_tokens: 90 } });
  assert.deepEqual(usage, { input: 1694, cached: 1024, output: 353, reasoning: 90, total: 2047 });
  /* 670 × 0.10 + 1024 × 0.01 + 353 × 0.50 = 253.74 → 254 µ$. */
  assert.equal(costMicroUsd("gpt-6-luna", usage), 254);
  assert.equal(costMicroUsd("gpt-unknown", usage), null);
  assert.equal(costMicroUsd("gpt-6-luna", usageFromResponse(null)), 0);
  /* A malformed usage never becomes a negative or a fraction of a token. */
  assert.deepEqual(usageFromResponse({ input_tokens: -5, output_tokens: "3", input_tokens_details: { cached_tokens: 99 } }), { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 });
  /* AI-01's measured quick question on Luna (1,694 in / 353 out, nothing cached) stays under the gate of $0.001 even with no cache at all. */
  assert.ok(costMicroUsd("gpt-6-luna", { input: 1694, cached: 0, output: 353, reasoning: 0, total: 2047 }) <= 1_000);
  /* The same question on the old model would not. */
  assert.ok(costMicroUsd("gpt-5.6-sol", { input: 1694, cached: 0, output: 353, reasoning: 0, total: 2047 }) > 1_000);
  assert.ok(TEXT_PRICES[modelFor("answer").name] && TEXT_PRICES[modelFor("critic").name], "every default model is priced");
});

test("every model call of a question leaves a priced receipt — the intent and the answer — and one reservation covers both", async () => {
  const { deps } = await world({ model: createFixtureAgentModel({ intent: { class: "market", symbols: ["SOL"] } }) });
  /* A real-named model on a fake provider, so the receipts carry prices. */
  const fake = { responses: { async parse(body) { return { id: "r", output_parsed: body.text.format.name === "ryntra_intent_v1" ? { class: "market", symbols: ["BONK"] } : { observation: [], meaning: [], counter: [], risks: [], checks: [], actions: [], insufficient: false }, usage: { input_tokens: 900, output_tokens: 40, input_tokens_details: { cached_tokens: 0 } } }; } } };
  const model = createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: fake });
  deps.model = model;
  const opened = await openAgentSession(deps, { owner: OWNER, locale: "en", context: null });
  /* Words the parser cannot place — a name and nothing else — which the model reads as BONK's market. */
  assert.equal(parseIntent("and bonk?", null).class, "unknown");
  const result = await handleAgentMessage(deps, { owner: OWNER, sessionId: opened.response.session.id, text: "and bonk?", locale: "en" });
  assert.ok(result.ok);
  assert.equal(result.response.ryn.class, "market", "the model's read placed the question");
  assert.ok(result.response.ryn.tools.some((tool) => tool.tool === "market_read"));
  assert.equal(result.response.budget.day.used, 1, "one question, one count — however many calls it took");
  const usage = await readAgentUsage(deps.store, deps.budget, FIXTURE_NOW_MS, 14);
  assert.equal(usage.byDay[0].calls, 2, "the intent read and the answer, each with its receipt");
  assert.ok(usage.byDay[0].costUsd > 0);
  assert.equal(usage.byDay[0].unpriced, 0);
});

/* ------------------------------------------------------------ the tools' boundary in any spelling */

test("a tool's name carrying a verb of execution, a spend or a key is refused in any spelling", () => {
  const tool = (name) => [{ name, kind: "research", description: "", input: null, run: async () => null }];
  for (const name of ["executeSwap", "place-order", "sign.transaction", "SendTokens", "withdraw", "approveSpend", "exportSeed", "signtransaction", "s1gn_tx", "send tokens", "private_key_read", "ѕign_read", "close_position", "set_allowance", "pay_invoice", "PlaceOrder", "market_read2_swap"]) {
    assert.throws(() => assertToolBoundary(tool(name)), /not named in plain snake case|carries the verb/, name);
    assert.equal(findTool(name), null, `${name} is no tool`);
  }
  assert.equal(compactToolName("Sign.Trans-Action_1"), "signtransactioni");
  assert.deepEqual(forbiddenWordsIn("exportSeedKey"), ["seed", "key", "export"]);
  /* Every tool the assistant has passes, and every one of them only reads or drafts. */
  assertToolBoundary();
  for (const registered of AGENT_TOOLS) assert.ok(registered.kind === "research" || registered.kind === "prepare", registered.name);
});

/* ------------------------------------------------------------ the model's intent, held to the words */

test("the model's read of an unplaced question is held to the words: a symbol not named is dropped, a refusal or a preparation is never its call", () => {
  const unknown = parseIntent("hmm what about that thing", null);
  assert.equal(unknown.class, "unknown");
  /* A symbol the words do not name is dropped, and with no subject the question stays unknown. */
  assert.equal(mergeModelIntent(unknown, { class: "market", symbols: ["BONK"] }, "hmm what about that thing", null).class, "unknown");
  /* A class outside the research list is read as unknown. */
  for (const klass of ["execute", "secret", "prepare_trade", "prepare_plan", "plan"]) assert.equal(mergeModelIntent(unknown, { class: klass, symbols: [] }, "hmm", null).class, "unknown", klass);
  /* A named asset in another spelling counts. */
  const cyr = parseIntent("а що там із соланою в цілому", null);
  const merged = mergeModelIntent(cyr, { class: "market", symbols: ["SOL", "BTC"] }, "а що там із соланою в цілому", null);
  assert.deepEqual([merged.class, merged.symbols], ["market", ["SOL"]], "SOL is named (Cyrillic), BTC is not");
  /* Only an unknown intent is merged: the parser's refusal stands whatever the model says. */
  const execute = parseIntent("Buy SOL for me", null);
  assert.equal(mergeModelIntent(execute, { class: "market", symbols: ["SOL"] }, "Buy SOL for me", null).class, "execute");
  /* The portfolio is the wallet's own and needs no symbol. */
  assert.equal(mergeModelIntent(unknown, { class: "portfolio", symbols: [] }, "hmm what about that thing", null).class, "portfolio");
});

test("the questions AI-01 could not place reach the tools without a model", () => {
  const cases = [
    ["What's USDC trading at?", "market"],
    ["sol price now", "market"],
    ["nvdax скільки зараз", "market"],
    ["Що в мене зараз у гаманці?", "portfolio"],
    ["Які в мене є плани?", "plans"],
    ["Скільки людей тримає BONK?", "evidence"],
    ["Купити BONK чи ні? Скажи прямо, без води.", "market"],
    ["Is COPY legit?", "evidence"],
    ["Чому NVDAx торгується вище за референс емітента?", "market"],
  ];
  for (const [text, klass] of cases) assert.equal(parseIntent(text, null).class, klass, text);
  /* «Should I buy» asked as a question is still a question, never an execution. */
  assert.notEqual(parseIntent("Купити BONK чи ні?", null).class, "execute");
});

/* ------------------------------------------------------------ the verifier no longer writes in the model's place */

test("the server never writes its generic sentences in the model's place; the tools' own sentences and the unread reads come back; advice is dropped in every section", async () => {
  const packet = await packetFor("Why is SOL moving?");
  const deterministic = composeDeterministic(packet);
  const generic = /none of it says where a price goes|The same reads again before a decision|Prepare a plan with your own entry/;
  const toolNotes = new Set(packet.runs.flatMap((run) => run.notes.map((note) => note.text.trim())));
  const empty = { observation: [{ text: deterministic.observation[0].text, cites: deterministic.observation[0].cites }], meaning: [], counter: [], risks: [], checks: [], actions: [], insufficient: false };
  const verified = verifyAnswer(empty, packet);
  assert.ok(!JSON.stringify(verified.answer).match(generic), "the composer's generic register never enters a model's answer");
  /* Whatever came back in the model's place is a tool's own sentence, never the server's filler. */
  for (const section of ["meaning", "counter", "risks", "checks", "actions"]) for (const sentence of verified.answer[section]) assert.ok([...toolNotes].some((note) => note.includes(sentence.text) || sentence.text.includes(note.slice(0, 40))), `${section}: ${sentence.text}`);
  /* The observation is always there. */
  const noObservation = verifyAnswer({ ...empty, observation: [] }, packet);
  assert.ok(noObservation.answer.observation.length > 0 && noObservation.answer.observation.every((sentence) => sentence.cites.length > 0));
  /* A read that did not answer is said in the risks of a model's answer too: nothing missing is silent. */
  const down = { ...packet, runs: [...packet.runs, { tool: "evidence_read", kind: "research", outcome: "unavailable", state: "unavailable", facts: [], notes: [], cards: [], handoffs: [], draft: null }] };
  /* AI-03: said by the source's name a person knows, never by the tool's own name. */
  assert.ok(verifyAnswer(empty, down).answer.risks.some((sentence) => sentence.text.includes("evidence layer")));
  assert.ok(!verifyAnswer(empty, down).answer.risks.some((sentence) => /[a-z]+_read/.test(sentence.text)));
  /* An invented figure is dropped. */
  const invented = verifyAnswer({ ...empty, meaning: [{ text: "SOL will trade at $300 by Friday.", cites: ["c1"] }] }, packet);
  assert.equal(invented.dropped, 1);
  assert.ok(!invented.answer.meaning.some((sentence) => /\$300/.test(sentence.text)));
  /* A citation that does not exist, a command in either language, personal advice in any section — all dropped. */
  const bad = verifyAnswer({ ...empty, meaning: [{ text: "Nothing here.", cites: ["c999"] }, { text: "You should buy SOL now.", cites: [] }], counter: [{ text: "Раджу купити SOL до вечора.", cites: [] }], checks: [{ text: "Продай SOL, якщо впаде.", cites: [] }], actions: [{ text: "Buy SOL now.", cites: [] }, { text: "Купи SOL зараз.", cites: [] }, { text: "I'd sell here.", cites: [] }] }, packet);
  assert.equal(bad.dropped, 7);
  const more = ["If SOL falls below $100, you should sell.", "Купуй SOL зараз.", "Продавай BONK.", "Варто купити SOL зараз.", "Consider buying SOL on the dip.", "Now is a good time to buy SOL.", "Take profits on BONK."];
  assert.equal(verifyAnswer({ ...empty, meaning: more.slice(0, 6).map((text) => ({ text, cites: [] })), checks: more.slice(6).map((text) => ({ text, cites: [] })) }, packet).dropped, 7);
  /* Weighing is not advice: «чи варто тобі купувати», «не раджу купувати» stay. */
  const weighing = verifyAnswer({ ...empty, meaning: [{ text: "Цього недостатньо, щоб визначити, чи варто тобі купувати BONK.", cites: [] }, { text: "Не раджу купувати на одному джерелі — перевір ще одне.", cites: [] }, { text: "The data does not establish which holding you should sell first.", cites: [] }, { text: "Варто тримати в полі зору ліквідність пулу.", cites: [] }] }, packet);
  assert.equal(weighing.dropped, 0);
});

test("every sentence reaches a person as blocks of at most two lines, each keeping its citations", async () => {
  const long = { text: "SOL trades at $212.50 on Jupiter and the read is current. Its 24h volume is $1.2B across the venues the catalogue reads. The pool's liquidity is deep enough for an ordinary trade. Fees are the network's and the venue's own, shown before any signature in the Review.", cites: ["c1", "c2"] };
  const blocks = toBlocks(long);
  assert.ok(blocks.length >= 2);
  for (const block of blocks) {
    assert.ok(block.text.length <= BLOCK_MAX_CHARS, block.text);
    assert.deepEqual(block.cites, ["c1", "c2"]);
  }
  assert.equal(blocks.map((block) => block.text).join(" "), long.text, "nothing is lost or reworded");
  assert.deepEqual(toBlocks({ text: "Short.", cites: [] }), [{ text: "Short.", cites: [] }]);
  /* A price's decimal point is not a sentence end. */
  assert.ok(toBlocks(long).some((block) => block.text.includes("$212.50")));
  const packet = await packetFor("Why is SOL moving?");
  const answer = composeDeterministic(packet);
  AgentAnswerSchema.parse(answer);
  for (const section of ["observation", "meaning", "counter", "risks", "checks", "actions"]) for (const sentence of answer[section]) assert.ok(sentence.text.length <= BLOCK_MAX_CHARS || !/[.!?…]\s+\p{Lu}/u.test(sentence.text), `${section}: ${sentence.text}`);
});

/* ------------------------------------------------------------ the guest */

test("a guest gets an answer without a wallet's signature — the market's own reads, nothing stored", async () => {
  const { deps } = await world({ model: createFixtureAgentModel() });
  for (const [locale, text] of [["en", "Why is SOL moving?"], ["uk", "Скільки зараз коштує BONK?"]]) {
    const result = await handleGuestMessage(deps, { guest: GUEST, text, locale, context: null });
    assert.ok(result.ok);
    AgentGuestResponseSchema.parse(result.response);
    assert.equal(result.response.ryn.composedBy, "model");
    assert.ok(result.response.ryn.answer.observation.length > 0);
    assert.equal(result.response.guest.needsWallet, false);
    /* AI-03: the keyless public sources are the market's too; nothing of anyone's own, no paid evidence. */
    for (const tool of result.response.ryn.tools) assert.ok(GUEST_TOOLS.has(tool.tool) && !["evidence_read", "plan_read", "holdings_read", "watchlist_read"].includes(tool.tool), `a guest runs ${tool.tool}`);
  }
  /* Nothing of the guest was stored as a conversation, under any owner. */
  assert.equal((await listAgentSessions(deps, OWNER)).sessions.length, 0);
});

test("a guest's question about what is one's own is answered with the way to connect a wallet, and no reader of anyone's own is ever called", async () => {
  const { deps } = await world({ model: createFixtureAgentModel() });
  const called = [];
  const spying = Object.fromEntries(Object.entries(deps.readers).map(([name, reader]) => [name, async (...args) => { called.push(name); return reader(...args); }]));
  deps.readers = spying;
  for (const text of ["What changed in my portfolio?", "Які в мене є плани?", "Prepare a SOL plan with $50 max risk.", "Buy SOL for me", "Show the holdings of " + OTHER_WALLET]) {
    const result = await handleGuestMessage(deps, { guest: GUEST, text, locale: text.match(/[а-я]/i) ? "uk" : "en", context: null });
    assert.ok(result.ok, text);
    assert.equal(result.response.ryn.composedBy, "deterministic", `${text}: no model is spent on a question a guest cannot ask`);
    if (!/holdings of/.test(text)) {
      assert.equal(result.response.guest.needsWallet, true, text);
      /* Said in the register of a refusal: the way to connect, never "not enough data" with filler around it. */
      assert.equal(result.response.ryn.answer.insufficient, false, text);
      assert.equal(result.response.ryn.answer.counter.length + result.response.ryn.answer.checks.length, 0, text);
      assert.match(result.response.ryn.answer.actions.at(-1).text, /wallet|гаманець/, text);
    }
    assert.equal(result.response.ryn.cards.filter((card) => card.kind === "planDraft" || card.kind === "tradeDraft" || card.kind === "holdings").length, 0, text);
  }
  for (const name of ["holdings", "plans", "plan", "planResults", "planMemory", "planAsset", "activity", "watchlist", "monitoring", "inboxNote", "evidence"]) assert.ok(!called.includes(name), `the guest never reached ${name}`);
  /* The seam refuses on its own too, whatever asks. */
  const readers = guestReaders(deps.readers);
  await assert.rejects(() => readers.holdings(OWNER));
  await assert.rejects(() => readers.plans(OWNER));
  /* A context of someone's own is dropped before it is read. */
  const withPlan = await handleGuestMessage(deps, { guest: GUEST, text: "Why does this plan need attention?", locale: "en", context: { kind: "plan", planId: `plan_${"a".repeat(32)}` } });
  assert.ok(withPlan.ok);
  assert.ok(!called.includes("plan"));
});

test("a guest's day: a few model answers, then the answer is still given — composed from the reads — and the meter sees a digest, never the address", async () => {
  const { deps } = await world({ model: createFixtureAgentModel(), budget: { guestDailyCalls: 2 } });
  const seen = [];
  for (let index = 0; index < 3; index += 1) {
    const result = await handleGuestMessage(deps, { guest: GUEST, text: "What is the price of SOL?", locale: "en", context: null });
    assert.ok(result.ok);
    seen.push([result.response.ryn.composedBy, result.response.guest.day.used]);
  }
  assert.deepEqual(seen, [["model", 1], ["model", 2], ["deterministic", 2]]);
  assert.match(GUEST, /^guest_[0-9a-f]{32}$/);
  assert.notEqual(guestKeyFor("203.0.113.7", SECRET, FIXTURE_NOW_MS), guestKeyFor("203.0.113.8", SECRET, FIXTURE_NOW_MS));
  /* Keyed and of the day: another secret or another day is another guest; an IPv6 /64 is one guest. */
  assert.notEqual(guestKeyFor("203.0.113.7", "other", FIXTURE_NOW_MS), GUEST);
  assert.notEqual(guestKeyFor("203.0.113.7", SECRET, FIXTURE_NOW_MS + 86_400_000), GUEST);
  assert.equal(guestKeyFor("2001:db8:1:2:aaaa::1", SECRET, FIXTURE_NOW_MS), guestKeyFor("2001:db8:1:2:ffff:1:2:3", SECRET, FIXTURE_NOW_MS));
  assert.notEqual(guestKeyFor("2001:db8:1:2::1", SECRET, FIXTURE_NOW_MS), guestKeyFor("2001:db8:1:3::1", SECRET, FIXTURE_NOW_MS));
  assert.equal(guestKeyFor("::ffff:203.0.113.7", SECRET, FIXTURE_NOW_MS), GUEST, "an IPv4-mapped address is its IPv4");
  assert.notEqual(guestKeyFor("::ffff:1.2.3.4", SECRET, FIXTURE_NOW_MS), guestKeyFor("::ffff:5.6.7.8", SECRET, FIXTURE_NOW_MS));
  const usage = await readAgentUsage(deps.store, deps.budget, FIXTURE_NOW_MS, 14);
  assert.ok(!JSON.stringify(usage).includes("203.0.113.7"));
  assert.equal(usage.byDay[0].guests, 1);
  /* A guest's model answers stop at their own allowance, the wallet's are untouched. */
  const opened = await openAgentSession(deps, { owner: OWNER, locale: "en", context: null });
  assert.equal(opened.response.budget.day.used, 0);
});

/* ------------------------------------------------------------ conversations: dates, «Нова розмова», 90 days */

test("«Нова розмова» opens a fresh session; the list says each conversation's first question, dates and expiry; past 90 days it is gone", async () => {
  const { deps } = await world();
  const first = await openAgentSession(deps, { owner: OWNER, locale: "en", context: null });
  assert.ok(first.ok && first.opened);
  await handleAgentMessage(deps, { owner: OWNER, sessionId: first.response.session.id, text: "Why is SOL moving?", locale: "en" });
  const resumed = await openAgentSession(deps, { owner: OWNER, locale: "en", context: null });
  assert.equal(resumed.response.session.id, first.response.session.id, "without fresh the same context resumes");
  const fresh = await openAgentSession(deps, { owner: OWNER, locale: "en", context: null, fresh: true });
  assert.ok(fresh.opened);
  assert.notEqual(fresh.response.session.id, first.response.session.id);
  /* Pressed twice, «Нова розмова» stays the one empty conversation; an empty one is not listed. */
  const again = await openAgentSession(deps, { owner: OWNER, locale: "en", context: null, fresh: true });
  assert.equal(again.response.session.id, fresh.response.session.id);
  assert.equal((await listAgentSessions(deps, OWNER)).sessions.length, 1);
  await handleAgentMessage(deps, { owner: OWNER, sessionId: fresh.response.session.id, text: "Which plans need attention?", locale: "en" });
  const listed = AgentSessionListResponseSchema.parse(await listAgentSessions(deps, OWNER));
  assert.equal(listed.retentionDays, 90);
  assert.equal(listed.sessions.length, 2);
  const titled = listed.sessions.find((row) => row.id === first.response.session.id);
  assert.equal(titled.title, "Why is SOL moving?");
  assert.equal(titled.turnCount, 2);
  assert.equal(Date.parse(titled.expiresAt) - Date.parse(titled.updatedAt), 90 * 86_400_000);
  assert.ok(!JSON.stringify(listed).includes("observation"), "the list carries no answer");
  /* Another wallet lists nothing of this one. */
  assert.equal((await listAgentSessions(deps, OTHER_WALLET)).sessions.length, 0);
  /* Ninety days after the last turn the conversation is neither read back, nor listed, nor resumed — and it is removed. */
  const later = { ...deps, now: () => FIXTURE_NOW_MS + 90 * 86_400_000 + 1 };
  assert.equal(await readAgentSession(later, OWNER, first.response.session.id), null);
  assert.equal((await listAgentSessions(later, OWNER)).sessions.length, 0);
  assert.equal(await deps.store.versioned("agentSessions").get(`solana:mainnet:${OWNER}:${first.response.session.id}`), undefined, "the expired record is removed");
  const reopened = await openAgentSession(later, { owner: OWNER, locale: "en", context: null });
  assert.ok(reopened.opened, "a new conversation, not the expired one");
  /* A turn written within the window keeps the conversation alive from that turn. */
  const kept = await openSession(deps.store, { owner: OWNER, locale: "uk", context: null, nowMs: FIXTURE_NOW_MS });
  const turn = { id: "agt_000000000000000000000009", role: "person", at: new Date(FIXTURE_NOW_MS + 80 * 86_400_000).toISOString(), text: "ще", class: null, answer: null, cards: [], citations: [], handoffs: [], tools: [], composedBy: null, refusal: null, brief: null, critic: null };
  await appendTurns(deps.store, kept.record, { turns: [turn], steps: [], nowMs: FIXTURE_NOW_MS + 80 * 86_400_000 });
  assert.ok(await readAgentSession(later, OWNER, kept.record.id));
});

test("a call the provider answered but the client could not read is billed: never refunded, never priced as free", async () => {
  const p = await packetFor("Why is SOL moving?");
  const throwing = (error) => createOpenAiAgentModel({ env: { OPENAI_API_KEY: "sk-test" }, client: { responses: { parse: async () => { throw error; } } } });
  for (const error of [Object.assign(new SyntaxError("Unexpected end of JSON input")), Object.assign(new Error("schema"), { name: "ZodError" }), Object.assign(new Error("length"), { name: "LengthFinishReasonError" })]) {
    const result = await throwing(error).compose(p, "digest");
    assert.deepEqual([result.ok, result.outcome, result.reached], [false, "invalid-output", true], error.name);
  }
  /* Only a connection never made is not reached. */
  const down = await throwing(new Error("connect ECONNREFUSED 127.0.0.1:443")).compose(p, "digest");
  assert.deepEqual([down.outcome, down.reached], ["unavailable", false]);
  /* The receipt of such a call is unpriced, not $0. */
  const { deps } = await world();
  const receipt = await writeReceipt(deps.store, { owner: OWNER, sessionId: "ags_" + "0".repeat(32), turnId: "agt_" + "0".repeat(24), model: "gpt-6-luna", promptVersion: "v", task: "answer", tokens: { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 }, latencyMs: 1, outcome: "invalid-output", at: new Date(FIXTURE_NOW_MS).toISOString() });
  assert.equal(receipt.costMicroUsd, null);
});

test("a guest asking to trade hears that Ryntra never trades, then the way to connect; a model's symbol that is a word of the sentence is no asset", async () => {
  const { deps } = await world({ model: createFixtureAgentModel() });
  const result = await handleGuestMessage(deps, { guest: GUEST, text: "Buy SOL for me", locale: "en", context: null });
  assert.ok(result.ok);
  assert.equal(result.response.ryn.refusal?.code, "execute");
  assert.match(result.response.ryn.answer.observation[0].text, /does not buy, sell, swap, send or sign/);
  const unknown = parseIntent("is it ok", null);
  assert.equal(mergeModelIntent(unknown, { class: "market", symbols: ["IS", "IT"] }, "is it ok", null).class, "unknown");
});
