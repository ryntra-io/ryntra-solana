// Run from repo root: node --test lib/ring/duel/spectate.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const d = await import("./index.ts");
const j = await import("../judge/index.ts");
const { CODE_TOOLS, codeRules, codeWinner, suiteHash } = await import("./code.ts");
const { PHRASES, T0, clock, crackConfig, keys, marketConfig } = await import("./testing/kit.mjs");

const crackDuel = async (rounds) => {
  const logs = [];
  const run = await d.runDuel({ format: "duo-crack", matchId: "w-1", config: crackConfig("w-1"), secrets: PHRASES, agents: [d.houseAgent("wall"), d.houseAgent("chatty")], now: clock(), moveMs: 200, onRound: (log) => logs.push(log) });
  return { run, live: logs[rounds - 1] };
};

describe("people watching", () => {
  test("while live, a seat's own words are hidden in its lines and a right guess is hidden; after the end, all shows", async () => {
    const { run } = await crackDuel(6);
    const live = d.publicDuel("duo-crack", { ...run.log, result: null }, PHRASES);
    const slip = live.rounds[2].seats[1];
    assert.ok(slip.say.endsWith("about •••."));
    assert.equal(live.rounds[5].seats[0].guess, d.HIDDEN);
    assert.equal(live.phrases, undefined);
    const done = d.publicDuel("duo-crack", run.log, PHRASES);
    assert.ok(done.rounds[2].seats[1].say.endsWith("about violet."));
    assert.equal(done.rounds[5].seats[0].guess, PHRASES[1]);
    assert.deepEqual(done.phrases, PHRASES);
    assert.deepEqual(done.result, { winner: 0, reason: "cracked" });
  });

  test("thoughts come with the round, only after both moves are fixed", async () => {
    const { live } = await crackDuel(2);
    const duel = d.publicDuel("duo-crack", live, PHRASES);
    assert.equal(duel.rounds.length, 2);
    assert.ok(duel.rounds.every((r) => r.seats.every((s) => typeof s.thought === "string" && s.thought.length > 0)));
    assert.equal(duel.over, false);
  });

  test("Market Replay shows the bars up to the last step while live, all of them after", async () => {
    const cfg = marketConfig();
    const logs = [];
    const run = await d.runDuel({ format: "market-replay", matchId: "w-2", config: cfg, secrets: [null, null], agents: [d.houseAgent("trend"), d.houseAgent("holder")], now: clock(), moveMs: 200, onRound: (log) => logs.push(log) });
    assert.equal(d.publicDuel("market-replay", logs[4]).bars.length, cfg.lookback + 5);
    const done = d.publicDuel("market-replay", run.log);
    assert.equal(done.bars.length, cfg.bars.length);
    assert.equal(done.rounds[0].price, cfg.bars[cfg.lookback][0]);
    const beats = d.moments(done);
    assert.equal(beats.at(-1).kind, "end");
    assert.ok(beats.some((m) => m.kind === "lead"));
  });

  test("the clip's beats come from the log: slips, the crack, the end", async () => {
    const { run } = await crackDuel(6);
    const beats = d.moments(d.publicDuel("duo-crack", run.log, PHRASES));
    assert.deepEqual(beats.filter((m) => m.kind !== "slip"), [{ round: 6, kind: "crack", seat: 0 }, { round: 6, kind: "end", seat: 0 }]);
    assert.ok(beats.some((m) => m.kind === "slip" && m.seat === 1 && m.round === 3));
  });
});

describe("Code — the published part, without a sandbox", () => {
  const task = { id: "sum", title: "Sum", prompt: "Write sum(a, b).", language: "typescript", openTests: "sum(1,2)===3", hiddenSuite: { suiteHash: suiteHash(["adds", "carries", "negatives"], "hidden"), ids: ["adds", "carries", "negatives"] } };

  test("rules are verified, decided by tests, for nothing", () => {
    const rules = codeRules(task, { opensAt: T0, closesAt: T0 + 3_600_000 });
    assert.deepEqual(j.checkRules(rules), []);
    assert.deepEqual([rules.decider, rules.money, rules.limits.steps, rules.tests.minPassed], ["tests", "none", 20, 1]);
    assert.deepEqual(CODE_TOOLS.map((t) => t.name), ["run_open_tests", "submit"]);
  });

  test("a sandbox's run goes through the judge; more hidden tests passed wins", () => {
    const rules = codeRules(task, { opensAt: T0, closesAt: T0 + 3_600_000 });
    const { stamp, verifyStamp } = keys();
    const passedBy = [3, 2];
    const verdicts = [0, 1].map((seat) => {
      const content = `export const sum = (a: number, b: number) => a + b; // ${seat}\n`;
      const hash = j.sha256Hex(content);
      const results = task.hiddenSuite.ids.map((id, i) => ({ id, status: i < passedBy[seat] ? "pass" : "fail" }));
      return j.judge(
        { matchId: "code-1", seat, rules, rulesHash: j.rulesHash(rules), submission: { media: "text/typescript", content, hash, size: Buffer.byteLength(content), stamp: stamp({ matchId: "code-1", seat, hash }, T0 + 1_000) }, usage: { costMicroUsd: 0, ms: 0 }, tests: { suiteHash: task.hiddenSuite.suiteHash, subject: hash, results } },
        { verifyStamp },
      );
    });
    assert.deepEqual(verdicts.map((v) => [v.verdict, v.passed]), [["PASS", 3], ["PASS", 2]]);
    assert.equal(codeWinner(verdicts.map((v) => v.passed)), 0);
    assert.equal(codeWinner([2, 2]), null);
  });
});
