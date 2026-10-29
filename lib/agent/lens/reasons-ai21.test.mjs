// Run from repo root: node --test lib/agent/lens/reasons-ai21.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AgentBriefResponseSchema, AgentCriticResponseSchema } from "../../api/v1/contract.ts";
import { createDdxyzAdapter } from "../../evidence/providers/ddxyz/adapter.server.ts";
import { createNansenAdapter } from "../../evidence/providers/nansen/adapter.server.ts";
import { resolveAgentBudgetConfig } from "../budget.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER, SOL } from "../fixtures.ts";
import { AgentMessageResponseSchema } from "../../api/v1/contract.ts";
import { evidenceReasonWords, withoutTransport } from "../tools/research.ts";
import { handleAgentMessage, openAgentSession } from "../service.ts";
import { handleAgentBrief, handleAgentCritic } from "./service.ts";

/**
 * AI-21 (the phone's request 71): the Lens Critic said «…unavailable over now
 * (The request was refused (422).), so any reading…» to a person. Every way
 * an evidence read fails — each failure kind of both providers, the service's
 * own reasons, the stale «last observation held» — is said in the person's
 * words: no status code, no transport sentence, no English under Ukrainian.
 */

const NOW = FIXTURE_NOW_MS;
const HEADERS = { creditsUsed: null, creditsRemaining: null, requestId: null, retryAfterSeconds: 30, computeUnits: null };
const governor = { reserve: async () => ({ ok: true }), settle: async () => undefined };

const NANSEN_KINDS = ["auth", "credits", "geo", "rate", "invalid", "server", "timeout", "network", "refused"];
const DDXYZ_KINDS = ["auth", "plan", "payment", "rate", "invalid", "notfound", "server", "timeout", "network", "refused"];
const STATUS = { auth: 401, credits: 402, geo: 451, rate: 429, invalid: 422, server: 503, timeout: 0, network: 0, refused: 400, plan: 403, payment: 402, notfound: 404 };

/** The reasons the evidence layer hands the agent when a read fails — the providers' words, as they are today. */
async function failureReasons() {
  const reasons = new Set();
  for (const kind of NANSEN_KINDS) {
    const client = { configured: true, call: async (family) => ({ ok: false, kind, status: STATUS[kind], code: kind === "invalid" ? "422" : null, message: "Request failed with status code 422", headers: HEADERS, ms: 12, retried: false, family }) };
    const read = await createNansenAdapter({ client, governor }).read({ mint: SOL, window: "24h", nowMs: NOW });
    assert.equal(read.state, "UNAVAILABLE", `nansen ${kind}`);
    reasons.add(read.reason);
  }
  for (const kind of DDXYZ_KINDS) {
    const client = { configured: true, usage: async () => null, call: async (family) => ({ ok: false, kind, status: STATUS[kind], message: "Request failed with status code 422", headers: HEADERS, ms: 12, retried: false, family }) };
    const read = await createDdxyzAdapter({ client, governor }).read({ mint: SOL, window: "now", nowMs: NOW });
    if (read.state !== "FRESH" && read.reason) reasons.add(read.reason);
  }
  /* The service's own, and the budget's. */
  for (const reason of ["The provider key is not configured.", "The provider did not answer.", "No credit budget is configured.", "The credit budget for today is used up.", "The credit ledger could not be reached.", "No usage budget is configured for the source."]) reasons.add(reason);
  return [...reasons];
}

/** A status code or the transport's words — what a person must never read. */
const TRANSPORT = /\(\s*\d{3}\s*\)|\b(?:answered|status|code|HTTP)\s*\d{3}\b|request was refused|refused the key|request failed|status code/i;

function lensDeps(fixture, reason) {
  return {
    store: fixture.store,
    readers: { ...fixture.readers, evidence: async () => ({ state: "UNAVAILABLE", snapshot: null, reason, served: "provider" }) },
    model: null,
    budget: resolveAgentBudgetConfig({}),
    now: () => NOW,
  };
}

test("the phone's report: «(The request was refused (422).)» is said in words in the Critic, the Brief and the card", async () => {
  const fixture = await createFixtureWorld();
  const deps = lensDeps(fixture, "The request was refused (422).");
  for (const locale of ["en", "uk"]) {
    const argued = await handleAgentCritic(deps, { owner: OWNER, subject: { kind: "asset", mint: SOL, symbol: "SOL" }, locale, compose: "deterministic" });
    assert.ok(argued.ok);
    AgentCriticResponseSchema.parse(argued.response);
    const missing = argued.response.critic.findings.filter((row) => row.kind === "evidence-missing");
    assert.ok(missing.length > 0, "the missing evidence is still a finding");
    for (const row of [...argued.response.critic.findings, ...argued.response.critic.gaps]) {
      assert.doesNotMatch(row.text, TRANSPORT, row.text);
      assert.doesNotMatch(row.text, /over now|за now/, `a moment is not a window: ${row.text}`);
    }
    assert.ok(missing.some((row) => (locale === "uk" ? /відхилило цей запит/ : /declined this request/).test(row.text)), "the reason, in words");
    if (locale === "uk") for (const row of missing) assert.doesNotMatch(row.text, /[A-Za-z]{4,} (?:the|was|request)/, `no English under Ukrainian: ${row.text}`);
    for (const card of argued.response.cards.filter((entry) => entry.kind === "evidence")) assert.doesNotMatch(card.reason ?? "", /\d/, "the card's reason carries no code");
    const read = await handleAgentBrief(deps, { owner: OWNER, subject: { kind: "asset", mint: SOL, symbol: "SOL" }, locale, compose: "deterministic" });
    assert.ok(read.ok);
    AgentBriefResponseSchema.parse(read.response);
    for (const section of ["changed", "matters", "supports", "unknown", "checks"]) for (const row of read.response.brief[section]) assert.doesNotMatch(row.text, TRANSPORT, row.text);
  }
});

test("every path of refusal — each failure kind of both providers and the service's own — reaches a person without a code", async () => {
  const fixture = await createFixtureWorld();
  const reasons = await failureReasons();
  assert.ok(reasons.some((reason) => /\(422\)/.test(reason)), "the providers' words do carry the code today — that is what is translated");
  for (const reason of reasons) {
    for (const locale of ["en", "uk"]) {
      const words = evidenceReasonWords(reason, locale);
      assert.ok(words && words.length > 0, reason);
      assert.doesNotMatch(words, /\d/, `${reason} → ${words}`);
      assert.doesNotMatch(words, TRANSPORT, `${reason} → ${words}`);
      if (locale === "uk") assert.match(words, /[а-яіїєґ]/i, `in Ukrainian: ${words}`);
    }
    const argued = await handleAgentCritic(lensDeps(fixture, reason), { owner: OWNER, subject: { kind: "asset", mint: SOL, symbol: "SOL" }, locale: "uk", compose: "deterministic" });
    assert.ok(argued.ok, reason);
    const said = [...argued.response.critic.findings, ...argued.response.critic.gaps].map((row) => row.text).join("\n");
    assert.doesNotMatch(said, TRANSPORT, `${reason}:\n${said}`);
    assert.ok(!said.includes(reason), `the provider's sentence is not passed through: ${reason}`);
  }
});

test("the kinds are told apart, and a stale observation still says it is the last one held", () => {
  assert.equal(evidenceReasonWords(null, "en"), null);
  assert.equal(evidenceReasonWords("The provider key is not configured.", "en"), "the source is not connected here");
  assert.equal(evidenceReasonWords("The credit budget for today is used up.", "uk"), "ліміт джерела на сьогодні вичерпано");
  assert.equal(evidenceReasonWords("The provider's rate limit was reached; retry after 30 s.", "en"), "the source is busy right now");
  assert.equal(evidenceReasonWords("The provider answered 503.", "uk"), "джерело не відповіло");
  assert.equal(evidenceReasonWords("The provider has no data for this token.", "en"), "the source has no figures for this token");
  assert.equal(evidenceReasonWords("The provider did not answer in time. This is the last observation held.", "uk"), "джерело не відповіло; це останнє збережене спостереження");
  assert.equal(evidenceReasonWords("Something nobody foresaw (418).", "en"), "the source did not answer", "an unknown sentence is never passed on");
});

/* ------------------------------------------------------------ the critic's round 1: the other sinks */

async function askWith(readers, text, locale) {
  const fixture = await createFixtureWorld();
  const deps = { store: fixture.store, readers: readers(fixture.readers), model: null, budget: resolveAgentBudgetConfig({}), now: () => NOW };
  const opened = await openAgentSession(deps, { owner: OWNER, locale, context: null });
  const result = await handleAgentMessage(deps, { owner: OWNER, sessionId: opened.response.session.id, text, locale });
  assert.ok(result.ok, text);
  return AgentMessageResponseSchema.parse(result.response).ryn;
}

const spoken = (ryn) => [...Object.values(ryn.answer).filter(Array.isArray).flat().map((row) => row.text), ...ryn.cards.map((card) => card.reason ?? "")].join("\n");

test("a stale observation says why in words — the stale note, the card, both languages", async () => {
  for (const locale of ["en", "uk"]) {
    const ryn = await askWith(
      (readers) => ({
        ...readers,
        evidence: async (input) => {
          const read = await readers.evidence(input);
          return read.snapshot ? { ...read, state: "STALE", reason: "The request was refused (422). This is the last observation held." } : read;
        },
      }),
      locale === "uk" ? "Що зрушило ціну SOL?" : "Why is SOL moving?",
      locale,
    );
    const said = spoken(ryn);
    assert.doesNotMatch(said, TRANSPORT, said);
    assert.match(said, locale === "uk" ? /застаріле \(джерело відхилило цей запит; це останнє збережене спостереження\)/ : /stale \(the source declined this request; this is the last observation held\)/, said);
    assert.doesNotMatch(said, /over now|за now|за 24h|over 24h/, "windows in words");
  }
});

test("a Monitoring note that repeats the evidence layer's transport words, and an unreadable wallet, are said without them", async () => {
  for (const locale of ["en", "uk"]) {
    const ryn = await askWith(
      (readers) => ({
        ...readers,
        monitoring: async (owner, at) => {
          const read = await readers.monitoring(owner, at);
          return { ...read, recent: read.recent.map((row) => ({ ...row, reason: "The provider's rate limit was reached; retry after 30 s. The request was refused (422)." })) };
        },
      }),
      locale === "uk" ? "Що потребує уваги в моїх сповіщеннях?" : "What needs attention in my alerts?",
      locale,
    );
    const said = spoken(ryn);
    assert.doesNotMatch(said, TRANSPORT, said);
    assert.match(said, locale === "uk" ? /Джерело зараз перевантажене/ : /The source is busy right now/, said);
    if (locale === "uk") assert.doesNotMatch(said, /The provider|retry after/, "no English under Ukrainian");
    const wallet = await askWith((readers) => ({ ...readers, holdings: async () => ({ ok: false, reason: "the holdings route answered 503" }) }), locale === "uk" ? "Що в моєму портфелі?" : "What is in my portfolio?", locale);
    assert.doesNotMatch(spoken(wallet), /503|answered/, spoken(wallet));
  }
  assert.equal(withoutTransport("The last price $212.00 is above the plan's maximum $185.00.", "en"), "The last price $212.00 is above the plan's maximum $185.00.", "a note's own words and figures stay");
  assert.equal(withoutTransport("Ринкові дані треба оновити. The provider did not answer in time. This is the last observation held.", "uk"), "Ринкові дані треба оновити. Джерело не відповіло; це останнє збережене спостереження.");
  assert.equal(withoutTransport("The provider's rate limit was reached; retry after 30 s.", "uk"), "Джерело зараз перевантажене.", "the evidence layer's sentence in the reader's language");
  assert.equal(withoutTransport("The provider account has no credits left.", "en"), "The source's allowance is used up.");
  assert.equal(withoutTransport("Ціна $212 вище межі (185).", "uk"), "Ціна $212 вище межі (185).", "a figure in brackets is not a code");
  assert.equal(withoutTransport("Market evidence needs refreshing — The provider answered 503.", "uk"), "Market evidence needs refreshing — джерело не відповіло.", "the note's own clause stays");
  assert.equal(withoutTransport("Your plan status 100 % reached.", "en"), "Your plan status 100 % reached.", "a bare «status 100» is not a code");
  assert.equal(withoutTransport("The observation is for 24h, the rule for 7d.", "uk"), "Спостереження за інше вікно, ніж у правилі.");
  assert.equal(withoutTransport("The observation asked at 09:45 is past its 10:45 UTC expiry; ask again.", "uk"), "Спостереження вже застаріле; потрібне нове читання.");
  assert.equal(withoutTransport("The source answered without this figure.", "en"), "The source has no figures for this token.");
  assert.equal(evidenceReasonWords("The provider is busy.", "en"), "the source is busy right now");
});
