// Run from repo root: node --test terminal/agents/scout/scout.test.mjs
//
// The Scout's screen: every reason the engine can write has words in both languages, a check is one line of facts, the
// person's paper is the shared desk on their own numbers, and the screen stands on the Agents shelf beside the analyst.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CHAIN_CODES } from "../../../lib/scout/chain.ts";
import { JOURNAL_OUTCOMES } from "../../../lib/scout/journal.ts";
import { markPosition, openPosition } from "../../../lib/scout/paper.ts";
import { RISK_CODES } from "../../../lib/scout/risk.ts";
import { SCREEN_CODES } from "../../../lib/scout/screen.ts";
import { AGAINST_CODES, FOR_CODES, INVALIDATIONS } from "../../../lib/scout/thesis.ts";
import { MENU } from "../../shell/menu.ts";
import { checkLine, checkTone, decisionLine, decisionRows, exitWords, minutesSince, personPaper, positionState, reasonWord, solField, solSigned, solTyped, stateWord, whyWord } from "./view.ts";
import { SCOUT } from "./words.ts";

const SOL = 1_000_000_000n;
const NOW = Date.parse("2026-11-20T12:00:00Z");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every code the engine writes has its words, in English and Ukrainian", () => {
  const pass = ["thesis_off", "thesis_day_limit", "thesis_failed", "thesis_unread", "price_unread"];
  for (const lang of ["en", "uk"]) {
    const w = SCOUT[lang];
    for (const code of [...SCREEN_CODES, ...CHAIN_CODES, ...RISK_CODES, ...pass]) assert.ok(w[`r_${code}`], `${lang}: no words for the refusal «${code}»`);
    for (const code of FOR_CODES) assert.ok(w[`f_${code}`], `${lang}: no words for «${code}»`);
    for (const code of AGAINST_CODES) assert.ok(w[`a_${code}`], `${lang}: no words for «${code}»`);
    for (const code of INVALIDATIONS) assert.ok(w[`i_${code}`], `${lang}: no words for «${code}»`);
    for (const code of JOURNAL_OUTCOMES) assert.ok(w[`o_${code}`], `${lang}: no words for the outcome «${code}»`);
    for (const code of ["stop", "half", "fade", "time", "unread"]) assert.ok(w[`x_${code}`], `${lang}: no words for the exit «${code}»`);
  }
});

test("a check is one line of facts: what the Scout did and its first reason", () => {
  const w = SCOUT.uk;
  assert.equal(checkLine(w, { at: NOW, stage: "screen", outcome: "refused", codes: ["liquidity", "volume"] }), "Скаут: відсіяв · Тонкий пул");
  assert.equal(checkLine(SCOUT.en, { at: NOW, stage: "chain", outcome: "refused", codes: ["top1"] }), "Scout: left out · One wallet holds a lot");
  assert.equal(checkLine(SCOUT.en, { at: NOW, stage: "paper", outcome: "took", codes: ["many_traders"] }), "Scout: bought on paper · Many traders");
  assert.equal(checkLine(SCOUT.en, { at: NOW, stage: "thesis", outcome: "watch", codes: ["unknown_code"] }), "Scout: watching");
  assert.equal(checkTone({ outcome: "took" }), "up");
  assert.equal(checkTone({ outcome: "refused" }), undefined, "a refusal is a fact, not an alarm");
  assert.equal(reasonWord(SCOUT.en, "stop"), "Stop");
  assert.equal(decisionLine(SCOUT.en, { at: NOW, mint: "M", symbol: "M", stage: "paper", outcome: "closed", codes: ["fade"] }), "Scout: closed · Volume faded");
  for (const lang of ["en", "uk"]) assert.doesNotMatch(Object.values(SCOUT[lang]).filter((v) => typeof v === "string").join(" "), /\bscore\b|оцінк|\bsafe\b|безпечн/i, "facts, never a score or «safe»");
});

test("reasons in a person's words — a fact first, «not read» rarely, once and calmly", () => {
  const en = SCOUT.en;
  const uk = SCOUT.uk;
  assert.equal(checkLine(en, { at: NOW, stage: "chain", outcome: "refused", codes: ["holders_unread", "creator_share"] }), "Scout: left out · Creator holds a lot", "the fact, not the read that failed");
  assert.equal(checkLine(uk, { at: NOW, stage: "chain", outcome: "refused", codes: ["top1", "top10", "holders_unread"] }), "Скаут: відсіяв · Один гаманець тримає багато");
  assert.equal(checkLine(uk, { at: NOW, stage: "chain", outcome: "refused", codes: ["top10"] }), "Скаут: відсіяв · Десять гаманців тримають забагато");
  assert.equal(checkLine(en, { at: NOW, stage: "chain", outcome: "refused", codes: ["holders_unread"] }), "Scout: checks later", "nothing read is no verdict: not «left out»");
  assert.equal(checkLine(uk, { at: NOW, stage: "chain", outcome: "refused", codes: ["rights_unread", "holders_unread"] }), "Скаут: перевірить пізніше");

  const entry = (mint, codes, at, outcome = "refused") => ({ at, mint, symbol: mint, stage: "chain", outcome, codes });
  const entries = [
    entry("A", ["holders_unread"], NOW),
    entry("B", ["top1", "holders_unread"], NOW - 1),
    entry("C", ["holders_unread"], NOW - 2),
    entry("D", ["rights_unread", "holders_unread"], NOW - 3),
    entry("E", ["creator_share"], NOW - 4),
    entry("F", ["unknown_code"], NOW - 5, "nothing"),
  ];
  const rows = decisionRows(en, entries, 8);
  assert.deepEqual(rows.map((row) => row.entry.mint), ["A", "B", "E"], "the coins not read are said once — the newest — and a line without words is not shown");
  assert.deepEqual(rows.map((row) => row.line), ["Scout: checks later", "Scout: left out · One wallet holds a lot", "Scout: left out · Creator holds a lot"]);
  assert.equal(decisionRows(en, entries, 2).length, 2);

  /* No code, no tech word, no «not read» on a reason a person sees. */
  for (const w of [en, uk]) {
    const reasons = Object.entries(w).filter(([key, value]) => /^[rafx]_/.test(key) && typeof value === "string").map(([, value]) => value);
    for (const reason of reasons) assert.doesNotMatch(reason, /_|\bAPI\b|gateway|шлюз|RPC|holders not read|власників не прочитано/i, `«${reason}» is a person's word`);
  }
  assert.equal(en.r_holders_unread, en.r_rights_unread, "one calm word for every read that did not happen");
});

test("the person's numbers: any amount they type, SOL with a sign, cut and never rounded up", () => {
  assert.equal(solTyped("1"), SOL);
  assert.equal(solTyped("0,25"), SOL / 4n);
  assert.equal(solTyped("250"), 250n * SOL, "no ceiling of ours on the person's budget");
  assert.equal(solTyped("0"), null);
  assert.equal(solTyped("abc"), null);
  assert.equal(solField(SOL / 10n, "uk"), "0,1");
  assert.equal(solSigned(42_123_999n, "en"), "+0.0421");
  assert.equal(solSigned(-12_000_000n, "uk"), "−0,0120");
  assert.equal(solSigned(0n, "en"), "0.0000");
  assert.equal(minutesSince(NOW - 125_000, NOW), 2);
  assert.match(exitWords(SCOUT.en), /−35%.*×2.*24 hours/);
});

test("the person's paper is the shared desk on their numbers, the last seven days", () => {
  const position = (mint, at, price) =>
    markPosition(openPosition({ mint, symbol: mint, icon: null, at, price: 1, solUsd: 150, lamports: SOL / 10n, liquidityUsd: 100_000, feeBps: 100, why: ["many_traders"], shape: "crowd", invalidation: "volume_fades" }), { at: at + 600_000, price, volumeH1Usd: 1, volumeH6Usd: 1, solUsd: 150 });
  const view = { open: [position("NEW", NOW - 3_600_000, 1.1)], closed: [position("OLD", NOW - 8 * 24 * 3_600_000, 0.5), position("STOPPED", NOW - 2 * 3_600_000, 0.5)] };
  const mine = personPaper(view, { perDayLamports: 2n * SOL, perTradeLamports: SOL / 2n }, NOW);
  assert.deepEqual(mine.positions.map((row) => row.position.mint), ["NEW", "STOPPED"], "older than seven days is left out; the newest first");
  assert.equal(mine.positions[0].spentLamports, SOL / 2n);
  assert.equal(positionState(view.closed[1]), "closed");
  assert.equal(stateWord(SCOUT.uk, view.closed[1]), "Стоп");
  assert.equal(stateWord(SCOUT.en, view.open[0]), "Holding");
  assert.equal(whyWord(SCOUT.en, view.open[0]), "Many traders");
  assert.equal(personPaper(null, { perDayLamports: SOL, perTradeLamports: SOL }, NOW).positions.length, 0);
});

test("the Scout stands on the Agents shelf: its menu item, its address, its tab beside the analyst", () => {
  const item = MENU.flatMap((group) => group.items).find((one) => one.id === "scout");
  assert.equal(item.ready, true);
  assert.equal(item.href, "/agent?ai=scout");
  const page = read("../../../app/(terminal)/agent/page.tsx");
  assert.match(page, /if \(ai === "scout"\) return <ScoutScreen \/>;/);
  assert.match(read("../AgentsScreen.tsx"), /<PageHead title=\{shelves\.agents\} tabs=\{<AgentTabs value="analyst" \/>\} \/>/);
  assert.match(read("./ScoutScreen.tsx"), /<PageHead title=\{w\.agents\} tabs=\{<AgentTabs value="scout" \/>\} \/>/);
  assert.match(read("../../market/Pulse.tsx"), /column === 'new' \? <ScoutLine mint=\{row\.mint\} \/> : null/, "«New» shows the Scout's check in one line");
  const screen = read("./ScoutScreen.tsx");
  assert.equal((screen.match(/<Action[\s>]/g) ?? []).length, 1, "one amber action");
  assert.ok(!/signTransaction|signMessage|signature|sendTransaction|useWallet/i.test(screen.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "the screen never signs or reaches a wallet");
});
