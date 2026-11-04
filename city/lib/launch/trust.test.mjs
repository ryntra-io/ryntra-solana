// L3: the tower card says a launch's flow as facts — the launch slot, the creator's strip, the independent buyers, the
// creator's past coins — never a verdict, never more than it is, and nothing the engine did not read. The stand's
// flows fit the contract.
import assert from "node:assert/strict";
import test from "node:test";

import { LaunchFlowResponseSchema } from "../../../lib/api/v1/contract.ts";
import { stubEngine } from "./stub.ts";
import { devStrip, flowMethod, pct, trustPills } from "./trust.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");

async function flowOf(symbol) {
  const engine = stubEngine({ now: () => NOW });
  const markets = await engine.markets();
  const row = markets.data.markets.find((market) => market.symbol === symbol);
  const answer = await engine.flow(row.token);
  assert.ok(answer.ok);
  return answer.data;
}

test("a share is rounded down and never reads as more than it is", () => {
  assert.equal(pct(120), "1.2 %");
  assert.equal(pct(129), "1.2 %");
  assert.equal(pct(100), "1 %");
  assert.equal(pct(7), "<0.1 %");
  assert.equal(pct(0), "0 %");
});

test("every flow of the stand fits the contract", async () => {
  for (const symbol of ["NOVA", "KITE", "MOTH", "OWL", "DUSK"]) LaunchFlowResponseSchema.parse(await flowOf(symbol));
});

test("the pills: the facts worth a look first, in a few words, at most four", async () => {
  const nova = trustPills(await flowOf("NOVA"));
  assert.deepEqual(
    nova.map((pill) => [pill.text, pill.tone]),
    [
      ["3 buys in the launch slot · 4.1 %", "watch"],
      ["≥17 independent buyers", "fact"],
      ["Creator's past coins: 2 · 1 survived", "fact"],
    ],
  );
  const kite = trustPills(await flowOf("KITE"));
  assert.deepEqual(kite.map((pill) => pill.text), ["No buys in the launch slot", "≥26 independent buyers", "Creator's first coin"]);
  const moth = trustPills(await flowOf("MOTH"));
  assert.ok(moth.some((pill) => pill.text === "Graduated by 99 buyers"));
  const dusk = trustPills(await flowOf("DUSK"));
  assert.equal(dusk[0].text, "5 buys in the launch slot · 11.8 %");
  assert.ok(dusk.some((pill) => pill.text === "1 bundle later" && pill.tone === "watch"));
  assert.ok(dusk.some((pill) => pill.text === "Creator's past coins: 3 · 0 survived" && pill.tone === "watch"));
  for (const pill of [...nova, ...kite, ...moth, ...dusk]) assert.doesNotMatch(pill.text, /safe|scam|rug|verified|guarant/i);
});

test("the creator's strip: bought, whether they sold, what they hold, the wallets of their party", async () => {
  assert.deepEqual(devStrip(await flowOf("NOVA")), { bought: "Dev bought 1.2 %", sold: "never sold", soldTone: "fact", holds: "holds 1.2 %", linked: "+2 linked wallets · 0.8 %" });
  assert.deepEqual(devStrip(await flowOf("KITE")), { bought: "Dev bought 0.8 %", sold: "sold 50 % of it", soldTone: "watch", holds: "holds 0.4 %", linked: null });
});

test("a sale not read is never «never sold»", async () => {
  const flow = await flowOf("NOVA");
  const strip = devStrip({ ...flow, dev: { ...flow.dev, complete: false } });
  assert.equal(strip.sold, "no sale read");
});

test("the method behind «i» names the floor the engine used", async () => {
  const flow = await flowOf("KITE");
  assert.match(flowMethod(flow).join(" "), /\$1 or more/);
  assert.match(flowMethod({ rules: { ...flow.rules, floorUsd: null } }).join(" "), /any buy/);
});
