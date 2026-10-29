// Run from repo root: node --test lib/vault/api.test.mjs
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { createVaultApi } = await import("./api.ts");
const { createVaultEngine } = await import("./engine.ts");
const { createMemoryVaultStore } = await import("./store.ts");
const { ModelFailure } = await import("./model.ts");
const { newGuest } = await import("./identity.ts");

/** The routes of /api/vault on plain requests: the switch, the site, the key, the guest, the limits, the world. */

const BASE = "https://ryntra.io/api/vault";
const T0 = Date.parse("2026-10-27T12:00:00Z");
const SECRET = "test-secret";

function setup({ open = true, wallet = null, model, secret = SECRET } = {}) {
  let t = T0;
  const now = () => t;
  const store = createMemoryVaultStore();
  const calls = { model: 0, world: [] };
  const guard = model ?? {
    async call() {
      calls.model += 1;
      return { text: "Move along.", model: "fake", costMicroUsd: 0, tokens: { input: 1, output: 1 }, ms: 1 };
    },
  };
  const engine = createVaultEngine({ model: guard, store, secret: SECRET, now });
  const api = createVaultApi({
    engine: () => (secret ? engine : null),
    secret: () => secret,
    open: () => open,
    wallet: async () => (wallet ? { status: "ok", accountId: wallet } : { status: "absent" }),
    store,
    world: { async award(_req, event) { calls.world.push(event); return "pending"; } },
    now,
  });
  return { api, engine, calls, tick: (ms) => (t += ms) };
}

let keys = 0;
function attempt(body, { cookie, key = `key-${++keys}-abcdef`, origin = "https://ryntra.io" } = {}) {
  const headers = { "content-type": "application/json", origin };
  if (key) headers["idempotency-key"] = key;
  if (cookie) headers.cookie = cookie;
  return new Request(`${BASE}/attempt`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}
const cookieOf = (res) => /rvg=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;

test("closed until the switch says open: every route is a 404 and no guard is asked", async () => {
  const { api, calls } = setup({ open: false });
  for (const res of [await api.attempt(attempt({ vault: "practice-1", text: "hi" })), await api.state(new Request(`${BASE}/state`)), await api.feed(new Request(`${BASE}/feed?vault=practice-1`))]) {
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, "CLOSED");
  }
  assert.equal(calls.model, 0);
});

test("an attempt comes from this site, with a key, as a small JSON object for a real vault", async () => {
  const { api } = setup();
  const code = async (req) => {
    const res = await api.attempt(req);
    return [res.status, (await res.json()).error?.code];
  };
  assert.deepEqual(await code(attempt({ vault: "practice-1", text: "hi" }, { origin: "https://evil.example" })), [403, "FORBIDDEN"]);
  assert.deepEqual(await code(attempt({ vault: "practice-1", text: "hi" }, { key: null })), [400, "IDEMPOTENCY_KEY_REQUIRED"]);
  assert.deepEqual(await code(attempt("not json")), [400, "BAD_REQUEST"]);
  assert.deepEqual(await code(attempt({ vault: "vault-9", text: "hi" })), [404, "NOT_FOUND"]);
  assert.deepEqual(await code(attempt({ vault: "practice-1", text: 42 })), [400, "BAD_REQUEST"]);
  assert.deepEqual(await code(attempt({ vault: "practice-1", text: "x".repeat(3000) })), [413, "PAYLOAD_TOO_LARGE"]);
});

test("a first attempt makes a guest in an HttpOnly cookie; the cookie keeps the same person and their limits", async () => {
  const { api } = setup();
  const first = await api.attempt(attempt({ vault: "practice-1", text: "hello" }));
  assert.equal(first.status, 200);
  const setCookie = first.headers.get("set-cookie");
  assert.match(setCookie, /^rvg=v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax; Secure$/);
  assert.equal(first.headers.get("cache-control"), "private, no-store, max-age=0");
  const cookie = `rvg=${cookieOf(first)}`;
  const second = await api.attempt(attempt({ vault: "practice-1", text: "hello again" }, { cookie }));
  assert.equal(second.headers.get("set-cookie"), null, "a known guest gets no new cookie");
  const body = await second.json();
  assert.equal(body.state.me.limits.minute.left, 1);
  const third = await api.attempt(attempt({ vault: "practice-1", text: "and again" }, { cookie }));
  assert.equal(third.status, 200);
  const fourth = await api.attempt(attempt({ vault: "practice-1", text: "once more" }, { cookie }));
  assert.equal(fourth.status, 429);
  assert.ok(Number(fourth.headers.get("retry-after")) > 0);
  assert.deepEqual(Object.keys((await fourth.json()).error).sort(), ["code", "message", "retryAfterS", "window"]);
});

test("a forged guest key is nobody: the server makes a new guest instead", async () => {
  const { api } = setup();
  const forged = newGuest("another-secret").cookie;
  const res = await api.attempt(attempt({ vault: "practice-1", text: "hello" }, { cookie: `rvg=${forged}` }));
  assert.equal(res.status, 200);
  assert.notEqual(cookieOf(res), forged);
  assert.ok(cookieOf(res));
});

test("the same key gives the same answer and counts once", async () => {
  const { api, calls } = setup();
  const first = await api.attempt(attempt({ vault: "practice-1", text: "hello" }, { key: "same-key-123" }));
  const cookie = `rvg=${cookieOf(first)}`;
  const firstBody = await first.json();
  const replay = await api.attempt(attempt({ vault: "practice-1", text: "hello" }, { key: "same-key-123", cookie }));
  assert.equal(replay.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(await replay.json(), firstBody);
  assert.equal(calls.model, 1);
  // The same key from another known person is their own attempt.
  const otherCookie = `rvg=${newGuest(SECRET).cookie}`;
  const other = await api.attempt(attempt({ vault: "practice-1", text: "hello" }, { key: "same-key-123", cookie: otherCookie }));
  assert.equal(other.headers.get("idempotent-replayed"), null);
  assert.equal(calls.model, 2);
});

test("a retry that lost the cookie is the same attempt: the same answer, the same guest, counted once", async () => {
  const { api, calls } = setup();
  const first = await api.attempt(attempt({ vault: "practice-1", text: "hello" }, { key: "lost-cookie-1" }));
  const body = await first.json();
  const guest = cookieOf(first);
  assert.ok(guest);
  // The answer never arrived, nor did its cookie: the client sends the same key again, without one.
  const retry = await api.attempt(attempt({ vault: "practice-1", text: "hello" }, { key: "lost-cookie-1" }));
  assert.equal(retry.headers.get("idempotent-replayed"), "true");
  assert.equal(cookieOf(retry), guest, "the guest the first answer made");
  assert.deepEqual(await retry.json(), body);
  assert.equal(calls.model, 1, "counted once");
  // The answer arrived but the next request carries the cookie: still the same attempt.
  const withCookie = await api.attempt(attempt({ vault: "practice-1", text: "hello" }, { key: "lost-cookie-1", cookie: `rvg=${guest}` }));
  assert.equal(withCookie.headers.get("idempotent-replayed"), "true");
  assert.equal(calls.model, 1);
  // The guest's limits saw one attempt.
  const next = await api.attempt(attempt({ vault: "practice-1", text: "again" }, { cookie: `rvg=${guest}` }));
  assert.equal((await next.json()).state.me.limits.minute.left, 1);
});

test("a store that cannot be reached is a 503 with nothing inside named, and the log carries no phrase", async () => {
  const broken = createMemoryVaultStore();
  const failing = new Proxy(broken, {
    get(target, prop) {
      if (prop === "take" || prop === "progress") return async () => { throw new Error(`relation private.vault_attempts: ${engineWords.join(" ")}`); };
      return target[prop];
    },
  });
  const engine = createVaultEngine({ model: { async call() { throw new Error("never"); } }, store: failing, secret: SECRET, now: () => T0 });
  const engineWords = engine.phrase("practice-1", "2026-10-27");
  const api = createVaultApi({ engine: () => engine, secret: () => SECRET, open: () => true, wallet: async () => ({ status: "absent" }), store: failing, world: { async award() { return "pending"; } }, now: () => T0 });
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    for (const res of [await api.attempt(attempt({ vault: "practice-1", text: "hello" })), await api.state(new Request(`${BASE}/state`, { headers: { cookie: `rvg=${newGuest(SECRET).cookie}` } }))]) {
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error.code, "UNAVAILABLE");
    }
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 2);
  for (const line of logged) for (const word of engineWords) assert.ok(!line.includes(word), line);
});

test("a wallet's account is the person when signed in", async () => {
  const { api } = setup({ wallet: "acct-1" });
  const res = await api.attempt(attempt({ vault: "practice-1", text: "hello" }));
  assert.equal(res.headers.get("set-cookie"), null, "no guest for a signed-in person");
  assert.match((await res.json()).entry.who, /^Wallet [0-9A-F]{4}$/);
});

test("a guard that does not answer: 503, nothing counted, and the same key may try again", async () => {
  let fail = true;
  const model = {
    async call() {
      if (fail) throw new ModelFailure("unavailable");
      return { text: "Here now.", model: "fake", costMicroUsd: 0, tokens: { input: 1, output: 1 }, ms: 1 };
    },
  };
  const { api } = setup({ model });
  const silent = await api.attempt(attempt({ vault: "practice-1", text: "hello" }, { key: "retry-key-1" }));
  assert.equal(silent.status, 503);
  assert.equal((await silent.json()).error.code, "GUARD_SILENT");
  const cookie = `rvg=${cookieOf(silent)}`;
  fail = false;
  const retried = await api.attempt(attempt({ vault: "practice-1", text: "hello" }, { key: "retry-key-1", cookie }));
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).state.me.limits.minute.left, 2);
});

test("a crack goes to the world as an event, once", async () => {
  const { api, engine, calls } = setup();
  const phrase = engine.phrase("practice-1", "2026-10-27").join(" ");
  const res = await api.attempt(attempt({ vault: "practice-1", text: phrase }));
  const body = await res.json();
  assert.equal(body.outcome, "cracked");
  assert.equal(calls.world.length, 1);
  assert.deepEqual({ ...calls.world[0], at: undefined }, { kind: "vault_crack", vault: "practice-1", day: "2026-10-27", points: 10, title: null, idempotencyKey: "vault:practice-1:once", at: undefined });
  assert.equal(calls.model, 0, "the phrase never goes to the guard");
});

test("state and feed: open reads, no guest made, nothing secret", async () => {
  const { api, engine } = setup();
  const state = await api.state(new Request(`${BASE}/state`));
  assert.equal(state.status, 200);
  assert.equal(state.headers.get("set-cookie"), null);
  const body = await state.json();
  assert.equal(body.vaults.length, 4);
  for (const v of body.vaults) for (const word of engine.phrase(v.id, body.day)) assert.ok(!JSON.stringify(body).includes(word));
  await api.attempt(attempt({ vault: "practice-1", text: "hello" }));
  const feed = await api.feed(new Request(`${BASE}/feed?vault=practice-1`));
  assert.equal(feed.status, 200);
  const page = await feed.json();
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].attempt, null);
  assert.equal((await api.feed(new Request(`${BASE}/feed?vault=nope`))).status, 404);
  assert.equal((await api.feed(new Request(`${BASE}/feed?vault=practice-1&before=${"x".repeat(40)}`))).status, 400);
});

test("without the server's secret the vault says it is unavailable and makes no guest", async () => {
  const { api } = setup({ secret: null });
  const res = await api.attempt(attempt({ vault: "practice-1", text: "hello" }));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal((await api.state(new Request(`${BASE}/state`))).status, 503);
});
