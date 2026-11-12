// Run from repo root: node --test city/lib/arena/hack/view/view.test.mjs
/*
 * CITY-227: Hack's windows, under the markup — the order's phase and time left, the scope in one name, the run's
 * journal as steps a person reads (the real runner's journal), a finding's level and where it stands, the board; the
 * client against the real routes of CITY-226 on the stand; the window's store walked the whole way: the orders, an
 * order, «Send an agent» (signed out, no agent, refused, sent), the run live, the owner's stop.
 */
import { createStand, OWNER_A, OWNER_B, PROTOCOL, OWNER_C, A5, A7, A8, A9 } from "./stand.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const model = await import("./model.ts");
const { createHttpHack, HackClientError } = await import("./client.ts");
const { createHackStore, problemOf } = await import("./store.ts");
const { hackOpen } = await import("./flag.ts");

const HOUR = 3_600_000;
const label = (archetype) => archetype[0].toUpperCase() + archetype.slice(1);

/** The client over the stand, as a browser on the site calls it. */
const clientOf = (stand) => createHttpHack({ fetch: (url, init) => stand.fetch(url, init) });

// ------------------------------------------------------------------------------------------------- the switch --

test("the switch: open only when it says open", () => {
  assert.equal(hackOpen("open"), true);
  assert.equal(hackOpen(" open "), true);
  for (const v of [undefined, "", "closed", "OPEN", "1", "true"]) assert.equal(hackOpen(v), false, String(v));
});

// --------------------------------------------------------------------------------------------------- orders --

test("an order's phase: soon before its window, closed after it, else its own status", () => {
  const o = { status: "open", opensAt: 1_000, closesAt: 5_000 };
  assert.equal(model.phaseOf(o, 500), "soon");
  assert.equal(model.phaseOf(o, 2_000), "open");
  assert.equal(model.phaseOf(o, 6_000), "closed");
  assert.equal(model.phaseOf({ ...o, status: "paused" }, 2_000), "paused");
  assert.equal(model.phaseOf({ ...o, status: "paused" }, 6_000), "closed");
  assert.equal(model.phaseOf({ ...o, status: "settled" }, 6_000), "settled");
  assert.equal(model.takesAgents(o, 2_000), true);
  assert.equal(model.takesAgents({ ...o, status: "paused" }, 2_000), false);
});

test("time left in the biggest whole unit, and nothing once it is over", () => {
  assert.deepEqual(model.timeLeft(10 * 60_000, 0), { unit: "m", n: 10 });
  assert.deepEqual(model.timeLeft(59 * 60_000, 0), { unit: "m", n: 59 });
  assert.deepEqual(model.timeLeft(59 * 60_000 + 1, 0), { unit: "h", n: 1 });
  assert.deepEqual(model.timeLeft(5 * HOUR, 0), { unit: "h", n: 5 });
  assert.deepEqual(model.timeLeft(47 * HOUR, 0), { unit: "h", n: 47 });
  assert.deepEqual(model.timeLeft(5 * 24 * HOUR, 0), { unit: "d", n: 5 });
  assert.equal(model.timeLeft(0, 0), null);
  assert.equal(model.timeLeft(10, 20), null);
});

test("the scope in one name: its instructions by name, or the whole program — never an address", () => {
  assert.deepEqual(model.scopeName({ programs: ["P"], instructions: ["withdraw", "deposit"] }), { kind: "named", names: ["withdraw", "deposit"], more: 0 });
  assert.deepEqual(model.scopeName({ programs: ["P"], instructions: ["claim", "split", "stake"] }), { kind: "named", names: ["claim", "split"], more: 1 });
  assert.deepEqual(model.scopeName({ programs: ["P", "Q"] }), { kind: "whole", programs: 2 });
  assert.deepEqual(model.scopeName({ programs: ["P"], instructions: [] }), { kind: "whole", programs: 1 });
  assert.equal(model.short("NVcjry6DLTahpw4BJRYfnu29GPWdksz7EMUbiqx5CKSZ"), "NVcj…CKSZ");
  assert.equal(model.short(null), "—");
});

test("open orders first, the one closing soonest on top; the door counts the open ones", () => {
  const at = 10_000;
  const orders = [
    { id: "closed", status: "open", opensAt: 0, closesAt: 5_000 },
    { id: "late", status: "open", opensAt: 0, closesAt: 90_000 },
    { id: "soon", status: "open", opensAt: 20_000, closesAt: 90_000 },
    { id: "first", status: "open", opensAt: 0, closesAt: 30_000 },
    { id: "paused", status: "paused", opensAt: 0, closesAt: 90_000 },
  ];
  assert.deepEqual(model.sortOrders(orders, at).map((o) => o.id), ["first", "late", "soon", "paused", "closed"]);
  assert.deepEqual(model.summaryOf(orders, at), { open: 2, total: 5 });
});

// ---------------------------------------------------------------------------------------------------- agents --

test("an agent's look: your own by its name and body; anyone else's by body and four characters of its id", () => {
  const mine = { id: "agent-7", name: "Engineer AGEN", archetype: "engineer" };
  assert.deepEqual(model.lookOf("agent-7", "attacker", mine, label), { name: "Engineer AGEN", archetype: "engineer", mine: true });
  assert.deepEqual(model.lookOf("agent-9", "defender", mine, label), { name: "Tactician AGEN", archetype: "tactician", mine: false });
  assert.deepEqual(model.lookOf("x5-ok", "attacker", null, label), { name: "Engineer X5OK", archetype: "engineer", mine: false });
  const a = model.lookOf("whoever", null, null, label);
  assert.deepEqual(model.lookOf("whoever", null, null, label), a, "the same agent looks the same every time");
  assert.equal(a.name, `${label(a.archetype)} WHOE`);
});

// ------------------------------------------------------------------------------------------------- the run --

test("the run's journal — the real runner's — as the steps a person reads, with the figures behind «i»", async () => {
  const stand = await createStand();
  const steps = model.stepsOf(stand.journal);
  assert.deepEqual(steps.map((s) => s.kind), ["read", "build", "held", "build", "broke", "filed"]);
  assert.deepEqual(steps.map((s) => s.n), [1, 2, 3, 4, 5, 6]);
  assert.equal(typeof steps[0].facts.size, "number");
  assert.ok(steps[1].facts.bytes > 0);
  assert.ok(steps[4].facts.units > 0 && steps[4].facts.steps > 0);
  assert.match(String(steps[4].facts.journal), /^[0-9a-f]{8}…[0-9a-f]{6}$/);
  assert.equal(steps[5].facts.verdict, "PASS");
  // Nothing of the copy's raw data reaches the steps.
  assert.doesNotMatch(JSON.stringify(steps), /dataBase64|"tx":/);
});

test("refusals and unknown tools: a refused step says so, an unknown one stays out", () => {
  const steps = model.stepsOf([
    { tool: "read_account", result: { ok: false, detail: "no such account in the copy" } },
    { tool: "assemble_tx", result: { ok: false, detail: "too large" } },
    { tool: "run", result: { ok: false, refusal: "LIMITS", detail: "steps" } },
    { tool: "run", result: { ok: true, reproduced: null, usage: { steps: 1, cu: 10 }, logHash: "x" } },
    { tool: "submit", result: { ok: true, verdict: "NEEDS_REVIEW", logHash: "a".repeat(64) } },
    { tool: "think", result: {} },
    null,
  ]);
  assert.deepEqual(steps.map((s) => s.kind), ["refused", "refused", "refused", "unclear", "review"]);
  assert.equal(steps[2].facts.why, "LIMITS");
  assert.equal(steps[3].facts.journal, "—", "a hash that is not one is not shown");
});

test("where a run stands, and its turns of the cap", () => {
  const broke = { tool: "run", result: { ok: true, reproduced: true } };
  assert.equal(model.runPhase({ status: "running", result: null, history: [] }), "running");
  assert.equal(model.runPhase({ status: "done", result: "submitted", history: [] }), "found");
  assert.equal(model.runPhase({ status: "done", result: "stopped", history: [] }), "clean");
  assert.equal(model.runPhase({ status: "done", result: "over_turns", history: [broke] }), "stopped");
  assert.equal(model.runPhase({ status: "done", result: "aborted", history: [] }), "stopped");
  assert.equal(model.runPhase({ status: "done", result: "out_of_budget", history: [] }), "spent");
  assert.equal(model.runPhase({ status: "done", result: "fault", history: [] }), "fault");
  assert.equal(model.runPhase({ status: "done", result: "void", history: [] }), "void");
  assert.deepEqual(model.turnsOf({ history: [1, 2, 3], maxTurns: 10 }), { n: 3, max: 10 });
  assert.deepEqual(model.turnsOf({ history: [1, 2, 3], maxTurns: 2 }), { n: 2, max: 3 });
});

// --------------------------------------------------------------------------------------------- the stand --

test("the order's own record stands in for a run whose journal is not served: took, then each finding", async () => {
  const stand = await createStand();
  stand.as(OWNER_A);
  const detail = await clientOf(stand).order("vault-audit");
  const steps = model.eventsOf(detail, A7);
  assert.deepEqual(steps.map((s) => s.kind), ["took", "finding", "finding"]);
  assert.equal(steps[0].role, "attacker");
  assert.deepEqual(steps.slice(1).map((s) => [s.tone, s.severity]), [["confirmed", "high"], ["review", "medium"]]);
  assert.deepEqual(model.eventsOf(detail, "nobody"), []);
  assert.deepEqual(model.eventsOf(null, A7), []);
});

test("a finding's level and where it stands; only the protocol's owner confirms, and only a run in the copy", async () => {
  const stand = await createStand();
  const client = clientOf(stand);
  stand.as(PROTOCOL);
  const owner = await client.order("vault-audit");
  const [review] = model.sortFindings(owner.findings, true);
  assert.equal(review.status, "needs_review", "the owner sees what waits for its word on top");
  assert.equal(model.toneOf(review.status), "review");
  assert.equal(model.severityOf(review), "medium", "the claimed level, before it counts");
  assert.equal(model.canConfirm(review, owner.order, PROTOCOL), true);
  assert.equal(model.canReject(review, owner.order, PROTOCOL), true);
  assert.equal(model.canConfirm(review, owner.order, OWNER_A), false);
  assert.equal(model.canConfirm({ ...review, logHash: null }, owner.order, PROTOCOL), false, "no run, nothing to confirm");
  assert.equal(model.canReject({ ...review, logHash: null }, owner.order, PROTOCOL), true);
  assert.equal(model.canConfirm(review, { ...owner.order, status: "settled" }, PROTOCOL), false);

  stand.as(OWNER_C);
  const stranger = await client.order("vault-audit");
  assert.ok(stranger.findings.every((f) => f.sealed && f.title === undefined), "a stranger never sees where the fault is");
  assert.equal(model.canReject(stranger.findings[0], stranger.order, PROTOCOL), false);
  for (const [status, tone] of [["confirmed", "confirmed"], ["duplicate", "duplicate"], ["rejected", "missed"], ["blocked", "blocked"], ["submitted", "review"]]) {
    assert.equal(model.toneOf(status), tone);
  }
});

test("the board: attackers by the points of their confirmed findings, defenders by the orders they held", async () => {
  const stand = await createStand();
  const client = clientOf(stand);
  stand.as(OWNER_C);
  const { orders } = await client.orders();
  const details = await Promise.all(orders.map((o) => client.order(o.id)));
  const attackers = model.boardOf(details, "attacker", stand.now());
  assert.deepEqual(attackers.map((r) => [r.rank, r.hunter, r.score, r.count, r.best]), [
    [1, A8, 10, 1, "critical"],
    [2, A7, 6, 1, "high"],
    [3, A5, 4, 2, "medium"],
  ]);
  const defenders = model.boardOf(details, "defender", stand.now());
  assert.deepEqual(defenders.map((r) => [r.hunter, r.score, r.count]), [[A9, 0, 3]], "the lending desk ended with a confirmed finding: not held");
  assert.deepEqual(model.boardOf([], "attacker", 0), []);
});

// ------------------------------------------------------------------------------------------------ the client --

test("the client reads the real routes' answers and says their refusals by code", async () => {
  const stand = await createStand();
  const client = clientOf(stand);
  stand.as(OWNER_A);
  const { orders } = await client.orders();
  assert.equal(orders.length, 4);
  const { finding } = await client.finding((await client.order("vault-audit")).findings[0].id);
  assert.equal(finding.sealed, false);
  assert.deepEqual(await client.run("vault-audit", A7), { run: null }, "no run of the stand's: none, not a failure");

  await assert.rejects(client.take("vault-audit", A9, "attacker", "key-take-0001"), (e) => e instanceof HackClientError && e.code === "NOT_YOUR_AGENT");
  await assert.rejects(client.order("nope"), (e) => e instanceof HackClientError && e.status === 404 && e.code === "NOT_FOUND");
  const sent = await client.take("swap-rounding", A7, "attacker", "key-take-0002");
  assert.equal(sent.take.hunter, A7);
  const again = await client.take("swap-rounding", A7, "attacker", "key-take-0002");
  assert.deepEqual(again, sent, "the same key, the same answer");
  const { run } = await client.run("swap-rounding", A7);
  assert.equal(run.status, "running");
  assert.equal(run.history.length, 1);

  stand.as(PROTOCOL);
  const paused = await client.move("vault-audit", "pause", "key-move-0001");
  assert.equal(paused.order.status, "paused");
});

test("the client: a lost connection, an unread answer and a missing run route each have their own code", async () => {
  const offline = createHttpHack({ fetch: async () => Promise.reject(new TypeError("network")) });
  await assert.rejects(offline.orders(), (e) => e.code === "OFFLINE" && e.status === 0);
  const odd = createHttpHack({ fetch: async () => Response.json({ orders: [{ nope: true }] }) });
  await assert.rejects(odd.orders(), (e) => e.code === "BAD_ANSWER");
  const shut = createHttpHack({ fetch: async () => Response.json({ error: { code: "CLOSED", message: "x" } }, { status: 404 }) });
  await assert.rejects(shut.run("o", "h"), (e) => e.code === "CLOSED", "a closed door is not «no run»");
  const noRoute = createHttpHack({ fetch: async () => Response.json({ error: { code: "NOT_FOUND", message: "There is no such route." } }, { status: 404 }) });
  assert.deepEqual(await noRoute.run("o", "h"), { run: null });
});

// ------------------------------------------------------------------------------------------------- the store --

function storeOn(stand, { agent = { id: A7, name: "Engineer AGEN", archetype: "engineer" }, signed = true, signIn = async () => true } = {}) {
  const asked = { signIn: 0, make: 0, readAgent: 0 };
  let keys = 0;
  let signedNow = signed;
  const store = createHackStore({
    client: () => clientOf(stand),
    newKey: () => `key-${++keys}-store`,
    agent: () => agent,
    signedIn: () => signedNow,
    readAgent: async () => {
      asked.readAgent += 1;
    },
    signIn: async () => {
      asked.signIn += 1;
      const ok = await signIn();
      if (ok) signedNow = true;
      return ok;
    },
    makeAgent: () => {
      asked.make += 1;
    },
  });
  return { store, asked };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("the store: the door reads the orders and the agent; an order, its card; «Back» walks back", async () => {
  const stand = await createStand();
  stand.as(OWNER_A);
  const { store, asked } = storeOn(stand);
  store.getState().show();
  await settle();
  await store.getState().readOrders();
  assert.equal(store.getState().orders.status, "read");
  assert.equal(store.getState().orders.value.length, 4);
  assert.equal(asked.readAgent, 1);

  store.getState().openOrder("vault-audit");
  await store.getState().readOrder();
  assert.equal(store.getState().screen, "order");
  assert.equal(store.getState().order.value.order.id, "vault-audit");

  const fid = store.getState().order.value.findings[0].id;
  store.getState().openFinding(fid);
  await store.getState().readFinding();
  assert.equal(store.getState().finding.value.id, fid);
  assert.deepEqual(store.getState().trail, ["orders", "order"]);

  store.getState().back();
  assert.equal(store.getState().screen, "order");
  store.getState().back();
  assert.equal(store.getState().screen, "orders");
  store.getState().back();
  assert.equal(store.getState().screen, "orders", "nothing behind the door: it stays");

  store.getState().openOrder("gone-order");
  await store.getState().readOrder();
  assert.deepEqual(store.getState().order, { status: "read", value: null }, "an order that is gone reads as gone, not as a failure");
});

test("«Send an agent»: signed out — the wallet first; no agent — the garage; then sent, and its run live", async () => {
  const stand = await createStand();
  stand.as(OWNER_A);

  const out = storeOn(stand, { signed: false, signIn: async () => false });
  out.store.getState().openOrder("swap-rounding");
  await out.store.getState().sendAgent();
  assert.equal(out.asked.signIn, 1);
  assert.equal(out.store.getState().problem, "signIn");

  const none = storeOn(stand, { agent: null });
  none.store.getState().openOrder("swap-rounding");
  await none.store.getState().sendAgent();
  assert.equal(none.store.getState().problem, "noAgent");
  none.store.getState().makeAgent();
  assert.equal(none.asked.make, 1);
  assert.equal(none.store.getState().problem, null);

  const { store } = storeOn(stand, { signed: false });
  store.getState().openOrder("swap-rounding");
  store.getState().setRole("attacker");
  await store.getState().sendAgent();
  assert.equal(store.getState().problem, null);
  assert.equal(store.getState().screen, "run");
  assert.equal(store.getState().hunter, A7);
  await store.getState().readRun();
  let feed = store.getState().run.value;
  assert.ok(feed && feed.status === "running");
  for (let i = 0; i < 8 && feed.status === "running"; i += 1) {
    await store.getState().readRun();
    feed = store.getState().run.value;
  }
  assert.equal(feed.status, "done");
  assert.equal(model.runPhase(feed), "found");
  assert.ok(feed.finding, "the run filed its finding through the real route");
  assert.ok(store.getState().order.value.findings.some((f) => f.id === feed.finding));
});

test("«Send an agent» refused: the protocol's own order, the other side, a shut order — each said, none a dead end", async () => {
  const stand = await createStand();
  stand.as(OWNER_B);
  const { store } = storeOn(stand, { agent: { id: A9, name: "Tactician AGEN", archetype: "tactician" } });
  store.getState().openOrder("vault-audit");
  store.getState().setRole("attacker");
  await store.getState().sendAgent();
  assert.equal(store.getState().problem, "oneSide", "agent-9 already defends this order");
  store.getState().setRole("defender");
  assert.equal(store.getState().problem, null, "changing side clears it");

  stand.as(OWNER_C);
  const late = storeOn(stand, { agent: { id: A5, name: "Engineer 5AB0", archetype: "engineer" } }).store;
  late.getState().openOrder("lending-liquidation");
  await late.getState().sendAgent();
  assert.equal(late.getState().problem, "shut", "past its window");
  assert.equal(late.getState().screen, "order", "it stays on the card, which reads the order again");

  assert.equal(problemOf(new HackClientError(409, "SELF_AUDIT", "")), "ownOrder");
  assert.equal(problemOf(new HackClientError(403, "AGENT_OFF", "")), "agentOff");
  assert.equal(problemOf(new HackClientError(429, "RATE_LIMITED", "")), "tooMany");
  assert.equal(problemOf(new HackClientError(409, "NO_RUN", "")), "noRun");
  assert.equal(problemOf(new HackClientError(409, "UNRESOLVED", "")), "unresolved");
  assert.equal(problemOf(new HackClientError(503, "UNAVAILABLE", "")), "unreachable");
  assert.equal(problemOf(new Error("boom")), "unreachable");
});

test("a retry after a lost connection sends the first try's key; a refusal for good starts a new one", async () => {
  const stand = await createStand();
  stand.as(OWNER_A);
  const sent = [];
  let fail = true;
  const client = createHttpHack({
    fetch: async (url, init) => {
      if (init?.method === "POST") sent.push(new Headers(init.headers).get("idempotency-key"));
      if (fail && init?.method === "POST") return Promise.reject(new TypeError("network"));
      return stand.fetch(url, init);
    },
  });
  let keys = 0;
  const store = createHackStore({ client: () => client, newKey: () => `key-${++keys}-retry`, agent: () => ({ id: A7, name: "E", archetype: "engineer" }), signedIn: () => true });
  store.getState().openOrder("swap-rounding");
  await store.getState().sendAgent();
  assert.equal(store.getState().problem, "unreachable");
  fail = false;
  await store.getState().sendAgent();
  assert.equal(store.getState().problem, null);
  assert.deepEqual(sent, ["key-1-retry", "key-1-retry"]);
});

test("Confirm a run left for review; the owner's stop and start", async () => {
  const stand = await createStand();
  stand.as(PROTOCOL);
  const { store } = storeOn(stand, { agent: null });
  store.getState().setMe(PROTOCOL);
  store.getState().openOrder("vault-audit");
  await store.getState().readOrder();
  const review = store.getState().order.value.findings.find((f) => f.status === "needs_review");
  store.getState().openFinding(review.id);
  await store.getState().readFinding();
  await store.getState().resolve("confirm");
  assert.equal(store.getState().finding.value.status, "confirmed");
  await store.getState().resolve("reject");
  assert.equal(store.getState().problem, "decided", "a finding decided is said so, and read again");

  store.getState().back();
  await store.getState().moveOrder("pause");
  assert.equal(store.getState().order.value.order.status, "paused");
  await store.getState().moveOrder("resume");
  assert.equal(store.getState().order.value.order.status, "open");

  stand.as(OWNER_B);
  await store.getState().moveOrder("pause");
  assert.equal(store.getState().problem, "unreachable", "not the owner: refused (the window never offers it)");
});

test("a closed door: every read says closed, and nothing is retried as a failure", async () => {
  const shut = createHttpHack({ fetch: async () => Response.json({ error: { code: "CLOSED", message: "Hack is not open yet." } }, { status: 404 }) });
  const store = createHackStore({ client: () => shut });
  await store.getState().readOrders();
  assert.equal(store.getState().orders.status, "closed");
  await store.getState().readBoard();
  assert.equal(store.getState().board.status, "closed");
});

test("the board reads the newest orders and survives one it cannot read", async () => {
  const stand = await createStand();
  stand.as(OWNER_C);
  const flaky = createHttpHack({ fetch: (url, init) => (String(url).includes("order?id=staking-claims") ? Promise.reject(new TypeError("x")) : stand.fetch(url, init)) });
  const store = createHackStore({ client: () => flaky, boardOrders: 3 });
  await store.getState().readBoard();
  const { board } = store.getState();
  assert.equal(board.status, "read");
  assert.deepEqual(board.value.map((d) => d.order.id).sort(), ["swap-rounding", "vault-audit"], "the 3 newest, less the one that failed");
});

test("a take whose run did not start says why: the day is done, or the agent has no key — never a run that seems to go on (CITY-238)", async () => {
  const stand = await createStand();
  stand.as(OWNER_A);
  let run = { started: true };
  // The server's own word on the take's run rides on the take's answer.
  const client = createHttpHack({
    fetch: async (url, init) => {
      const res = await stand.fetch(url, init);
      if (init?.method !== "POST" || !String(url).endsWith("/take") || !res.ok) return res;
      return Response.json({ ...(await res.json()), run }, { status: res.status });
    },
  });
  const sending = async (order, answer) => {
    run = answer;
    let keys = 0;
    const store = createHackStore({ client: () => client, newKey: () => `key-${order}-${++keys}`, agent: () => ({ id: A7, name: "E", archetype: "engineer" }), signedIn: () => true });
    store.getState().openOrder(order);
    await store.getState().sendAgent();
    return store.getState();
  };
  const started = await sending("swap-rounding", { started: true });
  assert.equal(started.screen, "run");
  assert.equal(started.problem, null);
  const resting = await sending("swap-rounding", { started: false, reason: "DAILY_CAP" });
  assert.equal(resting.screen, "run", "the take stands: the agent is on the order");
  assert.equal(resting.problem, "resting");
  assert.equal((await sending("swap-rounding", { started: false, reason: "NO_BRAIN" })).problem, "quiet");
  // Anything else that kept the run from starting is said too: the agent is on the order, the run is not going.
  assert.equal((await sending("swap-rounding", { started: false, reason: "NO_RANGE" })).problem, "idle");
  assert.equal((await sending("swap-rounding", { started: false, reason: "UNAVAILABLE" })).problem, "idle");
  // A run that is already there, or a side that plays none, is nothing to say.
  assert.equal((await sending("swap-rounding", { started: false, reason: "EXISTS" })).problem, null);
  assert.equal((await sending("swap-rounding", { started: false, reason: "NO_RUN_FOR_ROLE" })).problem, null);
});

// ----------------------------------------------------------------- the supervisor's review of the windows (10.11)

test("a slow answer never lands on top of a newer one: an order's read and a run's read each keep the latest", async () => {
  const stand = await createStand();
  stand.as(OWNER_A);
  const real = clientOf(stand);
  // The first read of the order is held back; the second answers at once with a newer state.
  const gates = [];
  let asks = 0;
  const client = {
    ...real,
    order: async (id) => {
      const mine = (asks += 1);
      const detail = await real.order(id);
      const stamped = { ...detail, order: { ...detail.order, title: `read ${mine}` } };
      if (mine === 1) await new Promise((release) => gates.push(release));
      return stamped;
    },
  };
  const store = createHackStore({ client: () => client });
  store.getState().openOrder("vault-audit");
  const second = store.getState().readOrder();
  await second;
  assert.equal(store.getState().order.value.order.title, "read 2");
  gates[0]();
  await settle();
  await settle();
  assert.equal(store.getState().order.value.order.title, "read 2", "the older answer came last and was let go");

  // The same for a run's journal.
  const runGates = [];
  let runAsks = 0;
  const feed = (n) => ({ order: "vault-audit", hunter: A7, role: "attacker", status: "running", maxTurns: 12, history: Array.from({ length: n }, () => ({ tool: "read_account", result: { ok: true, account: {} } })), result: null, finding: null, startedAt: 1 });
  const slowRun = {
    ...real,
    run: async () => {
      const mine = (runAsks += 1);
      if (mine === 1) await new Promise((release) => runGates.push(release));
      return { run: feed(mine === 1 ? 1 : 3) };
    },
  };
  const watching = createHackStore({ client: () => slowRun });
  watching.getState().openOrder("vault-audit");
  watching.getState().watch(A7);
  await watching.getState().readRun();
  assert.equal(watching.getState().run.value.history.length, 3);
  runGates[0]();
  await settle();
  await settle();
  assert.equal(watching.getState().run.value.history.length, 3, "three steps do not fall back to one");
});

test("«Back» stays short: a run and its finding, back and forth, never pile up", async () => {
  const stand = await createStand();
  stand.as(OWNER_A);
  const store = createHackStore({ client: () => clientOf(stand) });
  const st = () => store.getState();
  st().openOrder("vault-audit");
  await settle();
  const finding = st().order.value?.findings[0]?.id ?? "f-1";
  st().watch(A7);
  for (let i = 0; i < 40; i += 1) {
    st().openFinding(finding);
    st().watch(A7);
  }
  assert.deepEqual(st().trail, ["orders", "order"], "run ↔ finding is a step back each time");
  assert.equal(st().screen, "run");
  st().back();
  assert.equal(st().screen, "order");
  st().back();
  assert.equal(st().screen, "orders");
  // A long walk forward is cut to the last few screens, never kept whole.
  for (let i = 0; i < 30; i += 1) {
    st().openOrder(`order-${i}`);
    st().watch(A7);
    st().openFinding(`f-${i}`);
  }
  assert.ok(st().trail.length <= 8, `${st().trail.length} screens behind`);
});

test("the owner's verdict and the owner's stop ask for the sign-in themselves, then go — with the first try's key", async () => {
  const stand = await createStand();
  stand.as(PROTOCOL);
  const real = clientOf(stand);
  const sent = [];
  let signedIn = false;
  const asked = { signIn: 0 };
  const gated = (name) => async (...args) => {
    sent.push([name, args[args.length - 1]]);
    if (!signedIn) throw new HackClientError(401, "SIGN_IN", "Sign in with your wallet first.");
    return real[name](...args);
  };
  const client = { ...real, move: gated("move"), confirm: gated("confirm") };
  let keys = 0;
  let allow = true;
  const store = createHackStore({
    client: () => client,
    newKey: () => `key-${++keys}-owner`,
    signedIn: () => signedIn,
    signIn: async () => {
      asked.signIn += 1;
      if (allow) signedIn = true;
      return allow;
    },
  });
  store.getState().setMe(PROTOCOL);
  store.getState().openOrder("vault-audit");
  await settle();

  // The wallet is connected but not signed in: «Stop» signs in and stops, in one tap.
  await store.getState().moveOrder("pause");
  assert.equal(asked.signIn, 1);
  assert.equal(store.getState().problem, null);
  assert.equal(store.getState().order.value.order.status, "paused");
  assert.deepEqual(sent, [["move", "key-1-owner"], ["move", "key-1-owner"]], "the same request, once it may be made");

  // A sign-in the person declines leaves the line and its way on, and nothing done.
  signedIn = false;
  allow = false;
  await store.getState().moveOrder("resume");
  assert.equal(store.getState().problem, "signIn");
  assert.equal(store.getState().order.value.order.status, "paused");
  allow = true;
  await store.getState().moveOrder("resume");
  assert.equal(store.getState().order.value.order.status, "open");
});
