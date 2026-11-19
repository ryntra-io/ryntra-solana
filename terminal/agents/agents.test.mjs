import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bookOf } from "../../city/lib/command/parse.ts";
import { askLabel } from "../shell/ask-label.ts";
import { ROWS_MAX } from "../../city/lib/command/parse.ts";
import { EVERY_GATE, askHref, askRows, gatesFor, targetOf } from "../shell/ask-route.ts";
import { engineGates } from "../shell/engine.ts";
import { SHELVES, shelfOn } from "../shell/shelves.ts";
import { budgetText, budgetUse, centsOf, daysLeft, lamportsTyped, resultShown, solPlain, usdShown } from "./figures.ts";
import { agentCommand, agentRow, crewOpen } from "./read.ts";
import { keeperRows, mandateLive, pastAgents, pilotRecord, pilotRow, tradeHistory, traderRecords, traderRow, traderRows, traderState, workerPath } from "./rows.ts";

/* The Agents screen stands on the city's own readers and the engine's own figures: a sentence that is a job for an
   agent opens the agent's card — never a trade window, never a signature — and «My agents» says only what was read. */

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const tower = (id, symbol, mcap) => ({ id, symbol, name: symbol, icon: null, verified: true, mcap, liquidity: 1e6 });
const BOOK = bookOf([tower(BONK, "BONK", 9e8), tower(JUP, "JUP", 8e8)]);
const NONE = { subject: null };
const ALL = () => true;
const ONLY = (...ids) => (id) => ids.includes(id);
const OPEN = { trader: true, pilot: true, keeper: true, launcher: true };

/* ------------------------------------------------------------------------------------------------ the sentences */

test("a budget a day is the trader's card, in both languages, with the coin, the budget and the strategy said", () => {
  for (const said of ["Торгуй BONK на 0,1 SOL на день", "Trade BONK for me, 0.1 SOL a day", "trade 0.1 SOL a day"]) {
    const command = agentCommand(said, BOOK, NONE, EVERY_GATE, OPEN);
    assert.equal(command?.kind, "autopilot", said);
    assert.equal(command.ask.kind, "trade", said);
    assert.equal(command.ask.perDaySol, "0.1", said);
  }
  const named = agentCommand("Торгуй BONK на 0,1 SOL на день", BOOK, NONE, EVERY_GATE, OPEN);
  assert.equal(named.ask.coin?.mint, BONK);
  const dip = agentCommand("Купуй BONK на просіданнях за мене", BOOK, NONE, EVERY_GATE, OPEN);
  assert.equal(dip?.kind, "autopilot");
  assert.equal(dip.ask.plan?.id, "dip");
  assert.equal(dip.ask.coin?.mint, BONK);
});

test("one plan for a whole budget is the autopilot's, read before the trader's", () => {
  const plan = agentCommand("Працюй з моїми 0,2 SOL: частину в скарбничку, частину торгуй, частину в пули", BOOK, NONE, EVERY_GATE, OPEN);
  assert.equal(plan?.kind, "pilot");
  assert.equal(plan.ask.solRaw, "200000000");
  // Shut on the deployment, the plan is not offered — and never falls to the trader as a budget a day.
  assert.equal(agentCommand("Працюй з моїми 0,2 SOL: частину в скарбничку, частину в пули", BOOK, NONE, { ...EVERY_GATE, pilot: false }, OPEN)?.kind ?? null, null);
});

test("a hire names its agent; an agent shut here hands the person the whole crew", () => {
  assert.deepEqual(agentCommand("trade for me", BOOK, NONE, { ...EVERY_GATE, agentTrade: false }, OPEN), { kind: "hire", ask: { said: "trade for me", role: "trader" } });
  assert.equal(agentCommand("найми агента", BOOK, NONE, EVERY_GATE, OPEN)?.ask.role, null);
  assert.equal(agentCommand("доглядай мій пул", BOOK, NONE, EVERY_GATE, OPEN)?.ask.role, "keeper");
  assert.equal(agentCommand("доглядай мій пул", BOOK, NONE, EVERY_GATE, { ...OPEN, keeper: false })?.ask.role, null);
});

test("what is not a job for an agent is left alone: a plain trade, a question, a refusal, a launch, another screen's sentence", () => {
  for (const said of ["buy JUP for 50", "trade JUP", "чому BONK падає?", "не торгуй за мене", "my portfolio", "JUP", ""]) {
    assert.equal(agentCommand(said, BOOK, NONE, EVERY_GATE, OPEN), null, said);
  }
  // A launch the agent prepares is the Launch shelf's own sentence, read by the plain list.
  assert.equal(agentCommand("Запусти мені токен", BOOK, NONE, EVERY_GATE, OPEN), null);
  assert.equal(agentCommand("launch me a coin called Neon Fox", BOOK, NONE, EVERY_GATE, OPEN), null);
  // «Buy cheaper» is the coin's ladder where ladders are open — never taken for the agent's dip strategy over it.
  assert.equal(agentCommand("купи BONK дешевше", BOOK, NONE, EVERY_GATE, OPEN)?.kind, "ladder");
  const rows = askRows("buy BONK cheaper for 50 USDC", BOOK, NONE, ALL, EVERY_GATE);
  assert.deepEqual([rows[0]?.command.kind, rows[0]?.target], ["ladder", { shelf: "market", mint: BONK }], "first, on the coin's own screen");
  assert.notEqual(askRows("buy BONK cheaper", BOOK, NONE, ALL, { ...EVERY_GATE, ladder: false })[0]?.command.kind, "ladder");
  assert.equal(agentCommand("купи BONK дешевше", BOOK, NONE, { ...EVERY_GATE, ladder: false }, OPEN)?.kind, "autopilot");
  // The dollar saver's sentence is Earn's where its engine is open.
  assert.equal(agentCommand("put my USDC to work", BOOK, NONE, EVERY_GATE, OPEN), null);
});

test("the agents open here follow the line's gates; the keeper and the launcher wait for their shelves", () => {
  const all = gatesFor(ALL, EVERY_GATE);
  assert.deepEqual(crewOpen(all, true, true), OPEN);
  assert.equal(crewOpen(all, false, true).keeper, false, "the keeper's pools are the Earn shelf's");
  assert.equal(crewOpen(all, true, false).keeper, false, "the keeper's own switch");
  const alone = gatesFor(ONLY("agents"), EVERY_GATE);
  assert.deepEqual(crewOpen(alone, false, true), { trader: true, pilot: true, keeper: false, launcher: false });
  assert.deepEqual(crewOpen(gatesFor(ONLY("agents"), { ...EVERY_GATE, agentTrade: false, pilot: false }), false, true), { trader: false, pilot: false, keeper: false, launcher: false });
});


/* ------------------------------------------------------------------------------------------------ the header's line */

test("the header's line puts a bot's job first and opens its own page under «Bots»", () => {
  const rows = askRows("Торгуй BONK на 0,1 SOL на день", BOOK, NONE, ALL, EVERY_GATE);
  assert.equal(rows[0].command.kind, "autopilot");
  assert.deepEqual(rows[0].target, { shelf: "agents", mint: null, path: "/bots/recurring" }, "a budget a day is Recurring buys — a bot");
  assert.equal(askHref(rows[0].target, "live"), "/bots/recurring");
  assert.equal(askHref(rows[0].target, "preview"), "/terminal/kit/agents", "the kit page has one preview a shelf");
  assert.equal(askLabel(rows[0].command, "uk"), "Торгувати з бюджетом на день");
  // Before: the same words opened the coin's own screen. That row still stands under the agent's.
  assert.ok(rows.some((row) => row.command.kind === "coin" && row.target.mint === BONK));
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length, "no row twice");
  const hire = askRows("hire an agent", BOOK, NONE, ONLY("agents"), EVERY_GATE);
  assert.equal(hire[0].command.kind, "hire");
  assert.equal(askLabel(hire[0].command, "en"), "Hire an agent");
  assert.deepEqual(targetOf(hire[0].command), { shelf: "agents", mint: null }, "a hire of no one is the Agents screen's");
  // A hire that names its worker goes where that worker is: the bots on their pages, the keeper on Earn, the launcher on Launch.
  const hireOf = (role) => targetOf({ kind: "hire", ask: { said: "", role } });
  assert.equal(hireOf("trader").path, "/bots/recurring");
  assert.equal(hireOf("pilot").path, "/bots/autopilot");
  assert.deepEqual(hireOf("keeper"), { shelf: "earn", mint: null });
  assert.deepEqual(hireOf("launcher"), { shelf: "launch", mint: null });
  // One plan for the whole budget is the money autopilot's page; a question is the analyst's, on the Agents screen.
  const plan = askRows("Працюй з моїми 0,2 SOL: частину в скарбничку, частину торгуй, частину в пули", BOOK, NONE, ALL, EVERY_GATE)[0];
  assert.deepEqual([plan.command.kind, plan.target.path], ["pilot", "/bots/autopilot"]);
  assert.deepEqual(targetOf({ kind: "ask", question: "why?" }), { shelf: "agents", mint: null });
});

test("without the Agents shelf, or with the agent's engine shut, the line reads as it did", () => {
  const without = askRows("Торгуй BONK на 0,1 SOL на день", BOOK, NONE, ONLY("market"), EVERY_GATE);
  assert.ok(without.every((row) => row.command.kind !== "autopilot" && row.command.kind !== "hire"));
  const shut = askRows("trade 0.1 SOL a day", BOOK, NONE, ALL, { ...EVERY_GATE, agentTrade: false });
  assert.ok(shut.every((row) => row.command.kind !== "autopilot"));
  // A plain trade is never the agent's row.
  assert.equal(agentRow("buy JUP for 50", BOOK, NONE, gatesFor(ALL, EVERY_GATE), true), null);
});


test("a long list keeps its most rows, the agent's first", () => {
  const rows = askRows("Торгуй BONK на 0,1 SOL на день", BOOK, NONE, ALL, EVERY_GATE);
  assert.ok(rows.length <= ROWS_MAX);
  assert.equal(rows[0].command.kind, "autopilot");
});

test("the Agents shelf is on, at its own address, and takes the autopilot's plan by the city's own switch", () => {
  assert.equal(SHELVES.agents.ready, true);
  assert.equal(SHELVES.agents.path, "/agent");
  assert.equal(shelfOn("agents", "stand"), true);
  assert.equal(shelfOn("agents", "open"), true);
  assert.equal(shelfOn("agents", "closed"), false, "behind the terminal's switch nothing changes");
  // The autopilot's gate is the city's rule: its switch over the agent's and the mandate's; one-sentence instructions have no screen.
  const pilotSwitch = process.env.NEXT_PUBLIC_RYNTRA_CITY_PILOT?.trim() === "open";
  const agentOn = ["devnet", "mainnet"].includes(process.env.NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT?.trim() ?? "") && ["devnet", "mainnet"].includes(process.env.NEXT_PUBLIC_RYNTRA_CITY_MANDATE?.trim() ?? "");
  assert.equal(engineGates().pilot, pilotSwitch && agentOn);
  assert.equal(engineGates().instruct, false);
  const engine = readFileSync(new URL("../shell/engine.ts", import.meta.url), "utf8");
  assert.doesNotMatch(engine, /from '[^']*city\/lib\/pilot\/store/, "the frame does not load the autopilot's store for one switch");
});

/* ------------------------------------------------------------------------------------------------ the figures */

test("days left count up, a budget's SOL is cut and never rounded up, and its use is a share of the day", () => {
  const now = Date.UTC(2026, 10, 16);
  assert.equal(daysLeft(String(now / 1000 + 27 * 86_400), now), 27);
  assert.equal(daysLeft(String(now / 1000 + 26 * 86_400 + 60), now), 27, "27 days and a minute are 27 days left");
  assert.equal(daysLeft(String(now / 1000 - 5), now), 0);
  assert.equal(daysLeft("soon", now), null);
  assert.equal(solPlain("40000000", "uk"), "0,04");
  assert.equal(solPlain("100000000", "uk"), "0,10");
  assert.equal(solPlain("100000000", "en"), "0.10");
  assert.equal(solPlain("1497553999", "en"), "1.4975", "cut, not rounded up");
  assert.equal(solPlain("50000", "en"), "0.00005", "a spend under 0.0001 is never written as a zero");
  assert.equal(solPlain("x", "en"), "—");
  assert.equal(budgetUse("100000000", "40000000"), 0.4);
  assert.equal(budgetUse("100000000", "250000000"), 1, "never over the whole bar");
  assert.equal(budgetUse("100000000", null), null, "a spend not read is no bar, not an empty one");
  assert.equal(budgetUse("0", "1"), null);
});

test("a result is the agent's own: in dollars at SOL's price when it was read, in SOL otherwise; a gain cut down, a loss counted up", () => {
  assert.deepEqual(resultShown("26666667", 150, "en"), { text: "+$4.00", tone: "up" });
  assert.deepEqual(resultShown("26666667", 150, "uk"), { text: "+$4,00", tone: "up" });
  assert.deepEqual(resultShown("26666666", 150, "en"), { text: "+$3.99", tone: "up" }, "a gain is never rounded up");
  assert.deepEqual(resultShown("-13333334", 150, "en"), { text: "−$2.01", tone: "down" }, "a loss is never rounded down");
  assert.deepEqual(resultShown("-2633333", 150, "en"), { text: "−$0.40", tone: "down" });
  assert.deepEqual(resultShown("-1000", 150, "en"), { text: "−$0.01", tone: "down" }, "a tiny loss is a loss");
  assert.deepEqual(resultShown("12000000", null, "uk"), { text: "+0,012 SOL", tone: "up" });
  assert.deepEqual(resultShown("0", 150, "en"), { text: "$0.00", tone: undefined });
  assert.equal(resultShown(null, 150, "en"), null, "not read — not shown");
  assert.equal(resultShown("1.5", 150, "en"), null);
  assert.equal(centsOf("100", 0), null);
  assert.deepEqual(usdShown(1.239, "en"), { text: "+$1.23", tone: "up" }, "a gain is cut down");
  assert.deepEqual(usdShown(-1.231, "en"), { text: "−$1.24", tone: "down" }, "a loss is cut up");
  assert.equal(usdShown(null, "en"), null);
});

test("a budget typed is read as SOL, a comma or a point, and nothing else is a budget", () => {
  assert.equal(lamportsTyped("0,1"), 100_000_000n);
  assert.equal(lamportsTyped("0.25"), 250_000_000n);
  assert.equal(lamportsTyped("1"), 1_000_000_000n);
  for (const typed of ["", "0", "0,", ".", "abc", "1,2,3", "-1", "1e3"]) assert.equal(lamportsTyped(typed), null, typed);
  assert.equal(budgetText(100_000_000n, "uk"), "0,1");
  assert.equal(budgetText(250_000_000n, "en"), "0.25");
  assert.equal(budgetText(1_000_000_000n, "en"), "1");
});

/* ------------------------------------------------------------------------------------------------ my agents */

const NOW = Date.UTC(2026, 10, 16, 12);
const record = (policy) => ({ owner: "Own", settings: "Set", vault: "Vau", policy, budget: "100000000", perTrade: "20000000", perDay: "100000000", expiresAt: String(NOW / 1000 + 27 * 86_400) });
const RECORD = record("Pol");
const DAY = { since: NOW - 86_400_000, until: NOW, trades: 3, spentRaw: "40000000", boughtRaw: "1", worthRaw: "44000000", earnedRaw: "4000000", netRaw: "3500000", holdRaw: "1000000" };
const VIEW = {
  status: "working",
  strategy: "steady",
  receiveMint: BONK,
  symbol: "BONK",
  everyMs: 1,
  result: { trades: 9, spentRaw: "180000000", boughtRaw: "1", worthRaw: "190000000", earnedRaw: "10000000", multiple: 1.05 },
  last: [],
  updatedAt: NOW,
  day: DAY,
  net: { trades: 9, spentRaw: "180000000", netRaw: "8000000", holdRaw: "2000000", feesRaw: "1000000" },
};
const ACTIVE = { active: true, budgetLamports: "60000000" };
const mandate = (policy, over = {}) => ({ record: record(policy), status: "working", budgetLamports: "60000000", live: true, active: true, trades: 2, pilot: false, frozen: false, createdAt: 1, ...over });

test("the trader's row is its mandate and its book: the day's budget, the day's trades, the whole result after fees, and its own stop", () => {
  assert.deepEqual(traderRow(RECORD, ACTIVE, VIEW, NOW), {
    key: "trader:Pol",
    role: "trader",
    coin: { mint: BONK, symbol: "BONK" },
    pool: null,
    daysLeft: 27,
    state: "working",
    budget: { perDayRaw: "100000000", spentRaw: "40000000" },
    trades: 3,
    result: { raw: "8000000" },
    span: "all",
    dayRaw: "3500000",
    stop: { record: RECORD },
  });
});

test("what the book did not answer stays off the row — never a zero in its place", () => {
  const unread = traderRow(RECORD, ACTIVE, null, NOW);
  assert.equal(unread.coin, null);
  assert.equal(unread.budget.spentRaw, null);
  assert.equal(unread.trades, null);
  assert.equal(unread.result, null);
  assert.equal(unread.dayRaw, null);
  const fresh = traderRow(RECORD, ACTIVE, { ...VIEW, result: { ...VIEW.result, trades: 0 }, day: { ...DAY, trades: 0 } }, NOW);
  assert.equal(fresh.result, null);
  assert.equal(fresh.dayRaw, null);
  assert.equal(fresh.trades, 0);
  const before = { ...VIEW };
  delete before.net;
  assert.deepEqual(traderRow(RECORD, ACTIVE, before, NOW).result, { raw: "10000000" }, "before the fees were counted: what the trades did at the price now");
});

test("a mandate that no longer stands is not a row; a paused one still holds its budget and its «Stop»", () => {
  assert.equal(traderRow(RECORD, { active: false, budgetLamports: null }, VIEW, NOW), null);
  assert.equal(traderRow(RECORD, ACTIVE, { ...VIEW, status: "stopped" }, NOW), null);
  assert.equal(mandateLive(RECORD, undefined, null), true, "not read yet stands, as on the city's card");
  assert.equal(traderRow(RECORD, ACTIVE, { ...VIEW, status: "paused" }, NOW).state, "paused");
});

test("the trader's state is the engine's mission, in one word", () => {
  assert.equal(traderState(null), "working");
  assert.equal(traderState({ status: "working" }), "working");
  assert.equal(traderState({ status: "paused" }), "paused");
  assert.equal(traderState({ status: "ended" }), "done");
  assert.equal(traderState({ status: "working", mission: { state: "confirming", reason: null, nextAt: null } }), "confirming");
  assert.equal(traderState({ status: "working", mission: { state: "frozen", reason: null, nextAt: null } }), "frozen");
  assert.equal(traderState({ status: "working", frozen: true }), "frozen");
  assert.equal(traderState({ status: "working", mission: { state: "waiting", reason: null, nextAt: 5 } }), "working");
  assert.equal(traderState({ status: "working", mission: { state: "done", reason: null, nextAt: null } }), "done");
});

test("every trader the engine knows is a row with its own book and its own stop — and the autopilot's mandate never is", () => {
  const engine = [mandate("A"), mandate("B", { active: false, live: true, status: "spent" }), mandate("C", { active: false, live: false, status: "stopped" }), mandate("P", { pilot: true })];
  const records = traderRecords({ local: null, engine, pilotPolicy: null });
  assert.deepEqual(records.map((one) => one.record.policy), ["A", "B"], "what still stands; never the autopilot's");
  const rows = traderRows({ local: null, engine, pilotPolicy: null, views: { A: VIEW } }, NOW);
  assert.deepEqual(rows.map((row) => [row.key, row.stop.record.policy, row.coin?.symbol ?? null]), [
    ["trader:A", "A", "BONK"],
    ["trader:B", "B", null],
  ]);
  // A mandate signed here that has not reached the engine stands beside the engine's; one the engine has is not twice.
  assert.deepEqual(traderRecords({ local: { record: record("L"), status: undefined }, engine, pilotPolicy: null }).map((one) => one.record.policy), ["A", "B", "L"]);
  assert.deepEqual(traderRecords({ local: { record: record("A"), status: undefined }, engine, pilotPolicy: null }).map((one) => one.record.policy), ["A", "B"]);
});

test("right after the autopilot goes live, its mandate is no phantom trader — whether or not the engine has answered", () => {
  const local = { record: record("P"), status: ACTIVE };
  assert.deepEqual(traderRecords({ local, engine: null, pilotPolicy: "P" }), [], "the autopilot's own view names the policy");
  assert.deepEqual(traderRecords({ local, engine: [mandate("P", { pilot: true })], pilotPolicy: null }), [], "the engine names it");
  assert.deepEqual(traderRows({ local, engine: null, pilotPolicy: "P", views: {} }, NOW), []);
  assert.deepEqual(traderRows({ local, engine: null, pilotPolicy: null, views: {} }, NOW).map((row) => row.key), ["trader:P"], "with neither answer, the mandate signed here still shows — and can be stopped");
});

test("the autopilot's row is its plan at work with its week; «Stop» takes back its own mandate, found by its policy", () => {
  assert.equal(pilotRow(null, null), null);
  assert.equal(pilotRow({ status: "stopped", held: null, care: null, policy: "P" }, record("P")), null);
  const row = pilotRow({ status: "working", held: null, care: { weekUsd: 4.2 }, policy: "P" }, record("P"));
  assert.deepEqual([row.role, row.state, row.result, row.span, row.budget, row.trades, row.stop.record.policy], ["pilot", "working", { usd: 4.2 }, "week", null, null, "P"]);
  assert.equal(pilotRow({ status: "working", held: { why: "market", since: 1 }, care: { weekUsd: null }, policy: "P" }, null).state, "paused");
  assert.equal(pilotRow({ status: "working", held: null, care: null, policy: "P" }, null).stop, null, "no mandate found — nothing to stop from here");
  assert.equal(pilotRow({ status: "working", held: null, care: null, policy: "P" }, record("X")).stop, null, "never another mandate");
  // The mandate is the engine's for the plan's policy, else this browser's when it is the same — never a trader's.
  assert.equal(pilotRecord("P", [mandate("A"), mandate("P", { pilot: true })], record("A")).policy, "P");
  assert.equal(pilotRecord("P", null, record("P")).policy, "P");
  assert.equal(pilotRecord("P", null, record("A")), null);
  assert.equal(pilotRecord(null, [mandate("P")], null), null);
});

test("the keeper's rows are the pools it looks after today, each with its own «Stop»", () => {
  const care = (key, status, day, inRange = true) => ({ key, pool: "Pool", status, inRange, day: { claimedInY: day, reinvestedInY: 0, rebalances: 0 } });
  const rows = keeperRows([care("a", "working", 0.0012), care("b", "stopped", 1), care("c", "working", 0, false), care("d", "signing", 1)]);
  assert.deepEqual(rows.map((row) => [row.key, row.pool, row.result, row.span, row.stop]), [
    ["keeper:a", "earning", { raw: "1200000" }, "day", { care: "a" }],
    ["keeper:c", "moving", null, "day", { care: "c" }],
  ]);
  assert.deepEqual(keeperRows(null), []);
});

test("a bot at work is managed on its own page: Recurring buys and the money autopilot under «Bots», the keeper's pools on Earn", () => {
  assert.equal(workerPath("trader"), "/bots/recurring");
  assert.equal(workerPath("pilot"), "/bots/autopilot");
  assert.equal(workerPath("keeper"), "/earn");
});


test("history is the books' own trades, each by what it is, newest first across the traders, and the mandates that are over", () => {
  const view = {
    last: [
      { at: 1, ok: true, signature: "s1", spentRaw: "20000000", receivedRaw: "5" },
      { at: 3, ok: false, state: "unknown", signature: null, spentRaw: "20000000", receivedRaw: null },
      { at: 2, ok: false, signature: null, spentRaw: "0", receivedRaw: null },
      { at: 4, ok: false, state: "refused", signature: null, spentRaw: "0", receivedRaw: null },
    ],
  };
  const other = { last: [{ at: 5, ok: false, state: "held", signature: null, spentRaw: "0", receivedRaw: null }] };
  assert.deepEqual(tradeHistory([view, other]).map((row) => [row.at, row.what, row.spentRaw]), [
    [5, "held", null],
    [4, "skipped", null],
    [3, "confirming", null],
    [2, "failed", null],
    [1, "bought", "20000000"],
  ]);
  assert.equal(new Set(tradeHistory([view, view]).map((row) => row.key)).size, 8, "two books, no key twice");
  assert.deepEqual(tradeHistory([null]), []);
  assert.deepEqual(pastAgents([mandate("a", { status: "working" }), mandate("b", { status: "stopped", active: false, live: false, createdAt: 1 }), mandate("c", { status: "spent", active: false, live: false, createdAt: 3 }), mandate("e", { status: "ended", active: false, live: true, createdAt: 4 }), mandate("d", { status: "ended", active: false, live: false, pilot: true, createdAt: 2 })]), [
    { key: "c", createdAt: 3, trades: 2, state: "done" },
    { key: "b", createdAt: 1, trades: 2, state: "stopped" },
  ]);
});

/* ------------------------------------------------------------------------------------------------ the screen's rules */

const source = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

test("the wallet opens only from the screen's own buttons: every signing call stands in a press", () => {
  const panel = source("./NewAgent.tsx");
  for (const call of panel.matchAll(/\b(signTrade|goLive)\(/g)) {
    const before = panel.slice(Math.max(0, call.index - 400), call.index);
    assert.match(before, /onPress=\{\(who\) =>/, `${call[1]} outside a press`);
  }
  const screen = source("./AgentsScreen.tsx");
  assert.doesNotMatch(screen, /signTrade|goLive|tapEnable|tapStop|stopTrade|stopPilot|takeBack|stopAgent/, "the Agents screen advises: it never signs or stops");
  // «Stop» on a bot of the budget is one tap on its row, one at a time, on the bot's page; the stop itself is the city's own.
  const bots = source("../bots/Budget.tsx");
  assert.match(bots, /const stop = \(row: MineRow\) => \{\s*if \(stopping\) return;/);
  assert.doesNotMatch(bots, /signTrade|goLive|tapEnable|tapStop/, "the bots' page signs only through the card's own press");
  assert.match(source("./useAgentsData.ts"), /if \(!connection \|\| !row\.stop \|\| useMandate\.getState\(\)\.busy\) return null;/);
  for (const file of ["./Mine.tsx", "./NewAgent.tsx"]) assert.doesNotMatch(source(file), /stopAgent|tapStop|takeBack/, `${file} stops nothing itself`);
});

test("the practice kept in this browser shows only after hydration; the screen names no futures and promises no result", () => {
  assert.match(source("./NewAgent.tsx"), /return paper && mounted \? <TraderPaper/);
  const words = source("./words.ts");
  assert.match(words, /It does not trade futures\./);
  assert.match(words, /На ф’ючерсах він не торгує\./);
  assert.doesNotMatch(words, /profit|прибут|заробиш|you will earn|x\d/i);
});

/* ------------------------------------------------------------------------------------------------ No ceiling */

test("the new agent's budget is hers — the day, the trade and the term are her own fields; no ceiling, no preset", async () => {
  const { AGENTS } = await import("./words.ts");
  const card = readFileSync(new URL("./NewAgent.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(card, /PRESETS|presetFor|startsSmall|BUDGET_PRESETS|capped/u, "no budget of Ryntra's is offered or cut to");
  assert.match(card, /label=\{w\.budgetDay\}/u);
  assert.match(card, /label=\{w\.perTrade\}/u);
  assert.match(card, /label=\{w\.term\}/u);
  assert.match(card, /handyBudget\(spendRaw/u, "the handy values are shares of her own wallet");
  assert.match(card, /w\.giveSum\(budgetText\(budgetTotal\(budget\)/u, "the action says what the signature takes");
  // A field she empties stays hers: what follows from the day never writes over it (no «307 days» from «30» → «7»).
  assert.match(card, /own\.current\.trade = true;/u);
  assert.match(card, /own\.current\.days = true;/u);
  assert.doesNotMatch(card, /own\.current\.(trade|days) = (trade|days) !== ''/u);
  // The line before the signature breaks only between its parts.
  assert.match(card, /\.split\(' · '\)/u);
  // Before the signature, one line of her numbers and what stands under «the keys stay yours».
  assert.equal(AGENTS.uk.terms("1"), "До 1 SOL на день · вивести не може · стоп будь-коли");
  assert.equal(AGENTS.en.terms("1000"), "Up to 1000 SOL a day · it can’t withdraw · stop anytime");
  for (const lang of ["en", "uk"]) {
    assert.ok(AGENTS[lang].terms("0.125").length <= 64, lang);
    assert.doesNotMatch(Object.values(AGENTS[lang]).filter((v) => typeof v === "string").join(" "), /BONK|PUMP|WIF|0[.,]1 SOL/u, lang);
  }
});
