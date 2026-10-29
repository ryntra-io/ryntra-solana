import assert from "node:assert/strict";
import test from "node:test";

import { NO_ALERTS, engineAlerts, engineAlertsSent } from "../core/launch/engine.ts";
import { FAILOVER_REST_MS, failoverConnection, standingRefusal } from "./failover.server.ts";

/* Two nodes that answer on purpose: each read names the node that answered it. */
function node(name, state) {
  return {
    name,
    calls: 0,
    async getAccountInfo(address) {
      this.calls += 1;
      if (state[name] === "down") throw new Error(`${name}: fetch failed`);
      return { from: name, address };
    },
    async sendRawTransaction() {
      this.calls += 1;
      return `${name}-sent`;
    },
  };
}

test("a read the main node fails is answered by the second at once; after two failures in a row the main node rests a minute", async () => {
  const state = { main: "up", second: "up" };
  let now = 0;
  const main = node("main", state);
  const second = node("second", state);
  const failover = failoverConnection(main, second, () => now);
  assert.equal((await failover.connection.getAccountInfo("A")).from, "main");
  state.main = "down";
  assert.equal((await failover.connection.getAccountInfo("A")).from, "second");
  assert.equal((await failover.connection.getAccountInfo("A")).from, "second");
  assert.deepEqual(failover.health(), { reads: 3, mainFailures: 2, mainRefused: 0, mainDown: 2, secondReads: 2, bothFailed: 0, resting: true });
  const mainCalls = main.calls;
  assert.equal((await failover.connection.getAccountInfo("A")).from, "second");
  assert.equal(main.calls, mainCalls, "resting: the main node is not asked first");
  assert.equal(failover.health().mainDown, 3, "a read sent to the second while the main node rests, down, is one it did not answer");
  state.main = "up";
  now += FAILOVER_REST_MS;
  assert.equal((await failover.connection.getAccountInfo("A")).from, "main", "after its rest the main node is asked first again");
  assert.equal(failover.health().resting, false);
});

test("while the main node rests and the second fails too, the main one is asked; both down — the read fails and is counted", async () => {
  const state = { main: "down", second: "up" };
  let now = 0;
  const failover = failoverConnection(node("main", state), node("second", state), () => now);
  await failover.connection.getAccountInfo("A");
  await failover.connection.getAccountInfo("A");
  state.second = "down";
  state.main = "up";
  assert.equal((await failover.connection.getAccountInfo("A")).from, "main");
  state.main = "down";
  await assert.rejects(failover.connection.getAccountInfo("A"));
  assert.equal(failover.health().bothFailed, 1);
  failover.reset();
  assert.deepEqual(failover.health(), { reads: 0, mainFailures: 0, mainRefused: 0, mainDown: 0, secondReads: 0, bothFailed: 0, resting: false }, "the main node answered: its rest is over");
});

test("a send never fails over: it goes where its caller sends it", async () => {
  const state = { main: "down", second: "up" };
  const main = node("main", state);
  const second = node("second", state);
  const failover = failoverConnection(main, second);
  assert.equal(await failover.connection.sendRawTransaction(new Uint8Array()), "main-sent");
  assert.equal(second.calls, 0);
});

test("with no second node the main one answers or fails as it is", async () => {
  const state = { main: "down" };
  const failover = failoverConnection(node("main", state), null);
  await assert.rejects(failover.connection.getAccountInfo("A"));
  assert.equal(failover.health().resting, false);
});

test("a node at its rate limit is asked again after a short wait before the read moves on; a node that is down is not waited for", async () => {
  const { rateLimited } = await import("./failover.server.ts");
  assert.equal(rateLimited(new Error("429 Too Many Requests: {\"message\":\"Connection rate limits exceeded\"}")), true);
  assert.equal(rateLimited(new Error("fetch failed")), false);
  let limited = 2;
  const waits = [];
  const main = {
    calls: 0,
    async getAccountInfo() {
      this.calls += 1;
      if (limited > 0) {
        limited -= 1;
        throw new Error("429 Too Many Requests");
      }
      return { from: "main" };
    },
  };
  const second = { async getAccountInfo() { return { from: "second" }; } };
  const failover = failoverConnection(main, second, () => 0, async (ms) => void waits.push(ms));
  assert.equal((await failover.connection.getAccountInfo("A")).from, "main", "the main node answers after its rate limit eased");
  assert.deepEqual(waits, [400, 800]);
  assert.equal(failover.health().mainFailures, 0);
  limited = 5;
  assert.equal((await failover.connection.getAccountInfo("A")).from, "second", "still limited after the waits: the second node answers");
  const down = { async getAccountInfo() { throw new Error("fetch failed"); } };
  const quick = failoverConnection(down, second, () => 0, async () => assert.fail("a node that is down is not waited for"));
  assert.equal((await quick.connection.getAccountInfo("A")).from, "second");
});

/* publicnode, measured 21.10: the creator's wallet (`heldBy` → `getParsedTokenAccountsByOwner`) refused every pass. */
const INDEXED = "403 Forbidden: {\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32701,\"message\":\"Indexed requests require a personal token\"}}";

function publicnode(state) {
  return {
    calls: 0,
    async getAccountInfo() {
      this.calls += 1;
      if (state.down) throw new Error("fetch failed");
      return { from: "main" };
    },
    async getParsedTokenAccountsByOwner() {
      this.calls += 1;
      if (state.down) throw new Error("fetch failed");
      throw new Error(INDEXED);
    },
  };
}
const helius = (state = {}) => ({
  async getAccountInfo() {
    if (state.down) throw new Error("fetch failed");
    return { from: "second" };
  },
  async getParsedTokenAccountsByOwner() {
    if (state.down) throw new Error("fetch failed");
    return { value: [] };
  },
});

test("a standing refusal of an indexed read is counted apart: the main node is not down for it, and the rest it trips is not either", async () => {
  assert.equal(standingRefusal(new Error(INDEXED)), true);
  assert.equal(standingRefusal(new Error("archive requests require a personal token")), true);
  assert.equal(standingRefusal(new Error("fetch failed")), false);
  assert.equal(standingRefusal(new Error("429 Too Many Requests")), false);
  let now = 0;
  const main = publicnode({});
  const failover = failoverConnection(main, helius(), () => now);
  /* Two creators watched one after the other: two refusals in a row, so the main node rests — the reads are as before. */
  await failover.connection.getParsedTokenAccountsByOwner("A");
  await failover.connection.getParsedTokenAccountsByOwner("B");
  for (let read = 0; read < 8; read += 1) assert.equal((await failover.connection.getAccountInfo("A")).from, "second", "resting: the second answers first, as before");
  assert.deepEqual(failover.health(), { reads: 10, mainFailures: 2, mainRefused: 2, mainDown: 0, secondReads: 10, bothFailed: 0, resting: true });
  now += FAILOVER_REST_MS;
  assert.equal((await failover.connection.getAccountInfo("A")).from, "main");
  assert.equal(failover.health().mainDown, 0);
});

test("the operator's words from the nodes' counts: publicnode refusing the creator's wallet every pass raises no word; publicnode down — or both nodes — does (SOL-C9)", async () => {
  /* A pass a minute: a few indexed reads of creators' wallets among the curves' reads, as the executor reads. */
  const pass = async (mainState, secondState) => {
    const failover = failoverConnection(publicnode(mainState), helius(secondState), () => 0);
    /* Two creators first, one after the other — the refusals in a row rest the main node, as they did on mainnet. */
    for (let read = 0; read < 30; read += 1) {
      await (read < 2 || read % 10 === 0 ? failover.connection.getParsedTokenAccountsByOwner("C") : failover.connection.getAccountInfo("A")).catch(() => null);
    }
    return failover.health();
  };
  const said = async (mainState, secondState, minutes) => {
    let state = NO_ALERTS;
    const words = [];
    for (let minute = 0; minute < minutes; minute += 1) {
      const at = 10_000 + minute * 60;
      const signals = { at, silentSeconds: 60, nodes: await pass(mainState, secondState), failedSendsInRow: 0, lamports: 1_000_000_000n, paused: [], lagSeconds: 0, stopsUnread: false, failing: 0 };
      const told = engineAlerts(state, signals);
      state = engineAlertsSent(state, { holding: told.holding, words: told.words, delivered: true, at });
      words.push(...told.words.map((word) => `${word.kind}:${word.key}:${word.text}`));
    }
    return words;
  };
  assert.deepEqual(await said({}, {}, 7 * 60), [], "seven hours of the standing refusal: not a word");
  assert.deepEqual(await said({ down: true }, {}, 4), ["RAISED:NODE:основний вузол не відповів на 30 з 30 читань"]);
  assert.deepEqual(await said({ down: true }, { down: true }, 4), ["RAISED:NODE:обидва вузли не відповіли на 30 читань"]);
});

test("a failure of the main node next to a refusal rests it, and the reads of that rest are not the main node down; with no second node a read the main one fails reached none", async () => {
  const state = { flaky: 1 };
  const main = {
    async getAccountInfo() {
      if (state.flaky-- > 0) throw new Error("fetch failed");
      return { from: "main" };
    },
    async getParsedTokenAccountsByOwner() {
      throw new Error(INDEXED);
    },
  };
  const failover = failoverConnection(main, helius(), () => 0);
  await failover.connection.getAccountInfo("A");
  await failover.connection.getParsedTokenAccountsByOwner("C");
  for (let read = 0; read < 10; read += 1) await failover.connection.getAccountInfo("A");
  assert.deepEqual(failover.health(), { reads: 12, mainFailures: 2, mainRefused: 1, mainDown: 1, secondReads: 12, bothFailed: 0, resting: true }, "one blip and one refusal: the rest is the route's, not a node down");
  const alone = failoverConnection(publicnode({}), null);
  await assert.rejects(alone.connection.getParsedTokenAccountsByOwner("C"));
  assert.equal(alone.health().bothFailed, 0, "its standing refusal is not a node down");
  const downAlone = failoverConnection(publicnode({ down: true }), null);
  await assert.rejects(downAlone.connection.getAccountInfo("A"));
  assert.deepEqual(downAlone.health(), { reads: 1, mainFailures: 1, mainRefused: 0, mainDown: 1, secondReads: 0, bothFailed: 1, resting: false });
});
