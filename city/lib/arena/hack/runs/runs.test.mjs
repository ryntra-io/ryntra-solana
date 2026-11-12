// Run from repo root: node --test city/lib/arena/hack/runs/runs.test.mjs
/*
 * CITY-238: an agent's run on the server. The store's rules on memory — and on the real migration on a throwaway
 * PostgreSQL when HACK_TEST_DATABASE_URL names a local server (for example <local Postgres URL>); the run service over
 * the real step runner, the real sandbox and the library's rules; the routes: a take starts the run, the run's own
 * route serves the journal as the viewer may see it, a retried take never starts a second run — also with the sandbox
 * on the machine (`../machine/`, the entry as a real process).
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import net from "node:net";
import { suite, test } from "node:test";
import { fileURLToPath } from "node:url";
import { f, runner, inProc, stubPlan, FINDING_META, HONEST } from "../runner/fixtures.mjs";
import { throwawayDatabase } from "../store/testing/pg.mjs";

const { createMemoryRunStore } = await import("./memory.ts");
const { createSupabaseRunStore } = await import("./supabase.ts");
const { RUN_ATTEMPTS, ownerOverShare } = await import("./contract.ts");
const { createRunService, dailyCapMicroUsd, feedOf, sealedTurn, STALLED_MS, RUN_MAX_TURNS } = await import("./service.ts");
const { createMemoryHackDb } = await import("../store/memory.ts");
const { createSupabaseHackDb } = await import("../store/supabase.ts");
const { createHackService } = await import("../store/service.ts");
const { createHackApi } = await import("../store/api.ts");
const { createMachineBackend } = await import("../machine/backend.ts");
const { createProcessDriver } = await import("../machine/drivers/process.ts");

const DAY = 86_400_000;
const AT = f.AT;
const day0 = AT - (AT % DAY);
const { order: ORDER, grant: GRANT } = f.orderFor();
const OWNER_B = f.addr(3);
const OWNER_C = f.addr(9);

const record = (over = {}) => ({
  order: ORDER.id,
  hunter: "agent-7",
  owner: f.OWNER_A,
  role: "attacker",
  attempt: 1,
  status: "running",
  maxTurns: 12,
  history: [],
  result: null,
  detail: "",
  finding: null,
  cost: { reserved: 1_000, spent: null },
  startedAt: AT,
  updatedAt: AT,
  ...over,
});
const ceiling = (cap = 1_000_000, day = day0) => ({ day, cap });

// ------------------------------------------------------------------------------------------------- the store

/** The same cases on each store. `seed` puts the order and the agents' takes where the store looks for them. */
function storeCases(name, make) {
  suite(`the run store — ${name}`, { concurrency: false }, () => {
    test("a run starts once for an agent that took the order; a void one is played again, three times in all", async () => {
      const { runs, close } = await make();
      try {
        assert.deepEqual(await runs.start(record({ hunter: "nobody" }), ceiling()), { ok: false, reason: "NOT_TAKEN" });
        assert.deepEqual(await runs.start(record({ owner: OWNER_B }), ceiling()), { ok: false, reason: "NOT_TAKEN" }, "another owner's wallet has no take");
        assert.deepEqual(await runs.start(record(), ceiling()), { ok: true, attempt: 1 });
        assert.deepEqual(await runs.start(record(), ceiling()), { ok: false, reason: "EXISTS" }, "one run at a time");
        assert.equal((await runs.get(ORDER.id, "agent-7")).status, "running");

        // It ends void — nobody's fault: the next attempt may start, and the one after; then no more.
        for (let attempt = 1; attempt <= RUN_ATTEMPTS; attempt += 1) {
          assert.equal(await runs.put(record({ attempt, status: "done", result: "void", detail: "the machine was gone", cost: { reserved: 1_000, spent: 0 }, updatedAt: AT + attempt })), true);
          const next = await runs.start(record({ startedAt: AT + attempt }), ceiling());
          assert.deepEqual(next, attempt < RUN_ATTEMPTS ? { ok: true, attempt: attempt + 1 } : { ok: false, reason: "EXISTS" });
        }
        assert.equal((await runs.get(ORDER.id, "agent-7")).attempt, RUN_ATTEMPTS);

        // A run that ended any other way is the agent's answer: it is not played again.
        assert.deepEqual(await runs.start(record({ hunter: "agent-8" }), ceiling()), { ok: true, attempt: 1 });
        assert.equal(await runs.put(record({ hunter: "agent-8", status: "done", result: "stopped", cost: { reserved: 1_000, spent: 10 } })), true);
        assert.deepEqual(await runs.start(record({ hunter: "agent-8" }), ceiling()), { ok: false, reason: "EXISTS" });
      } finally {
        await close();
      }
    });

    test("a run is written only while it is running here; once over it stays as it ended", async () => {
      const { runs, close } = await make();
      try {
        await runs.start(record(), ceiling());
        const turn = { tool: "read_account", result: { ok: true, account: null } };
        assert.equal(await runs.put(record({ history: [turn], updatedAt: AT + 5 })), true);
        const live = await runs.get(ORDER.id, "agent-7");
        assert.deepEqual(live.history, [turn]);
        assert.equal(live.updatedAt, AT + 5);
        assert.deepEqual(live.cost, { reserved: 1_000, spent: null });

        assert.equal(await runs.put(record({ status: "done", result: "submitted", finding: "f-1", cost: { reserved: 1_000, spent: 420 }, updatedAt: AT + 9 })), true);
        assert.equal(await runs.put(record({ history: [turn, turn], updatedAt: AT + 10 })), false, "the harness writes on, the store does not take it");
        const done = await runs.get(ORDER.id, "agent-7");
        assert.equal(done.status, "done");
        assert.equal(done.result, "submitted");
        assert.equal(done.finding, "f-1");
        assert.deepEqual(done.cost, { reserved: 1_000, spent: 420 });
        assert.equal(await runs.get(ORDER.id, "agent-none"), null);
      } finally {
        await close();
      }
    });

    test("the day's ceiling: a live run holds its most, a finished one what it spent; one owner a quarter; a new day starts at zero", async () => {
      const { runs, close } = await make();
      try {
        const cap = ceiling(4_000);
        // The first run of an owner starts whatever its part: 1 000 of 4 000 held.
        assert.deepEqual(await runs.start(record({ cost: { reserved: 1_000, spent: null } }), cap), { ok: true, attempt: 1 });
        assert.equal(await runs.spent(day0), 1_000);
        // The same owner again: 1 000 + 600 is over a quarter of the day.
        assert.deepEqual(await runs.start(record({ hunter: "agent-8", cost: { reserved: 600, spent: null } }), cap), { ok: false, reason: "DAILY_CAP" });
        // Once the first is over it counts what it spent: 100. Then 100 + 600 fits a quarter.
        await runs.put(record({ status: "done", result: "stopped", cost: { reserved: 1_000, spent: 100 } }));
        assert.equal(await runs.spent(day0), 100);
        assert.deepEqual(await runs.start(record({ hunter: "agent-8", cost: { reserved: 600, spent: null } }), cap), { ok: true, attempt: 1 });
        // Another owner: 700 held, 3 500 more would pass the day's 4 000.
        assert.deepEqual(await runs.start(record({ hunter: "agent-9", owner: OWNER_B, cost: { reserved: 3_500, spent: null } }), cap), { ok: false, reason: "DAILY_CAP" });
        assert.deepEqual(await runs.start(record({ hunter: "agent-9", owner: OWNER_B, cost: { reserved: 3_300, spent: null } }), cap), { ok: true, attempt: 1 });
        assert.equal(await runs.spent(day0), 4_000);
        // A run that costs nothing (a stand's brain at no price) is never the ceiling's business.
        assert.deepEqual(await runs.start(record({ hunter: "agent-c", owner: OWNER_C, cost: { reserved: 0, spent: null } }), cap), { ok: true, attempt: 1 });
        // A void run with nothing measured counts at its most.
        await runs.put(record({ hunter: "agent-9", owner: OWNER_B, status: "done", result: "void", cost: { reserved: 3_300, spent: null } }));
        assert.equal(await runs.spent(day0), 4_000);
        // Tomorrow's day starts at zero.
        assert.equal(await runs.spent(day0 + DAY), 0);
      } finally {
        await close();
      }
    });

    test("two starts at once never both pass a ceiling only one fits under", async () => {
      const { runs, close } = await make();
      try {
        const cap = ceiling(1_500);
        const both = await Promise.all([
          runs.start(record({ hunter: "agent-7", cost: { reserved: 1_000, spent: null } }), cap),
          runs.start(record({ hunter: "agent-9", owner: OWNER_B, cost: { reserved: 1_000, spent: null } }), cap),
        ]);
        assert.equal(both.filter((s) => s.ok).length, 1);
        assert.equal(both.filter((s) => !s.ok && s.reason === "DAILY_CAP").length, 1);
        assert.equal(await runs.spent(day0), 1_000);
      } finally {
        await close();
      }
    });
  });
}

const TAKES = [
  { order: ORDER.id, hunter: "agent-7", owner: f.OWNER_A, role: "attacker" },
  { order: ORDER.id, hunter: "agent-8", owner: f.OWNER_A, role: "attacker" },
  { order: ORDER.id, hunter: "agent-9", owner: OWNER_B, role: "attacker" },
  { order: ORDER.id, hunter: "agent-c", owner: OWNER_C, role: "attacker" },
];

storeCases("memory", async () => ({ runs: createMemoryRunStore({ takes: (order) => TAKES.filter((t) => t.order === order) }), close: async () => {} }));

if (process.env.HACK_TEST_DATABASE_URL) {
  storeCases("postgres (the migration)", async () => {
    const pg = await throwawayDatabase(process.env.HACK_TEST_DATABASE_URL);
    const db = createSupabaseHackDb(pg.rpc, { now: () => AT });
    await db.open({ order: ORDER, grant: GRANT }, null, AT);
    for (const take of TAKES) assert.equal((await db.take(take, null, AT)).ok, true);
    return { runs: createSupabaseRunStore(pg.rpc), close: pg.close };
  });
} else {
  test("the run store — postgres (the migration)", { skip: "HACK_TEST_DATABASE_URL names no local server" }, () => {});
}

test("one owner's part of the day: its first run always, then up to a quarter", () => {
  assert.equal(ownerOverShare(0, 9_999, 4_000), false);
  assert.equal(ownerOverShare(1, 999, 4_000), false);
  assert.equal(ownerOverShare(1, 1_000, 4_000), true);
});

test("the ceiling reads as dollars: a number up to $500, anything else $5", () => {
  assert.equal(dailyCapMicroUsd("5"), 5_000_000);
  assert.equal(dailyCapMicroUsd(" 2.50 "), 2_500_000);
  assert.equal(dailyCapMicroUsd("0"), 0);
  assert.equal(dailyCapMicroUsd("9999"), 500_000_000);
  for (const bad of [undefined, "", "five", "-1", "1e3", "5.123"]) assert.equal(dailyCapMicroUsd(bad), 5_000_000, String(bad));
});

// ----------------------------------------------------------------------------------------------- the service

/** The made-up order's range, as a store of ranges holds it. */
const toyRange = () => {
  const snapshot = f.makeSnapshot();
  const pin = f.pinFor(snapshot);
  const range = { id: "toy", title: "The made-up tally program", target: f.TARGET, watch: [f.VAULT], snapshot, checks: [], pin, invariants: [f.CHECK], claim: f.CLAIM };
  return { forTarget: (target) => (target?.kind === "fork" && target.program === f.TARGET.program && target.slot === f.TARGET.slot ? range : null), forPin: () => range, list: () => [range] };
};

/**
 * One deployment for a test: the routes' memory store with the made-up order open and taken, the run store on it, the
 * routes' real service (the library's rules), and the run service over the real step runner on the real sandbox.
 */
async function world({ brain, backend = () => inProc(), cap = 5_000_000, runMs, maxTurns, ranges = toyRange(), orderOver = {}, wrapRuns = (store) => store, beforeFile, playable } = {}) {
  let t = AT;
  const now = () => t;
  const db = createMemoryHackDb({ now });
  const order = { ...ORDER, ...orderOver };
  await db.open({ order, grant: GRANT }, null, AT);
  const runs = wrapRuns(createMemoryRunStore({ takes: (id) => db.takes(id) }));
  const tasks = [];
  const asked = { brain: [], backends: 0 };
  let runService;
  const service = createHackService({ db, verify: f.verify, prove: async ({ finding }) => runService.proofFor(finding), now, newId: () => "f-auto", ...(playable ? { playable } : {}) });
  runService = createRunService({
    runs,
    order: async (id) => (await db.getOrder(id))?.order ?? null,
    ranges,
    backend: () => {
      asked.backends += 1;
      return backend();
    },
    brain: async (ask) => {
      asked.brain.push(ask);
      return brain === null ? null : (brain ?? { brain: runner.stubBrain({ plan: stubPlan(), moveMicroUsd: 50 }), moveMicroUsd: 50, ceilingMicroUsd: 40_000 });
    },
    file: async ({ finding, owner }) => {
      await beforeFile?.({ finding, owner, service, runService });
      const filed = await service.submit({ wallet: owner, account: null }, { id: finding.id, order: finding.order, hunter: finding.hunter, target: finding.target, vulnClass: finding.vulnClass, severity: finding.severity, title: finding.title, logHash: finding.logHash });
      return filed.ok ? filed.value.finding.id : null;
    },
    capMicroUsd: () => cap,
    now,
    // The made-up exploit is signed by the fixtures' attacker: it is the run's payer here.
    actors: () => ({ addresses: [f.ATTACKER], assemble: () => ({ ok: false, detail: "the made-up engine takes its own transactions" }) }),
    background: (task) => tasks.push(task),
    ...(runMs ? { runMs } : {}),
    ...(maxTurns ? { maxTurns } : {}),
  });
  const take = async (hunter = "agent-7", owner = f.OWNER_A, role = "attacker") => {
    const taken = await db.take({ order: order.id, hunter, owner, role }, null, t);
    assert.equal(taken.ok, true);
    return taken.take;
  };
  return { db, runs, service, runService, tasks, asked, take, order, tick: (ms) => (t += ms), settle: () => Promise.all(tasks) };
}

test("a take's run: the harness writes the journal, the judge seals the finding, the store files it once — and it counts", async () => {
  const w = await world();
  const take = await w.take();
  assert.deepEqual(await w.runService.launch(take), { ok: true, attempt: 1 });
  assert.equal((await w.runs.get(ORDER.id, "agent-7")).status, "running", "the answer goes before the run");
  assert.deepEqual(w.asked.brain, [{ hunter: "agent-7", seat: "attacker", range: "toy", payers: [f.ATTACKER] }]);
  await w.settle();

  const run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(run.status, "done");
  assert.equal(run.result, "submitted");
  assert.deepEqual(run.history.map((turn) => turn.tool), ["read_account", "assemble_tx", "run", "submit"]);
  assert.equal(run.cost.spent, 200, "four moves at the pinned price");
  assert.ok(run.finding);

  const filed = await w.db.filed(run.finding);
  assert.equal(filed.finding.status, "confirmed");
  assert.equal(filed.reason, "COUNTS");
  assert.equal(filed.finding.hunterOwner, f.OWNER_A);
  assert.equal(filed.finding.logHash, run.history[3].result.logHash);
  assert.equal(filed.finding.title, FINDING_META.title);
  // One proof, one finding: nothing is left to prove another one with.
  assert.equal(w.runService.proofFor(filed.finding), null);
  const again = await w.service.submit({ wallet: f.OWNER_A, account: null }, { id: "f-copy", order: ORDER.id, hunter: "agent-7", target: filed.finding.target, vulnClass: "another-class", severity: "critical", title: "The same run, filed again by hand", logHash: filed.finding.logHash });
  assert.equal(again.ok, true);
  assert.equal(again.value.finding.status, "needs_review", "a log hash alone is not a proof");
  assert.equal(again.value.finding.reason, "NO_EVIDENCE");
});

test("the run's journal, as each viewer may see it: the owners all of it, a stranger only how each step came out", async () => {
  const w = await world();
  await w.runService.launch(await w.take());
  await w.settle();
  const mine = await w.runService.feed(ORDER.id, "agent-7", f.OWNER_A, ORDER.protocol);
  const owners = await w.runService.feed(ORDER.id, "agent-7", ORDER.protocol, ORDER.protocol);
  const stranger = await w.runService.feed(ORDER.id, "agent-7", OWNER_B, ORDER.protocol);
  const nobody = await w.runService.feed(ORDER.id, "agent-7", null, ORDER.protocol);
  assert.deepEqual(owners, mine);
  assert.deepEqual(nobody, stranger);
  assert.equal(mine.status, "done");
  assert.equal(mine.result, "submitted");
  assert.equal(mine.maxTurns, RUN_MAX_TURNS);
  assert.equal(mine.history[0].result.account.address, f.VAULT);
  assert.equal(typeof mine.history[2].result.logHash, "string");

  assert.deepEqual(stranger.history.map((turn) => turn.tool), ["read_account", "assemble_tx", "run", "submit"]);
  const text = JSON.stringify(stranger);
  for (const secret of [f.VAULT, mine.history[2].result.logHash, mine.history[1].result.input.tx, f.OWNER_A]) assert.ok(!text.includes(secret), "nothing of the fault's place");
  assert.deepEqual(stranger.history[0].result, { ok: true, account: {} }, "not even the size of what the agent read");
  assert.deepEqual(stranger.history[2].result, { ok: true, reproduced: true, usage: mine.history[2].result.usage });
  assert.deepEqual(stranger.history[3].result, { ok: true, verdict: "PASS", severity: "high" });
  assert.equal(stranger.finding, mine.finding, "that it filed a finding is no secret; the finding's own card seals the rest");
  assert.equal(await w.runService.feed(ORDER.id, "agent-none", f.OWNER_A, ORDER.protocol), null);

  // A turn nobody knows, and a refusal: kept short and empty.
  assert.deepEqual(sealedTurn({ tool: "run", result: { ok: false, refusal: "NETWORK", detail: "tried example.invalid" } }), { tool: "run", result: { ok: false, refusal: "NETWORK" } });
  assert.deepEqual(sealedTurn({ tool: "something-else", result: { secret: 1 } }), { tool: "something-else", result: {} });
  assert.deepEqual(feedOf(record({ history: [{ tool: "read_account", result: { ok: true, account: null } }] }), false).history, [{ tool: "read_account", result: { ok: true, account: null } }]);
});

test("an honest run that does not reproduce stops: no finding is filed, and it is not played again", async () => {
  const w = await world({ brain: { brain: runner.stubBrain({ plan: stubPlan({ exploit: HONEST }), moveMicroUsd: 50 }), moveMicroUsd: 50, ceilingMicroUsd: 40_000 } });
  const take = await w.take();
  await w.runService.launch(take);
  await w.settle();
  const run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(run.result, "stopped");
  assert.equal(run.finding, null);
  assert.deepEqual(await w.db.filedForOrder(ORDER.id), []);
  assert.deepEqual(await w.runService.launch(take), { ok: false, reason: "EXISTS" });
  assert.equal(w.asked.brain.length, 1, "no key is opened for a run that will not start");
});

test("what keeps a run from starting — and that nothing is called then", async () => {
  // Only the attacker's run is played.
  let w = await world();
  assert.deepEqual(await w.runService.launch(await w.take("agent-d", OWNER_B, "defender")), { ok: false, reason: "NO_RUN_FOR_ROLE" });
  // No range is kept for the order's copy.
  w = await world({ ranges: { forTarget: () => null, forPin: () => null, list: () => [] } });
  assert.deepEqual(await w.runService.launch(await w.take()), { ok: false, reason: "NO_RANGE" });
  // The agent has no key: it stays quiet.
  w = await world({ brain: null });
  assert.deepEqual(await w.runService.launch(await w.take()), { ok: false, reason: "NO_BRAIN" });
  assert.equal(w.asked.backends, 0, "no machine is asked for");
  assert.equal(await w.runs.get(ORDER.id, "agent-7"), null);
  // The order is paused, or its window is over.
  w = await world();
  const take = await w.take();
  await w.db.move(ORDER.id, "pause", ORDER.protocol, AT);
  assert.deepEqual(await w.runService.launch(take), { ok: false, reason: "CLOSED" });
  await w.db.move(ORDER.id, "resume", ORDER.protocol, AT);
  w.tick(ORDER.closesAt - AT + 1);
  assert.deepEqual(await w.runService.launch(take), { ok: false, reason: "CLOSED" });
  assert.equal(w.asked.brain.length, 0);
  // The day's ceiling is reached: the run holds the most its class may spend.
  w = await world({ cap: 500 });
  assert.deepEqual(await w.runService.launch(await w.take()), { ok: false, reason: "DAILY_CAP" }, "12 moves at 50 hold 600");
  assert.equal(w.tasks.length, 0);
  w = await world({ cap: 0 });
  assert.deepEqual(await w.runService.launch(await w.take()), { ok: false, reason: "DAILY_CAP" }, "a ceiling of nothing plays no run with a model");
  // A take the store does not hold.
  w = await world();
  assert.deepEqual(await w.runService.launch({ order: ORDER.id, hunter: "agent-x", owner: f.OWNER_A, role: "attacker", takenAt: AT }), { ok: false, reason: "NOT_TAKEN" });
});

test("the run holds its agent to the class ceiling, the turn cap and the run's own wall of time", async () => {
  const forever = (moveMicroUsd) => ({ brain: runner.stubBrain({ plan: stubPlan(), moveMicroUsd, loopForever: true }), moveMicroUsd, ceilingMicroUsd: 40_000 });
  // The turn cap: twelve moves, no submission.
  let w = await world({ brain: forever(10) });
  await w.runService.launch(await w.take());
  await w.settle();
  let run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(run.result, "over_turns");
  assert.equal(run.cost.spent, 120);
  // The class ceiling: a brain whose class allows less than its turns would cost.
  w = await world({ brain: { ...forever(50), ceilingMicroUsd: 170 } });
  await w.runService.launch(await w.take());
  await w.settle();
  run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(run.result, "out_of_budget");
  assert.equal(run.cost.reserved, 170);
  assert.ok(run.cost.spent <= 170);
  // The wall of the whole run: a brain that takes its time is stopped, and the run ends inside the function.
  const slow = { next: () => new Promise((resolve) => setTimeout(() => resolve({ kind: "action", action: { kind: "read", address: f.VAULT }, costMicroUsd: 1 }), 120)) };
  w = await world({ brain: { brain: slow, moveMicroUsd: 1, ceilingMicroUsd: 40_000 }, runMs: 300 });
  await w.runService.launch(await w.take());
  await w.settle();
  run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(run.result, "aborted");
  assert.ok(run.history.length < 12);
});

test("a machine that fails voids the run — nobody's loss — and it may be played again", async () => {
  let fail = true;
  const broken = { execute: async () => { throw new Error("the machine was gone"); }, close: async () => {} };
  const w = await world({ backend: () => (fail ? broken : inProc()) });
  const take = await w.take();
  await w.runService.launch(take);
  await w.settle();
  let run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(run.result, "void");
  assert.equal(run.finding, null);
  fail = false;
  assert.deepEqual(await w.runService.launch(take), { ok: true, attempt: 2 });
  await w.settle();
  run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(run.attempt, 2);
  assert.equal(run.result, "submitted");
});

test("a run whose harness went silent is voided by the next reader, and what it wrote after does not count", async () => {
  let release;
  const held = { next: () => new Promise((resolve) => (release = () => resolve({ kind: "action", action: { kind: "read", address: f.VAULT }, costMicroUsd: 5 }))) };
  const w = await world({ brain: { brain: held, moveMicroUsd: 5, ceilingMicroUsd: 40_000 } });
  const take = await w.take();
  await w.runService.launch(take);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await w.runService.feed(ORDER.id, "agent-7", f.OWNER_A)).status, "running");
  w.tick(STALLED_MS + 1);
  const feed = await w.runService.feed(ORDER.id, "agent-7", f.OWNER_A);
  assert.equal(feed.status, "done");
  assert.equal(feed.result, "void");
  // The harness wakes up and plays on: the store does not take it, and the run stops.
  release();
  await w.settle();
  const run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(run.result, "void");
  assert.equal(run.cost.spent, run.cost.reserved, "what it may have spent stays held");
  assert.deepEqual(await w.runService.launch(take), { ok: true, attempt: 2 });
});

// ------------------------------------------------------------------------------------------------ the routes

const BASE = "https://ryntra.io/api/arena/hack";
let keys = 0;

function routes(w, { open = true, withRuns = true } = {}) {
  const api = createHackApi({
    service: () => w.service,
    open: () => open,
    caller: async (req) => {
      const wallet = req.headers.get("x-test-wallet");
      return wallet ? { status: "ok", caller: { wallet, account: null } } : { status: "absent" };
    },
    network: () => "ip:00000000000000000000000000000000",
    store: w.db,
    ...(withRuns ? { runs: () => w.runService } : {}),
    now: () => AT,
  });
  const post = (action, body, wallet, key = `key-${++keys}-runs`) =>
    api[action](new Request(`${BASE}/${action}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://ryntra.io", "idempotency-key": key, "x-test-wallet": wallet }, body: JSON.stringify(body) }));
  const get = (path, wallet) => api[path.split("?")[0]](new Request(`${BASE}/${path}`, { headers: wallet ? { "x-test-wallet": wallet } : {} }));
  return { api, post, get };
}

test("the routes: a take starts the run, a retried take never a second one, and the run's route serves the journal", async () => {
  const w = await world();
  const { post, get } = routes(w);
  const first = await post("take", { order: ORDER.id, hunter: "agent-7", role: "attacker" }, f.OWNER_A, "key-take-once");
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.take.hunter, "agent-7");
  assert.equal(body.again, false);
  assert.deepEqual(body.run, { started: true });

  // The same request again (the answer was lost on the way): the kept answer, and no second run.
  const retried = await post("take", { order: ORDER.id, hunter: "agent-7", role: "attacker" }, f.OWNER_A, "key-take-once");
  assert.equal(retried.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(await retried.json(), body);
  // The same take under a new key: the same take, and the run that is live stays the only one.
  const again = await (await post("take", { order: ORDER.id, hunter: "agent-7", role: "attacker" }, f.OWNER_A)).json();
  assert.equal(again.again, true);
  assert.deepEqual(again.run, { started: false, reason: "EXISTS" });
  assert.equal(w.tasks.length, 1);
  assert.equal(w.asked.backends, 1);
  await w.settle();

  const mine = await (await get(`run?order=${ORDER.id}&hunter=agent-7`, f.OWNER_A)).json();
  assert.equal(mine.run.status, "done");
  assert.equal(mine.run.result, "submitted");
  assert.equal(mine.run.history.length, 4);
  assert.equal(mine.run.history[0].result.account.address, f.VAULT);
  const owner = await (await get(`run?order=${ORDER.id}&hunter=agent-7`, ORDER.protocol)).json();
  assert.deepEqual(owner, mine);
  const guest = await (await get(`run?order=${ORDER.id}&hunter=agent-7`)).json();
  assert.equal(guest.run.result, "submitted");
  assert.ok(!JSON.stringify(guest).includes(f.VAULT));

  // The order's own record shows the finding the run filed, confirmed by the judge.
  const detail = await (await get(`order?id=${ORDER.id}`, ORDER.protocol)).json();
  assert.equal(detail.findings.length, 1);
  assert.equal(detail.findings[0].id, mine.run.finding);
  assert.equal(detail.findings[0].status, "confirmed");

  assert.deepEqual(await (await get(`run?order=${ORDER.id}&hunter=agent-none`, f.OWNER_A)).json(), { run: null });
  assert.equal((await get("run?order=no-such-order&hunter=agent-7", f.OWNER_A)).status, 404);
  assert.equal((await get("run?order=bad id&hunter=agent-7", f.OWNER_A)).status, 400);
  assert.equal((await get(`run?order=${ORDER.id}`, f.OWNER_A)).status, 400);
});

test("the routes: closed is closed for the run too; with no machine a take is only a take; a defender's take plays no run", async () => {
  let w = await world();
  assert.equal((await routes(w, { open: false }).get(`run?order=${ORDER.id}&hunter=agent-7`, f.OWNER_A)).status, 404);

  const none = routes(w, { withRuns: false });
  const taken = await (await none.post("take", { order: ORDER.id, hunter: "agent-7", role: "attacker" }, f.OWNER_A)).json();
  assert.equal(taken.take.hunter, "agent-7");
  assert.equal("run" in taken, false);
  assert.deepEqual(await (await none.get(`run?order=${ORDER.id}&hunter=agent-7`, f.OWNER_A)).json(), { run: null });
  assert.equal(w.tasks.length, 0);

  w = await world();
  const defended = await (await routes(w).post("take", { order: ORDER.id, hunter: "agent-d", role: "defender" }, OWNER_B)).json();
  assert.deepEqual(defended.run, { started: false, reason: "NO_RUN_FOR_ROLE" });
  // A take the rules refuse starts nothing.
  const refused = await routes(w).post("take", { order: ORDER.id, hunter: "agent-p", role: "attacker" }, ORDER.protocol);
  assert.equal(refused.status, 403);
  assert.equal(w.tasks.length, 0);
});

test("the routes on the machine: the same way with the sandbox as a real process — one run, one finding, the day's ceiling held", async () => {
  // The entry as the machine runs it, over the made-up engine; its probe looks at a port nothing listens on.
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const stamp = { stamp: f.judgeLib.createStamper(privateKey), signer: f.judgeLib.signerOf(publicKey) };
  const here = (name) => fileURLToPath(new URL(name, import.meta.url));
  const driver = createProcessDriver({ entry: here("../machine/entry.mjs"), rig: here("../machine/testing/toy-rig.mjs"), isolated: false, env: { RYNTRA_HACK_PROBE: `127.0.0.1:${port}` } });
  const w = await world({ backend: () => createMachineBackend({ driver, stamp, engine: f.toy.TOY_ENGINE }), cap: 1_000 });
  const { post, get } = routes(w);

  const [a, b] = await Promise.all([
    post("take", { order: ORDER.id, hunter: "agent-7", role: "attacker" }, f.OWNER_A, "key-machine-take"),
    post("take", { order: ORDER.id, hunter: "agent-7", role: "attacker" }, f.OWNER_A, "key-machine-take"),
  ]);
  const started = [await a.json(), await b.json()].filter((body) => body.run?.started === true);
  assert.equal(started.length >= 1, true);
  assert.equal(w.tasks.length, 1, "two copies of one request at once: one run");
  // The day's ceiling holds 600 of 1 000: a second agent's run does not fit.
  const second = await (await post("take", { order: ORDER.id, hunter: "agent-9", role: "attacker" }, OWNER_B)).json();
  assert.deepEqual(second.run, { started: false, reason: "DAILY_CAP" });
  await w.settle();

  const feed = await (await get(`run?order=${ORDER.id}&hunter=agent-7`, f.OWNER_A)).json();
  assert.equal(feed.run.result, "submitted");
  assert.equal(feed.run.history[3].result.verdict, "PASS");
  const filed = await w.db.filedForOrder(ORDER.id);
  assert.equal(filed.length, 1);
  assert.equal(filed[0].finding.status, "confirmed");
  assert.equal(filed[0].finding.logHash, feed.run.history[3].result.logHash);
  // Once it is over the run counts what it spent, and the second agent's run fits.
  assert.equal(await w.runs.spent(day0), 200);
  const retry = await (await post("take", { order: ORDER.id, hunter: "agent-9", role: "attacker" }, OWNER_B)).json();
  assert.deepEqual(retry.run, { started: true });
  await w.settle();
  const dup = await w.db.filedForOrder(ORDER.id);
  assert.equal(dup.length, 2);
  assert.deepEqual(dup.map((x) => x.finding.status).sort(), ["confirmed", "duplicate"], "who first: the second agent's same fault is a duplicate");
});

// -------------------------------------------------------------------------------- what the review of 10.11 asked for

test("a proof is for one finding of one agent of one owner on one order: nobody files beside the run while it is filing", async () => {
  const seen = {};
  const w = await world({
    beforeFile: async ({ finding, service, runService }) => {
      // While the run's own filing is on its way, the proof answers only for exactly that finding.
      seen.own = runService.proofFor(finding) !== null;
      seen.otherHunter = runService.proofFor({ ...finding, hunter: "agent-9" });
      seen.otherOwner = runService.proofFor({ ...finding, hunterOwner: OWNER_B });
      seen.otherOrder = runService.proofFor({ ...finding, order: "order-2" });
      seen.otherLog = runService.proofFor({ ...finding, logHash: "0".repeat(64) });
      seen.otherId = runService.proofFor({ ...finding, id: "f-by-hand" });
      // Another owner's agent on the same order, filing the run's own id and log by hand in that very moment.
      await w.db.take({ order: ORDER.id, hunter: "agent-9", owner: OWNER_B, role: "attacker" }, null, AT);
      seen.byHand = await service.submit({ wallet: OWNER_B, account: null }, { id: finding.id, order: finding.order, hunter: "agent-9", target: finding.target, vulnClass: finding.vulnClass, severity: finding.severity, title: finding.title, logHash: finding.logHash });
    },
  });
  await w.runService.launch(await w.take());
  await w.settle();
  assert.equal(seen.own, true);
  for (const other of ["otherHunter", "otherOwner", "otherOrder", "otherLog", "otherId"]) assert.equal(seen[other], null, other);
  assert.equal(seen.byHand.ok, true);
  assert.equal(seen.byHand.value.finding.status, "needs_review", "the hand-filed copy has no proof");
  assert.equal(seen.byHand.value.finding.reason, "NO_EVIDENCE");
});

test("the run's wall is the agent's time running out, however its last call came back: aborted, never played again", async () => {
  // A brain that honours the stop the way the gateway does: its call comes back as nobody's fault.
  const patient = { next: (_view, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ kind: "void", reason: "aborted", costMicroUsd: 7 }), { once: true })) };
  const w = await world({ brain: { brain: patient, moveMicroUsd: 7, ceilingMicroUsd: 40_000 }, runMs: 80 });
  const take = await w.take();
  await w.runService.launch(take);
  await w.settle();
  const run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(run.result, "aborted");
  assert.equal(run.cost.spent, 7);
  assert.deepEqual(await w.runService.launch(take), { ok: false, reason: "EXISTS" });
});

test("a run a reader voided while it was proving files nothing; one whose last write failed after filing stays as it ended", async () => {
  // Voided while the counted attempt was on the machine: the finding is not filed, the next attempt may play.
  let world1;
  const voiding = () => {
    const inner = inProc();
    return {
      async execute(args) {
        if (args.prove) {
          const live = await world1.runs.get(ORDER.id, "agent-7");
          await world1.runs.put({ ...live, status: "done", result: "void", detail: "the harness went silent", cost: { reserved: live.cost.reserved, spent: null } });
        }
        return inner.execute(args);
      },
      close: () => inner.close(),
    };
  };
  world1 = await world({ backend: voiding });
  const take = await world1.take();
  await world1.runService.launch(take);
  await world1.settle();
  assert.deepEqual(await world1.db.filedForOrder(ORDER.id), [], "nothing was filed for a run that is no longer kept");
  assert.equal((await world1.runs.get(ORDER.id, "agent-7")).result, "void");

  // The finding is filed, then the store fails once on the last write: the run is still «submitted», with its finding.
  let failed = false;
  const w = await world({
    wrapRuns: (store) => ({
      ...store,
      durable: store.durable,
      async put(record) {
        if (!failed && record.status === "done" && record.result === "submitted") {
          failed = true;
          throw new Error("the store was gone for a moment");
        }
        return store.put(record);
      },
    }),
  });
  const again = await w.take();
  await w.runService.launch(again);
  await w.settle();
  const run = await w.runs.get(ORDER.id, "agent-7");
  assert.equal(failed, true);
  assert.equal(run.result, "submitted");
  assert.ok(run.finding);
  assert.equal((await w.db.filedForOrder(ORDER.id)).length, 1);
  assert.deepEqual(await w.runService.launch(again), { ok: false, reason: "EXISTS" }, "a run with a finding filed is never played again");
});

test("an order opens only on a copy that is kept, where the deployment says which; the run store says whether it answers", async () => {
  const w = await world({ playable: (target) => target.slot === ORDER.target.slot });
  const other = { ...ORDER, id: "order-nowhere", target: { ...ORDER.target, slot: ORDER.target.slot + 1 }, status: "draft" };
  const grant = f.makeGrant(other);
  const refused = await w.service.open({ wallet: other.protocol, account: null }, { order: other, grant });
  assert.deepEqual([refused.ok, refused.code], [false, "BAD_ORDER"]);
  assert.match(refused.message, /No copy is kept/);
  const kept = { ...ORDER, id: "order-kept", status: "draft" };
  assert.equal((await w.service.open({ wallet: kept.protocol, account: null }, { order: kept, grant: f.makeGrant(kept) })).ok, true);

  assert.equal(await w.runService.reachable(), true);
  const down = await world({ wrapRuns: (store) => ({ ...store, durable: store.durable, spent: async () => Promise.reject(new Error("no such function")) }) });
  assert.equal(await down.runService.reachable(), false);
});
