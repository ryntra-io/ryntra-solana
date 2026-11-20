import assert from "node:assert/strict";
import test from "node:test";

import { bookOf } from "../../city/lib/command/parse.ts";
import { askLabel } from "./ask-label.ts";
import { EVERY_GATE, NEW_COINS, askHref, askRows, modelWanted, newCoinsRow, planAnswer } from "./ask-route.ts";

/* The line's own rules first and free; the model only where they did not understand — and its plan opens the
   card of a shelf that is on, or asks back «Уточни: …». Never a shelf that is off, never a signature. */

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const tower = (id, symbol, mcap) => ({ id, symbol, name: symbol, icon: null, verified: true, mcap, liquidity: 1e6 });
const BOOK = bookOf([tower(JUP, "JUP", 9e8), tower(MET, "MET", 5e8)]);
const ALL = () => true;
const ONLY = (...ids) => (id) => ids.includes(id);
const first = (text, on = ALL) => askRows(text, BOOK, { subject: null }, on, EVERY_GATE)[0] ?? null;
const wanted = (text) => modelWanted(text, first(text));
const draft = (rest, n = {}) => ({ understood: true, ask: "none", action: "none", coin: "", strategy: "none", cadence: "none", name: "", symbol: "", ...rest, numbers: Object.entries(n).map(([name, value]) => ({ name, value })) });

test("the model is asked only where the line's own rules did not understand", () => {
  // Not understood, or read without what was said.
  assert.equal(wanted("знаходь нові монети"), true);
  assert.equal(wanted("can you look for fresh launches and put a little sol in the good ones"), true);
  assert.equal(wanted("trade JUP for me with 2 SOL a day for a week"), true, "a day's budget typed, not read");
  assert.equal(wanted("купуй SOL щодня"), true, "a plain buy said on a schedule");
  assert.equal(wanted("доглядай мій пул"), true, "a hire without its agent");
  // Understood: free, at once.
  assert.equal(wanted("торгуй JUP за мене щодня на 2 SOL"), false);
  assert.equal(wanted("buy JUP for 50"), false);
  assert.equal(wanted("запусти мені токен"), false);
  assert.equal(wanted("my portfolio"), false);
  assert.equal(wanted("JUP"), false);
  // A question is Ryntra's to answer, not a job.
  assert.equal(wanted("why is JUP down?"), false);
  assert.equal(wanted(""), false);
});

test("the plan opens its shelf's card, filled — only on a shelf that is on", () => {
  const said = "trade JUP for me with 2 SOL a day for a week";
  const answer = planAnswer(draft({ action: "trade", coin: "JUP" }, { perDaySol: 2 }), said, BOOK, ALL, EVERY_GATE);
  assert.equal(answer.kind, "row");
  assert.deepEqual(answer.row.target, { shelf: "agents", mint: null, path: "/bots/recurring" }, "a budget a day is the «Recurring buys» bot's page");
  assert.equal(answer.row.command.kind, "autopilot");
  assert.equal(answer.row.command.ask.perDaySol, "2");
  assert.equal(answer.row.command.ask.coin.mint, JUP);
  assert.equal(planAnswer(draft({ action: "trade", coin: "JUP" }, { perDaySol: 2 }), said, BOOK, ONLY("market", "swap"), EVERY_GATE), null, "the Agents shelf off: the line's own rules");

  const dca = planAnswer(draft({ action: "dca", coin: "SOL", cadence: "daily" }), "купуй SOL щодня", BOOK, ALL, EVERY_GATE);
  assert.equal(dca.row.command.kind, "instruct");
  assert.equal(dca.row.target.shelf, "agents");
  const launch = planAnswer(draft({ action: "launch" }), "запусти мені токен", BOOK, ALL, EVERY_GATE);
  assert.deepEqual(launch.row.target, { shelf: "launch", mint: null });
  const care = planAnswer(draft({ action: "care" }), "доглядай мій пул", BOOK, ALL, EVERY_GATE);
  assert.equal(care.row.command.kind, "hire");
});

test("what the engine does not take is a question back, never a guess", () => {
  assert.deepEqual(planAnswer(draft({ action: "trade", coin: "FAKECOIN" }, { perDaySol: 1 }), "торгуй FAKECOIN на 1 SOL на день", BOOK, ALL, EVERY_GATE), { kind: "clarify", need: "coin", word: "FAKECOIN" });
  assert.deepEqual(planAnswer(draft({ understood: false, ask: "action" }), "привіт", BOOK, ALL, EVERY_GATE), { kind: "clarify", need: "action" });
  assert.deepEqual(planAnswer("nonsense", "привіт", BOOK, ALL, EVERY_GATE), { kind: "clarify", need: "other" });
  // A number the person did not type is not in the card.
  const made = planAnswer(draft({ action: "trade", coin: "JUP" }, { perDaySol: 5 }), "торгуй JUP за мене", BOOK, ALL, EVERY_GATE);
  assert.equal(made.row.command.ask.perDaySol, null);
});

/* «Find new coins for me» opened Recurring buys on JUP with «New launches that pass the
   check» over it — a card for a scout the terminal does not run yet. New launches bought early open the market's new
   coins instead, whether the model plans it or the line's own rules read it; the home page's ready sentence opens them
   at once. */
test("new coins open the market's new coins — never a bot's card the terminal cannot run", () => {
  const scout = planAnswer(draft({ action: "scout" }), "знаходь нові монети", BOOK, ALL, EVERY_GATE);
  assert.equal(scout.kind, "row");
  assert.deepEqual(scout.row.target, NEW_COINS, "the model's scout: the Launch's «New» tab");
  assert.deepEqual(NEW_COINS, { shelf: "launch", mint: null, path: "/launch?tab=fresh" });
  assert.equal(askHref(NEW_COINS, "live"), "/launch?tab=fresh");
  assert.equal(planAnswer(draft({ action: "scout" }), "знаходь нові монети", BOOK, ONLY("agents", "market"), EVERY_GATE), null, "Launch off: the line's own reading");
  // The line's own rules: «buy new launches early» is the same plan.
  const early = first("купуй нові запуски рано");
  assert.equal(early?.command.kind, "autopilot");
  assert.equal(early?.command.ask.plan?.id, "early");
  assert.deepEqual(early?.target, NEW_COINS);
  // Its row says where it leads — the new coins, not a budget it would drop.
  assert.equal(askLabel(early.command, "uk"), "Нові на ринку");
  assert.equal(askLabel(early.command, "en"), "New on the market");
  assert.equal(askLabel(first("торгуй JUP за мене щодня на 2 SOL").command, "en"), "Trade within a daily budget");
  // A budget a day stays Recurring buys.
  assert.deepEqual(first("торгуй JUP за мене щодня на 2 SOL")?.target, { shelf: "agents", mint: null, path: "/bots/recurring" });
  // The ready sentence's own row: no model is asked for it, it opens the new coins.
  const row = newCoinsRow("Знайди нові монети");
  assert.deepEqual(row.target, NEW_COINS);
  assert.equal(row.command.kind, "ask");
  assert.notEqual(row.key, first("Знайди нові монети")?.key, "a row of its own: the line takes it as picked, the model is not asked");
});
