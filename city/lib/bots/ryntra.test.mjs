import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FIXTURE_SOL, FIXTURE_WALLET, fixtureHangar, fixtureReaders } from "../../../lib/assistant/bots/fixtures.ts";
import { BotsToolRequestSchema } from "../../../lib/assistant/bots/schema.ts";
import { runBotsTool } from "../../../lib/assistant/bots/tools.ts";
import { draftIssues } from "./draft.ts";
import { useBotsWindow } from "./open.ts";
import { askBots, createRyntraStore, explainKey, readAnswer, RYNTRA_BOTS_ROUTE, simulateKey, suggestKey, toCityDraft } from "./ryntra.ts";
import { useBots } from "./store.ts";
import { WORDS } from "./words.ts";

/**
 * Ryntra in the bots window (CITY-133): the window asks the assistant line's bot tools with taps — a coin, a horizon,
 * an amount — and every body it sends is a request the tools' schema takes; a draft opens in the window's own review,
 * and nothing here signs, sends or asks the wallet anything.
 */

const SOL = { mint: FIXTURE_SOL, symbol: "SOL", price: 182.4 };
const READERS = fixtureReaders({ [FIXTURE_SOL]: { price: 182.4, shape: "range", symbol: "SOL" } }, { hangar: async (wallet) => fixtureHangar(wallet) });

/** The route, played by the real tools on the fixtures: the body must pass the tools' own schema. */
function routeFetch(sent = []) {
  return async (url, init) => {
    assert.equal(url, RYNTRA_BOTS_ROUTE);
    assert.equal(init.method, "POST");
    assert.equal(init.headers["X-Ryntra-API"], "1");
    assert.equal(init.credentials, "omit", "no cookie, no session: the tools need nothing of anyone's own");
    const body = JSON.parse(init.body);
    sent.push(body);
    const parsed = BotsToolRequestSchema.safeParse(body);
    if (!parsed.success) return { ok: false, json: async () => ({ error: { code: "VALIDATION_ERROR" } }) };
    const answer = await runBotsTool(parsed.data, READERS);
    return { ok: true, json: async () => JSON.parse(JSON.stringify(answer)) };
  };
}

test("every draft Ryntra writes opens as the window's own, and the window would start it", async () => {
  for (const kind of ["grid", "buyLadder", "exitLadder", "recurring"]) {
    const answer = await runBotsTool({ tool: "draft", locale: "en", mint: FIXTURE_SOL, kind, amountUsd: 100, horizon: "month" }, READERS);
    const draft = toCityDraft(answer.draft);
    assert.ok(draft, kind);
    assert.equal(draft.kind, kind);
    assert.deepEqual(draft.pair, { mint: FIXTURE_SOL, symbol: "SOL" });
    assert.deepEqual(draftIssues(draft), []);
  }
  const answer = await runBotsTool({ tool: "draft", locale: "en", mint: FIXTURE_SOL, kind: "grid", amountUsd: 100, horizon: "month" }, READERS);
  assert.equal(toCityDraft({ ...answer.draft, grid: { lower: 200, upper: 100, levels: 10 } }), null, "a draft the window would refuse is no draft");
  assert.equal(toCityDraft({ ...answer.draft, grid: null }), null);
});

test("an answer that is not the tools' — one that could sign, or from elsewhere — is no answer", () => {
  assert.equal(readAnswer(null), null);
  assert.equal(readAnswer({ tool: "draft", ok: true, signs: true, source: "engine", draft: { status: "draft", signs: false } }), null);
  assert.equal(readAnswer({ tool: "draft", ok: true, signs: false, source: "model", draft: { status: "draft", signs: false } }), null);
  assert.equal(readAnswer({ tool: "draft", ok: true, signs: false, source: "engine", draft: { status: "live", signs: false } }), null);
  assert.equal(readAnswer({ tool: "transfer", ok: true, signs: false, source: "engine" }), null);
  assert.ok(readAnswer({ tool: "explain", ok: true, signs: false, source: "engine", lines: ["a", "b"] }));
});

test("the window's taps become requests the tools take: no words, no wallet beyond the address the window already reads", async () => {
  const sent = [];
  const store = createRyntraStore({ fetch: routeFetch(sent), now: () => 1_000 });
  await store.getState().suggest(SOL, 100, "en");
  const key = suggestKey(FIXTURE_SOL, "month", 100, "en");
  const entry = store.getState().suggestions[key];
  assert.equal(entry.status, "ready");
  assert.equal(entry.answer.pick.kind, "grid");
  await store.getState().simulate(SOL, "grid", 100, "month", "uk");
  const sim = store.getState().simulations[simulateKey(FIXTURE_SOL, "grid", 100, "month", "uk")];
  assert.deepEqual(sim.answer.windows.map((w) => w.days), [7, 30, 180]);
  await store.getState().explain(FIXTURE_WALLET, null, "en");
  await store.getState().explain(FIXTURE_WALLET, "ladder:sell:JUP", "uk");
  assert.equal(store.getState().explains[explainKey(FIXTURE_WALLET, null, "en")].answer.lines[0], "3 bots work, −$2.25 against holding.");
  assert.equal(store.getState().explains[explainKey(FIXTURE_WALLET, "ladder:sell:JUP", "uk")].answer.cause, "ahead");
  for (const body of sent) {
    assert.equal(BotsToolRequestSchema.safeParse(body).success, true, JSON.stringify(body));
    assert.ok(!("text" in body) && !("question" in body));
  }
  // A fresh answer is not asked again.
  await store.getState().suggest(SOL, 100, "en");
  assert.equal(sent.filter((b) => b.tool === "suggest").length, 1);
});

test("«Set it up for me»: Ryntra's draft opens in the window's review, and «Start» there stays the person's tap", async () => {
  const store = createRyntraStore({ fetch: routeFetch() });
  useBotsWindow.getState().setTab("hangar");
  useBots.setState({ page: { kind: "home" }, draft: null, bots: [] });
  const opened = await store.getState().draft(SOL, "grid", 250, "month", "en");
  assert.equal(opened, true);
  const st = useBots.getState();
  assert.deepEqual(st.page, { kind: "detail" });
  assert.equal(st.draft.kind, "grid");
  assert.equal(st.draft.amountUsd, 250);
  assert.equal(st.bots.length, 0, "nothing starts by itself");
  assert.equal(useBotsWindow.getState().tab, "launch");
  assert.equal(store.getState().drafting, false);
});

test("a tool that cannot answer leaves the hub as it was, with the tool's own line", async () => {
  const store = createRyntraStore({ fetch: async () => ({ ok: true, json: async () => ({ tool: "suggest", ok: false, reason: "no_history", line: "No price history for WEN yet — nothing to try a bot on.", signs: false, source: "engine", observedAt: null }) }) });
  await store.getState().suggest({ mint: "Gone1111111111111111111111111111111111111111", symbol: "WEN", price: 0.0001 }, 100, "en");
  const entry = Object.values(store.getState().suggestions)[0];
  assert.equal(entry.status, "none");
  assert.match(entry.line, /No price history/);
  const down = createRyntraStore({ fetch: async () => Promise.reject(new Error("offline")) });
  assert.equal(await down.getState().draft(SOL, "grid", 100, "month", "en"), false);
  assert.equal(await askBots({ tool: "weather" }, async () => ({ ok: false, json: async () => ({}) })), null);
});

test("the window's Ryntra words exist in both languages, short, with no second ask box anywhere in the window", () => {
  for (const lang of ["en", "uk"]) {
    const r = WORDS[lang].ryntra;
    assert.equal(r.name, "Ryntra");
    assert.ok(r.setUp.length <= 20, r.setUp);
    assert.deepEqual(Object.keys(r.horizon), ["week", "month", "half_year"]);
  }
  const card = readFileSync(new URL("../../components/bots/Ryntra.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(card, /<input|<textarea|contentEditable/, "taps, not words");
  assert.doesNotMatch(card, /signTransaction|sendTransaction|wallet\.sign|useWallet/, "nothing here signs");
});
