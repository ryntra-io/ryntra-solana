// Run from repo root: node --test lib/assistant/web-ai06a.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { composeDeterministic, liftCiteIds, verifyAnswer } from "../agent/answer.ts";
import { resolveAgentBudgetConfig } from "../agent/budget.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER } from "../agent/fixtures.ts";
import { extractSymbols, parseIntent } from "../agent/intent.ts";
import { createFixtureAgentModel } from "../agent/model.ts";
import { CitationBook } from "../agent/provenance.ts";
import { handleGuestMessage } from "../agent/service.ts";
import { resolveAsset } from "../agent/tools/readers.ts";
import { runTool } from "../agent/tools/registry.ts";
import { guestKeyFor } from "./guest.ts";

/**
 * AI-06a — what the check of production on 20.10 found broken in the
 * assistant on the web, each proved fixed on the fixture world; no paid call:
 * a citation's id in the words a person read («… UTC. c3», «citec1», «[c4]»);
 * «WIF» not found because the catalogue writes «$WIF»; «Jupiter» not read as
 * JUP; «Is WIF liquid enough…», «Які токени Solana найбільше виросли» and
 * «How did the market do…» not placed; and a guest past the day's model
 * answers told «could not place» instead of that the answers are spent.
 */

test("a citation's id written into the words moves into the citations — the text a person reads carries none", () => {
  const known = (id) => ["c1", "c3", "c4"].includes(id);
  assert.deepEqual(liftCiteIds("The newest story is dated Oct 19, 21:04 UTC. c3", known), { text: "The newest story is dated Oct 19, 21:04 UTC.", ids: ["c3"] });
  assert.deepEqual(liftCiteIds("JUP is $0.30 today. citec1", known), { text: "JUP is $0.30 today.", ids: ["c1"] });
  assert.deepEqual(liftCiteIds("Top ten hold 38.18 %. [c4]", known), { text: "Top ten hold 38.18 %.", ids: ["c4"] });
  assert.deepEqual(liftCiteIds("Both read the same (c1, c3).", known), { text: "Both read the same.", ids: ["c1", "c3"] });
  /* Glued together or by a space, as production showed after the first fix. */
  assert.deepEqual(liftCiteIds("On the SOL/USDC pair it moved −0.71 % over the same period. c1c3", known), { text: "On the SOL/USDC pair it moved −0.71 % over the same period.", ids: ["c1", "c3"] });
  assert.deepEqual(liftCiteIds("Same period c1 c3.", known), { text: "Same period.", ids: ["c1", "c3"] });
  /* Words that only look like an id stay, and an id the packet does not know is left for the verifier to judge. */
  assert.deepEqual(liftCiteIds("The C4 grade and a cc1 tag stay.", known), { text: "The C4 grade and a cc1 tag stay.", ids: [] });
  assert.equal(liftCiteIds("Read at c9.", known).text, "Read at c9.");
  /* Only alone in brackets or as the last word: an id inside the sentence, a range or a bracket with words stays whole. */
  for (const text of ["Sources c1–c3 agree.", "Range c2-c4.", "(see c1)", "Version c3 of the pool."]) assert.equal(liftCiteIds(text, known).text, text, text);
  assert.deepEqual(liftCiteIds("cite: c1.", known), { text: ".", ids: ["c1"] });
});

test("the verifier keeps a sentence whose only fault was an id in its words, cited by that id", async () => {
  const world = await createFixtureWorld();
  const ctx = { owner: OWNER, locale: "en", nowMs: FIXTURE_NOW_MS, readers: world.readers, citations: new CitationBook(), newDraftId: () => "agd_000000000000000000000001" };
  const run = await runTool("market_read", { query: "SOL" }, ctx);
  const packet = { intent: parseIntent("Why is SOL moving?", null), personText: "Why is SOL moving?", runs: [run], citations: ctx.citations, locale: "en" };
  const draft = { ...composeDeterministic(packet), meaning: [{ text: "The catalogue's reading is current. citec1", cites: [] }] };
  const verified = verifyAnswer(draft, packet);
  assert.equal(verified.dropped, 0);
  assert.equal(verified.answer.meaning[0].text, "The catalogue's reading is current.");
  assert.deepEqual(verified.answer.meaning[0].cites, ["c1"]);
  const texts = Object.values(verified.answer).filter(Array.isArray).flat().map((sentence) => sentence.text);
  assert.ok(texts.every((text) => !/(?<![\p{L}\p{N}])(cite)?c\d+(?![\p{L}\p{N}])/u.test(text)));
  /* A sentence that was nothing but an id is dropped, never kept as «.» — a kept sentence keeps the credits. */
  const bare = verifyAnswer({ ...composeDeterministic(packet), meaning: [{ text: "cite: c1.", cites: [] }] }, packet);
  assert.equal(bare.dropped, 1);
});

test("a catalogue symbol written with its own «$» is the token a person names without it", async () => {
  const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
  const readers = {
    stockRow: async () => ({ ok: true, row: null }),
    spotSearch: async () => ({ ok: true, rows: [{ symbol: "$WIF", mint: WIF, verified: true }] }),
    spotMarket: async (mint) => ({ ok: true, market: { mint, symbol: "$WIF" }, observedAt: new Date(FIXTURE_NOW_MS).toISOString(), stale: false }),
  };
  const resolved = await resolveAsset(readers, "WIF");
  assert.equal(resolved.kind, "token");
  assert.equal(resolved.mint, WIF);
});

test("the questions production could not place are placed now — and a how-to is still not a movers list", () => {
  assert.deepEqual(extractSymbols("Is there any news about Jupiter today?"), ["JUP"]);
  assert.deepEqual(extractSymbols("What is dogwifhat doing?"), ["WIF"]);
  const cases = [
    ["Is WIF liquid enough to trade $500?", "market", { symbols: ["WIF"] }],
    ["Чи вистачить ліквідності BONK на $500?", "market", { symbols: ["BONK"] }],
    ["Які токени Solana найбільше виросли сьогодні?", "market", { symbols: [], marketWide: "h24" }],
    ["Which tokens rose the most today?", "market", { marketWide: "h24" }],
    ["How did the market do in the last 24 hours?", "market", { marketWide: "h24" }],
    ["Що з ринком за останню годину?", "market", { marketWide: "h1" }],
    ["Is there any news about Jupiter today?", "market", { symbols: ["JUP"], news: true }],
  ];
  for (const [text, klass, fields] of cases) {
    const intent = parseIntent(text, null);
    assert.equal(intent.class, klass, text);
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(intent[key], value, `${text} → ${key}`);
  }
  /* What was placed before stays placed as it was. */
  assert.equal(parseIntent("Why is SOL moving today?", null).class, "market");
  assert.deepEqual(parseIntent("Why is SOL moving today?", null).symbols, ["SOL"]);
  assert.equal(parseIntent("Which Meteora pools for SOL have the most liquidity?", null).symbols[0], "SOL");
  assert.equal(parseIntent("Що таке прослизання?", null).class, "unknown");
  assert.equal(parseIntent("How do I buy Solana tokens?", null).marketWide, null);
  /* A support question or one about one's own, naming a token, is not a market read: it stays for the model to place. */
  for (const text of ["Why can't I sell my BONK?", "Why did my SOL withdrawal fail?", "Why was I charged a fee on my SOL swap?", "Чому мій BONK не відображається?", "Чому не проходить обмін SOL?", "Why is SOL called Solana?", "Why did my BONK order fail?"]) {
    assert.equal(parseIntent(text, null).class, "unknown", text);
  }
  /* «The Solana token» is SOL; only the plural names the network. */
  assert.deepEqual(parseIntent("Is the Solana token trending?", null).symbols, ["SOL"]);
});

test("a guest past the day's model answers hears that they are spent — not «could not place» — and is still answered", async () => {
  const fixture = await createFixtureWorld();
  const deps = { store: fixture.store, readers: fixture.readers, model: createFixtureAgentModel(), budget: { ...resolveAgentBudgetConfig({}), modelEnabled: true, guestDailyCalls: 1 }, now: () => FIXTURE_NOW_MS };
  const guest = guestKeyFor("203.0.113.9", "test-secret", FIXTURE_NOW_MS);
  const first = await handleGuestMessage(deps, { guest, text: "What is the price of SOL?", locale: "uk", context: null });
  assert.ok(first.ok);
  const spent = await handleGuestMessage(deps, { guest, text: "Розкажи щось цікаве", locale: "uk", context: null });
  assert.ok(spent.ok);
  const words = spent.response.ryn.answer.observation.map((sentence) => sentence.text).join(" ");
  /* AI-06c: said as a person would — the free questions are over for today — never «could not place». */
  assert.match(words, /закінчились/);
  assert.doesNotMatch(words, /не змогла співвіднести/);
  /* A question the parser knows is still answered from the reads. */
  const known = await handleGuestMessage(deps, { guest, text: "Яка ціна SOL?", locale: "uk", context: null });
  assert.ok(known.ok);
  assert.equal(known.response.ryn.composedBy, "deterministic");
  assert.ok(known.response.ryn.cards.length > 0);
});
