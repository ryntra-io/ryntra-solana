import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { tabsShown } from "../money-view.ts";
import { issueTone, payoutsOpen, reportName, reportWords, shownIssue, whoText } from "./payouts-view.ts";
import { PAYOUTS } from "./words.ts";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path) => readFileSync(join(REPO, path), "utf8");
/** The code without its comments: what it does, not what it says about itself. */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

test("«Payouts» stands only with the private balance open; without it «Money» is as it was", () => {
  assert.equal(payoutsOpen("devnet"), true);
  for (const flag of [undefined, "", "mainnet", "open", "DEVNET"]) assert.equal(payoutsOpen(flag), false, String(flag));
  assert.deepEqual(tabsShown(true), ["send", "receive", "invoices"]);
  assert.deepEqual(tabsShown(true, true), ["send", "receive", "invoices", "payouts"]);
  assert.deepEqual(tabsShown(false, true), ["receive", "invoices", "payouts"]);
  const screen = read("terminal/money/MoneyScreen.tsx");
  assert.match(screen, /tabsShown\(sends, payoutsOpen\(\)\)/, "the tab is behind the flag");
  assert.match(screen, /tab === 'payouts' \? \(\s*<Payouts onConnect=\{connect\} feeSetting=\{payoutFee\} \/>/);
});

test("a line shows what stops it first, then what to look at, then what is only said", () => {
  assert.equal(shownIssue({ issues: ["new", "duplicate"] }), "duplicate");
  assert.equal(shownIssue({ issues: ["new", "noPrivate", "small"] }), "small");
  assert.equal(shownIssue({ issues: ["new"] }), "new");
  assert.equal(shownIssue({ issues: [] }), null);
  assert.equal(issueTone("address"), "stop");
  assert.equal(issueTone("duplicate"), "ask");
  assert.equal(issueTone("new"), "note");
  assert.equal(whoText({ name: "Oleh", to: null, address: null }), "Oleh");
  assert.equal(whoText({ name: null, to: null, address: "4EotVUjoPNgsBtTd82vAZMiey6Uw9uQgX4fVgkgxzFmS" }), "4Eot…zFmS");
  assert.equal(whoText({ name: null, to: null, address: null }), "—");
  assert.equal(reportName(Date.UTC(2026, 10, 19, 23)), "ryntra-payout-2026-11-19.csv");
  const words = reportWords(PAYOUTS.uk);
  assert.equal(words.head.length, 9);
  assert.equal(words.how.link, "Посилання");
});

test("the words are private, never anonymous, and promise no monthly signature", () => {
  for (const lang of ["en", "uk"]) {
    const said = Object.values(PAYOUTS[lang])
      .map((v) => (typeof v === "string" ? v : v(...Array.from({ length: v.length }, (_, i) => (i ? 3 : 2)))))
      .join(" \n ");
    assert.doesNotMatch(said, /anonym|анонім|untrace|не відстеж|invisible|невидим|first private|перш(ий|а|е) приват/i, lang);
    assert.doesNotMatch(said, /every month|monthly|щомісяця|щомісячн/i, `${lang}: only «as last time», never «every month in one signature»`);
    assert.doesNotMatch(said, /who receives[^.;]*hidden|кому[^.;]*сховано/i, `${lang}: recipients are seen in a ring transfer`);
  }
  assert.equal(PAYOUTS.uk.people(1), "1 людина");
  assert.equal(PAYOUTS.uk.people(3), "3 людини");
  assert.equal(PAYOUTS.uk.people(9), "9 людей");
  assert.equal(PAYOUTS.en.noFeeLine(1), "No Ryntra fee · 1 signature");
  assert.equal(PAYOUTS.uk.noFeeLine(3), "Без комісії Ryntra · 3 підписи");
  assert.equal(PAYOUTS.en.feeLine("0.2", "0.2", 1), "Ryntra fee 0.2% · 0.2 SOL · 1 signature");
  assert.equal(PAYOUTS.uk.feeLine("0,2", "0,2", 5), "Комісія Ryntra 0,2% · 0,2 SOL · 5 підписів");
});

test("the screen: «Others see» says who receives is seen, one line before the signature, nothing on chain but money", () => {
  const screen = read("terminal/money/payouts/Payouts.tsx");
  assert.doesNotMatch(screen, /<SeenLine action="send"/, "the private balance's line says recipients are hidden — a payout's does not");
  assert.match(screen, /\[w\.seenTo, true\]/, "recipients — seen");
  assert.match(screen, /\[wp\.seenAmount, false\]/, "amounts — hidden");
  assert.match(screen, /className=\{p\.status\} role="status"/, "one status line of kept height");
  const run = code("lib/privacy/payouts/run.ts");
  assert.doesNotMatch(run, /memo|withMemo/i, "what for never goes on chain");
  for (const path of ["lib/privacy/payouts/run.ts", "lib/privacy/payouts/usePayouts.ts", "terminal/money/payouts/Payouts.tsx"]) {
    assert.doesNotMatch(code(path), /mainnet/i, `${path}: no mainnet`);
    assert.doesNotMatch(code(path), /fetch\(/, `${path}: talks to nothing itself — the ring through the relay only`);
  }
});
