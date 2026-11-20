import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bookOf, parse } from "../../city/lib/command/parse.ts";
import { targetOf } from "../shell/ask-route.ts";
import { SHELVES, shelfOn, takenByTerminal } from "../shell/shelves.ts";
import { digits } from "../../city/lib/i18n/dict.ts";
import { agentsHeld, mayClose, tinyPrice, unitsFigure } from "./portfolio-view.ts";
import { PORTFOLIO } from "./words.ts";

/* The Portfolio's older rules the new screen still stands on — what the agents hold, a coin amount for the eye, when a
   panel may close — and that the agent's line leads «what do I have» here. The groups, the total and the three actions
   are held by all.test.mjs. */

const budget = (account, lamports) => ({ account, lamports });
const record = (policy, budgetAccount) => ({ owner: "o", settings: "s", vault: "v", policy, budget: budgetAccount, perTrade: "1", perDay: "100000000", expiresAt: "9" });
const trader = (policy, budgetAccount) => ({ key: `trader:${policy}`, role: "trader", stop: { record: record(policy, budgetAccount) } });

test("the agents hold their budgets at SOL's price and the pools the keeper looks after — one budget account counted once", () => {
  const rows = [trader("p1", "b1"), trader("p2", "b1"), trader("p3", "b3"), { key: "keeper:c1", role: "keeper", stop: { care: "c1" } }, { key: "pilot", role: "pilot", stop: null }];
  const budgets = new Map([
    ["p1", budget("b1", "500000000")],
    ["p2", budget("b1", "500000000")],
    ["p3", budget("b3", null)],
  ]);
  const held = agentsHeld({ rows, budgets, cares: new Map([["c1", 42.5]]), solUsd: 100, counted: true });
  assert.deepEqual(
    held.rows.map((row) => row.usd),
    [50, null, null, 42.5, null],
  );
  assert.equal(held.usd, 92.5);
  // A practice network: shown, never added.
  const practice = agentsHeld({ rows, budgets, cares: new Map([["c1", 42.5]]), solUsd: 100, counted: false });
  assert.equal(practice.usd, null);
  assert.ok(practice.rows.every((row) => row.usd === null));
  // No SOL price: a budget is not priced.
  assert.equal(agentsHeld({ rows: [trader("p1", "b1")], budgets, cares: new Map(), solUsd: null, counted: true }).usd, null);
  // No agent at work: nothing held.
  assert.equal(agentsHeld({ rows: [], budgets, cares: new Map(), solUsd: 100, counted: true }).usd, 0);
});

test("a coin amount for the eye: large ones whole, one coin or more to the cent, small ones to four digits", () => {
  assert.equal(unitsFigure(4_200_000), "4,200,000");
  assert.equal(unitsFigure(135.6), "135.60");
  assert.equal(unitsFigure(1.5), "1.50");
  assert.equal(unitsFigure(0.30264), "0.3026");
  assert.equal(unitsFigure(0.0000425), "0.0000425");
  assert.equal(unitsFigure(0), "0");
});

test("a tiny price folds its zeros as the chart writes it (QA 19.11): $0.000001036 → $0.0₅1036; a cent and more is the terminal's own", () => {
  assert.equal(tinyPrice(0.000001036), "$0.0₅1036");
  assert.equal(tinyPrice(0.00000486), "$0.0₅486");
  assert.equal(tinyPrice(4.2e-11), "$0.0₁₀42", "however small, its figures stay");
  assert.equal(digits(tinyPrice(0.000001036), "uk"), "$0,0₅1036");
  assert.equal(tinyPrice(0.0002293), null, "three zeros read as they are");
  assert.equal(tinyPrice(0.009035), null);
  assert.equal(tinyPrice(74.77), null);
  assert.equal(tinyPrice(0), null);
  assert.equal(tinyPrice(Number.NaN), null);
});

test("the panel in front never closes while money is mid-way", () => {
  assert.equal(mayClose({ trade: true, phase: "idle", held: false, moneyBusy: false }), true);
  assert.equal(mayClose({ trade: true, phase: "done", held: false, moneyBusy: false }), true);
  for (const phase of ["preparing", "wallet", "sending", "checking", "unknown"]) assert.equal(mayClose({ trade: true, phase, held: false, moneyBusy: false }), false, phase);
  assert.equal(mayClose({ trade: true, phase: "idle", held: true, moneyBusy: false }), false);
  assert.equal(mayClose({ trade: false, phase: "idle", held: false, moneyBusy: true }), false);
  assert.equal(mayClose({ trade: false, phase: "wallet", held: false, moneyBusy: false }), true, "another panel does not wait on the ticket");
});

test("«my portfolio», «what do I have» and the history lead here; a question about paying stays a question", () => {
  const book = bookOf([]);
  const read = (text) => parse(text, book, { subject: null });
  for (const said of ["мій портфель", "що в мене", "Що в мене є?", "скільки в мене грошей", "що в моєму гаманці", "my portfolio", "what do I have", "what's in my wallet", "history"]) {
    assert.deepEqual(targetOf(read(said)), { shelf: "portfolio", mint: null }, said);
  }
  assert.equal(read("what do I have to pay?").kind, "ask");
  assert.equal(read("що в мене за монета").kind, "ask");
});

test("the shelf is on, at its own address, and takes it back from the city once the terminal opens", () => {
  assert.equal(SHELVES.portfolio.ready, true);
  assert.equal(SHELVES.portfolio.path, "/portfolio");
  assert.equal(shelfOn("portfolio", "closed"), false, "with the switch closed nothing of it is drawn");
  assert.equal(shelfOn("portfolio", "stand"), true);
  assert.equal(takenByTerminal({ source: "/portfolio" }, "closed"), false);
  assert.equal(takenByTerminal({ source: "/portfolio" }, "open"), true);
});

test("both languages say the same things, and the screen writes no words of its own", () => {
  assert.deepEqual(Object.keys(PORTFOLIO.uk).sort(), Object.keys(PORTFOLIO.en).sort());
  assert.equal(PORTFOLIO.uk.topUp, "Поповнити");
  assert.equal(PORTFOLIO.uk.soon, "Скоро", "the private balance stays as the approved design draws it: «Soon»");
  // The city's words for a pier or a tower never stand on the terminal's portfolio.
  const said = JSON.stringify(PORTFOLIO.uk) + JSON.stringify(PORTFOLIO.en);
  assert.doesNotMatch(said, /причал|вежа|pier|tower/i);
  const page = readFileSync(new URL("../../app/(terminal)/portfolio/page.tsx", import.meta.url), "utf8");
  assert.match(page, /shelfOn\("portfolio"\)/, "the page answers 404 while the shelf is off");
});
