// Run from repo root: node --test lib/agent/move-lead-ai21.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { AgentGuestResponseSchema, AgentMessageResponseSchema } from "../api/v1/contract.ts";
import { guestKeyFor } from "../assistant/guest.ts";
import { resolveAgentBudgetConfig } from "./budget.ts";
import { createFixtureWorld, FIXTURE_NOW_MS, OWNER, SOL } from "./fixtures.ts";
import { createFixtureAgentModel, modelInput } from "./model.ts";
import { handleAgentMessage, handleGuestMessage, openAgentSession } from "./service.ts";

/**
 * AI-21 (the phone's request 69): the head of «what moved the price?» is one
 * figure of the move, from one source, with its time beside it. The phone
 * read the catalogue's «24h change +3.4 %» first and DexScreener's «+3.3 %»
 * under it — two figures of one move, the first without its source's time
 * where the second was read. On fixtures; nothing here reaches the network.
 */

async function deps(options = {}) {
  const fixture = await createFixtureWorld();
  return {
    store: fixture.store,
    readers: options.readers ? options.readers(fixture.readers) : fixture.readers,
    model: options.model ?? null,
    budget: { ...resolveAgentBudgetConfig({}), modelEnabled: Boolean(options.model) },
    now: () => FIXTURE_NOW_MS,
  };
}

async function ask(d, text, locale) {
  const opened = await openAgentSession(d, { owner: OWNER, locale, context: null });
  const result = await handleAgentMessage(d, { owner: OWNER, sessionId: opened.response.session.id, text, locale });
  assert.ok(result.ok, text);
  return AgentMessageResponseSchema.parse(result.response).ryn;
}

const locale = (text) => (/[а-яіїє]/i.test(text) ? "uk" : "en");
const PCT = /[+−-]?\d+(?:[.,]\d+)?\s?%/g;
const TIME = /\d{1,2}:\d{2} UTC/;

/** The head: one figure, one source, its time — and no second figure of the same move anywhere in the observation. */
function expectOneHead(ryn, text, lang = locale(text), options = {}) {
  const move = ryn.cards.find((card) => card.kind === "move");
  assert.ok(move?.change, `the move was read: ${text}`);
  const head = ryn.answer.observation[0];
  assert.ok(head, text);
  assert.equal(head.text.match(PCT)?.length, 1, `one figure in the head: ${head.text}`);
  assert.match(head.text, new RegExp(move.change.value.replace(/[+−-]/g, ".").replace(/\s/g, "\\s?")), `the move card's own figure: ${head.text}`);
  assert.equal(head.cites.length, 1, "one source");
  const cite = ryn.citations.find((entry) => entry.id === head.cites[0]);
  assert.ok(cite?.source.startsWith("DexScreener"), `the source named: ${cite?.source}`);
  assert.ok(cite.observedAt, "its time recorded");
  assert.match(head.text, /DexScreener/, "the source in the words");
  assert.match(head.text, TIME, "the time beside the figure");
  const said = ryn.answer.observation.slice(1).map((row) => row.text).join("\n");
  const own = ryn.answer.observation.slice(1).filter((row) => row.text.startsWith(`${move.symbol} (`));
  for (const row of own) assert.doesNotMatch(row.text, /24h change|зміна за 24 год/i, `the catalogue's figure of the same move is not beside it: ${row.text}`);
  const candles = ryn.answer.observation.filter((row) => /GeckoTerminal/.test(row.text));
  for (const row of candles) assert.doesNotMatch(row.text, /(?:and moved|, рух) [+−-]\d/, `nor the candles' day move: ${row.text}`);
  /* DexScreener's own windows stay — the same source, the same figure for the day. */
  const windows = ryn.answer.observation.find((row) => /On that pair|На цій парі/.test(row.text));
  if (windows) assert.ok(windows.text.includes(`${move.change.value} ${lang === "uk" ? "за 24 год" : "in 24 h"}`), `one figure of the day across the source: ${windows.text}`);
  if (!options.model) assert.match(said, /Spot catalogue|каталозі Spot/, "the catalogue's other figures are still said");
  assert.equal(ryn.answer.observation.filter((row) => row.text === head.text).length, 1, "the head is said once");
}

test("the head of «what moved the price?» — composed and by the model, UA and EN, a wallet's and a guest's", async () => {
  for (const model of [null, createFixtureAgentModel()]) {
    const d = await deps({ model });
    for (const [locale, text] of [["uk", "Що сьогодні зрушило ціну SOL?"], ["en", "What moved SOL's price today?"], ["en", "Why is BONK moving?"], ["uk", "Чому BONK падає?"]]) {
      const ryn = await ask(d, text, locale);
      assert.equal(ryn.composedBy, model ? "model" : "deterministic", text);
      expectOneHead(ryn, text);
    }
  }
  const d = await deps();
  const asked = await handleGuestMessage(d, { guest: guestKeyFor("198.51.100.9", "test-secret", FIXTURE_NOW_MS), text: "Що зрушило ціну SOL?", locale: "uk", context: null });
  assert.ok(asked.ok);
  const guest = AgentGuestResponseSchema.parse(asked.response);
  expectOneHead(guest.ryn, "a guest", "uk");
});

test("the model is handed the sentences without the second figure of the move; its facts stay whole", async () => {
  const d = await deps();
  let seen = null;
  const spy = { ...createFixtureAgentModel(), compose: async (packet, key) => ((seen = modelInput(packet)), createFixtureAgentModel().compose(packet, key)) };
  await ask({ ...d, model: spy, budget: { ...d.budget, modelEnabled: true } }, "What moved SOL's price today?", "en");
  assert.ok(seen, "the model was asked");
  const notes = seen.notes.map((note) => note.text).join("\n");
  assert.doesNotMatch(notes, /24h change \+/, "no catalogue figure of the move in the sentences");
  assert.ok(seen.facts.some((fact) => fact.label === "24h change"), "the catalogue's card and facts are unchanged");
});

test("no move read (DexScreener down): nothing is taken out — the catalogue's figure is the only one, with its time", async () => {
  const d = await deps({ readers: (readers) => ({ ...readers, dexPairs: async () => ({ ok: false, reason: "DexScreener answered 503" }) }) });
  const ryn = await ask(d, "What moved SOL's price today?", "en");
  assert.equal(ryn.cards.find((card) => card.kind === "move")?.change ?? null, null);
  const head = ryn.answer.observation[0];
  assert.match(head.text, /24h change \+3\.4 %/, head.text);
  assert.match(head.text, TIME);
  for (const section of ["observation", "risks"]) for (const row of ryn.answer[section]) assert.doesNotMatch(row.text, /503|answered/, `no transport words: ${row.text}`);
});

test("a question that is not about the move keeps its answer as it was", async () => {
  const d = await deps();
  const ryn = await ask(d, "What is the price of SOL?", "en");
  assert.equal(ryn.cards.some((card) => card.kind === "move"), false);
  assert.match(ryn.answer.observation[0].text, /24h change/, "the catalogue's sentence whole");
});

/* ------------------------------------------------------------ the critic's round 1 */

test("two tokens: only the moved one's day figure is left out — the other keeps its own; the first report is kept", async () => {
  const d = await deps();
  const ryn = await ask(d, "Why are SOL and BONK moving?", "en");
  expectOneHead(ryn, "two tokens", "en");
  const said = ryn.answer.observation.map((row) => row.text).join("\n");
  assert.match(said, /Bonk \(Bonk\) is a meme on the Spot catalogue; price \$0\.00001234, 24h change −6\.2 %/, `BONK's move is still said:\n${said}`);
  if (ryn.answer.risks.some((row) => /Whether that news moved the price is unknown/.test(row.text))) {
    assert.ok(ryn.answer.observation.some((row) => /The Block|CoinDesk|Decrypt/.test(row.text)), `the report the risk points at is kept:\n${said}`);
  }
  assert.ok(ryn.answer.observation.length <= 8);
});

test("the hour: its head is the hour's move, and the day's figures of other sources stay — a different window", async () => {
  const d = await deps();
  const ryn = await ask(d, "What moved SOL in the last hour?", "en");
  const move = ryn.cards.find((card) => card.kind === "move");
  assert.equal(move?.window, "1h");
  assert.match(ryn.answer.observation[0].text, /over the last hour[^]*DexScreener/, ryn.answer.observation[0].text);
  assert.ok(ryn.answer.observation.some((row) => /24h change \+3\.4 %/.test(row.text)), "the catalogue's day figure is another window, said");
});

test("a model's sentence with another source's figure of the day's move, or the head said again, is not kept beside the head", async () => {
  const base = await deps();
  const writer = {
    ...createFixtureAgentModel(),
    compose: async (packet) => {
      const cites = packet.citations.list();
      const market = cites.find((cite) => cite.tool === "market_read").id;
      const move = cites.find((cite) => cite.tool === "price_move_read" && cite.source.startsWith("DexScreener · SOL")).id;
      const dex = cites.find((cite) => cite.tool === "dex_pairs_read").id;
      const answer = {
        observation: [
          { text: "The Spot catalogue shows SOL up +3.4 % over 24 h.", cites: [market] },
          { text: "SOL rose +3.3 % over the day on DexScreener.", cites: [move] },
          { text: "On DexScreener SOL trades in 2 pairs; the deepest holds $28.6M.", cites: [dex] },
        ],
        meaning: [{ text: "The catalogue's +3.4 % and DexScreener's +3.3 % differ a little.", cites: [market, move] }],
        counter: [],
        risks: [],
        checks: [],
        actions: [],
        insufficient: false,
      };
      return { ok: true, answer, usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, reasoningTokens: 0 }, latencyMs: 1, responseId: "writer", model: "fixture" };
    },
  };
  const ryn = await ask({ ...base, model: writer, budget: { ...base.budget, modelEnabled: true } }, "What moved SOL's price today?", "en");
  assert.equal(ryn.composedBy, "model");
  expectOneHead(ryn, "the model", "en", { model: true });
  const all = [...ryn.answer.observation, ...ryn.answer.meaning].map((row) => row.text);
  assert.ok(!all.some((text) => /\+3\.4 %/.test(text)), `no catalogue figure of the move:\n${all.join("\n")}`);
  assert.ok(!all.includes("SOL rose +3.3 % over the day on DexScreener."), "the head is not said twice");
  assert.ok(all.some((text) => /2 pairs/.test(text)), "the model's other sentences stand");
});

/* ------------------------------------------------------------ the critic's round 2 */

test("two sources that round alike: the model's sentences of DexScreener's own figure stand; a holder share equal to the catalogue's figure stays", async () => {
  const base = await deps({ readers: (readers) => ({ ...readers, spotMarket: async (mint) => {
    const read = await readers.spotMarket(mint);
    return read.market && read.market.symbol === "SOL" ? { ...read, market: { ...read.market, change24hPct: 3.31 } } : read;
  } }) });
  const writer = {
    ...createFixtureAgentModel(),
    compose: async (packet) => {
      const cites = packet.citations.list();
      const move = cites.find((cite) => cite.tool === "price_move_read" && cite.source.startsWith("DexScreener · SOL")).id;
      const dex = cites.find((cite) => cite.tool === "dex_pairs_read").id;
      const answer = {
        observation: [{ text: "On that pair the price moved +2.6 % in 6 h and +3.3 % in 24 h.", cites: [dex] }],
        meaning: [{ text: "SOL's +3.3 % ran ahead of cbBTC over the same time.", cites: [move] }],
        counter: [],
        risks: [],
        checks: [],
        actions: [],
        insufficient: false,
      };
      return { ok: true, answer, usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, reasoningTokens: 0 }, latencyMs: 1, responseId: "writer", model: "fixture" };
    },
  };
  const ryn = await ask({ ...base, model: writer, budget: { ...base.budget, modelEnabled: true } }, "What moved SOL's price today?", "en");
  const all = [...ryn.answer.observation, ...ryn.answer.meaning].map((row) => row.text);
  assert.ok(all.includes("On that pair the price moved +2.6 % in 6 h and +3.3 % in 24 h."), all.join("\n"));
  assert.ok(all.includes("SOL's +3.3 % ran ahead of cbBTC over the same time."), all.join("\n"));
});

/* ------------------------------------------------------------ the critic's round 3 */

test("two-decimal sources a little apart (3.28 against 3.31): the catalogue's figure is caught; the head rounded is the head's", async () => {
  const base = await deps({
    readers: (readers) => ({
      ...readers,
      spotMarket: async (mint) => {
        const read = await readers.spotMarket(mint);
        return read.market && read.market.symbol === "SOL" ? { ...read, market: { ...read.market, change24hPct: 3.31 } } : read;
      },
      dexPairs: async (mint) => {
        const read = await readers.dexPairs(mint);
        return read.ok && mint === SOL ? { ...read, pairs: read.pairs.map((pair) => ({ ...pair, changePct: { ...pair.changePct, h24: 3.28 } })) } : read;
      },
    }),
  });
  const writer = {
    ...createFixtureAgentModel(),
    compose: async (packet) => {
      const cites = packet.citations.list();
      const market = cites.find((cite) => cite.tool === "market_read").id;
      const move = cites.find((cite) => cite.tool === "price_move_read" && cite.source.startsWith("DexScreener · SOL")).id;
      const answer = {
        observation: [{ text: "The Spot catalogue shows SOL up +3.31 % over 24 h.", cites: [market] }],
        meaning: [{ text: "SOL's +3.3 % ran ahead of cbBTC over the same time.", cites: [move] }],
        counter: [],
        risks: [],
        checks: [],
        actions: [],
        insufficient: false,
      };
      return { ok: true, answer, usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, reasoningTokens: 0 }, latencyMs: 1, responseId: "writer", model: "fixture" };
    },
  };
  const ryn = await ask({ ...base, model: writer, budget: { ...base.budget, modelEnabled: true } }, "What moved SOL's price today?", "en");
  assert.match(ryn.answer.observation[0].text, /\+3\.28 %[^]*DexScreener/, ryn.answer.observation[0].text);
  const all = [...ryn.answer.observation, ...ryn.answer.meaning].map((row) => row.text);
  assert.ok(!all.some((text) => /3\.31/.test(text)), `the catalogue's figure is not beside the head:\n${all.join("\n")}`);
  assert.ok(all.includes("SOL's +3.3 % ran ahead of cbBTC over the same time."), "the head's figure, rounded, stands");
});
