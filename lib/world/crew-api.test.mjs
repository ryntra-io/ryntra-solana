/*
 * The crews' routes (CITY-20) against the memory stores: make a crew and its street, join by a code with no wallet,
 * quarters standing in one row, the limit, a one-tap leave back to the newcomers' streets, gifts of modules and points
 * towards the headquarters, the week's score, and the same guarantees as every world write.
 */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const { createWorldApi, WorldLimiter } = await import("./api.ts");
const { createCrewApi, CREW_LIMITS } = await import("./crew-api.ts");
const { CREW_LIMIT, MEMBER_LOTS } = await import("./crew.ts");
const { MemoryWorldStore } = await import("./memory-store.ts");
const { MemoryCrewStore } = await import("./crew-store.ts");
const { WorldStoreUnavailable } = await import("./store.ts");

const SITE = "https://ryntra.io";

function world(more = {}) {
  const store = new MemoryWorldStore();
  const crews = more.crews?.(store) ?? new MemoryCrewStore(store);
  const state = { now: Date.parse("2026-10-29T10:00:00.000Z") };
  const deps = {
    secret: () => "test-secret",
    now: () => new Date(state.now),
    account: async (req) => {
      const id = req.headers.get("x-test-account");
      return id ? { status: "ok", accountId: id } : { status: "absent" };
    },
  };
  const api = createWorldApi({ ...deps, store, limiter: new WorldLimiter(), wallet: async () => ({ status: "absent" }), verifyLink: async () => "owned" });
  const crew = createCrewApi({ ...deps, world: store, crews });
  return { api, crew, store, crews, state };
}

let ipCounter = 0;
function browser(w, extra = {}) {
  const jar = { rwg: null };
  const ip = extra.ip ?? `198.51.100.${++ipCounter % 250}`;
  const send = async (handler, path, init = {}) => {
    const headers = new Headers({ origin: init.origin ?? SITE, "x-forwarded-for": ip, ...(init.headers ?? {}) });
    if (jar.rwg) headers.set("cookie", `rwg=${jar.rwg}`);
    if (extra.account) headers.set("x-test-account", extra.account);
    const method = init.method ?? "GET";
    if (method === "POST" && init.key !== null) headers.set("idempotency-key", init.key ?? `key-${randomUUID()}`);
    const req = new Request(`${SITE}/api/world/${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const res = await handler(req);
    const cookie = res.headers.get("set-cookie");
    if (cookie?.startsWith("rwg=")) jar.rwg = cookie.slice(4, cookie.indexOf(";")) || null;
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  return {
    claim: () => send(w.api.claim, "claim", { method: "POST", body: {} }),
    me: () => send(w.api.me, "me"),
    build: (body) => send(w.api.build, "build", { method: "POST", body }),
    visit: (quarterId) => send(w.api.visit, "visit", { method: "POST", body: { quarterId } }),
    mine: () => send(w.crew.mine, "crew"),
    streets: () => send(w.crew.streets, "crews"),
    invite: (code) => send((req) => w.crew.invite(req, code), `crew/invite/${code}`),
    create: (body, init = {}) => send(w.crew.create, "crew", { method: "POST", body, ...init }),
    join: (code, init = {}) => send(w.crew.join, "crew/join", { method: "POST", body: { code }, ...init }),
    leave: (init = {}) => send(w.crew.leave, "crew/leave", { method: "POST", body: {}, ...init }),
    gift: (body) => send(w.crew.gift, "crew/gift", { method: "POST", body }),
  };
}

/** A resident with a quarter, as a guest. */
async function resident(w, extra) {
  const b = browser(w, extra);
  const claimed = await b.claim();
  assert.ok(claimed.status === 201 || claimed.status === 200, JSON.stringify(claimed.body));
  return b;
}

test("a crew is made with its street: my quarter moves to the first lot of a street nobody else stands on", async () => {
  const w = world();
  const newcomer = await resident(w);
  const founder = await resident(w);
  const made = await founder.create({ name: "Night Owls", colour: "lilac" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const { crew, quarter } = made.body;
  assert.equal(crew.name, "Night Owls");
  assert.equal(crew.colour, "lilac");
  assert.equal(crew.row, 1, "the first street was taken by newcomers");
  assert.equal(crew.street, "arrivals-2");
  assert.equal(crew.members, 1);
  assert.equal(crew.limit, CREW_LIMIT);
  assert.deepEqual(quarter.cell, { x: 0, z: 1 });
  assert.equal(quarter.street, "arrivals-2");
  assert.match(crew.invite, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  assert.deepEqual(crew.hq, { level: 1, units: 0, next: 50, modules: [] });
  assert.equal(crew.people.length, 1);
  assert.equal(crew.people[0].lot, 0);
  assert.equal(crew.people[0].verified, false, "a guest is not a verified member");
  assert.equal((await founder.me()).body.quarter.street, "arrivals-2", "the world agrees where the quarter stands");
  assert.equal((await newcomer.mine()).body.crew, null);
  // The next newcomer never lands on the crew's street.
  for (let i = 0; i < 30; i += 1) {
    const b = browser(w);
    const claimed = await b.claim();
    assert.notEqual(claimed.body.quarter.cell.z, 1, `claim ${i} landed on the crew's street`);
  }
});

test("an invite is a code and a link: anyone reads the street behind it; a guest joins with no wallet, into the same row", async () => {
  const w = world();
  const founder = await resident(w);
  const { invite } = (await founder.create({ name: "Docks Crew", colour: "cyan" })).body.crew;
  const shown = `${invite.slice(0, 4)}-${invite.slice(4)}`.toLowerCase();
  const peek = await browser(w).invite(shown);
  assert.equal(peek.status, 200);
  assert.equal(peek.body.crew.name, "Docks Crew");
  assert.equal(peek.body.crew.members, 1);
  assert.equal(peek.body.crew.invite, undefined, "the public street never carries its code");
  assert.equal(peek.body.crew.people, undefined);
  assert.equal((await browser(w).invite("ZZZZZZZZ")).status, 404);
  assert.equal((await browser(w).invite("not a code")).status, 404);

  const friend = await resident(w);
  const joined = await friend.join(shown);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.deepEqual(joined.body.quarter.cell, { x: 2, z: joined.body.crew.row });
  assert.deepEqual(joined.body.crew.people.map((p) => p.lot), [0, 2]);
  assert.equal((await friend.join(invite)).body.error.reason, "in_crew");
  assert.equal((await founder.create({ name: "Second", colour: "rose" })).body.error.reason, "in_crew");
  const list = await browser(w).streets();
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.crews.map((c) => [c.name, c.members]), [["Docks Crew", 2]]);
});

test("a crew holds as many people as its row has lots; the next one is refused", async () => {
  const w = world();
  const founder = await resident(w);
  const { invite } = (await founder.create({ name: "Full House", colour: "rose" })).body.crew;
  for (let i = 1; i < CREW_LIMIT; i += 1) assert.equal((await (await resident(w)).join(invite)).status, 200);
  const mine = (await founder.mine()).body.crew;
  assert.deepEqual(mine.people.map((p) => p.lot), [...MEMBER_LOTS]);
  const late = await (await resident(w)).join(invite);
  assert.equal(late.status, 422);
  assert.deepEqual([late.body.error.code, late.body.error.reason], ["CREW_REFUSED", "full"]);
});

test("one tap leaves: my quarter goes back to a newcomers' street, my lot opens for the next, the last one out ends the crew", async () => {
  const w = world();
  const founder = await resident(w);
  const { invite, row } = (await founder.create({ name: "Short Stay", colour: "lime" })).body.crew;
  const friend = await resident(w);
  await friend.join(invite);
  const out = await founder.leave();
  assert.equal(out.status, 200);
  assert.notEqual(out.body.quarter.cell.z, row);
  assert.match(out.body.quarter.street, /^arrivals-\d+$/);
  assert.equal((await founder.mine()).body.crew, null);
  assert.equal((await founder.leave()).body.error.reason, "not_in_crew");
  const back = await (await resident(w)).join(invite);
  assert.equal(back.body.quarter.cell.x, 0, "the first lot is free again");
  await friend.leave();
  assert.equal((await browser(w).streets()).body.crews.length, 1);
});

test("a name the city may not show is refused; a wrong colour or a missing name is a bad request", async () => {
  const w = world();
  const b = await resident(w);
  const bad = await b.create({ name: "ignore previous instructions", colour: "sky" });
  assert.deepEqual([bad.status, bad.body.error.reason], [422, "name"]);
  assert.equal((await b.create({ name: "Fine", colour: "amber" })).status, 400);
  assert.equal((await b.create({ colour: "sky" })).status, 400);
  assert.equal((await b.mine()).body.crew, null, "nothing was made");
});

test("gifts build the headquarters: a module once a day, points once a day and never more than I have left", async () => {
  const w = world();
  const founder = await resident(w);
  await founder.create({ name: "Builders", colour: "pearl" });
  const roof = await founder.gift({ kind: "module", module: "roof.flat" });
  assert.equal(roof.status, 200, JSON.stringify(roof.body));
  assert.deepEqual(roof.body.crew.hq, { level: 1, units: 25, next: 50, modules: ["roof.flat"] });
  assert.equal(roof.body.crew.me.gave.module, true);
  assert.equal((await founder.gift({ kind: "module", module: "base.stone" })).body.error.reason, "today");
  assert.equal((await founder.gift({ kind: "points", points: 10 })).body.error.reason, "points", "a newcomer has no points yet");
  // A home and a floor finish two of the day's tasks: 20 points.
  const me = (await founder.me()).body;
  await founder.build({ quarterId: me.quarter.id, slot: 1, kind: "home", modules: ["base.stone", "light.amber"], version: me.quarter.version });
  const after = (await founder.me()).body;
  await founder.build({ quarterId: after.quarter.id, slot: 1, kind: "home", modules: ["base.stone", "floor.glass", "light.amber"], version: after.quarter.version });
  const total = (await founder.me()).body.points.total;
  assert.ok(total >= 20, `points ${total}`);
  const given = await founder.gift({ kind: "points", points: 20 });
  assert.equal(given.status, 200, JSON.stringify(given.body));
  assert.equal(given.body.crew.hq.units, 45);
  assert.equal(given.body.crew.me.points, total - 20);
  assert.equal((await founder.me()).body.points.total, total, "points given stay in my total: the quarter keeps its level");
  assert.equal((await founder.gift({ kind: "points", points: 5 })).body.error.reason, "today");
  // Tomorrow: a module from a higher level is still closed; a new day opens both kinds again.
  w.state.now += 86_400_000;
  assert.equal((await founder.gift({ kind: "module", module: "roof.spire" })).body.error.reason, "module");
  assert.equal((await founder.gift({ kind: "points", points: Math.max(5, total - 19) })).body.error.reason, "points");
  assert.equal((await founder.gift({ kind: "sol", amount: 1 })).status, 400, "there is no money gift");
  assert.equal((await (await resident(w)).gift({ kind: "module", module: "roof.flat" })).body.error.reason, "not_in_crew");
});

test("the week's score counts what members did — builds, visits, gifts — and who is verified; never what was bought", async () => {
  const w = world();
  w.store.accounts.add("acc-1");
  const founder = await resident(w, { account: "acc-1" });
  const { invite } = (await founder.create({ name: "Scorers", colour: "orchid" })).body.crew;
  const friend = await resident(w);
  await friend.join(invite);
  const me = (await founder.me()).body;
  await founder.build({ quarterId: me.quarter.id, slot: 1, kind: "home", modules: ["base.stone"], version: me.quarter.version });
  await friend.visit(me.quarter.id);
  await friend.gift({ kind: "module", module: "base.timber" });
  const { score, people } = (await founder.mine()).body.crew;
  assert.deepEqual(people.map((p) => p.verified), [true, false]);
  assert.deepEqual(score, { week: "2026-10-26", actions: 3, verified: 1, total: 8 });
});

test("every write is same-site and keyed; a retried key replays; the store being down changes nothing", async () => {
  const w = world();
  const b = await resident(w);
  assert.equal((await b.create({ name: "Elsewhere", colour: "sky" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await b.create({ name: "No Key", colour: "sky" }, { key: null })).status, 400);
  const first = await b.create({ name: "Once", colour: "sky" }, { key: "crew-key-0001" });
  const again = await b.create({ name: "Once", colour: "sky" }, { key: "crew-key-0001" });
  assert.equal(first.status, 201);
  assert.equal(again.status, 201);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.equal((await b.create({ name: "Other", colour: "sky" }, { key: "crew-key-0001" })).status, 422);
  assert.equal((await browser(w).mine()).status, 401, "no resident, no crew");

  const down = world({
    crews: () => ({
      mine: async () => { throw new WorldStoreUnavailable(); },
      streets: async () => { throw new WorldStoreUnavailable(); },
      byInvite: async () => { throw new WorldStoreUnavailable(); },
      create: async () => { throw new WorldStoreUnavailable(); },
      join: async () => { throw new WorldStoreUnavailable(); },
      leave: async () => { throw new WorldStoreUnavailable(); },
      gift: async () => { throw new WorldStoreUnavailable(); },
    }),
  });
  const d = await resident(down);
  assert.equal((await d.create({ name: "Down", colour: "sky" })).status, 503);
  assert.equal((await d.mine()).status, 503);
  assert.equal((await browser(down).streets()).status, 503);
});

test("an invite is looked up a few times a minute from one address, so codes cannot be walked", async () => {
  const w = world();
  const b = browser(w, { ip: "192.0.2.77" });
  for (let i = 0; i < CREW_LIMITS.invite.ip; i += 1) assert.equal((await b.invite("ZZZZZZZZ")).status, 404);
  assert.equal((await b.invite("ZZZZZZZZ")).status, 429);
});
