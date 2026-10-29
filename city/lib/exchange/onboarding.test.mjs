import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { accountKind } from "./account.ts";
import { onboardingOf, ONBOARDING_WORDS, PHOENIX_URL } from "./onboarding.ts";
import { account, NO_ACCOUNT } from "./test-fixtures.mjs";

const ready = (value) => ({ status: "ready", value, at: 1 });

test("the one step before a first trade: the wallet, then a Phoenix account — and nothing once there is one", () => {
  assert.deepEqual(onboardingOf(accountKind(false, ready(null))), { step: "connect" });
  assert.deepEqual(onboardingOf(accountKind(true, ready(NO_ACCOUNT))), { step: "open", where: "phoenix" });
  assert.deepEqual(onboardingOf(accountKind(true, ready(account({ state: "uninitialized" })))), { step: "open", where: "phoenix" });
  assert.deepEqual(onboardingOf(accountKind(true, ready(account({ state: "frozen" })))), { step: "wait" });
  for (const state of ["active", "cold", "reduceOnly", "unknown"]) assert.equal(onboardingOf(accountKind(true, ready(account({ state })))), null, state);
  // Still reading, or Phoenix silent: no step is claimed.
  assert.equal(onboardingOf(accountKind(true, { status: "loading", value: null, at: null })), null);
  assert.equal(onboardingOf(accountKind(true, { status: "failed", value: null, at: null })), null);
});

test("the account opens where Phoenix opens it, said honestly in one title and one short line", () => {
  assert.equal(PHOENIX_URL, "https://phoenix.trade");
  assert.match(ONBOARDING_WORDS.open.title, /Open a Phoenix account/);
  assert.match(ONBOARDING_WORDS.open.line, /invite/);
  assert.match(ONBOARDING_WORDS.open.action, /phoenix\.trade/);
  for (const [step, words] of Object.entries(ONBOARDING_WORDS)) {
    assert.ok(words.line.length <= 40 && !words.line.includes(". "), step);
    // The clean interface rule of 28.10: no technical words on screen.
    assert.doesNotMatch(`${words.title} ${words.line} ${words.action} ${words.detail}`, /engine|route|API|builder|register|PDA|subaccount|code/i, step);
  }
});

test("the invitation step: one line and one action on screen, the rest behind one «Details»", () => {
  const panel = readFileSync(new URL("../../components/exchange/Account.tsx", import.meta.url), "utf8");
  const step = panel.slice(panel.indexOf("function OpenAccount"), panel.indexOf("export function ConnectCard"));
  assert.match(step, /aria-expanded=\{details\}/);
  // «Check again» stands in the open step only behind «Details»; waiting for access has nothing else to do.
  assert.match(step, /\{details && \(/);
  assert.ok(ONBOARDING_WORDS.open.detail.length > 0 && ONBOARDING_WORDS.open.detail.length <= 100);
});

test("without an account to trade from, the size's slider and chips stay still", () => {
  const ticket = readFileSync(new URL("../../components/exchange/Ticket.tsx", import.meta.url), "utf8");
  assert.equal(ticket.match(/disabled=\{busy \|\| !connection \|\| !opensFrom\(kind\)\}/g)?.length, 2);
});

test("the engine opens no account: the city builds no transaction of its own for it", () => {
  // The step stays honest until the engine has its onboarding route: nothing in the city asks for one.
  const engine = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
  assert.doesNotMatch(engine, /register|onboard|activate/i);
});
