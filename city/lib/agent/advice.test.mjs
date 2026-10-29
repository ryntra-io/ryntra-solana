import { test } from "node:test";
import assert from "node:assert/strict";

import { adviceLines, adviceQuestion, askRyntra } from "./advice.ts";

const facts = [
  { label: "Move 1H", value: "+6.2%", note: "≥ +5%" },
  { label: "Liquidity", value: "$4M", note: "≥ $250K" },
];

test("the question names the coin and the figures the scout used", () => {
  assert.equal(adviceQuestion({ symbol: "$WIF" }, facts), "My scout in the city found $WIF: Move 1H +6.2%, Liquidity $4M. What should I check before I decide to buy it?");
});

test("checks and risks come first, at most three lines", () => {
  const body = {
    ryn: {
      text: "About WIF",
      answer: {
        observation: [{ text: "Volume rose." }],
        risks: [{ text: "Memes swing hard." }],
        checks: [{ text: "Check the holders." }, { text: "Check the pool depth." }],
        counter: [],
      },
    },
  };
  assert.deepEqual(adviceLines(body), ["Check the holders.", "Check the pool depth.", "Memes swing hard."]);
  assert.deepEqual(adviceLines({ ryn: { text: "One line.", answer: null } }), ["One line."]);
  assert.deepEqual(adviceLines(null), []);
});

test("an assistant that is not there leaves the find on its figures", async () => {
  const down = await askRyntra({ id: "m", symbol: "WIF" }, facts, async () => new Response("{}", { status: 503 }));
  assert.deepEqual(down, { ok: false, message: "Ryntra is not available here right now." });
  const thrown = await askRyntra({ id: "m", symbol: "WIF" }, facts, async () => {
    throw new Error("offline");
  });
  assert.equal(thrown.ok, false);
  let sent;
  const ok = await askRyntra({ id: "mint1", symbol: "$WIF" }, facts, async (url, init) => {
    sent = { url, body: JSON.parse(init.body), credentials: init.credentials };
    return new Response(JSON.stringify({ ryn: { text: "x", answer: { checks: [{ text: "Check it." }] } } }), { status: 200 });
  });
  assert.deepEqual(ok, { ok: true, lines: ["Check it."] });
  assert.equal(sent.url, "/api/v1/assistant/guest");
  assert.equal(sent.credentials, "omit");
  assert.deepEqual(sent.body.context, { kind: "asset", mint: "mint1", symbol: "WIF" });
});
