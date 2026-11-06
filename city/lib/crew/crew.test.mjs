// Run from repo root: node --test city/lib/crew/crew.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CREW, ROLE_FACTS, hireFit, readHire } from "./read.ts";
import { CREW_WORDS } from "./words.ts";
import { DOORS, run } from "../command/run.ts";
import { keyOf } from "../command/parse.ts";

/**
 * CITY-205: two kinds of help. Ryntra, the consultant, advises; the agents do money work. A sentence that hands the
 * work over is a job for an agent — the consultant shows the agent and «Hire», never words.
 */

const role = (text) => {
  const ask = readHire(text);
  return ask === null ? "—" : ask.role ?? "crew";
};

test("a sentence that hands money work over is a job for an agent, by its job", () => {
  const jobs = {
    trader: ["торгуй за мене", "Можеш торгувати за мене?", "trade for me", "can you trade for me?", "хочу бота, який торгує", "найми трейдера", "hire a trader", "торгуй сам"],
    pilot: ["заробляй за мене", "manage my money", "стейкай мої SOL", "увімкни автопілот", "turn on the autopilot", "grow my portfolio"],
    keeper: ["доглядай мій пул", "look after my pool", "keep my pool in range for me"],
    launcher: ["запусти мені токен за мене", "launch a token for me"],
    crew: ["запусти бота", "hire an agent", "create a bot", "хочу агента"],
  };
  for (const [want, sentences] of Object.entries(jobs)) for (const text of sentences) assert.equal(role(text), want, text);
});

test("a question, a trade, a refusal or how-it-works is never a hire", () => {
  for (const text of ["що росте й чому?", "Should I buy JUP?", "купи SOL на 50", "trade JUP", "не торгуй за мене", "don't trade for me", "stop the bot", "що таке пул?", "як працює агент?", "how does the agent work?", "my portfolio", "бот", "BONK", "поклади 50 USDC під відсоток"]) {
    assert.equal(role(text), "—", text);
  }
});

test("an agent shut on this deployment hands over the whole crew, never a card that is not there", () => {
  const all = { trader: true, pilot: true, keeper: true, launcher: true };
  assert.equal(hireFit(readHire("доглядай мій пул"), all).role, "keeper");
  assert.equal(hireFit(readHire("доглядай мій пул"), { ...all, keeper: false }).role, null);
  assert.equal(hireFit(readHire("запусти бота"), all).role, null);
});

test("every agent has skills, a name and one line of its job in both languages; pay is a trade fee, never credits", () => {
  for (const r of CREW) {
    assert.ok(ROLE_FACTS[r].skills.length >= 3, r);
    assert.notEqual(ROLE_FACTS[r].paid, "credits");
    for (const lang of ["en", "uk"]) {
      const w = CREW_WORDS[lang];
      assert.ok(w[r] && w[`${r}Job`], `${lang} ${r}`);
      assert.ok(w[`${r}Job`].length <= 32, `${lang} ${r}: one short line`);
      for (const skill of ROLE_FACTS[r].skills) assert.equal(typeof w[skill], "string", `${lang} skill ${skill}`);
    }
  }
  assert.equal(CREW_WORDS.uk.consultant, "Консультант");
  assert.equal(CREW_WORDS.en.job, "This is a job for an agent");
  assert.equal(CREW_WORDS.uk.job, "Це робота для агента");
});

test("the command line's hire only opens a card: one door, the agent's", () => {
  assert.ok(DOORS.includes("openCrew"));
  const knocked = [];
  const doors = Object.fromEntries(DOORS.map((name) => [name, (...args) => knocked.push([name, ...args])]));
  run({ kind: "hire", ask: { said: "торгуй за мене", role: "trader" } }, doors);
  run({ kind: "hire", ask: { said: "запусти бота", role: null } }, doors);
  assert.deepEqual(knocked, [["openCrew", "trader"], ["openCrew", null]]);
  assert.equal(keyOf({ kind: "hire", ask: { said: "", role: "pilot" } }), "hire:pilot");
});

test("hiring opens cards and signs nothing: the crew's code names no signer and no transaction", () => {
  for (const file of ["./hire.ts", "./read.ts", "../../components/crew/Crew.tsx", "../../components/crew/JobCard.tsx"]) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(code, /signTransaction|signAll|sendTransaction|citySigner|tapEnable|from ['"][^'"]*signer['"]/, file);
  }
  // On the first screen one word per agent: no receipts, proofs or approvals in the crew's words (decision 91).
  for (const lang of ["en", "uk"]) {
    const flat = Object.values(CREW_WORDS[lang]).filter((v) => typeof v === "string").join(" ");
    assert.doesNotMatch(flat, /receipt|proof|approval|квитанц|доказ|схвален|перевірк/i, lang);
  }
});
