// Run from repo root: node --test lib/ring/dice/driver.test.mjs
import "../../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const { PLAY_TOOLS, createManualClock, createMockBeacon, hostedAgent, roundTime, runMatch, systemClock, verify } = await import("./index.ts");
const { SEEDS, T0, agent, assertMatch, beacon, cautious, config, tapeStrategy } = await import("./testing/helpers.mjs");

const silent = { act: () => new Promise(() => {}) };

describe("runMatch", () => {
  test("plays a whole match between two agents and returns a verifiable log", async () => {
    const clock = createManualClock(T0);
    const cfg = config();
    const { result, log } = await runMatch(cfg, [agent(SEEDS[0], cautious), agent(SEEDS[1], tapeStrategy([2, 7, 1]))], beacon, clock);
    assert.equal(result.reason, "eliminated");
    assert.deepEqual(verify(log, result), { ok: true, result });
    // The beacon round was read once published, not before.
    const closed = log.entries.find((e) => e.type === "commits_closed");
    const read = log.entries.find((e) => e.type === "beacon");
    assert.ok(read.at >= roundTime(cfg.beacon, closed.beaconRound));
  });

  describe("on the system clock", () => {
    const fast = createMockBeacon("fast", { chainHash: "a".repeat(64), genesisTime: 0, period: 10 });
    const realConfig = (moveMs) => config({ startedAt: Date.now(), beacon: fast.info, limits: { commitMs: 2_000, revealMs: 2_000, moveMs } });

    test("asks both agents at once and waits for the slower one", async () => {
      const slowCommit = {
        act: async (view, signal) => {
          if (view.phase === "commit") await new Promise((r) => setTimeout(r, 30));
          return agent(SEEDS[1], cautious).act(view, signal);
        },
      };
      const { result, log } = await runMatch(realConfig(2_000), [agent(SEEDS[0], cautious), slowCommit], fast, systemClock);
      assert.equal(result.reason, "eliminated");
      assert.equal(verify(log, result).ok, true);
    });

    test("stops waiting at the deadline", async () => {
      const quietInPlay = {
        act: (view, signal) => (view.phase === "play" ? silent.act(view, signal) : agent(SEEDS[1], cautious).act(view, signal)),
      };
      const started = Date.now();
      const { result } = await runMatch(realConfig(60), [agent(SEEDS[0], tapeStrategy([0])), quietInPlay], fast, systemClock);
      assert.equal(result.reason, "timeout");
      assert.ok(Date.now() - started < 1_500);
    });
  });

  test("ends the match on a silent agent at the deadline", async () => {
    const clock = createManualClock(T0);
    const cfg = config({ limits: { moveMs: 10_000 } });
    const quietInPlay = {
      act: (view, signal) => (view.phase === "play" ? silent.act(view, signal) : agent(SEEDS[1], cautious).act(view, signal)),
    };
    const { result, log } = await runMatch(cfg, [agent(SEEDS[0], cautious), quietInPlay], beacon, clock);
    assert.equal(result.reason, "timeout");
    assert.equal(result.winner, 0);
    assert.equal(verify(log, result).ok, true);
  });

  test("counts a slow answer as a timeout", async () => {
    const clock = createManualClock(T0);
    const cfg = config({ limits: { moveMs: 10_000 } });
    const slow = {
      act: (view, signal) => {
        if (view.phase === "play") clock.advance(10_001);
        return agent(SEEDS[0], cautious).act(view, signal);
      },
    };
    const { result } = await runMatch(cfg, [slow, agent(SEEDS[1], cautious)], beacon, clock);
    assertMatch(result, { reason: "timeout", winner: 1 });
  });

  test("counts a crashing agent as an illegal move", async () => {
    const clock = createManualClock(T0);
    const crashing = {
      act: (view, signal) => {
        if (view.phase === "play") throw new Error("model unavailable");
        return agent(SEEDS[1], cautious).act(view, signal);
      },
    };
    const { result } = await runMatch(config(), [agent(SEEDS[0], cautious), crashing], beacon, clock);
    assertMatch(result, { reason: "illegal_move", winner: 0 });
  });

  test("declares no winner when neither agent commits", async () => {
    const clock = createManualClock(T0);
    const { result } = await runMatch(config(), [silent, silent], beacon, clock);
    assertMatch(result, { reason: "timeout", winner: null });
    assert.equal(result.faults.length, 2);
  });

  test("voids the match when the beacon hangs", async () => {
    const clock = createManualClock(T0);
    const hanging = { info: beacon.info, get: () => new Promise(() => {}) };
    const { result, log } = await runMatch(config(), [agent(SEEDS[0], cautious), agent(SEEDS[1], cautious)], hanging, clock);
    assertMatch(result, { winner: null, reason: "beacon_timeout", faults: [] });
    assert.equal(log.entries.at(-2).type, "tick");
    assert.deepEqual(verify(log, result), { ok: true, result });
  });

  test("voids the match when the beacon fails, at the same deadline", async () => {
    const clock = createManualClock(T0);
    const failing = { info: beacon.info, get: async () => Promise.reject(new Error("drand unreachable")) };
    const { result } = await runMatch(config(), [agent(SEEDS[0], cautious), agent(SEEDS[1], cautious)], failing, clock);
    assertMatch(result, { winner: null, reason: "beacon_timeout" });
  });

  test("refuses a beacon from another chain", async () => {
    const other = createMockBeacon("mock", { ...beacon.info, chainHash: "f".repeat(64) });
    await assert.rejects(runMatch(config(), [silent, silent], other, createManualClock(T0)), /different chain/);
  });
});

describe("hostedAgent", () => {
  /** A scripted «model»: it only ever answers bid or challenge, and records what it was shown. */
  function scriptedModel(strategy) {
    const seen = [];
    return {
      seen,
      act(view) {
        seen.push(view);
        return strategy(view);
      },
    };
  }

  test("plays a whole match for two models that only bid and challenge", async () => {
    const clock = createManualClock(T0);
    const models = [scriptedModel(cautious), scriptedModel(tapeStrategy([2, 7, 1]))];
    const { result, log } = await runMatch(config(), [hostedAgent(models[0]), hostedAgent(models[1])], beacon, clock);
    assert.equal(result.reason, "eliminated");
    assert.deepEqual(verify(log, result), { ok: true, result });
    for (const model of models) {
      assert.ok(model.seen.length > 0);
      for (const view of model.seen) {
        assert.equal(view.phase, "play");
        assert.ok(view.tools.every((t) => t === "bid" || t === "challenge"));
      }
    }
    // The platform drew a fresh seed for each seat, and each reveal matched its commitment.
    const reveals = log.entries.filter((e) => e.type === "move" && e.call?.name === "reveal").map((e) => e.call.arguments.seed);
    assert.equal(reveals.length, 2);
    assert.notEqual(reveals[0], reveals[1]);
    assert.deepEqual(PLAY_TOOLS.map((t) => t.name), ["bid", "challenge"]);
  });

  test("still loses a model that calls a tool it was not given", async () => {
    const clock = createManualClock(T0);
    const cheat = scriptedModel(() => ({ name: "commit", arguments: { commitment: "0".repeat(64) } }));
    const { result } = await runMatch(config(), [hostedAgent(cheat), hostedAgent(scriptedModel(cautious))], beacon, clock);
    assertMatch(result, { reason: "illegal_move", winner: 1, faults: [{ seat: 0, code: "wrong_phase" }] });
  });
});
