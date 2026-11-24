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
import { agentCommand, agentRow, crewOpen, planRecurring } from "./read.ts";
import { REFUSAL, refusalLine, refusalOf } from "./refusal.ts";
import { planAnswer } from "../shell/ask-route.ts";
import { COIN_REFUSED, readCoin, TOKEN_2022_PROGRAM_ID } from "../../lib/mandate/token-2022.ts";
import { antMintData, hooked, paused, startsFrozen } from "../../lib/mandate/fixtures/stock-mint.mjs";
import { PublicKey } from "@solana/web3.js";
import { keeperRows, mandateLive, pastAgents, pilotRecord, pilotRow, tradeHistory, traderRecords, traderRow, traderRows, traderState, workerPath } from "./rows.ts";
import { signOnce, signOnceShown } from "./sign-once.ts";
import { AGENTS } from "./words.ts";

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

test("the header's line puts the agent's job first: a budget a day opens the AI trader's plan on the Agents shelf", () => {
  const rows = askRows("Торгуй BONK на 0,1 SOL на день", BOOK, NONE, ALL, EVERY_GATE);
  assert.equal(rows[0].command.kind, "autopilot");
  assert.deepEqual(rows[0].target, { shelf: "agents", mint: null, path: "/agent?ai=trader" }, "a budget a day is the AI trader's plan — never a bot's card");
  assert.equal(askHref(rows[0].target, "live"), "/agent?ai=trader");
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
  assert.equal(hireOf("trader").path, "/agent?ai=trader");
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

test("a pool stopped but not withdrawn stays as its own row with «Withdraw»; once all is back it goes", () => {
  const day = { claimedInY: 0.5, reinvestedInY: 0, rebalances: 0 };
  const care = (key, status, left) => ({ key, pool: "Pool", status, inRange: null, day, ...(left === undefined ? {} : { left }) });
  const rows = keeperRows([care("live", "stopped", true), care("back", "stopped", false), care("unread", "stopped", null), care("before", "stopped")]);
  assert.deepEqual(rows.map((row) => row.key), ["keeper:live"], "only the one whose rules or money the chain still carries");
  const [left] = rows;
  assert.equal(left.left, true);
  assert.equal(left.state, "stopped");
  assert.equal(left.pool, null, "no «Earning» for a pool no one looks after");
  assert.equal(left.result, null, "nothing works today: no figure of the day");
  assert.deepEqual(left.stop, { care: "live" }, "its «Withdraw» is the same stop and take back");
  assert.equal(left.poolAddress, "Pool", "its pool's page carries the same «Withdraw»");
  // A working pool keeps its row exactly as before.
  const working = keeperRows([{ ...care("w", "working"), inRange: true }])[0];
  assert.equal(working.left, undefined);
  assert.equal(working.state, "working");
  // The words, both languages, the same keys; the screen says them.
  for (const key of ["notWithdrawn", "withdraw"]) {
    assert.equal(typeof AGENTS.en[key], "string", key);
    assert.equal(typeof AGENTS.uk[key], "string", key);
  }
  assert.equal(AGENTS.en.notWithdrawn, "Stopped — not withdrawn");
  assert.equal(AGENTS.uk.notWithdrawn, "Зупинено — не забрано");
  assert.equal(AGENTS.en.withdraw, "Withdraw");
  assert.equal(AGENTS.uk.withdraw, "Забрати");
  const mine = readFileSync(new URL("./Mine.tsx", import.meta.url), "utf8");
  assert.match(mine, /row\.left \? w\.withdraw : w\.stop/u, "the row's own button says «Withdraw»");
  assert.match(mine, /if \(row\.left\) return w\.notWithdrawn;/u);
});

test("the engine refused the wallet for want of this device's proof (401) — «Sign once» stands in place of an empty list", () => {
  const at = { owner: "Owner", served: true, locked: true, answered: false };
  assert.equal(signOnceShown(at), true, "a new device: the engine said 401");
  assert.equal(signOnceShown({ ...at, owner: null }), false, "no wallet: the screen keeps its «Connect»");
  assert.equal(signOnceShown({ ...at, served: false }), false, "agents not served here");
  assert.equal(signOnceShown({ ...at, locked: false }), false, "not refused: the list, or «none», is the truth");
  assert.equal(signOnceShown({ ...at, answered: true }), false, "the engine answered since: its rows stand");
  for (const key of ["signOnce", "signOnceAction", "signOnceHow", "signOnceText", "signOnceNo", "signOnceFailed"]) {
    assert.equal(typeof AGENTS.en[key], "string", key);
    assert.equal(typeof AGENTS.uk[key], "string", key);
  }
  assert.equal(AGENTS.en.signOnce, "Sign once to see your agents");
  assert.equal(AGENTS.uk.signOnce, "Підпиши раз, щоб побачити своїх агентів");
  // «My bots» on a desk and on a phone put the card where «None of these running yet» would stand.
  const mine = readFileSync(new URL("./Mine.tsx", import.meta.url), "utf8");
  assert.match(mine, /\) : locked \? null : \(\s*<p className=\{a\.empty\}>/u);
  assert.match(mine, /<SignOnce owner=\{owner\} variant="row" \/>/u);
  assert.match(mine, /<SignOnce owner=\{owner\} variant="card" \/>/u);
  // The agent's own page waits on no read that will never come.
  const pulse = readFileSync(new URL("./drive/PulseScreen.tsx", import.meta.url), "utf8");
  assert.ok(pulse.indexOf("sign.shown") < pulse.indexOf("} else if (reading)"), "the card before the bones");
});

test("«Sign once» — one signed message, then the list is read again; a no or a silent wallet changes nothing", async () => {
  const run = async (prove, read = async () => ({ owner: "Owner" })) => {
    const calls = [];
    const said = await signOnce({
      refresh: async () => calls.push("refresh"),
      prove: async () => (calls.push("prove"), prove),
      forget: () => calls.push("forget"),
      read: async () => (calls.push("read"), read()),
    });
    return { said, calls };
  };
  const signed = await run({ ok: true });
  assert.equal(signed.said, "idle", "after the signature the list is read");
  assert.deepEqual(signed.calls, ["refresh", "prove", "forget", "read"], "the proof read afresh, then the message, then the engine asked again at once");
  const declined = await run({ ok: false, state: "declined" });
  assert.equal(declined.said, "declined");
  assert.deepEqual(declined.calls, ["refresh", "prove"], "not signed: nothing asked of the engine");
  assert.equal((await run({ ok: false, state: "failed" })).said, "failed");
  assert.equal((await run({ ok: true }, async () => null)).said, "failed", "signed, but the engine still said nothing: try again");
  const thrown = await signOnce({ refresh: async () => { throw new Error("offline"); }, prove: async () => { throw new Error("gone"); }, forget: () => {}, read: async () => ({}) });
  assert.equal(thrown, "failed");
  // The wallet signs a message, never a transaction; the card asks only on its tap.
  const card = readFileSync(new URL("./SignOnce.tsx", import.meta.url), "utf8");
  assert.match(card, /prove: \(\) => proveWallet\(connection\)/u);
  assert.doesNotMatch(card, /signTransaction|sendTransaction|signAll/u);
  assert.doesNotMatch(card, /useEffect/u, "nothing asks the wallet at a visit");
});

test("a bot at work is managed on its own page: Recurring buys and the money autopilot under «Bots», the keeper's pools on Earn", () => {
  assert.equal(workerPath("trader"), "/bots/recurring");
  assert.equal(workerPath("pilot"), "/bots/autopilot");
  assert.equal(workerPath("keeper"), "/earn");
  // The keeper on its pool's page, whose ticket carries the care and its «Stop and take it back».
  assert.equal(workerPath("keeper", "Pool"), "/pool/Pool");
  assert.equal(keeperRows([{ key: "a", pool: "Pool", status: "working", inRange: true, day: { claimedInY: 0, reinvestedInY: 0, rebalances: 0 } }])[0].poolAddress, "Pool");
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
  // The line before the signature breaks only between its parts (its own component, `Limit.tsx`).
  assert.match(readFileSync(new URL("./Limit.tsx", import.meta.url), "utf8"), /\.split\(' · '\)/u);
  // Before the signature, one line of her numbers and what stands under «the keys stay yours» — the risk's edge.
  assert.equal(AGENTS.uk.terms("1", "30,02"), "Витратить не більше 1 SOL на день і 30,02 SOL усього · вивести не може · стоп будь-коли");
  assert.equal(AGENTS.en.terms("1000", "30000.5"), "Spends at most 1000 SOL a day, 30000.5 SOL in all · it can’t withdraw · stop anytime");
  for (const lang of ["en", "uk"]) {
    // The first part carries the sum and may wrap; the short ones after it never break inside.
    assert.ok(AGENTS[lang].terms("0.125", "3.77").length <= 96, lang);
    assert.doesNotMatch(Object.values(AGENTS[lang]).filter((v) => typeof v === "string").join(" "), /BONK|PUMP|WIF|0[.,]1 SOL/u, lang);
  }
});


const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const STOCK_BOOK = bookOf([tower(BONK, "BONK", 9e8), tower(JUP, "JUP", 8e8), tower(TSLAX, "TSLAx", 7e8)]);

test("«buy TSLAx every week for $50» is Recurring buys on a week, the sum and the coin — never a one-off buy", () => {
  for (const said of ["buy TSLAx every week for $50", "купуй TSLAx щотижня на $50"]) {
    const [first, second] = askRows(said, STOCK_BOOK, NONE, ALL, EVERY_GATE);
    assert.equal(first.target.path, "/bots/recurring", said);
    assert.equal(first.command.kind, "instruct", said);
    assert.deepEqual({ coin: first.command.instruction.coin?.mint, usd: first.command.instruction.usd, cadence: first.command.instruction.cadence }, { coin: TSLAX, usd: "50", cadence: "weekly" }, said);
    assert.equal(askHref(first.target, "live"), "/bots/recurring");
    // The one-off buy stays a row below, for the person who meant it.
    assert.equal(second?.command.kind, "buy", said);
  }
  assert.equal(askLabel(askRows("buy TSLAx every week for $50", STOCK_BOOK, NONE, ALL, EVERY_GATE)[0].command, "en"), "Recurring buys · TSLAX · $50 a week");
  assert.equal(askLabel(askRows("купуй TSLAx щотижня на $12.5", STOCK_BOOK, NONE, ALL, EVERY_GATE)[0].command, "uk"), "Регулярні покупки · TSLAX · $12,5 на тиждень");
  assert.equal(askLabel(askRows("Купуй акцію щотижня", STOCK_BOOK, NONE, ALL, EVERY_GATE)[0].command, "uk"), "Регулярні покупки · на тиждень");
  // A sum in SOL rides the sentence: the bot's page reads it again.
  const sol = askRows("buy JUP every day for 0.1 SOL", STOCK_BOOK, NONE, ALL, EVERY_GATE)[0];
  assert.equal(sol.target.path, "/bots/recurring");
  assert.equal(sol.command.instruction.said, "buy JUP every day for 0.1 SOL");
  // Where the mandate's engine is shut, no bot is opened: the line reads the sentence as before.
  const shut = askRows("buy TSLAx every week for $50", STOCK_BOOK, NONE, ALL, { ...EVERY_GATE, agentTrade: false })[0];
  assert.equal(shut.command.kind, "buy");
  // A budget a day said to trade is still the trader's card, and buying SOL itself on a rhythm is no bot's.
  assert.equal(askRows("Торгуй BONK на 0,1 SOL на день", STOCK_BOOK, NONE, ALL, EVERY_GATE)[0].command.kind, "autopilot");
  assert.notEqual(askRows("buy SOL every week for $20", STOCK_BOOK, NONE, ALL, EVERY_GATE)[0]?.target.path, "/bots/recurring");
});

test("the model's regular purchase opens Recurring buys too — with the digits the person typed", () => {
  const draft = { understood: true, ask: "none", action: "dca", coin: "TSLAx", cadence: "weekly", numbers: [{ name: "usd", value: 50 }] };
  const answer = planAnswer(draft, "every Monday put fifty… no, $50 into TSLAx", STOCK_BOOK, ALL, EVERY_GATE);
  assert.equal(answer?.kind, "row");
  assert.equal(answer.row.target.path, "/bots/recurring");
  assert.equal(answer.row.command.instruction.usd, "50");
  // A number the person did not type is not the sum.
  const invented = planAnswer({ ...draft, numbers: [{ name: "usd", value: 70 }] }, "buy TSLAx every week for $50", STOCK_BOOK, ALL, EVERY_GATE);
  assert.equal(invented.row.command.instruction.usd, null);
  // SOL bought on a rhythm is no bot's; with the engine shut, no plan opens the bot.
  assert.equal(planRecurring({ action: "dca", said: "x", coin: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL" }, usd: "5", cadence: "daily" }, EVERY_GATE), null);
  assert.equal(planRecurring({ action: "dca", said: "x", coin: null, usd: "5", cadence: "daily" }, { ...EVERY_GATE, agentTrade: false }), null);
});

/** The engine's own reasons for a stop before the wallet, as its source writes them (`lib/mandate/**`, read, never changed). */
function engineReasons() {
  const mandate = (name) => readFileSync(new URL(`../../lib/mandate/${name}`, import.meta.url), "utf8");
  const coin = mandate("token-2022.ts");
  const service = mandate("service.server.ts");
  const strings = (text) => [...text.matchAll(/"([^"\n]{8,})"/g)].map((match) => match[1]);
  // Every refusal of a coin: the features' table, the three lines kept as names, the plain refusals.
  const table = coin.slice(coin.indexOf("const REFUSED"), coin.indexOf("]);", coin.indexOf("const REFUSED")));
  const named = [...coin.matchAll(/^const (?:HIDDEN|FREEZABLE|STARTS_FROZEN) = "([^"]+)";/gm)].map((match) => match[1]);
  const plain = [...coin.matchAll(/refused\("([^"]+)"\)/g)].map((match) => match[1]);
  const coins = [...strings(table), ...named, ...plain].map((reason) => `The agent does not trade this coin: ${reason}.`);
  // The review's own lines, before a signature: the coin read for the budget, and the budget itself.
  const review = service.slice(service.indexOf("export async function coinForBudget"), service.indexOf("export async function", service.indexOf("export async function reviewEnable") + 10));
  const lines = [...review.matchAll(/reason: ([^}]+)\}/g)].flatMap((match) => strings(match[1]));
  return { coins, lines };
}

test("every reason the engine stops a budget with before the wallet is said in Ukrainian and English — none in the engine's English", () => {
  const { coins, lines } = engineReasons();
  assert.ok(coins.length >= 12 && lines.length >= 8, "the engine's reasons were read");
  // «The mandate is not written» is the engine failing to build the transaction: the plain «stopped before your wallet».
  const known = [...coins, ...lines.filter((line) => line !== "The mandate is not written."), "Not a budget: a trade is at most the day.", "Another wallet.", "The budget is not the one shown.", "The wallet changed the transaction.", "A program outside the mandate."];
  for (const reason of known) {
    assert.ok(refusalOf(reason), `a reason the screen does not know: «${reason}»`);
    const uk = refusalLine(reason, "uk");
    assert.match(uk, /[а-яіїєґ]/u, reason);
    assert.doesNotMatch(uk.replace(/Ryntra/gu, ""), /[a-z]{3,}/iu, `Ukrainian with no English left: ${uk}`);
    assert.doesNotMatch(refusalLine(reason, "en"), /Token-2022|router|mint|epoch|program/iu, "nothing technical");
  }
  // A transfer fee keeps its figures, in the language's own way.
  const fee = `${COIN_REFUSED}it takes 2.5% on every transfer, above the 1% the agent pays`;
  assert.equal(refusalLine(fee, "uk"), "Бот не купує цю монету: вона бере 2,5% з кожного переказу — більше за 1%, які платить бот.");
  // A sentence the screen does not know — or none — is the plain line, never the English text.
  assert.equal(refusalLine("Something new in the engine.", "uk"), null);
  assert.equal(refusalLine(undefined, "en"), null);
  for (const lang of ["en", "uk"]) assert.doesNotMatch(Object.values(REFUSAL[lang]).filter((v) => typeof v === "string").join(" "), /profit|прибут|guarantee|гарант/iu, lang);
});

test("the engine's real refusal of a coin reads as the screen's line", () => {
  const mint = new PublicKey("ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe");
  const info = { owner: TOKEN_2022_PROGRAM_ID, data: antMintData() };
  for (const data of [info.data, paused(info.data), hooked(info.data), startsFrozen(info.data)]) {
    const reading = readCoin(mint, { ...info, data });
    assert.equal(reading.ok, false);
    const reason = `${reading.reason.charAt(0).toUpperCase()}${reading.reason.slice(1)}.`;
    assert.ok(refusalLine(reason, "uk"), reason);
  }
});

test("the stop before the wallet carries the engine's reason to the screen, and the bots' page says it", () => {
  const sign = readFileSync(new URL("../../city/lib/bots/mandate-sign.ts", import.meta.url), "utf8");
  assert.match(sign, /say\(\{ kind: result\.kind, at: Date\.now\(\), \.\.\.\(result\.kind === 'refused' \? \{ reason: result\.reason \} : \{\}\) \}\)/u);
  const page = readFileSync(new URL("../bots/Budget.tsx", import.meta.url), "utf8");
  assert.match(page, /note\.kind === 'refused' \? refusalLine\(note\.reason, lang\) : null/u);
});

test("the Agents screen — the one action always lit, no small grey line over the name, the coin in focus under the analyst", () => {
  const screen = source("./AgentsScreen.tsx");
  assert.match(screen, /<Action full=\{false\} busy=\{asking\} disabled=\{asking\} onClick=\{press\}/u, "«Ask» is never pale while nothing is typed");
  assert.match(screen, /else field\.current\?\.focus\(\);/u, "with nothing typed it puts the cursor in the field");
  assert.doesNotMatch(screen, /<Kick>/u, "no small grey label over the analyst or the coins");
  assert.match(screen, /<CoinFocus tower=\{focus\} \/>/u);
  const words = source("./words.ts");
  assert.doesNotMatch(words, /analystKick/u);
  // The stock's example names no ticker and no sum (decision 108).
  assert.match(words, /sayStockWeekly: 'Buy a stock every week'/u);
  assert.match(words, /sayStockWeekly: 'Купуй акцію щотижня'/u);
});


test("the agent's ticket says the risk's edge before any signature — the day's most, no withdrawal, a stop", () => {
  const parts = { en: [/at most/u, /can’t withdraw/u, /stop anytime/u], uk: [/не більше/u, /вивести не може/u, /стоп будь-коли/u] };
  for (const lang of ["en", "uk"]) {
    const sum = AGENTS[lang].terms("0,5", "15,02");
    assert.match(sum, /0,5 SOL/u, `${lang}: her own day`);
    assert.match(sum, /15,02 SOL/u, `${lang}: the whole the signature takes`);
    for (const line of [sum, AGENTS[lang].termsAny]) {
      assert.equal(line.split(" · ").length, 3, `${lang}: three parts`);
      for (const part of parts[lang]) assert.match(line, part, lang);
    }
    assert.doesNotMatch(AGENTS[lang].termsAny, /\d/u, `${lang}: before she writes a day, no sum of Ryntra's`);
  }
  const card = source("./NewAgent.tsx");
  assert.match(card, /<Limit budget=\{budget\} \/>/u, "the edge stands before a budget is written, too");
  assert.match(source("./Limit.tsx"), /budgetText\(budgetTotal\(budget\), lang\)/u, "the whole, as the action signs it");
  const limit = source("./Limit.tsx");
  assert.match(limit, /className=\{a\.limit\} data-agent-terms=""/u);
  const css = source("./agents.module.css");
  const rule = css.slice(css.indexOf(".limit {"), css.indexOf("}", css.indexOf(".limit {")));
  assert.match(rule, /var\(--type-base\)/u, "big: the card's body type");
  assert.match(rule, /color: var\(--ice\)/u, "never the caption's grey");
});

test("with no wallet the ticket offers «Practice first» first, then «Connect and give the budget» — the wallet last", () => {
  for (const lang of ["en", "uk"]) assert.equal(typeof AGENTS[lang].connectSign, "string", lang);
  assert.equal(AGENTS.uk.connectSign, "Підключити й дати бюджет");
  const card = source("./NewAgent.tsx");
  const branch = card.slice(card.indexOf("{needsCoin && !owner ? ("), card.indexOf(") : (", card.indexOf("{needsCoin && !owner ? (")));
  assert.ok(branch.length > 0);
  const practice = branch.indexOf("w.practice");
  const connect = branch.indexOf("w.connectSign");
  assert.ok(practice > 0 && connect > practice, "practice first, the wallet after it");
  assert.match(branch, /<Action onClick=\{\(event\) => \(coin && budget \? practise\(\) : focusField\(event\)\)\}/u, "practice needs no wallet: on paper in this browser");
  assert.match(branch, /<ConnectOnly \/>/u, "what connecting does, beside the step");
  // A wallet asked for anywhere else in the ticket says the whole step, too.
  assert.match(card, /\{w\.connectSign\}\n\s*<\/Action>\n\s*<ConnectOnly \/>/u);
  assert.match(source("./paper/PaperWeek.tsx"), /\{aw\.connectSign\}/u);
});

test("«Practice first» is a moment of the funnel on every card that offers it, the wallet's or none", () => {
  const card = source("./NewAgent.tsx");
  assert.match(card, /function practise\(\): void \{\n  funnelSay\('agent_practice'\);\n  startPaper\(\);/u);
  assert.equal(card.match(/funnelSay\('agent_practice'\)/gu)?.length, 3, "no wallet, the week on paper, the money autopilot");
});

test("the edge looks the same on every card: the money autopilot says it as the trader's does, never in a small grey line", () => {
  const card = source("./NewAgent.tsx");
  assert.doesNotMatch(card, /className=\{a\.cap\}>\{w\.pilotRisk\}/u);
  assert.match(card, /<Edge text=\{w\.pilotRisk\} \/>/u);
  assert.match(card, /<Edge text=\{ask\.solRaw \? w\.pilotEdge\(budgetText\(BigInt\(ask\.solRaw\), lang\)\) : w\.pilotRisk\} \/>/u);
  for (const lang of ["en", "uk"]) {
    for (const line of [AGENTS[lang].pilotRisk, AGENTS[lang].pilotEdge("2")]) assert.equal(line.split(" · ").length, 3, `${lang}: ${line}`);
    assert.match(AGENTS[lang].pilotEdge("2"), /2 SOL/u);
  }
  // A line breaks only before a «·»: each short part keeps its dot in front of it.
  assert.match(source("./Limit.tsx"), /\{at \? `·\\u00a0\$\{part\}` : part\}/u);
});

/* ------------------------------------------------------------------------------------------------ the AI trader */

test("«Trade JUP every day» opens the AI trader's plan: the agent's card on the Agents shelf, never the bot's", () => {
  for (const said of ["Trade JUP every day", "Торгуй JUP щодня", "trade JUP for me, 1 SOL a day"]) {
    const row = askRows(said, BOOK, NONE, ALL, EVERY_GATE)[0];
    assert.equal(row.command.kind, "autopilot", said);
    assert.equal(askHref(row.target, "live"), "/agent?ai=trader", said);
  }
  // A regular purchase on a schedule is a rule — the bot's page, as before.
  assert.equal(askRows("buy JUP every day for 0.1 SOL", BOOK, NONE, ALL, EVERY_GATE)[0].target.path, "/bots/recurring");
  const page = readFileSync(new URL("../../app/(terminal)/agent/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(ai === "trader"\) return <TraderScreen \/>;/u);
  const screen = source("./TraderScreen.tsx");
  assert.match(screen, /<RecurringBot lay=\{botDesk\} agent \/>/u, "the card and its engine are the bot's own, in the agent's place");
  assert.match(screen, /<AgentTabs value="trader" \/>/u);
  const budget = readFileSync(new URL("../bots/Budget.tsx", import.meta.url), "utf8");
  assert.match(budget, /\{ head: \{ title: aw\.aiTraderTitle, job: MANDATE_EXIT \? aw\.aiTraderJob : aw\.aiTraderJobBuys, kick: aw\.newAiAgent, icon: 'aiTrader' \}, exit: true \}/u, "the agent's name, kick, mark and what it does over the plan — «sells on its own» only where the agent may sell");
  assert.match(budget, /onStop=\{stop\} agent=\{agent\} \/>/u, "«My agents» under the agent's plan");
  for (const lang of ["en", "uk"]) for (const key of ["aiTraderTitle", "aiTraderJob", "aiTraderJobBuys", "noteOnAgent", "newAiAgent", "mineAgents", "noAiAgents", "connectToSeeAgents"]) assert.equal(typeof AGENTS[lang][key], "string", `${lang}.${key}`);
  assert.equal(AGENTS.uk.aiTraderTitle, "AI-трейдер");
  // The bot's own line stays the bot's: «Recurring buys» buys a coin by itself, on a budget a day.
  assert.equal(AGENTS.en.traderJob, "Buys a coin by itself, on your budget a day");
});

test("the Agents shelf's tabs: the AI trader, the Scout, the analyst — the menu's own items, ready", async () => {
  const { MENU } = await import("../shell/menu.ts");
  const agents = MENU.find((group) => group.id === "agents");
  assert.equal(agents.items.find((item) => item.id === "aiTrader")?.ready, true);
  const tabs = source("./scout/AgentTabs.tsx");
  assert.match(tabs, /trader: '\/agent\?ai=trader'/u);
  assert.match(tabs, /\.\.\.\(traderReady\(\) \? \[\{ id: 'trader' as const, label: w\.trader \}\] : \[\]\)/u);
});
