/*
 * `/api/world/beacons` against the memory store: only a signed-in account
 * keeps beacons, a write is same-site and at the revision seen, a beacon that
 * does not read changes nothing, an edit starts its state over, and a store
 * that blinks is a 503 that changed nothing.
 */
import "../testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const { createBeaconApi } = await import("./api.ts");
const { MemoryBeaconStore } = await import("./store.ts");

const SITE = "https://ryntra.io";
const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const T0 = Date.parse("2026-10-28T12:00:00.000Z");

const rule = (over = {}) => ({
  id: "beacon01", version: 1, groups: [[{ kind: "price", op: "above", value: 1 }]], holdSeconds: 0, hysteresis: 0.002,
  cooldownSeconds: 3600, repeat: true, expiresAt: null, quiet: null, on: true, createdAt: T0, mint: MINT, symbol: "BONK", notify: true, ...over,
});

function setup(options = {}) {
  const store = new MemoryBeaconStore();
  const state = { account: options.account ?? { status: "ok", accountId: randomUUID() }, telegram: "unlinked" };
  const api = createBeaconApi({
    store,
    account: async () => state.account,
    telegram: async () => {
      if (state.telegram === "throw") throw new Error("down");
      return state.telegram;
    },
    now: () => new Date(T0),
  });
  const get = () => api.list(new Request(`${SITE}/api/world/beacons`, { headers: { "x-forwarded-for": "1.1.1.1" } }));
  const post = (body, headers = { origin: SITE }) =>
    api.save(new Request(`${SITE}/api/world/beacons`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.1.1.1", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  return { api, store, state, get, post };
}

test("only a signed-in account keeps beacons; a session store that blinks is a 503", async () => {
  const { get, post, state } = setup({ account: { status: "absent" } });
  assert.equal((await get()).status, 401);
  assert.equal((await post({ revision: 0, rules: [rule()] })).status, 401);
  state.account = { status: "unavailable" };
  assert.equal((await get()).status, 503);
});

test("save at the revision seen, read back with the Telegram state; a stale revision is a 409 with the list as it is", async () => {
  const { get, post, state } = setup();
  const empty = await (await get()).json();
  assert.deepEqual(empty, { revision: 0, rules: [], states: {}, telegram: "unlinked" });
  const saved = await post({ revision: 0, rules: [rule()] });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);
  assert.equal(saved.headers.get("cache-control")?.includes("no-store"), true);
  state.telegram = "linked";
  const read = await (await get()).json();
  assert.equal(read.telegram, "linked");
  assert.equal(read.rules[0].id, "beacon01");
  const stale = await post({ revision: 0, rules: [] });
  assert.equal(stale.status, 409);
  const body = await stale.json();
  assert.equal(body.error.code, "VERSION_CONFLICT");
  assert.equal(body.revision, 1);
  assert.equal(body.rules.length, 1);
  state.telegram = "throw";
  assert.equal((await (await get()).json()).telegram, null, "Telegram that cannot be read is said as not known");
});

test("a beacon that does not read, a body that is not JSON, or another site changes nothing", async () => {
  const { get, post } = setup();
  assert.equal((await post({ revision: 0, rules: [rule({ mint: "nope" })] })).status, 400);
  assert.equal((await post({ revision: 0, rules: [rule(), rule({ id: "beacon02", groups: [[{ kind: "sql", op: "above", value: 1 }]] })] })).status, 400);
  assert.equal((await post("{")).status, 400);
  assert.equal((await post({ rules: [] })).status, 400);
  assert.equal((await post({ revision: 0, rules: [rule()] }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post("x".repeat(40_000))).status, 413);
  assert.equal((await (await get()).json()).revision, 0);
});

test("an edited beacon starts over; the others keep what the engine remembers", async () => {
  const { store, post, state } = setup();
  const accountId = state.account.accountId;
  await post({ revision: 0, rules: [rule(), rule({ id: "beacon02" })] });
  const remembered = { version: 1, state: { armed: true, since: null, firedAt: T0, seen: true }, spent: false };
  await store.step({ accountId, revision: 1, states: { beacon01: remembered, beacon02: remembered }, now: new Date(T0) });
  const done = await (await post({ revision: 1, rules: [rule(), rule({ id: "beacon02", version: 2 })] })).json();
  assert.deepEqual(done.states.beacon01, remembered);
  assert.equal(done.states.beacon02, undefined);
});

test("a store that blinks is a 503 that changed nothing", async () => {
  const { store, get, post } = setup();
  store.down = true;
  assert.equal((await get()).status, 503);
  assert.equal((await post({ revision: 0, rules: [rule()] })).status, 503);
});

test("requests are limited per address", async () => {
  const { get } = setup();
  let last = 0;
  for (let i = 0; i < 61; i += 1) last = (await get()).status;
  assert.equal(last, 429);
});
