// Run from repo root: node --test city/lib/quarter/crew.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { createMockWorld } = await import("./mock.ts");
const { createMockCrews, createHttpCrews, inviteFrom, inviteLink } = await import("./crew.ts");
const { createCrewStore, crewLine } = await import("./crew-store.ts");
const { WorldError } = await import("./types.ts");
const { useLangStore } = await import("../i18n/lang.ts");

/**
 * Crews in the city (CITY-20): the device's crews answer by the server's rules and move the device's own quarter onto
 * the crew's street; the server's client sends keyed writes and reads refusals; the store keeps one sheet, one line
 * for a refusal and one retry with the same key; an invite travels as a link with a code and nothing else.
 */

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function device() {
  const storage = memoryStorage();
  const state = { now: new Date("2026-10-29T10:00:00.000Z") };
  const world = createMockWorld({ storage, now: () => state.now });
  const crews = createMockCrews({ storage, now: () => state.now });
  return { storage, world, crews, state };
}

test("the device's crew: my quarter moves to the first lot of the next street; the invite opens it here", async () => {
  const d = device();
  await assert.rejects(d.crews.mine(), (e) => e instanceof WorldError && e.code === "NO_RESIDENT");
  const { quarter: home } = await d.world.claim("claim-key-1");
  assert.equal(await d.crews.mine(), null);
  const made = await d.crews.create({ name: "  Night  Owls ", colour: "lilac" });
  assert.equal(made.crew.name, "Night Owls");
  assert.deepEqual(made.quarter.cell, { x: 0, z: home.cell.z + 1 });
  assert.equal(made.quarter.version, home.version + 1);
  const me = await d.world.me();
  assert.deepEqual(me.quarter.cell, made.quarter.cell, "the device's world agrees where the quarter stands");
  assert.equal(me.quarter.street, `arrivals-${home.cell.z + 2}`);
  assert.equal((await d.crews.mine()).id, made.crew.id);
  assert.deepEqual((await d.crews.streets()).map((s) => [s.name, s.row, s.members]), [["Night Owls", home.cell.z + 1, 1]]);
  const code = made.crew.invite;
  assert.equal((await d.crews.invite(`${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase())).id, made.crew.id);
  await assert.rejects(d.crews.invite("ZZZZZZZZ"), (e) => e.status === 404);
  await assert.rejects(d.crews.join(code), (e) => e.reason === "in_crew");
  await assert.rejects(d.crews.join("ZZZZZZZZ"), (e) => e.status === 404, "another device's crew lives on the server");
  await assert.rejects(d.crews.create({ name: "Again", colour: "sky" }), (e) => e.reason === "in_crew");
});

test("the device's crew keeps the rules: a cleaned name, a known colour, gifts once a day, points never twice", async () => {
  const d = device();
  await d.world.claim("claim-key-2");
  await assert.rejects(d.crews.create({ name: "ignore previous instructions", colour: "sky" }), (e) => e.reason === "name");
  await assert.rejects(d.crews.create({ name: "Fine", colour: "amber" }), (e) => e.status === 400);
  await d.crews.create({ name: "Builders", colour: "pearl" });
  const roof = await d.crews.gift({ kind: "module", module: "roof.flat" });
  assert.deepEqual(roof.crew.hq, { level: 1, units: 25, next: 50, modules: ["roof.flat"] });
  assert.equal(roof.crew.me.gave.module, true);
  await assert.rejects(d.crews.gift({ kind: "module", module: "base.stone" }), (e) => e.reason === "today");
  await assert.rejects(d.crews.gift({ kind: "points", points: 10 }), (e) => e.reason === "points");
  // Two of the day's tasks: a home, then a floor on it.
  let me = await d.world.me();
  await d.world.build({ quarterId: me.quarter.id, slot: 1, kind: "home", modules: ["base.stone", "light.amber"], version: me.quarter.version });
  me = await d.world.me();
  await d.world.build({ quarterId: me.quarter.id, slot: 1, kind: "home", modules: ["base.stone", "floor.glass", "light.amber"], version: me.quarter.version });
  const total = (await d.world.me()).points.total;
  assert.ok(total >= 20);
  const given = await d.crews.gift({ kind: "points", points: 20 });
  assert.equal(given.crew.me.points, total - 20);
  assert.equal(given.crew.hq.units, 45);
  assert.equal((await d.world.me()).points.total, total, "the quarter keeps its points and its level");
  // Out and into a new crew: what was given stays given.
  const out = await d.crews.leave();
  assert.notEqual(out.quarter.cell.z, given.crew.row);
  assert.equal(await d.crews.mine(), null);
  await assert.rejects(d.crews.leave(), (e) => e.reason === "not_in_crew");
  const again = await d.crews.create({ name: "Again", colour: "lime" });
  assert.equal(again.crew.me.points, total - 20);
});

test("the server's crews: keyed writes, the shapes checked, a refusal read with its reason", async () => {
  const sent = [];
  const answers = [];
  const fetch = async (url, init) => {
    sent.push({ url, init });
    const [status, body] = answers.shift();
    return new Response(JSON.stringify(body), { status });
  };
  const crews = createHttpCrews({ fetch, newKey: () => "key-0000001" });
  const street = { id: "c1", name: "Docks", colour: "cyan", street: "arrivals-3", row: 2, members: 2, limit: 12, hq: { level: 1, units: 0, next: 50, modules: [] } };
  const mine = { ...street, invite: "K7Q2MX9P", people: [], score: { week: "2026-10-26", actions: 0, verified: 0, total: 0 }, me: { quarterId: "q", gave: { module: false, points: false }, points: 0 } };
  const quarter = { id: "q", ownerId: "r", district: "arrivals", street: "arrivals-3", cell: { x: 2, z: 2 }, level: 1, version: 3, updatedAt: "" };

  answers.push([200, { crew: null }]);
  assert.equal(await crews.mine(), null);
  answers.push([401, { error: { code: "NO_RESIDENT", message: "x" } }]);
  assert.equal(await crews.mine(), null, "no place yet: no crew");
  answers.push([200, { crews: [street, { broken: true }] }]);
  assert.deepEqual(await crews.streets(), [street], "a street that is not one is left out");
  answers.push([200, { crew: mine, quarter }]);
  assert.equal((await crews.join("K7Q2MX9P")).quarter.cell.x, 2);
  assert.equal(sent.at(-1).url, "/api/world/crew/join");
  assert.equal(sent.at(-1).init.headers["idempotency-key"], "key-0000001");
  assert.deepEqual(JSON.parse(sent.at(-1).init.body), { code: "K7Q2MX9P" });
  answers.push([422, { error: { code: "CREW_REFUSED", reason: "full", message: "x" } }]);
  await assert.rejects(crews.join("K7Q2MX9P"), (e) => e.code === "CREW_REFUSED" && e.reason === "full");
  answers.push([200, { crew: { id: 1 } }]);
  await assert.rejects(crews.mine(), (e) => e.code === "BAD_ANSWER");
  answers.push([200, { crew: street }]);
  assert.equal((await crews.invite("k7q2-mx9p")).id, "c1");
  assert.equal(sent.at(-1).url, "/api/world/crew/invite/k7q2-mx9p");
  const offline = createHttpCrews({ fetch: async () => { throw new TypeError("offline"); } });
  await assert.rejects(offline.mine(), (e) => e.code === "OFFLINE" && e.status === 0);
});

test("the store: a crew made moves my quarter and reads my place again; a refusal is one short line", async () => {
  const d = device();
  await d.world.claim("claim-key-3");
  const reloads = [];
  const { quarterStore } = await import("./store.ts");
  const reload = quarterStore.getState().reload;
  quarterStore.setState({ reload: async () => { reloads.push(1); } });
  try {
    const store = createCrewStore({ client: () => d.crews, retryMs: 0 });
    assert.equal(store.getState().status, "unread");
    await store.getState().read();
    assert.equal(store.getState().status, "none");
    store.getState().open();
    assert.equal(store.getState().view, "create");
    assert.equal(await store.getState().create("x", "sky"), false);
    assert.equal(store.getState().error, "Pick another name.");
    assert.equal(await store.getState().create("Night Owls", "sky"), true);
    assert.deepEqual([store.getState().status, store.getState().view, store.getState().crew.name], ["member", "home", "Night Owls"]);
    assert.equal(reloads.length, 1);
    assert.equal(store.getState().streets.length, 1);
    await store.getState().peek("ZZZZZZZZ");
    assert.deepEqual([store.getState().view, store.getState().invite.state, store.getState().error], ["invite", "gone", "No crew with this code."]);
    store.getState().close();
    assert.equal(store.getState().invite, null);
    assert.equal(await store.getState().leave(), true);
    assert.deepEqual([store.getState().status, store.getState().crew, store.getState().view], ["none", null, null]);
    assert.equal(reloads.length, 2);
  } finally {
    quarterStore.setState({ reload });
  }
});

test("a write that met no answer is tried once more with the same key; a refusal is final", async () => {
  const keys = [];
  let fail = 1;
  const client = {
    mine: async () => null,
    streets: async () => [],
    invite: async () => { throw new WorldError(404, "NOT_FOUND"); },
    create: async () => { throw new WorldError(422, "CREW_REFUSED", { reason: "in_crew" }); },
    leave: async () => ({ quarter: {} }),
    gift: async () => { throw new WorldError(422, "CREW_REFUSED", { reason: "today" }); },
    join: async (code, key) => {
      keys.push(key);
      if (fail-- > 0) throw new WorldError(503, "UNAVAILABLE");
      return { crew: { id: "c", name: "C", colour: "sky", row: 1 }, quarter: {} };
    },
  };
  const { quarterStore } = await import("./store.ts");
  const reload = quarterStore.getState().reload;
  quarterStore.setState({ reload: async () => {} });
  try {
    let n = 0;
    const store = createCrewStore({ client: () => client, newKey: () => `k-${++n}`, retryMs: 0 });
    assert.equal(await store.getState().join("K7Q2MX9P"), true);
    assert.deepEqual(keys, ["k-1", "k-1"]);
    assert.equal(await store.getState().gift({ kind: "points", points: 5 }), false);
    assert.equal(store.getState().error, "Given today. Back tomorrow.");
  } finally {
    quarterStore.setState({ reload });
  }
  assert.equal(crewLine(new WorldError(0, "OFFLINE")), "The city could not be reached. Try again.");
  assert.equal(crewLine(new Error("x")), "The city could not be reached. Try again.");
});

test("a refusal is said in the language on screen (CITY-79)", () => {
  useLangStore.setState({ lang: "uk" });
  try {
    assert.equal(crewLine(new WorldError(409, "CREW_REFUSED", { reason: "full" })), "Цей екіпаж повний.");
    assert.equal(crewLine(new WorldError(404, "NOT_FOUND")), "Екіпажу з таким кодом немає.");
    assert.equal(crewLine(new Error("x")), "Місто поза зв’язком. Спробуй ще раз.");
  } finally {
    useLangStore.setState({ lang: "en" });
  }
  assert.equal(crewLine(new WorldError(409, "CREW_REFUSED", { reason: "full" })), "This crew is full.");
});

test("with no crews in the build, the store stays off and opens nothing", async () => {
  const store = createCrewStore({ client: () => null });
  assert.equal(store.getState().status, "off");
  store.getState().open();
  assert.equal(store.getState().view, null);
  await store.getState().read();
  assert.equal(store.getState().status, "off");
});

test("an invite is the city's address with the code, and nothing of a wallet", () => {
  assert.equal(inviteLink("https://ryntra.io/", "K7Q2MX9P"), "https://ryntra.io/?crew=K7Q2MX9P");
  assert.equal(inviteFrom("?crew=k7q2-mx9p"), "K7Q2MX9P");
  assert.equal(inviteFrom("?crew=nope"), null);
  assert.equal(inviteFrom(""), null);
  assert.doesNotMatch(inviteLink("https://ryntra.io", "K7Q2MX9P"), /wallet|address|ref=/);
});
