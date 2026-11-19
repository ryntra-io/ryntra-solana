// Run from repo root: node --test city/lib/command/plan.test.mjs
//
// The agent's plan from a sentence opens the card the line already fills — the agent's with the day, the
// trade's limit, the term and the strategy; the keeper's hire; the regular purchase; the launch sheet — and none that is
// shut here. The card shows the numbers said and asks for the rest; the person signs there.
import assert from "node:assert/strict";
import test from "node:test";

import { readDraft } from "../../../lib/sentence/plan.ts";
import { budgetFor } from "../autopilot/plan.ts";
import { bookOf } from "./parse.ts";
import { planCommand } from "./plan.ts";

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const tower = (id, symbol) => ({ id, symbol, name: symbol, icon: null, verified: true, mcap: 1e9, liquidity: 1e6 });
const BOOK = bookOf([tower(JUP, "JUP"), tower(MET, "MET")]);
const OPEN = { trade: true, spot: true, money: true, earn: true, launch: true, instruct: true, agentTrade: true, agentLaunch: true, dollar: true, pilot: true, ladder: true };
const CREW = { trader: true, pilot: true, keeper: true, launcher: true };
const draft = (rest, n = {}) => ({ understood: true, ask: "none", action: "none", coin: "", strategy: "none", cadence: "none", name: "", symbol: "", ...rest, numbers: Object.entries(n).map(([name, value]) => ({ name, value })) });
const planOf = (sentence, rest, n) => {
  const reading = readDraft(draft(rest, n), sentence, BOOK.coins);
  assert.equal(reading.kind, "plan", sentence);
  return reading.plan;
};

test("a trade: the agent's card with the day, the trade's limit, the term and the strategy said", () => {
  const said = "торгуй MET на 0,5 SOL на день, 0,1 за угоду, 10 днів, стоп 10 %";
  const command = planCommand(planOf(said, { action: "trade", coin: "MET" }, { perDaySol: 0.5, perTradeSol: 0.1, days: 10, stopLossPct: 10 }), OPEN, CREW);
  assert.equal(command.kind, "autopilot");
  assert.deepEqual({ ...command.ask, coin: command.ask.coin.symbol }, { kind: "trade", said, perDaySol: "0.5", coin: "MET", plan: { id: "steady", exit: { takeBps: null, stopBps: 1000 } }, perTradeSol: "0.1", days: 10 });
  // The card's budget is hers: the day, the trade and the term as said, each where the mandate's rules take it.
  const budget = budgetFor(command.ask.perDaySol, null, command.ask);
  assert.deepEqual(budget, { perDay: 500_000_000n, perTrade: 100_000_000n, days: 10 });
  assert.deepEqual(budgetFor("1", null, { perTradeSol: "2", days: 99_999 }), budgetFor("1"), "a trade over the day and a term past the mandate's are not taken");
  // The agent's own switch shut: no card.
  assert.equal(planCommand(planOf(said, { action: "trade", coin: "MET" }, { perDaySol: 0.5 }), { ...OPEN, agentTrade: false }, CREW), null);
});

test("the scout: the agent's card with new launches it picks itself", () => {
  const command = planCommand(planOf("знаходь нові монети", { action: "scout" }), OPEN, CREW);
  assert.equal(command.kind, "autopilot");
  assert.equal(command.ask.coin, null);
  assert.equal(command.ask.plan.id, "early");
});

test("a pool's care: the keeper's hire where its pools are open, the crew otherwise", () => {
  assert.deepEqual(planCommand(planOf("доглядай мій пул", { action: "care" }), OPEN, CREW), { kind: "hire", ask: { said: "доглядай мій пул", role: "keeper" } });
  assert.deepEqual(planCommand(planOf("доглядай мій пул", { action: "care" }), OPEN, { ...CREW, keeper: false }), { kind: "hire", ask: { said: "доглядай мій пул", role: null } });
});

test("a schedule: the regular purchase's card, in dollars and how often", () => {
  const command = planCommand(planOf("buy $20 of JUP every week", { action: "dca", coin: "JUP", cadence: "weekly" }, { usd: 20 }), OPEN, CREW);
  assert.equal(command.kind, "instruct");
  assert.equal(command.instruction.kind, "recurring");
  assert.equal(command.instruction.coin.mint, JUP);
  assert.equal(command.instruction.usd, "20");
  assert.equal(command.instruction.cadence, "weekly");
  const sol = planCommand(planOf("купуй SOL щодня", { action: "dca", coin: "SOL", cadence: "daily" }), OPEN, CREW);
  assert.equal(sol.instruction.coin.symbol, "SOL");
  assert.equal(sol.instruction.usd, null, "nothing said — the card asks");
  assert.equal(planCommand(planOf("купуй SOL щодня", { action: "dca", coin: "SOL" }), { ...OPEN, instruct: false }, CREW), null);
});

test("a launch: the launch sheet with the name and the ticker said", () => {
  assert.deepEqual(planCommand(planOf("launch me a coin called Neon Fox $NFOX", { action: "launch", name: "Neon Fox", symbol: "NFOX" }), OPEN, CREW), { kind: "launch", symbol: "NFOX", name: "Neon Fox" });
  assert.deepEqual(planCommand(planOf("запусти мені токен", { action: "launch" }), OPEN, CREW), { kind: "launch", symbol: null, name: null });
  assert.equal(planCommand(planOf("запусти мені токен", { action: "launch" }), { ...OPEN, launch: false }, CREW), null);
});
