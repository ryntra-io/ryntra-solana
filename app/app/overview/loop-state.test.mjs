// Run from repo root: node --test app/app/overview/loop-state.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LOOP_ORDER,
  LOOP_STATE_LABEL,
  LOOP_STATE_TONE,
  loopStages,
} from "./loop-state.ts";

const read = (path) => readFileSync(new URL("../../../" + path, import.meta.url), "utf8");

test("the loop shows six stages in lifecycle order", () => {
  assert.deepEqual(
    [...LOOP_ORDER],
    ["plan", "readiness", "authorize", "execute", "receipt", "review"],
  );
  const stages = loopStages(new Date("2026-08-07T00:00:00.000Z"));
  assert.equal(stages.length, 6);
  assert.deepEqual(stages.map((stage) => stage.id), [...LOOP_ORDER]);
});

test("each stage reports the maturity of the capability it stands on", () => {
  /*
   * The point of the panel. Three stages are live on a supported route, two are
   * paper and the receipt ledger is not built — drawing six identical lit
   * stages would be prettier and would be the most misleading thing on a
   * signed-in page.
   */
  const byId = Object.fromEntries(
    loopStages(new Date("2026-08-07T00:00:00.000Z")).map((stage) => [stage.id, stage]),
  );

  assert.equal(byId.plan.state, "paper");
  assert.equal(byId.readiness.state, "live");
  assert.equal(byId.authorize.state, "live");
  assert.equal(byId.execute.state, "live");
  assert.equal(byId.receipt.state, "in_build");
  assert.equal(byId.review.state, "paper");

  // Every stage states its scope and carries the registry's own limitation.
  for (const stage of Object.values(byId)) {
    assert.ok(stage.scope.length > 0, `${stage.id} must state its scope`);
    assert.ok(stage.limitation.length > 10, `${stage.id} must carry its limitation`);
  }
});

test("a stage past its review window degrades on its own", () => {
  /* The same fail-closed rule the public site uses, and it matters more here: a
     signed-in operator is about to act, and a stage claiming to be live on
     expired evidence is the most expensive sentence on the page. */
  const aged = loopStages(new Date("2027-01-01T00:00:00.000Z"));
  assert.deepEqual(
    [...new Set(aged.map((stage) => stage.state))],
    ["re_verifying"],
    "no stage may survive its review window at full confidence",
  );
  for (const stage of aged) {
    assert.equal(LOOP_STATE_TONE[stage.state], "warn");
  }
});

test("colour carries meaning and every state has a label", () => {
  for (const state of Object.keys(LOOP_STATE_LABEL)) {
    assert.ok(LOOP_STATE_LABEL[state].length > 2, `${state} needs a label`);
    assert.ok(LOOP_STATE_TONE[state], `${state} needs a tone`);
  }
  // Only a genuinely live stage reads as confirmed.
  assert.equal(LOOP_STATE_TONE.live, "ok");
  assert.equal(LOOP_STATE_TONE.in_build, "idle");
  assert.equal(LOOP_STATE_TONE.after_gate, "idle");
});

test("the overview separates guest, failed wallet reads and unpriced assets", () => {
  /* Portfolio *is* the overview, and there is no separate Home to hold one.
     The three states this used to check on the Home dashboard are checked
     where they now live — on the holdings card, which is what
     `/app/portfolio` renders and what `/app` opens on. */
  const holdings = read("app/solana/workspace/holdings/holdings-card.tsx");
  assert.match(holdings, /useWalletData\(\)/);
  assert.match(holdings, /if \(!connection\)/);
  assert.match(holdings, /<WalletGate/);
  assert.match(holdings, /holdings\.status === "error"/);
  assert.match(holdings, /activity\.status === "error"/);
  assert.match(holdings, /holdings\.status === "ready" && holdings\.complete/);
  assert.doesNotMatch(holdings, /10000|paperSummary|paperBalance/);

  /* Saved plans moved with them: My strategies is their one home. The plans
     are the wallet's trading plans, read from `/api/v1/plans` only once the
     wallet has proved itself; a failed read is named with a retry, an empty
     list says where a plan starts, and nothing redirects. */
  const plans = read("app/app/strategies/plans/plans-panel.tsx");
  assert.doesNotMatch(plans, /\bredirect\(/);
  const guard = plans.indexOf("if (proven) void load();");
  const request = plans.indexOf('fetch("/api/v1/plans"');
  assert.ok(guard >= 0 && request >= 0, "the proof gates the read");
  assert.match(plans, /state\.status === "failed"/);
  assert.match(plans, /word\("tryAgain"\)/);
  assert.match(plans, /state\.plans\.length === 0/);
  assert.match(plans, /word\("startFromStock"\)/);
  assert.match(read("app/app/strategies/read.ts"), /if \(!subjectPresent\(input\.subject\)\) \{[\s\S]*?return/);
  assert.match(read("app/app/bots/page.tsx"), /<PlansPanel locale=\{locale\} \/>/);
});

test("the overview hands off to working pages and does not invent market advice", () => {
  /* The quick-action panel the Home dashboard carried is gone, and the eleven
     rail entries replaced it — every destination has a row of its own, which
     is a better answer than three links inside one panel. What must
     survive is the boundary: the overview offers destinations and never
     fabricates a market feed, a chat or a signature. */
  const holdings = read("app/solana/workspace/holdings/holdings-card.tsx");
  /* `mintHref` is the asset passport's one builder — `/app/assets?mint=…` —
     so a row opens asset detail rather than a hand-typed URL. */
  assert.match(holdings, /href=\{mintHref\(row\.holding\.mint\)\}/);
  assert.ok(holdings.includes('href={`/app/activity?action=${encodeURIComponent(action.actionId)}`}'),
    "an operation in flight must open its own row in Activity");
  assert.match(read("app/solana/workspace/assets/featured.ts"), /return `\/app\/assets\?mint=/);
  for (const invented of [/MarketPulse/, /getArcusMarkets/, /change24h/i, /priceChange/i, /<textarea/, /useChat\(/]) {
    assert.doesNotMatch(holdings, invented, "the overview must not fabricate a market feed or an unconnected chat");
  }
  for (const financialAction of [/signTransaction/, /sendTransaction/, /paperOpen\(/, /paperClose\(/]) {
    assert.doesNotMatch(holdings, financialAction, "the overview hands off; it does not sign or trade");
  }
});

test("the Home copy exists in every cabinet locale", () => {
  const copy = read("app/app/copy.ts");
  /* Three locales plus the type declaration. A missing locale would fall back
     to English mid-page, which reads as a bug rather than as a language. */
  assert.equal((copy.match(/^\s{4}home: \{$/gm) ?? []).length, 3);
  assert.equal((copy.match(/^\s{2}home: \{$/gm) ?? []).length, 1);
  // And the retired block is gone rather than left behind as a second source.
  assert.equal((copy.match(/^\s{4}overview: \{$/gm) ?? []).length, 0);
});
