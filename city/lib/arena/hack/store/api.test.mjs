// Run from repo root: node --test city/lib/arena/hack/store/api.test.mjs
/*
 * CITY-226: Hack's routes on plain requests, over the memory store and the library's rules — the switch, the site, the
 * request key, the wallet, the limits; open, take, submit, move, confirm and the reads; the views that keep a finding's
 * place sealed from strangers; the deadline the system applies on the way; a store that fails is a 503 that did nothing.
 */
import { makeOrder, makeGrant, makeProof, verify, PROTOCOL, OWNER_A, OWNER_B, PROGRAM, PROGRAM2, AT, WINDOW, RUN_HASH, hashOf } from "../fixtures.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { createHackApi } = await import("./api.ts");
const { createHackService } = await import("./service.ts");
const { createMemoryHackDb } = await import("./memory.ts");
const { HACK_LIMITS, HackStoreUnavailable } = await import("./contract.ts");

const BASE = "https://ryntra.io/api/arena/hack";
const ACCOUNT = { [PROTOCOL]: "a:protocol", [OWNER_A]: "a:owner-a", [OWNER_B]: "a:owner-b" };

/**
 * One deployment for a test: the memory store on a clock the test moves, the library's rules on the fixtures' fake
 * signature check, the Ring's agents as a map, and a sandbox the test may plug in (`prove`).
 */
function setup({ open = true, prove = null, agents = true, limits = HACK_LIMITS, db: given } = {}) {
  let t = AT;
  const now = () => t;
  const db = given ?? createMemoryHackDb({ now });
  const roster = new Map([
    ["agent-7", { account: ACCOUNT[OWNER_A], active: true }],
    ["agent-8", { account: ACCOUNT[OWNER_A], active: true }],
    ["agent-9", { account: ACCOUNT[OWNER_B], active: true }],
    ["agent-p", { account: ACCOUNT[PROTOCOL], active: true }],
    ["agent-off", { account: ACCOUNT[OWNER_A], active: false }],
  ]);
  const proofs = { asked: [] };
  let ids = 0;
  const service = createHackService({
    db,
    verify,
    prove: async (input) => {
      proofs.asked.push(input);
      return prove ? prove(input) : null;
    },
    agentOf: agents ? async (hunter) => roster.get(hunter) ?? null : undefined,
    now,
    newId: () => `f-auto-${++ids}`,
    limits,
  });
  const api = createHackApi({
    service: () => service,
    open: () => open,
    caller: async (req) => {
      if (req.headers.get("x-test-session") === "down") return { status: "unavailable" };
      const wallet = req.headers.get("x-test-wallet");
      if (!wallet) return { status: "absent" };
      const account = req.headers.has("x-test-no-account") ? null : (ACCOUNT[wallet] ?? null);
      return { status: "ok", caller: { wallet, account } };
    },
    network: (req) => `ip:${hashOf(req.headers.get("x-test-net") ?? "net-1").slice(0, 32)}`,
    store: db,
    limits,
    now,
  });
  return { api, db, proofs, roster, tick: (ms) => (t += ms), at: () => t };
}

let keys = 0;
const nextKey = () => `key-${++keys}-abcdef`;

function post(action, body, { wallet, key = nextKey(), origin = "https://ryntra.io", net, headers = {} } = {}) {
  const h = { "content-type": "application/json", ...headers };
  if (origin) h.origin = origin;
  if (key) h["idempotency-key"] = key;
  if (wallet) h["x-test-wallet"] = wallet;
  if (net) h["x-test-net"] = net;
  return new Request(`${BASE}/${action}`, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) });
}

function get(path, { wallet } = {}) {
  return new Request(`${BASE}/${path}`, { headers: wallet ? { "x-test-wallet": wallet } : {} });
}

async function call(api, action, req) {
  const res = await api[action](req);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const order = (over = {}) => makeOrder({ id: `o-${++keys}`, ...over });

/** An order opened through the route by the protocol's wallet. */
async function opened(h, over = {}) {
  const o = order(over);
  const res = await call(h.api, "open", post("open", { order: o, grant: makeGrant(o) }, { wallet: PROTOCOL }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return o;
}

/** An order with OWNER_A's agent-7 on it as the attacker. */
async function hunted(h, over = {}) {
  const o = await opened(h, over);
  const res = await call(h.api, "take", post("take", { order: o.id, hunter: "agent-7", role: "attacker" }, { wallet: OWNER_A }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return o;
}

const findingBody = (o, over = {}) => ({
  order: o.id,
  hunter: "agent-7",
  target: { program: PROGRAM, instruction: "withdraw" },
  vulnClass: "auth-bypass",
  severity: "high",
  title: "Withdraw skips the owner check",
  logHash: RUN_HASH,
  ...over,
});

const submit = (h, o, over = {}, opts = {}) => call(h.api, "submit", post("submit", findingBody(o, over), { wallet: OWNER_A, ...opts }));

// ------------------------------------------------------------------------------------------------- the doors --

test("closed until the switch says open: every route is a 404 and nothing is written", async () => {
  const h = setup({ open: false });
  const o = order();
  const answers = [
    await call(h.api, "orders", get("orders")),
    await call(h.api, "order", get(`order?id=${o.id}`)),
    await call(h.api, "finding", get("finding?id=f-1")),
    await call(h.api, "open", post("open", { order: o, grant: makeGrant(o) }, { wallet: PROTOCOL })),
    await call(h.api, "take", post("take", { order: o.id, hunter: "agent-7", role: "attacker" }, { wallet: OWNER_A })),
    await call(h.api, "submit", post("submit", findingBody(o), { wallet: OWNER_A })),
    await call(h.api, "move", post("move", { order: o.id, move: "pause" }, { wallet: PROTOCOL })),
    await call(h.api, "confirm", post("confirm", { finding: "f-1", verdict: "confirm" }, { wallet: PROTOCOL })),
  ];
  for (const res of answers) {
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, "CLOSED");
  }
  assert.deepEqual(await h.db.listOrders(), []);
});

test("a write comes from this site, with a request key, as a small JSON object, from a wallet that signed in", async () => {
  const h = setup();
  const o = order();
  const body = { order: o, grant: makeGrant(o) };
  const code = async (req) => {
    const res = await call(h.api, "open", req);
    return [res.status, res.body.error?.code];
  };
  assert.deepEqual(await code(post("open", body, { wallet: PROTOCOL, origin: "https://evil.example" })), [403, "FORBIDDEN"]);
  assert.deepEqual(await code(post("open", body, { wallet: PROTOCOL, origin: null })), [403, "FORBIDDEN"], "no origin and no same-origin fetch");
  assert.deepEqual(await code(post("open", body, { wallet: PROTOCOL, key: null })), [400, "IDEMPOTENCY_KEY_REQUIRED"]);
  assert.deepEqual(await code(post("open", body, { wallet: PROTOCOL, key: "short" })), [400, "IDEMPOTENCY_KEY_REQUIRED"]);
  assert.deepEqual(await code(post("open", "not json", { wallet: PROTOCOL })), [400, "BAD_REQUEST"]);
  assert.deepEqual(await code(post("open", "[1,2]", { wallet: PROTOCOL })), [400, "BAD_REQUEST"]);
  assert.deepEqual(await code(post("open", { order: o, grant: makeGrant(o), pad: "x".repeat(20_000) }, { wallet: PROTOCOL })), [413, "PAYLOAD_TOO_LARGE"]);
  assert.deepEqual(await code(post("open", body)), [401, "SIGN_IN"]);
  assert.deepEqual(await code(post("open", body, { wallet: PROTOCOL, headers: { "x-test-session": "down" } })), [503, "UNAVAILABLE"]);
  assert.deepEqual(await h.db.listOrders(), [], "nothing was opened");
  const same = await call(h.api, "open", post("open", body, { wallet: PROTOCOL, origin: null, headers: { "sec-fetch-site": "same-origin" } }));
  assert.equal(same.status, 201, "a same-origin fetch without an Origin header is this site");
  assert.equal(same.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("a retried write gets the same answer and is done once; the same key for another body is refused", async () => {
  const h = setup();
  const o = order();
  const key = nextKey();
  const first = await call(h.api, "open", post("open", { order: o, grant: makeGrant(o) }, { wallet: PROTOCOL, key }));
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("idempotent-replayed"), null);
  const again = await call(h.api, "open", post("open", { order: o, grant: makeGrant(o) }, { wallet: PROTOCOL, key }));
  assert.equal(again.status, 201);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(again.body, first.body);
  const other = await call(h.api, "open", post("open", { order: { ...o, title: "Other" }, grant: makeGrant(o) }, { wallet: PROTOCOL, key }));
  assert.deepEqual([other.status, other.body.error.code], [422, "IDEMPOTENCY_KEY_REUSED"]);
  const fresh = await call(h.api, "open", post("open", { order: o, grant: makeGrant(o) }, { wallet: PROTOCOL }));
  assert.deepEqual([fresh.status, fresh.body.error.code], [409, "EXISTS"], "a new key for the same order: it is already open");
  assert.equal((await h.db.listOrders()).length, 1);
  // A key is the wallet's own: another wallet's same key is another request.
  const theirs = await call(h.api, "open", post("open", { order: o, grant: makeGrant(o) }, { wallet: OWNER_A, key }));
  assert.deepEqual([theirs.status, theirs.body.error.code], [403, "NOT_YOURS"]);
});

// ------------------------------------------------------------------------------------------------------ open --

test("open: the protocol's own wallet opens an order on a copy, with its signed permission over exactly this order", async () => {
  const h = setup();
  const o = order();
  const res = await call(h.api, "open", post("open", { order: o, grant: makeGrant(o) }, { wallet: PROTOCOL }));
  assert.equal(res.status, 201);
  assert.equal(res.body.order.status, "open", "a draft opens");
  assert.equal(res.body.order.id, o.id);
  assert.equal(res.body.order.permission.signature.signer, PROTOCOL);
  assert.equal(res.body.order.format, undefined);

  const refuse = async (body, wallet = PROTOCOL) => {
    const r = await call(h.api, "open", post("open", body, { wallet }));
    return [r.status, r.body.error?.code];
  };
  const o2 = order();
  assert.deepEqual(await refuse({ order: o2, grant: makeGrant(o2) }, OWNER_A), [403, "NOT_YOURS"]);
  assert.deepEqual(await refuse({ order: o2 }), [400, "BAD_REQUEST"]);
  const mainnet = order({ target: { kind: "mainnet", program: PROGRAM } });
  assert.deepEqual(await refuse({ order: mainnet, grant: makeGrant(mainnet) }), [422, "BAD_ORDER"], "never a live mainnet target");
  const closed = order({ status: "closed" });
  assert.deepEqual(await refuse({ order: closed, grant: makeGrant(closed) }), [422, "BAD_ORDER"]);
  assert.deepEqual(await refuse({ order: o2, grant: makeGrant(o2, { signature: { signature: "forged" } }) }), [422, "NO_PERMISSION"]);
  assert.deepEqual(await refuse({ order: o2, grant: makeGrant(o2, { body: { scope: { programs: [PROGRAM, PROGRAM2] } } }) }), [422, "NO_PERMISSION"], "a grant for another scope");
  assert.deepEqual(await refuse({ order: o2, grant: makeGrant(o2, { body: { target: { kind: "fork", program: PROGRAM, slot: 1 } } }) }), [422, "NO_PERMISSION"], "a grant for another copy");
  const over = order({ opensAt: WINDOW.opensAt - 10 * 3_600_000, closesAt: AT - 1 });
  assert.deepEqual(await refuse({ order: over, grant: makeGrant(over) }), [409, "WINDOW"]);
  const long = order({ closesAt: WINDOW.opensAt + 91 * 24 * 3_600_000 });
  assert.deepEqual(await refuse({ order: long, grant: makeGrant(long) }), [409, "WINDOW"]);
  assert.equal((await h.db.listOrders()).length, 1, "only the first opened");
});

test("open: a protocol opens five orders a day", async () => {
  const h = setup();
  for (let i = 0; i < HACK_LIMITS.ordersPerDay - 0; i += 1) await opened(h);
  const o = order();
  const res = await call(h.api, "open", post("open", { order: o, grant: makeGrant(o) }, { wallet: PROTOCOL }));
  assert.deepEqual([res.status, res.body.error.code], [429, "RATE_LIMITED"]);
});

// ------------------------------------------------------------------------------------------------------ take --

test("take: the owner sends their own active agent; once, one side, never against their own protocol", async () => {
  const h = setup();
  const o = await opened(h);
  const take = (body, wallet = OWNER_A, headers) => call(h.api, "take", post("take", { order: o.id, role: "attacker", ...body }, { wallet, headers }));
  const first = await take({ hunter: "agent-7" });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { take: { hunter: "agent-7", owner: OWNER_A, role: "attacker", takenAt: AT }, again: false });
  assert.equal((await take({ hunter: "agent-7" })).body.again, true);
  const code = async (...args) => {
    const r = await take(...args);
    return [r.status, r.body.error?.code];
  };
  assert.deepEqual(await code({ hunter: "agent-9" }), [403, "NOT_YOUR_AGENT"], "another account's agent");
  assert.deepEqual(await code({ hunter: "agent-unknown" }), [403, "NOT_YOUR_AGENT"]);
  assert.deepEqual(await code({ hunter: "agent-off" }), [409, "AGENT_OFF"]);
  assert.deepEqual(await code({ hunter: "agent-8" }, OWNER_A, { "x-test-no-account": "1" }), [401, "SIGN_IN"]);
  assert.deepEqual(await code({ hunter: "agent-8", role: "defender" }), [409, "BOTH_SIDES"]);
  assert.deepEqual(await code({ hunter: "agent-p" }, PROTOCOL), [403, "SELF_AUDIT"]);
  assert.deepEqual(await code({ hunter: "agent-7" }, OWNER_B), [403, "NOT_YOUR_AGENT"], "nobody takes another's agent id");
  assert.deepEqual(await code({ hunter: "agent-7", role: "spy" }), [400, "BAD_REQUEST"]);
  assert.deepEqual(await code({ hunter: "agent-7", order: "no-such-order" }), [404, "NOT_FOUND"]);
  assert.equal((await take({ hunter: "agent-p", role: "defender" }, PROTOCOL)).status, 200, "the protocol defends its own");
});

test("take on a developer's stand: agents are names, and the store still says who took which", async () => {
  const h = setup({ agents: false });
  const o = await opened(h);
  assert.equal((await call(h.api, "take", post("take", { order: o.id, hunter: "anything", role: "attacker" }, { wallet: OWNER_B }))).status, 200);
  const stolen = await call(h.api, "take", post("take", { order: o.id, hunter: "anything", role: "attacker" }, { wallet: OWNER_A }));
  assert.deepEqual([stolen.status, stolen.body.error.code], [409, "HUNTER_TAKEN"]);
});

// ---------------------------------------------------------------------------------------------------- submit --

test("submit without a sandbox: the finding waits for review — nothing counts without a run in the fork", async () => {
  const h = setup();
  const o = await hunted(h);
  const res = await submit(h, o, { id: "f-1", hunterOwner: OWNER_B, submittedAt: 1, status: "confirmed", proof: makeProof() });
  assert.equal(res.status, 201);
  assert.equal(res.body.outcome, "review");
  const f = res.body.finding;
  assert.equal(f.status, "needs_review");
  assert.equal(f.reason, "NO_EVIDENCE");
  assert.equal(f.payable, false);
  assert.equal(f.hunterOwner, OWNER_A, "the owner is the signed-in wallet, never the body's");
  assert.equal(f.submittedAt, AT, "the server's clock, never the body's");
  assert.equal(h.proofs.asked.length, 1);
  assert.equal(h.proofs.asked[0].finding.hunterOwner, OWNER_A);
});

test("submit with the sandbox's verdict: reproduced counts once; the same vulnerability again is a duplicate", async () => {
  const h = setup({ prove: ({ finding }) => makeProof({ logHash: finding.logHash }) });
  const o = await hunted(h);
  const first = await submit(h, o);
  assert.equal(first.status, 201);
  assert.equal(first.body.outcome, "counts");
  assert.equal(first.body.finding.status, "confirmed");
  assert.equal(first.body.finding.payable, true);
  assert.match(first.body.finding.id, /^f-[0-9a-f]{40}$/, "the server names a finding the body does not — from the wallet and the request key, so a copy sent at once is the same finding");
  const again = await submit(h, o, { target: { program: PROGRAM, instruction: "withdraw", account: PROGRAM } });
  assert.equal(again.body.outcome, "duplicate");
  assert.equal(again.body.finding.payable, false);
  const other = await submit(h, o, { vulnClass: "overflow" });
  assert.equal(other.body.outcome, "counts");
});

test("submit: the rules over the judge decide what the sandbox said", async () => {
  let next = {};
  const h = setup({ prove: ({ finding }) => makeProof({ logHash: finding.logHash, ...next }) });
  const o = await hunted(h);
  const outcome = async (proof, over = {}) => {
    next = proof;
    const res = await submit(h, o, { vulnClass: `c-${++keys}`, ...over });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return [res.body.outcome, res.body.finding.reason];
  };
  assert.deepEqual(await outcome({ verdict: "FAIL" }), ["rejected", "NOT_REPRODUCED"]);
  assert.deepEqual(await outcome({ verdict: "BLOCKED" }), ["blocked", "CHEAT"]);
  assert.deepEqual(await outcome({ verdict: "NEEDS_REVIEW" }), ["review", "NEEDS_REVIEW"]);
  assert.deepEqual(await outcome({ deterministic: false }), ["description", "DESCRIPTION_ONLY"], "a model's score never counts");
  assert.deepEqual(await outcome({ logHash: hashOf("another run") }), ["blocked", "EVIDENCE_MISMATCH"]);
  assert.deepEqual(await outcome({}, { target: { program: PROGRAM2 } }), ["blocked", "OUT_OF_SCOPE"]);
  assert.deepEqual(await outcome({}, { target: { program: PROGRAM, instruction: "admin" } }), ["blocked", "OUT_OF_SCOPE"]);
  assert.deepEqual(await outcome({}, { logHash: null }), ["review", "NO_EVIDENCE"]);
});

test("submit: a sandbox that fails is no proof, never a crash", async () => {
  const h = setup({
    prove: () => {
      throw new Error("sandbox down");
    },
  });
  const o = await hunted(h);
  const res = await submit(h, o);
  assert.equal(res.status, 201);
  assert.equal(res.body.finding.reason, "NO_EVIDENCE");
});

test("submit: filed once, by the agent that took the order, on an open order, in shape", async () => {
  const h = setup({ prove: ({ finding }) => makeProof({ logHash: finding.logHash }) });
  const o = await hunted(h);
  const code = async (over, opts) => {
    const r = await submit(h, o, over, opts);
    return [r.status, r.body.error?.code];
  };
  assert.equal((await submit(h, o, { id: "f-once" })).body.finding.status, "confirmed");
  assert.deepEqual(await code({ id: "f-once", title: "Overwrite", vulnClass: "other" }), [409, "EXISTS"]);
  const kept = await call(h.api, "finding", get("finding?id=f-once", { wallet: OWNER_A }));
  assert.equal(kept.body.finding.title, "Withdraw skips the owner check", "the first one's evidence stays");
  assert.deepEqual(await code({ hunter: "agent-8" }), [403, "NOT_TAKEN"]);
  assert.deepEqual(await code({}, { wallet: OWNER_B }), [403, "NOT_TAKEN"], "another wallet naming the agent");
  assert.deepEqual(await code({ severity: "apocalyptic" }), [422, "BAD_FINDING"]);
  assert.deepEqual(await code({ logHash: "abc" }), [422, "BAD_FINDING"]);
  assert.deepEqual(await code({ target: "everything" }), [422, "BAD_FINDING"]);
  assert.deepEqual(await code({ id: "bad id!" }), [400, "BAD_REQUEST"]);
  assert.deepEqual(await code({ order: "no-such-order" }), [404, "NOT_FOUND"]);
  await call(h.api, "move", post("move", { order: o.id, move: "pause" }, { wallet: PROTOCOL }));
  assert.deepEqual(await code({ vulnClass: "late" }), [409, "CLOSED"]);
});

test("submit: an agent files thirty findings a day, an owner sixty", async () => {
  const limits = { ...HACK_LIMITS, findingsPerDay: 3, findingsPerHunterDay: 2 };
  const h = setup({ limits });
  const o = await hunted(h);
  await call(h.api, "take", post("take", { order: o.id, hunter: "agent-8", role: "attacker" }, { wallet: OWNER_A }));
  assert.equal((await submit(h, o, { vulnClass: "a" })).status, 201);
  assert.equal((await submit(h, o, { vulnClass: "b" })).status, 201);
  assert.deepEqual((await submit(h, o, { vulnClass: "c" })).body.error.code, "RATE_LIMITED");
  assert.equal((await submit(h, o, { vulnClass: "d", hunter: "agent-8" })).status, 201);
  assert.deepEqual((await submit(h, o, { vulnClass: "e", hunter: "agent-8" })).body.error.code, "RATE_LIMITED");
});

// ----------------------------------------------------------------------------------------------------- reads --

test("reads: a finding's place is sealed from strangers; the protocol and the hunter's owner see it all", async () => {
  const h = setup({ prove: ({ finding }) => makeProof({ logHash: finding.logHash }) });
  const o = await hunted(h);
  await submit(h, o, { id: "f-seen" });
  const stranger = await call(h.api, "order", get(`order?id=${o.id}`));
  assert.equal(stranger.status, 200);
  assert.equal(stranger.body.order.id, o.id);
  assert.deepEqual(stranger.body.takes, [{ hunter: "agent-7", owner: OWNER_A, role: "attacker", takenAt: AT }]);
  const sealed = stranger.body.findings[0];
  assert.equal(sealed.sealed, true);
  assert.equal(sealed.status, "confirmed");
  assert.equal(sealed.severity, "high");
  for (const field of ["title", "target", "vulnClass", "logHash", "detail", "hunterOwner"]) assert.equal(sealed[field], undefined, field);
  for (const wallet of [PROTOCOL, OWNER_A]) {
    const full = await call(h.api, "finding", get("finding?id=f-seen", { wallet }));
    assert.equal(full.body.finding.sealed, false);
    assert.equal(full.body.finding.title, "Withdraw skips the owner check");
    assert.deepEqual(full.body.finding.target, { program: PROGRAM, instruction: "withdraw" });
  }
  assert.equal((await call(h.api, "finding", get("finding?id=f-seen", { wallet: OWNER_B }))).body.finding.sealed, true);
  assert.deepEqual([(await call(h.api, "finding", get("finding?id=nope"))).status], [404]);
  assert.deepEqual([(await call(h.api, "finding", get("finding?id=bad id"))).status], [400]);
  assert.deepEqual([(await call(h.api, "order", get("order?id=nope"))).status], [404]);
  assert.deepEqual([(await call(h.api, "order", get("order"))).status], [400]);
});

test("reads: orders newest first, by status and by protocol", async () => {
  const h = setup();
  const a = await opened(h);
  h.tick(1_000);
  const b = await opened(h);
  await call(h.api, "move", post("move", { order: b.id, move: "pause" }, { wallet: PROTOCOL }));
  const all = await call(h.api, "orders", get("orders"));
  assert.deepEqual(all.body.orders.map((x) => x.id), [b.id, a.id]);
  assert.deepEqual((await call(h.api, "orders", get("orders?status=open"))).body.orders.map((x) => x.id), [a.id]);
  assert.deepEqual((await call(h.api, "orders", get(`orders?protocol=${OWNER_A}`))).body.orders, []);
  assert.equal((await call(h.api, "orders", get("orders?status=lost"))).status, 400);
  assert.equal((await call(h.api, "orders", get("orders?protocol=nobody"))).status, 400);
});

test("the deadline is the system's: an order read past its window is closed, and takes no agent and no finding", async () => {
  const h = setup();
  const o = await hunted(h);
  h.tick(WINDOW.closesAt - AT + 1);
  const read = await call(h.api, "order", get(`order?id=${o.id}`));
  assert.equal(read.body.order.status, "closed");
  assert.deepEqual((await call(h.api, "orders", get("orders?status=open"))).body.orders, []);
  const take = await call(h.api, "take", post("take", { order: o.id, hunter: "agent-9", role: "attacker" }, { wallet: OWNER_B }));
  assert.deepEqual([take.status, take.body.error.code], [409, "CLOSED"]);
  const late = await submit(h, o);
  assert.deepEqual([late.status, late.body.error.code], [409, "CLOSED"]);
  const listed = setup();
  const p = await opened(listed);
  listed.tick(WINDOW.closesAt - AT + 1);
  assert.equal((await call(listed.api, "orders", get("orders"))).body.orders.find((x) => x.id === p.id).status, "closed", "the list applies it too");
});


test("move: the protocol owner's alone — pause, resume, close, settle; never the deadline or a reopening", async () => {
  const h = setup();
  const o = await opened(h);
  const move = async (m, wallet = PROTOCOL) => {
    const r = await call(h.api, "move", post("move", { order: o.id, move: m }, { wallet }));
    return [r.status, r.body.order?.status ?? r.body.error?.code];
  };
  assert.deepEqual(await move("pause", OWNER_A), [403, "NOT_YOURS"]);
  assert.deepEqual(await move("deadline"), [400, "BAD_REQUEST"]);
  assert.deepEqual(await move("open"), [400, "BAD_REQUEST"]);
  assert.deepEqual(await move("pause"), [200, "paused"]);
  assert.deepEqual(await move("pause"), [409, "BAD_MOVE"]);
  assert.deepEqual(await move("resume"), [200, "open"]);
  assert.deepEqual(await move("settle"), [409, "BAD_MOVE"]);
  assert.deepEqual(await move("close"), [200, "closed"]);
  assert.deepEqual(await move("settle"), [200, "settled"]);
  assert.deepEqual([(await call(h.api, "move", post("move", { order: "nope", move: "pause" }, { wallet: PROTOCOL }))).status], [404]);
});

test("One without a run only rejects", async () => {
  let next = { verdict: "NEEDS_REVIEW" };
  const h = setup({ prove: ({ finding }) => makeProof({ logHash: finding.logHash, ...next }) });
  const o = await hunted(h);
  const unclear = (await submit(h, o, { id: "f-unclear" })).body.finding;
  const twin = (await submit(h, o, { id: "f-twin" })).body.finding;
  const low = (await submit(h, o, { id: "f-info", vulnClass: "note", severity: "info" })).body.finding;
  next = { verdict: "PASS" };
  const counted = (await submit(h, o, { id: "f-counted", vulnClass: "overflow" })).body.finding;
  const bare = (await submit(h, o, { id: "f-bare", vulnClass: "x", logHash: null })).body.finding;
  assert.deepEqual([unclear.status, twin.status, low.status, counted.status, bare.reason], ["needs_review", "needs_review", "needs_review", "confirmed", "NO_EVIDENCE"]);

  const word = async (finding, verdict, wallet = PROTOCOL) => {
    const r = await call(h.api, "confirm", post("confirm", { finding, verdict }, { wallet }));
    return r.status === 200 ? [200, r.body.finding.status, r.body.finding.payable] : [r.status, r.body.error.code];
  };
  assert.deepEqual(await word("f-unclear", "confirm", OWNER_A), [403, "NOT_YOURS"], "the hunter does not confirm its own");
  assert.deepEqual(await word("f-bare", "confirm"), [422, "NO_RUN"]);
  assert.deepEqual(await word("f-counted", "reject"), [409, "NOT_PENDING"], "a counted finding is not the owner's to take back");
  assert.deepEqual(await word("f-unclear", "maybe"), [400, "BAD_REQUEST"]);
  assert.deepEqual(await word("nope", "confirm"), [404, "NOT_FOUND"]);
  // Settle waits for the word on every finding under review.
  await call(h.api, "move", post("move", { order: o.id, move: "close" }, { wallet: PROTOCOL }));
  const early = await call(h.api, "move", post("move", { order: o.id, move: "settle" }, { wallet: PROTOCOL }));
  assert.deepEqual([early.status, early.body.error.code], [409, "UNRESOLVED"]);

  assert.deepEqual(await word("f-unclear", "confirm"), [200, "confirmed", true]);
  assert.deepEqual(await word("f-twin", "confirm"), [200, "duplicate", false], "who first, again");
  assert.deepEqual(await word("f-info", "confirm"), [200, "confirmed", false], "a note is never reward-eligible");
  assert.deepEqual(await word("f-bare", "reject"), [200, "rejected", false]);
  assert.deepEqual(await word("f-bare", "reject"), [409, "NOT_PENDING"]);
  const settled = await call(h.api, "move", post("move", { order: o.id, move: "settle" }, { wallet: PROTOCOL }));
  assert.equal(settled.body.order.status, "settled");
  assert.deepEqual(await word("f-twin", "reject"), [409, "SETTLED"]);
});

// ---------------------------------------------------------------------------------------------- the limits --

test("a network writes so many times an hour; a refused write is not kept, so it passes once the hour has room", async () => {
  const limits = { ...HACK_LIMITS, writesPerHour: 3 };
  const h = setup({ limits });
  const o = order();
  const key = nextKey();
  const body = { order: o, grant: makeGrant(o) };
  for (let i = 0; i < 3; i += 1) await call(h.api, "orders", get("orders"));
  for (let i = 0; i < 3; i += 1) assert.equal((await call(h.api, "move", post("move", { order: "nope", move: "pause" }, { wallet: PROTOCOL }))).status, 404);
  const refused = await call(h.api, "open", post("open", body, { wallet: PROTOCOL, key }));
  assert.deepEqual([refused.status, refused.body.error.code], [429, "RATE_LIMITED"]);
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  assert.equal((await call(h.api, "open", post("open", body, { wallet: PROTOCOL, net: "net-2" }))).status, 201, "another network has its own hour");
  const other = order();
  h.tick(3_600_000);
  const later = await call(h.api, "open", post("open", { order: other, grant: makeGrant(other) }, { wallet: PROTOCOL, key: nextKey() }));
  assert.equal(later.status, 201);
});

test("a wallet writes so many times an hour, from any network", async () => {
  const limits = { ...HACK_LIMITS, walletWritesPerHour: 2 };
  const h = setup({ limits });
  for (let i = 0; i < 2; i += 1) await call(h.api, "move", post("move", { order: "nope", move: "pause" }, { wallet: PROTOCOL, net: `net-${i}` }));
  const refused = await call(h.api, "move", post("move", { order: "nope", move: "pause" }, { wallet: PROTOCOL, net: "net-9" }));
  assert.deepEqual([refused.status, refused.body.error.code], [429, "RATE_LIMITED"]);
  assert.equal((await call(h.api, "move", post("move", { order: "nope", move: "pause" }, { wallet: OWNER_A, net: "net-9" }))).status, 404, "another wallet");
});

test("a store that cannot be reached is a 503 that did nothing, for reads and writes alike", async () => {
  const db = createMemoryHackDb();
  const broken = new Proxy(db, {
    get(target, prop) {
      if (prop === "hit") return async () => ({ allowed: true, retryAfterS: 0 });
      if (prop === "answer") return async () => null;
      if (prop === "durable") return false;
      return async () => {
        throw new HackStoreUnavailable("down");
      };
    },
  });
  const h = setup({ db: broken });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const o = order();
    for (const res of [
      await call(h.api, "orders", get("orders")),
      await call(h.api, "order", get(`order?id=${o.id}`)),
      await call(h.api, "open", post("open", { order: o, grant: makeGrant(o) }, { wallet: PROTOCOL })),
      await call(h.api, "take", post("take", { order: o.id, hunter: "agent-7", role: "attacker" }, { wallet: OWNER_A })),
    ]) {
      assert.deepEqual([res.status, res.body.error.code], [503, "UNAVAILABLE"]);
    }
  } finally {
    console.error = original;
  }
  assert.ok(errors.length > 0 && errors.every((line) => line.startsWith("[hack] route failed HackStoreUnavailable")));
});
